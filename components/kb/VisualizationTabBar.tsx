'use client'

import type { VisualizationTab } from '@/lib/templates/types'

interface Props {
  tabs: VisualizationTab[]
  activeIndex: number       // 0-based
  onTabClick: (index: number) => void
}

const MAX_LABEL_CHARS = 24

function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_CHARS) return label
  return label.slice(0, MAX_LABEL_CHARS - 1) + '…'
}

/**
 * Horizontal scrollable pill tab bar for VisualizationTabPanel.
 * Active tab: solid purple. Inactive: dark with subtle border.
 * Right edge has a fade-out mask to signal overflow on mobile.
 */
export default function VisualizationTabBar({ tabs, activeIndex, onTabClick }: Props) {
  return (
    <div className="relative">
      {/* Scrollable tab row */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 pr-10" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {tabs.map((tab, i) => {
          const isActive = i === activeIndex
          const fullLabel = `${tab.tab_index}. ${tab.tab_name}`
          const displayLabel = truncateLabel(fullLabel)
          const needsTooltip = fullLabel.length > MAX_LABEL_CHARS

          return (
            <button
              key={tab.tab_id}
              onClick={() => onTabClick(i)}
              title={needsTooltip ? fullLabel : undefined}
              className={[
                'h-8 px-3 rounded-lg text-xs font-medium shrink-0 transition-colors',
                isActive
                  ? 'bg-[#7C3AED] text-white'
                  : 'bg-[#111111] border border-[#333333] text-[#94A3B8] hover:border-[#555555] hover:text-white',
              ].join(' ')}
            >
              {displayLabel}
            </button>
          )
        })}
      </div>

      {/* Right-fade mask — signals that more tabs exist beyond the visible area */}
      <div
        className="absolute top-0 right-0 h-8 w-10 pointer-events-none"
        style={{ background: 'linear-gradient(to right, transparent, #080808)' }}
      />
    </div>
  )
}
