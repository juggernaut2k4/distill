'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ThumbsUp, ThumbsDown, Mail, Smartphone } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { format, isToday, isYesterday } from 'date-fns'

interface MessageCardProps {
  id: string
  date: string
  contentType: string
  bodyText: string
  channel?: 'email' | 'sms'
  initialFeedback?: 'positive' | 'negative' | null
  /** Called with the new feedback value after a successful save */
  onFeedback?: (id: string, feedback: 'positive' | 'negative') => void
  /** Whether the thumbs buttons are disabled (e.g. during a save) */
  saving?: boolean
}

const typeVariantMap: Record<string, 'purple' | 'cyan' | 'amber' | 'green' | 'muted'> = {
  tip: 'purple',
  signal: 'cyan',
  decoder: 'amber',
  lens: 'green',
  framework: 'muted',
}

function formatMessageDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

/**
 * Message card showing a delivered insight with inline thumbs up/down feedback.
 * Supports channel badge (Email / SMS) and date-relative labels.
 */
export function MessageCard({
  id,
  date,
  contentType,
  bodyText,
  channel,
  initialFeedback,
  onFeedback,
  saving = false,
}: MessageCardProps) {
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(
    initialFeedback ?? null
  )

  const handleFeedback = (value: 'positive' | 'negative') => {
    // Allow changing feedback (toggle off if same value clicked again)
    const next = feedback === value ? null : value
    setFeedback(next)
    if (next !== null) {
      onFeedback?.(id, next)
    }
  }

  const badgeVariant = typeVariantMap[contentType] ?? 'muted'

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={badgeVariant}>{contentType.toUpperCase()}</Badge>
          {channel && (
            <span className="inline-flex items-center gap-1 text-xs text-[#475569]">
              {channel === 'sms' ? (
                <Smartphone size={11} className="text-[#F59E0B]" />
              ) : (
                <Mail size={11} className="text-[#06B6D4]" />
              )}
              {channel === 'sms' ? 'SMS' : 'Email'}
            </span>
          )}
          <span className="text-xs text-[#475569]">
            {formatMessageDate(date)}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <motion.button
            whileHover={{ scale: saving ? 1 : 1.1 }}
            whileTap={{ scale: saving ? 1 : 0.9 }}
            onClick={() => handleFeedback('positive')}
            disabled={saving}
            aria-label="Helpful"
            className={`p-1.5 rounded-lg transition-colors ${
              feedback === 'positive'
                ? 'text-[#10B981] bg-green-950/30'
                : 'text-[#475569] hover:text-[#10B981] hover:bg-green-950/20 disabled:opacity-40'
            }`}
          >
            <ThumbsUp size={16} />
          </motion.button>
          <motion.button
            whileHover={{ scale: saving ? 1 : 1.1 }}
            whileTap={{ scale: saving ? 1 : 0.9 }}
            onClick={() => handleFeedback('negative')}
            disabled={saving}
            aria-label="Not helpful"
            className={`p-1.5 rounded-lg transition-colors ${
              feedback === 'negative'
                ? 'text-[#EF4444] bg-red-950/30'
                : 'text-[#475569] hover:text-[#EF4444] hover:bg-red-950/20 disabled:opacity-40'
            }`}
          >
            <ThumbsDown size={16} />
          </motion.button>
        </div>
      </div>
      <p className="text-[#94A3B8] text-sm leading-relaxed line-clamp-3">
        {bodyText}
      </p>
    </Card>
  )
}
