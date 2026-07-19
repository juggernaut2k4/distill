import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { clerkClient } from '@clerk/nextjs/server'
import { sendPartnerSignupReminderEmail } from '@/lib/delivery/email'

/**
 * B2B-06 — Partner Signup Reminder.
 *
 * Triggered by `clio/partner-account.created`, emitted from the shared
 * `createOrClaimPartnerAccount()` helper (`lib/partner/signup.ts`) on
 * successful partner-account creation. Renamed from `clio/partner-org.created`
 * as part of B2B-25 (Clerk Organizations removal,
 * docs/specs/B2B-25-requirement-document.md §6.5) — same trigger semantics,
 * new event name, `orgName` payload field renamed to `companyName`.
 *
 * Sleeps 24h, then re-checks whether the partner has completed onboarding
 * (`partner_accounts.onboarding_completed_at IS NOT NULL`). If not, sends one
 * reminder email to the account's owner. Fires exactly once — no repeat loop
 * (docs/specs/B2B-06-requirement-document.md §5.B.6, architecture.md §18.11).
 *
 * Mirrors inngest/abandoned-onboarding-cleanup.ts's durable-sleep + re-check +
 * act-or-skip shape. Never fails loudly on an email-send failure — logged and
 * swallowed, matching this codebase's non-fatal-side-effect convention for
 * delivery functions (e.g. the `.catch()` pattern in `lib/partner/signup.ts`).
 */
export const partnerSignupReminder = inngest.createFunction(
  {
    id: 'partner-signup-reminder',
    name: 'Partner Signup Reminder',
    triggers: [{ event: 'clio/partner-account.created' }],
    retries: 2,
  },
  async ({
    event,
    step,
  }: {
    event: { data: { partnerAccountId: string; companyName: string; createdAt: string } }
    step: {
      sleep: (id: string, duration: string) => Promise<void>
      run: <T>(id: string, fn: () => Promise<T>) => Promise<T>
    }
  }) => {
    await step.sleep('wait-24h', '24h')

    await step.run('check-and-remind', async () => {
      const { partnerAccountId, companyName } = event.data
      const supabase = createSupabaseAdminClient()

      const { data: account } = await supabase
        .from('partner_accounts')
        .select('onboarding_completed_at')
        .eq('id', partnerAccountId)
        .maybeSingle()

      if (!account) {
        console.log(`[partner-signup-reminder] Account ${partnerAccountId} not found — skipping`)
        return
      }

      if (account.onboarding_completed_at) {
        console.log(`[partner-signup-reminder] Account ${partnerAccountId} already onboarded — skipping`)
        return
      }

      const { data: owner } = await supabase
        .from('partner_admin_users')
        .select('clerk_user_id')
        .eq('partner_account_id', partnerAccountId)
        .eq('role', 'owner')
        .maybeSingle()

      if (!owner) {
        console.log(`[partner-signup-reminder] No owner resolved for account ${partnerAccountId} — skipping`)
        return
      }

      try {
        const clerkUser = await clerkClient.users.getUser(owner.clerk_user_id as string)
        const email = clerkUser.emailAddresses.find(
          (e) => e.id === clerkUser.primaryEmailAddressId,
        )?.emailAddress

        if (!email) {
          console.log(`[partner-signup-reminder] No primary email for Clerk user ${owner.clerk_user_id} — skipping`)
          return
        }

        await sendPartnerSignupReminderEmail(email, companyName)
      } catch (err) {
        // Never fail the job over an email-send/lookup error — log and continue,
        // matching this codebase's established non-fatal-side-effect convention.
        console.error(`[partner-signup-reminder] Failed to send reminder for account ${partnerAccountId}:`, err)
      }
    })
  },
)
