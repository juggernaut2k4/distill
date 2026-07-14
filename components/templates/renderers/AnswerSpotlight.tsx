'use client'

import { motion } from 'framer-motion'
import type { AnswerSpotlightData, TemplateMeta } from '@/lib/templates/types'

interface AnswerSpotlightProps {
  data: AnswerSpotlightData
  isActive: boolean
  onReady?: () => void
  headerEnabled?: boolean
  // TMPL-07 (Section 4.5) — this renderer currently only receives `data`, not
  // the full `section`, so `meta` must be threaded in separately to reach
  // `meta.subtopicTitle` for the new title-only header.
  meta?: TemplateMeta
}

export default function AnswerSpotlight({ data, isActive, onReady, headerEnabled, meta }: AnswerSpotlightProps) {
  // Build context cards — only render non-null fields
  const contextCards: Array<{ label: string; text: string; border: string; labelColor: string }> = []

  if (data.analogy) {
    contextCards.push({
      label: 'Analogy',
      text: data.analogy,
      border: 'border-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_40%,transparent)]',
      labelColor: 'text-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_75%,white)]',
    })
  }
  if (data.example) {
    contextCards.push({
      label: 'Example',
      text: data.example,
      border: 'border-[color-mix(in_srgb,var(--partner-secondary,#06B6D4)_40%,transparent)]',
      labelColor: 'text-[var(--partner-secondary,#06B6D4)]',
    })
  }
  if (data.important_nuance) {
    contextCards.push({
      label: 'Important Nuance',
      text: data.important_nuance,
      border: 'border-[color-mix(in_srgb,var(--partner-accent,#F59E0B)_40%,transparent)]',
      labelColor: 'text-[var(--partner-accent,#F59E0B)]',
    })
  }

  return (
    <motion.div
      className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12 pb-20"
      initial={{ opacity: 0, y: 20 }}
      animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5 }}
      onAnimationComplete={() => { if (isActive) onReady?.() }}
    >
      {headerEnabled && <h2 className="text-3xl font-bold text-white mb-4">{meta?.subtopicTitle}</h2>}
      {/* Top: question + direct answer */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 12 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
        transition={{ delay: 0.1, duration: 0.45 }}
      >
        <p className="text-[var(--partner-secondary,#06B6D4)] text-xl md:text-2xl font-semibold leading-snug mb-4">
          {data.question}
        </p>
        <p className="text-white text-base md:text-lg leading-relaxed">{data.direct_answer}</p>
      </motion.div>

      {/* Bottom: context cards */}
      {contextCards.length > 0 && (
        <div
          className="grid gap-4 flex-1 min-h-0"
          style={{ gridTemplateColumns: `repeat(${Math.min(contextCards.length, 3)}, 1fr)` }}
        >
          {contextCards.map((card, i) => (
            <motion.div
              key={i}
              className={`rounded-xl border-2 ${card.border} bg-[#111111] p-5 flex flex-col`}
              initial={{ opacity: 0, y: 14 }}
              animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
              transition={{ delay: 0.25 + i * 0.1, duration: 0.4 }}
            >
              <p className={`text-xs font-semibold uppercase tracking-widest ${card.labelColor} mb-3`}>
                {card.label}
              </p>
              <p className="text-[#94A3B8] text-base leading-relaxed flex-1">{card.text}</p>
            </motion.div>
          ))}
        </div>
      )}

      {/* So what footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_20%,transparent)] border-t border-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_30%,transparent)] px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_75%,white)] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </div>
    </motion.div>
  )
}
