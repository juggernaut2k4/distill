'use client'

import { motion } from 'framer-motion'
import type { HorizontalDecisionData } from '@/lib/templates/types'

interface HorizontalDecisionProps { data: HorizontalDecisionData; isActive: boolean; onReady?: () => void }

const NODE_BG: Record<string, string> = {
  start: 'bg-[#10B981] border-[#10B981]',
  decision: 'bg-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_20%,transparent)] border-[var(--partner-primary,#7C3AED)]',
  action: 'bg-[#111111] border-[#333333]',
  end: 'bg-[color-mix(in_srgb,var(--partner-secondary,#06B6D4)_20%,transparent)] border-[var(--partner-secondary,#06B6D4)]',
}
const NODE_TEXT: Record<string, string> = {
  start: 'text-white font-bold',
  decision: 'text-white font-semibold',
  action: 'text-white',
  end: 'text-[var(--partner-secondary,#06B6D4)] font-bold',
}

export default function HorizontalDecision({ data, isActive, onReady }: HorizontalDecisionProps) {
  // Cap at 4 nodes
  const nodes = data.nodes.slice(0, 4)

  return (
    <motion.div
      className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12 pb-20"
      initial={{ opacity: 0, y: 20 }}
      animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5 }}
      onAnimationComplete={() => { if (isActive) onReady?.() }}
    >
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
        <p className="text-[#94A3B8] text-sm">{data.context}</p>
      </div>

      {/* Main horizontal flow */}
      <div className="flex-1 flex flex-col justify-center min-h-0">
        {/* Main row */}
        <div className="flex items-center justify-center gap-0">
          {nodes.map((node, i) => {
            const isDecision = node.type === 'decision'
            const isLast = i === nodes.length - 1

            return (
              <div key={node.id} className="flex items-center">
                {/* Node */}
                <motion.div
                  className="flex flex-col items-center"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={isActive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
                  transition={{ delay: 0.1 + i * 0.12, duration: 0.35 }}
                >
                  {/* The shape */}
                  {isDecision ? (
                    /* Diamond */
                    <div className="relative w-[120px] h-[120px] flex items-center justify-center">
                      <div
                        className="absolute inset-0 border-2 border-[var(--partner-primary,#7C3AED)] bg-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_20%,transparent)]"
                        style={{ transform: 'rotate(45deg)', borderRadius: '6px' }}
                      />
                      <span className="relative z-10 text-white font-semibold text-sm text-center px-3 leading-snug">
                        {node.label}
                      </span>
                    </div>
                  ) : node.type === 'start' || node.type === 'end' ? (
                    /* Pill */
                    <div className={`px-6 py-3 rounded-full border-2 ${NODE_BG[node.type]} min-w-[110px] text-center`}>
                      <span className={`text-sm ${NODE_TEXT[node.type]}`}>{node.label}</span>
                    </div>
                  ) : (
                    /* Action rect */
                    <div className={`px-4 py-3 rounded-xl border-2 ${NODE_BG[node.type]} min-w-[120px] text-center`}>
                      <span className={`text-sm ${NODE_TEXT[node.type]}`}>{node.label}</span>
                      {node.detail && (
                        <p className="text-[#94A3B8] text-base mt-1 leading-snug">{node.detail}</p>
                      )}
                    </div>
                  )}

                  {/* Branch outcome for decision nodes */}
                  {isDecision && node.branch_outcome && (
                    <div className="flex flex-col items-center mt-2">
                      {/* Vertical line */}
                      <div className="w-px h-8 bg-[#333333]" />
                      {/* Branch label */}
                      {node.branch_label && (
                        <span className="text-xs text-[#475569] mb-1">{node.branch_label}</span>
                      )}
                      {/* Branch outcome box */}
                      <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/5 px-4 py-2 min-w-[110px] text-center">
                        <span className="text-[#EF4444] text-sm leading-snug">{node.branch_outcome}</span>
                      </div>
                    </div>
                  )}
                </motion.div>

                {/* Arrow between nodes */}
                {!isLast && (
                  <motion.div
                    className="flex items-center mx-2"
                    initial={{ opacity: 0 }}
                    animate={isActive ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ delay: 0.15 + i * 0.12, duration: 0.3 }}
                  >
                    <div className="w-8 h-px bg-[#333333]" />
                    <span className="text-[#333333] text-lg leading-none -ml-1">▶</span>
                  </motion.div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* So what footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_20%,transparent)] border-t border-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_30%,transparent)] px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_75%,white)] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </div>
    </motion.div>
  )
}
