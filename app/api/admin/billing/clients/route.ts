import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { computeBurnRateProjection } from '@/lib/billing/metrics'

/**
 * GET /api/admin/billing/clients
 *
 * B2B-04 Requirement Doc Section 4.B.1 — backs the `/dashboard/admin/clients`
 * cross-partner billing/health rollup.
 *
 * B2B-21 Requirement Doc §7 / §11 Q2 — this surface reads revenue/balance/
 * payment-method detail, which brushes the frozen commission topic; gated
 * super-admin-only (a sales-partner is not a valid credential here at all).
 *
 * One row per `partner_accounts` row, even for partners with no
 * `partner_wallets` row yet (a wallet is only lazily created on first credit
 * or decrement — Requirement Doc Section 9) — those partners render with
 * balance_usd=0, tier='self_serve', no payment method on file.
 *
 * Response never includes stripe_customer_id, stripe_default_payment_method_id,
 * or any other raw Stripe object id — display-ready values only.
 */

interface WalletRow {
  partner_account_id: string
  balance_usd: string | number | null
  tier: string
  next_billing_date: string | null
  stripe_default_payment_method_id: string | null
  payment_method_card_brand: string | null
  payment_method_card_last4: string | null
  payment_method_type: string | null
  created_at: string
}

interface LedgerRow {
  partner_account_id: string
  delta_usd: string | number
  created_at: string
}

export async function GET() {
  const { error } = await requireSuperAdmin()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: accounts, error: accountsError } = await supabase
    .from('partner_accounts')
    .select('id, name, status')

  if (accountsError) {
    console.error('[admin/billing/clients] Failed to load partner_accounts:', accountsError.message)
    return NextResponse.json({ error: "Couldn't load partner billing data." }, { status: 500 })
  }

  const [{ data: wallets, error: walletsError }, { data: ledgerRows, error: ledgerError }] = await Promise.all([
    supabase
      .from('partner_wallets')
      .select(
        'partner_account_id, balance_usd, tier, next_billing_date, stripe_default_payment_method_id, payment_method_card_brand, payment_method_card_last4, payment_method_type, created_at'
      ),
    supabase
      .from('wallet_ledger')
      .select('partner_account_id, delta_usd, created_at')
      .in('entry_type', ['topup_checkout', 'topup_subscription_recharge', 'topup_invoice']),
  ])

  if (walletsError || ledgerError) {
    console.error('[admin/billing/clients] Failed to load wallet/ledger data:', walletsError?.message, ledgerError?.message)
    return NextResponse.json({ error: "Couldn't load partner billing data." }, { status: 500 })
  }

  const walletsByAccount = new Map<string, WalletRow>((wallets ?? []).map((w) => [w.partner_account_id, w as WalletRow]))

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const monthStartIso = monthStart.toISOString()

  const revenueByAccount = new Map<string, { lifetime: number; period: number }>()
  for (const row of (ledgerRows ?? []) as LedgerRow[]) {
    const entry = revenueByAccount.get(row.partner_account_id) ?? { lifetime: 0, period: 0 }
    const deltaUsd = Number(row.delta_usd)
    entry.lifetime += deltaUsd
    if (row.created_at >= monthStartIso) entry.period += deltaUsd
    revenueByAccount.set(row.partner_account_id, entry)
  }

  const clients = await Promise.all(
    (accounts ?? []).map(async (account) => {
      const wallet = walletsByAccount.get(account.id)
      const balanceUsd = wallet?.balance_usd != null ? Number(wallet.balance_usd) : 0
      const revenue = revenueByAccount.get(account.id) ?? { lifetime: 0, period: 0 }

      const projection = await computeBurnRateProjection({
        partnerAccountId: account.id,
        walletCreatedAt: wallet?.created_at ?? null,
        balanceUsd,
      })

      return {
        partner_account_id: account.id,
        name: account.name,
        tier: wallet?.tier ?? 'self_serve',
        status: account.status,
        revenue_lifetime_usd: Number(revenue.lifetime.toFixed(2)),
        revenue_current_period_usd: Number(revenue.period.toFixed(2)),
        balance_usd: balanceUsd,
        avg_daily_burn_usd: projection.avg_daily_burn_usd,
        projected_days_remaining: projection.projected_days_remaining,
        days_remaining_null_reason: projection.days_remaining_null_reason,
        next_billing_date: wallet?.next_billing_date ?? null,
        payment_method_on_file: !!wallet?.stripe_default_payment_method_id,
        payment_method_card_brand: wallet?.payment_method_card_brand ?? null,
        payment_method_card_last4: wallet?.payment_method_card_last4 ?? null,
        payment_method_type: wallet?.payment_method_type ?? null,
      }
    })
  )

  return NextResponse.json({ clients })
}
