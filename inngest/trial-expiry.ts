import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendTrialEndingEmail, sendTrialExpiredEmail } from '@/lib/delivery/email'

/**
 * Daily cron — runs at 9AM UTC.
 * 1. Sends a 24h warning email to trials expiring tomorrow.
 * 2. Suspends accounts whose trial ended without payment.
 */
export const trialExpiryJob = inngest.createFunction(
  {
    id: 'trial-expiry',
    name: 'Trial Expiry Job',
    retries: 2,
    triggers: [{ cron: '0 9 * * *' }],
  },
  async ({ step }: { step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const supabase = createSupabaseAdminClient()
    const now = new Date()

    // ── 1. Send 24h warning to trials expiring tomorrow ──────────────────────
    await step.run('send-24h-warnings', async () => {
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)

      // Find trials ending in the next 25 hours (25h window to avoid missing anyone)
      const windowStart = now.toISOString()
      const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString()

      const { data: expiringUsers, error } = await supabase
        .from('users')
        .select('id, email, plan_tier, trial_ends_at')
        .eq('subscription_status', 'trialing')
        .eq('trial_opted_in', true)
        .gte('trial_ends_at', windowStart)
        .lte('trial_ends_at', windowEnd)

      if (error) {
        console.error('[trial-expiry] Error fetching expiring trials:', error.message)
        return { warned: 0 }
      }

      let warned = 0
      for (const user of expiringUsers ?? []) {
        if (!user.email) continue
        const trialEndsAt = new Date(user.trial_ends_at as string)
        const hoursLeft = Math.round((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60))
        await sendTrialEndingEmail(user as { email: string; plan_tier: string | null }, hoursLeft)
        warned++
      }

      console.log(`[trial-expiry] Sent ${warned} 24h warning emails`)
      return { warned }
    })

    // ── 2. Suspend expired trials with no active subscription ─────────────────
    await step.run('suspend-expired-trials', async () => {
      const { data: expiredUsers, error } = await supabase
        .from('users')
        .select('id, email, plan_tier')
        .eq('subscription_status', 'trialing')
        .eq('trial_opted_in', true)
        .lt('trial_ends_at', now.toISOString())

      if (error) {
        console.error('[trial-expiry] Error fetching expired trials:', error.message)
        return { suspended: 0 }
      }

      let suspended = 0
      for (const user of expiredUsers ?? []) {
        await supabase
          .from('users')
          .update({
            subscription_status: 'suspended',
            minutes_balance: 0,
          })
          .eq('id', user.id)

        if (user.email) {
          await sendTrialExpiredEmail(user as { email: string; plan_tier: string | null })
        }

        suspended++
      }

      console.log(`[trial-expiry] Suspended ${suspended} expired trial accounts`)
      return { suspended }
    })
  }
)
