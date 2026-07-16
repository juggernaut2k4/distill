# B2B-10 — Attendee Webhook — Partner Session Support
# Requirement Document
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-15

**Source Feature Brief:** `.claude/agents/clio/feature-briefs/B2B-10-attendee-webhook-partner-sessions.md`
(read in full — this brief already carries a fully-worked technical design, verified by the CEO directly
against live code: the correlation mechanism, per-event-type resolution for all three Attendee event
types, and the fallback-completion reconciliation logic. This document turns that design into a buildable
spec; it does not re-derive or second-guess it.)

**Verified directly against the shipped, live code by this document's author, all read in full:**
- `app/api/attendee/webhook/route.ts` — `handleEvent()`, the `AttendeeWebhookEvent` type, the existing
  three-branch `switch` statement (`bot.state_change`, `transcript.update`, `participant_events.join_leave`).
- `lib/partner/session-init.ts` — `dispatchMeetingBot()`. Confirmed: `provider.createBot(meetingUrl,
  clioSessionRef, renderUrl, clioSessionRef)` passes `partner_sessions.id` into the provider's `userId`
  parameter slot. No changes needed here.
- `lib/meeting-bot/attendee.ts` — `createBotBrowserMode()`. Confirmed: `metadata: { user_id: userId }` is
  written verbatim into the Attendee bot-creation payload, so every webhook event Attendee later sends for
  that bot carries `event.bot_metadata.user_id === partner_sessions.id` for a partner-dispatched bot.
- `lib/partner/live-render.ts` — `getPartnerSession()`, `handleSessionEnd()`. Confirmed the exact current
  4-argument signature and every side effect `handleSessionEnd()` performs (status/`ended_at` write,
  test-mode trial-cutoff cancellation, `usage.voice_minute` billing gated on `durationMinutes > 0`, the
  unconditional final `session.completed` billable-event dispatch).
- `app/api/partner/render/end-session/route.ts` and
  `app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`'s `endSessionOnce()` — confirmed the
  client-side path has exactly **two** call sites (line 167, inside Hume's `end_session` tool-call handler;
  line 212, the `useEffect` unmount cleanup), deduped by `endedRef`, and computes `duration_minutes`
  client-side. **Correction from an earlier draft of this document**: `onDisconnect` (line 187) does
  *not* call `endSessionOnce()` — it only sets local UI status (`setStatus('ended')`). This means an
  adapter disconnect that does not also unmount the component (a WebSocket drop or network blip while
  the page stays open) is itself a case where the client-side path silently never fires — not only a
  full headless-Chromium process kill. See Section 9 for the corrected edge-case framing this implies.
  This client-side path remains the authoritative, duration-accurate completion path when it does fire.
- `supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql:174-217` — `partner_sessions` schema.
  Confirmed every column this spec needs already exists (`status`, `provider_bot_id`, `provider_name`,
  `error_message`, `updated_at` with its existing trigger, `ended_at`). No migration required.
- `docs/specs/B2B-09-requirement-document.md`, Out of Scope section — confirms the Attendee webhook
  signature bypass and Attendee bot/meeting mechanics are both explicitly outside B2B-09's scope (Hume
  `chat_ended` webhook handling and conversation-content extraction only), and that this document's scope
  does not duplicate or conflict with B2B-09's.

---

## 1. Purpose

`/api/attendee/webhook` is Clio's general-purpose Attendee.dev event handler — not B2C-specific
infrastructure. It already works correctly today for Clio's own direct coaching sessions. Attendee sends
the exact same three event types (`bot.state_change`, `transcript.update`, `participant_events.join_leave`)
regardless of which flow dispatched the bot.

Today, `handleEvent()` identifies the session an event belongs to solely by looking up `walkthrough_state`
by `event.bot_metadata.user_id`. For a bot dispatched through the B2B partner flow
(`dispatchMeetingBot()` in `lib/partner/session-init.ts`), no `walkthrough_state` row exists — so every
Attendee webhook event for a partner session hits the existing `if (!walkthroughRow)` branch, logs a
warning, and returns. This has been true since B2B-02 shipped `dispatchMeetingBot()`; it is a gap that was
never closed, not a regression.

