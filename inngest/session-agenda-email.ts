import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSessionAgendaEmail, type User, type SessionSummary, type AgendaEmailSubSession } from '@/lib/delivery/email'
import type { SessionPlan } from '@/lib/session-plan'

/**
 * Sends agenda email 30 minutes before each session.
 * Cron: every 5 minutes — checks sessions starting in 25–35 min window.
 * meet_reminder_sent flag prevents duplicate sends.
 */
export const sessionAgendaEmail = inngest.createFunction(
  {
    id: 'session-agenda-email',
    name: 'Session Agenda Email (30 min reminder)',
    retries: 2,
    triggers: [{ cron: '*/5 * * * *' }],
  },
  async ({ step }) => {
    const now = new Date()
    const windowStart = new Date(now.getTime() + 25 * 60 * 1000) // now + 25 min
    const windowEnd = new Date(now.getTime() + 35 * 60 * 1000)   // now + 35 min

    const upcomingSessions = await step.run('fetch-upcoming-sessions', async () => {
      const supabase = createSupabaseAdminClient()
      const { data, error } = await supabase
        .from('sessions')
        .select('id, user_id, session_index, session_title, scheduled_at, duration_mins, meeting_url, session_plan, meet_reminder_sent')
        .eq('status', 'scheduled')
        .eq('meet_reminder_sent', false)
        .not('meeting_url', 'is', null)
        .gte('scheduled_at', windowStart.toISOString())
        .lte('scheduled_at', windowEnd.toISOString())

      if (error) throw new Error(`[session-agenda-email] Fetch error: ${error.message}`)
      return data ?? []
    })

    if (upcomingSessions.length === 0) return { sent: 0 }

    let sent = 0

    for (const session of upcomingSessions) {
      await step.run(`send-agenda-${session.id}`, async () => {
        const supabase = createSupabaseAdminClient()

        const { data: userRow } = await supabase
          .from('users')
          .select('id, email, role, industry, ai_maturity')
          .eq('id', session.user_id)
          .single()

        if (!userRow?.email) return

        // Extract sub-sessions from session_plan (respecting skipped flags)
        // subSessions: tabs within this session (stored as sessions.subtopics in DB — column rename pending TERM-01)
        const plan = session.session_plan as SessionPlan | null
        const subSessions: AgendaEmailSubSession[] = plan?.subtopics?.map((s) => ({
          title: s.title,
          skipped: s.skipped ?? false,
        })) ?? []

        const sessionSummary: SessionSummary = {
          id: session.id as string,
          sessionIndex: session.session_index as number,
          title: session.session_title as string,
          scheduledAt: session.scheduled_at as string,
          estimatedMinutes: (session.duration_mins as number) ?? 30,
        }

        await sendSessionAgendaEmail(
          userRow as User,
          sessionSummary,
          subSessions,
          session.meeting_url as string
        )

        // Mark reminder sent so we don't re-send on the next cron tick
        await supabase
          .from('sessions')
          .update({ meet_reminder_sent: true })
          .eq('id', session.id)

        sent++
        console.log(`[session-agenda-email] Sent agenda email for session ${session.id}`)
      })
    }

    return { sent }
  }
)
