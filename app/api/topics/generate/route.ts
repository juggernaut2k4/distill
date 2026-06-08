import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { buildCurriculum } from '@/lib/curriculum'
import type { UserProfile, Maturity } from '@/lib/curriculum'

// ── Schema helpers ────────────────────────────────────────────────────────────

const NewSchema = z.object({
  role: z.string().optional(),
  industry: z.string().optional(),
  maturity: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  interest: z.string().optional(),
})

const LegacySchema = z.object({
  objectives: z.string().min(5).max(2000),
})

// ── Profile builder (kept for GET handler) ────────────────────────────────────

function buildObjectivesFromProfile(profile: {
  role?: string | null
  industry?: string | null
  ai_maturity?: string | null
  worry?: string | null
}): string {
  const parts: string[] = []
  if (profile.role) parts.push(`I am a ${profile.role}`)
  if (profile.industry) parts.push(`working in the ${profile.industry} industry`)
  if (profile.ai_maturity) parts.push(`with ${profile.ai_maturity} experience with AI`)
  if (profile.worry) parts.push(`and my biggest AI concern is: ${profile.worry}`)
  parts.push('I want practical AI knowledge relevant to my executive role.')
  return parts.join(', ')
}

// ── GET — unchanged from original ────────────────────────────────────────────

/**
 * GET /api/topics/generate
 * Auto-generates topics from the user's onboarding profile.
 * If the user already has saved topics, returns those first.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('role, industry, ai_maturity, role_level, worry, topic_interests')
    .eq('id', userId!)
    .single()

  // Return existing saved topics if user already went through this
  if (
    user?.topic_interests &&
    Array.isArray(user.topic_interests) &&
    user.topic_interests.length > 0
  ) {
    return NextResponse.json({ topics: user.topic_interests, source: 'saved' })
  }

  const objectives = buildObjectivesFromProfile(user ?? {})

  // Build a profile for the curriculum engine
  const profile: UserProfile = {
    role: user?.role ?? 'executive',
    industry: user?.industry ?? 'general',
    maturity: (user?.ai_maturity ?? 'beginner') as Maturity,
    roleLevel: (user?.role_level as string | null) ?? 'c-suite',
    interest: objectives,
  }

  try {
    const curriculum = await buildCurriculum(profile)
    const topics = curriculum.sessions.map((s) => s.title)
    return NextResponse.json({ topics, source: 'profile' })
  } catch (err) {
    console.error('[topics/generate GET] Failed:', err)
    return NextResponse.json(
      { error: 'Could not generate topics from your profile.' },
      { status: 500 }
    )
  }
}

// ── POST — replaced with curriculum engine ────────────────────────────────────

/**
 * POST /api/topics/generate
 * Generates a structured 10-session curriculum from user profile + optional overrides.
 *
 * Accepts either:
 *   - New format: { role?, industry?, maturity?, interest? }
 *   - Legacy format: { objectives: string }
 *
 * Always returns: { topics: string[], curriculum: CurriculumResult, source: 'curriculum-engine' }
 */
export async function POST(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const body = (await request.json()) as unknown

  const newParsed = NewSchema.safeParse(body)
  const legacyParsed = LegacySchema.safeParse(body)

  if (!newParsed.success && !legacyParsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('role, industry, ai_maturity, role_level')
    .eq('id', userId!)
    .single()

  const profile: UserProfile = {
    role: newParsed.data?.role ?? user?.role ?? 'executive',
    industry: newParsed.data?.industry ?? user?.industry ?? 'general',
    maturity: (newParsed.data?.maturity ?? user?.ai_maturity ?? 'beginner') as Maturity,
    roleLevel: (user?.role_level as string | null) ?? 'c-suite',
    interest: newParsed.data?.interest ?? legacyParsed.data?.objectives ?? '',
  }

  console.log('[topics/generate POST] user', userId, '| profile:', JSON.stringify(profile))

  try {
    const curriculum = await buildCurriculum(profile)
    // Return flat topics list for backwards compatibility with existing UI
    const topics = curriculum.sessions.map((s) => s.title)
    return NextResponse.json({ topics, curriculum, source: 'curriculum-engine' })
  } catch (err) {
    console.error('[topics/generate POST] Curriculum engine error:', err)
    return NextResponse.json(
      { error: 'Could not generate curriculum. Please try again.' },
      { status: 500 }
    )
  }
}