**What failure looks like without this document:** partner sessions get no bot-join confirmation, no
fallback session-completion/billing safety net if the client-side `/api/partner/render/end-session` call
never fires (headless Chromium killed mid-session, network blip, fatal error), and no participant-join
handling. The single highest-cost consequence is billing/status drift: a partner session whose bot crashes
before the client-side call lands stays stuck at `status = 'bot_active'` forever, with no completion record
and no minute-usage billed for time the bot was genuinely running.

## 2. User Story

As the code that receives Attendee.dev webhook events for a partner-dispatched bot,
I want to correlate the event to its `partner_sessions` row and apply the same already-proven
event-handling pattern the B2C path uses,
So that partner sessions get accurate completion status and billing even when the client-side completion
call never arrives — without touching a single byte of the existing B2C code path.

## 3. Trigger / Entry Point

- **Route:** `POST /api/attendee/webhook` (existing route, no new route file).
- **Trigger:** an inbound webhook POST from Attendee.dev, for any bot Clio has dispatched — B2C or partner.
  No user action; this is a server-to-server call.
- **State required:** none from the caller's side (Attendee is unauthenticated beyond the existing
  soft-verify signature check, which this document does not change). On Clio's side, the event is only
  actionable if `event.bot_metadata.user_id` resolves to either a `walkthrough_state` row (B2C, unchanged)
  or a `partner_sessions` row (new, this document).
- **No new webhook subscription needed:** `createBotBrowserMode()` (`lib/meeting-bot/attendee.ts:67-70`)
  already registers all three trigger types for every bot Attendee creates, B2C or partner. Nothing changes
  at bot-creation time.

## 4. Flow Description

This is a backend-only, server-to-server webhook handler — there is no user-facing screen. In place of
screen states, this section describes every code-path branch `handleEvent()` can take, step by step, exactly
as it will behave after this change.

### 4.1 Top-level routing in `handleEvent()` — the only place existing code is touched

Today:
```
1. Extract userId from event.bot_metadata.user_id. If absent, warn and return.
2. Look up walkthrough_state by user_id.
3. If no row found: warn "No walkthrough_state for userId", return.
4. If found: run the existing B2C switch statement on event.trigger.
```

After this change:
```
1. Extract userId from event.bot_metadata.user_id. If absent, warn and return.        [UNCHANGED]
2. Look up walkthrough_state by user_id.                                              [UNCHANGED]
3. If no row found:
     3a. NEW — look up partner_sessions by id = userId.
     3b. If a partner_sessions row is found: call handlePartnerSessionEvent(event, row), then return.
     3c. If neither table matches: warn (message text extended to mention both lookups), return.
                                                                                        [behavior for
                                                                                         "no match at all"
                                                                                         case unchanged:
                                                                                         warn + return]
4. If walkthrough_state row found: run the existing B2C switch statement, byte-for-byte unchanged.
                                                                                        [UNCHANGED]
```

**Explicit correctness statement, verified against the actual code:** the B2C branch — everything that
runs once a `walkthrough_state` row is found (the entire existing `switch (event.trigger)` block, all three
cases, in the same order, with the same field reads and the same DB writes) — is not modified in any way.
The only change to existing code is the addition of one new lookup and one new conditional branch *inside*
the pre-existing `if (!walkthroughRow) { ... }` block, which today contains only a warn-and-return. The
partner path is purely additive on a B2C-lookup miss, exactly as the Feature Brief's Known Constraints
require.

**Why the lookup order (B2C first, partner second) is safe, not just convenient:** Clerk/B2C `user_id`
values and `partner_sessions.id` (a `uuid_generate_v4()` Postgres UUID, confirmed at
`071_b2b02_partner_accounts_and_api_keys.sql:175`) come from disjoint, non-overlapping ID formats. A
B2C-lookup miss followed by a partner-lookup attempt cannot accidentally match the wrong row, and a
successful B2C match means the partner lookup is never attempted for that event.

### 4.2 `handlePartnerSessionEvent(event, partnerSessionRow)` — the new function

Looked up via a dedicated, minimal select (not a reuse of `getPartnerSession()`, which is shaped for the
render-page content-pull path and does not select `updated_at`):

```sql
SELECT id, partner_account_id, status, test_mode, updated_at
FROM partner_sessions
WHERE id = :userId
```

Branches on `event.trigger`, mirroring the B2C switch's structure and log style:

