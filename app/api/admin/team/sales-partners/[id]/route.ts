import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * PATCH /api/admin/team/sales-partners/[id] — replace tagged partner accounts and/or flip status.
 *
 * B2B-21 Requirement Doc §6.4 — replaces the assignment set (diff insert/
 * delete) and/or flips status active⇄deactivated. `partner_account_ids`
 * cannot be reduced to empty (§10 edge case 5) — a super-admin who wants to
 * fully remove access uses Deactivate, not zero-tagging. Reactivating a
 * previously-deactivated row with a `clerk_user_id` already bound needs no
 * new invite (§10 edge case 3).
 */

const UpdateSchema = z
  .object({
    partner_account_ids: z.array(z.string().uuid()).min(1).optional(),
    status: z.enum(['active', 'deactivated']).optional(),
  })
  .refine((v) => v.partner_account_ids !== undefined || v.status !== undefined, {
    message: 'At least one of partner_account_ids or status must be provided.',
  })

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { partner_account_ids, status } = parsed.data

  const supabase = createSupabaseAdminClient()

  const { data: target, error: targetError } = await supabase
    .from('internal_admin_users')
    .select('id, role, status, clerk_user_id')
    .eq('id', params.id)
    .eq('role', 'sales_partner')
    .maybeSingle()

  if (targetError) {
    console.error('[admin/team/sales-partners/:id] Failed to load target:', targetError.message)
    return NextResponse.json({ error: 'Could not update sales-partner.' }, { status: 500 })
  }
  if (!target) {
    return NextResponse.json({ error: 'Sales-partner not found.' }, { status: 404 })
  }

  if (partner_account_ids) {
    const { data: accounts, error: accountsError } = await supabase
      .from('partner_accounts')
      .select('id')
      .in('id', partner_account_ids)

    if (accountsError) {
      console.error('[admin/team/sales-partners/:id] Failed to verify partner accounts:', accountsError.message)
      return NextResponse.json({ error: 'Could not update tagged partner accounts.' }, { status: 500 })
    }
    if ((accounts ?? []).length !== partner_account_ids.length) {
      return NextResponse.json({ error: 'Validation failed', details: 'One or more partner account ids were not found.' }, { status: 400 })
    }

    const { error: deleteError } = await supabase
      .from('sales_partner_assignments')
      .delete()
      .eq('internal_admin_user_id', params.id)

    if (deleteError) {
      console.error('[admin/team/sales-partners/:id] Failed to clear existing assignments:', deleteError.message)
      return NextResponse.json({ error: 'Could not update tagged partner accounts.' }, { status: 500 })
    }

    const { error: insertError } = await supabase.from('sales_partner_assignments').insert(
      partner_account_ids.map((partnerAccountId) => ({
        internal_admin_user_id: params.id,
        partner_account_id: partnerAccountId,
        assigned_by: admin.internalAdminUserId,
      }))
    )

    if (insertError) {
      console.error('[admin/team/sales-partners/:id] Failed to insert new assignments:', insertError.message)
      return NextResponse.json({ error: 'Could not update tagged partner accounts.' }, { status: 500 })
    }
  }

  if (status) {
    // §10 edge case 4 — reactivating a row that never accepted (no
    // clerk_user_id bound) can't be a simple status flip: resolveInternalAdmin()'s
    // lazy-bind only matches status='pending', so an 'active' row with no
    // clerk_user_id could never actually authenticate. Use "Resend invite"
    // (POST .../resend-invite) instead, which mints a fresh token.
    if (status === 'active' && !target.clerk_user_id) {
      return NextResponse.json(
        { error: 'This invite was never accepted — use Resend invite instead of Reactivate.' },
        { status: 422 }
      )
    }

    const { error: statusError } = await supabase
      .from('internal_admin_users')
      .update({ status })
      .eq('id', params.id)

    if (statusError) {
      console.error('[admin/team/sales-partners/:id] Failed to update status:', statusError.message)
      return NextResponse.json({ error: 'Could not update sales-partner status.' }, { status: 500 })
    }
  }

  return NextResponse.json({ updated: true })
}
