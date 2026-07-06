import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateMultiEventICS, type CalendarEvent } from '@/lib/sessions/calendar'

const ORGANIZER_NAME = 'Clio AI'
const ORGANIZER_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'hello@distill-peach.vercel.app'

/**
 * GET /api/sessions/calendar
 * Downloads all non-cancelled sessions for the authenticated user as a single .ics file.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: sessions, error: dbError } = await supabase
    .from('sessions')
    .select('id, session_index, session_title, scheduled_at, duration_mins, planned_duration_mins, topics')
    .eq('user_id', userId!)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: true })

  if (dbError) {
    return new Response(JSON.stringify({ error: 'Failed to fetch sessions' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const events: CalendarEvent[] = (sessions ?? []).map((s) => ({
    uid: s.id as string,
    title: `Clio Session ${s.session_index}: ${s.session_title}`,
    description: Array.isArray(s.topics)
      ? `Topics: ${(s.topics as string[]).join(', ')}`
      : 'AI coaching session with Clio',
    startAt: new Date(s.scheduled_at as string),
    durationMinutes: (s.planned_duration_mins as number | null) ?? (s.duration_mins as number) ?? 30,
    organizer: ORGANIZER_NAME,
    organizerEmail: ORGANIZER_EMAIL,
  }))

  const icsContent = generateMultiEventICS(events)

  return new Response(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="clio-sessions.ics"',
    },
  })
}
