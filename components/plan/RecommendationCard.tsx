'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export interface RecommendationData {
  session_id: string
  title: string
  queue_rationale: string
  arc_name?: string
}

interface RecommendationCardProps {
  recommendation: RecommendationData
  onAccept: (sessionId: string) => Promise<void>
  onDismiss: (sessionId: string) => Promise<void>
}

export function RecommendationCard({ recommendation, onAccept, onDismiss }: RecommendationCardProps) {
  const [state, setState] = useState<'idle' | 'accepting' | 'accepted' | 'dismissing' | 'error'>('idle')

  async function handleAccept() {
    setState('accepting')
    try {
      await onAccept(recommendation.session_id)
      setState('accepted')
    } catch {
      setState('error')
    }
  }

  async function handleDismiss() {
    setState('dismissing')
    try {
      await onDismiss(recommendation.session_id)
    } catch {
      setState('idle')
    }
  }

  if (state === 'dismissing') return null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-xl border border-[#7C3AED]/20 bg-[#7C3AED]/5 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Sparkles size={16} className="text-[#A855F7] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-white leading-snug">{recommendation.title}</p>
            {state === 'accepting' || state === 'accepted' ? (
              <div className="flex items-center gap-2 mt-1">
                <Loader2 size={12} className="text-[#A855F7] animate-spin" />
                <span className="text-xs text-[#A855F7]">Generating sessions…</span>
              </div>
            ) : (
              <p className="text-xs text-[#475569] mt-0.5 line-clamp-2">{recommendation.queue_rationale}</p>
            )}
            {state === 'error' && (
              <p className="text-xs text-[#EF4444] mt-1">Couldn&apos;t add — try again</p>
            )}
          </div>
        </div>

        {state === 'idle' || state === 'error' ? (
          <div className="flex items-center gap-3 shrink-0">
            <Button variant="secondary" size="sm" onClick={handleAccept} className="text-xs">
              Add to plan →
            </Button>
            <button
              onClick={handleDismiss}
              className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}
