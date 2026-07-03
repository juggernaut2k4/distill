# AUTOGEN-01 — Autonomous Plan/Session Generation & Verified Minute Billing
# Requirement Document

Version: 1.1
Status: **CEO-APPROVED — 2026-07-02.** All Section 11 open questions resolved by Arun. Document is complete and internally consistent. This approval authorizes the spec only — Arun gives separate final go-ahead before Developer/QA agents begin implementation.
Author: Business Analyst Agent
Date: 2026-07-02

Supersedes: PIPE-01 (two duplicate content pipelines) — resolved in Part B below.

---

## Scope

This document covers four interdependent parts that ship together:

| Part | Area |
|---|---|
| A | Early, unapproved background generation: topics → sessions/titles → Session 1 content, cron for the rest |
| B | Plan screen changes: remove duration selector, PIPE-01 pipeline consolidation |
| C | On-demand "jump the queue" generation with per-section progress UI |
| D | Verified-minute billing: speak-readiness-gated timer + detailed audit log |

---

## 1. Purpose

Two production-affecting problems, both stemming from the same root cause — the system treats "plan approval" as the trigger for work that should already be happening in the background:

1. **Generation is needlessly sequential and approval-gated.** Today only Session 1's content pre-generates before approval (via the legacy `session-content-async.ts` pipeline, kicked off from `session-designer-auto.ts`). Sessions 2–N only start generating at `POST /api/plan/approve`. Users who approve a plan then sit and wait for content that should have already been building. Two parallel content-generation code paths exist (`session-content-pipeline.ts`, canonical/atomic-with-QA, vs. `session-content-async.ts`, self-documented as legacy) doing overlapping, divergent work — this is PIPE-01, unresolved until now.

2. **Minute billing is not defensible.** The billing clock starts at `POST /api/sessions/[id]/start`, fired the instant the Recall.ai bot joins the meeting — with zero check that Clio's voice connection is actually able to speak. `POST /api/sessions/[id]/end` computes minutes as a single `Date.now() - started_at` subtraction with no intermediate record. If a user disputes a charge, there is no audit trail to show them. Arun has stated explicitly and repeatedly that the billing-start trigger must be voice-speak-verification (a 200-equivalent status on the voice connection), not bot-join or screen-share-start — and today's implementation does neither the right trigger nor keeps the right records.

This redesign makes "topic selection complete" the trigger for autonomous generation (no approval required for topics, session titles, or Session 1 content), narrows the plan/schedule screen to day/time selection only, retires the duplicate pipeline, and replaces the minute-timer with a speak-readiness-gated, fully audited system.

---

## 2. User Story

**Story 1 — Learner immediately after topic selection**
As a user who just finished selecting topics and paid,
I want my learning plan and first session's content to already be generating the moment I move past topic selection,
So that I am not stuck waiting on an approval screen before anything starts.

**Story 2 — Learner reviewing their plan**
As a user reviewing my generated plan,
I want to set only which days and what time I want sessions, since duration was already fixed during onboarding,
So that I am not asked to re-decide something I already answered.

**Story 3 — Learner opening the sessions list**
As a user who has approved my plan,
I want to see which sessions are ready to start right now and which are still generating,
So that I know what I can do immediately versus what needs to finish first.

**Story 4 — Learner impatient for a specific not-ready session**
As a user who wants to start a session that isn't ready yet,
I want to click it and trigger it to generate right now, with visible progress,
So that I don't have to wait for its scheduled cron hour.

**Story 5 — System (background cron)**
As the scheduler,
I want to generate one not-yet-ready session's content per hour automatically,
So that all sessions in a plan eventually become ready without the user needing to intervene.

**Story 6 — Learner in a live session**
As a user paying for AI-coach minutes,
I want to only be charged from the moment Clio can actually hear and speak to me,
So that I'm never billed for time spent joining, warming up, or fixing screen-share.

**Story 7 — System (billing dispute resolution)**
As support staff investigating a billing complaint,
I want a timestamped record of exactly when the bot joined, when voice connected, when speak-readiness was verified, any gaps, and when the session ended,
So that I can resolve the dispute with evidence instead of a single opaque total.

