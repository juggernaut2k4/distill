# Feature Brief: B2B-44 — Hume transcript endpoint fix, screen-share crash capture, duplicate-dispatch guard

From: CEO (Arun)
To: Orchestrator (pure technical fixes — see Scope decision below; no BA gate required for issues 1/2/5, narrow product call made by CEO for issue 3)
Priority: P0
Date: 2026-07-28

## What Arun Said

Verbatim, from this morning's live test of the "Learn with AI" demo tool (5 issues in one message):

1. "this is issue 1 you need to work [Performance tab empty]."
2. "i see that the screen share shows application error - a client side exception has occured. you need to fix this. this is issue 2."
3. "note that both the issues needs to be caught in the glitch and should be captured. so check if you are able to capture this, if not then this is the issue 3 you need to work."
4. "i am saying ready but clio is not hearing me check it out. this is issue 4."
5. "i still see the screen saying 'bot is joining' i thought we fixed this yesterday. you need to avoid duplicate sessions but the same time once the user ends the call, he should be able to initiate the call again. so fix it. this is issue 5"

Standing instruction: "can you note all these down, analyze and fix it. ceo agent please govern, review and approve. ask for evidence of confirmation if its working."

## Independent verification performed (not taken on faith)

I re-read every file cited in the Orchestrator's write-up myself, ran my own live production DB
queries, and made my own live API call against a **different** chat_id than the Orchestrator tested,
specifically to rule out a one-off fluke. Findings below.

### Issue 1 — CONFIRMED, root cause is exactly as described, independently reproduced

`lib/voice/hume-native/session-details.ts`'s `fetchAllTranscriptEvents(apiKey, chatId)` calls
`GET https://api.hume.ai/v0/evi/chats/{chatId}/events?page_size=100&page_number={n}`.

I queried `partner_session_insights` directly (Supabase project `nqxlpcshouboplhnuvrh`):
```
select extraction_status, count(*) from partner_session_insights group by extraction_status;
→ [{"extraction_status":"failed","count":5}]
```
**100% failure rate, zero successes, ever.** All 5 rows carry the identical error shape:
`Failed to fetch transcript page 0 for chat <id>: status 404: {"...","message":"No static resource
chats/<id>/events.","path":"/chats/<id>/events"}` — spanning 2026-07-25 through 2026-07-28.

I then picked a chat_id the Orchestrator had **not** already tested
(`77f64934-937d-4611-a9a4-a567e5637ec5`, a session that ended today at 18:10 UTC — the most recent
failure in the table) and called `GET /api/debug/hume-chat?chat_id=77f64934-937d-4611-a9a4-a567e5637ec5`
against production myself:
- The embedded `/events` suffix call inside that same debug route **still 404s**, identical error text,
  identical to the Orchestrator's earlier test on a different chat_id.
- The plain `GET /v0/evi/chats/{id}` (no `/events` suffix) call returns 200 with `events_page` (10 real
  transcript events — I confirmed the content is real, not empty: a `SYSTEM_PROMPT` event whose text
  literally opens with the session's actual assembled prompt, referencing the real participant by
  name), plus `page_number: 0`, `page_size` (implicit), and **`total_pages: 2`** — directly on the chat
  metadata object, exactly as the Orchestrator described.

This is now confirmed against two independent chat_ids, tested hours apart by two different reviewers,
with 100% reproducibility and zero exceptions in the data. `total_pages: 2` on the metadata response
also confirms the proposed fix's pagination shape (`page_number`/`total_pages` on the metadata object)
will work as designed — this isn't a single-page endpoint, the existing pagination loop structure can
be reused nearly as-is, just pointed at the right URL.

**Conclusion confirmed: `/v0/evi/chats/{chat_id}/events` is not a real (or is a removed/deprecated)
Hume endpoint. Pagination must go through repeated `GET /v0/evi/chats/{chat_id}?page_number={n}` calls
instead**, reading `events_page`/`total_pages` from the metadata response — the same shape the code
already parses, just fetched from the wrong URL.

