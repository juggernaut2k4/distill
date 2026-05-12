import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean
}

/**
 * Dark surface card component matching the Clio design system.
 */
export function Card({ elevated = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border',
        elevated
          ? 'bg-[#1A1A1A] border-[#333333]'
          : 'bg-[#111111] border-[#222222]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
