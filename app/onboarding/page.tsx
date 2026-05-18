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

  // If the user is already signed in, check whether they have a DB record.
  // If yes → go straight to dashboard. If no (just signed up, pending flush) → go to /checkout.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    async function checkProfile() {
      try {
        const res = await fetch('/api/user/preferences')
        if (res.ok) {
          // Profile exists — skip onboarding entirely
          router.replace('/dashboard')
        } else {
          // No profile yet (fresh sign-up) — flush localStorage data via /checkout
          router.replace('/checkout')
        }
      } catch {
        // Network error — stay on onboarding so user can complete it
      }
    }
    checkProfile()
  }, [isLoaded, isSignedIn, router])

  // Store selected plan from URL param so checkout knows which plan to use
  useEffect(() => {
    const plan = searchParams.get('plan')
    if (plan) localStorage.setItem('clio_selected_plan', plan)
  }, [searchParams])

  const current = QUESTIONS[step]
  const selectedLabel = selectedLabels[current?.id] ?? null
  const currentOtherText = otherTexts[current?.id] ?? ''
  const isOtherSelected = selectedLabel === 'Other'
  const hasOtherInOptions = current?.options.includes('Other') ?? false

  // The actual answer value: typed text if "Other" selected, otherwise the label
  const currentAnswer = answers[current?.id] ?? null
  const canProceed = isOtherSelected
    ? currentOtherText.trim().length > 0
    : currentAnswer !== null && currentAnswer !== ''

  function handleSelect(option: string) {
    setSelectedLabels((prev) => ({ ...prev, [current.id]: option }))
    if (option !== 'Other') {
      setAnswers((prev) => ({ ...prev, [current.id]: option }))
    } else {
      // Keep previous "Other" typed text if re-selecting "Other"
      const existingText = otherTexts[current.id] ?? ''
      setAnswers((prev) => ({ ...prev, [current.id]: existingText || '' }))
    }
  }

  function handleOtherTextChange(text: string) {
    setOtherTexts((prev) => ({ ...prev, [current.id]: text }))
    setAnswers((prev) => ({ ...prev, [current.id]: text }))
  }

  function handleBack() {
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
      // All questions answered — show building screen, then submit
      setBuilding(true)
      submitOnboarding()
    }
  }

  async function submitOnboarding() {
    // Save answers to localStorage — the API call happens AFTER Clerk auth
    // so the record is created with the real userId, not an anon one.
    const payload = {
      role: answers.role,
      industry: answers.industry,
      aiMaturity: MATURITY_MAP[answers.aiMaturity] ?? 'observer',
      worry: answers.worry,
      deliveryPreference: DELIVERY_MAP[answers.deliveryPreference] ?? 'email',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
    localStorage.setItem('clio_onboarding', JSON.stringify(payload))

    // After 2 seconds of animation, redirect to sign-up
    setTimeout(() => {
      router.push('/sign-up')
    }, 2000)
  }

  if (building) {
    return <BuildingScreen />
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
