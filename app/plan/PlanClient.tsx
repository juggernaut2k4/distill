'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'

const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    price: '$12/mo',
    annual: '$99/yr',
    minutes: '30 min/mo',
    tagline: 'Learn AI at your pace',
    highlight: false,
    features: [
      '~1–2 coaching sessions/mo',
      'Daily email insights',
      'AI Readiness Score',
      'Session summaries & notes',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '$25/mo',
    annual: '$199/yr',
    minutes: '70 min/mo',
    tagline: 'Learn and walk in prepared',
    highlight: true,
    features: [
      '~2–4 coaching sessions/mo',
      'Everything in Starter',
      'Email + SMS insights',
      'Ask Clio anything via SMS',
    ],
  },
  {
    key: 'executive',
    name: 'Executive',
    price: '$49/mo',
    annual: '$399/yr',
    minutes: '150 min/mo',
    tagline: 'Learn, prepare, and apply',
    highlight: false,
    features: [
      '~5–10 coaching sessions/mo',
      'Everything in Pro',
      'Meeting Readiness briefs',
      'Dedicated Clio phone number',
    ],
  },
] as const

type PlanKey = 'starter' | 'pro' | 'executive'

export default function PlanClient() {
  const router = useRouter()
  const [selected, setSelected] = useState<PlanKey>('starter')

  useEffect(() => {
    const stored = localStorage.getItem('clio_selected_plan') as PlanKey | null
    if (stored && PLANS.some((p) => p.key === stored)) {
      setSelected(stored)
    }
  }, [])

  function handleContinue() {
    localStorage.setItem('clio_selected_plan', selected)
    router.push(`/checkout?plan=${selected}`)
  }

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <div className="flex items-center justify-between px-8 py-6 border-b border-[#1a1a1a]">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-full bg-[#7C3AED] flex items-center justify-center">
            <span className="text-xs font-extrabold text-white">C</span>
          </div>
          <span className="text-white font-bold group-hover:text-[#A855F7] transition-colors">Clio</span>
        </Link>
        <p className="text-[#475569] text-sm">Step 2 of 2 — Choose your plan</p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-5xl"
        >
          <div className="text-center mb-10">
            <p className="text-xs font-bold tracking-widest text-[#7C3AED] uppercase mb-3">Almost there</p>
            <h1 className="text-3xl font-bold text-white mb-2">Choose your plan</h1>
            <p className="text-[#94A3B8] text-sm">All paid plans include a 3-day free trial. Cancel anytime.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {PLANS.map((plan, i) => {
              const isSelected = selected === plan.key
              return (
                <motion.button
                  key={plan.key}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: i * 0.07 }}
                  onClick={() => setSelected(plan.key)}
                  className={[
                    'relative text-left rounded-2xl border p-5 transition-all duration-200',
                    isSelected
                      ? 'border-[#7C3AED] bg-purple-950/30'
                      : plan.highlight
                        ? 'border-[#7C3AED]/40 bg-[#111111] hover:border-[#7C3AED]'
                        : 'border-[#222222] bg-[#111111] hover:border-[#444444]',
                  ].join(' ')}
                >
                  {plan.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#7C3AED] text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                      Most popular
                    </span>
                  )}
                  {isSelected && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#7C3AED] flex items-center justify-center">
                      <CheckCircle size={12} className="text-white" />
                    </div>
                  )}
                  <p className="text-[#475569] text-xs font-bold uppercase tracking-widest mb-1">{plan.name}</p>
                  <p className="text-white font-extrabold text-2xl mb-0.5">{plan.price}</p>
                  <p className="text-[#475569] text-xs mb-3">{plan.annual} billed annually</p>
                  <p className="text-[#94A3B8] text-xs mb-4">{plan.minutes} · {plan.tagline}</p>
                  <ul className="space-y-1.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-[#94A3B8]">
                        <span className={`mt-0.5 ${isSelected ? 'text-[#A855F7]' : 'text-[#10B981]'}`}>✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </motion.button>
              )
            })}
          </div>

          <div className="flex justify-center">
            <Button onClick={handleContinue} size="lg" className="w-full max-w-sm gap-2">
              Continue with {PLANS.find((p) => p.key === selected)?.name}
              <ArrowRight size={18} />
            </Button>
          </div>

          <p className="text-center text-xs text-[#475569] mt-5">
            3-day free trial on all plans. Card required. Cancel anytime.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
