import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/admin/sales-partners — the sales-partner roster.
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §6.9). `requireSuperAdmin()`
 * only — this is the exact enforcement mechanism that keeps
 * `revenue_share_percent` out of a sales-partner's own reach (§6.9's
 * "Enforcement statement").
 */
export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data: accounts, error } = await supabase
    .from('partner_accounts')
    .select('id, name, status, created_at, revenue_share_percent')
    .eq('account_kind', 'channel_partner')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[admin/sales-partners] Failed to load sales-partners:', error.message)
    return NextResponse.json({ error: "Couldn't load sales-partner data. Try refreshing the page." }, { status: 500 })
  }

  const ids = (accounts ?? []).map((a) => a.id as string)

  const [clientCounts, teamCounts] = await Promise.all([
    ids.length > 0
      ? supabase.from('partner_accounts').select('owning_channel_partner_id').in('owning_channel_partner_id', ids)
      : Promise.resolve({ data: [] as Array<{ owning_channel_partner_id: string | null }> }),
    ids.length > 0
      ? supabase.from('partner_admin_users').select('partner_account_id').in('partner_account_id', ids)
      : Promise.resolve({ data: [] as Array<{ partner_account_id: string }> }),
  ])

  const clientCountById = new Map<string, number>()
  for (const row of clientCounts.data ?? []) {
    const key = row.owning_channel_partner_id as string
    clientCountById.set(key, (clientCountById.get(key) ?? 0) + 1)
  }

  const teamCountById = new Map<string, number>()
  for (const row of teamCounts.data ?? []) {
    const key = row.partner_account_id as string
    teamCountById.set(key, (teamCountById.get(key) ?? 0) + 1)
  }

  const salesPartners = (accounts ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    status: row.status as 'active' | 'suspended',
    created_at: row.created_at as string,
    revenue_share_percent: (row.revenue_share_percent as number | null) ?? null,
    client_count: clientCountById.get(row.id as string) ?? 0,
    team_count: teamCountById.get(row.id as string) ?? 0,
  }))

  return NextResponse.json({ sales_partners: salesPartners })
}
