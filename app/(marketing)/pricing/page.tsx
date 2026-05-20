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
    badge: null,
    tagline: 'Try Clio free for 3 days',
    features: [
      '1 AI coaching session included',
      'Personalised onboarding (5 questions)',
      'Daily email insight',
      'AI Readiness Score',
      '3-day trial — card required to activate',
    ],
    cta: 'Start free',
    href: '/onboarding',
    highlight: false,
  },
  {
    name: 'Starter',
    key: 'starter' as const,
    badge: null,
    tagline: 'Learn AI at your pace',
    features: [
      '30 min/mo · ~1–2 live coaching sessions',
      'Flat rate — same price whatever the topic (healthcare AI, finance AI, retail AI)',
      'Clio joins your Google Meet to coach you',
      'Pre-built visual aids for every session',
      'Session notes PDF export after each call',
      'Daily email insights',
      'AI Readiness Score (0–100)',
      'Weekly digest every Sunday',
    ],
    cta: 'Get Starter',
    href: '/onboarding',
    highlight: false,
  },
  {
    name: 'Pro',
    key: 'pro' as const,
    badge: 'Most popular',
    tagline: 'Learn and walk in prepared',
    features: [
      '70 min/mo · ~2–4 live coaching sessions',
      'Flat rate — same price whatever the topic',
      'Everything in Starter',
      'Session Prep Brief — night before each session, Clio emails you what to expect, 3 key concepts, and 2 questions to think about',
      'Full curriculum PDF — share your learning plan with your EA or chief of staff',
      'Email + SMS daily insights',
      'Ask Clio anything via SMS',
      'Shareable session summaries',
    ],
    cta: 'Get Pro',
    href: '/onboarding',
    highlight: true,
  },
  {
    name: 'Executive',
    key: 'executive' as const,
    badge: 'C-Suite',
    tagline: 'Learn, prepare, and apply',
    features: [
      '150 min/mo · ~5–10 live coaching sessions',
      'Flat rate — same price whatever the topic',
      'Everything in Pro',
      'Meeting Readiness — before any AI vendor pitch or board session, get a full briefing: who you\'re meeting, what to expect, 5 questions to ask, red flags to watch for',
      'Executive Briefing Pack — a board-ready PDF of your AI progress and strategic recommendations for your organisation',
      'Dedicated Clio phone number',
      'White-glove onboarding session',
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
            3-day free trial on all plans. Cancel anytime.
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
                  {/* Top badge — Most popular or C-Suite */}
                  {(plan.highlight || plan.badge) && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <Badge variant={plan.highlight ? 'purple' : 'amber'}>
                        {plan.badge ?? 'Most popular'}
                      </Badge>
                    </div>
                  )}

                  {/* Plan name + tagline */}
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-[#475569] uppercase tracking-widest">
                        {plan.name}
                      </p>
                      {annual && priceMonthly > 0 && (
                        <span className="text-[10px] font-bold text-[#10B981] uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-950/40 border border-green-800/30">
                          Save ${priceMonthly * 12 - priceAnnual}
                        </span>
                      )}
                    </div>
                    {'tagline' in plan && (
                      <p className="text-xs text-[#475569] mb-3">{plan.tagline as string}</p>
                    )}
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

                  {/* Features */}
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.features.map((f, fi) => {
                      const isMinutes = fi === 0 && f.includes('min/mo')
                      const isFlatRate = f.startsWith('Flat rate')
                      return (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <CheckCircle
                            size={15}
                            className={`mt-0.5 flex-shrink-0 ${
                              isMinutes ? 'text-[#06B6D4]' :
                              isFlatRate ? 'text-[#10B981]' :
                              'text-[#7C3AED]'
                            }`}
                          />
                          <span className={
                            isMinutes ? 'text-white font-semibold' :
                            isFlatRate ? 'text-[#10B981] text-xs' :
                            'text-[#94A3B8]'
                          }>
                            {f}
                          </span>
                        </li>
                      )
                    })}
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
          All plans include a 3-day free trial. Card required to activate. Cancel anytime.
        </p>
      </div>
    </main>
  )
}
