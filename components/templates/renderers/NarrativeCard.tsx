'use client'

import { motion } from 'framer-motion'
import type { NarrativeCardData } from '@/lib/templates/types'

interface NarrativeCardProps { data: NarrativeCardData; isActive: boolean; onReady?: () => void }

export default function NarrativeCard({ data, isActive, onReady }: NarrativeCardProps) {
  // Cap metrics at 3
  const metrics = data.metrics.slice(0, 3)

  return (
    <motion.div
      className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12 pb-20"
      initial={{ opacity: 0, y: 20 }}
      animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5 }}
      onAnimationComplete={() => { if (isActive) onReady?.() }}
    >
      {/* Header row */}
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-3xl font-bold text-white">{data.company}</h2>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#06B6D4]/20 text-[#06B6D4] border border-[#06B6D4]/30">
          {data.industry}
        </span>
      </div>

      {/* Main 3-column row */}
      <div className="grid grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Challenge */}
        <motion.div
          className="rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/5 p-5 flex flex-col"
          initial={{ opacity: 0, y: 12 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[#EF4444] mb-3">Challenge</p>
          <p className="text-white text-sm leading-relaxed flex-1">{data.challenge}</p>
        </motion.div>

        {/* Approach */}
        <motion.div
          className="rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/5 p-5 flex flex-col"
          initial={{ opacity: 0, y: 12 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          transition={{ delay: 0.25, duration: 0.4 }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[#A855F7] mb-3">Approach</p>
          <p className="text-white text-sm leading-relaxed flex-1">{data.approach}</p>
        </motion.div>

        {/* Impact */}
        <motion.div
          className="rounded-xl border border-[#10B981]/30 bg-[#10B981]/5 p-5 flex flex-col"
          initial={{ opacity: 0, y: 12 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          transition={{ delay: 0.35, duration: 0.4 }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-[#10B981] mb-3">Impact</p>
          <p className="text-white text-sm leading-relaxed flex-1">{data.impact}</p>
        </motion.div>
      </div>

      {/* Metrics strip */}
      <motion.div
        className="grid gap-4 mt-5"
        style={{ gridTemplateColumns: `repeat(${metrics.length}, 1fr)` }}
        initial={{ opacity: 0, y: 10 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ delay: 0.45, duration: 0.4 }}
      >
        {metrics.map((m, i) => (
          <div key={i} className="rounded-xl border border-[#222222] bg-[#111111] px-5 py-4 text-center">
            <div className="text-2xl font-extrabold text-[#06B6D4]">{m.value}</div>
            <div className="text-[#94A3B8] text-xs mt-1">{m.label}</div>
          </div>
        ))}
      </motion.div>

      {/* Lesson */}
      <motion.div
        className="mt-4 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 px-5 py-3 flex items-center gap-3"
        initial={{ opacity: 0 }}
        animate={isActive ? { opacity: 1 } : { opacity: 0 }}
        transition={{ delay: 0.55, duration: 0.4 }}
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-[#F59E0B] shrink-0">Lesson</span>
        <span className="text-white text-sm">{data.lesson}</span>
      </motion.div>

      {/* So what footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </div>
    </motion.div>
  )
}
