import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { createBot } from '@/lib/recall'
import { sendSMS } from '@/lib/delivery/sms'
import { Resend } from 'resend'

/**
 * Pre-session bot setup job.
 * Cron: every 30 minutes.
 * Finds sessions starting in 25–35 minutes that already have a meeting_url,
 * sends the Recall.ai bot into the meeting, and notifies the user.
 */
export const sessionMeetingSetup = inngest.createFunction(
  {
    id: 'session-meeting-setup',
    name: 'Pre-Session Bot Setup',
    retries: 2,
    triggers: [{ cron: '*/30 * * * *' }],
  },
  async ({ step }) => {
    const now = new Date()
    const windowStart = new Date(now.getTime() + 25 * 60 * 1000)
    const windowEnd = new Date(now.getTime() + 35 * 60 * 1000)

    const upcomingSessions = await step.run('fetch-sessions-in-window', async () => {
      const supabase = createSupabaseAdminClient()
      const { data, error } = await supabase
        .from('sessions')
        .select('id, user_id, session_index, session_title, scheduled_at, duration_mins, meeting_url')
        .eq('status', 'scheduled')
        .not('meeting_url', 'is', null) // only sessions that have a meeting URL
        .gte('scheduled_at', windowStart.toISOString())
        .lte('scheduled_at', windowEnd.toISOString())

      if (error) throw new Error(`[session-meeting-setup] Fetch error: ${error.message}`)
      return data ?? []
    })

    if (upcomingSessions.length === 0) {
      console.log('[session-meeting-setup] No sessions in 25–35 min window')
      return { botsDeployed: 0 }
    }

    let botsDeployed = 0

    for (const session of upcomingSessions) {
      await step.run(`setup-bot-${session.id}`, async () => {
        const supabase = createSupabaseAdminClient()

        try {
          const userId = session.user_id as string
          const meetingUrl = session.meeting_url as string
          const sessionTitle = (session.session_title as string) ?? 'Your Clio Session'
          const walkthroughUrl = `${process.env.NEXT_PUBLIC_APP_URL}/walkthrough/${userId}`

          // Send bot into the meeting
          const { botId } = await createBot(meetingUrl, userId, walkthroughUrl)

          // Store bot ID on walkthrough_state so the webhook can find it
          await supabase
            .from('walkthrough_state')
            .upsert({
              user_id: userId,
              bot_id: botId,
              meeting_url: meetingUrl,
              session_id: session.id,
              status: 'idle',
              visual_spec: null,
            })

          // Fetch user contact details
          const { data: userRow } = await supabase
            .from('users')
            .select('email, phone, twilio_number_assigned')
            .eq('id', userId)
            .single()

          if (!userRow) return

          const sessionTime = new Date(session.scheduled_at as string).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })

          if (userRow.email) {
            await sendJoinEmail(
              userRow.email as string,
              sessionTitle,
              sessionTime,
              meetingUrl,
              session.session_index as number
            )
          }

          if (userRow.phone && userRow.twilio_number_assigned) {
            await sendSMS(
              userRow.phone as string,
              userRow.twilio_number_assigned as string,
              `Clio: Your session "${sessionTitle}" starts in 30 min. Join here: ${meetingUrl}`
            )
          }

          botsDeployed++
          console.log(`[session-meeting-setup] Bot deployed for session ${session.id}`, { botId, meetingUrl })
        } catch (err) {
          console.error(`[session-meeting-setup] Error for session ${session.id}:`, err)
        }
      })
    }

    return { botsDeployed }
  }
)

// ─── EMAIL HELPER ─────────────────────────────────────────────────────────────

async function sendJoinEmail(
  email: string,
  sessionTitle: string,
  sessionTime: string,
  meetingUrl: string,
  sessionIndex: number
) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey || resendKey.startsWith('PLACEHOLDER')) {
    console.log('[MOCK] sendJoinEmail', { email, sessionTitle, meetingUrl })
    return
  }

  const resend = new Resend(resendKey)
  const fromName = process.env.RESEND_FROM_NAME ?? 'Clio'
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'hello@hello-clio.com'

  await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: email,
    subject: `Your Clio session starts in 30 minutes`,
    html: `<!DOCTYPE html><html><body style="background:#080808;color:#fff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:40px 24px;">
<tr><td>
  <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
  <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0 0 8px;">Your session starts in 30 minutes.</h1>
  <p style="color:#94A3B8;font-size:15px;margin:0 0 24px;">
    Session ${sessionIndex}: <strong style="color:#fff;">${sessionTitle}</strong><br>
    Today at ${sessionTime}
  </p>
  <p style="color:#94A3B8;font-size:14px;line-height:1.6;margin:0 0 28px;">
    Your AI coach is already in the meeting. Just click the link below to join —
    the visual walkthrough will appear on screen automatically.
  </p>
  <a href="${meetingUrl}" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
    Join your session →
  </a>
  <p style="color:#475569;font-size:12px;margin-top:32px;">
    No downloads needed. Opens in your browser via Google Meet.
  </p>
</td></tr>
</table>
</body></html>`,
  }).catch(console.error)
}
