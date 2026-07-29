# Meeting-Bot Termination Robustness (Bot Never Actively Told to Leave) — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-29

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code, every load-bearing claim
in the CEO brief (`.claude/agents/clio/feature-briefs/B2B-50-meeting-bot-termination-robustness.md`)
was re-checked directly against live code, not assumed. All of it held up:

- `lib/meeting-bot/attendee.ts` line 30-46, `deleteBot(botId)` — confirmed: `POST {BASE_URL}/bots/{botId}/leave`,
  treats `404` as success (already-gone bot), mocks cleanly when `ATTENDEE_API_KEY` is a placeholder.
- Called from exactly two places: `inngest/partner-trial-cutoff.ts` line 47 (inside
  `runTrialCutoffSequence()`, extracted by B2B-43) and `inngest/partner-live-cutoff.ts` line 249 —
  both confirmed correct, both left untouched by this brief.
- `lib/partner/live-render.ts`'s `handleSessionEnd()` (line 722) — confirmed by full read: never
  calls `getMeetingBotProvider().deleteBot()` today. Two callers confirmed exactly as described:
  `app/api/partner/render/end-session/route.ts` (line 36) and `app/api/attendee/webhook/route.ts`'s
  `handlePartnerSessionEvent()` (line 461).
- `getPartnerSession()` (`lib/partner/live-render.ts` line 186-215) confirmed to NOT select
  `provider_bot_id` today, even though `lib/partner/session-init.ts` line 65 confirmed populates it
  at dispatch time (`.update({ status: 'bot_active', provider_bot_id: botId, ... })`).
- `participant_events.join_leave` in the partner-session switch (`app/api/attendee/webhook/route.ts`
  line 476-518) confirmed still a join-greeting-flag-only no-op with respect to ending a session —
  it never calls `handleSessionEnd()` today.
- Item 3 root-cause chain (`app/api/demo/[slug]/performance/route.ts` lines 87-96,
  `DemoTopicClient.tsx` lines 156-175) confirmed byte-for-byte as described: `session_state` stays
  `'in_progress'` for as long as `partner_sessions.status` is `'requested'`/`'bot_active'`, and the
  10s poll (line 162) only clears the UI once `session_state` leaves `'in_progress'`/`'not_dispatched'`.

### 0.1 Two additional findings, made while tracing the above (both material to this brief's design)

**Finding A — the Hume-side server-close question has a clear, evidence-based answer: no such Hume
endpoint exists, and none should be built.** Every Hume REST call this codebase has ever made is
inventoried below (grep for `api.hume.ai` across the full repo, excluding worktrees):

| Endpoint | Method | Used for |
|---|---|---|
| `/oauth2-cc/token` | POST | Access token minting (`app/api/hume-token/route.ts`) |
| `/v0/evi/configs` | POST | Create a Config (`config-provisioner.ts`) |
| `/v0/evi/configs/{id}` | GET | Read a Config (`config-provisioner.ts`, `session-details.ts`, debug route) |
| `/v0/evi/configs/{id}` | DELETE | Delete a Config, POST-archival (`hume-native-nightly-cleanup.ts`) |
| `/v0/evi/chats?...` | GET | List chats (debug route only) |
| `/v0/evi/chats/{id}` | GET | Chat metadata incl. `start_timestamp`/`end_timestamp` and paginated
  `events_page` (transcript) — `session-details.ts`'s `fetchAllTranscriptEvents()` and
  `fetchHumeChatDuration()`, used by the live-cutoff job's mid-session verification loop and the
  session-details lookup route |

