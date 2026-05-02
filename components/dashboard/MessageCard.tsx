'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { format } from 'date-fns'

interface MessageCardProps {
  id: string
  date: string
  contentType: string
  bodyText: string
  initialFeedback?: 'positive' | 'negative' | null
  onFeedback?: (id: string, feedback: 'positive' | 'negative') => void
}

const typeVariantMap: Record<string, 'purple' | 'cyan' | 'amber' | 'green' | 'muted'> = {
  tip: 'purple',
  signal: 'cyan',
  decoder: 'amber',
  lens: 'green',
  framework: 'muted',
}

/**
 * Message card showing a delivered insight with inline thumbs up/down feedback.
 */
export function MessageCard({
  id,
  date,
  contentType,
  bodyText,
  initialFeedback,
  onFeedback,
}: MessageCardProps) {
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(
    initialFeedback ?? null
  )

  const handleFeedback = (value: 'positive' | 'negative') => {
    if (feedback) return // Already given
    setFeedback(value)
    onFeedback?.(id, value)
  }

  const badgeVariant = typeVariantMap[contentType] ?? 'muted'

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariant}>{contentType.toUpperCase()}</Badge>
          <span className="text-xs text-[#475569]">
            {format(new Date(date), 'MMM d')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => handleFeedback('positive')}
            disabled={!!feedback}
            className={`p-1.5 rounded-lg transition-colors ${
              feedback === 'positive'
                ? 'text-[#10B981] bg-green-950/30'
                : 'text-[#475569] hover:text-[#10B981] hover:bg-green-950/20 disabled:opacity-40'
            }`}
          >
            <ThumbsUp size={16} />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => handleFeedback('negative')}
            disabled={!!feedback}
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
      <p className="text-[#94A3B8] text-sm leading-relaxed line-clamp-2">
        {bodyText}
      </p>
    </Card>
  )
}
