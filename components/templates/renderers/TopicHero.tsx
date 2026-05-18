'use client'

import { motion } from 'framer-motion'
import type { TopicHeroData } from '@/lib/templates/types'

interface TopicHeroProps {
  data: TopicHeroData
  isActive: boolean
  onReady?: () => void
}

export default function TopicHero({ data, isActive, onReady }: TopicHeroProps) {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden bg-[#080808] px-8 md:px-16 py-12">
      {/* Radial gradient background glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(124,58,237,0.18) 0%, transparent 70%)',
        }}
      />

      <motion.div
        className="relative z-10 flex flex-col items-center text-center max-w-3xl mx-auto"
        initial={{ opacity: 0, y: 40 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        onAnimationComplete={() => {
          if (isActive) onReady?.()
        }}
      >
        {/* Topic badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={isActive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#7C3AED]/40 bg-[#7C3AED]/10 px-4 py-1.5 text-sm font-medium text-[#A855F7]"
        >
          Topic {data.topic_number} of {data.total_topics}
        </motion.div>

        {/* Topic name */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="text-6xl font-extrabold tracking-tight text-white leading-tight mb-6"
        >
          {data.topic_name}
        </motion.h1>

        {/* Key question */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="text-xl text-[#94A3B8] leading-relaxed max-w-xl mb-10"
        >
          {data.key_question}
        </motion.p>

        {/* Estimated time */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="flex items-center gap-2 text-sm text-[#475569]"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6l4 2" />
          </svg>
          {data.estimated_minutes} min read
        </motion.div>
      </motion.div>

      {/* Bottom so_what strip */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3"
      >
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what_preview}</span>
      </motion.div>
    </div>
  )
}