There is no POST/PATCH/DELETE on `/v0/evi/chats/{id}` anywhere — because Hume EVI chats are
WebSocket sessions, not server-managed resources with a "force end" verb. This is not a gap in this
codebase's research; `lib/voice/hume-native/session-details.ts`'s own header comment documents a
prior, corrected misunderstanding of this exact API surface (B2B-44: the team initially guessed a
paginated `/events` sub-resource existed and had to fix it once it 404'd unconditionally in
production) — i.e., this codebase has already been burned once by guessing at undocumented Hume REST
surface, and the fix both times was "read what the metadata endpoint actually returns," never
"invent a new endpoint." Applying that same discipline here: the only server-side lever that exists
is `timeouts.inactivity` (`config-provisioner.ts` line 336, `{ enabled: true, duration_secs: 120 }`)
— Hume's own built-in behavior of closing a chat after 120s with no audio activity. `HumeAdapter.
endSession()` (`hume-adapter.ts` line 340) closing the WebSocket client-side remains the only
explicit close mechanism that exists.

**Resolution:** do not build (or wait on) any explicit server-side Hume-close call — none exists to
call. Instead:
1. Removing the bot from the meeting (`deleteBot()`) stops the Attendee bot's virtual microphone
   feed, which is the only audio Hume ever receives for this chat (`attendee.ts`'s own header
   comment: "the bot's mic/speaker carry Hume's audio directly into the meeting" — same channel,
   both directions). With no audio in either direction, Hume's `timeouts.inactivity` (120s) closes
   the chat on Hume's own side without any explicit call from Clio.
2. More importantly, **billing and session-completion do not wait on or depend on Hume's chat
   actually closing.** `handleSessionEnd()` marks `partner_sessions` terminal and records
   `usage.voice_minute`/`session.completed` using `durationMinutes` supplied by the caller (client
   wall-clock, or the Attendee-webhook fallback's own `attendee`/`attendee_receipt`-sourced
   calculation) — never Hume's `start_timestamp`/`end_timestamp`. (`fetchHumeChatDuration()` is used
   **only** as a live, mid-session cross-check inside `partner-live-cutoff.ts`'s adaptive cutoff
   loop, gracefully falling back to the Inngest clock whenever Hume data is unavailable — never as
   the source of truth at session-end time.) So a Hume chat that lingers for up to 120s after the
   bot leaves, before Hume's own timeout closes it, has **zero** billing or transcript-alignment
   consequence for partner sessions: transcript pagination (`fetchAllTranscriptEvents()`) reads
   whatever events Hume recorded up to the real end of speech, regardless of exactly when the
   WebSocket object itself closes.
3. The one place a still-open Hume chat is more than cosmetic — the nightly Hume Config archive/
   cleanup job (`inngest/hume-native-nightly-cleanup.ts`) — **does not apply to partner sessions at
   all**: confirmed by direct read of its `fetch-eligible-sessions` step (line 90-109), it queries
   the legacy `sessions` table only (`hume_native_enabled`, `ended_at`), never `partner_sessions`.
   Partner-session Hume Config archival/cleanup is a pre-existing, wholly separate gap this brief did
   not introduce and is explicitly **out of scope** here (§10) — flagged, not silently absorbed.

No server-side Hume-close call is added by this brief. This closes CEO brief Question 4 with
evidence, not a guess.

**Finding B — a real, live, silently-failing bug in `inngest/partner-live-cutoff.ts`'s
`mark-session-completed` step, found while tracing `end_reason` (adjacent to, but distinct from, the
`deleteBot()` call site this brief is explicitly told not to touch).** Migration 083
(`083_b2b19_inline_content_and_minute_enforcement.sql`) extended the `partner_sessions_end_reason_check`
CHECK constraint to admit `'balance_exhausted'`/`'balance_limit_reached'`. Migration 087
(`087_b2b27_card_verification.sql`), applied later, **drops and recreates that same constraint**
listing only `'trial_limit_reached', 'trial_exhausted', 'funding_required', 'card_required'` —
silently regressing away `'balance_limit_reached'`. `inngest/partner-live-cutoff.ts` line 262 still
writes `end_reason: 'balance_limit_reached'` in its `mark-session-completed` step's `.update()` call,
and that call's result is never checked for `{ error }` (line 256-267) — a CHECK-constraint violation
on this write is silently swallowed by Supabase-js (it does not throw), meaning **the entire update
(`status: 'completed'`, `ended_at`, `end_reason`, `wrap_up_pending`, `wrap_up_nudge_text`,
`billed_duration_source`) currently fails to apply for every live-wallet-exhausted forced cutoff**,
even though the `deleteBot()` call in the same step (which this brief is correctly told not to touch)
still succeeds. This would leave `partner_sessions.status` stuck at `'bot_active'` forever for that
specific path — a second, independent way to reproduce a symptom that looks identical to Item 3 (the
"bot is joining" UI never clearing), but via a completely different mechanism than this brief's core
fix addresses, and on a code path (`partner-live-cutoff.ts`) this brief is explicitly barred from
touching.

**This is out of scope for B2B-50's own diff** — fixing it would mean editing the one file this
brief was told to leave alone. It is flagged to Arun/CEO as a separate, urgent finding (via the
background-task mechanism, not folded into this diff) and listed again in §10/§12 so the Orchestrator
does not mistake "not in this diff" for "not real."

---

## 1. Purpose

Today, exactly one termination path proactively tells the meeting-bot vendor (Attendee) to leave a
Google Meet: the wallet/trial-minutes-exhausted cutoff jobs. Every other way a session actually ends
— a participant saying goodbye, a host manually removing the bot, or all participants leaving the
meeting without saying goodbye — relies on Attendee noticing independently and reporting back, which
either takes 45-70 seconds (confirmed observed fallback latency) or, for "someone manually removed
the bot," never needed telling in the first place, or, for "everyone just left without touching the
bot," may not happen at all until a human intervenes. Left uncorrected, the bot keeps sitting visibly
in a partner's Google Meet, consuming session minutes nobody is using, and (per Arun) frustrating end
users who see a bot outstay its welcome. This feature closes that gap for every termination path that
currently has one, using the exact `deleteBot()` mechanism already proven correct for the
wallet-exhausted case, and adds a first proactive detection mechanism for the one path that has none
today (all participants leaving without ending the session or removing the bot).

Failure without this: partner minutes/wallet balance drain on phantom "sessions" nobody is in, the
bot visibly lingers in a live Google Meet in front of a partner's own customer (a direct trust/brand
problem for a B2B2C product), and the demo/partner render page's own session-status UI (Item 3) stays
stuck reporting a session as active indefinitely.

## 2. User Story

As **Arun (and, downstream, every reseller/partner running a live Clio session in a Google Meet)**,
I want the meeting bot to be proactively told to leave the instant a session is recognized as over —
by any means the session can end — rather than waiting for Attendee to notice on its own,
so that no partner ever burns billable minutes on an empty meeting, no end user ever sees the bot
linger after the conversation is clearly finished, and the demo/partner render page's own status UI
reflects reality promptly.

As a **developer maintaining `handleSessionEnd()`**,
I want exactly one place responsible for "tell the bot to leave" for every non-cutoff termination
path,
so that a future new termination trigger gets this behavior for free instead of needing to remember
to call `deleteBot()` itself.

## 3. Trigger / Entry Point

This brief changes internal session-termination plumbing, not a user-facing screen. There is no new
route, page, or user-initiated entry point. The termination paths this brief touches or adds:

1. **Existing — participant-initiated end.** Hume's `end_session` tool call (inline or template
   mode, `PartnerRenderClient.tsx` lines 204-208 / 224-228) → `endSessionOnce()` (line 380) →
   `POST /api/partner/render/end-session` → `handleSessionEnd()`. No trigger change; `deleteBot()`
   is added inside `handleSessionEnd()` itself (§6.1), so this path gets it automatically.
2. **Existing — component unmount** (same client-side path as #1, different cause — `cancelled=true`
   cleanup on the voice-connect `useEffect`, line 282-285). Same fix applies automatically.
3. **Existing — Attendee-reported end/crash.** `bot.state_change: ended`/`fatal_error` webhook →
   `handlePartnerSessionEvent()` → `handleSessionEnd()` (line 461). Same fix applies automatically;
   `deleteBot()` here is a safe, cheap no-op (bot's already gone, §6.1).
4. **Existing — wallet/trial exhaustion.** `inngest/partner-trial-cutoff.ts` /
   `inngest/partner-live-cutoff.ts`'s own cutoff timers. **Not touched by this brief** — these
   already call `deleteBot()` directly and do not call `handleSessionEnd()` at all (confirmed §0),
   so nothing here affects them.
5. **New trigger — all participants leave the meeting without ending the session or removing the
   bot.** Attendee's `participant_events.join_leave` webhook, correlated across multiple events per
   session (§6.4-6.7). Fires `handleSessionEnd()` via a new debounced Inngest job once the meeting
   is confirmed empty of real participants for a sustained window.

**State required:** none of these change the pre-existing trust/auth boundary of any touched route —
`/api/partner/render/end-session` and `/api/attendee/webhook` remain exactly as unauthenticated (by
design, per their own existing header comments) as before.

## 4. Screen / Flow Description

No screen changes. This brief is entirely session-termination backend logic. The one user-observable
effect is indirect: once a session ends by any of the paths in §3, the bot now visibly leaves the
Google Meet within seconds (paths 1-3) or within the debounce window (§6.6 — path 5), instead of
lingering; and the demo/partner render page's existing "Bot is joining the meeting" state (Item 3)
clears on its own next 10s poll once `partner_sessions.status` flips to `'completed'`/`'failed'`
promptly, with no new code for that symptom (§7 AT-13, re-verification only, per the CEO brief's own
recommendation).

## 5. Visual Examples

Not applicable — no visual/UI change. (Per `CLAUDE.md`'s standing responsive-by-default rule: this
brief touches zero `.tsx` markup/layout, so it does not trigger that rule's "any future work that
touches a screen" obligation.)

## 6. Data Requirements

### 6.1 `lib/partner/live-render.ts` — `handleSessionEnd()`: the single choke point

Resolves CEO Question 2: **yes, `handleSessionEnd()` calls `deleteBot()` internally.** Beyond the
"every caller benefits automatically" argument the CEO brief already made, there is a second,
independent reason this must be the design: `handleSessionEnd()` is about to gain a third caller
(§6.4-6.7, the new participants-empty debounce job) alongside its two existing callers, which
materially increases the chance of two termination signals racing for the same session (e.g., the
new debounce job fires for a session the participant *also* just ended conversationally a moment
earlier). `recordBillableEvent()`'s idempotency dedup (`lib/partner/webhooks.ts` line 77-87,
`canonicalHashInput()`) includes `occurred_at`, which `handleSessionEnd()` never passes — so it
defaults to `now()` on every call (line 131). Two calls to `handleSessionEnd()` for the same session,
each a few seconds apart, produce two *different* payload hashes and are **not** deduplicated by that
mechanism — a real double-bill (`usage.voice_minute` recorded twice, `session.completed` emitted
twice) if `handleSessionEnd()` is ever called twice for one session. This is a correctness
requirement this brief introduces the risk of, not a pre-existing one (the Attendee-webhook fallback
already self-guards with its own `row.status === 'completed' || 'failed'` check before calling
`handleSessionEnd()`; the client end-session route does not guard at all today, and never needed to
before this brief added a third, racier caller).

**Fix, added inside `handleSessionEnd()` itself** (benefits all three callers, including the two
pre-existing ones, for free):

```diff
--- a/lib/partner/live-render.ts
+++ b/lib/partner/live-render.ts
@@ -1,4 +1,5 @@
 import { createSupabaseAdminClient } from '@/lib/supabase'