`inngest/hume-native-nightly-cleanup.ts` line 188 has the **identical, independently-broken** copy of
this same wrong URL pattern (not shared code — a hand-duplicated pagination loop, confirmed by reading
lines 181–214 directly). This is a second, separate call site with the same bug, not a shared helper —
both need the fix; fixing one does not fix the other.

`inngest/partner-session-insights-extractor.ts` line 241 imports and calls the same
`fetchAllTranscriptEvents()` from `session-details.ts` (confirmed — `export async function
fetchAllTranscriptEvents` is called at line 241 via the B2B-09 shared-export refactor). **Fixing
`session-details.ts`'s implementation fixes this call site automatically** — no separate patch needed
here, only in the nightly-cleanup file's independent duplicate.

### Issue 3 (transcript-derived half) — CONFIRMED same root cause as Issue 1, AND a new finding that changes the fix scope

`inngest/partner-session-insights-extractor.ts`'s `glitches` field comes from the same broken
`fetchAllTranscriptEvents()` call — confirmed by direct read, matches the write-up.

**New finding, not in the original write-up**: I traced how `glitches` reaches the internal glitch
dashboard (B2B-17) and found it is **not** a code-level write at all — `glitch_instances` (the durable,
row-per-glitch table backing `/api/admin/glitches`) is populated by a **Postgres trigger**
(`fanout_glitch_instances()`, `supabase/migrations/082_b2b17_glitch_issue_tracker.sql` line 122,
firing on INSERT/UPDATE of `partner_session_insights`) that fans out the `glitches` JSONB column
automatically. I confirmed no application code anywhere calls `.from('glitch_instances').insert(...)`
directly for AI-extracted glitches — only the admin routes (read/attach/detach) and the trigger touch
that table for this path.

**This means fixing Issue 1's root cause is the ENTIRE fix for this half of Issue 3.** Once
`fetchAllTranscriptEvents()` points at the right URL, `extractInsightsForPartnerSession()` will
succeed, write real `glitches` to `partner_session_insights`, and the existing trigger will
automatically fan those rows into `glitch_instances` — visible on the existing admin dashboard — with
zero additional code. No separate task needed for this half.

### Issue 2 + the other half of Issue 3 (screen-share crash capture) — CONFIRMED, regression is real, plus a schema detail the write-up didn't surface

I read both files directly:
- `lib/partner/live-render.ts`'s `buildIframeDiagnosticShim()` (lines 67–133) does post a
  `source: 'error-boundary'` report when its `MutationObserver` detects the Next.js error-boundary
  fallback text (line 118).
- `app/api/partner/render/client-error/route.ts`'s Zod schema (line 23):
  `source: z.enum(['error', 'unhandledrejection'])` — **confirmed, does not include `'error-boundary'`**.
  `.safeParse()` fails on any error-boundary report, the route returns `{ok:false}` at status 200
  (line 30) **before the `console.error()` call on line 33 is ever reached.** Last night's entire
  Fix 4b has never actually logged anything, anywhere, since the moment it shipped. Confirmed by
  direct read, not inference.
- Even after the schema is fixed, this route (line 16 of its own doc comment) is explicitly
  console-log-only, "never persisted to a table." Arun has no visibility into Vercel runtime logs.

