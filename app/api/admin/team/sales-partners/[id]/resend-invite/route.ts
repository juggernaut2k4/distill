import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateInviteToken, inviteExpiresAt } from '@/lib/internal-admin/invite-tokens'
import { sendSalesPartnerInviteEmail } from '@/lib/delivery/email'

/**
 * POST /api/admin/team/sales-partners/[id]/resend-invite
 *
 * B2B-21 Requirement Doc §6.4 / §4.B State T3 — valid while clerk_user_id IS
 * NULL and status is 'pending' (still-pending invite) OR 'deactivated' (a
 * never-accepted invite that was deactivated while pending — §10 edge case
 * 4: "functionally identical to resend invite," since there's nothing to
 * merely un-deactivate; this call also flips status back to 'pending').
 * Mints a fresh token, resets expiry, resends the email. The old token
 * becomes permanently invalid (hash overwritten) — Requirement Doc §8 AT-20.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  const { data: target, error: targetError } = await supabase
    .from('internal_admin_users')
    .select('id, email, role, status, clerk_user_id')
    .eq('id', params.id)
    .eq('role', 'sales_partner')
    .maybeSingle()

  if (targetError) {
    console.error('[admin/team/sales-partners/:id/resend-invite] Failed to load target:', targetError.message)
    return NextResponse.json({ error: 'Could not resend invite.' }, { status: 500 })
  }
  if (!target) {
    return NextResponse.json({ error: 'Sales-partner not found.' }, { status: 404 })
  }
  if (target.clerk_user_id || (target.status !== 'pending' && target.status !== 'deactivated')) {
    return NextResponse.json({ error: 'This invite has already been accepted.' }, { status: 422 })
  }

  const { token, tokenHash } = generateInviteToken()
  const expiresAt = inviteExpiresAt()

  const { error: updateError } = await supabase
    .from('internal_admin_users')
    .update({ status: 'pending', invite_token_hash: tokenHash, invite_token_expires_at: expiresAt })
    .eq('id', params.id)

  if (updateError) {
    console.error('[admin/team/sales-partners/:id/resend-invite] Failed to mint new token:', updateError.message)
    return NextResponse.json({ error: 'Could not resend invite.' }, { status: 500 })
  }

  const { data: assignments } = await supabase
    .from('sales_partner_assignments')
    .select('partner_accounts(name)')
    .eq('internal_admin_user_id', params.id)

  const partnerAccountNames = ((assignments ?? []) as Array<{ partner_accounts: { name: string } | { name: string }[] | null }>).map((row) => {
    const account = Array.isArray(row.partner_accounts) ? row.partner_accounts[0] : row.partner_accounts
    return account?.name ?? ''
  })

  const { data: inviterRow } = await supabase.from('internal_admin_users').select('email').eq('id', admin.internalAdminUserId).maybeSingle()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const emailResult = await sendSalesPartnerInviteEmail(
    target.email,
    inviterRow?.email ?? 'A Clio super-admin',
    partnerAccountNames,
    `${appUrl}/invite/accept?token=${token}`
  )
  if (!emailResult.success) {
    console.error('[admin/team/sales-partners/:id/resend-invite] Invite email failed (non-blocking):', emailResult.error)
  }

  return NextResponse.json({ resent: true, email_sent: emailResult.success })
}
