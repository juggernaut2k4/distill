import { describe, it, expect } from 'vitest'
import { PLAN_TIERS, getPlanTier, getIncludedAllowanceUsd, getPlanPriceUsd } from '@/lib/billing/plan-tiers'

/**
 * B2B-13 — lib/billing/plan-tiers.ts catalog tests.
 * See docs/specs/B2B-13-requirement-document.md Section 7/9 — the CEO review
 * that produced v1.1 specifically flagged an under-crediting bug risk where
 * annual allowance figures could drift from 12x the monthly figure. These
 * tests are the bug-fix verification the developer instructions call out.
 */

describe('PLAN_TIERS catalog', () => {
  it('has exactly the two catalog-approved tiers: starter, growth', () => {
    expect(PLAN_TIERS.map((t) => t.key)).toEqual(['starter', 'growth'])
  })

  it('every tier has a non-empty display name and positive prices/allowances', () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.displayName.length).toBeGreaterThan(0)
      expect(tier.monthlyPriceUsd).toBeGreaterThan(0)
      expect(tier.annualPriceUsd).toBeGreaterThan(0)
      expect(tier.includedAllowanceUsdMonthly).toBeGreaterThan(0)
      expect(tier.includedAllowanceUsdAnnual).toBeGreaterThan(0)
    }
  })

  it('annual included allowance is exactly 12x the monthly included allowance, for every tier', () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.includedAllowanceUsdAnnual).toBe(tier.includedAllowanceUsdMonthly * 12)
    }
  })

  it('starter: monthly allowance $50, annual allowance $600 (12x)', () => {
    const starter = getPlanTier('starter')!
    expect(starter.includedAllowanceUsdMonthly).toBe(50)
    expect(starter.includedAllowanceUsdAnnual).toBe(600)
  })

  it('growth: monthly allowance $200, annual allowance $2400 (12x)', () => {
    const growth = getPlanTier('growth')!
    expect(growth.includedAllowanceUsdMonthly).toBe(200)
    expect(growth.includedAllowanceUsdAnnual).toBe(2400)
  })

  it('annual price is less than 12x the monthly price (prepay discount applies to price only, not allowance)', () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.annualPriceUsd).toBeLessThan(tier.monthlyPriceUsd * 12)
    }
  })

  it('every tier has distinct, non-empty env var names for monthly/annual price ids', () => {
    const envVarNames = PLAN_TIERS.flatMap((t) => [t.stripePriceIdMonthlyEnvVar, t.stripePriceIdAnnualEnvVar])
    expect(new Set(envVarNames).size).toBe(envVarNames.length)
    for (const name of envVarNames) {
      expect(name.startsWith('STRIPE_PLAN_')).toBe(true)
    }
  })
})

describe('getPlanTier', () => {
  it('returns the matching tier for a valid key', () => {
    expect(getPlanTier('growth')?.displayName).toBe('Growth')
  })

  it('returns undefined for an unrecognized key (catalog drift / defensive callers)', () => {
    expect(getPlanTier('enterprise')).toBeUndefined()
    expect(getPlanTier('')).toBeUndefined()
  })
})

describe('getIncludedAllowanceUsd', () => {
  it('resolves the monthly figure for billingPeriod=monthly', () => {
    const starter = getPlanTier('starter')!
    expect(getIncludedAllowanceUsd(starter, 'monthly')).toBe(50)
  })

  it('resolves the annual figure for billingPeriod=annual, not the monthly figure', () => {
    const starter = getPlanTier('starter')!
    expect(getIncludedAllowanceUsd(starter, 'annual')).toBe(600)
  })
})

describe('getPlanPriceUsd', () => {
  it('resolves monthly vs annual display price correctly', () => {
    const growth = getPlanTier('growth')!
    expect(getPlanPriceUsd(growth, 'monthly')).toBe(299)
    expect(getPlanPriceUsd(growth, 'annual')).toBe(2870)
  })
})
