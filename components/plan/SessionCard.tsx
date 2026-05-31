'use client'

import { motion } from 'framer-motion'
import { CheckCircle, Clock, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export interface SessionCardData {
  session_id: string
  title: string
  focus: string
  arc_position: number
  arc_length: number
  depth_level: 'beginner' | 'intermediate' | 'advanced'
  estimated_minutes: number
  arc_name?: string
  arc_type?: string
}

interface SessionCardProps {
  session: SessionCardData
  isCompleted: boolean
  isCurrent: boolean
  completedAt?: string
  isNew?: boolean
  onStart?: () => void
}

const DEPTH_COLORS: Record<string, { text: string; bg: string }> = {
  beginner: { text: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  intermediate: { text: '#06B6D4', bg: 'rgba(6,182,212,0.1)' },
  advanced: { text: '#A855F7', bg: 'rgba(168,85,247,0.1)' },
}

export function SessionCard({ session, isCompleted, isCurrent, completedAt, isNew, onStart }: SessionCardProps) {
  const depth = DEPTH_COLORS[session.depth_level] ?? DEPTH_COLORS.beginner

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-4 transition-colors ${
        isCompleted
          ? 'border-[#1E1E1E] bg-[#0D0D0D]'
          : isCurrent
          ? 'border-[#7C3AED]/40 bg-[#111111]'
          : 'border-[#1E1E1E] bg-[#111111]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Status icon */}
          <div className="mt-0.5 shrink-0">
            {isCompleted ? (
              <CheckCircle size={18} className="text-[#10B981]" />
            ) : isCurrent ? (
              <PlayCircle size={18} className="text-[#7C3AED]" />
            ) : (
              <div className="w-[18px] h-[18px] rounded-full border border-[#333333]" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-xs text-[#475569]">
                Session {session.arc_position} of {session.arc_length}
              </span>
              {isNew && (
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-[#06B6D4]/10 text-[#06B6D4]">
                  New
                </span>
              )}
            </div>
            <p className={`text-sm font-semibold leading-snug ${isCompleted ? 'text-[#475569]' : 'text-white'}`}>
              {session.title}
            </p>
            {!isCompleted && (
              <p className="text-xs text-[#475569] mt-0.5 line-clamp-2">{session.focus}</p>
            )}
            {isCompleted && completedAt && (
              <p className="text-xs text-[#475569] mt-0.5">
                Completed {new Date(completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </p>
            )}
          </div>
        </div>

        {/* Right side */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <Clock size={11} className="text-[#475569]" />
            <span className="text-xs text-[#475569]">~{session.estimated_minutes} min</span>
          </div>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ color: depth.text, backgroundColor: depth.bg }}
          >
            {session.depth_level.charAt(0).toUpperCase() + session.depth_level.slice(1)}
          </span>
          {isCurrent && onStart && (
            <Button size="sm" onClick={onStart} className="mt-1 text-xs gap-1">
              Start here →
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
