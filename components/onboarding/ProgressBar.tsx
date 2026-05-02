'use client'

import { motion } from 'framer-motion'

interface ProgressBarProps {
  current: number   // 1-based current step
  total: number
}

/**
 * Thin top progress bar for the onboarding flow.
 * Animates smoothly between steps.
 */
export function ProgressBar({ current, total }: ProgressBarProps) {
  const pct = Math.round((current / total) * 100)

  return (
    <div className="fixed top-0 left-0 right-0 h-1 bg-[#1A1A1A] z-50">
      <motion.div
        className="h-full bg-[#7C3AED] origin-left"
        initial={{ width: `${((current - 1) / total) * 100}%` }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
    </div>
  )
}
