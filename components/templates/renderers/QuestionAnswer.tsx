'use client'

import { motion } from 'framer-motion'
import type { QuestionAnswerData } from '@/lib/templates/types'

interface QuestionAnswerProps {
  data: QuestionAnswerData
  isActive: boolean
  onReady?: () => void
}

export default function QuestionAnswer({ data, isActive, onReady }: QuestionAnswerProps) {
  return (
    <div className="min-h-screen w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div
        className="flex-1 flex flex-col max-w-2xl mx-auto w-full pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        {/* Question */}
        <motion.blockquote
          initial={{ opacity: 0, y: 14 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="text-2xl italic text-[#94A3B8] leading-relaxed mb-6 border-l-2 border-[#7C3AED] pl-5"
        >
          &ldquo;{data.question}&rdquo;
        </motion.blockquote>

        {/* Direct answer */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="text-white text-lg font-medium leading-relaxed mb-7"
        >
          {data.direct_answer}
        </motion.p>

        {/* Analogy callout */}
        {data.analogy && (
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="rounded-xl border border-[#222222] bg-[#111111] p-5 mb-5"
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[#06B6D4] mb-2">Think of it like this</div>
            <p className="text-[#94A3B8] text-sm leading-relaxed">{data.analogy}</p>
          </motion.div>
        )}

        {/* Example */}
        {data.example && (
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="rounded-xl border border-[#222222] bg-[#111111] p-5 mb-5"
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[#F59E0B] mb-2">For example</div>
            <p className="text-[#94A3B8] text-sm leading-relaxed">{data.example}</p>
          </motion.div>
        )}

        {/* Important nuance */}
        {data.important_nuance && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={isActive ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 0.5, duration: 0.4 }}
            className="rounded-xl border border-[#A855F7]/30 bg-[#A855F7]/5 p-5 mb-6"
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[#A855F7] mb-2">Important nuance</div>
            <p className="text-[#94A3B8] text-sm leading-relaxed">{data.important_nuance}</p>
          </motion.div>
        )}

        {/* Returning to link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.6, duration: 0.4 }}
          className="flex items-center gap-2 text-sm text-[#475569] mt-auto"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          Returning to: <span className="text-[#94A3B8] ml-1">{data.returning_to}</span>
        </motion.div>
      </motion.div>

      {/* So what strip */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.65, duration: 0.4 }}
        className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3"
      >
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
