import { NextResponse } from 'next/server'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/channel-partner/demo-access
 *
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §4.A, §6.1). Reseller's own passcode existence +
 * demo-minutes balance for the "Demo access" card on `/dashboard/channel-partner/settings`. Same
 * `requireChannelPartnerAdmin()` gate as every other `/api/channel-partner/*` route — acts on the
 * caller's own account, never a client-supplied id.
 */
export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  const [{ data: passcodeRow }, { data: walletRow }] = await Promise.all([
    supabase
      .from('demo_passcodes')
      .select('created_at')
      .eq('partner_account_id', admin.partnerAccountId)
      .is('revoked_at', null)
      .maybeSingle(),
    supabase
      .from('partner_wallets')
      .select('demo_minutes_balance, demo_reference_topup_minutes')
      .eq('partner_account_id', admin.partnerAccountId)
      .maybeSingle(),
  ])

  return NextResponse.json({
    has_passcode: !!passcodeRow,
    generated_at: (passcodeRow?.created_at as string | undefined) ?? null,
    demo_minutes_balance: walletRow?.demo_minutes_balance != null ? Number(walletRow.demo_minutes_balance) : 0,
    demo_reference_topup_minutes:
      walletRow?.demo_reference_topup_minutes != null ? Number(walletRow.demo_reference_topup_minutes) : null,
  })
}
