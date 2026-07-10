'use client'

import { motion } from 'framer-motion'
import type { OverlayData, OverlayZonePosition } from '@/lib/templates/types'

interface OverlayProps { data: OverlayData; isActive: boolean; onReady?: () => void }

type OverlayZone = OverlayData['zones'][number]

const COLOR_HEX: Record<OverlayZone['color'], string> = {
  purple: '#7C3AED',
  cyan: '#06B6D4',
  amber: '#F59E0B',
  green: '#10B981',
}

// Hard cap (Section 4.2) — max 4 of the 9 available grid slots.
const MAX_ZONES = 4

// Maps each of the 9 fixed grid slots to a row/col index (0-2) inside the
// 700x420 panel's invisible 3x3 grid (~233px x 140px per cell).
const SLOT_GRID: Record<OverlayZonePosition, { row: number; col: number }> = {
  'top-left': { row: 0, col: 0 }, 'top-center': { row: 0, col: 1 }, 'top-right': { row: 0, col: 2 },
  'mid-left': { row: 1, col: 0 }, 'mid-center': { row: 1, col: 1 }, 'mid-right': { row: 1, col: 2 },
  'bottom-left': { row: 2, col: 0 }, 'bottom-center': { row: 2, col: 1 }, 'bottom-right': { row: 2, col: 2 },
}

/**
 * Which edge a zone's callout docks to, per Section 4.2: top-row zones dock
 * above the panel, bottom-row zones dock below, mid-left/mid-right dock to
 * their respective side. The spec does not define an edge for mid-center
 * (no sample data uses it) — docks above as a pragmatic fallback; a judgment
 * call flagged in the RTV-04 build report.
 */
function dockSide(position: OverlayZonePosition): 'top' | 'bottom' | 'left' | 'right' {
  if (position.startsWith('top')) return 'top'
  if (position.startsWith('bottom')) return 'bottom'
  if (position === 'mid-left') return 'left'
  if (position === 'mid-right') return 'right'
  return 'top'
}

const PANEL_W = 700
const PANEL_H = 420
const CELL_W = PANEL_W / 3
const CELL_H = PANEL_H / 3

function CalloutCard({ zone }: { zone: OverlayZone }) {
  const hex = COLOR_HEX[zone.color] ?? COLOR_HEX.purple
  return (
    <div
      className="w-[220px] h-[96px] rounded-xl border bg-[#111111] p-3 flex flex-col justify-center overflow-hidden shrink-0"
      style={{ borderColor: `${hex}80` }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: hex }} />
        <span className="text-sm font-semibold line-clamp-1" style={{ color: hex }}>{zone.callout_label}</span>
      </div>
      <p className="text-xs text-[#94A3B8] line-clamp-3">{zone.callout_detail}</p>
    </div>
  )
}

function Marker({ zone }: { zone: OverlayZone }) {
  const hex = COLOR_HEX[zone.color] ?? COLOR_HEX.purple
  const slot = SLOT_GRID[zone.position]
  return (
    <div
      className="absolute flex items-center justify-center pointer-events-none"
      style={{ left: slot.col * CELL_W, top: slot.row * CELL_H, width: CELL_W, height: CELL_H }}
    >
      <div className="flex items-center gap-1.5 bg-[#080808]/80 rounded-full px-2 py-1 border border-[#333333] max-w-full">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hex }} />
        <span className="text-xs text-white line-clamp-1">{zone.zone_label}</span>
      </div>
    </div>
  )
}

function Connector({ side, color }: { side: 'top' | 'bottom' | 'left' | 'right'; color: string }) {
  const isVertical = side === 'top' || side === 'bottom'
  return (
    <div className="shrink-0" style={isVertical ? { width: 2, height: 24, background: color } : { width: 24, height: 2, background: color }} />
  )
}

/**
 * Overlay — RTV-04's second genuinely new template type. Names and briefly
 * explains up to 4 distinct zones of one whole concept. The "base" is a plain
 * CSS-drawn rounded rectangle (never an image/screenshot); zones sit in fixed
 * 3x3 grid slots, not free-form coordinates (Section 4.2).
 */
export default function Overlay({ data, isActive, onReady }: OverlayProps) {
  const zones = data.zones.slice(0, MAX_ZONES)

  const topZones = zones.filter((z) => dockSide(z.position) === 'top')
  const bottomZones = zones.filter((z) => dockSide(z.position) === 'bottom')
  const leftZones = zones.filter((z) => dockSide(z.position) === 'left')
  const rightZones = zones.filter((z) => dockSide(z.position) === 'right')

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

        {/* Body — fixed 700x420 base panel + docked callouts, centered */}
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <div className="flex flex-col items-center gap-3">
            {topZones.length > 0 && (
              <div className="flex gap-6 justify-center">
                {topZones.map((z) => (
                  <div key={z.id} className="flex flex-col items-center">
                    <CalloutCard zone={z} />
                    <Connector side="top" color={COLOR_HEX[z.color] ?? COLOR_HEX.purple} />
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              {leftZones.length > 0 && (
                <div className="flex gap-3">
                  {leftZones.map((z) => (
                    <div key={z.id} className="flex items-center gap-0">
                      <CalloutCard zone={z} />
                      <Connector side="left" color={COLOR_HEX[z.color] ?? COLOR_HEX.purple} />
                    </div>
                  ))}
                </div>
              )}

              {/* Fixed 700x420 base panel — plain CSS rectangle, never an image */}
              <div
                className="relative rounded-2xl border-2 border-[#333333] bg-[#111111] shrink-0 overflow-hidden"
                style={{ width: PANEL_W, height: PANEL_H }}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold text-white text-center line-clamp-2 px-6">{data.base_label}</span>
                </div>
                {zones.map((z) => <Marker key={z.id} zone={z} />)}
              </div>

              {rightZones.length > 0 && (
                <div className="flex gap-3">
                  {rightZones.map((z) => (
                    <div key={z.id} className="flex items-center gap-0">
                      <Connector side="right" color={COLOR_HEX[z.color] ?? COLOR_HEX.purple} />
                      <CalloutCard zone={z} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {bottomZones.length > 0 && (
              <div className="flex gap-6 justify-center">
                {bottomZones.map((z) => (
                  <div key={z.id} className="flex flex-col items-center">
                    <Connector side="bottom" color={COLOR_HEX[z.color] ?? COLOR_HEX.purple} />
                    <CalloutCard zone={z} />
                  </div>
                ))}
              </div>
            )}
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