---

## 3. Trigger / Entry Point

### Part A — Early generation

- **Trigger 1 (topics):** Fires immediately when the user completes/leaves the topic-selection screen (post-signup/payment), not on any later approval action. Emits the existing curriculum-generation event chain (`clio/plan.generated` → `session-designer-auto.ts`) but the entry point moves earlier — from wherever topic selection currently hands off, not from a subsequent approval click.
- **Trigger 2 (sessions/titles):** Fires as soon as topics exist. Uses `getSessionDuration()` (already resolved from onboarding `learningGoal`) — no new duration input.
- **Trigger 3 (Session 1 content):** Fires immediately after Session 1's title/subtopics are finalized by the session designer (this already exists — `session-designer-auto.ts` step `kickoff-session-1-content`; must be repointed to the canonical pipeline event, see Part B).
- **Trigger 4 (Sessions 2–N content):** Fires via new/adjusted Inngest cron, one not-ready session per hour, per user — **not** at `/api/plan/approve`. Approval no longer triggers content generation at all; it only flips session `status: draft → scheduled` and stamps `scheduled_at`.
- **User state required:** Authenticated (Clerk session). Payment/signup complete. No plan approval required for any of Triggers 1–4.

### Part B — Plan screen

- **Trigger:** User lands on `app/dashboard/schedule-setup` (or successor screen) after generation has already produced session titles.
- **Removed:** the `duration` state/selector (currently `15 | 30` in `ScheduleSetupClient.tsx`) is deleted entirely. Screen only collects `selectedDays` and time-of-day (hour/minute/ampm).

### Part C — Jump the queue

- **Trigger:** User clicks a session card marked "not ready" in the sessions list (post-approval dashboard view).
- **Route:** Existing `POST /api/sessions/[id]/generate-content` is repointed to fire the canonical pipeline event with a `priority: 'immediate'` flag, distinct from the cron's `priority: 'background'`.
- **User state required:** Authenticated, owns the session. Plan approval is **not** required to call `/generate-content` (RESOLVED, Section 11 Q5) — generation must be callable pre-approval per Part A's premise. `/start` and `/meeting-url` **do** require `curriculum_plan.is_approved = true`; `/generate-content` and `/end` do not.

### Part D — Minute billing

- **Trigger 1 (billing start):** Fires when the active voice adapter (ElevenLabs or Hume) emits a verified "speak-ready" signal — NOT on Recall.ai bot-join, NOT on screen-share-start.
- **Trigger 2 (billing end):** Fires on explicit "End Session" or forced timeout, same as today's `/api/sessions/[id]/end`, but minute calculation now reads from the audit log's speak-ready timestamp, not `session.started_at`.
- **User state required:** Authenticated, owns the session, sufficient `minutes_balance`.

---

## 4. Preconditions

- Part A requires the existing curriculum-plan generation flow (`curriculum-generator.ts` → `clio/plan.generated`) to remain functionally unchanged in its LLM logic — only the *timing* of invocation moves earlier (before/without approval).
- Part B requires `getSessionDuration()` in `lib/curriculum/session-designer.ts` to remain the single source of truth for duration; no other code path may read or write a per-session or per-plan duration override during schedule setup.
- Part C requires Part B's pipeline consolidation to be complete first — on-demand generation cannot correctly prioritize a queue that has two competing pipelines writing to `topic_content_cache`.
- Part D requires both `lib/voice/elevenlabs-adapter.ts` and `lib/voice/hume-adapter.ts` to expose a common readiness-callback shape (new work, defined below) before the billing-start hook can be provider-agnostic.

---

## 5. Main Flow

### Part A — Early background generation

