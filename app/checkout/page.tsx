'use client'

import { useEffect, useState, Suspense } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { motion } from 'framer-motion'
import { CheckCircle, Lock, Loader2, ShieldCheck, Gift } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '')

const PLAN_DATA = {
  starter: {
    name: 'Starter',
    monthly: 12,
    annual: 99,
    features: [
      '30 coaching minutes per month',
      'Daily email insights — 15 seconds to read',
      'Session summaries & action items',
      'AI Readiness Score tracker',
    ],
  },
  pro: {
    name: 'Pro',
    monthly: 25,
    annual: 199,
    features: [
      '70 coaching minutes per month',
      'Email + SMS daily insights',
      'Ask Clio anything via SMS',
      'Everything in Starter',
    ],
  },
  executive: {
    name: 'Executive',
    monthly: 49,
    annual: 399,
    features: [
      '150 coaching minutes per month',
      'Dedicated Clio phone number',
      'Priority session scheduling',
      'Everything in Pro',
    ],
  },
} as const

type PlanKey = keyof typeof PLAN_DATA

// Stripe Elements appearance — dark theme matching our design
const STRIPE_APPEARANCE = {
  theme: 'night' as const,
  variables: {
    colorPrimary: '#7C3AED',
    colorBackground: '#111111',
    colorText: '#ffffff',
    colorDanger: '#EF4444',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    borderRadius: '10px',
    colorTextSecondary: '#94A3B8',
    colorTextPlaceholder: '#475569',
    spacingUnit: '4px',
    fontSizeBase: '15px',
  },
  rules: {
    '.Input': {
      border: '1px solid #222222',
      boxShadow: 'none',
      padding: '12px 14px',
    },
    '.Input:focus': {
      border: '1px solid #7C3AED',
      boxShadow: '0 0 0 2px rgba(124,58,237,0.2)',
    },
    '.Label': {
      color: '#94A3B8',
      fontWeight: '500',
      fontSize: '13px',
      marginBottom: '6px',
    },
    '.Tab': {
      border: '1px solid #222222',
    },
    '.Tab:hover': {
      border: '1px solid #444444',
    },
    '.Tab--selected': {
      border: '1px solid #7C3AED',
    },
  },
}

