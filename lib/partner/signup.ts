import { createSupabaseAdminClient } from '@/lib/supabase'
import { getPartnerAccountsForClerkUser } from './admin-accounts'
import { sendPartnerSignupWelcomeEmail } from '@/lib/delivery/email'
import { inngest } from '@/inngest/client'

/**
 * B2B-25 — Remove Clerk Organizations from Partner Signup
 * (docs/specs/B2B-25-requirement-document.md §6.2).
 * B2B-26 — extended (not forked) to accept an `accountKind` discriminator
 * (docs/specs/B2B-26-requirement-document.md §6.2).
 */

export interface ClaimResult {
  success: boolean
  alreadyMember: boolean
  partnerAccountId: string | null
  accountKind: 'partner' | 'channel_partner' | null
  error: string | null
}

/**
 * Creates a partner_accounts + partner_admin_users (role='owner') pair for a
 * Clerk user, or no-ops if they already administer a partner account.
 * Called from three places (B2B-28 adds the third): the unsafeMetadata
 * branch in the `user.created` webhook (§6.3, keyed off the newly-created
 * Clerk user id — both the /partner-signup signup_intent='partner' branch,
 * always accountKind='channel_partner' as of B2B-28, and the new
 * signup_intent='direct_partner_invite' branch, always accountKind='partner'),
 * and the two authenticated claim routes (§6.4's /api/partner-signup/claim
 * and, new in B2B-28, /api/partner-invite/accept). Idempotent: never creates
 * a second partner_accounts row for a Clerk user who already administers one.
 *
 * B2B-26 §6.2/§9 Edge Case 2 — when the caller already administers an
 * account (`alreadyMember: true`), the account's ACTUAL `account_kind` is
 * always returned, never the `accountKind` requested on this call. This
 * matters for the redirect-correctness case: an existing direct partner who
 * revisits `/partner-signup` and clicks "Yes" by mistake must be redirected
 * based on their real account kind, not the toggle's momentary value.
 */
export async function createOrClaimPartnerAccount(
  clerkUserId: string,
  companyName: string,
  email: string,
  accountKind: 'partner' | 'channel_partner' = 'partner'
): Promise<ClaimResult> {
  const existing = await getPartnerAccountsForClerkUser(clerkUserId)
  if (existing.length > 0) {
    return { success: true, alreadyMember: true, partnerAccountId: existing[0].id, accountKind: existing[0].account_kind, error: null }
  }

  const supabase = createSupabaseAdminClient()
  const { data: account, error: acctError } = await supabase
    .from('partner_accounts')
    .insert({ name: companyName, archetype: 'unspecified', status: 'active', account_kind: accountKind })
    .select('id, account_kind')
    .single()

  if (acctError || !account) {
    return { success: false, alreadyMember: false, partnerAccountId: null, accountKind: null, error: acctError?.message ?? 'partner_accounts insert failed' }
  }

  const resolvedAccountKind = account.account_kind as 'partner' | 'channel_partner'

  const { error: adminError } = await supabase
    .from('partner_admin_users')
    .insert({ clerk_user_id: clerkUserId, partner_account_id: account.id, role: 'owner' })

  if (adminError) {
    // Orphaned partner_accounts row with no owner — same accepted, logged
    // edge case as the webhook-only design (§8), now reachable from either
    // write path. Not auto-rolled-back (no existing transactional discipline
    // in this codebase to match, per §8's original reasoning).
    return { success: false, alreadyMember: false, partnerAccountId: account.id as string, accountKind: resolvedAccountKind, error: adminError.message }
  }

  // Unchanged — fires identically regardless of accountKind. accountKind is
  // additive on the payload so inngest/partner-signup-reminder.ts can skip
  // sales-partner accounts (§6.10).
  inngest
    .send({
      name: 'clio/partner-account.created',
      data: { partnerAccountId: account.id, companyName, accountKind: resolvedAccountKind, createdAt: new Date().toISOString() },
    })
    .catch((err: unknown) => console.error('[partner-signup] Failed to emit clio/partner-account.created:', err))

  await sendPartnerSignupWelcomeEmail(email, companyName).catch(
    (err: unknown) => console.error('[partner-signup] sendPartnerSignupWelcomeEmail failed:', err)
  )

  return { success: true, alreadyMember: false, partnerAccountId: account.id as string, accountKind: resolvedAccountKind, error: null }
}