**Schema decision needed and resolved by me**: `glitch_instances.glitch_type` has a `CHECK` constraint
(migration 082, line 58) limited to `('misunderstanding', 'repetition', 'confusion_about_clio',
'derailment', 'other')` — there is no slot for a technical/client-side crash today. Given Arun's own
explicit framing ("both issues needs to be caught in the glitch and should be captured") names the
same visible tracker for both the conversational glitches AND the screen-share crash, and given that
`glitch_instances` is the one durable, dashboarded location he can actually see (Vercel logs are not),
I am making the product call myself rather than punting to a BA cycle: **add a new `glitch_type`
value (`'technical_error'`) via migration, and have the client-error route write a row directly into
`glitch_instances` (bypassing the trigger — the trigger only fires off `partner_session_insights`,
which is untouched by this path) whenever a validated report lands, in addition to the existing
`console.error`.** This is a schema/plumbing decision (which table gets a new row, what type value)
with an unambiguous "make it visible to the person who can't see logs" answer — not a screen design or
copy decision, so it does not need a BA spec under the CEO/BA/Dev division of labor. The one
implementation detail I'm flagging for the dev: `glitch_instances` has `UNIQUE (partner_session_id,
ordinal)`, and `ordinal` for trigger-sourced rows starts at 0 per session — client-error-sourced rows
must use a colliding-free ordinal scheme (e.g. a high offset, or a separate monotonic counter scoped
to `'technical_error'` rows) so a session that has both AI-extracted glitches and a crash report never
collides on `(partner_session_id, ordinal)`.

### Issue 5 — CONFIRMED, both halves are real gaps, and I found the exact governing constant for the "still stuck" question

**Duplicate-dispatch guard**: I read `app/api/demo/[slug]/dispatch/route.ts` in full and
`app/api/partner/v1/sessions/route.ts` (grepped for any `status IN (...)` guard against existing
active sessions before creating a new one) — **confirmed zero server-side guard exists anywhere in
either route.** The only thing preventing a double-dispatch today is the client's `dispatchSucceeded`
React boolean in `app/demo/[slug]/DemoTopicClient.tsx` (confirmed at line 119), which the file's own
2026-07-27 comment (line 155) already documents as unreliable ("no way to learn the real state").
Design direction from the write-up (check `partner_sessions` for any row with
`status IN ('requested','bot_active')` for this `partner_reference`, block if found, allow once
`'completed'`/`'failed'`) is sound and matches how the existing stuck-session backstop sweep already
keys off the same two statuses.

**"Still stuck" — I distinguished which failure mode Arun is describing, using the actual code**:
`inngest/partner-trial-cutoff.ts`'s `partnerTrialStuckSessionBackstopSweep` (lines 150–205) is
confirmed **registered** in `app/api/inngest/route.ts` (line 62, present in the `functions: [...]`
array) with cron `*/15 * * * *` (every 15 minutes) and
`STUCK_SESSION_CEILING_MS = 60 * 60 * 1000` — exactly one hour (line 122), matching the write-up. I
also confirmed its query is scoped to `.eq('test_mode', true)` only — it does not cover live
(non-test) `bot_active` sessions stuck for other reasons, per its own doc comment (lines 140–141),
which is out of scope for the demo tool (always `test_mode: true`) but worth flagging as a known gap
elsewhere. Since the demo dispatch happened this morning and the sweep has a 60-minute ceiling checked
every 15 minutes, **if Arun saw the stuck banner within roughly the first hour of a fresh dispatch,
that is the sweep simply not having fired yet — expected, not a regression of yesterday's fix.** If he
saw it persist past that window, the sweep itself would need checking (I did not find evidence either
way in the DB of a session stuck past the 60-minute ceiling as of this review — the 5 most recent
`partner_sessions` rows with a `hume_chat_id` are all `status: 'completed'`). I cannot fully resolve
which scenario actually happened this morning without Arun confirming the approximate time gap between
dispatch and when he saw the stuck banner — flagging this, not guessing.

### Issue 4 — not investigated further, correctly left open

No timestamp or session identifier was given, and the original follow-up question to Arun went
unanswered before he moved on. Deferred per the task's own instruction — will become newly
diagnosable in practice once Issue 1 ships (transcripts will actually be readable going forward, and
the debug route can inspect historical chats today via the metadata endpoint directly). Recommend a
live repro session once Issue 1 is confirmed working, or Arun supplying the specific session/timestamp.

## Same root cause, related, or independent? (my own conclusion)

- Issues 1 and half of 3 (transcript-derived glitches): **same root cause**, one fix.
- Issue 2 and the other half of 3 (crash capture): **same fix pair** (schema fix + new
  `glitch_instances` write), independent of Issues 1/5.
- Issue 5's two halves (duplicate guard, stuck-banner diagnosis): **related but structurally
  different** — one is a missing guard (needs new code), the other is a monitoring/timing question
  about an already-shipped mitigation (needs Arun's confirmation of timing, possibly no code change
  at all).
- Issue 4: independent, deferred, not touched by any of the above fixes except becoming diagnosable as
  a side effect of Issue 1.

## What Success Looks Like

- A real Hume-native session's Performance tab shows a populated transcript/duration/insights after a
  live test call — not a mock, not a code-review pass.
- The internal glitch dashboard (`/api/admin/glitches`) shows real conversational glitches from a live
  test session with a deliberately induced misunderstanding, AND shows a `technical_error`-typed entry
  when a screen-share crash is deliberately reproduced.
- A genuine concurrent double-dispatch attempt (two tabs, or a refresh mid-session) is rejected with a
  clear conflict response; a fresh dispatch immediately after a session reaches `'completed'`/`'failed'`
  succeeds with no artificial delay.
- Arun confirms the timing of any future "bot is joining" sighting against the one-hour sweep ceiling
  before it's treated as a regression.

## Proposed Fixes (technical — Orchestrator/dev full autonomy per governance carve-out; no BA/product decision embedded except the narrow Issue 3 call made explicitly above)

### Fix 1 — correct the transcript pagination URL (closes Issue 1 and the transcript half of Issue 3)
- `lib/voice/hume-native/session-details.ts`: rewrite `fetchAllTranscriptEvents()` to call
  `GET https://api.hume.ai/v0/evi/chats/{chatId}?page_number={n}&page_size=100` (drop the `/events`
  suffix), continuing to read `events_page`/`total_pages` from the response exactly as today.
