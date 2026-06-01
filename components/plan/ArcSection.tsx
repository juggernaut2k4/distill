'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SessionCard, type SessionCardData } from './SessionCard'

interface ArcSectionProps {
  arcName: string
  arcType: 'domain' | 'integrated' | 'singleton'
  sessions: SessionCardData[]
  completedIds: Set<string>
  completionDates?: Record<string, string>
  currentSessionId?: string
  newSessionIds?: Set<string>
  onStartSession?: (sessionId: string) => void
  defaultExpanded?: boolean
}

const ARC_TYPE_LABELS: Record<string, string> = {
  domain: 'Domain',
  integrated: 'Integrated',
  singleton: 'Focus',
}

const ARC_TYPE_COLORS: Record<string, string> = {
  domain: '#A855F7',
  integrated: '#06B6D4',
  singleton: '#F59E0B',
}

export function ArcSection({
  arcName,
  arcType,
  sessions,
  completedIds,
  completionDates = {},
  currentSessionId,
  newSessionIds,
  onStartSession,
  defaultExpanded = true,
}: ArcSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const color = ARC_TYPE_COLORS[arcType] ?? '#94A3B8'
  const label = ARC_TYPE_LABELS[arcType] ?? arcType

  return (
    <div className="rounded-xl border border-[#1E1E1E] bg-[#0D0D0D] overflow-hidden">
      {/* Arc header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#111111] transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown size={14} className="text-[#475569]" />
          ) : (
            <ChevronRight size={14} className="text-[#475569]" />
          )}
          <span className="text-sm font-semibold text-white">{arcName}</span>
          <span className="text-xs text-[#475569]">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ color, backgroundColor: `${color}1A` }}
        >
          {label}
        </span>
      </button>

      {/* Sessions */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="sessions"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-3 pb-3 space-y-2">
              {sessions.map((session) => (
                <SessionCard
                  key={session.session_id}
                  session={session}
                  isCompleted={completedIds.has(session.session_id)}
                  isCurrent={session.session_id === currentSessionId}
                  completedAt={completionDates[session.session_id]}
                  isNew={newSessionIds?.has(session.session_id)}
                  onStart={onStartSession ? () => onStartSession(session.db_session_id ?? session.session_id) : undefined}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