+import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
 import { pullPartnerContent, pullPartnerProfile } from './render-data'
 import { resolvePartnerTheme, getThemeConfig, type CSSCustomProperties } from './theme'
 import { getPromptConfig } from './prompt-config'
@@ -186,7 +187,7 @@ export async function getPartnerSession(clioSessionRef: string): Promise<Partn
   const supabase = createSupabaseAdminClient()
   const { data } = await supabase
     .from('partner_sessions')
     .select(
-      'id, partner_account_id, content_ref, partner_topic_ref, partner_end_user_ref, status, test_mode, content_source_id, content_pages, content_to_explain, content_title, content_subtitle, end_user_role, end_user_name, end_user_industry'
+      'id, partner_account_id, content_ref, partner_topic_ref, partner_end_user_ref, status, test_mode, content_source_id, content_pages, content_to_explain, content_title, content_subtitle, end_user_role, end_user_name, end_user_industry, provider_bot_id'
     )
     .eq('id', clioSessionRef)
     .maybeSingle()
```

`PartnerSessionRow` (line 162-184) gains one field:

```diff
   endUserName: string | null
   endUserIndustry: string | null
+  // B2B-50 — the Attendee bot id assigned at dispatch (session-init.ts line 65). Read here so
+  // handleSessionEnd() callers can proactively tell Attendee to leave without a second query.
+  providerBotId: string | null
 }
