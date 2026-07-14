'use client'

import { motion } from 'framer-motion'
import type { ChevronProcessData } from '@/lib/templates/types'

interface ChevronProcessProps { data: ChevronProcessData; isActive: boolean; onReady?: () => void }

// A 4-stop gradient from the partner's primary brand color to their secondary
// (Clio's own #7C3AED -> #06B6D4 preserved as the fallback blend when no
// partner theme is configured).
const CHEVRON_COLORS = [
  'var(--partner-primary, #7C3AED)',
  'color-mix(in srgb, var(--partner-primary, #7C3AED) 67%, var(--partner-secondary, #06B6D4) 33%)',
  'color-mix(in srgb, var(--partner-primary, #7C3AED) 33%, var(--partner-secondary, #06B6D4) 67%)',
  'var(--partner-secondary, #06B6D4)',
]

export default function ChevronProcess({ data, isActive, onReady }: ChevronProcessProps) {
  // Cap stages at 4
  const stages = data.stages.slice(0, 4)

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
        <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
        <p className="text-[#94A3B8] text-sm">{data.context}</p>
      </div>

      {/* Chevron row — horizontal on md+, stacked vertically on mobile */}
      <div className="hidden md:flex items-stretch gap-0 flex-1 min-h-0 max-h-[220px]">
        {stages.map((stage, i) => {
          const color = CHEVRON_COLORS[i % CHEVRON_COLORS.length]
          const isFirst = i === 0
          const clipPath = isFirst
            ? `polygon(0 0, calc(100% - 20px) 0, 100% 50%, calc(100% - 20px) 100%, 0 100%)`
            : `polygon(0 0, calc(100% - 20px) 0, 100% 50%, calc(100% - 20px) 100%, 0 100%, 20px 50%)`

          return (
            <motion.div
              key={i}
              className="flex-1 flex flex-col justify-center px-6 py-4 text-white"
              style={{
                clipPath,
                backgroundColor: color,
                marginLeft: i > 0 ? '-2px' : 0,
                zIndex: stages.length - i,
              }}
              initial={{ opacity: 0, x: -20 }}
              animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
              transition={{ delay: 0.1 + i * 0.1, duration: 0.4 }}
            >
              <p className="font-bold text-sm leading-tight mb-2">{stage.name}</p>
              <p className="text-white/80 text-base leading-relaxed line-clamp-3">{stage.description}</p>
              <p className="text-white/60 text-sm mt-2 italic line-clamp-2">{stage.key_action}</p>
            </motion.div>
          )
        })}
      </div>

      {/* Mobile stacked stages */}
      <div className="flex md:hidden flex-col gap-2 flex-1">
        {stages.map((stage, i) => {
          const color = CHEVRON_COLORS[i % CHEVRON_COLORS.length]
          return (
            <motion.div
              key={i}
              className="flex items-start gap-3 rounded-xl px-4 py-3 text-white"
              style={{ backgroundColor: color }}
              initial={{ opacity: 0, y: 12 }}
              animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
              transition={{ delay: 0.1 + i * 0.1, duration: 0.4 }}
            >
              <span className="shrink-0 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm leading-tight mb-1">{stage.name}</p>
                <p className="text-white/80 text-base leading-relaxed">{stage.description}</p>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Outcome strip */}
      <motion.div
        className="mt-6 rounded-xl border border-[#10B981]/40 bg-[#10B981]/10 px-6 py-4 flex items-center gap-3"
        initial={{ opacity: 0, y: 10 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ delay: 0.5, duration: 0.4 }}
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-[#10B981] shrink-0">Outcome</span>
        <span className="text-white text-sm">{data.outcome}</span>
      </motion.div>

      {/* So what footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_20%,transparent)] border-t border-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_30%,transparent)] px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_75%,white)] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </div>
    </motion.div>
  )
}
