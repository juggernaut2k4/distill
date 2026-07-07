import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSessionsConfirmedEmail, type User, type SessionSummary } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'

const ScheduledSessionSchema = z.object({
  sessionIndex: z.number().int().positive(),
  title: z.string().min(1),
  topicId: z.string().min(1, 'topicId must be a non-empty string'),
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
  const { userId, error } = await requireSessionAuth(request)
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

  // UPDATE scheduled_at for each session — never delete/re-insert.
  // Sessions are created once by plan/approve with full metadata.
  // Skip sessions that are completed or active (protected).
  const { data: existingSessions } = await supabase
    .from('sessions')
    .select('id, session_index, session_title, scheduled_at, duration_mins, planned_duration_mins, status')
    .eq('user_id', userId!)
    .order('session_index', { ascending: true })

  const existingByIndex = new Map<number, { id: string; session_title: string; duration_mins: number; planned_duration_mins: number | null; status: string }>(
    (existingSessions ?? []).map((s: { id: string; session_index: number; session_title: string; duration_mins: number; planned_duration_mins: number | null; status: string }) => [s.session_index, s])
  )

  let updatedCount = 0
  for (const s of parsed.data.sessions) {
    const existing = existingByIndex.get(s.sessionIndex)
    if (!existing) {
      console.warn(`[schedule] No session found at index ${s.sessionIndex} — skipping`)
      continue
    }
    if (existing.status === 'completed' || existing.status === 'active') {
      console.log(`[schedule] Skipping protected session at index ${s.sessionIndex} (status: ${existing.status})`)
      continue
    }
    const { error: updateError } = await supabase
      .from('sessions')
      .update({ scheduled_at: s.scheduledAt })
      .eq('user_id', userId!)
      .eq('session_index', s.sessionIndex)
    if (updateError) {
      console.error(`[schedule] Failed to update session at index ${s.sessionIndex}:`, updateError)
    } else {
      updatedCount++
    }
  }

  // Fire-and-forget confirmation email + SMS
  const { data: userRow } = await supabase
    .from('users')
    .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned')
    .eq('id', userId!)
    .single()

  if (userRow?.email) {
    const sessionSummaries: SessionSummary[] = parsed.data.sessions
      .map((s): SessionSummary | null => {
        const existing = existingByIndex.get(s.sessionIndex)
        if (!existing) return null
        return {
          id: existing.id,
          sessionIndex: s.sessionIndex,
          title: existing.session_title ?? s.title,
          scheduledAt: s.scheduledAt,
          estimatedMinutes: s.estimatedMinutes,
        }
      })
      .filter((s): s is SessionSummary => s !== null)

    // Await before returning — Vercel kills fire-and-forget promises on response
    const notifySends: Promise<unknown>[] = [
      sendSessionsConfirmedEmail(userRow as User, sessionSummaries).catch(console.error),
    ]

    if (userRow.phone && userRow.twilio_number_assigned) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
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

  return NextResponse.json({ success: true, count: updatedCount })
}

/**
 * GET /api/sessions/schedule
 * Returns scheduled sessions for the authenticated user.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId!)
    .order('scheduled_at', { ascending: true })

  return NextResponse.json({ sessions: sessions ?? [] })
}