```

...and `getPartnerSession()`'s return object gains the matching read (`(data.provider_bot_id as
string | null) ?? null`).

`handleSessionEnd()`'s signature and body (line 722-782):

```diff
 export async function handleSessionEnd(
   clioSessionRef: string,
   partnerAccountId: string,
   durationMinutes: number,
   testMode: boolean,
+  // B2B-50 — the bot id to proactively command to leave. Nullable: a session that never
+  // successfully dispatched a bot (status stuck at 'requested') has none; deleteBot() is
+  // correctly skipped in that case, mirroring runTrialCutoffSequence()'s own `if (!providerBotId)
+  // return` guard (inngest/partner-trial-cutoff.ts line 45).
+  providerBotId: string | null,
   targetStatus: 'completed' | 'failed' = 'completed',
   billedDurationSource: 'attendee' | 'attendee_receipt' | 'client_reported' | 'wall_clock_fallback' = 'client_reported',
+  // B2B-50 — optional, additive. Only the new participants-empty debounce path (§6.6) passes
+  // 'all_participants_left'; both pre-existing callers omit it, so their DB write is byte-for-byte
+  // unchanged (end_reason is never touched by their call, exactly as today).
+  endReason?: string | null,
 ): Promise<void> {
   const supabase = createSupabaseAdminClient()
+
+  // B2B-50 — idempotency guard. Now reachable from 3 independent trigger paths that can race for
+  // the same session (client end-session call, Attendee-webhook fallback, new participants-empty
+  // debounce). See this doc's §6.1 prose above for why recordBillableEvent()'s own idempotency
+  // hash does not catch a second call here. Mirrors the check the Attendee-webhook fallback
+  // (app/api/attendee/webhook/route.ts line 419) already does at its own call site — moved here so
+  // EVERY caller (including the client end-session route, which never had this guard) is covered.
+  const { data: existing } = await supabase
+    .from('partner_sessions')
+    .select('status')
+    .eq('id', clioSessionRef)
+    .maybeSingle()
+  if (existing?.status === 'completed' || existing?.status === 'failed') {
+    console.log('[live-render] handleSessionEnd called for an already-terminal session — no-op:', { clioSessionRef, status: existing.status })
+    return
+  }
+
+  // B2B-50 — proactively tell the meeting-bot vendor to leave. Reuses the exact deleteBot()
+  // pattern already proven in the two cutoff jobs (inngest/partner-trial-cutoff.ts line 44-51,
+  // inngest/partner-live-cutoff.ts line 247-253) verbatim: non-fatal try/catch, session still ends
+  // below on failure. A bot that's already gone (manual removal, crash, or this call arriving via
+  // the Attendee-webhook fallback where Attendee itself already reported it left) safely no-ops
+  // via deleteBot()'s own 404-as-success handling (attendee.ts line 42).
+  if (providerBotId) {
+    try {
+      await getMeetingBotProvider().deleteBot(providerBotId)
+    } catch (err) {
+      console.error('[live-render] deleteBot failed (non-fatal — session still ends below):', err)
+    }
+  }
+
   await supabase
     .from('partner_sessions')
-    .update({ status: targetStatus, ended_at: new Date().toISOString(), billed_duration_source: billedDurationSource })
+    .update({
+      status: targetStatus,
+      ended_at: new Date().toISOString(),
+      billed_duration_source: billedDurationSource,
+      ...(endReason ? { end_reason: endReason } : {}),
+    })
     .eq('id', clioSessionRef)
```

The rest of the function body (trial/live-ended cancel-event dispatch, `emitPartnerSessionEndedEvent()`,
the `usage.voice_minute`/`session.completed` billing calls) is **unchanged** — untouched lines, not
reproduced here.

### 6.2 `app/api/partner/render/end-session/route.ts` — thread `providerBotId` through

```diff
-  await handleSessionEnd(session.id, session.partnerAccountId, parsed.data.duration_minutes, session.testMode)
+  await handleSessionEnd(session.id, session.partnerAccountId, parsed.data.duration_minutes, session.testMode, session.providerBotId)
```

`session` here is already `getPartnerSession()`'s return value (line 31) — §6.1's added field is
available with zero new query.

### 6.3 `app/api/attendee/webhook/route.ts` — thread `providerBotId` through the fallback path

`PartnerSessionForEvent` (line 346-353) gains one field, and both places that build a value of this
type read it:

```diff
 interface PartnerSessionForEvent {
   id: string
   partnerAccountId: string
   status: string
   testMode: boolean
   updatedAt: string
   attendeeJoinedAt: string | null
+  providerBotId: string | null
 }
```

```diff
     const { data: partnerSessionRow } = await supabase
       .from('partner_sessions')
-      .select('id, partner_account_id, status, test_mode, updated_at, attendee_joined_at')
+      .select('id, partner_account_id, status, test_mode, updated_at, attendee_joined_at, provider_bot_id')
       .eq('id', userId)
       .maybeSingle()

     if (partnerSessionRow) {
       await handlePartnerSessionEvent(event, {
         id: partnerSessionRow.id as string,
         partnerAccountId: partnerSessionRow.partner_account_id as string,
         status: partnerSessionRow.status as string,
         testMode: Boolean(partnerSessionRow.test_mode),
         updatedAt: partnerSessionRow.updated_at as string,
         attendeeJoinedAt: (partnerSessionRow.attendee_joined_at as string | null) ?? null,
+        providerBotId: (partnerSessionRow.provider_bot_id as string | null) ?? null,
       })
       return
     }
```

And the fallback's own call site (line 461):

```diff
-        await handleSessionEnd(row.id, row.partnerAccountId, durationMinutes, row.testMode, targetStatus, billedSource)
+        await handleSessionEnd(row.id, row.partnerAccountId, durationMinutes, row.testMode, row.providerBotId, targetStatus, billedSource)
```

As the CEO brief anticipated: this is the "safe, cheap no-op" call site — Attendee has already
reported the bot gone by the time this fires, so `deleteBot()` here almost always hits the 404-treated-
as-success branch. Included anyway for defense-in-depth (a `fatal_error` state, unlike a clean
`ended`, does not guarantee the bot process actually tore down) and because leaving it out would mean
this one caller alone still needs its own memory of the rule — defeating the point of the choke point.

### 6.4-6.7 — New: multi-participant "everyone left" correlation

Resolves CEO Question 3, and the brief's explicit ask to design for "host/participant manually
removes the bot or leaves the meeting without saying goodbye." Two of the three ways this can happen
are **already covered with no new code** (§9 has the full matrix); this section covers the one that
isn't: participants leave the meeting, the bot is never told to leave and never notices anything
wrong on its own (it just keeps narrating/listening to a now-empty room), and nobody manually removes
it either.

**6.4 — the event-type guessing problem, and how this design avoids it.** `app/api/attendee/webhook/
route.ts` line 484-490 (B2B-46) documents, in the team's own words, that the exact string Attendee
sends for "a participant left" is **unconfirmed** — their public docs describe `'join'`/`'leave'`,
but this codebase's only confirmed value is `'participant_joined'` (proven working today via the
join-greeting feature). Building "participant left" detection by guessing a second string value would
repeat exactly the mistake B2B-44 already made once with Hume's transcript endpoint (§0.1 Finding A)
— guess an API shape, ship it, discover months later it silently never fired. **This design does not
guess the leave string.** The webhook trigger itself is named `participant_events.join_leave` — per
Attendee's own docs (cited in the B2B-46 comment) there are exactly two kinds of event on this
trigger. So: **any event on this trigger whose `event_type` is confirmed-not-`'participant_joined'`**
is treated as "someone left," without needing to know or match its exact string. This is a narrower,
safer inference than matching a guessed string — it only requires knowing what "join" looks like
(confirmed), not what "leave" looks like (unconfirmed).

**6.5 — schema: `partner_sessions.active_participant_count`.** New migration
`supabase/migrations/102_b2b50_meeting_bot_termination_robustness.sql`:

```sql
-- B2B-50 — Meeting-Bot Termination Robustness
-- See docs/specs/B2B-50-requirement-document.md §6.4-6.7 and the CEO Feature Brief
-- (.claude/agents/clio/feature-briefs/B2B-50-meeting-bot-termination-robustness.md).

ALTER TABLE partner_sessions
  ADD COLUMN IF NOT EXISTS active_participant_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN partner_sessions.active_participant_count IS
  'B2B-50: running count of non-bot participants believed currently present in the meeting, maintained
   from Attendee''s participant_events.join_leave webhook (app/api/attendee/webhook/route.ts). Only
   ever a signal to ARM the participants-empty debounce (inngest/partner-participants-empty-debounce.ts)
   once it has been incremented at least once by a confirmed participant_joined event for this
   session — never trusted to end a session that has never observed a join event, since Attendee may
   not fire a join event for participants already present in the meeting before the bot joins (an
   unconfirmed vendor behavior). Floors at 0, never negative.';
```

**6.6 — webhook logic** (`app/api/attendee/webhook/route.ts`, inside the existing
`case 'participant_events.join_leave':` block in `handlePartnerSessionEvent()`, line 476-518):

```diff
     case 'participant_events.join_leave': {
       // B2B-11 (Requirement Doc Section 6.2) — closes the gap B2B-10
       // deliberately left open: sets the join-greeting flag instead of only
       // logging. Guard shape mirrors the B2C branch's own
       // `eventType !== 'participant_joined' || !participantName` check.
       const participantName = (event.data.participant_name as string | null) ?? ''
       const eventType = event.data.event_type as string | undefined
+      const supabaseForCount = createSupabaseAdminClient()

       // B2B-46 Step 1 — diagnostic only, zero behavioral change. ...
       if (eventType !== 'participant_joined') {
         console.log('[attendee/webhook] participant_events.join_leave — non-join event, raw payload for B2B-46 diagnosis:', { ... })
+
+        // B2B-50 §6.4 — deliberately does NOT match a guessed "leave" string. Any non-join event
+        // on this trigger is treated as a departure. Skips the bot's own name exactly like the
+        // join branch below does, so the bot leaving (deleteBot() tearing down its own presence)
+        // is never miscounted as a participant leaving.
+        const theme = await getThemeConfig(row.partnerAccountId)
+        const botNameLower = (theme.assistantDisplayName ?? 'clio').toLowerCase()
+        const isBot = participantName && (participantName.toLowerCase().includes(botNameLower) || participantName.toLowerCase().includes('clio'))
+        if (!isBot) {
+          const { data: decremented } = await supabaseForCount
+            .rpc('decrement_active_participant_count', { p_session_id: row.id })
+            .select('active_participant_count')
+            .maybeSingle()
+          const newCount = (decremented as { active_participant_count?: number } | null)?.active_participant_count ?? null
+          console.log('[attendee/webhook] participant left (inferred, non-join event) — active_participant_count now:', newCount, { partnerSessionId: row.id })
+          if (newCount === 0 && row.status !== 'completed' && row.status !== 'failed') {
+            inngest.send({
+              name: 'clio/partner-session.participants-empty',
+              data: { clioSessionRef: row.id, partnerAccountId: row.partnerAccountId },
+            }).catch((err) => console.error('[attendee/webhook] clio/partner-session.participants-empty emit failed:', err))
+          }
+        }
       }

       if (eventType !== 'participant_joined' || !participantName) break

       // Skip the bot itself ...
       const theme = await getThemeConfig(row.partnerAccountId)
       const botNameLower = (theme.assistantDisplayName ?? 'clio').toLowerCase()
       if (participantName.toLowerCase().includes(botNameLower) || participantName.toLowerCase().includes('clio')) break

       const firstName = participantName.split(' ')[0] ?? participantName

       const supabase = createSupabaseAdminClient()
       await supabase.from('partner_sessions')
         .update({ join_greeting_pending: true, join_greeting_participant_first_name: firstName })
         .eq('id', row.id)
+
+      // B2B-50 §6.5 — arms the debounce mechanism above. A no-op update failure here is logged,
+      // non-fatal (mirrors every other best-effort write in this file).
+      const { error: incrementError } = await supabase.rpc('increment_active_participant_count', { p_session_id: row.id })
+      if (incrementError) console.error('[attendee/webhook] increment_active_participant_count failed (non-fatal):', incrementError.message)

       console.log('[attendee/webhook] participant.joined — join greeting flag set:', { partnerSessionId: row.id, firstName })
       break
     }
```

Two small Postgres RPCs (added in the same migration, §6.5) do the increment/decrement atomically and
return the new value in one round trip, avoiding a read-then-write race between concurrent webhook
deliveries for the same session:

```sql
CREATE OR REPLACE FUNCTION increment_active_participant_count(p_session_id UUID)
RETURNS partner_sessions AS $$
  UPDATE partner_sessions
  SET active_participant_count = active_participant_count + 1
  WHERE id = p_session_id
  RETURNING *;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION decrement_active_participant_count(p_session_id UUID)
RETURNS partner_sessions AS $$
  UPDATE partner_sessions
  SET active_participant_count = GREATEST(0, active_participant_count - 1)
  WHERE id = p_session_id
  RETURNING *;
$$ LANGUAGE sql;
```

(Consuming code above uses `.select('active_participant_count')` loosely for illustration — the
actual Supabase-js call pattern for an RPC returning a full row is `.rpc(...).single()`; the
implementing developer should follow this codebase's existing RPC-call convention, e.g.
`consume_trial_and_test_minutes`'s call site in `lib/partner/live-render.ts` line 770, adjusted for a
function that returns the row instead of void.)

**6.7 — the debounce job.** New file `inngest/partner-participants-empty-debounce.ts`:

```ts
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { handleSessionEnd } from '@/lib/partner/live-render'
import { clampDurationMinutes } from '@/lib/partner/attendee-timing'

/**
 * B2B-50 §6.6-6.7 — fired when active_participant_count transitions to 0. Deliberately NOT an
 * instant end: per the CEO brief's own explicit caution ("don't end a session because one of
 * several participants left"), a hard immediate cutoff on a momentary reconnect blip (Wi-Fi drop,
 * Meet's own rejoin flow) would be a worse failure mode than a short delay. 90s mirrors the same
 * order of magnitude as partner-live-cutoff.ts's own 60s wrap-up-runway and the observed 45-70s
 * Attendee-webhook fallback latency this brief is otherwise trying to beat — conservative on
 * purpose for this one mechanism only, unlike the "within a few seconds" bar the other 3 paths
 * (§3) now meet via the handleSessionEnd() choke point.
 */
export const partnerParticipantsEmptyDebounce = inngest.createFunction(
  {
    id: 'partner-participants-empty-debounce',
    name: 'Partner Session — All Participants Left Debounce',
    triggers: [{ event: 'clio/partner-session.participants-empty' }],
    concurrency: { key: 'event.data.clioSessionRef', limit: 1 },
    retries: 1,
  },
  async ({ event, step }: {
    event: { data: { clioSessionRef: string; partnerAccountId: string } }
    step: { sleep: (id: string, duration: string) => Promise<void>; run: <T>(id: string, fn: () => Promise<T>) => Promise<T> }
  }) => {
    const { clioSessionRef, partnerAccountId } = event.data

    await step.sleep('debounce-wait', '90s')

    const stillEmpty = await step.run('recheck-still-empty', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase
        .from('partner_sessions')
        .select('status, active_participant_count, provider_bot_id, test_mode, attendee_joined_at, updated_at')
        .eq('id', clioSessionRef)
        .maybeSingle()
      if (!data) return null
      if (data.status === 'completed' || data.status === 'failed') return null // already ended some other way
      if ((data.active_participant_count as number) > 0) return null // someone rejoined — abort
      return data as {
        provider_bot_id: string | null
        test_mode: boolean
        attendee_joined_at: string | null
        updated_at: string
      }
    })

    if (!stillEmpty) return // no-op: rejoined, or already ended via another path

    const durationMinutes = await step.run('compute-duration', async () => {
      const base = stillEmpty.attendee_joined_at ?? stillEmpty.updated_at
      return clampDurationMinutes(Date.now() - new Date(base).getTime())
    })

    await step.run('end-session', async () => {
      await handleSessionEnd(
        clioSessionRef,
        partnerAccountId,
        durationMinutes,
        Boolean(stillEmpty.test_mode),
        stillEmpty.provider_bot_id,
        'completed',
        'wall_clock_fallback',
        'all_participants_left',
      )
    })
  },
)
```

`end_reason` gains one new admitted value — migration 102 (§6.5) also extends the existing CHECK
constraint (following the established DROP-then-ADD pattern from migrations 077/079/083/087, §0.1
Finding B):

```sql
ALTER TABLE partner_sessions DROP CONSTRAINT IF EXISTS partner_sessions_end_reason_check;
ALTER TABLE partner_sessions ADD CONSTRAINT partner_sessions_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN (
    'trial_limit_reached', 'trial_exhausted', 'funding_required', 'card_required', 'all_participants_left'
  ));
