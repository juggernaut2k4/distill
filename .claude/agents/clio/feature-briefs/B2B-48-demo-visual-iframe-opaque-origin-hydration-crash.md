# Feature Brief: B2B-48 — Demo Screen-Share Crash: Root Cause Found (Opaque-Origin `srcDoc` Breaks Next.js's Own Router Hydration) + Architectural Fix

From: CEO (Arun)
To: Developer Agent / Orchestrator
Priority: P0
Date: 2026-07-29

## What Arun Said

"Still same application error. Debug with CEO agent and fix it." — the fourth attempt at this
exact bug tonight, after B2B-43 (screen-boundary mitigations), B2B-45 (CORS fix on the report
endpoint), and B2B-47 (excluded Clerk from `/demo/**` via a second root layout — live-verified to
NOT fix the crash). Mid-investigation, Arun added directly: Clio owns this whole stack, don't treat
any auth/session mechanism as fixed, and if the honest fix requires restructuring how these pages
are served (not just excluding Clerk from a route group), that's explicitly authorized — these
pages are supposed to render seamlessly, every time, with zero friction.

## Bottom line

**Found it, with high confidence, from static analysis — no live repro session needed.** This was
never really an auth problem (Clerk was correctly ruled out in B2B-47). It's a structural mismatch:
Clio's own first-party demo pages are being pushed through the SSRF-hardened pipeline that exists
to safely embed **untrusted third-party partner content** — and that pipeline's opaque-origin
`srcDoc` sandbox is fundamentally incompatible with a full Next.js App Router document's own
client-side hydration bootstrap, which needs a real `window.location` to reconcile against the
server-rendered route it was built for. First-party content has no third party to protect against,
so it never needed that pipeline in the first place. Section "Proposed fix" below removes the
mismatch by construction rather than adding another mitigation layer.

## The chain of evidence (verified directly against live code this session)

**1. What actually gets iframed.** `app/api/demo/[slug]/dispatch/route.ts` line 164 builds
`content_pages[].url` as `` `${contentBaseUrl}/demo/${params.slug}/visuals/${ch.id}` `` — this is
**Clio's own route** (`app/(demo)/demo/claude-ai/visuals/[chapterId]/page.tsx`), not a partner's
page. `lib/partner/live-render.ts`'s `resolveInlineSessionRender()` then calls
`safeFetchPartnerPage()` (`lib/partner/ssrf.ts`) — a plain SSRF-guarded `fetch()` GET — against that
URL, retrieves the **complete rendered Next.js document** (full `<html>`, the App Router's client
hydration bootstrap `<script>` tags, the inline Flight/RSC payload), runs
`injectIframeDiagnosticShim()` to prepend a diagnostic `<script>`, and hands the whole HTML string
to `PartnerRenderClient.tsx` as `page.contentHtml`, which sets it via
`<iframe srcDoc={page.contentHtml} sandbox="allow-scripts">` — deliberately **without**
`allow-same-origin`, per the AT-SSRF-3 threat model comment: a real reseller's page must never read
Clio's session data. That constraint is correct and necessary for genuine third-party content. It
does not apply to Clio's own pages — there is no third party here to isolate from.