// ── Payment form (inside Elements context) ────────────────────────────────────
function PaymentForm({
  planKey,
  billingPeriod,
  trialOptIn,
  onTrialOptInChange,
  onSuccess,
}: {
  planKey: PlanKey
  billingPeriod: 'monthly' | 'annual'
  trialOptIn: boolean
  onTrialOptInChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setIsSubmitting(true)
    setError(null)

    try {
      // Confirm the SetupIntent — saves the card to Stripe
      let stripeError: import('@stripe/stripe-js').StripeError | undefined
      let setupIntent: import('@stripe/stripe-js').SetupIntent | undefined
      try {
        const result = await stripe.confirmSetup({
          elements,
          redirect: 'if_required',
          confirmParams: {
            return_url: `${window.location.origin}/dashboard`,
          },
        })
        stripeError = result.error
        setupIntent = (result as { setupIntent?: import('@stripe/stripe-js').SetupIntent }).setupIntent
      } catch (confirmErr) {
        const msg = confirmErr instanceof Error ? confirmErr.message : String(confirmErr)
        console.error('[checkout] confirmSetup threw:', msg)
        setError(`Card setup failed: ${msg}`)
        return
      }

      if (stripeError) {
        setError(stripeError.message ?? 'Card verification failed. Please try again.')
        return
      }

      if (!setupIntent?.payment_method) {
        setError('Card saved but payment method missing. Please try again.')
        return
      }

      const paymentMethodId =
        typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id ?? ''

      // Create the subscription using the saved payment method
      let res: Response
      let data: Record<string, unknown>
      try {
        res = await fetch('/api/checkout/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: planKey, billingPeriod, paymentMethodId, trialOptIn }),
        })
        data = await res.json()
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
        console.error('[checkout] confirm fetch failed:', msg)
        setError(`Network error contacting server: ${msg}`)
        return
      }

      if (!res.ok || !data.success) {
        setError((data.error as string) ?? 'Failed to activate your plan. Please try again.')
        return
      }

      localStorage.removeItem('clio_selected_plan')
      localStorage.removeItem('clio_billing_period')
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[checkout] handleSubmit unexpected error:', msg)
      setError(`Unexpected error: ${msg}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const plan = PLAN_DATA[planKey]
  const price = billingPeriod === 'annual' ? plan.annual : plan.monthly
  const trialEnd = new Date()
  trialEnd.setDate(trialEnd.getDate() + 3)
  const trialEndStr = trialEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-white text-xl font-bold mb-1">Payment details</h2>
        <p className="text-[#475569] text-sm">
          {trialOptIn
            ? `Your card won’t be charged until ${trialEndStr}.`
            : 'Your card will be charged today when you subscribe.'}
        </p>
      </div>

      {/* Trial opt-in checkbox */}
      <label className="flex items-start gap-3 cursor-pointer group">
        <div className="relative mt-0.5 flex-shrink-0">
          <input
            type="checkbox"
            checked={trialOptIn}
            onChange={(e) => onTrialOptInChange(e.target.checked)}
            className="sr-only"
          />
          <div
            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
              trialOptIn
                ? 'bg-[#7C3AED] border-[#7C3AED]'
                : 'bg-transparent border-[#333333] group-hover:border-[#555555]'
            }`}
          >
            {trialOptIn && (
              <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Gift size={14} className="text-[#A855F7]" />
            <span className="text-sm font-semibold text-white">Start with a 3-day free trial</span>
          </div>
          <p className="text-xs text-[#475569] mt-0.5 leading-relaxed">
            Try Clio free for 3 days with 5 coaching minutes. Your card is saved but not charged.
            Pay anytime within 3 days to unlock your full plan — or cancel and pay nothing.
          </p>
        </div>
      </label>

      <PaymentElement
        options={{
          layout: 'tabs',
          terms: { card: 'never' },
        }}
      />

      {error && (
        <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg px-4 py-3">
          <p className="text-[#EF4444] text-sm">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !stripe || !elements}
        className="w-full py-4 px-6 bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 disabled:cursor-not-allowed rounded-xl text-white font-semibold text-base transition-colors flex items-center justify-center gap-2"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Activating your plan…
          </>
        ) : trialOptIn ? (
          <>
            <Gift className="w-4 h-4" />
            Start 3-day free trial — ${price}/{billingPeriod === 'annual' ? 'yr' : 'mo'} after
          </>
        ) : (
          <>
            <Lock className="w-4 h-4" />
            Subscribe now — ${price}/{billingPeriod === 'annual' ? 'yr' : 'mo'}
          </>
        )}
      </button>

      <div className="flex items-center justify-center gap-1.5 text-[#475569] text-xs">
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>Secured by Stripe · SSL encrypted · Cancel anytime</span>
      </div>
    </form>
  )
}

// ── Main checkout content ─────────────────────────────────────────────────────
function CheckoutContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [planKey, setPlanKey] = useState<PlanKey>('starter')
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [trialOptIn, setTrialOptIn] = useState(true)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [isLoadingIntent, setIsLoadingIntent] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [existingAccountEmail, setExistingAccountEmail] = useState<string | null>(null)

  // Determine plan on mount from URL param then localStorage
  useEffect(() => {
    const planFromUrl = searchParams.get('plan')
    const storedPlan = planFromUrl ?? localStorage.getItem('clio_selected_plan')
    const storedBilling = localStorage.getItem('clio_billing_period') as 'monthly' | 'annual' | null
    if (storedBilling) setBillingPeriod(storedBilling)
    const resolvedPlan = (storedPlan && storedPlan in PLAN_DATA) ? storedPlan as PlanKey : 'starter'
    setPlanKey(resolvedPlan)
  }, [searchParams])

  // Fetch a new SetupIntent whenever plan or billing period changes
  useEffect(() => {
    if (!planKey) return
    setClientSecret(null)
    setInitError(null)
    setIsLoadingIntent(true)

    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planKey, billingPeriod }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.checkoutUrl) {
          localStorage.removeItem('clio_selected_plan')
          localStorage.removeItem('clio_billing_period')
          window.location.href = data.checkoutUrl
          return
        }
        if (data.alreadyActive) {
          router.push('/dashboard')
          return
        }
        if (data.existingAccount) {
          setExistingAccountEmail(data.email ?? null)
          return
        }
        if (data.clientSecret) {
          setClientSecret(data.clientSecret)
        } else {
          setInitError(data.error ?? 'Could not load payment form. Please try again.')
        }
      })
      .catch(() => setInitError('Connection error. Please refresh and try again.'))
      .finally(() => setIsLoadingIntent(false))
  }, [planKey, billingPeriod, router])

  function handlePlanSwitch(key: PlanKey) {
    setPlanKey(key)
    localStorage.setItem('clio_selected_plan', key)
  }

  function handleBillingSwitch(period: 'monthly' | 'annual') {
    setBillingPeriod(period)
    localStorage.setItem('clio_billing_period', period)
  }

  const plan = PLAN_DATA[planKey]
  const price = billingPeriod === 'annual' ? plan.annual : plan.monthly
  const billingLabel = billingPeriod === 'annual' ? '/yr' : '/mo'

  const trialEnd = new Date()
  trialEnd.setDate(trialEnd.getDate() + 3)
  const trialEndStr = trialEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col lg:flex-row">

      {/* ── Left: Plan summary ── */}
      <div className="lg:w-[420px] lg:min-h-screen bg-[#0d0d0d] border-b lg:border-b-0 lg:border-r border-[#1a1a1a] flex flex-col p-8 lg:p-12">

        {/* Logo */}
        <div className="flex items-center justify-between mb-12">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-full bg-[#7C3AED] flex items-center justify-center">
              <span className="text-sm font-extrabold text-white">C</span>
            </div>
            <span className="text-white font-bold text-lg group-hover:text-[#A855F7] transition-colors">Clio</span>
          </Link>
          <Link href="/onboarding?edit=1" className="text-xs text-[#475569] hover:text-[#94A3B8] underline underline-offset-2 transition-colors">
            Edit my answers
          </Link>
        </div>

        <div className="flex-1">
          {/* Plan switcher */}
          <p className="text-[#475569] text-xs font-semibold uppercase tracking-widest mb-3">Your plan</p>
          <div className="flex gap-2 mb-6">
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

          {/* Price */}
          <div className="mb-2">
            <div className="flex items-baseline gap-1">
              <span className="text-white text-5xl font-extrabold">${price}</span>
              <span className="text-[#475569] text-lg">{billingLabel}</span>
            </div>
          </div>

          {/* Billing toggle */}
          <div className="flex gap-2 mb-8">
            {(['monthly', 'annual'] as const).map((period) => (
              <button
                key={period}
                onClick={() => handleBillingSwitch(period)}
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

          {/* Features */}
          <ul className="space-y-3 mb-10">
            {plan.features.map((f) => (
              <li key={f} className="flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-[#10B981] mt-0.5 shrink-0" />
                <span className="text-[#94A3B8] text-sm leading-relaxed">{f}</span>
              </li>
            ))}
          </ul>

          {/* Trial callout */}
          {trialOptIn ? (
            <div className="bg-[#7C3AED]/10 border border-[#7C3AED]/25 rounded-xl p-4">
              <p className="text-[#A855F7] text-sm font-semibold mb-1">3-day free trial selected</p>
              <p className="text-[#475569] text-xs leading-relaxed">
                Your card is saved today but nothing is charged until {trialEndStr}.
                You get 5 coaching minutes to try Clio. Cancel before then and you won&apos;t be billed a cent.
              </p>
            </div>
          ) : (
            <div className="bg-[#10B981]/10 border border-[#10B981]/25 rounded-xl p-4">
              <p className="text-[#10B981] text-sm font-semibold mb-1">Full plan — starts today</p>
              <p className="text-[#475569] text-xs leading-relaxed">
                Your card will be charged today and you&apos;ll get your full coaching minutes immediately.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-[#333333] mt-8">
          Clio does not store payment details. All billing is handled by Stripe.
        </p>
      </div>

      {/* ── Right: Embedded Stripe payment form ── */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          {isLoadingIntent && (
            <div className="flex flex-col items-center gap-4 py-16">
              <Loader2 className="w-6 h-6 text-[#7C3AED] animate-spin" />
              <p className="text-[#475569] text-sm">Loading payment form…</p>
            </div>
          )}

          {existingAccountEmail && !isLoadingIntent && (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-full bg-amber-900/30 border border-amber-700/40 flex items-center justify-center mx-auto mb-5">
                <Lock className="w-6 h-6 text-amber-400" />
              </div>
              <h2 className="text-white text-xl font-bold mb-2">Account already exists</h2>
              <p className="text-[#94A3B8] text-sm mb-1">
                An active subscription is already linked to
              </p>
              <p className="text-white font-medium text-sm mb-6">{existingAccountEmail}</p>
              <p className="text-[#475569] text-sm mb-8">
                Sign in with your original account to access your dashboard.
              </p>
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold rounded-xl transition-colors"
              >
                Sign in to your account
              </Link>
            </div>
          )}

          {initError && !isLoadingIntent && !existingAccountEmail && (
            <div className="text-center py-12">
              <p className="text-[#EF4444] text-sm mb-4">{initError}</p>
              <button
                onClick={() => window.location.reload()}
                className="text-[#7C3AED] text-sm underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          )}

          {clientSecret && !isLoadingIntent && (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: STRIPE_APPEARANCE,
                fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap' }],
              }}
            >
              <PaymentForm
                planKey={planKey}
                billingPeriod={billingPeriod}
                trialOptIn={trialOptIn}
                onTrialOptInChange={setTrialOptIn}
                onSuccess={() => router.push('/dashboard/welcome')}
              />
            </Elements>
          )}
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
