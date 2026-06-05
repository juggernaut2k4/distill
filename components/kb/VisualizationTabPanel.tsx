'use client'

import { AnimatePresence, motion } from 'framer-motion'
import VisualizationTabBar from '@/components/kb/VisualizationTabBar'
import KBSessionPreview from '@/components/kb/KBSessionPreview'
import type { VisualizationTab } from '@/lib/templates/types'

interface Props {
  tabs: VisualizationTab[]
  activeIndex: number
  onTabChange: (index: number) => void
  topicId: string
}

/**
 * Wraps VisualizationTabBar with an animated content area.
 * The active tab's TemplateSection is rendered via KBSessionPreview
 * (single-element sections array, activeSectionIndex=0).
 * Tab changes animate with a 150ms opacity fade via Framer Motion AnimatePresence.
 */
export default function VisualizationTabPanel({ tabs, activeIndex, onTabChange, topicId }: Props) {
  const activeTab: VisualizationTab | undefined = tabs[activeIndex]

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="shrink-0 mb-2">
        <VisualizationTabBar
          tabs={tabs}
          activeIndex={activeIndex}
          onTabClick={onTabChange}
        />
      </div>

      {/* Content area — fades between tabs */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab && (
            <motion.div
              key={activeTab.tab_id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="absolute inset-0"
            >
              <KBSessionPreview
                sections={[{ ...activeTab.section, status: 'active' as const }]}
                activeSectionIndex={0}
                onSectionChange={() => undefined}
                topicId={topicId}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
