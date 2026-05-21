'use client'

import { useState } from 'react'
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { motion } from 'framer-motion'
import { Lock, Loader2 } from 'lucide-react'

interface CheckoutFormProps {
  planName: string
  planPrice: number
  billingPeriod: 'monthly' | 'annual'
}

export default function CheckoutForm({ planName, planPrice, billingPeriod }: CheckoutFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setIsLoading(true)
    setErrorMessage(null)

    localStorage.removeItem('clio_selected_plan')
    localStorage.removeItem('clio_billing_period')

    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/dashboard/welcome`,
      },
    })

    // Only reached if Stripe could not redirect (error occurred)
    if (error) {
      console.error('[checkout] confirmSetup error:', error.type, error.code, error.message)
      setErrorMessage(error.message ?? 'Payment failed. Please try again.')
      setIsLoading(false)
    }
  }

  const billingLabel = billingPeriod === 'annual' ? '/yr' : '/mo'

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-white text-2xl font-bold">Enter payment details</h2>
        <p className="text-[#94A3B8] text-sm">
          3-day free trial. Card charged ${planPrice}{billingLabel} after trial. Cancel anytime.
        </p>
      </div>

      <div className="bg-[#111111] border border-[#222222] rounded-xl p-4">
        <PaymentElement
          options={{
            layout: 'tabs',
            fields: {
              billingDetails: {
                address: 'never',
              },
            },
          }}
        />
      </div>

      {errorMessage && (
        <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg px-4 py-3">
          <p className="text-[#EF4444] text-sm">{errorMessage}</p>
        </div>
      )}

      <motion.button
        type="submit"
        disabled={!stripe || isLoading}
        whileHover={{ scale: isLoading ? 1 : 1.02 }}
        whileTap={{ scale: isLoading ? 1 : 0.98 }}
        className="w-full py-4 px-6 bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 disabled:cursor-not-allowed rounded-xl text-white font-semibold text-base transition-colors flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Starting your trial...
          </>
        ) : (
          <>
            <Lock className="w-4 h-4" />
            Start 3-day trial — {planName}
          </>
        )}
      </motion.button>

      <div className="flex items-center justify-center gap-1.5 text-[#475569] text-xs">
        <Lock className="w-3 h-3" />
        <span>Secured by Stripe · SSL encrypted</span>
      </div>
    </form>
  )
}
