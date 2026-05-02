'use client'

import { motion } from 'framer-motion'
import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

const variantStyles = {
  primary:
    'bg-[#7C3AED] hover:bg-[#A855F7] text-white border border-transparent shadow-lg shadow-purple-900/30',
  secondary:
    'bg-transparent hover:bg-[#1A1A1A] text-white border border-[#333333]',
  ghost:
    'bg-transparent hover:bg-[#1A1A1A] text-[#94A3B8] border border-transparent',
  danger:
    'bg-[#EF4444] hover:bg-red-600 text-white border border-transparent',
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-5 py-2.5 text-sm rounded-xl',
  lg: 'px-8 py-4 text-base rounded-xl',
}

/**
 * Reusable button component with Framer Motion hover/tap animation.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, children, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          'font-semibold transition-colors duration-150 cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...(props as React.ComponentPropsWithoutRef<typeof motion.button>)}
      >
        {children}
      </motion.button>
    )
  }
)

Button.displayName = 'Button'

export { Button }
