# HUME-NATIVE-02 — Server-Side Transcript-Driven Visualization + Post-Session Action-Item/Glitch Extraction — Requirement Document
Version: 1.0
Status: CEO REVIEW — **Both parts dev-ready.** Part A's Section 11 Q1 resolved 2026-07-13: Arun
confirmed recommendation (a) — honor RTV-05's existing template-approval gate as-is. Building Part A
is building RTV-05 exactly as already approved; Part A's live effect in production remains gated on
the separate, already-tracked per-template approval backlog (0/27 at time of writing), which is
correct and expected, not a defect to route around.
Author: Business Analyst Agent
Date: 2026-07-13

---

## 0. Grounding note — read before the spec

This document covers two independent pieces of work from the same Feature Brief
(`.claude/agents/clio/feature-briefs/HUME-NATIVE-02-transcript-visualization-and-action-items.md`).
They are split throughout as **Part A** (visualization) and **Part B** (action items/glitches)
because they have different code owners, different risk profiles, and — critically — different
readiness states. Do not treat this as one monolithic feature.

Everything below was checked directly against the live codebase, not assumed from the Feature
Brief's own citations. Two facts materially changed the shape of Part A from what the Feature Brief
expected, and are surfaced immediately so they aren't buried:

1. **The exact mechanism the Feature Brief asks for in Part A already has an APPROVED, unbuilt spec:
   `RTV-05-prefetch-and-dual-trigger-display.md`** (`.claude/agents/clio/requirement-docs/`,
   Version 1.0, Status APPROVED, dated 2026-07-10). RTV-05 assembles RTV-02 (golden-word markers) +
   RTV-03 (already-built, already-deployed, log-only live transcript tracker, hooked into the exact
   same Hume-native `onMessage` handler this brief's Part A targets) + RTV-04 (template approval) into
   precisely "our own code reads the live transcript and decides when to switch the screen, not
   Hume's tool-call reasoning" — the literal statement of Part A's goal. The Feature Brief does not
   reference RTV-02/03/04/05 anywhere; the CEO Agent that wrote it was not aware they exist. This is
   not a minor citation gap — see Section 11.
2. **`show_visual` and `advance_tab`'s Hume tool-call round trip is not merely a screen-switch
   trigger — it is Clio's only mechanism for receiving her next block of teaching content.** Both
   handlers (`app/dashboard/walkthrough/WalkthroughClient.tsx` lines 1000–1125 for `show_visual`;
   `createAdvanceTabToolHandler()` in `lib/content/live-conductor-client.ts` for `advance_tab`) return
   a text string — the TEACH-script instruction / `resultText` — as the `tool_response` Hume sends
   back to its own LLM. That returned text is what Clio actually speaks next. The Feature Brief's own
   Question 2 recommendation ("remove them from `config-provisioner.ts`'s `tools` array") would strip
   this content-delivery path entirely, not just stop Hume from deciding screen timing — a severe,
   unintended regression to Clio's teaching content, not scoped or intended by anyone. This directly
   changes the answer to Question 2 below (Section 4, Section 9) from "open" to "resolved, and the
   brief's own tentative recommendation is wrong."

Both findings are additive evidence, not a reason to block Part B, which has no dependency on either.

---

## PART A — Server-side transcript-driven visualization switching

## 1. Purpose

Today, whether and when the on-screen visual advances during a live Hume-native session depends on
Hume's own LLM choosing to call the `advance_tab`/`show_visual` tools mid-conversation. Arun has
explicitly decided he does not trust Hume's own reasoning for this per-turn steering decision — he
wants Clio's own system, watching what is actually being said, to decide when the screen switches,
with Hume's role reduced to speaking and delivering teaching content on request.

Failure mode without this: the participant's screen continues to advance at whatever moment Hume's
LLM happens to decide to call the tool — which may lag, lead, or never fire relative to what Clio is
actually saying, undermining exactly the "screen tracks her voice" trust goal the product depends on.

## 2. User Story

As **a session participant (senior executive)**,
I want the on-screen visual to change when Clio is actually talking about the next topic, not
whenever Hume's own reasoning happens to decide to call a tool,
So that the screen feels synchronized with what I'm hearing, not occasionally arbitrary.

As **Arun (product owner)**,
I want the timing decision for when the screen switches to be owned by our own code reading the
transcript, not delegated to Hume's LLM judgment,
So that this is a steering decision Clio's own system controls, consistent with how every other
per-turn decision in this product works.

## 3. Trigger / Entry Point

No new route, no new page. This is an internal mechanism inside the existing Hume-native voice
session lifecycle at `/dashboard/walkthrough/[userId]`, the same component RTV-01/02/03 already
extended. State required: a Hume-native, summary-mode session, exactly as RTV-03/RTV-05 already
require (`hume_native_enabled = true`, `NEXT_PUBLIC_HUME_NATIVE_ENABLED = 'true'`,
`sessions.rtv_eligible = true`, `session_markers` populated).

## 4. Screen / Flow Description — resolved architecture

There is no new UI. This section documents the resolved internal mechanism, which is **RTV-05,
unmodified**, not a new build:

- **Live transcript source (Feature Brief Question 1 — resolved, confirmed against live code, not
  assumed):** Hume's Chat History API (`GET /v0/evi/chats/{id}/events`) is confirmed post-call only.
  But no new subscription or polling is needed for live triggering: `lib/voice/hume-adapter.ts`'s
  `handleMessage()` already receives `user_message`/`assistant_message` WebSocket events **live, in
  real time, as Hume speaks/hears them** (lines 169–194), and already forwards every one through
  `config.onMessage(text, source)` to `WalkthroughClient.tsx`'s Hume-native `onMessage` handler (line
  852). RTV-03's tracker (`lib/content/rtv03-tracker.ts`'s `checkRtv03Transition()`) is already wired
  into that exact handler (lines 850–870), running golden-word matching against every AI utterance as
  it arrives, log-only today. This is the mechanism — it already exists, is already deployed, and
  requires no new Hume API integration.