1. User finishes topic selection (post-payment). System immediately emits the plan-generation event — no button, no approval screen gates this.
2. Curriculum plan generates (existing LLM logic: profile, intent, prerequisites/dependencies, related-topic clustering — already implemented in `curriculum-generator.ts`/`session-designer.ts`, unchanged).
3. `session-designer-auto.ts` runs immediately once the plan exists: splits arcs into DB sessions, assigns `duration_mins` from the single onboarding-fixed duration, writes `session_title` per session, inserts all sessions as `status: 'draft'`.
4. The moment Session 1's title/subtopics are written, the canonical content pipeline fires for Session 1 only, synchronously-prioritized (`priority: 'high'`).
5. Sessions 2–N do **not** fire immediately. They are left `content_status: 'pending'` and picked up by the new hourly cron (Part A, step 6).
6. A new (or repurposed) Inngest cron function runs hourly per user: selects the single oldest `pending` session (by `session_index`) whose plan's topics are finalized, and fires the canonical content-generation event for it with `priority: 'background'`. One session per hour, per user, regardless of how many are pending. **RESOLVED (Section 11 Q4):** if a user jumps a session ahead of its scheduled slot via Part C, that jumped session consumes that user's next cron slot — the cron's hourly pick simply skips any session already `generating`/`ready` and advances to the next oldest `pending` session. This is not a double-spend: total generation throughput per user stays at one session-start per hour whether triggered by cron or by a jump.
7. None of steps 1–6 require any user click or approval action.

### Part B — Plan/schedule screen

1. User opens the schedule-setup screen. It fetches the already-generated session list (titles already exist per Part A).
2. UI presents only: day-of-week multi-select, hour/minute/AM-PM picker. The existing `duration` state and its buttons are removed from `ScheduleSetupClient.tsx`.
3. On submit, `computeScheduledDates()` continues to use each session's already-assigned `duration_mins` (from generation) purely for display/spacing — it does not accept a new duration value from the user.
4. **PIPE-01 resolution:** `session-content-pipeline.ts` (atomic, QA-checked) becomes the sole content-generation pipeline. `session-content-async.ts` is retired:
   - `session-designer-auto.ts`'s Session-1 kickoff is repointed from emitting `clio/session.content.requested` (legacy) to emitting `distill/session.content.generate` (canonical).
   - `app/api/sessions/[id]/generate-content/route.ts` POST handler is repointed to emit `distill/session.content.generate` instead of creating an `async_jobs` row + `clio/session.content.requested`.
   - The GET handler (status polling) is updated to read progress from whatever mechanism the canonical pipeline now emits (see Part C, progress granularity — open question).
   - `session-content-async.ts` and its unique features (e.g., batch-of-3 parallel subtopic processing) are evaluated: any behavior needed for parity (esp. per-subtopic progress needed by Part C) is ported into the canonical pipeline before the legacy file is deleted.
   - `app/api/plan/approve/route.ts`'s "fire content generation for ALL sessions" block (lines firing `distill/session.content.generate` for every non-ready session at approval time) is removed — replaced by the Part A cron. Approval only flips `draft → scheduled`, stamps `scheduled_at`, updates plan/user approval flags, and sends notifications (unchanged).

### Part C — Jump the queue

1. User opens the post-approval sessions list. Each session card shows `ready` (green, clickable to enter meeting URL) or `not ready` (generating-in-background indicator, clickable to jump queue).
2. Clicking a not-ready session calls `POST /api/sessions/[id]/generate-content` with the session's ID. The route verifies ownership (not plan approval — RESOLVED, Section 11 Q5: generate-content is approval-independent), then fires `distill/session.content.generate` with `priority: 'immediate'`.
3. The canonical pipeline, on `priority: 'immediate'`, processes this session's subtopics ahead of anything the hourly cron would otherwise pick up next (queue-jump, not a parallel/duplicate hourly run).
4. UI polls the (updated) GET status endpoint and renders a spinner with one row per subtopic/section; each row flips to a green checkmark as its `topic_content_cache` row reaches `pipeline_status: 'ready'`.
5. Once all sections for that session are ready, `content_status: 'ready'` is set on the session row; the UI unlocks the meeting-URL entry field automatically (no page reload required — polling-driven).

### Part D — Verified minute billing

