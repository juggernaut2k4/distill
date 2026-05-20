'use client'

import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import { motion } from 'framer-motion'
import { CheckCircle, Clock, Video, MessageSquare, Zap, ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'
import CheckoutForm from './CheckoutForm'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

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

const stripeAppearance = {
  theme: 'night' as const,
  variables: {
    colorPrimary: '#7C3AED',
    colorBackground: '#0f0f0f',
    colorText: '#FFFFFF',
    colorTextSecondary: '#94A3B8',
    colorDanger: '#EF4444',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    borderRadius: '12px',
    colorTextPlaceholder: '#475569',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': {
      border: '1px solid #333333',
      boxShadow: 'none',
      backgroundColor: '#111111',
      color: '#FFFFFF',
      padding: '12px 16px',
    },
    '.Input:focus': {
      border: '1px solid #7C3AED',
      boxShadow: '0 0 0 2px rgba(124, 58, 237, 0.15)',
      outline: 'none',
    },
    '.Label': {
      color: '#94A3B8',
      fontSize: '13px',
      fontWeight: '500',
      marginBottom: '6px',
    },
    '.Tab': {
      border: '1px solid #333333',
      backgroundColor: '#111111',
      color: '#94A3B8',
    },
    '.Tab--selected': {
      borderColor: '#7C3AED',
      color: '#FFFFFF',
      backgroundColor: '#1a1a2e',
    },
    '.Tab:hover': {
      borderColor: '#555555',
    },
    '.Error': {
      color: '#EF4444',
    },
    '.TermsText': {
      color: '#475569',
    },
  },
}

export default function CheckoutPage() {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [planKey, setPlanKey] = useState<PlanKey>('starter')
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [error, setError] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    async function init() {
      // Flush any pending onboarding data first
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

      const storedPlan = localStorage.getItem('clio_selected_plan') as string | null
      const storedBilling = localStorage.getItem('clio_billing_period') as 'monthly' | 'annual' | null
      const resolvedPlan: PlanKey =
        storedPlan === 'pro' ? 'pro' :
        storedPlan === 'executive' ? 'executive' :
        'starter'
      const resolvedBilling = storedBilling ?? 'monthly'

      setPlanKey(resolvedPlan)
      setBillingPeriod(resolvedBilling)

      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: resolvedPlan, billingPeriod: resolvedBilling }),
        })

        const data = await res.json()

        if (data.clientSecret) {
          setClientSecret(data.clientSecret)
        } else if (data.checkoutUrl) {
          // Mock mode fallback — redirect immediately
          localStorage.removeItem('clio_selected_plan')
          localStorage.removeItem('clio_billing_period')
          window.location.href = data.checkoutUrl
          return
        } else {
          setError(data.error ?? 'Failed to initialize checkout. Please try again.')
        }
      } catch {
        setError('Connection error. Please refresh and try again.')
      } finally {
        setIsInitializing(false)
      }
    }

    init()
  }, [])

  const plan = PLAN_DATA[planKey]
  const displayPrice = billingPeriod === 'annual' ? plan.annual : plan.monthly
  const billingLabel = billingPeriod === 'annual' ? '/yr' : '/mo'

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isInitializing || (!clientSecret && !error)) {
    return (
      <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center">
        <div className="relative w-16 h-16 mb-6">
          <motion.div
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-full bg-[#7C3AED]"
          />
          <div className="relative w-16 h-16 rounded-full bg-[#7C3AED] flex items-center justify-center">
            <span className="text-xl font-extrabold text-white">C</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[#94A3B8]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Setting up your checkout...</span>
        </div>
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-[#EF4444] text-lg">!</span>
          </div>
          <p className="text-white font-semibold mb-2">Something went wrong</p>
          <p className="text-[#94A3B8] text-sm mb-6">{error}</p>
          <Link
            href="/pricing"
            className="text-[#7C3AED] hover:text-[#A855F7] transition-colors text-sm"
          >
            ← Back to pricing
          </Link>
        </div>
      </div>
    )
  }

  // ── Main two-panel checkout ────────────────────────────────────────────────
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

        {/* Plan details */}
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

          {/* What you get */}
          <p className="text-[#94A3B8] text-sm font-medium uppercase tracking-wider mb-4">What&apos;s included</p>
          <ul className="space-y-3 mb-8">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-[#10B981] mt-0.5 shrink-0" />
                <span className="text-[#94A3B8] text-sm">{feature}</span>
              </li>
            ))}
          </ul>

          {/* Quick facts */}
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

        {/* Footer note */}
        <div className="mt-8 pt-6 border-t border-[#1a1a1a]">
          <div className="flex items-start gap-2 text-[#475569] text-xs">
            <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>3-day free trial. Card charged ${displayPrice}{billingLabel} after trial ends. Cancel anytime — no questions asked.</span>
          </div>
        </div>
      </div>

      {/* ── Right panel: Payment form ── */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          {/* Mobile plan badge */}
          <div className="lg:hidden flex items-center justify-between mb-8">
            <Link href="/pricing" className="flex items-center gap-1.5 text-[#94A3B8] hover:text-white text-sm transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
            <span className="text-[#94A3B8] text-sm">
              {plan.name} · ${displayPrice}{billingLabel}
            </span>
          </div>

          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: clientSecret!,
              appearance: stripeAppearance,
            }}
          >
            <CheckoutForm
              planName={plan.name}
              planPrice={displayPrice}
              billingPeriod={billingPeriod}
            />
          </Elements>

          {/* Desktop back link */}
          <div className="hidden lg:flex justify-center mt-6">
            <Link href="/pricing" className="flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Change plan
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
