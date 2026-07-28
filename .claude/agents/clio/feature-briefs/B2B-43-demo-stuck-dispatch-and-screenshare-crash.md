# Feature Brief: B2B-43 — Demo "Bot is joining" stuck state + screen-share Application error

From: CEO (Arun)
To: Business Analyst Agent / Orchestrator
Priority: P0
Date: 2026-07-28

## What Arun Said

Two of four bugs reported during tonight's live test of the "Learn with AI" demo tool are still open
(the other two — B2B-41 participant-initiated call-end handling, B2B-42 unified demo passcode gates —
are CLOSED):

3. "after clicking learn with ai it still shows bot is joining the meeting. i thought this was fixed
   earlier. which caused the error to appear again"
4. "still showing application error in screen sharing"

Standing instruction: "fix it test it and get approval from ceo agent once done."

Arun's own phrasing links these two causally (issue 3 "caused" issue 4 to reappear). I independently
re-verified both against live code and live production data before accepting or rejecting that link —
see "Same, related, or independent?" below. **They are independent root causes that happened to
surface in the same test session, not one causing the other.** Both need fixing; neither fix depends
on the other.

## The Problem Being Solved

**Issue 3** — the demo page's "✓ Bot is joining the meeting." banner can get permanently stuck even
after the underlying session has finished, with no way to relaunch without a manual refresh, because
there is no backstop that reconciles a session which never received its normal completion signal.

**Issue 4** — when the meeting bot screen-shares the demo's own visual content inside Google Meet, the
shared screen sometimes shows Next.js's generic "Application error" crash screen instead of the
intended visual, with zero diagnostic signal reaching our error-reporting sink despite two prior
mitigation attempts tonight.

## Independent verification performed (not taken on faith)

I re-read the actual source referenced in the investigation write-up and re-ran the live DB query
myself rather than trusting the summary. Findings:

### Issue 4 — confirmed, and sharpened past what the write-up claimed

- `app/layout.tsx` is confirmed the only root layout (`<html><body>`) in the app; it unconditionally
  wraps every route, including `/demo/**`, in `<ClerkProvider>`. Only one other `layout.tsx` exists
  (`app/dashboard/layout.tsx`), which is nested *inside* the root layout, not a sibling root — it
  cannot exempt anything from Clerk.
- `grep -rniE "useUser|currentUser|auth\(\)|useAuth|useClerk|clerk|Clerk" app/demo/` → zero matches.
  Confirmed independently: nothing under `/demo/**` uses Clerk for anything.
- I fetched the live page myself: `curl https://test.hello-clio.com/demo/claude-ai/visuals/what-is-claude`
  → 200, and the returned HTML unconditionally includes
  `https://clerk.hello-clio.com/npm/@clerk/clerk-js@5/dist/clerk.browser.js` with the live publishable
  key (`pk_live_...`) embedded. This is the exact page whose HTML gets fetched server-side by
  `safeFetchPartnerPage()` (via `resolveInlineSessionRender()` in `lib/partner/live-render.ts`) and
  `srcDoc`'d into the `sandbox="allow-scripts"` (deliberately no `allow-same-origin`) iframe rendered
  by `app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` — confirmed by reading that file's
  iframe JSX directly (`sandbox="allow-scripts"`, `srcDoc={page.contentHtml}`, wrapped in
  `InlinePageErrorBoundary`).
- **Important scoping finding not in the original write-up**: this vulnerability is specific to the
  demo's self-referencing content pattern. `app/api/demo/[slug]/dispatch/route.ts` builds
  `content_pages[].url` from `DEMO_CONTENT_BASE_URL` — i.e. it points back at Clio's *own* `/demo/**`
  routes. A real partner's `content_pages[].url` points at the *partner's own external domain*, which
  never touches Clio's Clerk instance at all. So the fix only needs to scope out Clerk from
  `app/demo/**` — not from `/partner-render`, `/showcase-render`, `/test-harness-render`, or
  `/partner-questionnaire`. I grepped all four of those for Clerk usage too: zero matches in any of
  them either, so there's no live bug there today, but flagging for the BA/dev: I also found
  `lib/test-harness/payload.ts` uses the same "own env var, mirrors DEMO_PARTNER_ACCOUNT_ID" pattern —
  worth a quick check that the test-harness content pipeline doesn't have the same
  self-referencing-content exposure. Not required to close this brief; logging so it isn't lost.
