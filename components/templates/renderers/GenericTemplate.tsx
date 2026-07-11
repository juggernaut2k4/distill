'use client'

import { motion } from 'framer-motion'
import type { TemplateSection } from '@/lib/templates/types'

interface GenericTemplateProps {
  section: TemplateSection
  isActive: boolean
  onReady?: () => void
}

/**
 * Fallback renderer for templates not yet built (Funnel, Timeline, ConceptMap,
 * TwoByTwoMatrix, FrameworkCard, StatCallout, QuoteCallout, ActionPlan).
 * Renders template type, a professional data preview, and the so_what.
 */
export default function GenericTemplate({ section, isActive, onReady }: GenericTemplateProps) {
  // Extract so_what or so_what_for_you from data
  const data = section.data as unknown as Record<string, unknown>
  const soWhat =
    (data.so_what as string | undefined) ??
    (data.so_what_for_you as string | undefined) ??
    (data.action_for_you as string | undefined) ??
    ''

  // Get the top-level string and array fields to display
  const previewEntries = Object.entries(data)
    .filter(([key]) => !['so_what', 'so_what_for_you', 'action_for_you'].includes(key))
    .slice(0, 6)

  function renderValue(val: unknown): string {
    if (typeof val === 'string') return val
    if (typeof val === 'number') return String(val)
    if (Array.isArray(val)) {
      if (val.length === 0) return '—'
      const first = val[0]
      if (typeof first === 'string') return val.slice(0, 3).join(', ') + (val.length > 3 ? '…' : '')
      return `${val.length} items`
    }
    if (typeof val === 'object' && val !== null) return JSON.stringify(val).slice(0, 60) + '…'
    return String(val)
  }

  return (
    <div className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div
        className="flex-1 flex flex-col pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <div className="rounded-lg border border-[#7C3AED]/40 bg-[#7C3AED]/10 px-3 py-1 text-sm font-medium text-[#A855F7]">
            {section.type}
          </div>
          <h2 className="text-3xl font-bold text-white">{section.meta.subtopicTitle}</h2>
        </div>

        {/* Data grid preview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {previewEntries.map(([key, val], i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 10 }}
              animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.35 }}
              className="rounded-xl border border-[#222222] bg-[#111111] p-4"
            >
              <div className="text-xs font-semibold uppercase tracking-widest text-[#475569] mb-1.5">
                {key.replace(/_/g, ' ')}
              </div>
              <p className="text-[#94A3B8] text-sm leading-relaxed line-clamp-3">
                {renderValue(val)}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Template name note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={isActive ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="text-xs text-[#333333] text-center mt-auto"
        >
          Renderer for {section.type} — full visual coming soon
        </motion.p>
      </motion.div>

      {/* So what strip */}
      {soWhat && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ delay: 0.6, duration: 0.4 }}
          className="absolute bottom-0 left-0 right-0 h-[72px] bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3 overflow-hidden"
        >
          <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
          <span className="text-sm text-white line-clamp-2">{soWhat}</span>
        </motion.div>
      )}
    </div>
  )
}
