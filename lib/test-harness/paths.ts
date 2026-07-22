/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 4/6.6, Known Constraint 2, AT-1).
 *
 * Identifies the harness's own AUTHORING surface (the three Basic-Auth-gated pages under
 * `/test-harness*` and their APIs under `/api/test-harness/*`) — deliberately excluding
 * `/test-harness-render/*`, which is a public, unauthenticated route that must stay reachable on
 * every host (including the main app origin) so the real `safeFetchPartnerPage()` pipeline can
 * fetch it (§0 point 2). Extracted into a small, pure, unit-testable function so both
 * `middleware.ts`'s Host-branch (§6.6) and the "block on every other host" defense-in-depth check
 * share the exact same definition — they can never drift out of sync with each other.
 *
 * `pathname.startsWith('/test-harness')` alone would ALSO match `/test-harness-render/...` — this
 * function deliberately checks for an exact match or a trailing `/` so the render route is never
 * accidentally swept in.
 */
export function isTestHarnessAuthoringPath(pathname: string): boolean {
  return (
    pathname === '/test-harness' ||
    pathname.startsWith('/test-harness/') ||
    pathname === '/api/test-harness' ||
    pathname.startsWith('/api/test-harness/')
  )
}
