/**
 * B2B-71 (docs/specs/B2B-71-requirement-document.md §6.3/§6.5) — pure, dependency-free resolution
 * logic for the widget channel's on-topic visual jump. Ported from
 * `PartnerRenderClient.tsx`'s `resolveSectionIndex` (template-mode only there — matches
 * `section.meta.subtopicTitle`), adapted to widget inline pages' own `title` field (there is no
 * `subtopicTitle` concept for inline content). Same exact-match semantics, no fuzzy matching added.
 *
 * Kept dependency-free and standalone (not imported by `PartnerRenderClient.tsx`) per Arun's explicit
 * decision to build this capability as a genuinely separate implementation — see the Feature Brief's
 * "Arun's Follow-Up Decision" and this document's own §10.
 */

export interface WidgetJumpTarget {
  title: string | null
}

/**
 * Resolves a `show_visual` call's target page index. Returns `currentIndex` unchanged (a genuine
 * no-op, never an error) if neither param is usable or `topic_title` matches no page — identical
 * fallback posture to the ported function's own `idx < 0 ? activeIndexRef.current : idx`.
 */
export function resolveWidgetJumpIndex(params: Record<string, unknown>, pages: WidgetJumpTarget[], currentIndex: number): number {
  const sectionIndex = params.section_index as number | undefined
  const topicTitle = params.topic_title as string | undefined

  if (typeof sectionIndex === 'number' && sectionIndex >= 0 && sectionIndex < pages.length) {
    return sectionIndex
  }
  if (topicTitle) {
    const idx = pages.findIndex((p) => p.title === topicTitle)
    if (idx >= 0) return idx
  }
  return currentIndex
}

/**
 * §6.5/§7 — the forward-only progress computation `advance_tab` uses, extracted as a pure function
 * so it is directly testable that the widget component's progress always derives from
 * `progressIndexRef` (the value passed in here), never from wherever a jump happens to have scrolled
 * the screen to. Byte-identical clamp logic to `PartnerRenderClient.tsx`'s own `advance_tab` handlers
 * (`Math.min(current + 1, count - 1)`) — deliberately unchanged, per Arun's explicit instruction that
 * `advance_tab`'s forward-only semantics must not change in any way.
 */
export function computeNextProgressIndex(progressIndex: number, count: number): number {
  return Math.min(progressIndex + 1, count - 1)
}
