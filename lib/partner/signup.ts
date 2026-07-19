import { createSupabaseAdminClient } from '@/lib/supabase'
import { getPartnerAccountsForClerkUser } from './admin-accounts'
import { sendPartnerSignupWelcomeEmail } from '@/lib/delivery/email'
import { inngest } from '@/inngest/client'

/**
 * B2B-25 — Remove Clerk Organizations from Partner Signup
 * (docs/specs/B2B-25-requirement-document.md §6.2).
 */

export interface ClaimResult {
  success: boolean
  alreadyMember: boolean
  partnerAccountId: string | null
  error: string | null
}

/**
 * Creates a partner_accounts + partner_admin_users (role='owner') pair for a
 * Clerk user, or no-ops if they already administer a partner account.
 * Called from two places: the unsafeMetadata branch in the `user.created`
 * webhook (§6.3, keyed off the newly-created Clerk user id) and the
 * authenticated claim route (§6.4, keyed off an existing session's userId).
 * Idempotent: never creates a second partner_accounts row for a Clerk user
 * who already administers one.
 */
export async function createOrClaimPartnerAccount(
  clerkUserId: string,
  companyName: string,
  email: string
): Promise<ClaimResult> {
  const existing = await getPartnerAccountsForClerkUser(clerkUserId)
  if (existing.length > 0) {
    return { success: true, alreadyMember: true, partnerAccountId: existing[0].id, error: null }
  }

  const supabase = createSupabaseAdminClient()
  const { data: account, error: acctError } = await supabase
    .from('partner_accounts')
    .insert({ name: companyName, archetype: 'unspecified', status: 'active' })
    .select('id')
    .single()

  if (acctError || !account) {
    return { success: false, alreadyMember: false, partnerAccountId: null, error: acctError?.message ?? 'partner_accounts insert failed' }
  }

  const { error: adminError } = await supabase
    .from('partner_admin_users')
    .insert({ clerk_user_id: clerkUserId, partner_account_id: account.id, role: 'owner' })

  if (adminError) {
    // Orphaned partner_accounts row with no owner — same accepted, logged
    // edge case as the webhook-only design (§8), now reachable from either
    // write path. Not auto-rolled-back (no existing transactional discipline
    // in this codebase to match, per §8's original reasoning).
    return { success: false, alreadyMember: false, partnerAccountId: account.id, error: adminError.message }
  }

  inngest
    .send({ name: 'clio/partner-account.created', data: { partnerAccountId: account.id, companyName, createdAt: new Date().toISOString() } })
    .catch((err: unknown) => console.error('[partner-signup] Failed to emit clio/partner-account.created:', err))

  await sendPartnerSignupWelcomeEmail(email, companyName).catch(
    (err: unknown) => console.error('[partner-signup] sendPartnerSignupWelcomeEmail failed:', err)
  )

  return { success: true, alreadyMember: false, partnerAccountId: account.id, error: null }
}
