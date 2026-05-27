'use client'

import { motion } from 'framer-motion'
import type { DefinitionTriptychData } from '@/lib/templates/types'

interface DefinitionTriptychProps { data: DefinitionTriptychData; isActive: boolean; onReady?: () => void }

export default function DefinitionTriptych({ data, isActive, onReady }: DefinitionTriptychProps) {
  return (
    <motion.div
      className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12 pb-20"
      initial={{ opacity: 0, y: 20 }}
      animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5 }}
      onAnimationComplete={() => { if (isActive) onReady?.() }}
    >
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#7C3AED]/20 text-[#A855F7] border border-[#7C3AED]/30">
            {data.category}
          </span>
        </div>
        <h2 className="text-4xl font-extrabold text-white tracking-tight">{data.term}</h2>
      </div>

      {/* 3 panels */}
      <div className="grid grid-cols-3 gap-5 flex-1 min-h-0">

        {/* Panel 1 — What It Is */}
        <motion.div
          className="rounded-xl border-2 border-[#7C3AED]/50 bg-[#111111] p-6 flex flex-col"
          initial={{ opacity: 0, y: 16 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">📖</span>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#A855F7]">What It Is</p>
          </div>
          <p className="text-white font-bold text-base mb-3">{data.term}</p>
          <p className="text-[#94A3B8] text-sm leading-relaxed flex-1">{data.what_it_is}</p>
        </motion.div>

        {/* Panel 2 — Real Example */}
        <motion.div
          className="rounded-xl border-2 border-[#06B6D4]/50 bg-[#111111] p-6 flex flex-col"
          initial={{ opacity: 0, y: 16 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
          transition={{ delay: 0.25, duration: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">🏢</span>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#06B6D4]">Real Example</p>
          </div>
          <p className="text-white font-bold text-sm mb-2">{data.real_example.company}</p>
          <p className="text-[#94A3B8] text-sm leading-relaxed mb-3 flex-1">{data.real_example.what}</p>
          <div className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/5 px-3 py-2">
            <p className="text-[#10B981] text-xs leading-snug">{data.real_example.result}</p>
          </div>
        </motion.div>

        {/* Panel 3 — Common Myth */}
        <motion.div
          className="rounded-xl border-2 border-[#F59E0B]/50 bg-[#111111] p-6 flex flex-col"
          initial={{ opacity: 0, y: 16 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
          transition={{ delay: 0.35, duration: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">⚠️</span>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#F59E0B]">Common Myth</p>
          </div>
          <p className="text-[#94A3B8] text-sm leading-relaxed flex-1">{data.common_myth}</p>
        </motion.div>
      </div>

      {/* So what footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </div>
    </motion.div>
  )
}
