'use client'

import { motion } from 'framer-motion'
import { Circle, CircleSlash } from 'lucide-react'
import type { SessionOverviewData } from '@/lib/templates/types'

interface SessionOverviewProps { data: SessionOverviewData; isActive: boolean; onReady?: () => void }

/**
 * SCREEN-01 — dedicated Session Overview screen, always sections[0].
 * Renders the fixed agenda + framing line assembled in code at pipeline-build
 * time (never LLM-generated). See docs/specs/SCREEN-01-requirement-document.md
 * Section 6 / Decision C for the exact copy this renders.
 */
export default function SessionOverview({ data, isActive, onReady }: SessionOverviewProps) {
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
          <p className="text-xs font-semibold tracking-widest uppercase text-[#7C3AED] mb-3">
            Today&apos;s session
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight tracking-tight">
            {data.session_title}
          </h1>
        </div>

        <div className="border border-[#222222] rounded-xl p-5 bg-[#111111]">
          <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide mb-4">
            Here&apos;s what we&apos;ll cover:
          </p>
          <ol className="flex flex-col gap-3">
            {data.agenda.map((item, i) => (
              <motion.li
                key={i}
                className="flex gap-3 items-start"
                initial={{ opacity: 0, x: -10 }}
                animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.35 }}
              >
                {item.skipped ? (
                  <CircleSlash className="text-[#475569] mt-0.5 shrink-0" size={16} />
                ) : (
                  <Circle className="text-[#06B6D4] mt-0.5 shrink-0" size={16} />
                )}
                <span
                  className={
                    item.skipped
                      ? 'text-[#475569] text-sm leading-snug line-through'
                      : 'text-[#E2E8F0] text-sm leading-snug'
                  }
                >
                  {i + 1}. {item.subtopic_title}
                </span>
              </motion.li>
            ))}
          </ol>
        </div>

        <motion.div
          className="flex gap-3 items-start border border-[#7C3AED]/30 rounded-xl p-5 bg-[#7C3AED]/10"
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.8, duration: 0.4 }}
        >
          <p className="text-white text-sm leading-snug">{data.framing_line}</p>
        </motion.div>
      </motion.div>
    </div>
  )
}
