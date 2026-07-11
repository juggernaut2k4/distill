'use client'

import { motion } from 'framer-motion'
import type { HeatmapData } from '@/lib/templates/types'
import type { StyleOverrides } from '@/lib/templates/styleOverrideSlots'

interface HeatmapProps {
  data: HeatmapData
  isActive: boolean
  onReady?: () => void
  /**
   * TMPL-01 (requirement doc Section 4.1/6) — automated-fix-loop style
   * overrides, applied via inline `style={{ }}` layered on top of the
   * existing Tailwind-driven classes below, never as dynamic Tailwind class
   * strings (Tailwind compiles class names statically at build time, so a
   * class name built from a runtime DB value would never exist in the
   * compiled CSS and would silently do nothing).
   *
   * Slots consumed here: `intensity-0`..`intensity-4` (color, overrides the
   * background this intensity level currently gets from INTENSITY_STYLES),
   * `cell-size` (px, overrides the hardcoded `w-[64px] h-[64px]` grid-cell
   * sizing), `cell-gap` (px, overrides the hardcoded `m-0.5` inter-cell
   * margin).
   */
  styleOverrides?: StyleOverrides
}

// RTV-04 Section 4.2 — fixed 5-point cyan -> amber -> red intensity ramp.
// Only accent colors already in CLAUDE.md are used; no new color introduced.
const INTENSITY_STYLES: Record<number, string> = {
  0: 'bg-[#1A1A1A] border border-[#333333]',
  1: 'bg-[#06B6D4]/20 border border-[#06B6D4]/40',
  2: 'bg-[#06B6D4]/60 border border-[#06B6D4]',
  3: 'bg-[#F59E0B]/60 border border-[#F59E0B]',
  4: 'bg-[#EF4444]/70 border border-[#EF4444]',
}

const LEGEND_SWATCHES = [0, 1, 2, 3, 4]

// Hard caps (Section 4.2) — the grid frame's outer dimensions are fixed by
// these caps, not by how much data a given topic has (Section 9 edge case).
const MAX_ROWS = 6
const MAX_COLUMNS = 4

/**
 * Heatmap — RTV-04's first genuinely new template type. Shows graduated
 * intensity across a small fixed matrix (<=6 rows x <=4 columns). Plain CSS
 * grid, not ReactFlow — a heatmap has no edges/relationships to draw, only a
 * regular grid (Section 4.2).
 */
export default function Heatmap({ data, isActive, onReady, styleOverrides }: HeatmapProps) {
  const rows = data.rows.slice(0, MAX_ROWS)
  const columns = data.columns.slice(0, MAX_COLUMNS)

  const cellLookup = new Map<string, { intensity: 0 | 1 | 2 | 3 | 4; label?: string | null }>()
  for (const cell of data.cells) {
    cellLookup.set(`${cell.row}|||${cell.column}`, { intensity: cell.intensity, label: cell.label })
  }

  // TMPL-01 — resolve the 3 slot types this template participates in. All
  // three are optional; when absent, the original hardcoded Tailwind values
  // apply unchanged (no style prop is added at all).
  const cellSizeOverride =
    typeof styleOverrides?.['cell-size'] === 'number' ? styleOverrides['cell-size'] : undefined
  const cellGapOverride =
    typeof styleOverrides?.['cell-gap'] === 'number' ? styleOverrides['cell-gap'] : undefined

  function intensityColorOverride(intensity: number): string | undefined {
    const value = styleOverrides?.[`intensity-${intensity}`]
    return typeof value === 'string' ? value : undefined
  }

  const cellSizeStyle = cellSizeOverride !== undefined ? { width: cellSizeOverride, height: cellSizeOverride } : {}
  const cellGapStyle = cellGapOverride !== undefined ? { margin: cellGapOverride } : {}

  return (
    <div className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div
        className="flex-1 flex flex-col pb-20 min-h-0"
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        {/* Header band — fixed h-[72px] */}
        <div className="h-[72px] shrink-0 overflow-hidden">
          <h2 className="text-3xl font-bold text-white mb-1 line-clamp-1">{data.title}</h2>
          <p className="text-sm text-[#94A3B8] line-clamp-1">{data.context}</p>
        </div>

        {/* Grid body */}
        <div className="flex-1 flex flex-col justify-center items-start overflow-hidden">
          <div className="flex">
            <div className="w-[140px] h-[56px] shrink-0" aria-hidden />
            <div className="flex">
              {columns.map((col) => (
                <div key={col} className="w-[64px] h-[56px] shrink-0 flex items-end justify-center pb-2 overflow-hidden">
                  <span className="text-sm text-[#94A3B8] text-center leading-tight line-clamp-2">{col}</span>
                </div>
              ))}
            </div>
          </div>

          {rows.map((row) => (
            <div key={row} className="flex items-center">
              <div className="w-[140px] h-[64px] shrink-0 flex items-center justify-end pr-3 overflow-hidden">
                <span className="text-sm text-[#94A3B8] text-right line-clamp-2">{row}</span>
              </div>
              <div className="flex">
                {columns.map((col) => {
                  const cell = cellLookup.get(`${row}|||${col}`)
                  const intensity = cell?.intensity ?? 0
                  const intensityOverride = intensityColorOverride(intensity)
                  return (
                    <div
                      key={col}
                      className={`w-[64px] h-[64px] shrink-0 rounded-lg m-0.5 flex items-center justify-center overflow-hidden ${INTENSITY_STYLES[intensity] ?? INTENSITY_STYLES[0]}`}
                      style={{
                        ...cellSizeStyle,
                        ...cellGapStyle,
                        ...(intensityOverride !== undefined ? { backgroundColor: intensityOverride } : {}),
                      }}
                    >
                      {cell?.label && (
                        <span className="text-xs text-white text-center line-clamp-1 px-1">{cell.label}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Legend strip — fixed h-[40px] */}
          <div className="h-[40px] shrink-0 mt-4 flex items-center gap-3 overflow-hidden">
            <span className="text-xs text-[#475569] shrink-0 line-clamp-1">{data.legend_low}</span>
            <div className="flex gap-1">
              {LEGEND_SWATCHES.map((i) => {
                const override = intensityColorOverride(i)
                return (
                  <div
                    key={i}
                    className={`w-5 h-5 rounded ${INTENSITY_STYLES[i]}`}
                    style={override !== undefined ? { backgroundColor: override } : undefined}
                  />
                )
              })}
            </div>
            <span className="text-xs text-[#475569] shrink-0 line-clamp-1">{data.legend_high}</span>
          </div>
        </div>
      </motion.div>

      {/* Footer ("so what?" band) — fixed h-[72px], standard shell pattern */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="absolute bottom-0 left-0 right-0 h-[72px] bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3 overflow-hidden"
      >
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white line-clamp-2">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
