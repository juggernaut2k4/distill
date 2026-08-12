import { createSupabaseAdminClient } from '@/lib/supabase'
import { resolveEffectiveRate } from './webhooks'
import { TRIAL_MINUTES_LIFETIME_CAP } from '@/lib/billing/trial-minutes'

/**
 * B2B-70 (docs/specs/B2B-70-requirement-document.md §6.5) — new, standalone wallet-gate helper.
 *
 * app/api/partner/v1/sessions/route.ts (the existing, do-not-touch meeting-bot session-creation
 * route) inlines its own card-required/trial-exhausted/funding-required/balance-exhausted logic
 * directly in the route file — it is not an importable function today. Since that file must not be
 * modified, this is a NEW, separately-written helper that only the new widget-sessions route
 * imports, deliberately mirroring the existing route's exact semantics/status codes rather than
 * inventing a new gate model. The existing route's own inlined logic is left completely untouched
 * (same behavior, same file, same tests).
 */

export type WalletGateResult =
  | { status: 'ok'; availableMinutes: number | null; affordableMinutes: number | null }
  | { status: 'card_required' }
  | { status: 'trial_exhausted' }
  | { status: 'funding_required' }
  | { status: 'balance_exhausted' }

/**
 * Test-mode gate: card-on-file prerequisite (checked before trial-minutes math, no grandfathering —
 * mirrors the existing route's B2B-27 guardrail), then trial/test-minutes availability. Returns
 * `availableMinutes` on success — the same figure the existing route computes and passes to
 * `clio/partner-trial.started`.
 */
async function resolveTestModeWalletGate(partnerAccountId: string): Promise<WalletGateResult> {
  const supabase = createSupabaseAdminClient()
  // Array fetch + [0] — .maybeSingle() confirmed unreliable on this Supabase project (see the
  // existing sessions route's own identical comment); this is a billing gate, priority fix pattern
  // applied here from the start rather than retrofitted.
  const { data: walletRows } = await supabase
    .from('partner_wallets')
    .select('trial_minutes_used, test_minutes_balance, stripe_default_payment_method_id')
    .eq('partner_account_id', partnerAccountId)
    .limit(1)

  const wallet = walletRows?.[0] ?? null

  if (!wallet?.stripe_default_payment_method_id) {
    return { status: 'card_required' }
  }

  const trialMinutesUsed = wallet ? Number(wallet.trial_minutes_used) : 0
  const testMinutesBalance = wallet ? Number(wallet.test_minutes_balance) : 0
  const availableMinutes = Math.max(0, TRIAL_MINUTES_LIFETIME_CAP - trialMinutesUsed) + testMinutesBalance

  if (availableMinutes <= 0) {
    return { status: 'trial_exhausted' }
  }

  return { status: 'ok', availableMinutes, affordableMinutes: null }
}

/**
 * Live-mode gate: funding prerequisite, then (since every widget session always has a resolvable
 * `expected_duration_minutes` from its container, unlike the existing route's Option-2-vs-inline
 * split) the balance-vs-expected-duration check runs unconditionally — mirroring the existing
 * route's own inline-sessions-only branch, since a widget session is always "inline-shaped."
 */
async function resolveLiveModeWalletGate(partnerAccountId: string, expectedDurationMinutes: number): Promise<WalletGateResult> {
  const supabase = createSupabaseAdminClient()
  const { data: liveWalletRows } = await supabase
    .from('partner_wallets')
    .select('stripe_default_payment_method_id, balance_usd')
    .eq('partner_account_id', partnerAccountId)
    .limit(1)

  const wallet = liveWalletRows?.[0] ?? null

  if (!wallet || !wallet.stripe_default_payment_method_id) {
    return { status: 'funding_required' }
  }

  const rate = await resolveEffectiveRate(partnerAccountId, 'voice_minute', new Date().toISOString())
  // No configured rate → there is no per-minute cost to enforce; do not over-block, mirroring the
  // existing route's own "Requirement Doc Req 3.1" reasoning exactly.
  if (!rate || rate.rate_usd <= 0) {
    return { status: 'ok', availableMinutes: null, affordableMinutes: null }
  }

  const balance = Number(wallet.balance_usd ?? 0)
  if (balance < expectedDurationMinutes * rate.rate_usd) {
    return { status: 'balance_exhausted' }
  }

  const affordableMinutes = Math.floor(balance / rate.rate_usd)
  return { status: 'ok', availableMinutes: null, affordableMinutes }
}

/** Single entry point the widget-sessions route calls — dispatches to the test- or live-mode gate. */
export async function resolveWalletGate(
  partnerAccountId: string,
  mode: 'test' | 'live',
  expectedDurationMinutes: number
): Promise<WalletGateResult> {
  return mode === 'test'
    ? resolveTestModeWalletGate(partnerAccountId)
    : resolveLiveModeWalletGate(partnerAccountId, expectedDurationMinutes)
}
