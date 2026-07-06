# Feature Brief: HUME-DURATION-02 — Fix Hume duration-fetch timing race
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-06

## What Arun Said
Investigate why session `90327691-aeed-431a-9eb0-9a33f3dbf716` fell back to
`fallback_reason: "missing_timestamps"` instead of billing from Hume's own
authoritative duration. Determine whether it's a timing race, a wrong/missing
`hume_chat_id`, or something else — read the actual code, don't guess.

## The Problem Being Solved
`finalizeHumeNativeBilling()` (`lib/session-billing.ts`) is supposed to source
billed minutes from Hume's own chat-duration record for Hume-native sessions,
so our billing can never silently drift from what Hume will actually invoice
us for. Confirmed root cause after reading the code directly:

- `forceEndSession()` writes our own `disconnected` audit event, then
  immediately (synchronously, in the same call) invokes
  `finalizeHumeNativeBilling()` → `fetchHumeChatDuration()`
  (`lib/voice/hume-native/session-details.ts`), which makes a **single
  attempt, 5-second timeout, no retry** call to Hume's
  `GET /v0/evi/chats/{chat_id}`.
- Hume's chat record had not yet been finalized on their side (no
  `end_timestamp` present yet) at the exact moment we queried — this is an
  explicitly documented, deliberate branch in the code
  (`reason: 'missing_timestamps'`), not a crash or malformed data.
- It is **not** a `hume_chat_id` problem — the id was present and valid; Hume
  simply hadn't closed out the chat object yet when we asked.
- The system correctly fell back to our own audit-log-derived
  `computeBilledMinutes()`, so the user was **not billed incorrectly** — we
  just lost the Hume-authoritative source for this session, which was the
  entire point of HUME-DURATION-BILLING-01.

This is a genuine timing race between "we disconnect and immediately ask
Hume for the final duration" and "Hume finalizes its own record asynchronously
after disconnect."

## What Success Looks Like
When a Hume-native session ends, we reliably get Hume's authoritative
duration in the common case, and only fall back to the audit-log calculation
when Hume's data is genuinely still unavailable after a reasonable wait — not
because we asked too early.

- No change to user-facing behavior or billed amounts is expected — this is
  purely about which data source we use and improving observability/accuracy
  of the `billing_source` metadata already recorded in `minutes_ledger`.
- Must never introduce a scenario where session end/teardown is delayed
  noticeably for the user (bot deletion, walkthrough_state teardown, etc. must
  not be blocked waiting on Hume).

## Known Constraints
- Do not change behavior for ElevenLabs / Custom-LLM sessions — this only
  affects the Hume-native path (`humeNativeEnabled === true`).
- Do not change the existing fallback behavior for other failure reasons
  (`api_key_not_configured`, `timeout`, `network_error`, `http_*xx`,
  `unparsable_response`, `no_hume_chat_id`) — only the specific
  `missing_timestamps` case, since that's the one caused by our own query
  timing rather than a genuine Hume-side or config problem.
- Must not add unbounded delay to session teardown — bot deletion and DB
  writes in `forceEndSession()` should not wait on this.
- No new npm packages. Stay within `fetchHumeChatDuration()` /
  `finalizeHumeNativeBilling()` in the existing two files.

## Questions for BA
1. What is the right amount of delay/retry? A fixed short delay (e.g. 2-3s)
   before the first attempt, a single retry a few seconds after a
   `missing_timestamps` result, or both? Should this run in the critical path
   of `forceEndSession()` (delaying teardown) or asynchronously after teardown
   completes (updating billing after the fact)?
2. If we retry asynchronously after the session is already marked completed
   and minutes already deducted via the fallback path, how do we reconcile if
   the retried Hume fetch later succeeds and produces a different number than
   what was already deducted? Do we leave the fallback-derived deduction as
   final (simplest, given users are never worse off since fallback already
   uses our own conservative audit log), or do we need a correction path?
3. Should there be a cap on total retry/delay time so we never leave a
   session in a not-fully-finalized state indefinitely?
4. Any monitoring/alerting needed if `missing_timestamps` recurs frequently
   even after this fix (would indicate a deeper Hume-side latency issue)?

Please write the full requirement document (12 sections) once these are
resolved — escalate to me if any answer requires a product/business call
rather than a technical one.
