import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin, internalAdminErrorEnvelope } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateInviteToken, inviteExpiresAt } from '@/lib/internal-admin/invite-tokens'
import { sendSalesPartnerInviteEmail } from '@/lib/delivery/email'

/**
 * GET  /api/admin/team/sales-partners  — list every role='sales_partner' row + tagged partner accounts.
 * POST /api/admin/team/sales-partners  — invite a new sales-partner (email + ≥1 partner account ids).
 *
 * B2B-21 Requirement Doc §6.4 / §4.B State T3. `requireSuperAdmin()` only.
 */

const InviteSchema = z.object({
  email: z.string().trim().email(),
  partner_account_ids: z.array(z.string().uuid()).min(1),
})

function acceptUrlFor(token: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  return `${appUrl}/invite/accept?token=${token}`
}

export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data: rows, error } = await supabase
    .from('internal_admin_users')
    .select('id, email, status, invited_at, accepted_at, clerk_user_id')
    .eq('role', 'sales_partner')
    .order('invited_at', { ascending: true })

  if (error) {
    console.error('[admin/team/sales-partners] Failed to load sales-partners:', error.message)
    return NextResponse.json({ error: "Couldn't load sales-partners." }, { status: 500 })
  }

  const salesPartnerIds = (rows ?? []).map((r) => r.id as string)
  const assignmentsByAdmin = new Map<string, Array<{ partner_account_id: string; name: string }>>()

  if (salesPartnerIds.length > 0) {
    const { data: assignments } = await supabase
      .from('sales_partner_assignments')
      .select('internal_admin_user_id, partner_account_id, partner_accounts(name)')
      .in('internal_admin_user_id', salesPartnerIds)

    for (const row of (assignments ?? []) as Array<{
      internal_admin_user_id: string
      partner_account_id: string
      partner_accounts: { name: string } | { name: string }[] | null
    }>) {
      const account = Array.isArray(row.partner_accounts) ? row.partner_accounts[0] : row.partner_accounts
      const list = assignmentsByAdmin.get(row.internal_admin_user_id) ?? []
      list.push({ partner_account_id: row.partner_account_id, name: account?.name ?? '' })
      assignmentsByAdmin.set(row.internal_admin_user_id, list)
    }
  }

  const salesPartners = (rows ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status,
    invited_at: row.invited_at,
    accepted_at: row.accepted_at,
    // §10 edge case 4 — the client uses this (not clerk_user_id itself) to
    // decide whether a deactivated row's action is "Reactivate" (already
    // bound, §10 edge case 3) or "Resend invite" (never accepted, a fresh
    // token is required — nothing to merely un-deactivate).
    has_accepted: row.clerk_user_id !== null,
    partner_accounts: assignmentsByAdmin.get(row.id as string) ?? [],
  }))

  return NextResponse.json({ sales_partners: salesPartners })
}

export async function POST(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = InviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { email, partner_account_ids } = parsed.data

  const supabase = createSupabaseAdminClient()

  const { data: existing } = await supabase
    .from('internal_admin_users')
    .select('id')
    .ilike('email', email)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(internalAdminErrorEnvelope('already_exists', 'This email already has an internal-admin role.'), { status: 409 })
  }

  const { data: accounts, error: accountsError } = await supabase
    .from('partner_accounts')
    .select('id, name')
    .in('id', partner_account_ids)

  if (accountsError) {
    console.error('[admin/team/sales-partners] Failed to verify partner accounts:', accountsError.message)
    return NextResponse.json({ error: "Couldn't create the invite." }, { status: 500 })
  }
  if ((accounts ?? []).length !== partner_account_ids.length) {
    return NextResponse.json({ error: 'Validation failed', details: 'One or more partner account ids were not found.' }, { status: 400 })
  }

  const { token, tokenHash } = generateInviteToken()
  const expiresAt = inviteExpiresAt()

  const { data: created, error: insertError } = await supabase
    .from('internal_admin_users')
    .insert({
      email,
      role: 'sales_partner',
      status: 'pending',
      invited_by: admin.internalAdminUserId,
      invite_token_hash: tokenHash,
      invite_token_expires_at: expiresAt,
    })
    .select('id, email, status, invited_at')
    .single()

  if (insertError || !created) {
    console.error('[admin/team/sales-partners] Failed to create sales-partner:', insertError?.message)
    return NextResponse.json(internalAdminErrorEnvelope('already_exists', 'This email already has an internal-admin role.'), { status: 409 })
  }

  const assignmentRows = partner_account_ids.map((partnerAccountId) => ({
    internal_admin_user_id: created.id,
    partner_account_id: partnerAccountId,
    assigned_by: admin.internalAdminUserId,
  }))
  const { error: assignError } = await supabase.from('sales_partner_assignments').insert(assignmentRows)
  if (assignError) {
    console.error('[admin/team/sales-partners] Failed to create partner-account assignments:', assignError.message)
    return NextResponse.json({ error: "Couldn't tag partner accounts to this invite." }, { status: 500 })
  }

  const { data: inviterRow } = await supabase.from('internal_admin_users').select('email').eq('id', admin.internalAdminUserId).maybeSingle()
  const emailResult = await sendSalesPartnerInviteEmail(
    email,
    inviterRow?.email ?? 'A Clio super-admin',
    (accounts ?? []).map((a) => a.name as string),
    acceptUrlFor(token)
  )
  if (!emailResult.success) {
    console.error('[admin/team/sales-partners] Invite email failed (non-blocking):', emailResult.error)
  }

  return NextResponse.json({ sales_partner: created, email_sent: emailResult.success }, { status: 201 })
}
