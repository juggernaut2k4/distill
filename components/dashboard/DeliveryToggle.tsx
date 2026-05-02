'use client'

import { motion } from 'framer-motion'

type DeliveryOption = 'email' | 'sms' | 'both'

interface DeliveryToggleProps {
  value: DeliveryOption
  onChange: (value: DeliveryOption) => void
  smsEnabled?: boolean
}

const options: { value: DeliveryOption; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'both', label: 'Both' },
]

/**
 * Segmented control for delivery preference.
 * SMS option shows lock icon if plan doesn't support it.
 */
export function DeliveryToggle({ value, onChange, smsEnabled = true }: DeliveryToggleProps) {
  return (
    <div className="flex bg-[#111111] border border-[#222222] rounded-xl p-1 gap-1">
      {options.map((option) => {
        const isActive = value === option.value
        const isDisabled = !smsEnabled && option.value !== 'email'

        return (
          <motion.button
            key={option.value}
            onClick={() => !isDisabled && onChange(option.value)}
            whileTap={{ scale: 0.97 }}
            disabled={isDisabled}
            className={`
              relative flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors
              ${isActive
                ? 'text-white'
                : 'text-[#475569] hover:text-[#94A3B8]'
              }
              ${isDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            {isActive && (
              <motion.div
                layoutId="delivery-indicator"
                className="absolute inset-0 bg-[#7C3AED] rounded-lg"
                transition={{ duration: 0.2 }}
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </motion.button>
        )
      })}
    </div>
  )
}
