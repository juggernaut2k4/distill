'use client'

import { motion } from 'framer-motion'

export interface ProgressRingProps {
  value: number // 0-100
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
  label?: string
  sublabel?: string
}

/**
 * SVG circular progress ring component.
 * Used for AI Readiness Score display.
 */
export function ProgressRing({
  value,
  size = 120,
  strokeWidth = 8,
  color = '#06B6D4',
  trackColor = '#1A1A1A',
  label,
  sublabel,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clampedValue = Math.min(100, Math.max(0, value))
  const strokeDashoffset = circumference - (clampedValue / 100) * circumference

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
        />
      </svg>
      {/* Center label */}
      {(label || sublabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {label && (
            <span className="text-2xl font-bold text-white leading-none">{label}</span>
          )}
          {sublabel && (
            <span className="text-xs text-[#94A3B8] mt-0.5">{sublabel}</span>
          )}
        </div>
      )}
    </div>
  )
}
