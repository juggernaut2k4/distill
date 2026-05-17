import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSessionsConfirmedEmail, type User, type SessionSummary } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'
import { inngest } from '@/inngest/client'

const ScheduledSessionSchema = z.object({
  sessionIndex: z.number().int().positive(),
  title: z.string().min(1),
  topicId: z.string().default(''),
  topics: z.array(z.string()),
  subtopics: z.array(z.string()).default([]),
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
    topic_id: s.topicId || null,
    topics: s.topics,
    scheduled_at: s.scheduledAt,
    duration_mins: s.estimatedMinutes,
    status: 'scheduled',
  }))

  const { data: insertedRows, error: insertError } = await supabase
    .from('sessions')
    .insert(rows)
    .select('id, session_index')

  if (insertError) {
    console.error('[schedule] Insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save sessions' }, { status: 500 })
  }

  // Build a map from session_index → uuid so email links use the real ID
  const indexToId = new Map<number, string>(
    (insertedRows ?? []).map((r: { id: string; session_index: number }) => [r.session_index, r.id])
  )

  // Fire Inngest event for each session to pre-generate visual specs in background
  const planEvents = parsed.data.sessions
    .filter((s) => s.topicId && s.subtopics.length > 0)
    .map((s) => ({
      name: 'distill/session.scheduled' as const,
      data: {
        sessionId: indexToId.get(s.sessionIndex) ?? '',
        topicId: s.topicId,
        topicTitle: s.title,
        subtopics: s.subtopics,
        userId: userId!,
      },
    }))
    .filter((e) => e.data.sessionId)

  if (planEvents.length > 0) {
    inngest.send(planEvents).catch((err) =>
      console.error('[schedule] Failed to emit session.scheduled events:', err)
    )
  }

  // Fire-and-forget confirmation email + SMS
  const { data: userRow } = await supabase
    .from('users')
    .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned')
    .eq('id', userId!)
    .single()

  if (userRow?.email) {
    const sessionSummaries: SessionSummary[] = parsed.data.sessions.map((s) => ({
      id: indexToId.get(s.sessionIndex),
      sessionIndex: s.sessionIndex,
      title: s.title,
      scheduledAt: s.scheduledAt,
      estimatedMinutes: s.estimatedMinutes,
    }))

    sendSessionsConfirmedEmail(userRow as User, sessionSummaries).catch(console.error)

    if (userRow.phone && userRow.twilio_number_assigned) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
      const first = parsed.data.sessions[0]
      const firstDate = new Date(first.scheduledAt).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      })
      sendSMS(
        userRow.phone,
        userRow.twilio_number_assigned,
        `Clio: ${parsed.data.sessions.length} sessions scheduled! First session: ${first.title} on ${firstDate}. View schedule: ${appUrl}/dashboard/sessions`
      ).catch(console.error)
    }
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
