'use client'

import { motion } from 'framer-motion'
import { OptionButton } from './OptionButton'

interface QuestionCardProps {
  question: string
  options: string[]
  selectedOption: string | null
  onSelect: (option: string) => void
  direction?: 'left' | 'right'
}

const variants = {
  enter: (dir: string) => ({
    x: dir === 'right' ? 400 : -400,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (dir: string) => ({
    x: dir === 'right' ? -400 : 400,
    opacity: 0,
  }),
}

/**
 * Animated question card for the onboarding flow.
 * Slides in from right, exits left when advancing.
 */
export function QuestionCard({
  question,
  options,
  selectedOption,
  onSelect,
  direction = 'right',
}: QuestionCardProps) {
  return (
    <motion.div
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="w-full max-w-lg mx-auto"
    >
      {/* Question */}
      <h2 className="text-4xl font-bold text-white text-center mb-10 leading-tight">
        {question}
      </h2>

      {/* Options */}
      <div className="flex flex-col gap-3">
        {options.map((option) => (
          <OptionButton
            key={option}
            label={option}
            selected={selectedOption === option}
            onClick={() => onSelect(option)}
          />
        ))}
      </div>
    </motion.div>
  )
}
