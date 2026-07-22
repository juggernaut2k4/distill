/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 9, AT-11).
 *
 * Pure dirty-state comparison used to gate every Save button in this feature (the topic form and
 * each in-place screen edit) — extracted so the "disabled while every field matches the
 * last-saved baseline, re-enabled the instant any field changes" rule is unit-testable without
 * rendering a component. Mirrors `ShowcaseContentClient.tsx`'s own inline `unchanged` check.
 */
export function shallowFieldsEqual<T extends Record<string, string>>(current: T, saved: T): boolean {
  return Object.keys(saved).every((key) => current[key] === saved[key])
}
