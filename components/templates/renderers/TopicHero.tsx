'use client'

import { motion } from 'framer-motion'
import { CheckCircle2, HelpCircle, Zap, Clock } from 'lucide-react'
import type { TopicHeroData } from '@/lib/templates/types'

interface TopicHeroProps { data: TopicHeroData; isActive: boolean; onReady?: () => void }

export default function TopicHero({ data, isActive, onReady }: TopicHeroProps) {
  return (
    <div className="h-full w-full flex flex-col justify-center bg-[#080808] px-8 md:px-20 py-12">
      <motion.div
        className="max-w-2xl w-full mx-auto flex flex-col gap-8"
        initial={{ opacity: 0, y: 24 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
        transition={{ duration: 0.5 }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        {/* Topic name */}
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-[#7C3AED] mb-3">Topic Overview</p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight tracking-tight">
            {data.topic_name}
          </h1>
        </div>

        {/* Key question */}
        <div className="flex gap-3 items-start border border-[#222222] rounded-xl p-5 bg-[#111111]">
          <HelpCircle className="text-[#06B6D4] mt-0.5 shrink-0" size={18} />
          <div>
            <p className="text-xs font-semibold text-[#06B6D4] uppercase tracking-wide mb-1">Key Question</p>
            <p className="text-white text-base leading-snug">{data.key_question}</p>
          </div>
        </div>

        {/* Key takeaways */}
        <div className="border border-[#222222] rounded-xl p-5 bg-[#111111]">
          <p className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide mb-4">What you&apos;ll walk away knowing</p>
          <ul className="flex flex-col gap-3">
            {(data.key_takeaways ?? []).map((t, i) => (
              <motion.li
                key={i}
                className="flex gap-3 items-start"
                initial={{ opacity: 0, x: -10 }}
                animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.35 }}
              >
                <CheckCircle2 className="text-[#10B981] mt-0.5 shrink-0" size={16} />
                <span className="text-[#E2E8F0] text-sm leading-snug">{t}</span>
              </motion.li>
            ))}
          </ul>
        </div>

        {/* Why now (optional) */}
        {data.why_now && (
          <motion.div
            className="flex gap-3 items-start border border-[#F59E0B]/20 rounded-xl p-4 bg-[#F59E0B]/5"
            initial={{ opacity: 0 }}
            animate={isActive ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 0.65, duration: 0.4 }}
          >
            <Clock className="text-[#F59E0B] mt-0.5 shrink-0" size={16} />
            <p className="text-[#F59E0B] text-sm leading-snug">{data.why_now}</p>
          </motion.div>
        )}

        {/* So what */}
        <motion.div
          className="flex gap-3 items-start border border-[#7C3AED]/30 rounded-xl p-5 bg-[#7C3AED]/10"
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.8, duration: 0.4 }}
        >
          <Zap className="text-[#A855F7] mt-0.5 shrink-0" size={16} />
          <div>
            <p className="text-xs font-semibold text-[#A855F7] uppercase tracking-wide mb-1">So what?</p>
            <p className="text-white text-sm leading-snug">{data.so_what_preview}</p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
