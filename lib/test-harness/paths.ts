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

/**
 * The "Learn with AI" demo catalog (`/demo`, `/demo/[slug]`) — public and unauthenticated, but,
 * per Arun's own framing ("build the page in test.hello-clio.com... separately not part of
 * hello-clio"), scoped to the test-harness subdomain only. Global `isPublicRoute` in
 * `middleware.ts` makes `/demo` reachable to Clerk on every host, so this needs the same
 * defense-in-depth 404 the authoring surface gets: without it, `/demo` would also render on
 * hello-clio.com/distill-peach.vercel.app since the route physically exists in the app.
 *
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.8) extends this to also match
 * `/api/demo/(.*)` — the three new server-only meeting-URL/dispatch routes, which need the exact
 * same host-scoping as every other `/demo/*` route but didn't exist when this function was first
 * written for B2B-32.
 */
export function isDemoPath(pathname: string): boolean {
  return (
    pathname === '/demo' ||
    pathname.startsWith('/demo/') ||
    pathname === '/api/demo' ||
    pathname.startsWith('/api/demo/')
  )
}
