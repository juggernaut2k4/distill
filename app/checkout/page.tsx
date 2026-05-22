'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle, Clock, Video, MessageSquare, Zap, Loader2, Lock } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const PLAN_DATA = {
  starter: {
    name: 'Starter',
    monthly: 12,
    annual: 99,
    minutes: 30,
    sessions: '1–2 sessions/mo',
    features: [
      '30 coaching minutes per month',
      '1–2 live AI coaching sessions',
      'AI coaching via Google Meet',
      'Session summaries & action items',
      'Clio AI chat support',
    ],
  },
  pro: {
    name: 'Pro',
    monthly: 25,
    annual: 199,
    minutes: 70,
    sessions: '2–4 sessions/mo',
    features: [
      '70 coaching minutes per month',
      '2–4 live AI coaching sessions',
      'Everything in Starter',
      'Priority session scheduling',
      'Custom learning paths',
    ],
  },
  executive: {
    name: 'Executive',
    monthly: 49,
    annual: 399,
    minutes: 150,
    sessions: '5–10 sessions/mo',
    features: [
      '150 coaching minutes per month',
      '5–10 live AI coaching sessions',
      'Everything in Pro',
      'Dedicated success check-ins',
      'VIP priority support',
    ],
  },
} as const

type PlanKey = keyof typeof PLAN_DATA

