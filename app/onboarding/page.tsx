'use client'

import { useState, useEffect, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { ProgressBar } from '@/components/onboarding/ProgressBar'
import { QuestionCard } from '@/components/onboarding/QuestionCard'
import { Button } from '@/components/ui/Button'
import { ArrowRight, ArrowLeft } from 'lucide-react'

const QUESTIONS = [
  {
    id: 'role',
    question: 'What is your role?',
    options: [
      'CEO / MD / President',
      'VP / SVP / EVP',
      'CU Lead / Practice Head',
      'BU Lead / Functional Head',
      'Product Sponsor / Owner',
      'Director / Senior Manager',
      'Other',
    ],
  },
  {
    id: 'industry',
    question: 'What industry are you in?',
    options: [
      'Technology / SaaS',
      'Financial Services / Banking',
      'Healthcare / Life Sciences',
      'Retail / E-commerce',
      'Manufacturing / Supply Chain',
      'Consulting / Professional Services',
      'Other',
    ],
  },
  {
    id: 'aiMaturity',
    question: 'How involved are you with AI today?',
    options: [
      'Just observing from a distance',
      'Evaluating AI vendors / solutions',
      'Running AI pilots in my team',
      'Scaling AI across my organization',
      'Other',
    ],
  },
  {
    id: 'worry',
    question: 'What worries you most about AI?',
    options: [
      'My job relevance / security',
      'Knowing if AI investments deliver ROI',
      'How to evaluate AI vendors and technology',
      'Upskilling my team for AI',
      'Falling behind competitors',
      'Other',
    ],
  },
  {
    id: 'deliveryPreference',
    question: 'How should we reach you?',
    options: [
      'Email only',
      'Both Email + SMS (Pro & Executive)',
      'SMS only (Pro & Executive)',
    ],
  },
]

const MATURITY_MAP: Record<string, string> = {
  'Just observing from a distance': 'observer',
  'Evaluating AI vendors / solutions': 'evaluator',
  'Running AI pilots in my team': 'pilot',
  'Scaling AI across my organization': 'scaler',
}

const DELIVERY_MAP: Record<string, string> = {
  'Email only': 'email',
  'Both Email + SMS (Pro & Executive)': 'both',
  'SMS only (Pro & Executive)': 'sms',
}

const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    price: '$12/mo',
    annual: '$99/yr',
    minutes: '30 min/mo',
    tagline: 'Learn AI at your pace',
    features: ['~1–2 coaching sessions/mo', 'Daily email insights', 'AI Readiness Score'],
    highlight: false,
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '$25/mo',
    annual: '$199/yr',
    minutes: '70 min/mo',
    tagline: 'Learn and walk in prepared',
    features: ['~2–4 coaching sessions/mo', 'Email + SMS insights', 'Ask Clio anything via SMS'],
    highlight: true,
  },
  {
    key: 'executive',
    name: 'Executive',
    price: '$49/mo',
    annual: '$399/yr',
    minutes: '150 min/mo',
    tagline: 'Learn, prepare, and apply',
    features: ['~5–10 coaching sessions/mo', 'Meeting Readiness briefs', 'Dedicated phone number'],
    highlight: false,
  },
]

function OnboardingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoaded, isSignedIn } = useUser()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [selectedLabels, setSelectedLabels] = useState<Record<string, string>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [direction, setDirection] = useState<'right' | 'left'>('right')
  const [building, setBuilding] = useState(false)
  const [showPlanSelect, setShowPlanSelect] = useState(false)
  // null = no pre-selected plan (show plan screen); non-null = skip plan screen
  const [preSelectedPlan, setPreSelectedPlan] = useState<string | null>(null)

  // If the user is already signed in, check whether they have a DB record.
  // If yes → go straight to dashboard. If no (just signed up, pending flush) → go to /checkout.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    async function checkProfile() {
      try {
        const res = await fetch('/api/user/preferences')
        if (res.ok) {
          router.replace('/dashboard')
        } else {
          router.replace('/checkout')
        }
      } catch {
        // Network error — stay on onboarding
      }
    }
    checkProfile()
  }, [isLoaded, isSignedIn, router])

  // If a plan is in the URL, pre-highlight that card in the plan selection screen
  useEffect(() => {
    const plan = searchParams.get('plan')
    if (plan) setPreSelectedPlan(plan)
  }, [searchParams])

  const current = QUESTIONS[step]
  const selectedLabel = selectedLabels[current?.id] ?? null
  const currentOtherText = otherTexts[current?.id] ?? ''
  const isOtherSelected = selectedLabel === 'Other'
  const hasOtherInOptions = current?.options.includes('Other') ?? false
  const currentAnswer = answers[current?.id] ?? null
  const canProceed = isOtherSelected
    ? currentOtherText.trim().length > 0
    : currentAnswer !== null && currentAnswer !== ''

  function handleSelect(option: string) {
    setSelectedLabels((prev) => ({ ...prev, [current.id]: option }))
    if (option !== 'Other') {
      setAnswers((prev) => ({ ...prev, [current.id]: option }))
    } else {
      const existingText = otherTexts[current.id] ?? ''
      setAnswers((prev) => ({ ...prev, [current.id]: existingText || '' }))
    }
  }

  function handleOtherTextChange(text: string) {
    setOtherTexts((prev) => ({ ...prev, [current.id]: text }))
    setAnswers((prev) => ({ ...prev, [current.id]: text }))
  }

  function handleBack() {
    if (showPlanSelect) {
      setShowPlanSelect(false)
      return
    }
    if (step === 0) return
    setDirection('left')
    setStep((s) => s - 1)
  }

  function handleNext() {
    if (!canProceed) return

    if (step < QUESTIONS.length - 1) {
      setDirection('right')
      setStep((s) => s + 1)
    } else {
      // Always show plan selection — URL param only pre-highlights a card
      setShowPlanSelect(true)
    }
  }

  function handlePlanSelect(planKey: string) {
    localStorage.setItem('clio_selected_plan', planKey)
    setBuilding(true)
    submitOnboarding()
  }

  async function submitOnboarding() {
    const payload = {
      role: answers.role,
      industry: answers.industry,
      aiMaturity: MATURITY_MAP[answers.aiMaturity] ?? 'observer',
      worry: answers.worry,
      deliveryPreference: DELIVERY_MAP[answers.deliveryPreference] ?? 'email',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
    localStorage.setItem('clio_onboarding', JSON.stringify(payload))

    setTimeout(() => {
      router.push('/sign-up')
    }, 2000)
  }

  if (building) {
    return <BuildingScreen />
  }

  if (showPlanSelect) {
    return <PlanSelectScreen defaultSelected={preSelectedPlan} onSelect={handlePlanSelect} onBack={() => setShowPlanSelect(false)} />
  }

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <ProgressBar current={step + 1} total={QUESTIONS.length} />

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <AnimatePresence mode="wait" custom={direction}>
          <QuestionCard
            key={step}
            question={current.question}
            options={current.options}
            selectedOption={selectedLabel}
            onSelect={handleSelect}
            direction={direction}
          />
        </AnimatePresence>

        {/* "Other" text input — appears below options when "Other" is selected */}
        <AnimatePresence>
          {isOtherSelected && hasOtherInOptions && (
            <motion.div
              key={`other-input-${step}`}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-sm mt-3"
            >
              <input
                type="text"
                autoFocus
                placeholder="Type your answer..."
                value={currentOtherText}
                onChange={(e) => handleOtherTextChange(e.target.value)}
                className="w-full bg-[#111111] border border-[#7C3AED] text-white rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#A855F7] placeholder-[#475569] transition-colors"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: canProceed ? 1 : 0 }}
          transition={{ duration: 0.3 }}
          className="mt-8 w-full max-w-sm flex items-center gap-3"
        >
          {step > 0 && (
            <button
              onClick={handleBack}
              className="flex items-center justify-center w-12 h-12 rounded-xl border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#555555] transition-colors flex-shrink-0"
              aria-label="Go back"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <Button
            onClick={handleNext}
            disabled={!canProceed}
            size="lg"
            className="flex-1 gap-2"
          >
            {step === QUESTIONS.length - 1 ? 'Build my plan' : 'Next'}
            <ArrowRight size={18} />
          </Button>
        </motion.div>

        {/* Step counter */}
        <p className="mt-6 text-sm text-[#475569]">
          {step + 1} of {QUESTIONS.length}
        </p>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#080808]" />}>
      <OnboardingContent />
    </Suspense>
  )
}

function PlanSelectScreen({ defaultSelected, onSelect, onBack }: { defaultSelected: string | null; onSelect: (plan: string) => void; onBack: () => void }) {
  const [selected, setSelected] = useState<string | null>(defaultSelected ?? null)

  return (
    <motion.div
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6 py-16"
    >
      <p className="text-xs font-semibold tracking-widest text-[#7C3AED] uppercase mb-4">Almost there</p>
      <h2 className="text-3xl font-bold text-white text-center mb-2">Choose your plan</h2>
      <p className="text-[#94A3B8] text-center mb-10 max-w-md">
        All plans include a 3-day free trial. Card required to activate.
      </p>

      <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {PLANS.map((plan) => {
          const isSelected = selected === plan.key
          return (
            <button
              key={plan.key}
              onClick={() => setSelected(plan.key)}
              className={[
                'text-left rounded-2xl border p-5 transition-all duration-200 relative',
                isSelected
                  ? 'border-[#7C3AED] bg-purple-950/30'
                  : plan.highlight
                    ? 'border-[#7C3AED]/50 bg-[#111111] hover:border-[#7C3AED]'
                    : 'border-[#222222] bg-[#111111] hover:border-[#333333]',
              ].join(' ')}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#7C3AED] text-white text-xs font-bold px-3 py-1 rounded-full">
                  Most popular
                </span>
              )}
              <p className="text-white font-bold text-lg mb-0.5">{plan.name}</p>
              <p className="text-[#7C3AED] font-bold text-2xl mb-0.5">{plan.price}</p>
              <p className="text-[#475569] text-xs mb-3">{plan.annual} billed annually</p>
              <p className="text-[#94A3B8] text-sm mb-3">{plan.minutes} · {plan.tagline}</p>
              <ul className="space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-[#94A3B8]">
                    <span className="text-[#10B981] mt-0.5">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          )
        })}
      </div>

      <div className="w-full max-w-sm flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-12 h-12 rounded-xl border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#555555] transition-colors flex-shrink-0"
        >
          <ArrowLeft size={18} />
        </button>
        <Button
          onClick={() => selected && onSelect(selected)}
          disabled={!selected}
          size="lg"
          className="flex-1 gap-2"
        >
          Continue with {selected ? PLANS.find(p => p.key === selected)?.name : 'a plan'}
          <ArrowRight size={18} />
        </Button>
      </div>
    </motion.div>
  )
}

function BuildingScreen() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6"
    >
      {/* Pulsing ring */}
      <div className="relative w-24 h-24 mb-8">
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full bg-[#7C3AED]"
        />
        <div className="relative w-24 h-24 rounded-full bg-[#7C3AED] flex items-center justify-center">
          <span className="text-2xl font-extrabold text-white tracking-tight">C</span>
        </div>
      </div>

      <h2 className="text-3xl font-bold text-white mb-3">Got it.</h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-[#94A3B8] text-center"
      >
        Creating your account to save your preferences...
      </motion.p>

      {/* Particle dots */}
      <div className="mt-8 flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            className="w-2 h-2 rounded-full bg-[#7C3AED]"
          />
        ))}
      </div>
    </motion.div>
  )
}
