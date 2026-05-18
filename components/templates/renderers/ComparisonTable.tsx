'use client'

import { motion } from 'framer-motion'
import type { ComparisonTableData } from '@/lib/templates/types'

interface ComparisonTableProps {
  data: ComparisonTableData
  isActive: boolean
  onReady?: () => void
}

export default function ComparisonTable({ data, isActive, onReady }: ComparisonTableProps) {
  return (
    <div className="min-h-screen w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div
        className="flex-1 flex flex-col pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        {/* Header */}
        <div className="mb-6">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="text-3xl font-bold text-white mb-2"
          >
            {data.title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={isActive ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="text-[#94A3B8] text-base"
          >
            {data.context}
          </motion.p>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-[#222222]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#222222]">
                <th className="text-left p-4 text-[#475569] font-medium w-40">Criteria</th>
                {data.options.map((opt, i) => (
                  <th key={i} className="text-left p-4">
                    <div className="text-white font-semibold">{opt.name}</div>
                    <div className="text-[#475569] text-xs font-normal mt-0.5">{opt.tagline}</div>
                    <div className="text-[#06B6D4] text-xs font-normal mt-1">Best for: {opt.best_for}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.criteria.map((criterion, rowIndex) => (
                <motion.tr
                  key={rowIndex}
                  initial={{ opacity: 0, x: -10 }}
                  animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                  transition={{ delay: 0.25 + rowIndex * 0.08, duration: 0.35 }}
                  className="border-b border-[#1A1A1A] last:border-0 hover:bg-[#111111]/60 transition-colors"
                >
                  <td className="p-4">
                    <div className="text-[#94A3B8] font-medium">{criterion.label}</div>
                    {criterion.description && (
                      <div className="text-[#475569] text-xs mt-0.5">{criterion.description}</div>
                    )}
                  </td>
                  {criterion.values.map((val, colIndex) => (
                    <td key={colIndex} className="p-4">
                      <div className="flex items-center gap-2">
                        {criterion.winner_index === colIndex && (
                          <svg className="w-4 h-4 text-[#10B981] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        <span className={criterion.winner_index === colIndex ? 'text-[#10B981] font-medium' : 'text-[#94A3B8]'}>
                          {val}
                        </span>
                      </div>
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Verdict */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ delay: 0.25 + data.criteria.length * 0.08 + 0.1, duration: 0.4 }}
          className="mt-5 rounded-xl border border-[#333333] bg-[#111111] p-5"
        >
          <div className="text-xs font-semibold uppercase tracking-widest text-[#A855F7] mb-2">Verdict</div>
          <p className="text-white text-base">{data.verdict}</p>
        </motion.div>
      </motion.div>

      {/* So what strip */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.7, duration: 0.4 }}
        className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3"
      >
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
