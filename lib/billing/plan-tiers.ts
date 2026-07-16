/**
 * B2B-13 — Recurring Plan Tiers catalog.
 * See docs/specs/B2B-13-requirement-document.md Section 6.B for full rationale.
 *
 * This is the single source of truth for Plan tier pricing and included
 * allowance — both the wizard's Payment step display AND the Stripe webhook
 * handler's wallet-credit logic import this same module, so what's shown to
 * a partner-admin and what actually gets credited to their wallet can never
 * drift apart.
 *
 * All figures below are PLACEHOLDER illustrative numbers, not real prices.
 * Arun creates the real Stripe Products/Prices in his own dashboard and sets
 * the env vars named below (see .env.local.example) — no code change needed
 * on his end beyond that. This file must never call
 * stripe.products.create / stripe.prices.create.
 */

export type PlanTierKey = 'starter' | 'growth'
export type PlanBillingPeriod = 'monthly' | 'annual'

export interface PlanTier {
  key: PlanTierKey
  displayName: string
  monthlyPriceUsd: number
  annualPriceUsd: number
  /** Credited on invoice.paid for a MONTHLY-billed subscription's invoice. */
  includedAllowanceUsdMonthly: number
  /**
   * Credited on invoice.paid for an ANNUAL-billed subscription's invoice
   * (once/year — NOT the monthly figure re-applied 12x, since Stripe only
   * fires one invoice.paid per year for an annual subscription). Deliberately
   * exactly 12x includedAllowanceUsdMonthly so an annual subscriber's usage
   * headroom matches a monthly subscriber's, dollar for dollar — only the
   * price gets the prepay discount, not the allowance (Requirement Document
   * Section 9, "Annual Plan allowance vs. monthly run-rate").
   */
  includedAllowanceUsdAnnual: number
  stripePriceIdMonthlyEnvVar: string
  stripePriceIdAnnualEnvVar: string
}

// PLACEHOLDER figures — illustrative only, Arun sets real prices in Stripe and
// these numbers are updated to match at that time. Annual prices are ~20% off
// the equivalent 12x monthly cost (standard SaaS annual-prepay discount);
// annual included-allowance figures are exactly 12x the monthly allowance, so
// an annual subscriber's usage headroom matches a monthly subscriber's,
// dollar for dollar — only the price gets the prepay discount, not the
// allowance.
export const PLAN_TIERS: PlanTier[] = [
  {
    key: 'starter',
    displayName: 'Starter',
    monthlyPriceUsd: 99,
    annualPriceUsd: 950,
    includedAllowanceUsdMonthly: 50,
    includedAllowanceUsdAnnual: 600, // 50 * 12 = 600
    stripePriceIdMonthlyEnvVar: 'STRIPE_PLAN_STARTER_MONTHLY_PRICE_ID',
    stripePriceIdAnnualEnvVar: 'STRIPE_PLAN_STARTER_ANNUAL_PRICE_ID',
  },
  {
    key: 'growth',
    displayName: 'Growth',
    monthlyPriceUsd: 299,
    annualPriceUsd: 2870,
    includedAllowanceUsdMonthly: 200,
    includedAllowanceUsdAnnual: 2400, // 200 * 12 = 2400
    stripePriceIdMonthlyEnvVar: 'STRIPE_PLAN_GROWTH_MONTHLY_PRICE_ID',
    stripePriceIdAnnualEnvVar: 'STRIPE_PLAN_GROWTH_ANNUAL_PRICE_ID',
  },
]

/** Looks up a tier by its catalog key. Returns undefined for an unrecognized key (catalog drift / defensive callers). */
export function getPlanTier(key: string): PlanTier | undefined {
  return PLAN_TIERS.find((tier) => tier.key === key)
}

/** Resolves the fixed dollar amount to credit a partner's wallet for one invoice.paid on a given tier + billing period. */
export function getIncludedAllowanceUsd(tier: PlanTier, billingPeriod: PlanBillingPeriod): number {
  return billingPeriod === 'annual' ? tier.includedAllowanceUsdAnnual : tier.includedAllowanceUsdMonthly
}

/** Resolves the display price (not multiplied/divided) for a given tier + billing period. */
export function getPlanPriceUsd(tier: PlanTier, billingPeriod: PlanBillingPeriod): number {
  return billingPeriod === 'annual' ? tier.annualPriceUsd : tier.monthlyPriceUsd
}
