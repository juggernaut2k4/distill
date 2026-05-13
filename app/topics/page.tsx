'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'

const TOPIC_GROUPS = [
  {
    category: 'AI Strategy & Leadership',
    color: '#7C3AED',
    topics: [
      'AI Strategy for Executives',
      'Building an AI-Ready Culture',
      'AI Governance & Risk',
      'Measuring AI ROI',
      'AI Vendor Evaluation',
    ],
  },
  {
    category: 'Technology Foundations',
    color: '#06B6D4',
    topics: [
      'How Large Language Models Work',
      'Generative AI Fundamentals',
      'Machine Learning Basics',
      'Data Strategy & Infrastructure',
      'AI Security & Privacy',
    ],
  },
  {
    category: 'Operational AI',
    color: '#10B981',
    topics: [
      'AI in Operations & Supply Chain',
      'AI for Customer Experience',
      'Process Automation with AI',
      'AI in Finance & Forecasting',
      'HR & Talent with AI',
    ],
  },
  {
    category: 'Team & Org',
    color: '#F59E0B',
    topics: [
      'Upskilling Your Team for AI',
      'AI Project Management',
      'Change Management for AI',
      'Building AI Product Teams',
      'AI Ethics & Responsible Use',
    ],
  },
  {
    category: 'Competitive Edge',
    color: '#A855F7',
    topics: [
      'AI Competitive Intelligence',
      'Industry-Specific AI Use Cases',
      'AI in Product Development',
      'Emerging AI Trends',
      'AI Regulation & Compliance',
    ],
  },
]

const MAX_TOPICS = 5

export default function TopicsPage() {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  function toggleTopic(topic: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(topic)) {
        next.delete(topic)
      } else if (next.size < MAX_TOPICS) {
        next.add(topic)
      }
      return next
    })
  }

  async function handleContinue() {
    setSaving(true)
    try {
      await fetch('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics: Array.from(selected) }),
      })
    } catch {
      // non-fatal
    }
    router.push('/dashboard/plan')
  }

  function handleSkip() {
    router.push('/dashboard/plan')
  }

  return (
    <div className="min-h-screen bg-[#080808]">
      {/* Header */}
      <div className="border-b border-[#222222] px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-extrabold text-white tracking-tight">
          Clio <span className="text-[#7C3AED] text-xs font-semibold uppercase tracking-widest ml-1">AI</span>
        </span>
        <button
          onClick={handleSkip}
          className="text-sm text-[#475569] hover:text-[#94A3B8] transition-colors"
        >
          Skip for now →
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-950/40 border border-purple-800/30 text-[#A855F7] text-sm font-medium mb-5">
            <Sparkles size={14} />
            Optional but recommended
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-3">
            What topics matter most to you?
          </h1>
          <p className="text-[#94A3B8] text-lg">
            Pick up to {MAX_TOPICS} topics. Clio will build your curriculum around them.
          </p>
        </motion.div>

        {/* Selection counter */}
        <AnimatePresence>
          {selected.size > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 flex items-center justify-between px-4 py-3 rounded-xl bg-[#111111] border border-[#222222]"
            >
              <span className="text-sm text-[#94A3B8]">
                <span className="text-white font-bold">{selected.size}</span> of {MAX_TOPICS} selected
              </span>
              <div className="flex gap-1">
                {Array.from(selected).slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="text-xs px-2 py-0.5 rounded-full bg-purple-950/50 border border-purple-800/40 text-[#A855F7] truncate max-w-[100px]"
                  >
                    {t}
                  </span>
                ))}
                {selected.size > 3 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#1A1A1A] border border-[#333] text-[#475569]">
                    +{selected.size - 3}
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Topic groups */}
        <div className="space-y-8">
          {TOPIC_GROUPS.map((group, gi) => (
            <motion.div
              key={group.category}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: gi * 0.07 }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                <h3 className="text-sm font-semibold text-[#94A3B8] uppercase tracking-wider">
                  {group.category}
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.topics.map((topic) => {
                  const isSelected = selected.has(topic)
                  const isDisabled = !isSelected && selected.size >= MAX_TOPICS

                  return (
                    <motion.button
                      key={topic}
                      onClick={() => toggleTopic(topic)}
                      disabled={isDisabled}
                      whileTap={{ scale: isDisabled ? 1 : 0.97 }}
                      className={`
                        relative flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm font-medium transition-all duration-200
                        ${isSelected
                          ? 'bg-purple-950/40 border-[#7C3AED] text-white shadow-sm shadow-purple-900/30'
                          : isDisabled
                            ? 'bg-[#0D0D0D] border-[#1A1A1A] text-[#333] cursor-not-allowed'
                            : 'bg-[#111111] border-[#222222] text-[#94A3B8] hover:border-[#333] hover:text-white hover:bg-[#1A1A1A]'
                        }
                      `}
                    >
                      <div
                        className={`
                          w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-all
                          ${isSelected ? 'bg-[#7C3AED] border-[#7C3AED]' : 'border-[#333] bg-transparent'}
                        `}
                      >
                        {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                      </div>
                      {topic}
                    </motion.button>
                  )
                })}
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-10 flex flex-col sm:flex-row items-center gap-4 justify-center"
        >
          <Button
            onClick={handleContinue}
            disabled={saving}
            size="lg"
            className="w-full sm:w-auto gap-2 min-w-[220px]"
          >
            {saving ? 'Building your plan...' : selected.size > 0 ? 'Build my plan' : 'Use recommended topics'}
            <ArrowRight size={18} />
          </Button>
          {selected.size === 0 && (
            <p className="text-xs text-[#475569]">
              Skip topic selection and we&apos;ll use your profile to build a default curriculum
            </p>
          )}
        </motion.div>
      </div>
    </div>
  )
}
