'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Scales its content down (never up) so the whole page — nav is measured too — always fits within
 * one viewport height, on any device, with no vertical scrollbar. Per Arun's direct instruction:
 * "ensure that viewport 100% is the max size so dont add content to add scroll bar. it has to fit
 * in single window even if its mobile or ipad or desktop."
 *
 * Font-size/spacing shrinking alone can't guarantee this across arbitrarily short viewports (there's
 * a legibility floor), so this measures the content's natural (unscaled) height and applies a uniform
 * `transform: scale()` — the standard "shrink to fit" technique — recalculated on resize/orientation
 * change and whenever the content's own size changes (ResizeObserver).
 */
export default function FitToViewport({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [scaledHeight, setScaledHeight] = useState<number | null>(null)

  const recalc = () => {
    if (!outerRef.current || !contentRef.current) return
    // Bottom padding of the containing page section (e.g. containerStyle's clamp()-based padding)
    // sits AFTER this component in normal flow — it must come out of the available-height budget
    // too, not just the top offset, or the scaled content plus that trailing padding overflows the
    // viewport by exactly the padding amount.
    const parent = outerRef.current.parentElement
    const parentPaddingBottom = parent ? parseFloat(getComputedStyle(parent).paddingBottom || '0') : 0
    // Small extra safety margin for cross-browser font-metric/rounding differences.
    const safetyMargin = 4
    const availableHeight =
      window.innerHeight - outerRef.current.getBoundingClientRect().top - parentPaddingBottom - safetyMargin
    const naturalHeight = contentRef.current.scrollHeight
    if (naturalHeight === 0) return
    const nextScale = Math.min(1, availableHeight / naturalHeight)
    setScale(nextScale)
    setScaledHeight(naturalHeight * nextScale)
  }

  useLayoutEffect(() => {
    recalc()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    window.addEventListener('resize', recalc)
    window.addEventListener('orientationchange', recalc)
    const ro = new ResizeObserver(recalc)
    if (contentRef.current) ro.observe(contentRef.current)
    // Fonts/icons can finish loading a tick after the initial synchronous measurement — catch any
    // resulting reflow with one follow-up pass.
    const t = window.setTimeout(recalc, 150)
    return () => {
      window.removeEventListener('resize', recalc)
      window.removeEventListener('orientationchange', recalc)
      ro.disconnect()
      window.clearTimeout(t)
    }
  }, [])

  return (
    <div ref={outerRef} style={{ overflow: 'hidden', height: scaledHeight ?? undefined }}>
      <div
        ref={contentRef}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
        }}
      >
        {children}
      </div>
    </div>
  )
}
