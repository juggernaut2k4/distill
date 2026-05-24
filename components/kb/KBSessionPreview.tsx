'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import type { TemplateSection } from '@/lib/templates/types'

interface Props {
  sections: TemplateSection[]
  activeSectionIndex: number
  onSectionChange: (index: number) => void
}

/**
 * KB-only preview of the session layout — mirrors what Recall.ai's headless
 * browser renders, but driven by topic_content_cache data instead of live
 * walkthrough_state. No polling, no skip button, no scroll-snap.
 * SessionStack (used in real sessions) is intentionally NOT modified.
 */
export default function KBSessionPreview({ sections, activeSectionIndex, onSectionChange }: Props) {
  const prevIndexRef = useRef(activeSectionIndex)

  useEffect(() => {
    prevIndexRef.current = activeSectionIndex
  }, [activeSectionIndex])

  if (sections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-[#080808] rounded-xl border border-[#1a1a1a]">
        <p className="text-[#475569] text-sm">No sections available.</p>
      </div>
    )
  }

  const activeSection = sections[activeSectionIndex]

  return (
    <div className="flex h-full overflow-hidden bg-[#080808] rounded-xl border border-[#1a1a1a]">

      {/* ── Sidebar ── */}
      <aside className="w-[180px] shrink-0 bg-[#0D0D0D] border-r border-[#1A1A1A] overflow-y-auto py-5 px-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-[#333333] mb-3 px-1.5">
          Sections
        </div>
        <nav className="flex flex-col gap-0.5">
          {sections.map((section, i) => {
            const isActive = i === activeSectionIndex
            const isDone = i < activeSectionIndex
            return (
              <button
                key={section.id}
                onClick={() => onSectionChange(i)}
                className={`flex items-center gap-2 rounded-lg px-1.5 py-2 text-left transition-colors w-full ${
                  isActive ? 'bg-[#1A1A1A]' : 'hover:bg-[#111111]'
                }`}
              >
                <span
                  className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                    isActive ? 'bg-[#06B6D4]' : isDone ? 'bg-[#10B981]' : 'bg-[#333333]'
                  }`}
                />
                <span
                  className={`text-[11px] leading-snug line-clamp-2 ${
                    isActive ? 'text-white font-medium' : 'text-[#475569]'
                  }`}
                >
                  {section.meta.subtopicTitle}
                </span>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* ── Main content area — shows active section only ── */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection.id + activeSection.type}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0"
          >
            <TemplateRenderer
              section={activeSection}
              isActive={true}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