**`bot.state_change` → `new_state === 'joined_recording'`**
No DB write. `provider_bot_id` was already written at dispatch time by `dispatchMeetingBot()`
(`session-init.ts:63-66`) — before any webhook could possibly fire — and B2B-09's transcript extraction
keys off Hume's own `chat_id` (captured client-side via `PartnerRenderClient.tsx`'s `onConnect`), never off
the Attendee bot id. Unlike B2C, which persists `bot_id` on this event because its own `quality-evaluator`
later fetches it from `walkthrough_state`, a partner session has no equivalent later reader. This event is
confirmatory/observability-only for a partner session: log `bot_id` and `partner_sessions.id`, done.

**`bot.state_change` → `new_state === 'ended'` or `'fatal_error'`**
This is the fallback safety net, not a second source of truth. The client-side path
(`PartnerRenderClient.tsx`'s `endSessionOnce()` → `POST /api/partner/render/end-session` →
`handleSessionEnd()`) is the authoritative, duration-accurate completion path and is expected to win in the
common case.

1. Check `partnerSessionRow.status`.
2. **If `status` is already `'completed'` or `'failed'`:** the client-side path already won. No-op — log
   confirmation only (`bot_id`, `partner_sessions.id`, `state`, current `status`). No DB write, no billing
   call. This is the expected, common case.
3. **If `status` is anything else** (`'bot_active'` in the expected case; defensively also covers the
   theoretically-unreachable `'requested'`/`'bot_dispatch_failed'` states, since an `ended`/`fatal_error`
   event can only arrive at all for a bot that was actually dispatched): the client-side path never landed.
   Trigger the fallback completer:
   - Compute `durationMinutes` from `(Date.now() - new Date(partnerSessionRow.updated_at).getTime()) /
     60000`, clamped to `[0, 600]` (the same upper bound `/api/partner/render/end-session`'s own Zod schema
     already enforces, applied here defensively since this call bypasses that schema). `updated_at`
     reflects the last state transition — written `'bot_active'` at dispatch time by `dispatchMeetingBot()`
     — and is the best available approximation once the client itself is presumed gone. **This is
     documented as an approximation for a rare fallback path, not a precision guarantee.**
   - Determine `targetStatus`: `'failed'` if `state === 'fatal_error'`, else `'completed'`. (See Section 6,
     "Technical Decision," for how this flows into `handleSessionEnd()`.)
   - Call `handleSessionEnd(partnerSessionRow.id, partnerSessionRow.partner_account_id, durationMinutes,
     partnerSessionRow.test_mode, targetStatus)` — the exact same function the client-side route calls, no
     new billing or status-transition logic written. `fatal_error` still bills for minutes actually used
     (parity with how `ended` is already billed) but lands the row at `status = 'failed'` instead of
     `'completed'`, for support/observability accuracy.
   - Log a `console.warn` (not just `console.log`) noting fallback completion was triggered — this is the
     one branch worth being loud about, since it means the client-side path failed to report itself.

**`transcript.update`**
No-op, log-only — matching the file's existing "not forwarded" comment style for the B2C case. B2C's
handler runs `analyzeTranscription()` and writes sentiment/deferred-question data to
`user_session_context`, none of which has a partner-session equivalent, and building one would mean
persisting partner end-user transcript content in Clio's own database — directly in tension with
`CORE_OBJECTIVES.md`'s Non-Negotiable Data Boundary. This is a confirmed boundary, not a gap: log
`partner_sessions.id` and the transcript length only (never the transcript text itself, to avoid even
incidentally logging partner end-user speech content), take no DB action.

**`participant_events.join_leave`**
No-op, log-only. The event is correlated to the correct `partner_sessions` row and logged (`event_type`,
`participant_name`, `partner_sessions.id`) — no DB write, no greeting. B2C's handler writes a greeting into
`walkthrough_state.pending_transcript`, which has two blockers for direct reuse in a partner session: (1) a
partner's own branding/tone may not want Clio-authored greeting copy — a product decision, not a mechanical
one; (2) `PartnerRenderClient.tsx` has no `pending_transcript`-equivalent polling/delivery mechanism today
(confirmed by that file's own code comment at lines 148-152) — building one would be new work, not reuse of
an already-proven pattern. See Section 11 for how this is carried forward as a deferred item, not a blocking
open question.

**Any other `event.trigger` value**
Falls to a `default` case, logged and ignored — same defensive pattern the existing B2C switch already
uses for unrecognized triggers.

## 5. Visual Examples

Not applicable — this is a server-to-server backend webhook handler with no user-facing screen. Section 4
above documents every branch at wire level in place of a screen-by-screen wireframe set, consistent with
this codebase's existing convention for backend-only specs (see `docs/specs/B2B-09-requirement-document.md`
Section 4.B/5 for the same approach).

