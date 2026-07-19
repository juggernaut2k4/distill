import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { listClientsForChannelPartner } from '@/lib/partner/clients'
import { listTeamAndInvites } from '@/lib/partner/team-invites'

/**
 * GET/PATCH /api/admin/sales-partners/[id] — one sales-partner's full detail
 * + the editable revenue-share field.
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §6.9). `requireSuperAdmin()`
 * only. Both handlers re-verify `account_kind='channel_partner'` before
 * acting — defense-in-depth: this route only ever targets a sales-partner's
 * own account, never a direct-partner/client row, even though the DB
 * trigger (migration 088) would also reject a revenue_share_percent write on
 * the wrong kind.
 */

const UpdateRevenueShareSchema = z.object({
  revenue_share_percent: z.number().min(0).max(100).nullable(),
})

async function loadChannelPartnerAccount(id: string) {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('id, name, status, created_at, revenue_share_percent, account_kind')
    .eq('id', id)
    .maybeSingle()

  if (!data || data.account_kind !== 'channel_partner') return null
  return data
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const account = await loadChannelPartnerAccount(params.id)
  if (!account) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [clients, team] = await Promise.all([
    listClientsForChannelPartner(account.id as string),
    listTeamAndInvites(account.id as string),
  ])

  return NextResponse.json({
    sales_partner: {
      id: account.id as string,
      name: account.name as string,
      status: account.status as 'active' | 'suspended',
      created_at: account.created_at as string,
      revenue_share_percent: (account.revenue_share_percent as number | null) ?? null,
    },
    clients,
    team: {
      active_count: team.members.length,
      pending_count: team.pendingInvites.length,
    },
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const account = await loadChannelPartnerAccount(params.id)
  if (!account) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 422 })
  }

  const parsed = UpdateRevenueShareSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a value between 0 and 100.', details: parsed.error.flatten() }, { status: 422 })
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('partner_accounts')
    .update({ revenue_share_percent: parsed.data.revenue_share_percent })
    .eq('id', params.id)
    .eq('account_kind', 'channel_partner')

  if (error) {
    console.error('[admin/sales-partners/[id]] Failed to update revenue_share_percent:', error.message)
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 })
  }

  return NextResponse.json({ success: true, revenue_share_percent: parsed.data.revenue_share_percent })
}
