/**
 * PRICING-01 — Minute Bundle catalog for the "Pay as you go" top-up flow.
 * See docs/specs/PRICING-01-requirement-document.md Section 6.1 for full
 * rationale.
 *
 * Mirrors lib/billing/plan-tiers.ts's PlanTier/PLAN_TIERS pattern exactly —
 * one typed array, single source of truth, so price and minute-label can
 * never drift apart. Real, non-placeholder figures (unlike PLAN_TIERS, which
 * is explicitly still placeholder per its own header comment — this file is
 * not).
 */

export type MinuteBundleKey = 'starter' | 'growth' | 'pro' | 'scale'

export interface MinuteBundle {
  key: MinuteBundleKey
  displayName: string
  minutes: number
  priceUsd: number
}

export const MINUTE_BUNDLES: MinuteBundle[] = [
  { key: 'starter', displayName: 'Starter', minutes: 500,    priceUsd: 150 },
  { key: 'growth',  displayName: 'Growth',  minutes: 1500,   priceUsd: 450 },
  { key: 'pro',     displayName: 'Pro',     minutes: 5000,   priceUsd: 1500 },
  { key: 'scale',   displayName: 'Scale',   minutes: 10000,  priceUsd: 3000 },
]

/** Formats a bundle's button label, e.g. "500 minutes — $150". */
export function formatBundleLabel(bundle: MinuteBundle): string {
  return `${bundle.minutes.toLocaleString('en-US')} minutes — $${bundle.priceUsd.toLocaleString('en-US')}`
}
