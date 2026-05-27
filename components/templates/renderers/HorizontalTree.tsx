'use client'

import { motion } from 'framer-motion'
import type { HierarchyData, HierarchyNode } from '@/lib/templates/types'

interface HorizontalTreeProps { data: HierarchyData; isActive: boolean; onReady?: () => void }

function NodeBox({ label, detail, color, delay, isActive }: {
  label: string
  detail?: string
  color: string
  delay: number
  isActive: boolean
}) {
  return (
    <motion.div
      className="rounded-xl border border-[#222222] bg-[#111111] px-4 py-3 min-w-[130px] max-w-[170px]"
      style={{ borderColor: color + '40' }}
      initial={{ opacity: 0, x: -12 }}
      animate={isActive ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
      transition={{ delay, duration: 0.35 }}
    >
      <p className="text-white font-semibold text-xs leading-snug">{label}</p>
      {detail && <p className="text-[#94A3B8] text-xs mt-1 leading-tight">{detail}</p>}
    </motion.div>
  )
}

const LEVEL_COLORS = ['#7C3AED', '#06B6D4', '#10B981']

export default function HorizontalTree({ data, isActive, onReady }: HorizontalTreeProps) {
  // Cap: root.children max 4, each child.children max 4
  const root = data.root
  const level2 = (root.children ?? []).slice(0, 4)

  return (
    <motion.div
      className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12 pb-20"
      initial={{ opacity: 0, y: 20 }}
      animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5 }}
      onAnimationComplete={() => { if (isActive) onReady?.() }}
    >
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
        <p className="text-[#94A3B8] text-sm">{data.context}</p>
      </div>

      {/* Tree layout: 3 columns */}
      <div className="flex-1 min-h-0 flex items-start gap-0 overflow-hidden">
        {/* Column 1: root */}
        <div className="flex items-center shrink-0" style={{ alignSelf: 'center' }}>
          <NodeBox
            label={root.label}
            detail={root.detail}
            color={LEVEL_COLORS[0]}
            delay={0.1}
            isActive={isActive}
          />
        </div>

        {/* Connector from root to level2 items */}
        {level2.length > 0 && (
          <div className="flex items-center shrink-0" style={{ alignSelf: 'center' }}>
            <div className="w-8 h-px bg-[#333333]" />
          </div>
        )}

        {/* Column 2: level2 nodes + connectors to level3 */}
        {level2.length > 0 && (
          <div className="flex flex-col justify-around gap-4 shrink-0 flex-1">
            {level2.map((l2: HierarchyNode, l2i) => {
              const level3 = (l2.children ?? []).slice(0, 4)
              return (
                <div key={l2i} className="flex items-center gap-0">
                  {/* Level 2 node */}
                  <NodeBox
                    label={l2.label}
                    detail={l2.detail}
                    color={LEVEL_COLORS[1]}
                    delay={0.15 + l2i * 0.07}
                    isActive={isActive}
                  />

                  {/* Connector to level3 */}
                  {level3.length > 0 && (
                    <div className="flex items-center shrink-0">
                      <div className="w-6 h-px bg-[#333333]" />
                    </div>
                  )}

                  {/* Level 3 nodes */}
                  {level3.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {level3.map((l3: HierarchyNode, l3i) => (
                        <NodeBox
                          key={l3i}
                          label={l3.label}
                          detail={l3.detail}
                          color={LEVEL_COLORS[2]}
                          delay={0.2 + l2i * 0.07 + l3i * 0.04}
                          isActive={isActive}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* So what footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </div>
    </motion.div>
  )
}
