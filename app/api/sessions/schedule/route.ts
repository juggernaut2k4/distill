import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSessionsConfirmedEmail, type User, type SessionSummary } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'
import { inngest } from '@/inngest/client'
import { createGoogleMeetEvent } from '@/lib/google-calendar'

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
  sessions: z.array(ScheduledSessionSchema).min(1).max(200),
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

  // Create Google Meet links — 8s timeout per session so slow/failing Calendar API
  // doesn't block the response. Sessions are created; Meet links are best-effort.
  const meetTimeout = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
  await Promise.all(
    parsed.data.sessions.map(async (s) => {
      const sessionId = indexToId.get(s.sessionIndex)
      if (!sessionId) return
      try {
        const meet = await Promise.race([
          createGoogleMeetEvent({
            title: `Clio Session: ${s.title}`,
            description: `AI coaching session with Clio. Topics: ${s.topics.join(', ')}`,
            startIso: s.scheduledAt,
            durationMins: s.estimatedMinutes,
          }),
          meetTimeout(8000),
        ])
        if (meet) {
          await supabase
            .from('sessions')
            .update({ meeting_url: meet.meetUrl })
            .eq('id', sessionId)
          console.log(`[schedule] Meet created for session ${sessionId}: ${meet.meetUrl}`)
        }
      } catch (err) {
        console.error(`[schedule] Meet creation failed for session ${s.sessionIndex}:`, err)
      }
    })
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

  // Immediately trigger full content generation for Session 1 (user is waiting)
  const firstSessionId = indexToId.get(1)
  const firstSession = parsed.data.sessions.find((s) => s.sessionIndex === 1)
  if (firstSessionId && firstSession) {
    // Derive a session-specific topicId from the title rather than falling back
    // to 'ai-fundamentals', which generates wrong catalog-context visualizations.
    const sessionTopicId = firstSession.topicId ||
      firstSession.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 60)
    inngest
      .send({
        name: 'distill/session.content.generate' as const,
        data: {
          sessionId: firstSessionId,
          topicId: sessionTopicId,
          topicTitle: firstSession.title,
          subtopics: firstSession.subtopics,
          userId: userId!,
          priority: 'immediate',
        },
      })
      .catch((err) => console.error('[schedule] Failed to emit content.generate for session 1:', err))
    console.log(`[schedule] Triggered content generation for Session 1: ${firstSessionId} (topicId: ${sessionTopicId})`)
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

    // Await before returning — Vercel kills fire-and-forget promises on response
    const notifySends: Promise<unknown>[] = [
      sendSessionsConfirmedEmail(userRow as User, sessionSummaries).catch(console.error),
    ]

    if (userRow.phone && userRow.twilio_number_assigned) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
      const first = parsed.data.sessions[0]
      const firstDate = new Date(first.scheduledAt).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      })
      notifySends.push(
        sendSMS(
          userRow.phone,
          userRow.twilio_number_assigned,
          `Clio: ${parsed.data.sessions.length} sessions scheduled! First session: ${first.title} on ${firstDate}. View schedule: ${appUrl}/dashboard/sessions`
        ).catch(console.error)
      )
    }

    await Promise.all(notifySends)
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
