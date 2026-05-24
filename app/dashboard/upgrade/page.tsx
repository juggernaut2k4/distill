'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle, ArrowRight, Zap, Star, Crown } from 'lucide-react'
import Link from 'next/link'

const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    icon: Zap,
    monthly: 12,
    annual: 99,
    color: '#06B6D4',
    popular: false,
    features: [
      '30 coaching minutes per month',
      'Daily email insights',
      'Session summaries & action items',
      'AI Readiness Score tracker',
      '$0.40/min beyond your balance',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    icon: Star,
    monthly: 25,
    annual: 199,
    color: '#7C3AED',
    popular: true,
    features: [
      '70 coaching minutes per month',
      'Email + SMS daily insights',
      'Ask Clio anything via SMS',
      'Priority session scheduling',
      '$0.39/min beyond your balance',
    ],
  },
  {
    key: 'executive',
    name: 'Executive',
    icon: Crown,
    monthly: 49,
    annual: 399,
    color: '#F59E0B',
    popular: false,
    features: [
      '150 coaching minutes per month',
      'Dedicated Clio phone number',
      'White-glove session scheduling',
      'Everything in Pro',
      '$0.38/min beyond your balance',
    ],
  },
] as const

type PlanKey = 'starter' | 'pro' | 'executive'
type Billing = 'monthly' | 'annual'

export default function UpgradePage() {
  const router = useRouter()
  const [billing, setBilling] = useState<Billing>('monthly')

  function selectPlan(key: PlanKey) {
    localStorage.setItem('clio_selected_plan', key)
    localStorage.setItem('clio_billing_period', billing)
    router.push(`/checkout?plan=${key}&billing=${billing}`)
  }

  return (
    <div className="min-h-screen bg-[#080808] p-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <Link href="/dashboard/billing" className="text-[#475569] text-sm hover:text-[#94A3B8] transition-colors">
            ← Back to billing
          </Link>
          <h1 className="text-3xl font-bold text-white mt-4 mb-2">Choose your plan</h1>
          <p className="text-[#94A3B8]">Upgrade to unlock more coaching time and features.</p>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center gap-1 bg-[#111111] border border-[#222222] rounded-xl p-1 w-fit mb-10">
          {(['monthly', 'annual'] as const).map((period) => (
            <button
              key={period}
              onClick={() => setBilling(period)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                billing === period
                  ? 'bg-[#7C3AED] text-white'
                  : 'text-[#475569] hover:text-[#94A3B8]'
              }`}
            >
              {period === 'annual' ? 'Annual — save ~30%' : 'Monthly'}
            </button>
          ))}
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PLANS.map((plan, i) => {
            const Icon = plan.icon
            const price = billing === 'annual' ? plan.annual : plan.monthly
            const billingLabel = billing === 'annual' ? '/yr' : '/mo'

            return (
              <motion.div
                key={plan.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.07 }}
                className="relative flex flex-col rounded-2xl p-6"
                style={{
                  background: plan.popular
                    ? 'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(6,182,212,0.05) 100%), #111111'
                    : '#111111',
                  border: plan.popular ? '2px solid #7C3AED' : '1px solid #222222',
                }}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-[#7C3AED] text-white text-xs font-bold px-3 py-1 rounded-full">
                      Most popular
                    </span>
                  </div>
                )}

                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: `${plan.color}20`, border: `1px solid ${plan.color}30` }}
                >
                  <Icon size={20} style={{ color: plan.color }} />
                </div>

                <p className="text-[#94A3B8] text-xs font-semibold uppercase tracking-widest mb-1">{plan.name}</p>

                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-white text-4xl font-extrabold">${price}</span>
                  <span className="text-[#475569]">{billingLabel}</span>
                </div>

                <ul className="space-y-3 flex-1 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <CheckCircle size={15} className="mt-0.5 shrink-0" style={{ color: plan.color }} />
                      <span className="text-[#94A3B8] text-sm leading-relaxed">{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => selectPlan(plan.key as PlanKey)}
                  className="w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all"
                  style={
                    plan.popular
                      ? { background: '#7C3AED', color: '#fff' }
                      : { background: 'transparent', border: '1px solid #333333', color: '#fff' }
                  }
                  onMouseEnter={(e) => {
                    if (!plan.popular) {
                      e.currentTarget.style.borderColor = '#555555'
                      e.currentTarget.style.background = '#1A1A1A'
                    } else {
                      e.currentTarget.style.background = '#6D28D9'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!plan.popular) {
                      e.currentTarget.style.borderColor = '#333333'
                      e.currentTarget.style.background = 'transparent'
                    } else {
                      e.currentTarget.style.background = '#7C3AED'
                    }
                  }}
                >
                  Select {plan.name} <ArrowRight size={14} />
                </button>
              </motion.div>
            )
          })}
        </div>

        <p className="text-center text-xs text-[#333333] mt-8">
          All plans include a 3-day free trial · Cancel anytime · Secured by Stripe
        </p>
      </div>
    </div>
  )
}
