import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSessionsConfirmedEmail, type User, type SessionSummary } from '@/lib/delivery/email'

const ScheduledSessionSchema = z.object({
  sessionIndex: z.number().int().positive(),
  title: z.string().min(1),
  topics: z.array(z.string()),
  scheduledAt: z.string().datetime(),
  estimatedMinutes: z.number().int().positive().max(120),
})

const ScheduleRequestSchema = z.object({
  sessions: z.array(ScheduledSessionSchema).min(1).max(20),
})

/**
 * POST /api/sessions/schedule
 * Creates or replaces all scheduled sessions for the authenticated user.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  const body = await request.json()
  const parsed = ScheduleRequestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const supabase = createSupabaseAdminClient()

  // Clear existing scheduled sessions (not completed/active ones)
  await supabase
    .from('sessions')
    .delete()
    .eq('user_id', userId!)
    .eq('status', 'scheduled')

  // Insert new sessions
  const rows = parsed.data.sessions.map((s) => ({
    user_id: userId!,
    session_index: s.sessionIndex,
    session_title: s.title,
    topics: s.topics,
    scheduled_at: s.scheduledAt,
    duration_mins: s.estimatedMinutes,
    status: 'scheduled',
  }))

  const { error: insertError } = await supabase
    .from('sessions')
    .insert(rows)

  if (insertError) {
    console.error('[schedule] Insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save sessions' }, { status: 500 })
  }

  // Fire-and-forget confirmation email
  const { data: userRow } = await supabase
    .from('users')
    .select('id, email, role, industry, ai_maturity')
    .eq('id', userId!)
    .single()

  if (userRow?.email) {
    const sessionSummaries: SessionSummary[] = parsed.data.sessions.map((s) => ({
      sessionIndex: s.sessionIndex,
      title: s.title,
      scheduledAt: s.scheduledAt,
      estimatedMinutes: s.estimatedMinutes,
    }))

    sendSessionsConfirmedEmail(userRow as User, sessionSummaries).catch(console.error)
  }

  return NextResponse.json({ success: true, count: rows.length })
}

/**
 * GET /api/sessions/schedule
 * Returns scheduled sessions for the authenticated user.
 */
export async function GET() {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId!)
    .order('scheduled_at', { ascending: true })

  return NextResponse.json({ sessions: sessions ?? [] })
}