1. Recall.ai bot joins the meeting (existing behavior — `POST /api/sessions/[id]/start` still marks session `active`, but no longer starts the billing clock).
2. Clio warms up and fixes page/screen resolution, then begins screen-share (existing behavior, unchanged sequencing) — none of this is billed yet.
3. The active voice adapter (ElevenLabs or Hume) attempts to establish the voice connection. Each adapter now exposes a uniform callback — e.g. `onSpeakVerified(callback)` — fired only when the adapter has confirmed Clio can actually produce audio (ElevenLabs: verified `isOpen()` transition; Hume: verified transition confirmed by both `onConnect` firing AND the first successful `assistant_message`/speaking-mode event, not `onConnect` alone).
4. The moment `onSpeakVerified` fires, the system writes an audit-log row (`event_type: 'speak_verified'`, timestamp) and this timestamp becomes the billing-start instant, replacing today's `session.started_at` bot-join timestamp for billing purposes.
5. Throughout the session, any detected disconnect/reconnect on the voice channel writes `gap_start` / `gap_end` audit rows.
6. On session end (manual "End Session" or forced timeout), an audit row `disconnected` is written. Minutes billed = (disconnected_at − speak_verified_at) − sum(gap durations), rounded up to the nearest minute per existing convention, capped at `minutes_balance` as today.
7. `deduct_minutes()` RPC is called with the corrected minute count. `session.duration_mins` continues to be overwritten with actual minutes used (existing behavior), sourced now from the audit log instead of raw elapsed wall-clock time.

---

## 6. Alternate / Edge Case Flows

**A1 — Topic generation fails or times out.** System retries per existing Inngest retry policy (`retries: 3` on `session-designer-auto`, `retries: 2` on canonical pipeline). If it exhausts retries, existing `sendAdminAlert` on `onFailure` fires. No user-facing approval screen is blocked as a result — the user simply sees "still generating" longer than expected in the sessions list.

**A2 — User reaches the sessions list before Session 1 content finishes.** UI shows Session 1 as not-ready with the same spinner/progress treatment as any other not-ready session (Part C flow applies uniformly — Session 1 gets no special-cased UI, just priority in generation order).

**C1 — User jumps the queue on a session, then the hourly cron independently reaches that same session before the jump completes.** The canonical pipeline must be idempotent per session (it already is, via `content_status`/`pipeline_status` guards) — the cron should skip any session already `generating` or `ready` rather than double-fire.

**D1 — Voice connection never reaches speak-verified (e.g., provider outage).** No billing-start audit row is ever written; if the session times out or is manually ended without ever verifying speak-readiness, zero minutes are billed for that attempt. This must be an explicit, tested code path — not an accidental side effect of `started_at` being null.

**D2 — Gap/reconnect mid-session (e.g., transient WebSocket drop reconnects successfully).** Gap duration is subtracted from the billed total; the user is not charged for the disconnected interval. **RESOLVED (Section 11 Q7): force-end threshold = 30 seconds of continuous gap with no successful reconnect.** Rationale, grounded in the actual reconnect implementation (not a generic default): `lib/voice/hume-adapter.ts` (`MAX_RECONNECT = 3`, exponential backoff 1s → 2s → 4s) exhausts its own retry attempts in ~7 seconds before firing `onError`; `lib/voice/elevenlabs-adapter.ts` has no reconnect logic at all in the current codebase. 30 seconds gives roughly 4x headroom over Hume's own exhaustion window — enough to absorb network jitter or a slightly slower reconnect path — without leaving the bot sitting silently in the meeting for minutes while nothing is billed and Recall.ai bot-cost keeps accruing. Existing T-1min/T force-end Inngest timer logic is extended to also force-end on a 30s+ continuous voice-gap, not just wall-clock session duration.

**D3 — Session ends abnormally (crash, browser close) with no explicit "End Session" call.** The existing server-side Inngest timer (`clio/session.started` → force-end at planned duration) remains the backstop; on forced end, the same audit-log-based calculation applies rather than a raw wall-clock fallback.

---

## 7. Data Model Notes