- **Zero added latency to Hume's responsiveness (non-negotiable constraint) — already proven, not
  just claimed:** the tracker check is synchronous, in-process string matching against a `Set`
  (`tokenize(text)` + `Set.has()`), runs after the audio-relevant branches of `handleMessage()` have
  already completed (audio queuing, mode changes), and its only side effects are an in-memory ref
  update and fire-and-forget audit-log writes — never a blocking call in the WebSocket
  send/receive path. RTV-03's own requirement doc's Section 4b already established and tested this
  "observe-only, cannot touch the response-critical path" boundary with a grep-checkable CI assertion
  (`tests/unit/rtv03-tracker.test.ts`). Nothing in this brief requires touching that boundary.
- **Screen-write authority (Feature Brief Question 3 — the actual switch mechanism):** RTV-05's
  already-approved dual-trigger design. A single, write-once boolean
  (`rtv05DisplayActiveRef`, computed once per session at connect time from a server-side gate —
  RTV-05 Section 4.2) decides, for the entire session, which of two mechanisms is allowed to write
  `walkthrough_state.current_section_index`:
  - **Gate not satisfied (true for every session in production today — see Section 11):** the
    existing `show_visual` `scroll_to` write remains the sole screen writer, byte-identical to
    today's behavior. This is today's actual live behavior, unchanged until the gate is satisfied.
  - **Gate satisfied:** RTV-03's tracker becomes the sole screen writer (same `screenQueueRef`/
    `SCREEN_MIN_DISPLAY_MS` chain `show_visual` already uses, so no new race-condition class is
    introduced — RTV-05 Section 4.3 gives the full non-concurrent-writer proof); `show_visual`'s own
    `scroll_to` write is suppressed, but its idx-resolution and **returned TEACH-script text are
    never skipped** — this is exactly what preserves content delivery (Section 0 finding #2).
- **Fate of `advance_tab`/`show_visual` tool registrations (Feature Brief Question 2 — resolved,
  reversing the brief's own tentative recommendation):** **Do not remove them from
  `config-provisioner.ts`'s `tools` array.** Both tools' `tool_response` payload is Clio's only
  channel for receiving her next teaching content (Section 0, finding #2, confirmed by direct read of
  both handlers). Removing them does not merely stop Hume from timing the screen switch — it removes
  Clio's ability to know what to teach next. RTV-05's design already reaches the correct outcome
  without this risk: Hume's tool call keeps firing and keeps delivering content; only the specific
  `scroll_to` write is conditionally suppressed. This is a stronger, evidence-based resolution of
  Question 2, not a restatement of the brief's own guess.
- **1:1-only reasoning (Feature Brief Question 7 / Known Constraints — resolved and documented per
  the brief's own explicit instruction not to silently assume this):**
  `FB-HUME-GROUND-TRUTH-01-elevated.md`'s Decision 2 established that Hume's transcript cannot
  diarize multiple human speakers because Hume labels speech `USER`/`ASSISTANT` by which side of the
  WebSocket sent it, not acoustic speaker ID — a real constraint for the Recall.ai/Attendee
  meeting-bot pipeline, where room audio from a Google Meet call (potentially multiple humans) is
  bridged to Hume as a single stream. **The Hume-native pipeline this brief targets is architecturally
  different and does not have that exposure at all:** `HumeAdapter` connects directly from the
  participant's own browser tab (`WalkthroughClient.tsx`), and `startMicCapture()` captures audio from
  that browser's own `mediaStream` — one browser tab, one authenticated `userId`, one microphone.
  There is no meeting-bot bridge, no shared room audio, and structurally no code path by which a
  second human's voice could ever reach this WebSocket. This is a stronger, more certain form of the
  "1:1" claim than the general Ground-Truth finding — it is not merely "coaching sessions happen to be
  1:1 today," it is "this specific transport path cannot carry a second speaker's audio, by
  construction." The diarization constraint that blocks Hume's transcript from being authoritative for
  Recall/Attendee-sourced analysis does not apply here, and both Part A's tracker and Part B's
  extraction below correctly do not need Recall/Attendee's transcript for anything.

## 5. Visual Examples

No UI exists for this phase (RTV-05's own Section 5 already contains the full before/after sequence
diagram for the toggle-OFF vs toggle-ON states; not reproduced here to avoid drift between two
documents describing the same mechanism — see that document directly).

## 6. Data Requirements

No new data requirements beyond what RTV-05 already specifies (Section 6 of that document): no new
tables, one new nullable column (`sessions.rtv05_display_active`, already in RTV-05's migration
`066_rtv05_display_switch.sql`), one new API command (`update_section_data`), one new route
(`POST /api/rtv05/prefetch-section`). This document adds no new data requirements of its own.

## 7. Success Criteria (Acceptance Tests)

Inherits RTV-05's full acceptance-test suite (its Section 7, tests 1–10) verbatim — this document
does not restate them to avoid two sources of truth for the same mechanism. This document adds one
acceptance test specific to the Feature Brief's own framing:

11. ✓ **Content delivery is unaffected by this brief.** Given a Hume-native session in any toggle
    state (gate satisfied or not), when Hume's LLM calls `show_visual`/`advance_tab`, then the
    `tool_response` returned to Hume still contains the full TEACH-script instruction text exactly as
    it does today — this brief changes only whether that call's `scroll_to` side effect executes, never
    whether the call happens or what content it returns.

## 8. Error States

Inherits RTV-05's error-state handling (its Section 8) verbatim.

## 9. Edge Cases

Inherits RTV-05's edge cases (its Section 9) verbatim. One addition specific to this brief's own
question set: **a `gap_jump` or missed golden-word hit never causes Hume to re-take screen-timing
authority mid-session** — RTV-05's gate is computed once, frozen for the session's lifetime
(Section 4.2 of that document); there is no runtime condition under which authority reverts to
`show_visual` once the gate has resolved true for a session.

## 10. Out of Scope

- The `end_session` Hume-native tool-call path, the max-session-duration backstop
  (`inngest/session-timer.ts`), and the profile/intent injection in
  `app/api/hume-native/provision-config/route.ts` — per the Feature Brief, none of these are touched.
- Fixing `end_session`'s operational activation blocker (the one-time Hume Tools API registration only
  Arun can run with the real `HUME_API_KEY`) — per the Feature Brief, this is Arun's action item, not
  a spec item.
- RTV-05's own rollout-readiness gate (per-template CEO approval via `/dashboard/admin/templates`,
  RTV-03 accuracy-evidence bar) is not renegotiated, weakened, or bypassed by this document — see
  Section 11 for why that gate's timeline is the one open question this document has.
- The previously-planned visualization PDF export — explicitly removed from scope per Arun's
  2026-07-13 direction (partner-owned under the B2B pivot); not touched by this document.

---

## PART B — Post-session action-item and glitch extraction

## 1. Purpose

Clio-led sessions today produce no structured record of what was discussed, decided, or went wrong
after the call ends. Under the B2B pivot, a partner integrating Clio has no way to see coaching
outcomes without this. Failure mode without it: every session's substantive content — what the
executive committed to, what confused them, what technical hiccups occurred — is lost the moment the
call ends, with no queryable record for a partner or for Clio's own quality monitoring.

## 2. User Story

As **a partner platform integrating Clio** (the eventual consumer of this data, even though this
document does not build their surface — Feature Brief explicitly scopes delivery/display out),
I want a structured, queryable record of action items and glitches per session,
So that coaching outcomes are visible without needing a human to re-watch or re-read every
transcript.

As **Arun (product owner monitoring quality)**,
I want every session's action items and glitches extracted reliably, with an explicit record of
whether extraction actually succeeded and found something — never a silent "done" that produced
nothing,
So that a zero-result session is distinguishable from a broken pipeline, per this codebase's own
prior false-ready-state lesson (`CONTENT-02-overview-summary-and-readiness-guard.md`).

(No end-user-facing story: per the Feature Brief's explicit 2026-07-13 scope correction, this
document covers extraction and storage only — no delivery UI, no partner-facing API, no PDF, no
email. What a partner does with this data is their own feature to build.)

## 3. Trigger / Entry Point

Two triggers, mirroring the additive, never-sole-mechanism pattern
`FB-HUME-GROUND-TRUTH-01-elevated.md`'s Decision 1 already established and got CEO approval for (the
closest, most directly applicable precedent in this codebase for "push-based fast path + polling
backstop, neither one ever a single point of failure"):

1. **Fast path — extended `chat_ended` webhook.** `app/api/webhooks/hume/route.ts`'s existing
   `chat_ended` handler (lines 95–151) already resolves `chat_id` → `sessions` row and writes a
   `hume_webhook_chat_ended` audit row via `writeAuditEvent()`. Immediately after that write
   succeeds, this document adds one line: `await inngest.send({ name:
   'clio/hume-native-session.ended', data: { sessionId: session.id } })`, following the exact
   `inngest.send()` call shape already used elsewhere in this codebase (e.g.
   `inngest/curriculum-queue-cron.ts` lines 76/80). This event triggers Part B's extraction function
   (Section 4) for that specific session, normally within seconds of the real chat ending.
2. **Backstop — nightly/periodic cron sweep.** A new Inngest cron function (mirroring the exact
   pattern `inngest/session-quality-evaluator.ts` already establishes for its own 15-minute cron —
   `inngest.createFunction(..., { triggers: [{ cron: '...' }] }, ...)`) finds Hume-native sessions
   whose `ended_at` is set, more than 30 minutes ago (generous buffer for the webhook's undocumented
   delivery SLA, per `FB-HUME-GROUND-TRUTH-01-elevated.md`'s own finding that Hume publishes no
   webhook-delivery-latency guarantee), that have **no** `session_action_items` row yet — i.e., the
   webhook never fired, was delayed past this sweep's own next run, or its Inngest event failed
   before enqueueing. Recommended cadence: every 30 minutes (tighter than nightly, since the Feature
   Brief explicitly says nightly is acceptable but a same-day catch loop costs nothing extra and
   catches misses faster — a considered improvement on the minimum bar, not scope creep, since it
   reuses the identical query shape already established for `sessionQualityEvaluator`'s own eligibility
   check).

**Why event-driven-plus-backstop, not nightly-only (Feature Brief Question 6 — resolved with
reasoning, not guessed):** the Feature Brief says either is acceptable, but this codebase already has
a CEO-approved, directly analogous precedent (`FB-HUME-GROUND-TRUTH-01-elevated.md` Decision 1: "an
additional, faster-arriving trigger... running alongside, not replacing" the existing backstop) for
exactly this shape of problem — a Hume-side event with no delivery-SLA guarantee, paired with a
guaranteed-eventually-correct sweep. Reusing that exact shape here is a direct application of an
already-approved architectural decision, not a new one requiring separate sign-off.

## 4. Screen / Flow Description

No UI. Per governance, this section documents the internal data-flow sequence at the precision a UI
flow would receive.

**New Inngest function: `humeActionItemExtractor`** (`inngest/hume-action-item-extractor.ts`),
triggered by the `clio/hume-native-session.ended` event (fast path) and callable directly with a
`sessionId` from the cron sweep (backstop) — both paths converge on one shared, idempotent
`extractActionItemsForSession(sessionId)` function so there is exactly one code path, not two
divergent implementations:

1. **Idempotency guard (first step):** read `session_action_items` for this `session_id`. If a row
   already exists with `extraction_status IN ('success', 'success_empty')`, no-op and return
   immediately — this makes it safe for both the fast path and the backstop sweep to ever process the
   same session (e.g. webhook fires late, backstop already ran) without double-extracting or
   double-charging an Anthropic call. If a row exists with `extraction_status = 'failed'` and
   `attempt_count < 3`, proceed (retry). If no row exists, proceed (first attempt) and insert a
   `pending` row first, to make the idempotency check race-safe against the two triggers landing
   close together (`ON CONFLICT (session_id) DO NOTHING` on the initial insert, then re-check status
   if the insert was a no-op — the loser of the race defers to whichever attempt actually won the
   insert).
2. **Fetch the transcript.** Call the existing, already-built `getHumeSessionDetails(sessionId)`
   (`lib/voice/hume-native/session-details.ts`) — reused verbatim, zero new Hume API integration
   code. This function already handles archive-first vs. live-fallback (so extraction works correctly
   whether it runs seconds after the call ends or days later, after the nightly cleanup job has
   already archived and deleted the live Hume Config), already handles a stale/expired/never-started
   `chat_id` (404) as a non-fatal `transcriptFetchError` rather than a crash, and already paginates
   the full `/events` list.
   - If `transcriptEvents.length === 0` and `transcriptFetchError` is set: **throw** (do not write a
     terminal status yet) so Inngest's own step-retry mechanism retries this attempt, mirroring the
     exact "transcript not yet available — throw so Inngest retries this step" pattern already used
     in `inngest/session-quality-evaluator.ts` (lines ~435, ~503) for the identical class of problem
     (Recall.ai's transcript not finalized yet). Configure `retries: 3` on the Inngest function,
     matching the codebase's established default retry count for this failure class.
   - If retries are exhausted (Hume never has a transcript for this chat — e.g. the chat truly never
     started, per `getHumeSessionDetails`'s own `not_eligible_no_hume_ids`/`live_fetch_config_deleted`
     codes): write `extraction_status = 'failed'`, `error_message = <the thrown error's message>`,
     `attempt_count` incremented, and stop. This session will be retried by the next backstop sweep
     (up to `attempt_count < 3` per the idempotency guard above), then permanently marked failed and
     left for manual/future investigation — never silently retried forever.
3. **Format the transcript.** Filter `transcriptEvents` to `type === 'USER_MESSAGE'` /
   `type === 'AGENT_MESSAGE'` (Hume's Chat History event shape, per
   `dev.hume.ai/docs/speech-to-speech-evi/features/chat-history`, already referenced and confirmed in
   `FB-HUME-GROUND-TRUTH-01-elevated.md` Section 5). Map to a plain two-sided transcript: `"User: ..."`
   / `"Clio: ..."` lines, in event order. If the filtered list is empty (transcript events exist but
   none are message-type — e.g. only tool-call/metadata events, a genuinely empty conversation), skip
   the Claude call entirely and go straight to step 5 with an explicit "empty transcript" result
   rather than sending an empty prompt to Claude.
4. **Call Claude for extraction.** Uses `@anthropic-ai/sdk` (already approved, already used elsewhere
   in this codebase for content generation), a single non-streaming Messages API call. System prompt
   (exact text, per Feature Brief Question 5 — "expected output shape" must be concrete, not
   open-ended):

   > You are reviewing a transcript of a 1:1 coaching conversation between an AI coach ("Clio") and an
   > executive ("User"). Extract two things:
   > 1. **Action items** — concrete next steps the User committed to, or that Clio explicitly
   >    recommended and the User acknowledged. Do not invent items the transcript does not support.
   > 2. **Glitches** — moments where the conversation broke down: Clio misunderstood or mis-heard the
   >    User, Clio repeated herself unnecessarily, the User expressed confusion specifically about
   >    Clio (not about the subject matter), or the conversation was derailed by an off-topic
   >    interruption. Do not flag ordinary comprehension checkpoints (a user saying "I don't fully
   >    understand X" about the subject matter is normal coaching, not a glitch).
   >
   > Respond with ONLY a JSON object matching this exact shape, no prose outside the JSON:
   > `{"action_items": [{"text": string}], "glitches": [{"type": "misunderstanding" |
   > "repetition" | "confusion_about_clio" | "derailment" | "other", "description": string}]}`
   >
   > If there are no action items, return an empty array for `action_items`. If there are no
   > glitches, return an empty array for `glitches`. Both empty is a valid, expected result for a
   > short or purely informational session — do not fabricate content to avoid an empty array.

   User message: the formatted two-sided transcript from step 3.

5. **Validate and classify the result (Feature Brief Question 5 — "never silently mark done with
   zero output," directly following the `CONTENT-02` false-ready precedent named in the brief):**
   - Parse the response as JSON against a Zod schema (`z.object({ action_items:
     z.array(z.object({ text: z.string() })), glitches: z.array(z.object({ type: z.enum([...]),
     description: z.string() })) })`). On parse/schema failure: treat identically to a Claude-call
     failure — write `extraction_status = 'failed'`, `error_message` set to the parse error, do not
     write partial/malformed data.
   - If schema-valid and `action_items.length === 0 && glitches.length === 0`: write
     `extraction_status = 'success_empty'` — an explicit, distinct, positive state meaning
     "extraction ran successfully and genuinely found nothing," never conflated with `'failed'`.
   - If schema-valid and either array is non-empty: write `extraction_status = 'success'`.
   - In every non-`'pending'` terminal state, `extracted_at` is set to `now()`.

## 5. Visual Examples

Not applicable — backend-only, no UI, per governance's own carve-out for backend specs.

## 6. Data Requirements

### 6.1 Reads
- `sessions` — `id`, `user_id`, `hume_chat_id`, `hume_native_config_id`, `hume_native_enabled`,
  `ended_at`, `hume_config_archived_at` (all existing columns, via `getHumeSessionDetails()` and the
  backstop sweep's own eligibility query).
- `hume_native_config_archives` — only inside `getHumeSessionDetails()`'s existing archive-first
  branch, unchanged, no new query written by this document.
- `session_action_items` — read once per extraction attempt, for the idempotency guard (Section 4,
  step 1).

### 6.2 Writes — new table, migration `supabase/migrations/0XX_hume_action_items.sql`

Modeled directly on the existing `session_insights` table's shape (`supabase/migrations/
039_session_insights.sql`) for consistency with this codebase's established per-session-extraction
table pattern:

```sql
CREATE TABLE IF NOT EXISTS session_action_items (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id          uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id             text        NOT NULL,
  hume_chat_id        text,
  extraction_status   text        NOT NULL DEFAULT 'pending',
    -- 'pending' | 'success' | 'success_empty' | 'failed'
  action_items        jsonb       DEFAULT NULL,
    -- [{ text: string }], NULL until a terminal state is reached
  glitches             jsonb       DEFAULT NULL,
    -- [{ type: string, description: string }], NULL until a terminal state is reached
  transcript_event_count integer  DEFAULT NULL,
    -- count of USER_MESSAGE/AGENT_MESSAGE events actually sent to Claude, for debugging/audit
  attempt_count       integer     NOT NULL DEFAULT 0,
  error_message       text        DEFAULT NULL,
  extracted_at        timestamptz DEFAULT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_action_items_session ON session_action_items (session_id);
CREATE INDEX IF NOT EXISTS idx_session_action_items_user ON session_action_items (user_id, extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_action_items_status ON session_action_items (extraction_status)
  WHERE extraction_status IN ('pending', 'failed');

ALTER TABLE session_action_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_saitems" ON session_action_items
  USING (auth.role() = 'service_role');
```

**Why a new table, not new columns on `sessions` (Feature Brief Question 4 — resolved):** `sessions`
already carries a large and growing number of feature-specific columns (RTV-02/03/05,
HUME-NATIVE-01, billing). A one-to-one child table keyed by `session_id`, mirroring
`session_insights`'s already-established convention in this exact codebase, keeps the write scoped,
makes the idempotency/retry bookkeeping (`attempt_count`, `extraction_status`) natural to model as row
state rather than a cluster of new `sessions` columns, and matches how this codebase has already
chosen to solve the identical shape of problem once before.

**Why "glitch" is a distinct new concept, not a reuse/extension of `session-quality-evaluator.ts`'s
`quality_error` (Feature Brief Question 4 — resolved):** `sessions.quality_error` (values like
`'transcript_unavailable'`) is a coarse, single-value flag describing why the **evaluation pipeline
itself** failed to run — a pipeline-health signal, set at most once per session, not a description of
what happened *inside* the conversation. "Glitch" as this brief uses it (Clio misunderstanding,
repeating herself, technical hiccups mid-conversation) is a content-level, potentially-multiple-per-
session observation about the coaching interaction itself — a structurally different concept.
Reusing `quality_error` would conflate "our pipeline broke" with "the conversation had a rough
moment," which are different failure classes with different owners and different remediation. This
document introduces `session_action_items.glitches` as the distinct, new category the Feature Brief's
Question 4 asked to explicitly resolve rather than silently assume.

### 6.3 API changes
None. This is a pure background job — no new user-facing or partner-facing route, per the Feature
Brief's explicit exclusion of delivery/display from scope.

### 6.4 External calls
- Hume Chat History API (`GET /v0/evi/chats/{id}/events`) — via the existing
  `getHumeSessionDetails()`, no new integration code.
- Anthropic Messages API (`@anthropic-ai/sdk`, already approved) — one non-streaming call per
  extraction attempt.

## 7. Success Criteria (Acceptance Tests)

1. ✓ Given a Hume-native session ends and Hume's `chat_ended` webhook fires within the backstop
   sweep's window, when the webhook handler processes it, then a `clio/hume-native-session.ended`
   Inngest event is sent and `session_action_items` reaches a terminal status
   (`success`/`success_empty`/`failed`) without requiring the backstop sweep to run.
2. ✓ Given a Hume-native session ends but the webhook never arrives (simulated by not sending it),
   when the next backstop sweep runs (>30 min after `ended_at`), then extraction runs for that
   session exactly once and reaches a terminal status.
3. ✓ Given a transcript with at least one clear commitment ("I'll review the vendor's SOC 2 report
   before Friday"), when extraction runs, then `extraction_status = 'success'` and `action_items`
   contains an entry whose `text` reflects that commitment.
4. ✓ Given a short, purely informational transcript with no commitments and no breakdowns, when
   extraction runs, then `extraction_status = 'success_empty'` (not `'failed'`, not a `'success'` row
   with silently-empty arrays indistinguishable from a broken pipeline).
5. ✓ Given `getHumeSessionDetails()` throws because the transcript isn't available yet (e.g. Hume
   hasn't finished processing), when the Inngest function runs, then it retries up to 3 times before
   marking `extraction_status = 'failed'` with `error_message` set.
6. ✓ Given both the fast path and the backstop sweep attempt the same session (webhook arrives late,
   after the sweep already started processing it), when both attempts run, then exactly one Anthropic
   call is made and exactly one terminal `session_action_items` row results — no duplicate row, no
   duplicate Anthropic spend (`UNIQUE (session_id)` + the idempotency guard, Section 4 step 1).
7. ✓ Given Claude's response fails Zod schema validation, when extraction runs, then
   `extraction_status = 'failed'` is written with the parse error in `error_message`, and no
   malformed `action_items`/`glitches` data is ever written.
8. ✓ Given a session predates this feature (no `session_action_items` row, `ended_at` far in the
   past), when the backstop sweep's eligibility query runs, then that session is picked up and
   extraction runs for it exactly as for a new session (no special-casing needed — the eligibility
   query is "no row exists yet," which is true for every pre-existing session).

## 8. Error States

- **Hume transcript fetch fails after retries exhausted:** `extraction_status = 'failed'`,
  `error_message` set, `attempt_count` incremented. Retried by the next backstop sweep up to
  `attempt_count < 3`, then left terminally failed.
- **Anthropic API call fails (network, timeout, rate limit):** caught, `extraction_status = 'failed'`,
  `error_message` set to the underlying error. Same retry-then-give-up policy as above.
- **Anthropic responds but the JSON is malformed or fails schema validation:** `extraction_status =
  'failed'`, `error_message` describes the validation failure. Never write partial/best-effort data.
- **`ANTHROPIC_API_KEY` is a placeholder (dev/build environment):** mirror this codebase's established
  mock-guard convention (e.g. `lib/templates/generator.ts`'s `isPlaceholder` guard) — return a
  realistic mock `{ action_items: [...], glitches: [...] }` shape and write `extraction_status =
  'success'` with a `metadata` note (or reuse `error_message` as a non-fatal marker) indicating mock
  data was used, so builds/dev never break and this is never confused with a real extraction result in
  a report.
- **`session_action_items` write itself fails (DB error):** logged, non-fatal to the Inngest function
  (it will simply retry per Inngest's own step-retry semantics); never crashes the webhook handler or
  the cron sweep's processing of other sessions in the same run.
- **The webhook's `inngest.send()` call itself fails:** logged and swallowed, exactly like every other
  operation in that handler already is (the handler never returns non-200 to Hume for a downstream
  failure) — the backstop sweep is the guaranteed catch-all for this case, by design (Section 3).

## 9. Edge Cases

- **A session that ends with zero conversation (e.g. immediate disconnect):** `transcriptEvents` will
  be empty or contain no `USER_MESSAGE`/`AGENT_MESSAGE` entries; Section 4 step 3 detects this and
  writes `extraction_status = 'success_empty'` directly, without a wasted Claude call.
- **A session whose Hume Config was already archived by the nightly cleanup job before extraction
  ever runs (e.g. backstop sweep runs days late for some reason):** `getHumeSessionDetails()`
  transparently reads the durable archive instead of the live API — no special-casing needed in this
  document's code, since that fallback already exists.
  transcript never used, transcript-based analysis correctly skipped for this feature — consistent
  with FB-HUME-GROUND-TRUTH-01's Decision 2, which this brief does not touch.
- **Non-Hume-native sessions (Recall.ai/Attendee-bot sessions, e.g. group/legacy sessions):** the
  backstop sweep's eligibility query filters to `hume_native_enabled = true` sessions only (mirroring
  `sessionQualityEvaluator`'s own `hume_native_enabled` awareness) — this feature never attempts
  extraction for a session that never had a Hume chat at all.
- **A session with `hume_chat_id` set but the chat never actually started on Hume's side (stale
  provisioning failure):** `getHumeSessionDetails()`'s existing `not_eligible_no_hume_ids` /
  `live_fetch_config_deleted` codes surface this; treated as a terminal `'failed'` after retries, not
  an infinite retry loop.

## 10. Out of Scope

- Any user-facing or partner-facing delivery of the extracted data (PDF, email, in-app view, partner
  API) — explicitly excluded per Arun's 2026-07-13 direction. This document ends at a queryable table.
- Fixing `session-quality-evaluator.ts`'s "most-verbose-speaker = Clio" heuristic — a separate,
  smaller, already-named follow-up per `FB-HUME-GROUND-TRUTH-01-elevated.md`, not touched here.
- Any change to `session_insights` (the ice-breaker-response extraction table) — structurally similar
  but a distinct, pre-existing feature; not modified, not merged, not reused beyond taking its schema
  shape as a naming/structure precedent.
- Retroactively backfilling `session_action_items` for every historical session in one bulk pass —
  the backstop sweep will naturally catch every eligible existing session over its first few runs
  (Acceptance Test 8), so no separate one-time backfill script is specified. If Arun wants all
  historical sessions processed immediately rather than over the sweep's natural cadence, that is a
  one-line follow-up (run the sweep's query without the 30-minute-age filter, once) — flagged here as
  available but not built unless requested.

---

## 11. Open Questions

**Q1 (Part A only — the one genuine open question in this document).** RTV-05 is the correct,
already-approved architecture for Part A (Section 4 above) and requires no new design work. But
RTV-05's own rollout-readiness gate — every non-bookend template used by a session individually
Arun-approved via `/dashboard/admin/templates`, plus RTV-03's accuracy evidence meeting its bar — is
not satisfied today (0 of 27 templates approved, per RTV-05's own live-verified numbers at time of
writing). Building/wiring RTV-05 does not make Part A's stated Success Criteria ("the visual advances
based on our own reading of Hume's live transcript... verified by a real test call") true in
production until that gate clears, which is a separate, slower, human-review-driven process with no
committed timeline.

This is a product/risk-tolerance decision, not a technical one, and I cannot resolve it by reading
the CEO brief or the referenced docs — the brief's own P0/"build from scratch" framing suggests Arun
wants this live soon, but RTV-05's gate exists specifically because Arun himself required that no
unapproved template ever renders live (memory note: "Hard gate: no template renders live without
Arun's individual sign-off"), which reads as a deliberate, non-negotiable policy rather than a
temporary inconvenience.

**My recommendation:** honor RTV-05's existing gate as-is — build/activate RTV-05 exactly as already
approved, accept that Part A's live effect is blocked on the template-approval backlog clearing (a
separate, already-tracked piece of work), and treat "Part A ships" as "RTV-05 ships, and Part A is
then automatically true for any session whose templates get approved" rather than building a second,
faster, ungated mechanism that would recreate the exact dual-writer/unapproved-template-display risk
RTV-05's gate was built to prevent.

**RESOLVED 2026-07-13 — answered directly by Arun, not relayed:** "build with the gate." Recommendation
(a) confirmed: build/activate RTV-05 exactly as already approved; no narrower/ungated mechanism.
Part A's live production effect stays correctly gated on the separate per-template approval backlog
clearing — this is accepted as the intended behavior, not a blocker to route around.

**Part B has no open questions.** Every question the Feature Brief posed for Part B (Questions 4, 5,
6, and the 1:1 reasoning in Question 7) is resolved above with cited evidence, not guessed.

## 12. Dependencies

### Part A
- RTV-02 (marker generation), RTV-03 (live tracking), RTV-04 (template approval), RTV-05
  (prefetch/dual-trigger display) — all already built/approved except RTV-05's own code, which is
  approved-but-unbuilt. Building Part A **is** building RTV-05; there is no separate Part A
  implementation task.
- Resolution of Section 11, Q1, before any Part A code is written.

### Part B
- `getHumeSessionDetails()` (`lib/voice/hume-native/session-details.ts`) — existing, reused verbatim.
- `writeAuditEvent()` / the existing `chat_ended` webhook handler (`app/api/webhooks/hume/route.ts`)
  — existing, extended by one `inngest.send()` call.
- `HUME_API_KEY`, `ANTHROPIC_API_KEY` — both already provisioned (real or placeholder-mocked) elsewhere
  in this codebase; no new secret required.
- New migration (Section 6.2) must land before the Inngest function or cron sweep can run.