- **A finding that changes how I read the "zero diagnostic reports" evidence**: the write-up treated
  the diagnostic shim receiving zero reports across two fix attempts as near-conclusive evidence for
  the Clerk hypothesis. I think that's over-read. The user-visible "Application error" text is Next.js
  App Router's own built-in error-boundary fallback UI. React error boundaries catch render-time
  exceptions via `componentDidCatch`/`getDerivedStateFromError` *internally* — by design, a caught
  render error **never reaches `window.onerror` or `unhandledrejection`**, regardless of what threw
  it. The fetched inner page (`/demo/.../visuals/[chapterId]`) is itself a full Next.js document with
  its own App Router error boundary; if its hydration throws for *any* reason, Next.js's own boundary
  catches it and renders "Application error" *inside that iframe's own document* — which stays fully
  visible on screen (cross-origin isolation blocks the parent from *inspecting* the iframe, not from
  *displaying* it) — while producing exactly zero global uncaught-error events for the shim to catch.
  This means: the shim receiving zero reports is **expected regardless of root cause** — it is not
  meaningful evidence either for or against the Clerk hypothesis. The diagnostic approach has a
  structural blind spot for this entire failure class (any caught React render error, Clerk-caused or
  not), which is worth fixing alongside the Clerk exclusion (see Proposed Fix).
- Net assessment: Clerk remains the single most plausible cause (only unconditional
  storage/cross-origin-touching script present, on a route proven to never need it, in exactly the
  context — opaque origin, blocked storage — known to break that class of SDK) — but it is genuinely
  unproven without a live repro, and the "zero reports" fact doesn't move the needle either way once
  you account for how React error boundaries actually behave.

### Issue 3 — confirmed with a sharper mechanism than the write-up described, plus one factual correction

- **Commit misattribution**: the write-up attributes the 10s-poll-and-clear fix to commit `115c5a0`.
  That commit is real but is unrelated (`fix(demo): 2 bugs found during full verification sweep of
  pages 4-12` — a subtitle-copy fix and a CSS grid-orphan fix, Jul 22). The actual poll/clear fix is
  commit `e6bafc8` ("fix(demo): auto-clear 'Bot is joining' once the meeting bot session ends", Jul 26
  23:21:01 -0500) — confirmed by reading both commits directly. Doesn't change the substance of either
  issue, but the citation was wrong and should be corrected in the historical record.
- Re-ran the live query myself against project `nqxlpcshouboplhnuvrh` (not just trusting the pasted
  result): session `9ce14a76-a7ab-4087-a118-38e980f83e69` is confirmed still `status='bot_active'`,
  created `2026-07-27 04:10:19 UTC`, `updated_at` frozen at `04:26:54`, `has_hume_chat_id=false`,
  `end_reason=null` — now over 24 hours stale, unrecovered.
- **New finding that pins down the mechanism**: I traced the actual arming path.
  `app/api/partner/v1/sessions/route.ts` (the real session-creation endpoint the demo dispatch route
  calls server-to-server) fires `clio/partner-trial.started` via `inngest.send()` fire-and-forget —
  `.catch(err => console.error(...))` only, no retry, no DB flag marking "cutoff armed," no way to
  detect a silently-failed send. `inngest/partner-trial-cutoff.ts` is the *only* thing that can ever
  force-complete a stuck test-mode session (blind `step.sleep(availableMinutes)` then force-complete,
  independent of whether Hume ever actually connected — so `has_hume_chat_id=false` does not, by
  itself, explain the stuck state; the cutoff should fire regardless).
  `inngest/partner-session-insights-extractor.ts`'s 30-minute backstop sweep — read directly — only
  re-attempts insights *extraction* for sessions already `status='completed'`; it never touches
  `'requested'`/`'bot_active'` rows. Confirmed no other file updates `partner_sessions.status` in a way
  that would sweep a stuck row (grepped every file that touches `partner_sessions` status).
  **Conclusion: there is no code path anywhere that recovers a session if the one fire-and-forget
  event that arms its cutoff timer is ever dropped.** That's a real, general reliability gap, not
  specific to this one session.
