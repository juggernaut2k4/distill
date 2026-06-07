import { type NextRequest } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateICS, type CalendarEvent } from '@/lib/sessions/calendar'

const ORGANIZER_NAME = 'Clio AI'
const ORGANIZER_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'hello@distill-peach.vercel.app'

/**
 * GET /api/sessions/[id]/calendar
 * Downloads a single session as a .ics file.
 * Verifies the session belongs to the authenticated user.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: session, error: dbError } = await supabase
    .from('sessions')
    .select('id, session_index, session_title, scheduled_at, duration_mins, topics, user_id')
    .eq('id', params.id)
    .single()

  if (dbError || !session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (session.user_id !== userId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const event: CalendarEvent = {
    uid: session.id as string,
    title: `Clio Session ${session.session_index}: ${session.session_title}`,
    description: Array.isArray(session.topics)
      ? `Topics: ${(session.topics as string[]).join(', ')}`
      : 'AI coaching session with Clio',
    startAt: new Date(session.scheduled_at as string),
    durationMinutes: (session.duration_mins as number) ?? 30,
    organizer: ORGANIZER_NAME,
    organizerEmail: ORGANIZER_EMAIL,
  }

  const icsContent = generateICS(event)

  return new Response(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="clio-session-${session.session_index}.ics"`,
    },
  })
}
