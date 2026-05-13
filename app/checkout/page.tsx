'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'

export default function CheckoutRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    async function startCheckout() {
      // Flush any pending onboarding data now that the user is authenticated
      const onboardingRaw = localStorage.getItem('clio_onboarding')
      if (onboardingRaw) {
        try {
          await fetch('/api/onboarding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: onboardingRaw,
          })
        } catch {
          // Non-fatal — continue to checkout
        }
        localStorage.removeItem('clio_onboarding')
      }

      // All plans — including free trial — go through Stripe so a card is collected.
      // Free maps to Starter price with 3-day trial; charged from day 3.
      const plan = localStorage.getItem('clio_selected_plan') ?? 'starter'

      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan, billingPeriod: 'monthly' }),
        })

        const data = await res.json()
        localStorage.removeItem('clio_selected_plan')

        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl
        } else {
          router.push('/pricing')
        }
      } catch {
        router.push('/pricing')
      }
    }

    startCheckout()
  }, [router])

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center">
      <div className="relative w-20 h-20 mb-8">
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full bg-[#7C3AED]"
        />
        <div className="relative w-20 h-20 rounded-full bg-[#7C3AED] flex items-center justify-center">
          <span className="text-2xl font-extrabold text-white tracking-tight">C</span>
        </div>
      </div>
      <p className="text-[#94A3B8] text-lg">Setting up your plan...</p>
    </div>
  )
}