(Full schema design is engineering/BA-detailed-design scope, not finalized here — flagged explicitly per the Feature Brief's constraint that schema decisions belong downstream of this document. The following are the entities and fields this feature requires to exist; exact table/column names and migration numbering are for the BA's detailed schema pass or an engineering follow-up.)

- New audit table capturing, per session, an ordered sequence of timestamped events: `bot_joined`, `voice_connect_attempt`, `speak_verified` (billing start), `gap_start`, `gap_end`, `disconnected` (billing end). Must record which voice provider was active. Must be queryable per session_id for support/dispute resolution.
- `sessions.content_status` and `topic_content_cache.pipeline_status` remain the generation-readiness source of truth; Part C's progress UI reads granular per-subtopic `pipeline_status` rows already present in `topic_content_cache` — no new generation-status table needed, provided Section 11 Q4 (progress granularity) resolves to per-subtopic rather than finer-grained.
- No new field is needed on `sessions` for duration — `duration_mins` already exists and is set once at generation time from onboarding data.

---

## 8. UI Requirements

### Plan/schedule-setup screen (Part B)
- Remove: duration toggle (`15 | 30` buttons) and its associated state entirely from `ScheduleSetupClient.tsx`.
- Retain: day-of-week multi-select (existing `DAY_LABELS` UI), hour/minute/AM-PM picker (existing).
- No visual redesign beyond removal of the duration control — this is a subtraction, not a restyle.

### Sessions list (Part C)
- Each session card shows one of two states: **Ready** (existing style, clickable → meeting-URL entry) or **Not Ready** (new state: shows a compact status indicator, e.g. "Generating..." or "Not started").
- Clicking a Not-Ready card opens/expands a per-subtopic progress view: a list of the session's subtopics, each with a spinner while pending/generating and a green checkmark when that subtopic's cache row is `pipeline_status: 'ready'`.
- Once every subtopic is checked off, the card auto-transitions to Ready state (poll-driven, no manual refresh needed) and the meeting-URL entry field becomes available.
- Exact visual treatment (colors, iconography, copy) follows existing dark-theme design system (`#111111` surfaces, `#7C3AED`/`#06B6D4` accents per project design system) — no new color tokens introduced.

### Billing / minute breakdown (Part D) — RESOLVED, Section 11 Q2
- **This is user-visible, not internal-only.** Arun confirmed the minute breakdown "should show." The billing page (`app/dashboard/billing/page.tsx` or successor) must include a per-session minute-breakdown view, sourced from the audit log defined in Section 7, showing at minimum: when speak-verification occurred, any excluded gap intervals, and the resulting billed-minutes total for that session.
- Exact layout/copy is not specified here (fewer than 3 lines of description would normally trigger a STOP-and-return-to-BA per governance) — before a developer builds this screen, the BA must produce a short follow-up UI spec (wireframe or explicit line-by-line description) for the minute-breakdown component specifically. This is the one piece of Section 8 that still needs a BA detailing pass — it does not block CEO approval of this document (the *decision* that it must exist and be user-visible is fully resolved), but it does block a developer from building the billing-page UI until that follow-up spec exists.
- The underlying audit-log schema and API to serve it remain BA/engineering detailed-design scope per Section 7 — unaffected by this resolution beyond confirming the data must be exposed to an authenticated end user (not just support/admin tooling).

---

## 9. Acceptance Criteria

### Part A — Early generation
- AC-A1: Topic generation fires within the same request/response cycle (or immediately following, via background event) as topic-selection completion — never gated behind a subsequent "approve" click.
- AC-A2: Session titles exist in the DB before the user reaches any approval screen, for the fast-path case where generation completes before the user navigates there.
- AC-A3: Session 1's `content_status` reaches `'ready'` without any approval action having occurred.
- AC-A4: Sessions 2–N each transition from `pending` to `generating` to `ready` at a rate of exactly one session-start per hour per user via cron, confirmed by Inngest run logs showing hourly cadence.
- AC-A5: `POST /api/plan/approve` no longer fires any `distill/session.content.generate` events — confirmed by code removal and by an integration test asserting no such event is sent from that route.

