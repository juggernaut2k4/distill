'use client'

import { motion } from 'framer-motion'
import type { ProsConsData } from '@/lib/templates/types'

interface ProsConsProps {
  data: ProsConsData
  isActive: boolean
  onReady?: () => void
}

export default function ProsCons({ data, isActive, onReady }: ProsConsProps) {
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
        <div className="mb-7">
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

        {/* Two columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Pros */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 rounded-full bg-[#10B981]" />
              <h3 className="text-[#10B981] font-semibold text-base uppercase tracking-wide">Advantages</h3>
            </div>
            <div className="flex flex-col gap-3">
              {data.pros.map((pro, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -12 }}
                  animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
                  transition={{ delay: 0.25 + i * 0.1, duration: 0.35 }}
                  className="rounded-lg border-l-2 border-[#10B981] bg-[#111111] border-y border-r border-[#222222] p-4"
                >
                  <div className="text-white font-semibold text-sm mb-1">{pro.title}</div>
                  <p className="text-[#94A3B8] text-xs leading-relaxed">{pro.description}</p>
                  {pro.evidence && (
                    <p className="text-[#475569] text-xs mt-2 italic">{pro.evidence}</p>
                  )}
                </motion.div>
              ))}
            </div>
          </div>

          {/* Cons */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 rounded-full bg-[#EF4444]" />
              <h3 className="text-[#EF4444] font-semibold text-base uppercase tracking-wide">Risks</h3>
            </div>
            <div className="flex flex-col gap-3">
              {data.cons.map((con, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 12 }}
                  animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: 12 }}
                  transition={{ delay: 0.25 + i * 0.1, duration: 0.35 }}
                  className="rounded-lg border-l-2 border-[#EF4444] bg-[#111111] border-y border-r border-[#222222] p-4"
                >
                  <div className="text-white font-semibold text-sm mb-1">{con.title}</div>
                  <p className="text-[#94A3B8] text-xs leading-relaxed">{con.description}</p>
                  {con.mitigation && (
                    <p className="text-[#06B6D4] text-xs mt-2">
                      <span className="font-medium">Mitigation: </span>
                      {con.mitigation}
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Verdict */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ delay: 0.7, duration: 0.4 }}
          className="rounded-xl border border-[#333333] bg-[#111111] p-5"
        >
          <div className="text-xs font-semibold uppercase tracking-widest text-[#A855F7] mb-2">Verdict</div>
          <p className="text-white text-base">{data.verdict}</p>
        </motion.div>
      </motion.div>

      {/* So what strip */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.8, duration: 0.4 }}
        className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3"
      >
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