- Strong corroborating evidence this was a one-off event-delivery failure, not a broken mechanism: a
  sibling session for the same slug, created 25 minutes later the same morning
  (`2f7084ef-8ffa-4217-9d02-21668bd7fd06`, created `04:35:29`), completed normally at `04:59:18` with
  `end_reason='trial_limit_reached'` — i.e. the cutoff mechanism demonstrably works in general. Later
  same-day sessions also completed normally or correctly failed with `trial_exhausted` once the trial
  allowance was consumed. Only this one session's timer was never armed or never ran to completion.

## Same root cause, related, or independent? (my own conclusion, not inherited)

**Independent root causes. Related only by circumstance, not by causation.**

- Issue 3 lives entirely in the demo page's own polling/session-lifecycle logic
  (`DemoTopicClient.tsx`) and the session-completion event pipeline
  (`inngest.send('clio/partner-trial.started')` → `partner-trial-cutoff.ts`) — a *different visitor's
  browser tab*, on the `/demo/[slug]` catalog page.
- Issue 4 lives entirely inside the meeting bot's own headless browser, on the *`/partner-render/[ref]`
  page's embedded iframe*, showing on the *screen share inside Google Meet* — a completely different
  page, different browsing context, different observer (meeting participants, not the demo-page
  visitor).
- There is no code path where one causes the other. A stuck "bot is joining" banner cannot make the
  screen-share crash, and the screen-share crash cannot make the poll get stuck (the poll only reads
  `partner_sessions.status`/`session_state`, which is set by the cutoff job or normal completion path —
  neither of which is affected by what renders inside the iframe).
- What's real in Arun's read: both surfaced in the same live test of the same feature area on the same
  night, and it's plausible (not confirmed, not required to confirm) that the *specific* stuck session
  is also the one where the screen-share crash happened — but even if so, that's two independent
  failures on the same session, not one causing the other.

## What Success Looks Like

- Issue 3: a session that never receives its normal completion signal is automatically recovered
  within a bounded time window (force-completed, bot released) without requiring a page refresh or
  manual intervention — and this protection is general (covers any future silently-dropped cutoff
  event), not a one-off patch for this single stuck row.
- Issue 4: `/demo/**` pages no longer load Clerk's client bootstrap at all (verified by a fresh curl
  showing no `clerk.browser.js`/`pk_live_` in the response), removing the most plausible cause outright
  regardless of whether it's proven with a live repro — and if the crash recurs, the next occurrence
  produces an actual observable signal instead of silence, because the diagnostic gap identified above
  is also closed.

## Proposed Fixes (technical — full Orchestrator/dev autonomy per governance model; no BA/product
## decision embedded in either)

### Fix 4a — exclude Clerk from `/demo/**`

Recommended mechanism, in order of preference:

