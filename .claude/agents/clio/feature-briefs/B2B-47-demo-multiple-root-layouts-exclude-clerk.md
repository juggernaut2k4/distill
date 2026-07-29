# Feature Brief: B2B-47 — Demo Screen-Share Crash: Multiple Root Layouts (Exclude Clerk from `/demo/**`)

From: CEO (Arun)
To: Developer Agent / Orchestrator
Priority: P0
Date: 2026-07-29

## What Arun Said

Continuation of the B2B-43 investigation ("still showing application error in screen sharing").
Arun has confirmed this fix is important and wants it worked now, with one explicit constraint:
**no repeat of the `npm run build` failure from two nights ago.** He wants rigor, not speed —
this brief is written accordingly, with every load-bearing claim independently re-verified against
live code, live git history, and live production data rather than trusted from the prior write-up.

## Independent verification performed (not taken on faith)

**Git history claim — CONFIRMED.** `git log --all -p -S"ClerkProviderGate"` shows exactly one hit:
commit `3f1e10d` (B2B-43, 2026-07-28), whose own commit message states the `ClerkProviderGate`
`usePathname()` attempt "failed a real `npm run build`... Caught only by the mandatory real-build
verification step, reverted cleanly before this commit — `app/layout.tsx` is unchanged, no
`ClerkProviderGate` component shipped." No `ClerkProviderGate` file exists in any commit on any
branch (`git log --all --source -- '**/ClerkProviderGate*'` returns nothing — it was never
committed at all, consistent with a clean pre-commit revert). Read `app/layout.tsx` directly: it
still imports `ClerkProvider` from `@clerk/nextjs` and wraps `<html>/<body>` unconditionally,
exactly as before the whole investigation started. Confirmed clean.

**`glitch_instances` claim — CONFIRMED, queried directly (Supabase project `nqxlpcshouboplhnuvrh`).**
Two rows for `partner_session_id = 'ede530c4-be50-4801-a840-734d7c557a09'`,
`glitch_type = 'technical_error'`:
- `14:33:00.896007+00` — `source: error-boundary` / `[iframe:error-boundary] Choosing the Right
  Model for the Job — Next.js error-boundary fallback detected in document`
- `14:33:01.247141+00` — `source: error-boundary` / `[iframe:error-boundary] The Claude Model
  Family — Next.js error-boundary fallback detected in document`

0.351s apart, both `source: error-boundary` (Next.js's in-document error boundary, which never
reaches `window.onerror` — this is why the original raw-exception diagnostic shim produced zero
reports even with CORS fixed). Consistent with, not proof of, the Clerk hypothesis. The two exact
crashing URLs are `/demo/claude-ai/visuals/choosing-the-right-model` and
`/demo/claude-ai/visuals/model-family` (confirmed against `app/demo/_content.ts` ids).

**Directory structure — enumerated fresh, not trusted from any prior list.** Top-level entries
directly under `app/`: `(auth)`, `(marketing)`, `api`, `dashboard`, `demo`, `invite`,
`partner-invite`, `partner-questionnaire`, `partner-render`, `partner-signup`, `showcase-render`,
`team-invite`, `test-harness`, `test-harness-render`, `walkthrough`, plus `layout.tsx` and
`globals.css`. Only two `layout.tsx` files exist anywhere in `app/`: the root one and
`app/dashboard/layout.tsx` (nested, not a root layout — it renders inside the root layout's
`<ClerkProvider>`, doesn't define `<html>/<body>`, and stays exactly as-is, unaffected by this
change).

**Clerk usage per top-level directory** (`grep -rlE "@clerk/nextjs|useAuth|useUser|currentUser|
ClerkProvider|auth\(\)"`):

| Directory | Clerk refs | Verdict |
|---|---|---|
| `(auth)` | 2 | Clerk's own sign-in/sign-up components — needs Clerk |
| `(marketing)` | 0 | No direct refs, but harmless to keep with Clerk |
| `api` | 22 | Route Handlers — layouts don't apply to these at all (see below) |
| `dashboard` | 31 | Needs Clerk |
| `invite`, `partner-invite`, `partner-signup`, `team-invite` | 1 each | Need Clerk |
| `partner-questionnaire`, `partner-render`, `showcase-render`, `test-harness`, `walkthrough` | 0 | No Clerk dependency today, but not the self-referencing-content pattern either (see below) — no reason to move them out of the Clerk group |
| `test-harness-render` | 0 | Route Handler only, not a page — layouts don't apply |
| `demo` | 0 | Confirmed zero Clerk usage anywhere in the subtree |

