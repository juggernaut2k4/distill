'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { CheckCircle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import MarketingNav from '@/components/marketing/MarketingNav'

interface PlanPrices {
  starter: { monthly: number; annual: number }
  pro: { monthly: number; annual: number }
  executive: { monthly: number; annual: number }
}

const DEFAULT_PRICES: PlanPrices = {
  starter: { monthly: 12, annual: 99 },
  pro: { monthly: 25, annual: 199 },
  executive: { monthly: 49, annual: 399 },
}

const PLAN_META = [
  {
    name: 'Free Trial',
    key: null as null,
    features: [
      '1 email insight per day',
      'Personalized onboarding',
      'No credit card required',
      '7-day free access',
    ],
    cta: 'Start free',
    href: '/onboarding',
    highlight: false,
  },
  {
    name: 'Starter',
    key: 'starter' as const,
    features: [
      '1 email insight per day',
      'Personalized learning plan',
      'Weekly digest (Sundays)',
      'Y/N feedback adaptation',
    ],
    cta: 'Get Starter',
    href: '/onboarding',
    highlight: false,
  },
  {
    name: 'Pro',
    key: 'pro' as const,
    features: [
      'Email + SMS daily insights',
      'AI Readiness Score (0–100)',
      'Ask Anything via SMS',
      'Adaptive content engine',
      'Y/N SMS feedback',
    ],
    cta: 'Get Pro',
    href: '/onboarding',
    highlight: true,
  },
  {
    name: 'Executive',
    key: 'executive' as const,
    features: [
      'Everything in Pro',
      'Dedicated phone number',
      'Meeting Prep Mode',
      'Progress Dashboard',
      'Priority response time',
    ],
    cta: 'Get Executive',
    href: '/onboarding',
    highlight: false,
  },
]

export default function PricingPage() {
  const [annual, setAnnual] = useState(false)
  const [prices, setPrices] = useState<PlanPrices>(DEFAULT_PRICES)

  useEffect(() => {
    fetch('/api/prices')
      .then((r) => r.json())
      .then((data: PlanPrices) => setPrices(data))
      .catch(() => { /* keep defaults */ })
  }, [])

  return (
    <main className="min-h-screen bg-[#080808] pt-32 pb-24 px-6">
      <MarketingNav />
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h1 className="text-6xl font-extrabold text-white tracking-tight mb-5">
            Simple pricing
          </h1>
          <p className="text-xl text-[#94A3B8] mb-10">
            Start free. Upgrade when you see the value.
          </p>

          {/* Toggle */}
          <div className="inline-flex items-center bg-[#111111] border border-[#222222] rounded-xl p-1">
            {['Monthly', 'Annual'].map((label) => {
              const isActive = (label === 'Annual') === annual
              return (
                <button
                  key={label}
                  onClick={() => setAnnual(label === 'Annual')}
                  className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? 'bg-[#7C3AED] text-white' : 'text-[#475569] hover:text-white'
                  }`}
                >
                  {label}
                  {label === 'Annual' && (
                    <span className="ml-2 text-xs text-[#F59E0B]">Save ~30%</span>
                  )}
                </button>
              )
            })}
          </div>
        </motion.div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLAN_META.map((plan, i) => {
            const planPrices = plan.key ? prices[plan.key] : null
            const priceMonthly = planPrices?.monthly ?? 0
            const priceAnnual = planPrices?.annual ?? 0
            const price = annual ? priceAnnual : priceMonthly

            return (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="relative"
              >
                <Card
                  className={`p-6 h-full flex flex-col ${
                    plan.highlight ? 'border-2 border-[#7C3AED]' : ''
                  }`}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <Badge variant="purple">Most popular</Badge>
                    </div>
                  )}

                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-[#475569] uppercase tracking-widest">
                        {plan.name}
                      </p>
                      {annual && priceMonthly > 0 && (
                        <span className="text-[10px] font-bold text-[#10B981] uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-950/40 border border-green-800/30">
                          Save ${priceMonthly * 12 - priceAnnual}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold text-white">
                        {price === 0 ? 'Free' : `$${price}`}
                      </span>
                      {price > 0 && (
                        <span className="text-[#475569] text-sm">
                          /{annual ? 'yr' : 'mo'}
                        </span>
                      )}
                    </div>
                    {annual && price > 0 && (
                      <p className="text-xs text-[#10B981] mt-1">
                        ≈ ${Math.round(price / 12)}/month
                      </p>
                    )}
                  </div>

                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <CheckCircle
                          size={15}
                          className="text-[#7C3AED] mt-0.5 flex-shrink-0"
                        />
                        <span className="text-[#94A3B8]">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Link href={plan.href}>
                    <Button
                      variant={plan.highlight ? 'primary' : 'secondary'}
                      size="md"
                      className="w-full gap-1"
                    >
                      {plan.cta}
                      <ArrowRight size={14} />
                    </Button>
                  </Link>
                </Card>
              </motion.div>
            )
          })}
        </div>

        {/* FAQ note */}
        <p className="text-center text-sm text-[#475569] mt-12">
          All plans include a 7-day free trial. Cancel anytime. No hidden fees.
        </p>
      </div>
    </main>
  )
}
