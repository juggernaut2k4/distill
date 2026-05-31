'use client'

import { motion } from 'framer-motion'

export function PlanSkeleton({ message = 'Building your personalised learning plan…' }: { message?: string }) {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-4 h-4 rounded-full bg-[#7C3AED]/40 animate-pulse" />
          <div className="h-3 w-32 rounded bg-[#1E1E1E] animate-pulse" />
        </div>
        <div className="h-7 w-72 rounded bg-[#1E1E1E] animate-pulse mb-1" />
        <p className="text-[#475569] text-sm">{message}</p>
      </div>

      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.25 }}
            className="rounded-xl border border-[#1E1E1E] bg-[#111111] p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 rounded bg-[#1E1E1E]" />
                <div className="h-5 w-56 rounded bg-[#1E1E1E]" />
                <div className="h-3 w-full max-w-sm rounded bg-[#1E1E1E]" />
              </div>
              <div className="h-6 w-16 rounded bg-[#1E1E1E]" />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
