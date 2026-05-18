'use client'

import { motion } from 'framer-motion'
import type { StepFlowData } from '@/lib/templates/types'

interface StepFlowProps {
  data: StepFlowData
  isActive: boolean
  onReady?: () => void
}

export default function StepFlow({ data, isActive, onReady }: StepFlowProps) {
  return (
    <div className="min-h-screen w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div
        className="flex-1 flex flex-col pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        {/* Header */}
        <div className="mb-8">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="text-3xl font-bold text-white mb-2"
          >
            {data.title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={isActive ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="text-[#94A3B8] text-base"
          >
            {data.context}
          </motion.p>
        </div>

        {/* Steps */}
        <div className="relative flex flex-col gap-0">
          {/* Vertical connector line */}
          <div
            aria-hidden="true"
            className="absolute left-[23px] top-10 bottom-20 w-px border-l-2 border-dashed border-[#333333]"
          />

          {data.steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, x: -16 }}
              animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -16 }}
              transition={{ delay: 0.25 + index * 0.12, duration: 0.4 }}
              className="relative flex gap-5 pb-7 last:pb-0"
            >
              {/* Number badge */}
              <div className="shrink-0 w-12 h-12 rounded-full bg-[#7C3AED] flex items-center justify-center text-white font-bold text-base z-10">
                {step.number}
              </div>

              {/* Content */}
              <div className="flex-1 pt-2">
                <div className="flex items-baseline gap-3 mb-1 flex-wrap">
                  <h3 className="text-white font-semibold text-base">{step.title}</h3>
                  {step.time_estimate && (
                    <span className="text-xs text-[#475569]">{step.time_estimate}</span>
                  )}
                </div>
                <p className="text-[#94A3B8] text-sm leading-relaxed mb-2">{step.description}</p>
                {step.what_to_watch_for && (
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3 py-1 text-xs text-[#F59E0B]">
                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    Watch for: {step.what_to_watch_for}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Outcome */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ delay: 0.25 + data.steps.length * 0.12 + 0.1, duration: 0.4 }}
          className="mt-6 rounded-xl border border-[#10B981]/30 bg-[#10B981]/5 p-5 flex items-start gap-3"
        >
          <svg className="w-5 h-5 text-[#10B981] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-[#10B981] mb-1">Outcome</div>
            <p className="text-white text-sm">{data.outcome}</p>
          </div>
        </motion.div>
      </motion.div>

      {/* So what strip */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.7, duration: 0.4 }}
        className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3"
      >
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