1. **Preferred — client-side pathname gate, not server-side/middleware.** Introduce a small client
   component (e.g. `components/ClerkProviderGate.tsx`) that calls `usePathname()` and only renders
   `<ClerkProvider>{children}</ClerkProvider>` when the path does *not* start with `/demo`; otherwise
   renders `{children}` bare. Swap this in for the direct `<ClerkProvider>` in `app/layout.tsx`. This
   requires zero middleware changes, keeps the root layout a plain server component (no `headers()`
   call, so it does **not** force the rest of the app — including today's statically-generated
   marketing pages and the demo pages' own `generateStaticParams()` — off static generation), and
   changes behavior for `/demo/**` only. Every other route keeps getting `ClerkProvider` exactly as
   today, byte-for-byte.
2. **Documented fallback if (1) proves infeasible** — Next.js "multiple root layouts" (splitting into
   route groups, each with its own root `<html>/<body>` layout). This is higher-risk: it requires
   *every* existing top-level route ((auth), (marketing), dashboard, invite, partner-invite,
   partner-questionnaire, partner-render, partner-signup, showcase-render, team-invite, test-harness,
   test-harness-render, walkthrough) to be redistributed into exactly one of two groups, since Next.js
   doesn't allow a top-level `layout.tsx` to coexist with route-group root layouts. Only use this if
   (1) turns out not to actually stop the script injection.

Verification required before calling this done: rebuild (`npm run build`, confirm zero errors and that
previously-static routes remain static), then re-curl
`https://test.hello-clio.com/demo/claude-ai/visuals/what-is-claude` and confirm no `clerk.browser.js` /
`pk_live_` string appears in the response.

### Fix 4b — close the diagnostic blind spot (ship alongside 4a, not instead of it)

Extend `buildIframeDiagnosticShim()` in `lib/partner/live-render.ts` to also detect Next.js's own
in-document error-boundary fallback (e.g. a `MutationObserver` or a short polling check for the known
error-boundary DOM signature) and report that occurrence to
`/api/partner/render/client-error` even without a stack trace — so if 4a doesn't fully resolve the
crash, the next occurrence produces *some* signal instead of silence, closing the structural gap
identified above (caught React render errors never reach `window.onerror`).

### Fix 3 — backstop sweep for stuck test-mode sessions

Add a new Inngest cron sweep (same shape/convention as
`partnerSessionInsightsBackstopSweep` in `inngest/partner-session-insights-extractor.ts`) that finds
`partner_sessions` rows with `status IN ('requested','bot_active')`, `test_mode=true`, and
`updated_at` older than a generous ceiling (recommend comfortably longer than any legitimate trial
session can run — e.g. 60 minutes, well above the 20-minute base trial plus any realistic top-up
scenario for a single session) with no matching `clio/partner-trial.ended`, and force-completes them:
same `leave-bot` / `consume-minutes` / `mark-session-completed` / `record-billable-events` sequence
`partner-trial-cutoff.ts` already runs, reused rather than duplicated where possible. This is a pure
reliability/technical fix (crash-recovery sweep, same pattern as the already-shipped B2B-37 backstop) —
no user-facing screen or copy changes, so it does not require a new BA spec beyond this brief per the
"pure technical fixes... within full Orchestrator/dev autonomy" carve-out in `CLAUDE.md`.

Open technical question for whoever implements: should this also cover live-mode (non-test_mode)
`bot_active` stuck sessions via `partner-live-cutoff.ts`'s own event, or is that out of scope for
tonight given no live-mode instance of this has been observed? My recommendation: scope tonight's fix
to test-mode only (matches the observed bug, matches the demo account's `test_mode: true`), and log a
`BACKLOG.md` item for live-mode coverage as a fast-follow rather than block tonight's fix on it.

## Known Constraints

- Arun is asleep; do not wait for his review to proceed — this brief is dev-ready without further
  product-level input from him (both fixes are technical, not product-shape or UX-copy decisions).
- Do not touch `/partner-render`, `/showcase-render`, `/test-harness-render`, or
  `/partner-questionnaire` as part of Fix 4a — confirmed via grep that none of them use Clerk today, so
  there is no live bug there; scope creep into those routes adds risk with no corresponding fix.
- Fix 4a must not regress static generation for `/demo/**`'s `generateStaticParams()` chapters or for
  any currently-static marketing page — verify with a real `npm run build`, not just `tsc --noEmit`.
- Per standing responsive/mobile rule: this brief touches no screen's layout or copy, so the
  incremental-responsive-audit trigger does not apply here.

## Questions for BA

None — this is scoped as a pure technical bug fix under the governance model's carve-out ("pure
technical fixes... are within full Orchestrator/dev autonomy once \[CEO approves] the technical
approach"). I'm approving the technical approach above. Proceed straight to implementation; standard
QA gate (code review + automated tests + live browser UI functional testing per `testing-agent.md`)
still applies before merge, same as every other fix tonight.

## Confidence flag (per the task's own instruction not to force false confidence)

Issue 4's root cause is **not proven** with a live browser repro — it's a strong, well-reasoned
circumstantial case (only unconditional storage-touching script, on a route proven not to need it, in
exactly the sandboxed context known to break such SDKs), not a confirmed one. Ship Fix 4a anyway: it's
safe regardless of whether Clerk turns out to be the actual cause (zero behavior change for the one
route that never uses it), and ship Fix 4b alongside it so that if the crash recurs after 4a, we
finally get a real signal instead of a third round of silent guessing. If it recurs after both fixes,
that's the trigger to escalate to Arun for a real browser-based repro session rather than continuing to
guess from static analysis.