**Scoping re-confirmed narrower than the open BACKLOG.md item worried about.** B2B-43's brief
flagged `lib/test-harness/payload.ts` as a "similar self-referencing-content exposure" worth a
follow-up look. I checked: its `content_pages[].url` points at
`${appUrl}/test-harness-render/${screenId}`, and `app/test-harness-render/[screenId]/route.ts` is
a **Route Handler** (`route.ts`), not a page — its own code comment confirms this is deliberate
("Deliberately a Route Handler, not a page component, so arbitrary `Content-Type`... and the CSP
`sandbox allow-scripts` header... can be set precisely"). Route Handlers never render through the
layout tree (no `<html>/<body>`, no root-layout concept applies to them at all) — they return a
`Response` directly. So the test-harness content path was **never actually exposed** to this crash
class; it's structurally immune by construction. This closes that open worry — no separate fix
needed there, and it's safe to leave out of this brief's scope entirely.

**Cross-boundary navigation — checked, zero found.** Next.js's own docs confirm navigating between
two different root layouts triggers a full page reload (not a client-side transition), since React
can't reconcile two different `<html>/<body>` trees. I grepped every `<Link>`/`useRouter` reference
inside `app/demo/**` and every reference to `"/demo"` outside it: all four `<Link>` usages inside
`/demo/**` point only to other `/demo/**` routes (`/demo`, `/demo/[slug]`); nothing outside
`/demo/**` links into it either. So this real Next.js characteristic has zero observed impact
today — flagging it in "Open risks" below for future-proofing, not as a blocker.

**Next.js 14.2.35 (confirmed via `package.json`) officially supports this pattern.** Per Next.js
docs (nextjs.org/docs/14/app/building-your-application/routing/route-groups): "To create multiple
root layouts, remove the top-level layout.js file, and add a layout.js file inside each route
group... The `<html>` and `<body>` tags need to be added to each root layout." This matches
exactly what this brief specifies below — the existing single `app/layout.tsx` is **deleted
entirely**, not kept alongside the new group layouts (confirmed this is a hard requirement, not
optional — a top-level `app/layout.tsx` cannot coexist with route-group-level root layouts).

## The Problem Being Solved

The demo tool's own visual content pages get fetched server-side and embedded via `srcDoc` into a
`sandbox="allow-scripts"` iframe (deliberately without `allow-same-origin`, per AT-SSRF-3) inside
`PartnerRenderClient.tsx`. That sandboxing gives the iframe an opaque `Origin: null` and blocks its
access to `sessionStorage`/`localStorage`/cookies. `app/layout.tsx` unconditionally wraps every
route — including these demo pages — in `<ClerkProvider>`, even though nothing under `/demo/**`
uses Clerk for anything. The working hypothesis (strengthened, not proven, by tonight's captured
`error-boundary` crash signature) is that Clerk's client-side initialization throws synchronously
during render in this opaque-origin, storage-blocked context, and Next.js's own error boundary
catches it and shows the generic "Application error" screen the end-client sees during a live
sales demo.

## What Success Looks Like

`/demo/**` gets its own root layout with no `ClerkProvider` anywhere in its tree, structurally
removing the hypothesized crash cause, while every other route keeps today's Clerk-backed root
layout exactly as-is, with zero URL changes anywhere in the app (route groups never appear in
URLs) and zero regression to any Clerk-authenticated flow.

## Governance call — pure technical fix, no BA gate, elevated engineering rigor instead

Per CLAUDE.md's autonomy boundary: "Technical decisions (library, config, schema, error handling):
full autonomy" vs. "Product decisions (what a screen shows, what copy says, what a flow does):
[require the BA spec]." This change touches **zero** product surface — no new screens, no copy
changes, no information architecture changes, no change to what any screen shows or does, and (per
the URL-neutrality of route groups, confirmed above) no change to a single URL or link anywhere in
the app. It is a pure rendering-architecture restructuring to eliminate a bug, continuing the same
technical investigation thread as B2B-43/44/45, which were all handled the same way. A BA
Requirement Document (wireframes, screen descriptions, acceptance criteria for UX) has nothing to
resolve here — there is no UX ambiguity, only an engineering-correctness question.

That said, the blast radius is real — this restructures literally every top-level route in the
app, which is exactly the class of "high blast radius, low visible signal" mistake that broke the
build two nights ago. The correct compensating control for that risk is **engineering verification
depth**, not a product spec. Accordingly this brief sets a stricter Definition of Done than a
typical technical fix (full build pass **and** mandatory live click-through across every affected
route family, not just the demo ones — see below) rather than routing through the BA.

## Implementation plan — exact file moves (technical decision, specified precisely to remove any ambiguity for Dev)

**Delete** `app/layout.tsx` entirely (do not keep it alongside the new group layouts — Next.js does
not allow a top-level root layout to coexist with route-group root layouts).

**New group `app/(demo)/`** — root layout, **no `ClerkProvider`**:
- `app/(demo)/layout.tsx` — new file. Same `<html lang="en" className="dark">` /
  `<body className={inter.className + " bg-void text-white antialiased"}>` shell as today, same
  `Inter` font load, same `metadata` export (title/description/manifest/openGraph — duplicate
  verbatim, no visual/SEO regression), imports `../globals.css`. **Does not** wrap children in
  `<ClerkProvider>`. **Does not** render `<CleanupOrphanedProfile />` (see reasoning below).
- Move `app/demo/**` → `app/(demo)/demo/**` unchanged (all files, no content edits — this is a
  pure file relocation). Route group folders are omitted from the URL, so `/demo`, `/demo/[slug]`,
  `/demo/claude-ai/visuals/[chapterId]`, `/demo/oop-fundamentals/visuals/[chapterId]` all resolve
  to the exact same URLs as today.

**New group `app/(with-clerk)/`** — root layout, keeps `ClerkProvider` (this is today's
`app/layout.tsx` content, relocated verbatim, not rewritten):
- `app/(with-clerk)/layout.tsx` — new file, byte-for-byte the same `ClerkProvider` wrap,
  `CleanupOrphanedProfile`, `Inter` font, `metadata`, `dark` className, and body classes as the
  current `app/layout.tsx`, imports `../globals.css`.
- Move into this group, unchanged: `(auth)/`, `(marketing)/`, `dashboard/` (its own nested
  `layout.tsx` moves along with it, untouched), `invite/`, `partner-invite/`,
  `partner-questionnaire/` (including its `submit/route.ts`), `partner-render/`, `partner-signup/`,
  `showcase-render/`, `team-invite/`, `test-harness/`, `walkthrough/`.
  Resulting paths look like `app/(with-clerk)/dashboard/**`, `app/(with-clerk)/(auth)/sign-in/**`,
  etc. — nesting route groups is fine. Every one of these keeps its exact current URL.

**Not moved, unaffected by this change:**
- `app/api/**` (22 Clerk references) — Route Handlers, never pass through the layout/page render
  tree, no root-layout dependency at all.
- `app/test-harness-render/[screenId]/route.ts` — same reasoning, confirmed above.
- `app/globals.css` — stays where it is; both new layouts import it via relative path (`../globals.css`).

## What to duplicate vs. not duplicate (Arun's question in step 3, answered)

- **`Inter` font load, `globals.css` import, `metadata` export, `dark` className, body classes** —
  duplicate identically into both new layouts. These are pure styling/meta concerns with zero
  Clerk dependency; each root layout is now a fully independent tree and must be self-contained
  per the Next.js pattern, or the `(demo)` tree renders unstyled.
- **`<CleanupOrphanedProfile />`** — **only** in `(with-clerk)`, not duplicated into `(demo)`.
  Read `hooks/useCleanupOrphanedProfile.ts`: it calls `useAuth()` from `@clerk/nextjs` and does
  nothing unless `isLoaded && isSignedIn === false`. It is Clerk-dependent by construction — it
  literally cannot run in a tree with no `ClerkProvider`, and its purpose (clearing stale
  onboarding `localStorage` for signed-out users) has no meaning in the demo tool anyway.

## Blast-radius check on other route groups (Arun's question in step 4, answered)

Read every `layout.tsx`/`page.tsx` sitting directly under `app/` (not nested under `/demo`):
`(auth)` has no `layout.tsx` of its own (relies on the root layout today — after this change it
relies on `(with-clerk)/layout.tsx` the same way); `(marketing)` likewise. Neither assumes
anything beyond "a root layout with `<html>/<body>` and `ClerkProvider` exists somewhere above
me," which remains true. `dashboard/layout.tsx` is a nested (non-root) layout that calls
`auth()` from `@clerk/nextjs/server` — it renders inside `(with-clerk)`'s `ClerkProvider`
exactly as it does today, no change in behavior. No route directly under `app/` (outside
`/demo/**`) uses `generateStaticParams()` — only `app/demo/claude-ai/visuals/[chapterId]/page.tsx`
and its `oop-fundamentals` counterpart do (confirmed — these are statically pre-rendered at build
time for every `chapterId`, which is exactly the code path the previous `usePathname()` attempt
broke at build time app-wide; this route-groups approach resolves the same question at the
file-structure level instead of at runtime, which is why it doesn't share that failure mode).
No other top-level route's behavior, config, or static-generation assumptions are affected.

## Definition of Done — mandatory verification bar (no exceptions, this is what failed last time)

1. `npx tsc --noEmit` — clean.
2. `npm run build` — must pass with zero errors. This is the exact gate that caught the previous
   failure; a green `tsc` alone is not sufficient and must not be treated as done.
3. `npx vitest run` (full existing suite) — must stay green; nothing should reference `app/layout.tsx`
   by path, but confirm.
4. **Live browser click-through (mandatory, not optional) on all of the following**, in a real
   browser against the deployed preview, not just local dev:
   - Marketing homepage `/` — loads correctly, unchanged.
   - `/sign-in` and `/sign-up` — Clerk components render and function.
   - A dashboard page while authenticated — confirms the Clerk auth gate still redirects
     unauthenticated users to `/sign-in` and renders correctly once signed in.
   - Demo catalog `/demo` — loads correctly.
   - `/demo/claude-ai/visuals/choosing-the-right-model` and
     `/demo/claude-ai/visuals/model-family` — the two exact pages confirmed crashing tonight.
     `curl`/view-source on both: confirm the returned HTML contains **no** reference to
     `clerk.hello-clio.com`, `@clerk/clerk-js`, or any `pk_live_`/`pk_test_` publishable key
     (this is the same falsifiable check used in the B2B-43 write-up — it must now come back
     negative where it previously came back positive).
   - At least one route from a family not directly touched by hand today as a spot-check for
     move-related regressions — e.g. `/partner-questionnaire/[partner_account_id]` or
     `/team-invite/accept`.
5. **The real proof, not just build success**: re-run (or have Arun re-run) a live "Learn with AI"
   demo session that screen-shares both known-crashing pages, and confirm **zero** new
   `glitch_type = 'technical_error'` / `source: error-boundary` rows land in `glitch_instances`
   for that session. A passing build proves the restructuring didn't break anything; it does not
   by itself prove the crash is fixed — only a real repro attempt does.

Only when all five pass is this done. If step 4 or 5 surfaces a problem, fix and re-run the full
list — do not assume a targeted patch didn't disturb something else, per the standing QA-gate rule.

## Open risks / things to flag, not blockers

- **Full-page-reload on cross-root-layout navigation** is a real, documented Next.js
  characteristic of this pattern (confirmed via official docs) — any future `<Link>` added from a
  `/demo/**` page to a `(with-clerk)` route (or vice versa) will hard-reload instead of
  client-transition. Zero such links exist today (verified), so this is not a regression, but
  worth a one-line comment in both new `layout.tsx` files so a future engineer doesn't add one
  expecting SPA behavior.
- **Route-group naming** (`(demo)`, `(with-clerk)`) is a cosmetic technical choice, not a product
  one — Dev may rename if a clearer convention is preferred, but should keep names descriptive of
  purpose (not `(group1)`/`(group2)`) since the whole point of this restructuring is to make the
  Clerk boundary obvious to the next engineer who touches this code.
- This does not, on its own, prove the crash's root cause was Clerk — it removes the leading
  hypothesis structurally. If step 5 above still shows crashes after this ships, the diagnostic
  shim from B2B-43 Fix 4b is still in place and will surface whatever the next signal is; escalate
  back to CEO rather than guessing further.

## Files Changed (for QA Gate 1 code review reference)

- Deleted: `app/layout.tsx`
- New: `app/(demo)/layout.tsx`, `app/(with-clerk)/layout.tsx`
- Moved (git mv, no content changes): `app/demo/**` → `app/(demo)/demo/**`; `app/(auth)/**`,
  `app/(marketing)/**`, `app/dashboard/**`, `app/invite/**`, `app/partner-invite/**`,
  `app/partner-questionnaire/**`, `app/partner-render/**`, `app/partner-signup/**`,
  `app/showcase-render/**`, `app/team-invite/**`, `app/test-harness/**`, `app/walkthrough/**` →
  same paths under `app/(with-clerk)/**`
- Unchanged: `app/api/**`, `app/test-harness-render/**`, `app/globals.css`

## Related backlog item to close out on completion

`BACKLOG.md` → `B2B-43-4a — Exclude Clerk From /demo/** (Fix 4a Deferred, Needs Rework)` — this
brief is that item's re-attempt. Update its status to point at B2B-47 once this ships (or mark
resolved directly, Orchestrator's call per the standing real-time tracking rule).
