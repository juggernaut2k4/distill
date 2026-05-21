'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle, Clock, Video, MessageSquare, Zap, ArrowLeft, Loader2, Lock } from 'lucide-react'
import Link from 'next/link'

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

export default function CheckoutPage() {
  const [planKey, setPlanKey] = useState<PlanKey>('starter')
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const storedPlan = localStorage.getItem('clio_selected_plan')
    const storedBilling = localStorage.getItem('clio_billing_period') as 'monthly' | 'annual' | null
    if (storedPlan === 'pro' || storedPlan === 'executive') setPlanKey(storedPlan)
    if (storedBilling) setBillingPeriod(storedBilling)
  }, [])

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

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col lg:flex-row">
      {/* ── Left panel: Plan summary ── */}
      <div className="lg:w-[420px] lg:min-h-screen bg-[#0d0d0d] border-b lg:border-b-0 lg:border-r border-[#1a1a1a] flex flex-col p-8 lg:p-12">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mb-12 group">
          <div className="w-8 h-8 rounded-full bg-[#7C3AED] flex items-center justify-center">
            <span className="text-sm font-extrabold text-white">C</span>
          </div>
          <span className="text-white font-bold text-lg group-hover:text-[#A855F7] transition-colors">Clio</span>
        </Link>

        <div className="flex-1">
          <p className="text-[#94A3B8] text-sm font-medium uppercase tracking-wider mb-3">Your plan</p>
          <h1 className="text-white text-3xl font-bold mb-1">{plan.name}</h1>

          <div className="flex items-baseline gap-1 mb-2">
            <span className="text-white text-5xl font-extrabold">${displayPrice}</span>
            <span className="text-[#94A3B8] text-lg">{billingLabel}</span>
          </div>

          <div className="inline-flex items-center gap-1.5 bg-[#7C3AED]/10 border border-[#7C3AED]/30 rounded-full px-3 py-1 mb-8">
            <Zap className="w-3 h-3 text-[#7C3AED]" />
            <span className="text-[#A855F7] text-xs font-medium">3-day free trial included</span>
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
          <div className="lg:hidden flex items-center justify-between mb-8">
            <Link href="/pricing" className="flex items-center gap-1.5 text-[#94A3B8] hover:text-white text-sm transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
            <span className="text-[#94A3B8] text-sm">{plan.name} · ${displayPrice}{billingLabel}</span>
          </div>

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

            <div className="hidden lg:flex justify-center">
              <Link href="/pricing" className="flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" />
                Change plan
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
