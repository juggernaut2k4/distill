'use client'

import { motion } from 'framer-motion'
import type { CaseStudyData } from '@/lib/templates/types'

interface CaseStudyProps {
  data: CaseStudyData
  isActive: boolean
  onReady?: () => void
}

export default function CaseStudy({ data, isActive, onReady }: CaseStudyProps) {
  return (
    <div className="min-h-screen w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div
        className="flex-1 flex flex-col pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        {/* Company header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="flex items-center gap-4 mb-6"
        >
          <h2 className="text-4xl font-bold text-white">{data.company}</h2>
          <span className="inline-flex items-center rounded-full border border-[#06B6D4]/30 bg-[#06B6D4]/10 px-3 py-1 text-xs font-medium text-[#06B6D4]">
            {data.industry}
          </span>
          {data.company_size && (
            <span className="text-xs text-[#475569]">{data.company_size}</span>
          )}
        </motion.div>

        {/* Challenge → Solution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="rounded-xl border border-[#222222] bg-[#111111] p-5"
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[#EF4444] mb-2">The Challenge</div>
            <p className="text-[#94A3B8] text-sm leading-relaxed italic">&ldquo;{data.challenge}&rdquo;</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: 12 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="rounded-xl border border-[#222222] bg-[#111111] p-5"
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[#7C3AED] mb-2">The AI Solution</div>
            <p className="text-[#94A3B8] text-sm leading-relaxed">{data.ai_solution}</p>
          </motion.div>
        </div>

        {/* Results stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="grid gap-4 mb-6"
          style={{ gridTemplateColumns: `repeat(${Math.min(data.results.length, 3)}, 1fr)` }}
        >
          {data.results.map((result, i) => (
            <div
              key={i}
              className="rounded-xl border border-[#222222] bg-[#111111] p-5 text-center"
            >
              <div className="text-2xl font-bold text-[#06B6D4] mb-1">{result.value}</div>
              <div className="text-sm text-[#94A3B8]">{result.metric}</div>
              {result.timeframe && (
                <div className="text-xs text-[#475569] mt-1">{result.timeframe}</div>
              )}
            </div>
          ))}
        </motion.div>

        {/* Lessons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ delay: 0.5, duration: 0.4 }}
            className="rounded-xl border border-[#10B981]/30 bg-[#10B981]/5 p-5"
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[#10B981] mb-2">What They Got Right</div>
            <p className="text-[#94A3B8] text-sm">{data.what_they_got_right}</p>
          </motion.div>

          {data.what_they_got_wrong && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={{ delay: 0.55, duration: 0.4 }}
              className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-5"
            >
              <div className="text-xs font-semibold uppercase tracking-widest text-[#F59E0B] mb-2">What They Learned</div>
              <p className="text-[#94A3B8] text-sm">{data.what_they_got_wrong}</p>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* So what strip — uses so_what_for_you */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.65, duration: 0.4 }}
        className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3"
      >
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what_for_you}</span>
      </motion.div>
    </div>
  )
}
