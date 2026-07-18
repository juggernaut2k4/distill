import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { auth as clerkAuth, currentUser as clerkCurrentUser } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-21 — Internal Admin Identity (Requirement Doc §6.2).
 *
 * A new, orthogonal identity layer for Clio's OWN internal team
 * (`internal_admin_users` / `sales_partner_assignments`), parallel to but
 * structurally separate from `lib/partner/auth.ts`'s `requirePartnerAdmin`
 * (a partner's own staff, scoped to that one partner's own account). This
 * file never reads or writes `partner_admin_users` and is never a valid
 * credential path for partner-scoped routes.
 *
 * Same Clerk instance for identity; role resolved from `internal_admin_users`.
 * Internal operators are explicitly NOT placed into Clerk Organizations or
 * `partner_admin_users`.
 */

function errorEnvelope(code: string, message: string) {
  return { error: { code, message, request_id: crypto.randomUUID() } }
}

export type InternalAdminResult =
  | { role: 'super_admin'; clerkUserId: string; internalAdminUserId: string; scopedPartnerAccountIds: null; error: null }
  | { role: 'sales_partner'; clerkUserId: string; internalAdminUserId: string; scopedPartnerAccountIds: string[]; error: null }
  | { role: null; clerkUserId: null; internalAdminUserId: null; scopedPartnerAccountIds: null; error: NextResponse }

interface InternalAdminUserRow {
  id: string
  clerk_user_id: string | null
  role: 'super_admin' | 'sales_partner'
  status: 'pending' | 'active' | 'deactivated'
  email: string
}

async function scopedPartnerAccountIdsFor(internalAdminUserId: string, supabase: ReturnType<typeof createSupabaseAdminClient>): Promise<string[]> {
  const { data } = await supabase
    .from('sales_partner_assignments')
    .select('partner_account_id')
    .eq('internal_admin_user_id', internalAdminUserId)
  return (data ?? []).map((row) => row.partner_account_id as string)
}

/**
 * Resolves the current Clerk session to an internal-admin role, lazily
 * binding `clerk_user_id` on first authenticated request after an invite
 * (super-admin) or accepted-invite acceptance (sales-partner) — see §6.2
 * point 5. 401 if no Clerk session at all; 403 if the session is valid but
 * has no matching `internal_admin_users` row (or a deactivated one).
 *
 * Deliberately does NOT hook into the legacy B2C `user.created` webhook
 * (`app/api/webhooks/clerk/route.ts`) — this is a plain per-request DB
 * check, self-healing regardless of signup order, mirroring
 * `requirePartnerAdmin`'s own model exactly.
 */
export async function resolveInternalAdmin(): Promise<InternalAdminResult> {
  const { userId } = clerkAuth()
  if (!userId) {
    return {
      role: null,
      clerkUserId: null,
      internalAdminUserId: null,
      scopedPartnerAccountIds: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const supabase = createSupabaseAdminClient()

  const { data: boundRow } = await supabase
    .from('internal_admin_users')
    .select('id, clerk_user_id, role, status, email')
    .eq('clerk_user_id', userId)
    .neq('status', 'deactivated')
    .maybeSingle()

  const row = boundRow as InternalAdminUserRow | null

  if (row) {
    // §6.2 point 4 — a row is never 'pending' again after its first bind;
    // 'pending' here (with clerk_user_id already set) is treated as active.
    if (row.role === 'super_admin') {
      return { role: 'super_admin', clerkUserId: userId, internalAdminUserId: row.id, scopedPartnerAccountIds: null, error: null }
    }
    const scopedPartnerAccountIds = await scopedPartnerAccountIdsFor(row.id, supabase)
    return { role: 'sales_partner', clerkUserId: userId, internalAdminUserId: row.id, scopedPartnerAccountIds, error: null }
  }

  // Not found by clerk_user_id — attempt a lazy bind by verified primary email.
  const clerkUser = await clerkCurrentUser()
  const primaryEmailEntry = clerkUser?.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
  const isVerified = primaryEmailEntry?.verification?.status === 'verified'
  const primaryEmail = isVerified ? primaryEmailEntry?.emailAddress : null

  if (primaryEmail) {
    const { data: pendingRow } = await supabase
      .from('internal_admin_users')
      .select('id, clerk_user_id, role, status, email')
      .ilike('email', primaryEmail)
      .is('clerk_user_id', null)
      .eq('status', 'pending')
      .maybeSingle()

    if (pendingRow) {
      const { error: bindError } = await supabase
        .from('internal_admin_users')
        .update({ clerk_user_id: userId, status: 'active', accepted_at: new Date().toISOString() })
        .eq('id', pendingRow.id)

      if (!bindError) {
        const boundRole = pendingRow.role as 'super_admin' | 'sales_partner'
        if (boundRole === 'super_admin') {
          return { role: 'super_admin', clerkUserId: userId, internalAdminUserId: pendingRow.id, scopedPartnerAccountIds: null, error: null }
        }
        const scopedPartnerAccountIds = await scopedPartnerAccountIdsFor(pendingRow.id, supabase)
        return { role: 'sales_partner', clerkUserId: userId, internalAdminUserId: pendingRow.id, scopedPartnerAccountIds, error: null }
      }
      console.error('[internal-admin/auth] Failed to lazy-bind internal_admin_users row:', bindError.message)
    }
  }

  return {
    role: null,
    clerkUserId: null,
    internalAdminUserId: null,
    scopedPartnerAccountIds: null,
    error: NextResponse.json(errorEnvelope('forbidden', 'You do not have internal admin access.'), { status: 403 }),
  }
}

/**
 * Requires an active super-admin. Overwrites a resolved sales-partner result
 * with a 403 — super-admin surfaces are never sales-partner-visible.
 */
export async function requireSuperAdmin(): Promise<InternalAdminResult> {
  const result = await resolveInternalAdmin()
  if (result.error) return result
  if (result.role === 'sales_partner') {
    return {
      role: null,
      clerkUserId: null,
      internalAdminUserId: null,
      scopedPartnerAccountIds: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'Super-admin access required.'), { status: 403 }),
    }
  }
  return result
}

/**
 * Requires either an active super-admin or an active sales-partner. Does
 * NOT itself reject a sales-partner whose `scopedPartnerAccountIds` doesn't
 * include `partnerAccountId` — some callers (e.g. glitches list) need to
 * *filter* rather than *reject*. When `partnerAccountId` IS supplied, this
 * convenience overload 403s immediately if it's out of scope, for
 * single-account routes (§6.2).
 */
export async function requireInternalAdmin(partnerAccountId?: string): Promise<InternalAdminResult> {
  const result = await resolveInternalAdmin()
  if (result.error) return result

  if (partnerAccountId && result.role === 'sales_partner' && !result.scopedPartnerAccountIds.includes(partnerAccountId)) {
    return {
      role: null,
      clerkUserId: null,
      internalAdminUserId: null,
      scopedPartnerAccountIds: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'This partner account is outside your assigned scope.'), { status: 403 }),
    }
  }

  return result
}

export { errorEnvelope as internalAdminErrorEnvelope }