### Part B — Plan screen / PIPE-01
- AC-B1: `ScheduleSetupClient.tsx` contains no duration-selection UI or state; TypeScript compiles clean with the removal.
- AC-B2: Only one file in the codebase defines a content-generation Inngest function that writes to `topic_content_cache` — `session-content-async.ts` is deleted (or reduced to a thin deprecated re-export with no runtime registration).
- AC-B3: All prior call sites of the legacy pipeline (`session-designer-auto.ts`, `app/api/sessions/[id]/generate-content/route.ts`) are confirmed (via grep/build) to reference only the canonical event.

### Part C — Jump the queue
- AC-C1: Clicking a not-ready session triggers generation for that session ahead of the hourly cron — verified by an immediate `content_status: 'generating'` transition and Inngest run firing within seconds, not waiting for the next hourly tick.
- AC-C2: The progress UI shows one row per subtopic and each row's checkmark state matches that subtopic's live `pipeline_status` in `topic_content_cache` — verified by polling assertions in a test that generation of subtopic N flips only row N.
- AC-C3: The meeting-URL entry field is disabled/hidden until `content_status: 'ready'`, and becomes available automatically (no manual refresh) within one polling interval of readiness.
- AC-C4: No double-generation occurs if the hourly cron and a queue-jump target the same session concurrently (idempotency guard verified by test).

### Part D — Minute billing (P0 — precise criteria required)
- AC-D1: No audit-log row of type `speak_verified` is ever written before the active voice adapter has confirmed a successful, verified connection capable of producing audio — bot-join and screen-share-start events must NOT trigger this row.
- AC-D2: `minutes_balance` deduction, computed at session end, is mathematically derived solely from `(disconnected_at − speak_verified_at) − Σ(gap durations)`, never from `started_at` (bot-join time) or any other earlier timestamp.
- AC-D3: If a session ends (manually or via forced timeout) without ever reaching `speak_verified`, zero minutes are deducted from `minutes_balance` — verified by a test simulating a voice-connection failure.
- AC-D4: Every session that reaches `speak_verified` produces a complete, ordered audit trail containing at minimum: `bot_joined`, `speak_verified`, and `disconnected` events, each with a timestamp and the active voice provider recorded — queryable by `session_id`.
- AC-D5: The billing-start mechanism behaves identically in outcome (though not necessarily identical underlying signal) for both ElevenLabs and Hume — verified by a test exercising both adapters and asserting both produce a `speak_verified` audit row only after their respective real readiness signal, never earlier.
- AC-D6: Any voice-connection gap (disconnect + reconnect) mid-session is excluded from billed minutes — verified by a test simulating a gap and asserting the deducted minute count subtracts the gap duration.
- AC-D7: The audit log is immutable/append-only in practice (no update/delete path exposed to application code other than the defined event-writers) — this is what makes it dispute-defensible.
- AC-D8: A voice-connection gap that persists 30 continuous seconds without a successful reconnect force-ends the session — verified by a test simulating a 30s+ gap and asserting the session is force-ended and billing stops accruing beyond the gap start.
- AC-D9: The user-facing minute-breakdown view (Section 8) renders directly from the audit log — no separately-maintained summary field — verified by a test asserting the displayed breakdown matches the audit log's computed billed minutes for a session with at least one gap.

---

## 10. Out of Scope

- A raw, event-by-event audit-log viewer for end users (e.g., a literal timestamped event table) — RESOLVED (Section 11 Q2): the audit log itself stays internal/support tooling. What IS in scope and user-facing is a summarized per-session minute-breakdown view derived from that log (see Section 8, "Billing / minute breakdown"). The distinction: users see a readable summary, not the raw audit trail.
- Refund/credit workflows triggered by billing disputes — this feature only ensures the data exists to support such a workflow; the workflow itself is not built here.
- Changes to the underlying curriculum-generation LLM logic (topic/prerequisite/relatedness reasoning) — only the *timing* of invocation changes, not the reasoning itself.
- Any new voice provider beyond ElevenLabs and Hume.
- Redesigning the visual style of the plan/schedule or sessions-list screens beyond the specific additions/removals described above.