**Sequence flow — fallback completion (the one genuinely new runtime path):**
```
Bot crashes / headless Chromium killed before endSessionOnce()'s fetch completes
  → Attendee detects the disconnect, fires bot.state_change { new_state: 'fatal_error' }
  → POST /api/attendee/webhook
  → handleEvent(): walkthrough_state lookup by bot_metadata.user_id → miss
  → NEW: partner_sessions lookup by id = bot_metadata.user_id → match
  → handlePartnerSessionEvent(event, row)
  → row.status === 'bot_active' (client-side path never ran)
  → durationMinutes = (now - row.updated_at) / 60000, clamped [0, 600]
  → handleSessionEnd(row.id, row.partner_account_id, durationMinutes, row.test_mode, 'failed')
      → partner_sessions.status = 'failed', ended_at = now()
      → if test_mode: cancel clio/partner-trial.ended cutoff job
      → if durationMinutes > 0: recordBillableEvent(usage.voice_minute, durationMinutes)
      → recordBillableEvent(session.completed)  [unconditional, unchanged]
  → POST /api/attendee/webhook still returns 200 { ok: true } regardless (existing, unchanged contract)
```

**Sequence flow — common case, webhook arrives after client-side already completed:**
```
Session ends normally → PartnerRenderClient.tsx's endSessionOnce() fires
  → POST /api/partner/render/end-session → handleSessionEnd(..., 'completed') → status = 'completed'
Seconds later, Attendee's own bot.state_change { new_state: 'ended' } webhook arrives
  → POST /api/attendee/webhook → partner_sessions lookup → match, status already 'completed'
  → no-op, log confirmation only — no second billing call, no status overwrite
```

## 6. Data Requirements

**Read from the database:**
- `walkthrough_state` by `user_id` (existing, unchanged).
- `partner_sessions` — new lookup, `SELECT id, partner_account_id, status, test_mode, updated_at WHERE id
  = :userId`, only attempted when the `walkthrough_state` lookup misses.

**Written to the database:**
- No write for `joined_recording`, `transcript.update`, or `participant_events.join_leave` on the partner
  path — all three are log-only, per Section 4.2.
- `partner_sessions.status` and `.ended_at` — written only via `handleSessionEnd()`, only on the
  fallback-completion branch (client-side path never landed). No direct `UPDATE` statement is added to the
  webhook route itself; the existing function is reused unmodified in its write logic, only its status
  target changes (see Technical Decision below).

**APIs / internal functions called:**
- `handleSessionEnd()` (`lib/partner/live-render.ts`) — reused, not reimplemented. Internally calls
  `recordBillableEvent()` (unchanged) and, for `test_mode` sessions, emits `clio/partner-trial.ended` via
  Inngest (unchanged).
- No new external vendor calls. No new Attendee API calls, no new Anthropic calls, no new Stripe/webhook
  calls.

**localStorage / sessionStorage:** none — this is entirely server-side.

**No schema changes.** `partner_sessions` (migration 071, lines 174-217) already has every column this
document needs: `status`, `test_mode`, `updated_at` (with its existing `update_partner_sessions_updated_at`
trigger), `ended_at`, `provider_bot_id`, `provider_name`, `error_message`. Confirmed by direct read.

### Technical Decision — `handleSessionEnd()`'s status parameter

The Feature Brief explicitly delegates this implementation choice to this document (its "Questions for BA"
item 2): how should `handleSessionEnd()` support landing a session as `'failed'` (for the `fatal_error`
fallback case) instead of always `'completed'`?

**Decision: extend `handleSessionEnd()` with a 5th, optional parameter**, rather than a wrapper function
that patches status after the fact:

```ts
export async function handleSessionEnd(
  clioSessionRef: string,
  partnerAccountId: string,
  durationMinutes: number,
  testMode: boolean,
  targetStatus: 'completed' | 'failed' = 'completed',  // NEW — optional, defaults to current behavior
): Promise<void> {
  const supabase = createSupabaseAdminClient()
  await supabase
    .from('partner_sessions')
    .update({ status: targetStatus, ended_at: new Date().toISOString() })  // was: status: 'completed'
    .eq('id', clioSessionRef)
  // everything else in the function body is UNCHANGED — same trial-cutoff cancellation gated on
  // testMode, same recordBillableEvent(usage.voice_minute) gated on durationMinutes > 0, same
  // unconditional final recordBillableEvent({ eventType: 'session.completed', ... }) call.
}
```

