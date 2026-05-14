'use client'

import { useState } from 'react'
import { Clock, ChevronRight, Lock, Tag } from 'lucide-react'
import type { CurriculumPlan } from '@/lib/content/curriculum'

const DIFFICULTY_CONFIG = {
  beginner:     { label: 'Beginner',     color: '#67E8F9', bg: 'rgba(6,182,212,0.12)' },
  intermediate: { label: 'Intermediate', color: '#FCD34D', bg: 'rgba(245,158,11,0.12)' },
  advanced:     { label: 'Advanced',     color: '#C4B5FD', bg: 'rgba(124,58,237,0.12)' },
}

const TAG_COLORS: Record<string, string> = {
  'AI Strategy & Leadership': '#7C3AED',
  'Technology Foundations':   '#06B6D4',
  'Operational AI':           '#10B981',
  'Team & Org':               '#F59E0B',
  'Competitive Edge':         '#EF4444',
}

interface LearningPathViewProps {
  plan: CurriculumPlan
}

export function LearningPathView({ plan }: LearningPathViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedSession = plan.sessions[selectedIndex]
  const selectedTopic = selectedSession?.topics[0]

  return (
    <div className="rounded-xl overflow-hidden border border-[#222222] flex flex-col md:flex-row">
      {/* ── Left panel: Session timeline ── */}
      <div className="md:w-[40%] md:max-w-[320px] border-b md:border-b-0 md:border-r border-[#222222] bg-[#0A0A0A] flex flex-col">
        <div className="px-4 py-3 border-b border-[#1A1A1A] flex items-center justify-between flex-shrink-0">
          <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider">
            {plan.sessions.length} Sessions
          </p>
          <span className="text-xs text-[#475569]">{plan.totalMinutes} min total</span>
        </div>

        {/* Scrollable session list */}
        <div className="overflow-y-auto" style={{ maxHeight: 560 }}>
          <div className="relative">
            {/* Vertical connector line */}
            <div className="absolute left-[27px] top-4 bottom-4 w-px bg-[#1E1E1E]" />

            {plan.sessions.map((session, i) => {
              const topic = session.topics[0]
              const diff = DIFFICULTY_CONFIG[topic.difficulty]
              const isSelected = i === selectedIndex

              return (
                <button
                  key={session.index}
                  onClick={() => setSelectedIndex(i)}
                  className={`w-full text-left flex items-start gap-3 px-4 py-3 relative transition-colors ${
                    isSelected ? 'bg-[#7C3AED]/8' : 'hover:bg-[#111111]'
                  }`}
                >
                  {/* Session number bubble */}
                  <div
                    className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold transition-colors ${
                      isSelected
                        ? 'bg-[#7C3AED] text-white shadow-[0_0_12px_rgba(124,58,237,0.5)]'
                        : 'bg-[#1A1A1A] border border-[#2A2A2A] text-[#475569]'
                    }`}
                  >
                    {session.index}
                  </div>

                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className={`text-sm font-semibold leading-snug truncate transition-colors ${
                      isSelected ? 'text-white' : 'text-[#94A3B8]'
                    }`}>
                      {session.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                        style={{ color: diff.color, background: diff.bg }}
                      >
                        {diff.label}
                      </span>
                      <span className="text-[11px] text-[#475569] flex items-center gap-0.5">
                        <Clock size={10} />
                        {session.estimatedMinutes}m
                      </span>
                    </div>
                  </div>

                  <ChevronRight
                    size={13}
                    className={`flex-shrink-0 mt-2 transition-colors ${
                      isSelected ? 'text-[#7C3AED]' : 'text-[#2A2A2A]'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Right panel: Selected session detail ── */}
      <div className="flex-1 bg-[#080808] p-6 overflow-y-auto" style={{ maxHeight: 560 }}>
        {selectedTopic && (() => {
          const diff = DIFFICULTY_CONFIG[selectedTopic.difficulty]
          return (
            <div>
              {/* Header */}
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <p className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider mb-1.5">
                    Session {selectedSession.index} of {plan.sessions.length}
                  </p>
                  <h3 className="text-xl font-bold text-white leading-tight">
                    {selectedSession.title}
                  </h3>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-xs px-2 py-1 rounded-md font-semibold"
                    style={{ color: diff.color, background: diff.bg }}
                  >
                    {diff.label}
                  </span>
                  <span className="text-xs text-[#475569] flex items-center gap-1 bg-[#111111] border border-[#1E1E1E] px-2 py-1 rounded-md">
                    <Clock size={11} />
                    {selectedSession.estimatedMinutes}m
                  </span>
                </div>
              </div>

              {/* Divider */}
              <div className="h-px bg-[#1A1A1A] mb-5" />

              {/* Sub-topics */}
              <p className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider mb-3">
                What you&apos;ll learn
              </p>
              <ul className="space-y-3 mb-6">
                {selectedTopic.subtopics.map((sub, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#7C3AED]/15 border border-[#7C3AED]/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-[#A855F7]">{i + 1}</span>
                    </div>
                    <span className="text-sm text-[#94A3B8] leading-relaxed">{sub}</span>
                  </li>
                ))}
              </ul>

              {/* Tags */}
              {selectedTopic.tags.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider mb-2">
                    Category
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedTopic.tags.map((tag) => {
                      const tagColor = TAG_COLORS[tag] ?? '#7C3AED'
                      return (
                        <span
                          key={tag}
                          className="text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5"
                          style={{
                            color: tagColor,
                            borderColor: `${tagColor}30`,
                            background: `${tagColor}10`,
                          }}
                        >
                          <Tag size={10} />
                          {tag}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Prerequisites note */}
              {selectedTopic.prerequisites.length > 0 && (
                <div className="flex items-start gap-2 pt-4 border-t border-[#1A1A1A]">
                  <Lock size={12} className="text-[#475569] flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-[#475569] leading-relaxed">
                    Builds on earlier sessions in your path. No prep required — the order is already set.
                  </p>
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
