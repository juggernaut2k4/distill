import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'purple' | 'cyan' | 'amber' | 'green' | 'red' | 'muted'
}

const variantStyles = {
  purple: 'bg-purple-950/50 text-[#A855F7] border border-purple-800/30',
  cyan: 'bg-cyan-950/50 text-[#06B6D4] border border-cyan-800/30',
  amber: 'bg-amber-950/50 text-[#F59E0B] border border-amber-800/30',
  green: 'bg-green-950/50 text-[#10B981] border border-green-800/30',
  red: 'bg-red-950/50 text-[#EF4444] border border-red-800/30',
  muted: 'bg-[#1A1A1A] text-[#94A3B8] border border-[#333333]',
}

/**
 * Small colored badge component for status labels, plan names, content types, etc.
 */
export function Badge({ variant = 'muted', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
