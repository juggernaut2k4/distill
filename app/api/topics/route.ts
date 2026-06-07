import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPlanReadyEmail, type User as EmailUser } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'
import { inngest } from '@/inngest/client'

const ProfileSchema = z.object({
  role: z.string().optional(),
  domains: z.array(z.string()).optional(),
  primaryDomain: z.string().optional(),
  domainProficiency: z.record(z.string(), z.string()).optional(),
  learningGoal: z.string().optional(),
}).optional()

const TopicsSchema = z.object({
  topics: z.array(z.string().min(1).max(200)).min(0).max(50),
  profile: ProfileSchema,
})

/**
 * GET /api/topics
 * Returns the current user's saved topic_interests.
 * Used by the topics page to pre-select existing choices on mount.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) {
    // Fall back to cookie auth for browser clients
    const { userId: cookieId, error: cookieError } = requireAuth()
    if (cookieError) return cookieError
    const supabase = createSupabaseAdminClient()
    const { data: user } = await supabase
      .from('users')
      .select('topic_interests')
      .eq('id', cookieId!)
      .maybeSingle()
    return NextResponse.json({ topics: user?.topic_interests ?? [] })
  }
  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('topic_interests')
    .eq('id', userId)
    .maybeSingle()
  return NextResponse.json({ topics: user?.topic_interests ?? [] })
}

/**
 * POST /api/topics
 * Saves user topic interests with smart delta logic:
 *   - Pure deletion (A,B→A): remove B sessions, promote A queue sessions, no LLM
 *   - Deletion+Addition (A,B→A,C): remove B, generate C, generate bridging A→C
 *   - Pure addition (A,B→A,B,C): generate C, generate bridging {A,B}→C
 */
export async function POST(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) {
    // Fall back to cookie-based auth for browser clients that haven't upgraded
    const { userId: cookieId, error: cookieError } = requireAuth()
    if (cookieError) return cookieError
    return handleTopicsPost(request, cookieId!)
  }
  return handleTopicsPost(request, userId)
}

async function handleTopicsPost(request: NextRequest, userId: string): Promise<NextResponse> {
  const body = await request.json()
  const parsed = TopicsSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const supabase = createSupabaseAdminClient()
  const newTopics = parsed.data.topics

  // ── Load existing topics to compute delta ──────────────────────────────────
  const { data: existing } = await supabase
    .from('users')
    .select('topic_interests, plan_tier')
    .eq('id', userId)
    .maybeSingle()

  const oldTopics: string[] = Array.isArray(existing?.topic_interests) ? existing.topic_interests : []
  const planTier = existing?.plan_tier ?? 'starter'

  const removed = oldTopics.filter((t) => !newTopics.includes(t))
  const added   = newTopics.filter((t) => !oldTopics.includes(t))
  const kept    = newTopics.filter((t) => oldTopics.includes(t))
  const isFirstSave = oldTopics.length === 0

  // ── Save new topics + profile ─────────────────────────────────────────────
  const profileUpdate = parsed.data.profile
    ? {
        role: parsed.data.profile.role,
        domains: parsed.data.profile.domains,
        primary_domain: parsed.data.profile.primaryDomain,
        domain_proficiency: parsed.data.profile.domainProficiency,
        learning_goal: parsed.data.profile.learningGoal,
      }
    : {}

  const { error: updateError } = await supabase
    .from('users')
    .update({
      topic_interests: newTopics,
      needs_recalibration: false,
      plan_approved: false,
      ...profileUpdate,
    })
    .eq('id', userId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save topics' }, { status: 500 })
  }

  // ── Delta handling ────────────────────────────────────────────────────────
  if (!isFirstSave && removed.length > 0) {
    // Delete scheduled sessions for removed topics (completed sessions never touched)
    await supabase
      .from('sessions')
      .delete()
      .eq('user_id', userId)
      .in('topic_id', removed)
      .eq('status', 'scheduled')

    // Remove deleted topics from visible_sessions and queue_sessions in the active plan
    const { data: activePlan } = await supabase
      .from('curriculum_plans')
      .select('id, visible_sessions, queue_sessions')
      .eq('user_id', userId)
      .is('superseded_at', null)
      .maybeSingle()

    if (activePlan) {
      const filterSessions = (sessions: unknown[]) =>
        sessions.filter((s: unknown) => {
          const session = s as Record<string, unknown>
          const sessionTopic = String(session.topic ?? session.topic_id ?? '')
          return !removed.some((r) =>
            sessionTopic.toLowerCase().includes(r.toLowerCase()) ||
            r.toLowerCase().includes(sessionTopic.toLowerCase())
          )
        })

      const newVisible = filterSessions(Array.isArray(activePlan.visible_sessions) ? activePlan.visible_sessions as unknown[] : [])
      const newQueue   = filterSessions(Array.isArray(activePlan.queue_sessions)   ? activePlan.queue_sessions as unknown[]   : [])

      // Promote queue sessions to fill freed visible slots (up to tier limit)
      const tierLimit = planTier === 'executive' ? 10 : planTier === 'pro' ? 10 : 5
      const freeSlots = tierLimit - newVisible.length
      if (freeSlots > 0) {
        const promoted = newQueue.splice(0, freeSlots)
        newVisible.push(...promoted)
      }

      await supabase
        .from('curriculum_plans')
        .update({ visible_sessions: newVisible, queue_sessions: newQueue })
        .eq('id', activePlan.id)
    }
  }

  // ── Fire Inngest event with delta context ─────────────────────────────────
  // The curriculum generator uses this context to know what to generate.
  // If first save or pure deletion: standard full regeneration.
  // If addition: generate new topic arc + bridging sessions.
  try {
    await inngest.send({
      name: 'clio/topics.selected',
      data: {
        userId,
        delta: {
          removed,
          added,
          kept,
          needsBridging: added.length > 0 && kept.length > 0,
        },
      },
    })

    const { data: user } = await supabase
      .from('users')
      .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned')
      .eq('id', userId)
      .single()

    const sends: Promise<unknown>[] = []

    if (user?.email) {
      sends.push(sendPlanReadyEmail(user as EmailUser).catch(console.error))
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
    if (user?.phone && user.twilio_number_assigned) {
      sends.push(
        sendSMS(
          user.phone as string,
          user.twilio_number_assigned as string,
          `Your Clio learning plan is being built! Review and approve it here: ${appUrl}/dashboard/plan — Clio`
        ).catch(console.error)
      )
    }

    await Promise.all(sends)
  } catch (notifyErr) {
    console.error('[topics] Post-save actions failed:', notifyErr)
  }

  return NextResponse.json({
    success: true,
    delta: { removed: removed.length, added: added.length, kept: kept.length },
  })
}
