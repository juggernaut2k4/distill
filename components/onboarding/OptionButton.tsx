'use client'

import { motion } from 'framer-motion'
import { Check } from 'lucide-react'

interface OptionButtonProps {
  label: string
  selected: boolean
  onClick: () => void
}

/**
 * Selectable option button for onboarding questions.
 * Purple border + tint when selected.
 */
export function OptionButton({ label, selected, onClick }: OptionButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={`
        w-full min-h-[64px] px-6 py-4 rounded-xl text-left text-white font-medium
        transition-colors duration-150 relative flex items-center justify-between
        ${selected
          ? 'bg-purple-950/30 border-2 border-[#7C3AED]'
          : 'bg-[#111111] border border-[#333333] hover:border-[#555555] hover:bg-[#1A1A1A]'
        }
      `}
    >
      <span>{label}</span>
      {selected && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="flex-shrink-0 w-6 h-6 rounded-full bg-[#7C3AED] flex items-center justify-center"
        >
          <Check size={14} className="text-white" />
        </motion.span>
      )}
    </motion.button>
  )
}
