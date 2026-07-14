import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-03 — Configurator Home helper (Requirement Doc Section 4.A.0/9).
 * Lists every `partner_accounts` row the given Clerk user administers
 * (via `partner_admin_users`). Returns an empty array for a Clerk user with
 * zero memberships — a real, reachable state (Section 9's edge case), not an
 * error.
 */
export interface AdminPartnerAccount {
  id: string
  name: string
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
    .select('id, name')
    .in('id', ids)

  return (accounts ?? []).map((a) => ({ id: a.id as string, name: a.name as string }))
}
