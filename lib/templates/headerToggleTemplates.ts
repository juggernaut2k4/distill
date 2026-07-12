/**
 * TMPL-07 — Per-Template Title/Subtitle Review Toggle (requirement doc Section 4.3).
 *
 * Fixed allowlist of the 7 template_library rows whose renderer today omits
 * (or partially omits) a title/subtitle header, and for which Arun can toggle
 * that header on/off from the admin Template Library review tool.
 *
 * Mirrors the shape of `isFixLoopTemplate()` in lib/templates/approval.ts —
 * but is its own independent module, NOT an extension of
 * lib/templates/styleOverrideSlots.ts or lib/templates/approval.ts, per the
 * brief's explicit instruction not to touch TMPL-01's fix loop, its Inngest
 * job, or its slot validator.
 */

export const HEADER_TOGGLE_TEMPLATE_NAMES = [
  'NarrativeCard',
  'ActionPlan',
  'QuoteCallout',
  'ConceptMap',
  'AnswerSpotlight',
  'FrameworkCard',
  'StatCallout',
] as const

export type HeaderToggleTemplateName = (typeof HEADER_TOGGLE_TEMPLATE_NAMES)[number]

export function isHeaderToggleTemplate(name: string): name is HeaderToggleTemplateName {
  return (HEADER_TOGGLE_TEMPLATE_NAMES as readonly string[]).includes(name)
}
