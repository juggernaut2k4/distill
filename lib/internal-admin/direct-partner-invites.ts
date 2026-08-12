import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateInviteToken, hashInviteToken, inviteExpiresAt } from '@/lib/internal-admin/invite-tokens'
// Reused verbatim — the third reuse of this generic, role-agnostic crypto
// utility (B2B-21's own team invites, B2B-26's partner_team_invites, now
// this). Zero role-specific logic to duplicate.

/**
 * B2B-28 — direct-partner invite lifecycle (docs/specs/B2B-28-requirement-document.md §6.2).
 * A direct_partner_invites row creates a BRAND-NEW partner_accounts row on
 * acceptance (account_kind='partner') — unlike partner_team_invites, which
 * adds a member to an existing account. Reads/writes only this table; never
 * touches internal_admin_users beyond the FK it stores.
 */

export interface DirectPartnerInviteRow {
  id: string
  label: string | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired' // 'expired' is a computed read-time value, never stored (see below)
  invite_token_expires_at: string
  created_at: string
  accepted_at: string | null
  created_by_email: string
  /** B2B-80 §6.2 — which account_kind this invite produces on acceptance. */
  target_account_kind: 'partner' | 'channel_partner'
}

function computedStatus(row: { status: string; invite_token_expires_at: string }): DirectPartnerInviteRow['status'] {
  if (row.status === 'pending' && new Date(row.invite_token_expires_at) < new Date()) return 'expired'
  return row.status as DirectPartnerInviteRow['status']
}

/**
 * Lists every invite, most recent first, joined to the issuing super-admin's
 * email. 'expired' is computed at read time from status='pending' AND a
 * past invite_token_expires_at — the DB row itself keeps status='pending'
 * (a lazy read-time flip, not a stored one), matching the CEO brief's own
 * "What Success Looks Like" list of four visible states
 * (pending/accepted/expired/revoked) explicitly, unlike B2B-26's
 * partner_team_invites list (which hides expired rows entirely) — this page
 * is an audit/management surface, not a "what's actionable right now" list,
 * so expired rows stay visible with their own distinct status.
 */
export async function listDirectPartnerInvites(): Promise<DirectPartnerInviteRow[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('direct_partner_invites')
    .select('id, label, status, invite_token_expires_at, created_at, accepted_at, target_account_kind, internal_admin_users(email)')
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => {
    const creator = Array.isArray(row.internal_admin_users) ? row.internal_admin_users[0] : row.internal_admin_users
    return {
      id: row.id as string,
      label: (row.label as string | null) ?? null,
      status: computedStatus(row as { status: string; invite_token_expires_at: string }),
      invite_token_expires_at: row.invite_token_expires_at as string,
      created_at: row.created_at as string,
      accepted_at: (row.accepted_at as string | null) ?? null,
      created_by_email: (creator as { email?: string } | null)?.email ?? '',
      target_account_kind: (row.target_account_kind as 'partner' | 'channel_partner' | null) ?? 'partner',
    }
  })
}

/**
 * B2B-80 (docs/specs/B2B-80-requirement-document.md §6.2) — targetAccountKind/sourceLeadId are new,
 * optional parameters. Default 'partner' preserves this function's existing direct-partner call
 * site with zero change to its own behavior. When sourceLeadId is set, the originating
 * sales_partner_leads row is flipped to status='invited' (with invite_id set) in the same call —
 * the UI's "Invite" action expects this to happen atomically with invite creation, not as a
 * separate step.
 */
