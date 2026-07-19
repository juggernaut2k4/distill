import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-03 — Configurator Home helper (Requirement Doc Section 4.A.0/9).
 * Lists every `partner_accounts` row the given Clerk user administers
 * (via `partner_admin_users`). Returns an empty array for a Clerk user with
 * zero memberships — a real, reachable state (Section 9's edge case), not an
 * error.
 *
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.5) — this function's
 * query/filtering logic is deliberately UNCHANGED: it must keep returning
 * every membership regardless of `account_kind`, because
 * `createOrClaimPartnerAccount`'s idempotency check depends on it. Only the
 * returned shape gained the additive `account_kind` field. See
 * `getConfiguratorAccountsForClerkUser` below for the one place
 * `channel_partner`-kind accounts are filtered out.
 */
export interface AdminPartnerAccount {
  id: string
  name: string
  account_kind: 'partner' | 'channel_partner'
}

export async function getPartnerAccountsForClerkUser(clerkUserId: string): Promise<AdminPartnerAccount[]> {
  const supabase = createSupabaseAdminClient()
  const { data: memberships } = await supabase
    .from('partner_admin_users')
    .select('partner_account_id')
    .eq('clerk_user_id', clerkUserId)

  const ids = (memberships ?? []).map((m) => m.partner_account_id as string)
  if (ids.length === 0) return []

  const { data: accounts } = await supabase
    .from('partner_accounts')
    .select('id, name, account_kind')
    .in('id', ids)

  return (accounts ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    account_kind: a.account_kind as 'partner' | 'channel_partner',
  }))
}

/**
 * B2B-26 §6.5 — used ONLY by `requireChannelPartnerAdmin` (`lib/partner/auth.ts`),
 * the `/dashboard` smart router, and every `app/dashboard/channel-partner/*`
 * page's own server-side account resolution. A Clerk user administers at most
 * one `channel_partner`-kind account in practice (`createOrClaimPartnerAccount`'s
 * idempotency check guarantees a given Clerk user only ever gets ONE
 * `partner_accounts` membership total, of either kind, never both) — this
 * returns that single account or null, rather than an array, since every
 * consumer needs exactly one.
 */
export async function getChannelPartnerAccountForClerkUser(clerkUserId: string): Promise<AdminPartnerAccount | null> {
  const accounts = await getPartnerAccountsForClerkUser(clerkUserId)
  return accounts.find((a) => a.account_kind === 'channel_partner') ?? null
}

/**
 * B2B-26 §6.14 — the Configurator entry-point gate. Used ONLY by the twelve
 * Configurator entry pages (`app/dashboard/configurator/**\/page.tsx`) for
 * their own accounts/`<NoPartnerAccounts />` resolution. Deliberately NOT
 * used by `createOrClaimPartnerAccount`'s idempotency check or the
 * `/dashboard` smart router — both of those must keep treating a
 * `channel_partner` membership as a real membership. This is the one and
 * only place `account_kind` is filtered OUT of `getPartnerAccountsForClerkUser`'s
 * result; every other caller keeps using the unfiltered function directly.
 */
export async function getConfiguratorAccountsForClerkUser(clerkUserId: string): Promise<AdminPartnerAccount[]> {
  const accounts = await getPartnerAccountsForClerkUser(clerkUserId)
  return accounts.filter((a) => a.account_kind !== 'channel_partner')
}
