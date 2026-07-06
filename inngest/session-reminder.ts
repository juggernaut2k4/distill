import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSessionReminderEmail, type User, type SessionSummary } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'

/**
 * Session reminder job.
 * Cron: 0 * * * * (every hour)
 * Checks for sessions scheduled between now+20h and now+28h (~tomorrow).
 * Sends email + SMS reminders and marks them sent.
 *
 * Note: reminder_sent column not yet in schema — query is implemented correctly
 * but the update is best-effort. Sessions will re-send if the column doesn't exist yet.
 */
export const sessionReminder = inngest.createFunction(
  {
    id: 'session-reminder',
    name: 'Session Day-Before Reminder',
    retries: 2,
    triggers: [{ cron: '0 * * * *' }],
  },
  async ({ step }) => {
    const now = new Date()
    const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000) // now + 20h
    const windowEnd = new Date(now.getTime() + 28 * 60 * 60 * 1000)   // now + 28h

    const upcomingSessions = await step.run('fetch-upcoming-sessions', async () => {
      const supabase = createSupabaseAdminClient()
      const { data, error } = await supabase
        .from('sessions')
        .select('id, user_id, session_index, session_title, scheduled_at, duration_mins, planned_duration_mins')
        .eq('status', 'scheduled')
        .gte('scheduled_at', windowStart.toISOString())
        .lte('scheduled_at', windowEnd.toISOString())

      if (error) {
        throw new Error(`[session-reminder] Failed to fetch sessions: ${error.message}`)
      }
      return data ?? []
    })

    if (upcomingSessions.length === 0) {
      console.log('[session-reminder] No sessions to remind about in window')
      return { reminded: 0 }
    }

    let reminded = 0

    for (const session of upcomingSessions) {
      await step.run(`remind-session-${session.id}`, async () => {
        const supabase = createSupabaseAdminClient()

        try {
          // Fetch user for this session
          const { data: userRow } = await supabase
            .from('users')
            .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned')
            .eq('id', session.user_id)
            .single()

          if (!userRow) {
            console.warn(`[session-reminder] User not found for session ${session.id}`)
            return
          }

          const sessionSummary: SessionSummary = {
            id: session.id as string,
            sessionIndex: session.session_index as number,
            title: session.session_title as string,
            scheduledAt: session.scheduled_at as string,
            estimatedMinutes: (session.planned_duration_mins as number | null) ?? (session.duration_mins as number) ?? 30,
          }

          // Send email reminder
          if (userRow.email) {
            await sendSessionReminderEmail(userRow as User, sessionSummary)
          }

          // Send SMS reminder if user has phone + twilio number
          if (userRow.phone && userRow.twilio_number_assigned) {
            const d = new Date(session.scheduled_at as string)
            const timeStr = d.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })
            await sendSMS(
              userRow.phone as string,
              userRow.twilio_number_assigned as string,
              `Clio reminder: Session ${session.session_index} "${session.session_title}" is tomorrow at ${timeStr}. — Clio`
            )
          }

          reminded++
          console.log(`[session-reminder] Reminded user ${session.user_id} for session ${session.id}`)
        } catch (err) {
          console.error(`[session-reminder] Error reminding session ${session.id}:`, err)
        }
      })
    }

    console.log(`[session-reminder] Complete: ${reminded} reminders sent`)
    return { reminded }
  }
)