- `inngest/hume-native-nightly-cleanup.ts` lines 186–214: apply the identical fix to its independent,
  hand-duplicated copy of the same loop. Consider (dev's judgment) having this file import and reuse
  `fetchAllTranscriptEvents()` from `session-details.ts` instead of maintaining a second copy, now that
  a second real bug has been found from the duplication — not required to close this brief, but flag if
  skipped.
- Update the stale doc comment above `fetchAllTranscriptEvents()` that currently (incorrectly)
  describes `/v0/evi/chats/{chat_id}/events` as "the paginated transcript endpoint."
- No change needed to `inngest/partner-session-insights-extractor.ts` — it inherits the fix via its
  existing import.

### Fix 2 — accept and log error-boundary reports (closes Issue 2's silent-fix regression)
- `app/api/partner/render/client-error/route.ts`: widen `ClientErrorSchema`'s `source` enum to
  `['error', 'unhandledrejection', 'error-boundary']`.

### Fix 3 — persist crash reports into the visible glitch tracker (closes the remaining half of Issue 3)
- New migration: add `'technical_error'` to `glitch_instances.glitch_type`'s CHECK constraint.
- `app/api/partner/render/client-error/route.ts`: on a successfully validated report, in addition to
  the existing `console.error`, insert a row into `glitch_instances` with
  `glitch_type: 'technical_error'`, `description` built from `message`/`stack`/`source`,
  `partner_session_id` resolved from `clio_session_ref`, `partner_account_id` resolved via the
  session's partner account, and an `ordinal` scheme that cannot collide with trigger-sourced rows for
  the same session (see the flagged detail above — dev's call on exact scheme, just must be collision-
  proof against the `UNIQUE(partner_session_id, ordinal)` constraint). Best-effort: a failed insert
  here must not block the 200 response this diagnostic-only route already always returns.

### Fix 5a — server-side duplicate-dispatch guard
- `app/api/demo/[slug]/dispatch/route.ts` (or, better, inside the real
  `app/api/partner/v1/sessions/route.ts` it calls, so every partner gets the same protection, not just
  the demo tool — dev's call on which layer, but the demo route alone is the minimum bar): before
  dispatching, query `partner_sessions` for any row with
  `partner_reference = <slug>` (or the equivalent real-partner key) AND
  `status IN ('requested', 'bot_active')`. If found, return a clear conflict response (e.g. 409,
  `{ error: { code: 'session_already_active', message: '...' } }`) that the client surfaces instead of
  silently double-dispatching. Must NOT block a fresh dispatch once the prior session is
  `'completed'`/`'failed'` — verify this explicitly in testing, not just the block case.

### Fix 5b — no code change, pending Arun confirmation
- `partnerTrialStuckSessionBackstopSweep` is confirmed registered, cron `*/15 * * * *`, one-hour
  ceiling. If future "still stuck" reports occur, first ask: how long was it stuck before you saw it
  reported as stuck? If under ~60–75 minutes, this is expected sweep-timing behavior, not a bug.

## Known Constraints

- Never touch the `hume_native_config_archives` write path or `hume_config_archived_at` semantics —
  out of scope, unrelated to this brief (per `session-details.ts`'s own doc comment on read-only
  boundaries).
- `partner_session_insights.glitches` and `glitch_instances` populated via
  `fanout_glitch_instances()` trigger must not be duplicated by application code for the
  transcript-derived path — only the new client-error path gets a direct application-level insert,
  specifically because it has no upstream JSONB column for a trigger to fan out from.
- Every fix in this brief is additive/corrective to already-shipped code — no removal of existing
  mitigations (the diagnostic shim, the stuck-session sweep) is in scope.

## Required live verification before any PASS (per Arun's explicit "ask for evidence of confirmation")

Per the QA Gate in `CLAUDE.md` — Gate 3 (live browser UI functional testing) is mandatory and a
code-review-only PASS is invalid. For this brief specifically, each fix additionally needs:

1. **Fix 1**: Run (or wait for) a real session end-to-end, then confirm in the browser that the
   Performance tab shows real duration + populated insights — not a mock fixture, not a passing unit
   test alone. Cross-check the underlying `partner_session_insights` row shows
   `extraction_status: 'success'` (or `'success_empty'` if genuinely no transcript content) with a
   non-404 `error_message`.
2. **Fix 2 + 3**: Deliberately reproduce a screen-share crash (or simulate the error-boundary fallback
   text in a test page), confirm a `technical_error`-typed row lands in `glitch_instances` and is
   visible via `/api/admin/glitches` (or the admin UI it backs) — not just a Vercel log line.
3. **Fix 5a**: Live test both directions explicitly — (a) attempt a second dispatch while a session is
   genuinely active, confirm it's rejected with a clear message the visitor sees, not a silent
   duplicate bot join; (b) end a session normally, then immediately redispatch, confirm it succeeds
   with no artificial delay.
4. **Fix 5b**: No fix ships unless Arun confirms a stuck session persisted past the ~60–75 minute
   window; until then this stays a watch item, not a task with a completion criterion.

## Questions for BA

None — every fix in this brief is a pure technical/correctness fix (wrong URL, missing enum value,
missing server-side guard) or a narrow schema/plumbing call made directly above with a documented
rationale (Fix 3's `glitch_instances` write). Per CLAUDE.md's autonomy boundary, none of these are
product-shape/UX-copy decisions requiring a BA Requirement Document — no new screen, no new user-facing
copy, no change to what any screen shows or does. Section 11 open questions: **none.**

## Confidence flag

I am confident in all five root-cause conclusions above — each was independently re-verified against
live code and live production data by me, not accepted from the write-up. The one thing I am
explicitly NOT confident about and am not guessing on: whether this morning's specific "bot is joining"
sighting (Issue 5, second half) falls inside or outside the one-hour sweep window. That needs Arun's
own timing recollection, not a technical judgment call — flagged above, not force-resolved.