```

**Deliberately not re-admitting `'balance_exhausted'`/`'balance_limit_reached'`** — restoring those
is the fix for §0.1 Finding B, which is out of scope for this brief's own diff (flagged separately,
§10/§12). Silently smuggling that fix into this migration would blur which brief actually fixed it;
the Orchestrator should land that as its own tracked change.

**6.8 — new shared module** `lib/partner/attendee-timing.ts` (extracted so both the webhook route and
the new debounce job use one implementation, not two hand-copies):

```ts
/**
 * B2B-50 — extracted from app/api/attendee/webhook/route.ts (previously private, unexported
 * functions of the same name/behavior) so inngest/partner-participants-empty-debounce.ts can reuse
 * the same wall-clock duration math instead of duplicating it. Behavior is byte-for-byte unchanged
 * from the originals.
 */

export function extractAttendeeEventTimestamp(event: { data: Record<string, unknown> }): string | null {
  const candidates: unknown[] = [
    event.data?.created_at,
    event.data?.timestamp,
    event.data?.occurred_at,
    event.data?.event_time,
    event.data?.changed_at,
    event.data?.time,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' || typeof c === 'number') {
      const d = new Date(c)
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
  }
  return null
}

export function clampDurationMinutes(ms: number): number {
  return Math.min(600, Math.max(0, ms / 60000))
}
```

`app/api/attendee/webhook/route.ts` drops its own local copies (lines 367-389 for
`extractAttendeeEventTimestamp`, 387-389 for `clampDurationMinutes`) and imports both from the new
module instead — no behavior change, pure de-duplication. (Note: `extractAttendeeEventTimestamp`'s
original signature took the full `AttendeeWebhookEvent`; the shared version narrows the parameter
type to just `{ data: Record<string, unknown> }`, the only part it reads, so it does not need to
import that interface — `AttendeeWebhookEvent` stays defined and exported from nowhere outside the
route file, unaffected.)

### 6.9 — Inngest registration

`app/api/inngest/route.ts` gains one import and one entry in the `functions` array:

```diff
 import { demoDispatchMinutesConsumer } from '@/inngest/demo-dispatch-minutes-consumer'
