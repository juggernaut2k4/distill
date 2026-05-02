'use client'

import { motion } from 'framer-motion'
import { Flame } from 'lucide-react'

interface StreakCounterProps {
  days: number
}

/**
 * Streak counter with animated flame icon.
 */
export function StreakCounter({ days }: StreakCounterProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [-3, 3, -3],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <Flame size={36} className="text-[#F59E0B] fill-[#F59E0B]" />
        </motion.div>
        <span className="text-4xl font-bold text-white">{days}</span>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-white">Day Streak</p>
        <p className="text-xs text-[#475569] mt-0.5">
          {days === 0 ? 'Start your streak today' : days === 1 ? '1 day active' : `${days} days active`}
        </p>
      </div>
    </div>
  )
}
