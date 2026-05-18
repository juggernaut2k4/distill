'use client'

import { motion } from 'framer-motion'
import type { ConceptDefinitionData } from '@/lib/templates/types'

interface ConceptDefinitionProps {
  data: ConceptDefinitionData
  isActive: boolean
  onReady?: () => void
}

export default function ConceptDefinition({ data, isActive, onReady }: ConceptDefinitionProps) {
  return (
    <div className="min-h-screen w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div
        className="flex-1 flex flex-col"
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        {/* Two-column layout */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-10 mt-4 mb-20">
          {/* Left column */}
          <div className="flex flex-col justify-center">
            {/* Category badge */}
            <motion.span
              initial={{ opacity: 0, x: -12 }}
              animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="inline-block mb-4 text-xs font-semibold uppercase tracking-widest text-[#06B6D4] border border-[#06B6D4]/30 rounded-full px-3 py-1 w-fit"
            >
              {data.category}
            </motion.span>

            {/* Term */}
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="text-5xl font-bold text-white tracking-tight leading-tight mb-4"
            >
              {data.term}
            </motion.h2>

            {/* One-liner */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={isActive ? { opacity: 1 } : { opacity: 0 }}
              transition={{ delay: 0.25, duration: 0.4 }}
              className="text-xl text-[#06B6D4] mb-5 leading-snug font-medium"
            >
              {data.one_line}
            </motion.p>

            {/* Plain English */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={isActive ? { opacity: 1 } : { opacity: 0 }}
              transition={{ delay: 0.35, duration: 0.4 }}
              className="text-base text-[#94A3B8] leading-relaxed"
            >
              {data.plain_english}
            </motion.p>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-5 justify-center">
            {/* Real-world example card */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="rounded-xl border border-[#222222] bg-[#111111] p-5"
            >
              <div className="text-xs font-semibold uppercase tracking-widest text-[#10B981] mb-2">
                Real-World Example
              </div>
              <div className="text-base font-semibold text-white mb-1">{data.real_world_example.company}</div>
              <p className="text-sm text-[#94A3B8] mb-3">{data.real_world_example.what_they_did}</p>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-[#10B981]/10 border border-[#10B981]/30 px-3 py-1 text-xs font-medium text-[#10B981]">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                {data.real_world_example.result}
              </div>
            </motion.div>

            {/* Common misconception card */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
              transition={{ delay: 0.45, duration: 0.5 }}
              className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-5"
            >
              <div className="text-xs font-semibold uppercase tracking-widest text-[#F59E0B] mb-2">
                Common Myth
              </div>
              <p className="text-sm text-[#94A3B8]">{data.common_misconception}</p>
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* So what strip */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.55, duration: 0.4 }}
        className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3"
      >
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
