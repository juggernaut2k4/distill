import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { DEMO_ADMIN_PARTNER_ACCOUNT_ID } from '@/lib/demo/passcode-accounts'

/**
 * GET /api/admin/demo-access
 *
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §4.B, §6.5). Admin's own passcode existence +
 * demo-minutes balance for the "Your demo access" card on `/dashboard/admin/sales-partners`.
 * `requireSuperAdmin()`-gated, hardcoded to the "Clio Internal — Public Demo" sentinel account — no
 * `account_id` parameter, matching the reseller route's shape but with a fixed target.
 */
export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  const [{ data: passcodeRow }, { data: walletRow }] = await Promise.all([
    supabase
      .from('demo_passcodes')
      .select('created_at')
      .eq('partner_account_id', DEMO_ADMIN_PARTNER_ACCOUNT_ID)
      .is('revoked_at', null)
      .maybeSingle(),
    supabase
      .from('partner_wallets')
      .select('demo_minutes_balance, demo_reference_topup_minutes')
      .eq('partner_account_id', DEMO_ADMIN_PARTNER_ACCOUNT_ID)
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
