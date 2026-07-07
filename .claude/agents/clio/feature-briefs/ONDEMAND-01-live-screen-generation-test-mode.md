# Feature Brief: On-Demand Live Screen Generation Test Mode (ONDEMAND-01)
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-07

## What Arun Said
Build a disposable test-mode toggle that, when enabled, skips pre-building the full set of
session screens before a live call starts, and instead generates only the Overview screen up
front — then generates each subsequent screen live, on demand, at the moment Clio finishes
teaching the current one and is ready to move on. This is explicitly a test mode to validate
live/on-the-fly generation quality and timing, not a permanent product behavior change.

Confirmed by direct code investigation (not assumption):
- The existing `NEXT_PUBLIC_REALTIME_VISUAL_TEST` toggle (`app/dashboard/walkthrough/WalkthroughClient.tsx`,
  lines 52, 732, 787, 976) only affects the legacy client-side fallback path — the old
  `session_plan` lookup inside `/api/generate-visual`. The real production live-teaching pipeline
  (`app/api/recall/bot/route.ts` + `lib/voice/live-conductor-bridge.ts`) bypasses that fallback
  entirely via a documented "BRANCH POINT" (route.ts lines 266-300) that reads
  `sessions.live_conductor_content.tabs` directly. The old toggle is NOT reusable for this request.
- The real content-assembly step is in `app/api/recall/bot/route.ts`, where the full tab set is read
  from `topic_content_cache` / `sessions.live_conductor_content` and written to `walkthrough_state`
  BEFORE the bot joins the call (see the "Step 3: Write context to walkthrough_state BEFORE bot
  creation" comment, ~line 382).
- `buildOverviewTeachContent()` in `lib/templates/session-bookends.ts` (line 45) is already a
  deterministic, no-LLM-call function that builds the Overview bookend. It needs zero changes.
- The natural "generate next screen now" hook is `advance_tab` handling in
  `lib/voice/live-conductor-bridge.ts` (~lines 281-353) — this is where Clio's tool call signals
  "I'm done with this tab, move to the next," and where a "visual generation chain" already exists
  in some form per the code comments there. This is the intervention point, not a new invented
  hook — reuse the per-tab generation logic that already lives in this pipeline (e.g.
  `generateLiveConductorContent` in `lib/content/live-conductor-content.ts`, or the equivalent
  function actually called from that chain — BA/dev to confirm exact function name by reading the
  file, not guessing).

## The Problem Being Solved
We currently pre-generate every screen for a session before the call starts. This is safe and
fast for the user, but it means we can't easily test what happens if the app generates each
teaching screen live, one at a time, exactly when it's needed. Arun wants an isolated, flippable
test mode to observe generation latency and quality in a live setting without touching or
risking the default (pre-built) behavior that real users experience.

## What Success Looks Like
- A new server-side env var (exact name to be fixed by BA/dev, e.g.
  `LIVE_ONDEMAND_GENERATION_TEST`), read inside `app/api/recall/bot/route.ts` at content-assembly
  time (NOT client-side, since this touches pre-session content assembly on the server).
- When the toggle is OFF (default): absolutely no behavior change. Full existing tab set is
  built and written to `walkthrough_state` exactly as today.
- When the toggle is ON: only `sections = [overview]` (via `buildOverviewTeachContent()`) is
  written to `walkthrough_state` initially. When Clio's `advance_tab` tool call fires to move
  past the Overview (or any subsequent tab), the next subtopic's content is generated live at
  that moment, using the existing per-tab generation logic, and delivered into the session in
  time for Clio to teach it — with a defined, safe fallback behavior if generation is slow or
  fails (see BA Question 3 below; must not hang the call or crash it for a live user).

## Known Constraints
- This is a TEST MODE. It must be trivially disable-able and must not alter production behavior
  when off. Zero-impact-when-off must be proven with real grep/code evidence in the final BA
  spec and again in the QA report — not asserted.
- Do not reuse or extend `NEXT_PUBLIC_REALTIME_VISUAL_TEST` — it is the wrong mechanism (client-side,
  legacy fallback path only). This must be a new, separate, server-side toggle.
- `buildOverviewTeachContent()` must not be modified.
- No change to the default (toggle-off) content-assembly path in `recall/bot/route.ts`.
- Per standing rule (see `feedback_no_impact_existing_no_delete.md`): no regression to existing
  topic selection, content generation, or session generation behavior. Any code change needed in
  shared/existing logic must be flagged explicitly, not made silently.
- Generated-on-the-fly content: default to NOT writing to `topic_content_cache` /
  `live_conductor_content` for this toggle's test runs — treat as ephemeral, since this is
  explicitly a disposable test mode. BA must confirm/justify this in the spec (Question 5 below).

## Questions for BA
1. Exact env var name and precise line(s) in `app/api/recall/bot/route.ts` where it is read and
   branches the content-assembly logic (server-side only).
2. Exact trigger mechanism and file/line for "generate the next screen now" — confirm whether this
   hooks into the existing `advance_tab` handling in `lib/voice/live-conductor-bridge.ts` (~line
   284 onward) and identify the exact existing per-tab generation function being reused (read the
   file to get the real name — do not guess at a function signature).
3. Failure/slowness handling: what exactly happens if live generation takes too long or errors
   while Clio and a real user are mid-call. Must define a concrete fallback (e.g. a short "let me
   pull that up" holding behavior, or falling back to a generic placeholder tab) that never hangs
   the call or breaks the voice session. Document this as a real flow, not "TBD."
4. Zero-impact-when-off verification plan: what specific grep/read commands and code paths will be
   checked to prove the toggle-off path is byte-for-byte identical to today's production behavior.
5. Should on-the-fly generated content also be persisted to `topic_content_cache` /
   `live_conductor_content` for potential reuse afterward, or stay purely ephemeral? Recommendation
   leans ephemeral (no write) since this is a disposable test mode per Arun — confirm this
   reasoning explicitly in the spec, or override with justification if there's a strong reason to
   persist (e.g. reuse only if a `_test` suffixed key is used, so it can never collide with a real
   cache entry).

All 5 questions must be answered concretely in the Requirement Document — Section 11 (Open
Questions) must be empty before this returns to CEO for approval.