export async function issueDirectPartnerInvite(
  label: string | null,
  createdByInternalAdminUserId: string,
  targetAccountKind: 'partner' | 'channel_partner' = 'partner',
  sourceLeadId?: string
): Promise<{ success: boolean; acceptUrl: string | null; error: string | null }> {
  const supabase = createSupabaseAdminClient()
  const { token, tokenHash } = generateInviteToken()
  const expiresAt = inviteExpiresAt()

  const { data: inserted, error } = await supabase
    .from('direct_partner_invites')
    .insert({
      label,
      status: 'pending',
      invite_token_hash: tokenHash,
      invite_token_expires_at: expiresAt,
      created_by_internal_admin_user_id: createdByInternalAdminUserId,
      target_account_kind: targetAccountKind,
      source_lead_id: sourceLeadId ?? null,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    return { success: false, acceptUrl: null, error: error?.message ?? 'Failed to create invite.' }
  }

  if (sourceLeadId) {
    const { error: leadUpdateError } = await supabase
      .from('sales_partner_leads')
      .update({ status: 'invited', invite_id: inserted.id })
      .eq('id', sourceLeadId)
    if (leadUpdateError) {
      // Non-fatal — the invite itself was created successfully; only the lead's own bookkeeping
      // failed to record it, matching this file's existing no-transactional-rollback discipline
      // (markDirectPartnerInviteAccepted's own race-loss handling below is the same pattern).
      console.error(`[direct-partner-invites] Failed to flip lead ${sourceLeadId} to invited:`, leadUpdateError.message)
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  return { success: true, acceptUrl: `${appUrl}/partner-invite/accept?token=${token}`, error: null }
}

/**
 * B2B-80 (docs/specs/B2B-80-requirement-document.md §6.2) — the one new lookup the webhook's
 * accept-time branch needs: which account_kind THIS specific invite should produce. Separate from
 * lookupDirectPartnerInviteByToken (which validates token/expiry) since the webhook already has a
 * validated inviteId by the time it needs this.
 */
export async function getDirectPartnerInviteTargetKind(inviteId: string): Promise<'partner' | 'channel_partner'> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('direct_partner_invites')
    .select('target_account_kind')
    .eq('id', inviteId)
    .maybeSingle()
  return (data?.target_account_kind as 'partner' | 'channel_partner' | undefined) ?? 'partner'
}

/** Revoke — only a genuinely pending (not expired) row may be revoked. */
export async function revokeDirectPartnerInvite(inviteId: string): Promise<{ success: boolean; error: 'not_pending' | null }> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('direct_partner_invites')
    .select('status, invite_token_expires_at')
    .eq('id', inviteId)
    .maybeSingle()

  if (error || !data || computedStatus(data as { status: string; invite_token_expires_at: string }) !== 'pending') {
    return { success: false, error: 'not_pending' }
  }

  await supabase.from('direct_partner_invites').update({ status: 'revoked' }).eq('id', inviteId).eq('status', 'pending')
  return { success: true, error: null }
}

export interface InviteLookupResult {
  valid: boolean
  inviteId: string | null
}

/** Used by both the public GET lookup and the accept-time re-validation. */
export async function lookupDirectPartnerInviteByToken(token: string): Promise<InviteLookupResult> {
  const supabase = createSupabaseAdminClient()
  const tokenHash = hashInviteToken(token)
  const { data } = await supabase
    .from('direct_partner_invites')
    .select('id, status, invite_token_expires_at')
    .eq('invite_token_hash', tokenHash)
    .maybeSingle()

  if (!data || data.status !== 'pending' || new Date(data.invite_token_expires_at as string) < new Date()) {
    return { valid: false, inviteId: null }
  }
  return { valid: true, inviteId: data.id as string }
}

/**
 * Marks an invite accepted, guarded by a conditional UPDATE (WHERE
 * status='pending') so a rare concurrent-accept race can't double-consume
 * the same row. Called only AFTER createOrClaimPartnerAccount has already
 * succeeded (§6.6) — if this update affects zero rows (the race lost), the
 * partner account was still created successfully; only this table's own
 * bookkeeping fails to record which invite produced it. Logged, not
 * rolled back — matches this codebase's existing no-transactional-rollback
 * discipline (e.g. lib/partner/signup.ts's own orphaned-row handling).
 */
export async function markDirectPartnerInviteAccepted(inviteId: string, createdPartnerAccountId: string): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('direct_partner_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString(), created_partner_account_id: createdPartnerAccountId })
    .eq('id', inviteId)
    .eq('status', 'pending')
    .select('id')

  if (!data || data.length === 0) {
    console.error(`[direct-partner-invites] Invite ${inviteId} was already consumed by a concurrent request; account ${createdPartnerAccountId} was still created successfully.`)
  }
}