function CheckoutContent() {
  const searchParams = useSearchParams()
  const [planKey, setPlanKey] = useState<PlanKey>('starter')
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFreeActivating, setIsFreeActivating] = useState(false)
  const freeSubmittedRef = useRef(false)

  useEffect(() => {
    // URL param takes priority (set explicitly by /plan page on user selection)
    const planFromUrl = searchParams.get('plan')
    const storedPlan = planFromUrl ?? localStorage.getItem('clio_selected_plan')
    const storedBilling = localStorage.getItem('clio_billing_period') as 'monthly' | 'annual' | null

    // Free plan: auto-activate on mount, no card or plan selection needed
    if (storedPlan === 'free' && !freeSubmittedRef.current) {
      freeSubmittedRef.current = true
      setIsFreeActivating(true)
      activateFreePlan()
      return
    }

    if (storedPlan && storedPlan in PLAN_DATA) setPlanKey(storedPlan as PlanKey)
    if (storedBilling) setBillingPeriod(storedBilling)
  }, [searchParams])

  async function activateFreePlan() {
    const onboardingRaw = localStorage.getItem('clio_onboarding')
    if (onboardingRaw) {
      try {
        await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: onboardingRaw,
        })
      } catch { /* non-fatal */ }
      localStorage.removeItem('clio_onboarding')
    }
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'free', billingPeriod: 'monthly' }),
      })
      const data = await res.json()
      localStorage.removeItem('clio_selected_plan')
      localStorage.removeItem('clio_billing_period')
      window.location.href = data.checkoutUrl ?? '/dashboard/welcome'
    } catch {
      setIsFreeActivating(false)
      setError('Could not activate your account. Please try again.')
    }
  }

  function handlePlanSwitch(key: PlanKey) {
    setPlanKey(key)
    localStorage.setItem('clio_selected_plan', key)
  }

  async function handleStartTrial() {
    setIsLoading(true)
    setError(null)

    // Flush pending onboarding data
    const onboardingRaw = localStorage.getItem('clio_onboarding')
    if (onboardingRaw) {
      try {
        await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: onboardingRaw,
        })
      } catch { /* non-fatal */ }
      localStorage.removeItem('clio_onboarding')
    }

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey, billingPeriod }),
      })
      const data = await res.json()

      if (data.alreadyActive) {
        localStorage.removeItem('clio_selected_plan')
        localStorage.removeItem('clio_billing_period')
        window.location.href = '/dashboard/welcome'
        return
      }

      if (data.checkoutUrl) {
        localStorage.removeItem('clio_selected_plan')
        localStorage.removeItem('clio_billing_period')
        window.location.href = data.checkoutUrl
        return
      }

      setError(data.error ?? 'Failed to start checkout. Please try again.')
      setIsLoading(false)
    } catch {
      setError('Connection error. Please try again.')
      setIsLoading(false)
    }
  }

  const plan = PLAN_DATA[planKey]
  const displayPrice = billingPeriod === 'annual' ? plan.annual : plan.monthly
  const billingLabel = billingPeriod === 'annual' ? '/yr' : '/mo'

  // Free plan loading screen — shown while auto-activating, no UI needed
  if (isFreeActivating) {
    return (
      <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center gap-5">
        <div className="w-12 h-12 rounded-full bg-[#7C3AED] flex items-center justify-center">
          <span className="text-lg font-extrabold text-white">C</span>
        </div>
        <Loader2 className="w-6 h-6 text-[#7C3AED] animate-spin" />
        <p className="text-[#94A3B8] text-sm">Setting up your account…</p>
        {error && <p className="text-[#EF4444] text-sm">{error}</p>}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col lg:flex-row">
      {/* ── Left panel: Plan summary ── */}
      <div className="lg:w-[440px] lg:min-h-screen bg-[#0d0d0d] border-b lg:border-b-0 lg:border-r border-[#1a1a1a] flex flex-col p-8 lg:p-12">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mb-10 group">
          <div className="w-8 h-8 rounded-full bg-[#7C3AED] flex items-center justify-center">
            <span className="text-sm font-extrabold text-white">C</span>
          </div>
          <span className="text-white font-bold text-lg group-hover:text-[#A855F7] transition-colors">Clio</span>
        </Link>

        <div className="flex-1">
          <p className="text-[#94A3B8] text-sm font-medium uppercase tracking-wider mb-3">Your plan</p>

          {/* Inline plan switcher — stay in flow, no navigation out */}
          <div className="flex gap-2 mb-5">
            {(Object.keys(PLAN_DATA) as PlanKey[]).map((key) => (
              <button
                key={key}
                onClick={() => handlePlanSwitch(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  planKey === key
                    ? 'bg-[#7C3AED] text-white'
                    : 'bg-[#1a1a1a] text-[#94A3B8] hover:text-white border border-[#222222] hover:border-[#444444]'
                }`}
              >
                {PLAN_DATA[key].name}
              </button>
            ))}
          </div>

          <div className="flex items-baseline gap-1 mb-2">
            <span className="text-white text-5xl font-extrabold">${displayPrice}</span>
            <span className="text-[#94A3B8] text-lg">{billingLabel}</span>
          </div>

          {/* Billing period toggle */}
          <div className="flex gap-2 mb-5">
            {(['monthly', 'annual'] as const).map((period) => (
              <button
                key={period}
                onClick={() => {
                  setBillingPeriod(period)
                  localStorage.setItem('clio_billing_period', period)
                }}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  billingPeriod === period
                    ? 'bg-[#1a1a1a] text-white border border-[#7C3AED]'
                    : 'text-[#475569] hover:text-[#94A3B8]'
                }`}
              >
                {period === 'annual' ? 'Annual (save ~30%)' : 'Monthly'}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1.5 bg-[#7C3AED]/10 border border-[#7C3AED]/30 rounded-full px-3 py-1 mb-8">
            <Zap className="w-3 h-3 text-[#7C3AED]" />
            <span className="text-[#A855F7] text-xs font-medium">3-day free trial — no charge today</span>
          </div>

          <p className="text-[#94A3B8] text-sm font-medium uppercase tracking-wider mb-4">What&apos;s included</p>
          <ul className="space-y-3 mb-8">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-[#10B981] mt-0.5 shrink-0" />
                <span className="text-[#94A3B8] text-sm">{feature}</span>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 flex items-center gap-3">
              <Clock className="w-4 h-4 text-[#7C3AED] shrink-0" />
              <div>
                <p className="text-white text-sm font-semibold">{plan.minutes} min</p>
                <p className="text-[#475569] text-xs">per month</p>
              </div>
            </div>
            <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 flex items-center gap-3">
              <Video className="w-4 h-4 text-[#06B6D4] shrink-0" />
              <div>
                <p className="text-white text-sm font-semibold">{plan.sessions}</p>
                <p className="text-[#475569] text-xs">live sessions</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-[#1a1a1a]">
          <div className="flex items-start gap-2 text-[#475569] text-xs">
            <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>3-day free trial. Card charged ${displayPrice}{billingLabel} after trial ends. Cancel anytime.</span>
          </div>
        </div>
      </div>

      {/* ── Right panel: Start trial ── */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-white text-2xl font-bold">Start your free trial</h2>
              <p className="text-[#94A3B8] text-sm">
                3 days free, then ${displayPrice}{billingLabel}. Cancel anytime before your trial ends.
              </p>
            </div>

            <div className="bg-[#111111] border border-[#222222] rounded-xl p-5 space-y-3">
              {[
                'Enter your card details on the next screen',
                'No charge for 3 days',
                'Cancel anytime from your dashboard',
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#7C3AED]/20 border border-[#7C3AED]/40 flex items-center justify-center shrink-0">
                    <span className="text-[#A855F7] text-xs font-bold">{i + 1}</span>
                  </div>
                  <span className="text-[#94A3B8] text-sm">{step}</span>
                </div>
              ))}
            </div>

            {error && (
              <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg px-4 py-3">
                <p className="text-[#EF4444] text-sm">{error}</p>
              </div>
            )}

            <motion.button
              onClick={handleStartTrial}
              disabled={isLoading}
              whileHover={{ scale: isLoading ? 1 : 1.02 }}
              whileTap={{ scale: isLoading ? 1 : 0.98 }}
              className="w-full py-4 px-6 bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 disabled:cursor-not-allowed rounded-xl text-white font-semibold text-base transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Preparing checkout...
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Start 3-day trial — {plan.name}
                </>
              )}
            </motion.button>

            <div className="flex items-center justify-center gap-1.5 text-[#475569] text-xs">
              <Lock className="w-3 h-3" />
              <span>Secured by Stripe · SSL encrypted</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#080808]" />}>
      <CheckoutContent />
    </Suspense>
  )
}