+import { partnerParticipantsEmptyDebounce } from '@/inngest/partner-participants-empty-debounce'
```
```diff
-  functions: [..., demoDispatchMinutesConsumer],
+  functions: [..., demoDispatchMinutesConsumer, partnerParticipantsEmptyDebounce],
```

### 6.10 — APIs called

No new external API calls. `deleteBot()` (Attendee) is an existing, already-integrated call, now
invoked from one additional internal call site (inside `handleSessionEnd()`). No new Hume calls
(§0.1 Finding A). No new third-party vendor.

### 6.11 — No localStorage/sessionStorage

Not applicable — this is entirely server-side session-lifecycle logic.

## 7. Success Criteria (Acceptance Tests)

✓ AT-1: Given an in-progress partner session with a populated `provider_bot_id`, when the Hume
`end_session` tool fires (participant says goodbye), then `handleSessionEnd()` calls
`getMeetingBotProvider().deleteBot(providerBotId)` before or as part of marking the session
`'completed'` — the bot is told to leave on the same call that ends the session, not left for
Attendee to notice.

✓ AT-2: Given the same scenario as AT-1 but `deleteBot()` rejects (network error/non-2xx), when
`handleSessionEnd()` runs, then the session still ends normally (`status: 'completed'`, billing
recorded) — a failed bot-leave call never blocks or fails session completion.

✓ AT-3: Given a partner session with `provider_bot_id: null` (bot never successfully dispatched),
when `handleSessionEnd()` is called, then `deleteBot()` is never invoked (no call, not even an
attempted-and-caught one) and the rest of the function proceeds unchanged.

✓ AT-4: Given a partner session already in status `'completed'`, when `handleSessionEnd()` is called
again for the same `clioSessionRef` (any caller), then the function no-ops immediately — no second
`deleteBot()` call, no second `usage.voice_minute`/`session.completed` billable event, no second
`ended_at` write.

✓ AT-5: Given the Attendee-webhook `bot.state_change: fatal_error` fallback path firing for a session
with a populated `provider_bot_id`, when `handlePartnerSessionEvent()` calls `handleSessionEnd()`,
then `deleteBot()` is attempted (even though the bot is almost certainly already gone) and its result
never blocks the existing fallback-completion behavior (targetStatus `'failed'`, `billedSource` as
already computed).

✓ AT-6: Given a `participant_events.join_leave` webhook with `event_type: 'participant_joined'` and a
non-bot `participant_name`, when the handler runs, then `active_participant_count` for that session
increments by exactly 1 (via the new RPC), in addition to the existing, unchanged join-greeting-flag
behavior.

✓ AT-7: Given a `participant_events.join_leave` webhook with any `event_type` other than
`'participant_joined'` and a non-bot `participant_name`, when the handler runs and
`active_participant_count` was `> 0` before the call, then it decrements by exactly 1 and never goes
below 0.

✓ AT-8: Given `active_participant_count` transitions from 1 to 0 for a session still in status
`'requested'`/`'bot_active'`, when the decrement RPC returns 0, then exactly one
`clio/partner-session.participants-empty` event is emitted for that `clioSessionRef`.

✓ AT-9: Given `clio/partner-session.participants-empty` fires and, 90 seconds later,
`active_participant_count` is still 0 and the session is still non-terminal, when
`partnerParticipantsEmptyDebounce` re-checks, then it calls `handleSessionEnd(..., 'completed',
'wall_clock_fallback', 'all_participants_left')` with a `durationMinutes` computed from
`attendee_joined_at` (or `updated_at` if unset) to now.

✓ AT-10: Given the same event fires but a participant rejoins (`active_participant_count > 0`) before
the 90s debounce elapses, when the job re-checks, then it no-ops — `handleSessionEnd()` is never
called, and the session is left running.

✓ AT-11: Given the same event fires but the session already ended some other way (participant said
goodbye, or the wallet cutoff fired) before the 90s debounce elapses, when the job re-checks
(`status` is `'completed'`/`'failed'`), then it no-ops.

✓ AT-12: Given a `participant_events.join_leave` event (join or inferred-leave) where
`participant_name` matches the session's own configured `assistantDisplayName` (or the literal
`'clio'` fallback), when the handler runs, then `active_participant_count` is neither incremented nor
decremented — the bot's own presence is never counted as a participant.

✓ AT-13 (re-verification, per CEO brief Question 5 — not a new feature): Given a session ends via any
of AT-1/AT-5/AT-9 above and `partner_sessions.status` flips to `'completed'`/`'failed'` promptly, when
`/demo/[slug]`'s Performance tab next polls (within its existing 10s interval,
`DemoTopicClient.tsx` line 162), then `session_state` is no longer `'in_progress'` and the "✓ Bot is
joining the meeting." message clears without a manual page refresh — confirming Item 3 was fully
explained by this brief's root cause and needs no separate fix, per the CEO brief's own
recommendation. This test should be run live by Arun (or QA) after deploy, not just as an automated
unit assertion, since it is the one acceptance criterion this brief predicts rather than controls
end-to-end.

## 8. Error States

- **`deleteBot()` throws or returns a non-2xx/non-404 status**: caught, logged
  (`console.error('[live-render] deleteBot failed (non-fatal...')`), session termination proceeds
  unaffected (AT-2). Matches the existing cutoff-job convention exactly — no new error-handling
  pattern introduced.
- **`increment_active_participant_count`/`decrement_active_participant_count` RPC fails** (transient
  DB error): logged, non-fatal — the join-greeting flag (increment case) or the leave-detection log
  (decrement case) still proceeds/is still emitted; only the count itself may drift. A drifted count
  degrades gracefully: if it never reaches exactly 0 due to a missed decrement, the worst case is the
  new proactive mechanism simply never fires for that session (falls back to today's existing
  behavior — Attendee's own eventual detection, or the participant explicitly ending the call) — not
  a session ending incorrectly.
- **The debounce job's re-check query fails to find the session at all** (`data` is null — should not
  happen, defensive only): treated as `stillEmpty = null`, function no-ops (same as "already ended").
- **`handleSessionEnd()`'s own idempotency-guard `SELECT` fails** (transient DB error, `existing` is
  `undefined`): `existing?.status` evaluates to `undefined`, which is neither `'completed'` nor
  `'failed'`, so the function proceeds as normal (fails open toward "attempt to end the session,"
  matching this codebase's general bias toward completing/billing correctly over silently skipping
  work — consistent with how every other best-effort write in this file is already handled).
- **A malformed/missing `partner_account_id` on the `clio/partner-session.participants-empty`
  event**: cannot occur in practice — the event is only ever emitted from inside
  `handlePartnerSessionEvent()`, which already has a validated `row.partnerAccountId` in scope; no
  external caller can construct this event with partner-controlled input.

## 9. Edge Cases

**Full termination-path matrix** (per Arun's explicit "brainstorm on all possible instances" ask):

| Scenario | Detects it | Tells Attendee to leave | Hume WS | Transcript/billing |
|---|---|---|---|---|
| Participant says goodbye (Hume `end_session` tool) | Client-side, `PartnerRenderClient.tsx` | **NEW** — `handleSessionEnd()` → `deleteBot()` (§6.1) | Client closes it (`endSessionOnce()`, unchanged) | `handleSessionEnd()`, client-reported duration (unchanged) |
| Host/participant manually removes the bot from the Meet UI | Attendee's own `bot.state_change: ended`, 45-70s observed latency (unchanged, not sped up by this brief — the bot is already gone, nothing to tell) | N/A — already gone; `deleteBot()` called anyway as a safe no-op (§6.1) | Hume's own 120s inactivity timeout (§0.1 Finding A) — not billing-relevant | `handleSessionEnd()` via webhook fallback, `attendee`/`attendee_receipt`-sourced duration (unchanged) |
| All participants leave the meeting, bot not removed, nobody says goodbye | **NEW** — `active_participant_count` reaches 0 (§6.4-6.7) | **NEW** — `handleSessionEnd()` → `deleteBot()`, after 90s debounce | Hume's own 120s inactivity timeout, once `deleteBot()` stops the audio feed | **NEW** — `handleSessionEnd()`, wall-clock duration from `attendee_joined_at`, `end_reason: 'all_participants_left'` |
| Attendee's own bot process crashes / `fatal_error` | Attendee's own webhook (unchanged) | N/A — already gone; `deleteBot()` called anyway as a safe no-op (§6.1) | Hume's own 120s inactivity timeout | `handleSessionEnd()` via webhook fallback, `targetStatus: 'failed'` (unchanged) |
| Wallet/trial minutes exhausted | Inngest cutoff timer (unchanged) | Already correct, untouched (`partner-trial-cutoff.ts`/`partner-live-cutoff.ts`) | Hume's own 120s inactivity timeout | Cutoff job's own billing sequence (unchanged) — **note §0.1 Finding B**, a real but separately-flagged bug in the live-wallet path's `end_reason` write |
| "Browser tab closes/crashes" | **Clarified, not a distinct scenario** — see below | — | — | — |

**"Browser tab closes/crashes" clarification (a genuine, evidence-based finding, not a guess):** for
a real partner session, `PartnerRenderClient.tsx` is never opened in an end user's or participant's
own browser — it is the page Attendee's bot itself loads, headless, as its own "mouth and ears"
(`attendee.ts` line 49-52's own comment: "Attendee loads walkthroughUrl in headless Chromium... the
bot's mic/speaker carry Hume's audio directly into the meeting"). There is no separate participant-
side browser tab to worry about losing a `beforeunload` race on. "The browser tab closes/crashes"
for a real session **is** the "Attendee-side crash" row above — already covered, no new gap. The one
residual, narrow case is a human manually opening `/partner-render/[clio_session_ref]` directly in
their own browser (the route has no auth gate beyond a valid session ref, per its own header comment)
for ad hoc debugging/preview — for that non-production, tooling-only usage, `beforeunload` reliability
genuinely is a known, accepted gap (no `sendBeacon`/`keepalive` hardening exists for it). **Not fixed
here** — building `sendBeacon` hardening for a debug-only access pattern that is not how any real
partner session is ever opened is not a good use of this brief's scope; flagged in §10.

- **Multi-participant meeting, one of several leaves**: correctly does NOT end the session —
  `active_participant_count` only reaches 0 (and only then fires the debounce) once every known
  participant has left, per Arun's own explicit requirement (§6.4-6.7, AT-7).
- **A session where Attendee never fires a `participant_joined` event at all** (e.g., every attendee
  was already in the meeting before the bot joined, an unconfirmed vendor behavior — §6.5's schema
  comment): `active_participant_count` never rises above 0, so a later "leave" event's decrement is a
  no-op floor-at-0 that never triggers the empty-session event. **This session simply never gets the
  new proactive mechanism** — it falls back to exactly today's existing behavior (participant
  explicitly ends the call, or Attendee's own eventual detection). This is a deliberate, evidence-
  respecting design choice (§6.4): it guarantees this brief can never make a session end *more*
  incorrectly than today, only sometimes not as proactively as hoped, in a vendor-behavior scenario
  this codebase cannot independently verify.
- **A participant rejoins right as the 90s debounce is about to fire**: handled by the re-check step
  reading `active_participant_count` fresh at wake time (AT-10) — a race where the rejoin's increment
  RPC and the debounce's re-check land within milliseconds of each other could theoretically still
  end a session someone just rejoined; this is an accepted, rare edge case, not solved further here
  (solving it completely would require a distributed lock this codebase has no existing pattern for,
  disproportionate to the risk).
- **Slow network / API timeout on `deleteBot()`**: no explicit timeout is added — `fetch()` inside
  `deleteBot()` (`attendee.ts` line 37-40) has no `AbortController`, matching its two existing call
  sites' behavior exactly (neither cutoff job times it out either) — not a regression introduced or
  fixed here.
- **Mobile vs desktop**: not applicable — no UI surface in this brief.

## 10. Out of Scope

- Any change to `inngest/partner-trial-cutoff.ts` or `inngest/partner-live-cutoff.ts`'s own
  `deleteBot()` call sites or cutoff-timing logic — confirmed correct, explicitly protected by the
  CEO brief's Known Constraints.
- **§0.1 Finding B — the `partner_sessions_end_reason_check` CHECK constraint regression** (migration
  087 dropped `'balance_exhausted'`/`'balance_limit_reached'`, which `partner-live-cutoff.ts` line 262
  still writes, silently failing that step's entire `.update()` call). Real, live, evidenced — **not
  fixed in this brief's diff** because fixing it means editing the one file this brief is told not to
  touch. Flagged to Arun/CEO as a separate finding (background task spawned alongside this report).
- Speeding up the 45-70s Attendee-webhook fallback latency for the "host manually removes the bot"
  path — nothing to speed up; the bot is already gone by the time that path fires, so there is no
  proactive `deleteBot()` call whose speed matters there. Not this brief's problem to solve.
- Partner-session Hume Config archival/cleanup (§0.1 Finding A point 3) — confirmed the existing
  nightly cleanup job only ever covers the legacy `sessions` table, never `partner_sessions`. A
  real, pre-existing gap, unrelated to bot-termination robustness specifically; not introduced or
  worsened by this brief. Not fixed here — a candidate for its own future brief if partner-session
  Hume Config accumulation is ever confirmed to matter operationally (Config objects are far
  cheaper/lower-risk to leave lingering than an active meeting bot, which is the actual complaint
  this brief addresses).
- `beforeunload`/`sendBeacon` hardening for a human directly opening `/partner-render/[ref]` in their
  own browser outside the normal bot-driven flow (§9) — a debug-only access pattern, not the shipped
  product flow.
- Any change to `isFirstPartyDemoPageUrl()`/`resolveInlineSessionRender()`'s first-party branch or
  `PartnerRenderClient.tsx`'s `sourceUrl` iframe branch (B2B-48) — confirmed nowhere near this
  brief's touched files, per the CEO brief's explicit protection.
- A dedicated "everyone left" grace-period configuration UI (e.g., letting a partner tune the 90s
  debounce) — hardcoded per §6.7's reasoning; no product requirement for it to be configurable.

## 11. Open Questions

None. All 5 of the CEO brief's "Questions for BA" are resolved above with concrete decisions:

1. Full termination-path matrix — §9.
2. `handleSessionEnd()` internal choke point — §6.1, confirmed with an additional, independently-
   discovered idempotency-correctness reason beyond convenience.
3. `participant_events.join_leave` multi-participant correlation design — §6.4-6.7.
4. Hume-side server-initiated-close question — §0.1 Finding A, resolved with evidence (no such
   endpoint exists; not needed given how partner-session billing/transcript already work).
5. Item 3 acceptance test — §7 AT-13.

Two additional, out-of-scope-but-real findings surfaced during re-verification (§0.1) are logged in
§10/§12, not left as open questions, since neither blocks this brief's own correctness.

## 12. Dependencies

- **`lib/meeting-bot/attendee.ts`'s `deleteBot()`** — already built, unmodified, reused verbatim.
- **`lib/meeting-bot/provider.ts`'s `getMeetingBotProvider()`** — already built, unmodified; newly
  imported into `lib/partner/live-render.ts`.
- **Migration `102_b2b50_meeting_bot_termination_robustness.sql`** — new. Adds
  `partner_sessions.active_participant_count`, two Postgres RPCs
  (`increment_active_participant_count`/`decrement_active_participant_count`), and extends
  `partner_sessions_end_reason_check` to admit `'all_participants_left'`. No destructive change to
  any existing column or row.
- **No new environment variables, no new vendor.**
- **§0.1 Finding B (CHECK constraint regression in `partner-live-cutoff.ts`'s write path)** — flagged
  to Arun/CEO as a separate, urgent, out-of-scope finding. The Orchestrator should track this as its
  own fast-follow item, not assume it is covered by this brief.
- **Partner-session Hume Config cleanup gap (§0.1 Finding A point 3)** — logged as a known,
  pre-existing, unrelated gap; no action required as part of this brief.

## 13. Test Plan

New/changed unit tests, following this codebase's established Vitest mocking convention for this
module (`tests/unit/b2b37-partner-session-ended-emission.test.ts`'s pattern — mock
`@/inngest/client`, `@/lib/supabase`, `@/lib/partner/webhooks`, and now also
`@/lib/meeting-bot/provider`).

### 13.1 `tests/unit/b2b37-partner-session-ended-emission.test.ts` — updated, not rewritten

Every existing `handleSessionEnd(...)` call in this file must add the new `providerBotId` positional
argument (5th parameter, before `targetStatus`/`billedDurationSource`) and add a
`vi.doMock('@/lib/meeting-bot/provider', ...)` mock (currently absent — every existing test in this
file will otherwise fail once `handleSessionEnd()` imports and calls
`getMeetingBotProvider().deleteBot()` unconditionally when `providerBotId` is non-null). Existing
assertions (`clio/partner-session.ended`/`clio/partner-live.ended`/`clio/partner-trial.ended` emitted)
are unchanged in substance — only the call signature and the new mock are added. The idempotency
guard (§6.1) also requires the `partner_sessions` Supabase mock to answer the new `SELECT status`
call (currently only `update` is mocked) — extend the `from()` mock to return `{ status: null }` (a
non-terminal status) for the guard's own read, for every existing test in this file.

### 13.2 New `tests/unit/b2b50-handle-session-end-choke-point.test.ts`

Covers AT-1 through AT-5: `deleteBot()` called/not-called per `providerBotId` presence, non-fatal on
`deleteBot()` failure, and the idempotency no-op (AT-4) — a fresh, dedicated file rather than growing
13.1 further, since these are new behaviors distinct from B2B-37's original emission-only scope.

### 13.3 New `tests/unit/b2b50-participant-count-correlation.test.ts`

Covers AT-6, AT-7, AT-8, AT-12: mocks the `increment_active_participant_count`/
`decrement_active_participant_count` RPC calls and `getThemeConfig()`, drives
`handlePartnerSessionEvent()` (exported or tested via the route's `POST` handler, matching this
file's existing test-access pattern — confirm which convention `app/api/attendee/webhook/route.ts`'s
existing tests, if any, already use; none currently exist per §0's grep, so this is the first
dedicated test file for this route and may set the convention) with `participant_joined` and
non-`participant_joined` event payloads.

### 13.4 New `tests/unit/b2b50-participants-empty-debounce.test.ts`

Covers AT-9, AT-10, AT-11: drives `partnerParticipantsEmptyDebounce`'s raw handler via its
`InngestFunction` instance's `.fn` property with a fake `step` (`run` executes immediately, `sleep`
resolves immediately), exactly matching `tests/unit/b2b37-partner-session-ended-emission.test.ts`'s
own `fakeStep()` helper (lines 27-32) for the two existing cutoff-job tests — reused, not
reinvented.

### 13.5 `lib/partner/attendee-timing.ts` — new, directly testable pure functions

A small dedicated `tests/unit/b2b50-attendee-timing.test.ts` (or folded into 13.4) verifying
`extractAttendeeEventTimestamp()`/`clampDurationMinutes()` behave identically to their prior
in-file, unexported versions — no behavior change expected, this is a refactor-safety net.

### 13.6 No E2E test added

This brief has no UI surface (§5) — AT-13 (Item 3 re-verification) is explicitly called out (§7) as a
live, manual re-check by Arun/QA post-deploy, not an automated E2E assertion, since it validates an
emergent effect (a downstream page's existing poll behaving correctly once the upstream state
transitions promptly) rather than new code this brief owns directly.
