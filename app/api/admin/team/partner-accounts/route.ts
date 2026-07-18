import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/admin/team/partner-accounts
 *
 * B2B-21 Requirement Doc §4.B State T1 — minimal `{id, name}` list for the
 * sales-partner tagging picker. The one genuinely new cross-partner read
 * this brief adds, deliberately minimal — no financial fields.
 * `requireSuperAdmin()` only.
 */
export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_accounts')
    .select('id, name')
    .order('name', { ascending: true })

  if (error) {
    console.error('[admin/team/partner-accounts] Failed to load partner accounts:', error.message)
    return NextResponse.json({ error: "Couldn't load partner accounts — try refreshing." }, { status: 500 })
  }

  return NextResponse.json({ partner_accounts: data ?? [] })
}
