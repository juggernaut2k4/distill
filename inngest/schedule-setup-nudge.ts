/**
 * Hourly cron: sends a schedule-setup nudge email to users who:
 *   - Have an approved plan
 *   - Have not yet set scheduling_prefs
 *   - Have not already received this nudge
 *   - Approved their plan more than 24 hours ago
 *
 * Fires at most once per user — schedule_nudge_sent_at is set after sending.
 */

import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { Resend } from 'resend'

const isResendPlaceholder = !process.env.RESEND_API_KEY ||
  process.env.RESEND_API_KEY.startsWith('PLACEHOLDER_')

const resend = isResendPlaceholder ? null : new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'hello@distill-peach.vercel.app'
const FROM_NAME  = process.env.RESEND_FROM_NAME  ?? 'Clio'
const FROM       = `${FROM_NAME} <${FROM_EMAIL}>`
const APP_URL    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

export const scheduleSetupNudge = inngest.createFunction(
  {
    id: 'schedule-setup-nudge',
    name: 'Hourly: Nudge users to set their schedule after plan approval',
    triggers: [{ cron: '0 * * * *' }],
    retries: 2,
  },
  async ({ step }) => {
    const supabase = createSupabaseAdminClient()

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const usersToNudge = await step.run('fetch-users-to-nudge', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email')
        .eq('plan_approved', true)
        .is('scheduling_prefs', null)
        .is('schedule_nudge_sent_at', null)
        .lt('plan_approved_at', cutoff)

      if (error) {
        console.error('[schedule-setup-nudge] Failed to fetch users:', error.message)
        return []
      }

      return data ?? []
    })

    if (usersToNudge.length === 0) {
      console.log('[schedule-setup-nudge] No users to nudge.')
      return { nudged: 0 }
    }

    console.log(`[schedule-setup-nudge] Nudging ${usersToNudge.length} user(s).`)

    await step.run('send-nudge-emails', async () => {
      for (const user of usersToNudge as { id: string; email: string }[]) {
        try {
          if (isResendPlaceholder || !resend) {
            console.log(`[MOCK] schedule-setup-nudge: would send nudge to user ${user.id}`)
          } else {
            await resend.emails.send({
              from: FROM,
              to:   user.email,
              subject: 'Your Clio sessions are waiting — set your schedule',
              html: `
                <p>Your Clio learning plan has been approved — great work!</p>
                <p>To start your sessions, you need to choose when you'd like to learn.
                It only takes a moment to pick your preferred days and time.</p>
                <p style="margin-top: 24px;">
                  <a href="${APP_URL}/dashboard/sessions"
                     style="background:#7C3AED;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                    Set my schedule
                  </a>
                </p>
              `,
            })
          }

          // Mark nudge sent regardless of mock/real so we don't re-send
          await supabase
            .from('users')
            .update({ schedule_nudge_sent_at: new Date().toISOString() })
            .eq('id', user.id)
        } catch (err) {
          console.error(`[schedule-setup-nudge] Failed for user ${user.id}:`, err)
          // Continue to next user — never fail the whole batch
        }
      }
    })

    return { nudged: usersToNudge.length }
  }
)
