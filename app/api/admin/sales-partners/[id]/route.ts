import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { listClientsForChannelPartner } from '@/lib/partner/clients'
import { listTeamAndInvites } from '@/lib/partner/team-invites'

/**
 * GET /api/admin/sales-partners/[id] — one sales-partner's full detail.
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §6.9). `requireSuperAdmin()`
 * only. Re-verifies `account_kind='channel_partner'` before returning —
 * defense-in-depth so this route never targets a direct-partner/client row.
 */

async function loadChannelPartnerAccount(id: string) {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('id, name, status, created_at, account_kind')
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
    },
    clients,
    team: {
      active_count: team.members.length,
      pending_count: team.pendingInvites.length,
    },
  })
}
