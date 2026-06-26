import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateCurriculumPlan, buildProfileHash } from '@/lib/curriculum/planner'

export const maxDuration = 300

const BodySchema = z.object({
  role:      z.string().min(1).max(100),
  maturity:  z.string().min(1).max(50),
  topics:    z.array(z.string().min(1).max(200)).min(1).max(20),
  worry:     z.string().max(300).optional().default(''),
  roleLevel: z.string().max(50).optional().default('c-suite'),
})

/**
 * POST /api/curriculum/generate-preview
 *
 * Public (no auth). Called from the topics selection page before signup.
 * Checks the shared curriculum_plan_templates cache first.
 * If a template exists for this profile hash, returns it instantly (zero LLM).
 * If not, generates via LLM, saves as a shared template, and returns.
 *
 * Cross-user caching: two users with identical role+maturity+topics share one
 * LLM call. The template is then copied per-user by /api/curriculum/save-preview.
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { role, maturity, topics, worry, roleLevel } = parsed.data
  const profileHash = buildProfileHash(role, maturity, topics, roleLevel)
  const supabase = createSupabaseAdminClient()

  // ── Cache hit ──────────────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('curriculum_plan_templates')
    .select('id, visible_sessions, queue_sessions, is_fallback, use_count')
    .eq('profile_hash', profileHash)
    .maybeSingle()

  const apiKeyAvailable = (process.env.ANTHROPIC_API_KEY ?? '').length > 0 &&
    !(process.env.ANTHROPIC_API_KEY ?? '').startsWith('PLACEHOLDER_')

  if (existing && (!existing.is_fallback || !apiKeyAvailable)) {
    // Bump use_count without blocking
    supabase
      .from('curriculum_plan_templates')
      .update({ use_count: existing.use_count + 1 })
      .eq('id', existing.id)
      .then(() => {})

    return NextResponse.json({
      profile_hash:     profileHash,
      visible_sessions: existing.visible_sessions,
      queue_sessions:   existing.queue_sessions,
      cached:           true,
    })
  }

  // ── Cache miss — generate via LLM ─────────────────────────────────────────
  // Generate with 'pro' tier so the template is generous enough for all tiers.
  // /api/curriculum/save-preview enforces the actual user's tier limits when copying.
  const { output, isFallback, rawLlmOutput } = await generateCurriculumPlan({
    userId:    'preview',
    role,
    industry:  'general',
    maturity,
    worry,
    topics,
    planTier:  'pro',
    roleLevel,
  })

  const visibleSessions = output.arcs.flatMap((a) =>
    a.sessions.filter((s) => s.is_visible).map((s) => ({ ...s, arc_name: a.arc_name, arc_type: a.arc_type }))
  )
  const queueSessions = output.arcs.flatMap((a) =>
    a.sessions.filter((s) => !s.is_visible).map((s) => ({ ...s, arc_name: a.arc_name, arc_type: a.arc_type }))
  )

  // Only cache successful LLM plans. Fallbacks have skeleton content (1 session per topic)
  // and would poison the shared cache for all future users with the same profile hash.
  // save-preview will fire clio/topics.selected when it sees no valid template, triggering
  // a real LLM generation via curriculum-generator in the background.
  if (!isFallback) {
    // Upsert — handles the race condition where two users generate at the same time
    await supabase
      .from('curriculum_plan_templates')
      .upsert(
        {
          profile_hash:     profileHash,
          visible_sessions: visibleSessions,
          queue_sessions:   queueSessions,
          generated_at:     new Date().toISOString(),
          use_count:        1,
          is_fallback:      false,
        },
        { onConflict: 'profile_hash' }
      )
  }

  console.log(`[generate-preview] Template ${isFallback ? '(fallback — not cached)' : 'generated'} for hash ${profileHash}`, { rawLlmOutput })

  return NextResponse.json({
    profile_hash:     profileHash,
    visible_sessions: visibleSessions,
    queue_sessions:   queueSessions,
    cached:           false,
  })
}
