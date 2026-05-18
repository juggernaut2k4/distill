'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { TemplateSection, SectionStatus } from '@/lib/templates/types'
import TemplateRenderer from './TemplateRenderer'

export interface SessionStackProps {
  sections: TemplateSection[]
  currentSectionIndex: number
  onSectionChange?: (index: number) => void
  userId: string
}

// Status dot colour map
const STATUS_COLORS: Record<SectionStatus, string> = {
  pending: 'bg-[#333333]',
  ready: 'bg-[#475569]',
  active: 'bg-[#06B6D4]',
  completed: 'bg-[#10B981]',
  skipped: 'bg-[#333333]',
  inserted: 'bg-[#F59E0B]',
}

/**
 * Full-screen stacked section layout with:
 * - Scroll-snap between full-screen sections
 * - Fixed left sidebar showing section titles + status dots
 * - Polls /api/walkthrough-state/[userId] every 2s for AI-driven scroll commands
 * - Skip button on each section
 */
export default function SessionStack({
  sections: initialSections,
  currentSectionIndex: initialIndex,
  onSectionChange,
  userId,
}: SessionStackProps) {
  const [sections, setSections] = useState<TemplateSection[]>(initialSections)
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastKnownIndexRef = useRef(initialIndex)

  // Sync sections if parent updates (e.g. newly inserted sections)
  useEffect(() => {
    setSections(initialSections)
  }, [initialSections])

  // Smooth-scroll to a given section index
  const scrollToSection = useCallback((index: number) => {
    const el = sectionRefs.current[index]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  // Update active index, mark previous as completed
  const activateSection = useCallback((index: number) => {
    if (index === lastKnownIndexRef.current) return
    setActiveIndex(index)
    setSections(prev =>
      prev.map((s, i) => {
        if (i === index) return { ...s, status: 'active' as SectionStatus }
        if (i < index && s.status !== 'skipped') return { ...s, status: 'completed' as SectionStatus }
        return s
      })
    )
    onSectionChange?.(index)
    lastKnownIndexRef.current = index
  }, [onSectionChange])

  // Scroll to and activate initial section
  useEffect(() => {
    if (initialIndex > 0) scrollToSection(initialIndex)
    activateSection(initialIndex)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll walkthrough-state for AI-driven scroll commands
  useEffect(() => {
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/walkthrough-state/${encodeURIComponent(userId)}`)
        if (!res.ok) return
        const data = (await res.json()) as {
          current_section_index?: number
          sections?: TemplateSection[]
        }

        // Handle inserted sections from AI
        if (data.sections && data.sections.length > sections.length) {
          setSections(data.sections)
        }

        // Handle scroll command
        if (
          typeof data.current_section_index === 'number' &&
          data.current_section_index !== lastKnownIndexRef.current
        ) {
          activateSection(data.current_section_index)
          scrollToSection(data.current_section_index)
        }
      } catch {
        // Silently fail — polling is best-effort
      }
    }, 2000)

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [userId, sections.length, activateSection, scrollToSection])

  // Handle skip: find next non-completed section
  const handleSkip = useCallback((currentIdx: number) => {
    const nextIdx = sections.findIndex(
      (s, i) => i > currentIdx && s.status !== 'completed' && s.status !== 'skipped'
    )
    if (nextIdx !== -1) {
      setSections(prev =>
        prev.map((s, i) => (i === currentIdx ? { ...s, status: 'skipped' as SectionStatus } : s))
      )
      activateSection(nextIdx)
      scrollToSection(nextIdx)
    }
  }, [sections, activateSection, scrollToSection])

  return (
    <div className="flex h-screen overflow-hidden bg-[#080808]">
      {/* ── Sidebar ── */}
      <aside
        aria-label="Session navigation"
        className="hidden md:flex flex-col w-[200px] shrink-0 bg-[#0D0D0D] border-r border-[#1A1A1A] overflow-y-auto py-6 px-3"
      >
        <div className="text-xs font-semibold uppercase tracking-widest text-[#333333] mb-4 px-2">
          Sections
        </div>
        <nav className="flex flex-col gap-1">
          {sections.map((section, i) => {
            const isActive = i === activeIndex
            return (
              <button
                key={section.id}
                onClick={() => { activateSection(i); scrollToSection(i) }}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors w-full ${
                  isActive
                    ? 'bg-[#1A1A1A]'
                    : 'hover:bg-[#111111]'
                }`}
              >
                <span
                  className={`shrink-0 w-2 h-2 rounded-full ${STATUS_COLORS[section.status]}`}
                  aria-hidden="true"
                />
                <span
                  className={`text-xs leading-snug line-clamp-2 ${
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

      {/* ── Sections stack ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto"
        style={{ scrollSnapType: 'y mandatory' }}
      >
        {sections.map((section, i) => (
          <div
            key={section.id}
            ref={el => { sectionRefs.current[i] = el }}
            className="relative min-h-screen w-full"
            style={{ scrollSnapAlign: 'start' }}
          >
            <TemplateRenderer
              section={section}
              isActive={i === activeIndex}
              onReady={() => {
                // Mark as ready once animation completes if still pending
                setSections(prev =>
                  prev.map((s, idx) =>
                    idx === i && s.status === 'pending' ? { ...s, status: 'ready' as SectionStatus } : s
                  )
                )
              }}
            />

            {/* Skip button */}
            {i === activeIndex && i < sections.length - 1 && (
              <button
                onClick={() => handleSkip(i)}
                className="absolute bottom-16 right-6 z-20 text-xs text-[#475569] hover:text-[#94A3B8] transition-colors flex items-center gap-1.5 py-2 px-3 rounded-lg hover:bg-[#111111]"
                aria-label="Skip to next section"
              >
                Skip
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