**Rationale:**
- A default-valued optional parameter means the existing call site
  (`app/api/partner/render/end-session/route.ts:36`, `handleSessionEnd(session.id, session.partnerAccountId,
  parsed.data.duration_minutes, session.testMode)`) requires **zero changes** — it keeps calling with 4
  arguments and gets identical behavior (`targetStatus` defaults to `'completed'`).
- A wrapper function would mean either two separate `UPDATE` statements against `partner_sessions` (a
  redundant second write immediately after the first) or duplicating `handleSessionEnd()`'s entire body —
  both worse than a single-line change to the one `.update()` call already there.
- **The unconditional final `recordBillableEvent({ eventType: 'session.completed', ... })` call is left
  exactly as-is, firing identically regardless of `targetStatus`.** The Feature Brief's instruction is to
  reuse `handleSessionEnd()` with "no new billing logic, full reuse" — carving out an exception for this one
  call for the `fatal_error` case would be new logic, not reuse. `session.completed` is the existing
  business-event name for "a partner session has finished, one way or another"; the `partner_sessions.status`
  column (`'completed'` vs `'failed'`) is what carries the finer-grained distinction for Clio's own
  observability, not the webhook event name.
- This keeps the change to `lib/partner/live-render.ts` to a single line inside the function body plus one
  new parameter — no new files, no new exported functions beyond the one already-planned
  `handlePartnerSessionEvent()` in the webhook route itself.

## 7. Success Criteria (Acceptance Tests)

✓ Given an Attendee webhook event with `bot_metadata.user_id` set to a real Clerk/B2C `user_id` that has a
matching `walkthrough_state` row, when `handleEvent()` processes it, then the existing B2C `switch`
statement runs exactly as it does today — same DB writes, same Inngest emissions, same log lines. (B2C
regression — confirms zero behavior change.)

✓ Given an Attendee webhook event with `bot_metadata.user_id` set to a `partner_sessions.id` (no matching
`walkthrough_state` row), when `handleEvent()` processes it, then the partner-session lookup matches and
`handlePartnerSessionEvent()` is invoked with the correct row. (Partner-event correlation.)

✓ Given a partner session whose `status` is already `'completed'` (client-side `endSessionOnce()` already
ran successfully) when Attendee's `bot.state_change { new_state: 'ended' }` webhook arrives, then no DB
write occurs, no `handleSessionEnd()` call is made, and the event is logged as a no-op confirmation.
(`ended` as no-op when client-side already completed.)

✓ Given a partner session whose `status` is still `'bot_active'` (client-side call never landed) when
Attendee's `bot.state_change { new_state: 'ended' }` webhook arrives, then `handleSessionEnd()` is called
with `targetStatus = 'completed'`, `durationMinutes` computed from `(now - updated_at)`, and
`partner_sessions.status` becomes `'completed'`. (`ended` as fallback completer.)

