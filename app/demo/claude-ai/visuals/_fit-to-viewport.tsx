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
    const availableHeight = window.innerHeight - outerRef.current.getBoundingClientRect().top
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
    return () => {
      window.removeEventListener('resize', recalc)
      window.removeEventListener('orientationchange', recalc)
      ro.disconnect()
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
