'use client'

/**
 * LIVE-01 — the ONE new, simple, generic visual renderer for the live conductor
 * path. Deliberately NOT added to components/templates/renderers/ (that
 * directory is the 22-template system reserved for the old pre-generated path,
 * left fully untouched — see lib/templates/selector.ts / generator.ts).
 *
 * Displays exactly: headline + up to 3-4 key items + a "so what" line. Matches
 * VisualizationSpec's spirit (Section 11, Resolved Q5) — simple enough to
 * render reliably from freshly generated content every time, with no template
 * selection logic and no rich per-schema data shaping.
 */

import { motion } from 'framer-motion'
import type { LiveConductorVisualData } from '@/lib/content/live-conductor-visual'

interface LiveConductorVisualProps {
  data: LiveConductorVisualData | null
  tabTitle: string
}

/**
 * Renders the live-generated visual for the current tab, or a lightweight
 * text-only fallback when `data` is null (visual generation failed or timed
 * out past the transition buffer — Section 11, Resolved Q6). Clio keeps
 * teaching normally in this fallback state; there is no loading spinner and no
 * attempt to fall back to the old template pipeline.
 */
export default function LiveConductorVisual({ data, tabTitle }: LiveConductorVisualProps) {
  if (!data) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[#080808] px-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-2"
        >
          <p className="text-white text-2xl font-bold">{tabTitle}</p>
          <p className="text-[#475569] text-sm">Listening in — no visual for this section.</p>
        </motion.div>
      </div>
    )
  }

  const items = data.items.slice(0, 4)

  return (
    <div className="h-full w-full flex flex-col justify-center bg-[#080808] px-8 md:px-16 py-12">
      <motion.div
        key={data.headline}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-3xl mx-auto w-full space-y-8"
      >
        <h2 className="text-3xl md:text-4xl font-bold text-white leading-tight">{data.headline}</h2>

        <ul className="space-y-4">
          {items.map((item, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: 0.1 + i * 0.08 }}
              className="flex items-start gap-4 rounded-xl border border-[#222222] bg-[#111111] p-4"
            >
              <span className="mt-1 h-2 w-2 rounded-full bg-[#06B6D4] shrink-0" />
              <span className="text-white text-base leading-relaxed">{item}</span>
            </motion.li>
          ))}
        </ul>

        {data.so_what && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            className="rounded-xl border border-[#7C3AED]/40 bg-[#7C3AED]/10 p-4"
          >
            <p className="text-[#A855F7] text-sm font-semibold uppercase tracking-wide mb-1">So what</p>
            <p className="text-white text-base leading-relaxed">{data.so_what}</p>
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
