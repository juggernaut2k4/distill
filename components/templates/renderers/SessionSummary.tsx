'use client'

import { motion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import type { SessionSummaryData } from '@/lib/templates/types'

interface SessionSummaryProps { data: SessionSummaryData; isActive: boolean; onReady?: () => void }

/**
 * SCREEN-01 — dedicated Session Summary screen, always the final element of
 * `sections` (index N+1). Renders the fixed closing line + covered-subtopics
 * list assembled in code (never LLM-generated). Skipped subtopics are simply
 * absent from `covered_subtopics` — see Section 6 / Decision D of the spec.
 */
export default function SessionSummary({ data, isActive, onReady }: SessionSummaryProps) {
  return (
    <div className="h-full w-full flex flex-col justify-center bg-[#080808] px-8 md:px-20 py-12">
      <motion.div
        className="max-w-2xl w-full mx-auto flex flex-col gap-8"
        initial={{ opacity: 0, y: 24 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
        transition={{ duration: 0.5 }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-[#10B981] mb-3">
            Session complete
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight tracking-tight">
            {data.session_title}
          </h1>
        </div>

        <div className="border border-[#222222] rounded-xl p-5 bg-[#111111]">
          <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide mb-4">
            Today you covered:
          </p>
          <ul className="flex flex-col gap-3">
            {data.covered_subtopics.map((title, i) => (
              <motion.li
                key={i}
                className="flex gap-3 items-start"
                initial={{ opacity: 0, x: -10 }}
                animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.35 }}
              >
                <CheckCircle2 className="text-[#10B981] mt-0.5 shrink-0" size={16} />
                <span className="text-[#E2E8F0] text-sm leading-snug">{title}</span>
              </motion.li>
            ))}
          </ul>
        </div>

        <motion.div
          className="flex gap-3 items-start border border-[#10B981]/30 rounded-xl p-5 bg-[#10B981]/10"
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.8, duration: 0.4 }}
        >
          <p className="text-white text-sm leading-snug">{data.closing_line}</p>
        </motion.div>
      </motion.div>
    </div>
  )
}
