'use client'

import { motion } from 'framer-motion'
import type { KeyTakeawayData } from '@/lib/templates/types'

interface KeyTakeawayProps {
  data: KeyTakeawayData
  isActive: boolean
  onReady?: () => void
}

export default function KeyTakeaway({ data, isActive, onReady }: KeyTakeawayProps) {
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
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="flex items-center gap-3 mb-8"
        >
          <svg className="w-7 h-7 text-[#10B981]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h2 className="text-2xl font-bold text-white">Key Takeaways</h2>
            <p className="text-[#475569] text-sm">{data.topic}</p>
          </div>
        </motion.div>

        {/* Insights grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {data.insights.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.4 }}
              className="rounded-xl border border-[#222222] bg-[#111111] p-5"
            >
              <p className="text-white font-semibold text-sm leading-snug mb-3">{item.insight}</p>
              <div className="h-px bg-[#222222] mb-3" />
              <p className="text-[#94A3B8] text-xs leading-relaxed">{item.implication}</p>
            </motion.div>
          ))}
        </div>

        {/* One thing to remember */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={isActive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.97 }}
          transition={{ delay: 0.2 + data.insights.length * 0.1 + 0.1, duration: 0.5 }}
          className="text-center mb-6"
        >
          <div className="text-xs font-semibold uppercase tracking-widest text-[#A855F7] mb-3">
            One Thing to Remember
          </div>
          <blockquote className="text-2xl font-bold text-[#A855F7] leading-snug max-w-2xl mx-auto">
            &ldquo;{data.one_thing_to_remember}&rdquo;
          </blockquote>
        </motion.div>

        {/* Action for you */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ delay: 0.2 + data.insights.length * 0.1 + 0.3, duration: 0.4 }}
          className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-5 flex items-start gap-3 mb-4"
        >
          <svg className="w-5 h-5 text-[#F59E0B] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-[#F59E0B] mb-1">Action For You</div>
            <p className="text-white text-sm">{data.action_for_you}</p>
          </div>
        </motion.div>

        {/* Next topic preview */}
        {data.next_topic_preview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={isActive ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 0.2 + data.insights.length * 0.1 + 0.5, duration: 0.4 }}
            className="text-center text-sm text-[#475569]"
          >
            Up next: <span className="text-[#94A3B8]">{data.next_topic_preview}</span>
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