**2. What an opaque-origin `srcDoc` iframe actually breaks.** A `sandbox="allow-scripts"` iframe
with no `allow-same-origin` gets a unique **opaque origin**, and — specific to `srcDoc` (as opposed
to a real `src` navigation) — its `window.location.href` is literally `about:srcdoc`, not the URL
the HTML was fetched from. The fetched document, however, is a **full Next.js App Router page**:
its client bootstrap script (evaluated at module scope, before any component — including this
page's own `DiagnosticErrorBoundary` — ever mounts) constructs its initial router state by reading
`window.location` and reconciling it against the canonical route encoded in the server-rendered
Flight payload (`/demo/claude-ai/visuals/what-is-claude`, etc.). Inside the iframe, that read
returns `about:srcdoc` instead — a value the router bootstrap was never built to handle. This is
framework bootstrap code, not page code: it runs **above and before** `page.tsx`, in the same tier
Next.js's own (uncustomized) default error boundary occupies.

**3. This explains every single piece of evidence gathered tonight, with no residual mystery:**

- **DiagnosticErrorBoundary never fires, despite being a real `componentDidCatch` boundary
  correctly wired to `window.__CLIO_REPORT_REACT_ERROR__`.** Confirmed live: `find app -iname
  "*error*.tsx"` returns exactly one file anywhere under `app/` — `_diagnostic-error-boundary.tsx`
  (an underscore-prefixed component, not the Next.js `error.tsx` file convention). **There is no
  custom `error.tsx` anywhere in `app/(demo)/**`.** That means the literal string "Application
  error: a client-side exception has occurred" being observed is not a loosely-matched signature —
  it is **Next.js's own hardcoded default fallback**, used specifically because no app-level
  boundary overrides it. `DiagnosticErrorBoundary` sits strictly *inside* `page.tsx`, several levels
  below where the App Router's own default segment boundary lives. A failure in the router's own
  bootstrap, which runs at mount time for the whole segment rather than as a descendant of
  `page.tsx`'s JSX tree, is structurally invisible to a boundary placed inside that JSX tree — it can
  only ever catch errors thrown by its own children's render/commit, not errors from the framework
  machinery that mounts everything above it.
- **`window.onerror`/`unhandledrejection` never fire, even once, even after the B2B-45 CORS fix
  confirmed the sink itself now works.** This is standard, well-documented React/Next behavior,
  already correctly identified in this file's own B2B-43 comment: an error caught internally by
  *any* error-boundary machinery (Next's own default one included) is consumed via React's internal
  try/catch during render/commit and **never** reaches the browser's global `error` /
  `unhandledrejection` events. Total silence from both global handlers is exactly what this failure
  mode predicts — not a gap in the diagnostics, but confirmation of where the error is actually being
  caught.
- **Multiple pages crash within ~0.5s of each other, right at session start, every time.**
  `PartnerRenderClient.tsx` (`app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`,
  lines ~401-430) renders **all** `inlinePages` up front in one `.map()` — a separate `<iframe>` per
  page, all mounted simultaneously — not one iframe whose `srcDoc` is swapped per page. Session start
  is exactly when all of them hydrate at once. Since the failure is a systemic property of *any*
  fetched Next.js document being dropped into an opaque-origin `srcDoc` (not something specific to
  one visual's content), several/most of the simultaneously-mounting iframes hit it independently, in
  the same ~half-second window, regardless of which specific pages they are — matching the observed
  pattern exactly (different page sets crashed on different nights: "What Makes Claude Different" /
  "What Is Claude?" / "Modes of Interaction" / "Choosing the Right Model" tonight, vs. "Choosing the
  Right Model" / "Model Family" on B2B-47's occurrence — consistent with "most simultaneously-mounted
  iframes are at risk," not any one page being special).

No part of this required guessing at browser internals I couldn't verify — it's the direct,
foreseeable consequence of feeding a framework document that expects a real navigable URL into a
sandbox specifically designed to deny it one.

## Why this was hard to see from the mitigations tried so far

B2B-43/45/47 all correctly ruled out real hypotheses (a catchable global JS error; Clerk
initializing in the sandbox) and each fix was itself sound and worth keeping — the diagnostic shim,
the CORS fix, and the Clerk exclusion are all still correct, still doing useful work, and should
stay. But all three were mitigations layered *around* the iframe boundary, on the assumption that
whatever's crashing is ordinary page/component code that a better boundary or better reporting could
eventually catch or explain. The actual failure lives one layer further out, in the transport
decision (fetch-and-reinject-as-opaque-`srcDoc`) applied to content that never needed that isolation
model at all.

## Proposed fix — addressing Arun's redesign latitude directly

The fetch-and-reinject-as-opaque-`srcDoc` pipeline (`safeFetchPartnerPage` +
`injectIframeDiagnosticShim` + `sandbox="allow-scripts"` with no `allow-same-origin`) is **correct
and should be kept unchanged** for genuine third-party reseller content — that's exactly the AT-SSRF-3
threat model it exists for, and nothing about this investigation calls that into question.

The fix is to stop routing **Clio's own first-party demo pages** through it. Concretely, in
`app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`, the inline-HTML branch
(lines ~417-427) should distinguish first-party Clio content (currently: any page whose fetched HTML
is Clio's own `/demo/**` route, servable directly and safely by real navigation) from genuine partner
content, and render the former via a normal same-origin-capable `<iframe src="..." sandbox=
"allow-scripts">` (real navigation, not `srcDoc`) pointed straight at the real URL, instead of
fetching it server-side and reinjecting it opaquely. A real `src` navigation gives the iframe a real,
navigable `window.location` matching what the page's own Next.js router bootstrap expects — the
entire failure class disappears by construction, the same way any ordinary page load already works
correctly outside this pipeline (this is, after all, exactly how `/demo/claude-ai/visuals/what-is-claude`
already renders correctly today when visited directly in a browser tab).

Two implementation paths, in order of recommendation:

1. **Narrowest, lowest-risk**: `resolveInlineSessionRender()` in `lib/partner/live-render.ts` already
   knows each page's `url`. Add a cheap first-party check (e.g., the URL's origin matches
   `DEMO_CONTENT_BASE_URL`/`NEXT_PUBLIC_APP_URL`, or a page-level flag set only by
   `app/api/demo/[slug]/dispatch/route.ts`, which is the *only* caller that ever supplies Clio's own
   URLs — real partner sessions via `app/api/partner/v1/sessions/route.ts` never do). For first-party
   pages, skip `safeFetchPartnerPage`/`injectIframeDiagnosticShim` entirely and pass the raw `url`
   through; `PartnerRenderClient.tsx` renders those as `<iframe src={page.url} sandbox=
   "allow-scripts">` instead of `srcDoc`. Genuine partner pages are completely untouched — same fetch,
   same shim, same opaque `srcDoc` sandbox as today.
2. **More uniform, more work**: keep every inline page on the `srcDoc` transport (including Clio's
   own), but stop serving Clio's demo visuals as full Next.js App Router documents in the first place
   — pre-render them as dependency-free static HTML fragments (markup + inline CSS + a small vanilla
   scale-to-fit script, no `_next/static` hydration bundle, no Flight payload, nothing that reads
   `window.location` expecting a real URL). This keeps the opaque-origin sandbox uniform across all
   inline content but requires a parallel static-rendering path for the 12 existing visual components
   (`_visuals/*.tsx` under both `claude-ai` and `oop-fundamentals`) and any future ones.

Recommend (1): it's a small, self-contained change, touches no security boundary that matters for
real partner content, and eliminates the bug the same way the page already renders correctly when
visited directly — rather than reconstructing that guarantee a second way.

## What this is not

This is not an auth redesign — Clerk was already correctly excluded in B2B-47 and stays excluded.
Nothing here reintroduces a Clerk/session dependency into `/demo/**`. The "auth-adjacent" angle Arun
asked to keep open turned out to be a dead end on inspection: the actual mechanism is the
`srcDoc`-vs-real-navigation transport choice for content that was never actually third-party, not
anything about how (or whether) a user is authenticated.

## Confidence and recommendation

High confidence in root cause from static analysis alone — every distinct piece of evidence gathered
across B2B-43/45/47 tonight is explained by this one mechanism with no leftover contradiction, and
the mechanism itself (`about:srcdoc` giving a Next.js router bootstrap a location it can't reconcile)
is a well-understood, documented browser/framework interaction, not speculation. This does not
strictly require a live DevTools repro session to confirm before shipping fix option (1) — but if
Arun wants belt-and-suspenders confirmation before merging, the fastest live check is: open
`/demo/claude-ai/visuals/what-is-claude` directly in a normal browser tab (works fine, confirming the
page itself is not broken), then construct a minimal local HTML file that iframes it via `srcDoc`
with `sandbox="allow-scripts"` (no `allow-same-origin`) and watch DevTools' iframe context switcher —
the crash should reproduce immediately, on demand, outside of a live meeting session entirely.

## Files referenced (no code changed yet — awaiting go-ahead per the CEO/BA gate for the proposed fix)

- `app/api/demo/[slug]/dispatch/route.ts` (confirms `content_pages[].url` points at Clio's own route)
- `lib/partner/live-render.ts` (`resolveInlineSessionRender`, `safeFetchPartnerPage` call site,
  `injectIframeDiagnosticShim`)
- `lib/partner/ssrf.ts` (`safeFetchPartnerPage`)
- `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` (iframe render site,
  lines ~401-430; confirms all pages mount simultaneously)
- `app/(demo)/layout.tsx`, `app/(demo)/demo/_diagnostic-error-boundary.tsx`,
  `app/(demo)/demo/claude-ai/visuals/[chapterId]/page.tsx` (confirms no custom `error.tsx` exists
  anywhere under `app/(demo)/**`)