---

## 11. Open Questions — RESOLVED

All seven questions below were open pending Arun's decision. Arun has answered all seven (2026-07-02). None remain blocking. Each resolution is also reflected inline in the relevant section (cross-referenced below).

1. **Literal meaning of "200 status code" for billing-start.** **RESOLVED — interpretation (b) approved.** Engineering treats each voice provider's own semantically-equivalent "confirmed ready to speak" signal as the trigger (ElevenLabs' verified `isOpen()` transition; Hume's `onConnect` + first `assistant_message`/speaking-mode event) — not a literal HTTP 200 check. Reflected in Section 5 Part D step 3 and AC-D1/AC-D5 (unchanged from draft — draft language already matched this interpretation).

2. **Audit log — user-visible or internal-only?** **RESOLVED — YES, user-visible.** Arun: "it should show." A summarized per-session minute-breakdown view is now in scope on the billing page, sourced from the audit log. The raw audit-log event table remains internal/support-only. Reflected in Section 8 (new "Billing / minute breakdown" subsection), Section 9 (new AC-D9), and Section 10 (out-of-scope language corrected to distinguish raw log vs. summarized view). Note: the exact layout of this new UI element still needs a short BA follow-up spec before a developer builds it (see Section 8) — this is a scoped, non-blocking follow-up, not an open product question.

3. **Progress-UI granularity for "jump the queue."** **RESOLVED as recommended — per-subtopic.** One checkmark per subtopic/section (`topic_content_cache.pipeline_status`), not a finer per-generation-step breakdown. No document changes needed — draft language in Sections 5, 7, 8, 9 already specified this granularity as the working assumption; it's now final, not provisional.

4. **Cron-vs-jump interaction.** **RESOLVED as recommended — a jump consumes that user's next cron slot.** No double-spend of generation capacity: total throughput stays one session-start/hour/user whether triggered by cron or a queue-jump. Reflected in Section 5 Part A step 6.

5. **Exact route-gating for plan-approval.** **RESOLVED as recommended.** `/start` and `/meeting-url` require `curriculum_plan.is_approved = true`. `/generate-content` does NOT require approval (Part A's premise depends on pre-approval generation). Reflected in Section 3 Part C and Section 5 Part C step 2.

6. **Existing users / in-flight plans — migration needed?** **RESOLVED — no migration or backfill task is in scope.** Arun: "no need i will clear all kb content and test it out." Arun will manually clear existing KB/content data and test fresh plans against the new model himself. **AUTOGEN-01 applies prospectively only** — to plans/sessions created after this feature ships. No data-migration, backfill, or dual-write compatibility task exists anywhere in this document's scope.

7. **Gap-duration force-end threshold (Edge Case D2).** **RESOLVED — 30 seconds.** Grounded in the actual reconnect implementation rather than an arbitrary number: `lib/voice/hume-adapter.ts` exhausts its 3-attempt exponential backoff (1s → 2s → 4s) in ~7 seconds; `lib/voice/elevenlabs-adapter.ts` has no reconnect logic at all today. 30 seconds gives ~4x headroom over Hume's own exhaustion window for jitter/slower reconnects, while bounding unbilled bot-idle time and Recall.ai bot-cost exposure. (Note: this document's earlier working assumption cited a much longer ~60–90s figure reasoned from generic reconnect-timer conventions; that figure did not match the actual code and has been superseded by the 30s figure above, which is grounded in the real `MAX_RECONNECT`/backoff constants.) Reflected in Section 6 Edge Case D2 and new AC-D8.

**Document status:** Section 11 is fully resolved. No vague or unquantified acceptance criteria remain. Scope is appropriate — neither over- nor under-built relative to the four Parts defined. One small, explicitly-scoped follow-up (Q2's UI layout spec) is flagged and does not block this document's approval; it blocks only the specific downstream billing-page UI task until the BA produces that follow-up.