✓ Given a partner session whose `status` is still `'bot_active'` when Attendee's `bot.state_change {
new_state: 'fatal_error' }` webhook arrives, then `handleSessionEnd()` is called with `targetStatus =
'failed'`; if the computed `durationMinutes > 0`, a `usage.voice_minute` billable event is recorded for
that duration; and `partner_sessions.status` becomes `'failed'`, not `'completed'`. (`fatal_error` billing
+ status='failed'.)

✓ Given a partner session's `transcript.update` event arrives, when `handlePartnerSessionEvent()` processes
it, then no database write occurs (not to `partner_sessions`, not to any other table), only a log line is
emitted. (`transcript.update` no-op.)

✓ Given a partner session's `participant_events.join_leave` event arrives, when
`handlePartnerSessionEvent()` processes it, then the event is correlated to the correct `partner_sessions`
row and logged, but no database write occurs and no greeting is generated or delivered.
(`participant_events.join_leave` no-op.)

✓ Given an Attendee webhook event whose `bot_metadata.user_id` matches neither a `walkthrough_state` row
nor a `partner_sessions` row, when `handleEvent()` processes it, then a warning is logged and the function
returns without error — the route still responds `200 { ok: true }` to Attendee. (No-match fallback,
unchanged 200-always contract.)

✓ Given a partner session's `bot.state_change { new_state: 'joined_recording' }` event arrives, when
`handlePartnerSessionEvent()` processes it, then no database write occurs and a confirmatory log line is
emitted. (`joined_recording` confirmatory-only.)

## 8. Error States

| Failure | Attendee-visible behavior | Clio-side behavior |
|---|---|---|
| `bot_metadata.user_id` absent from the event | None — Attendee always gets `200 { ok: true }` | Existing unchanged warn-and-return path; partner lookup is never attempted |
| Neither `walkthrough_state` nor `partner_sessions` matches `userId` | `200 { ok: true }` (unchanged contract) | Warning logged (message extended to note both lookups were tried), no further action |
| `partner_sessions` Supabase read throws/errors | `200 { ok: true }` (unchanged contract) | Treated as no match (defensive — never throws out of `handlePartnerSessionEvent`'s caller); falls through to the "no match" warning path |
| `handleSessionEnd()` throws during the fallback-completion branch (e.g. `recordBillableEvent()` failure) | `200 { ok: true }` (unchanged contract) | Caught by the existing outer `handleEvent(event).catch((err) => console.error(...))` in `POST()` — logged, never surfaces as a non-200 to Attendee, matching every other error path in this route today |
| Client-side `endSessionOnce()` and the webhook fallback race (both read `status = 'bot_active'` in a narrow window before either writes) | N/A | Both could independently call `handleSessionEnd()`, producing a double `usage.voice_minute` billing call for overlapping/duplicate duration windows. Documented as a known, narrow, accepted risk — see Section 9. Not resolved by this document; the Feature Brief frames the fallback path as "rare," and closing this race with row-level locking/compare-and-swap would be new logic beyond the brief's "reuse, don't reimplement" scope. |
| Attendee sends a `trigger` value that is none of the three known types | `200 { ok: true }` (unchanged contract) | Falls to `default` case inside `handlePartnerSessionEvent`, logged, ignored — mirrors the existing B2C `default` case |

## 9. Edge Cases

- **Webhook `ended` arrives seconds to tens-of-seconds after the client-side call already completed the
  session** (normal case, timing depends on Attendee's own delivery latency): no-op, confirmed by Section 7.
- **Client-side `endSessionOnce()` never fires at all.** `endSessionOnce()` has exactly two call sites
  (the `end_session` tool-call handler and the unmount cleanup) — a full headless-Chromium process kill
  before either runs is one way this happens, but **not the only way**: `onDisconnect` (line 187) does
  not call `endSessionOnce()` at all, so a Hume WebSocket disconnect or network blip that leaves the page
  itself still mounted is *also* a silent-miss case, independent of any process kill. In either case, the
  Attendee `ended`/`fatal_error` webhook is the *only* signal Clio ever receives for that session's
  completion — the fallback path is the sole safety net, not a redundant one. No design change follows
  from this correction; Section 4.2's fallback logic already covers both root causes identically, since
  it only checks `partner_sessions.status`, not why the client-side path was silent.
- **`durationMinutes` computes to ~0** (e.g., the webhook fires implausibly soon after dispatch): the
  `durationMinutes > 0` guard already inside `handleSessionEnd()` skips the `usage.voice_minute` billing
  call, but the unconditional final `session.completed` event still dispatches — same behavior a
  legitimately-zero-duration session would already get via the client-side path today, not a new edge case
  this document introduces.
- **A `test_mode` session completes via the fallback path:** `handleSessionEnd()` still reads `testMode`
  from the correlated `partner_sessions` row and correctly cancels the trial-cutoff Inngest job
  (`clio/partner-trial.ended`) — no special-casing needed, since `testMode` flows through the same
  parameter regardless of which caller invoked the function.
- **Fallback-webhook race with the client-side path** (both see `status = 'bot_active'` before either
  writes): narrow window, documented in Section 8 as an accepted risk rather than silently ignored.
- **Multiple `participant_events.join_leave` events fire for one session** (multiple participants joining
  and leaving): each event is independently logged; there is no state to accumulate or dedupe against,
  since no DB write occurs on this path.
- **A partner session's bot never reaches `'bot_active'`** (dispatch itself failed —
  `status = 'bot_dispatch_failed'`) and Attendee nonetheless somehow sends an `ended`/`fatal_error` event
  for that `bot_id`: covered by the same "anything other than `completed`/`failed`" branch condition in
  Section 4.2 — `handleSessionEnd()` would still run defensively. This is expected to be unreachable in
  practice (Attendee cannot fire events for a bot that was never successfully created), documented for
  completeness rather than as an anticipated real occurrence.

## 10. Out of Scope

- **Signature-verification hard-enforcement.** Soft-verify mode (`app/api/attendee/webhook/route.ts`'s
  existing `if (!match) { console.warn(...) }` fallthrough) is left exactly as-is. Tracked separately in
  `docs/b2b-pivot-status.md`'s Backlog section, per the Feature Brief's explicit instruction.
- **Hume-side conversation-content extraction** (B2B-09's scope: `partner_session_insights`, the
  `chat_ended` webhook, the internal glitch dashboard). Confirmed non-overlapping by direct read of
  `docs/specs/B2B-09-requirement-document.md`'s Out of Scope section, which itself names the Attendee
  webhook signature bypass as separately tracked and outside its own scope. This document's concern is
  Attendee bot/meeting mechanics (join/leave, state changes, fallback completion); B2B-09's concern is Hume
  transcript content. Different vendors, different layers, no shared code paths modified by either.
- **Any delivery mechanism for a partner-session greeting** equivalent to B2C's `pending_transcript` write
  on `participant_events.join_leave`. No such mechanism exists in `PartnerRenderClient.tsx` today (confirmed
  by that file's own code comment). Building one is new work, not reuse of an already-proven pattern, and is
  explicitly out of scope per the Feature Brief. See Section 11 for the deferred follow-on question.
- **Sentiment or deferred-question tracking for partner end users**, equivalent to B2C's
  `analyzeTranscription()`/`user_session_context` pipeline on `transcript.update`. Confirmed as a
  data-boundary-driven, deliberate exclusion (Section 4.2), not an oversight.
- **Any change to `walkthrough_state`, the `sessions` table, or any part of the existing B2C `switch`
  statement in `handleEvent()`.** Confirmed unmodified by direct read (Section 4.1).
- **Any change to `dispatchMeetingBot()`, `createBotBrowserMode()`, or the Attendee bot-creation payload.**
  The correlation mechanism (`userId` slot carrying `clio_session_ref`) already exists and needs no new
  metadata tagging, per the Feature Brief's Grounding item 1.
- **Any schema/migration change.** `partner_sessions` (migration 071) already has every column this
  document needs.

## 11. Open Questions

None — zero blocking open questions. This brief carried a fully-worked technical design into the spec
stage, and both items the Feature Brief flagged for the BA to carry forward (not reopen) are resolved
below:

**Deferred item for Arun (not a blocking open question):** should partner sessions get a join greeting when
a participant joins the meeting, and if so, what should it say and how would it reach a live Hume session?
Two independent blockers stand between today's no-op and building this: (1) **product** — a partner's own
branding/tone may not want Clio-authored greeting phrasing (or any Clio-authored greeting at all), which is
a content decision for Arun, not a mechanical one; (2) **technical** — `PartnerRenderClient.tsx` has no
delivery mechanism today equivalent to B2C's `pending_transcript` polling loop; building one is new
work beyond this brief's "reuse what's already proven" scope. This document's implementation deliberately
ships the literal minimum now (event fires, gets correlated, gets logged, no greeting) and this question is
carried forward as a named follow-on for a future brief, exactly as the Feature Brief instructed — it does
not block this document's approval or build.

## 12. Dependencies

- **B2B-02** (done) — `partner_sessions` schema (migration 071), `dispatchMeetingBot()`, the `userId`-slot
  correlation mechanism this document relies on entirely without modification.
- **B2B-03** (done) — `PartnerRenderClient.tsx`, `/api/partner/render/end-session`, `handleSessionEnd()` —
  this document extends `handleSessionEnd()` with one optional, default-valued parameter (Section 6,
  Technical Decision) and adds no new exported functions to `lib/partner/live-render.ts` beyond that.
- **The existing Attendee webhook route and its soft-verify signature mode** — unchanged, no dependency on
  the separately-tracked hard-enforcement backlog item.
- **No dependency on B2B-09.** Confirmed non-overlapping scope (Section 10).
- **Nothing in this document requires a new environment variable, a new vendor approval, or a new migration
  file.**
