'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { ProgressBar } from '@/components/onboarding/ProgressBar'
import { QuestionCard } from '@/components/onboarding/QuestionCard'
import { Button } from '@/components/ui/Button'
import { ArrowRight } from 'lucide-react'

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
    ],
  },
  {
    id: 'deliveryPreference',
    question: 'How should we reach you?',
    options: [
      'Email only',
      'SMS only',
      'Both Email + SMS',
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
  'SMS only': 'sms',
  'Both Email + SMS': 'both',
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [direction, setDirection] = useState<'right' | 'left'>('right')
  const [building, setBuilding] = useState(false)

  const current = QUESTIONS[step]
  const selectedOption = answers[current?.id] ?? null

  function handleSelect(option: string) {
    setAnswers((prev) => ({ ...prev, [current.id]: option }))
  }

  function handleNext() {
    if (!selectedOption) return

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
    const payload = {
      role: answers.role,
      industry: answers.industry,
      aiMaturity: MATURITY_MAP[answers.aiMaturity] ?? 'observer',
      worry: answers.worry,
      deliveryPreference: DELIVERY_MAP[answers.deliveryPreference] ?? 'email',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }

    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      // Non-fatal — we still redirect
    }

    // After 2 seconds of "building" animation, redirect to sign-up
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
            selectedOption={selectedOption}
            onSelect={handleSelect}
            direction={direction}
          />
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: selectedOption ? 1 : 0 }}
          transition={{ duration: 0.3 }}
          className="mt-8 w-full max-w-sm"
        >
          <Button
            onClick={handleNext}
            disabled={!selectedOption}
            size="lg"
            className="w-full gap-2"
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

      <h2 className="text-3xl font-bold text-white mb-3">Building your plan...</h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-[#94A3B8] text-center"
      >
        Calibrating your AI learning path...
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
