'use client'

import { ProgressRing } from '@/components/ui/ProgressRing'

interface ScoreRingProps {
  score: number // 0-100
}

/**
 * AI Readiness Score display with large circular ring and number.
 */
export function ScoreRing({ score }: ScoreRingProps) {
  const color =
    score < 40 ? '#F59E0B' : score < 70 ? '#06B6D4' : '#10B981'

  return (
    <div className="flex flex-col items-center gap-3">
      <ProgressRing
        value={score}
        size={140}
        strokeWidth={10}
        color={color}
        label={String(score)}
        sublabel="/100"
      />
      <div className="text-center">
        <p className="text-sm font-semibold text-white">AI Readiness Score</p>
        <p className="text-xs text-[#475569] mt-0.5">
          {score < 40 ? 'Building foundations' : score < 70 ? 'Developing confidence' : 'Leading with AI'}
        </p>
      </div>
    </div>
  )
}
