# Requirement Document: HUME-NATIVE-01 — Hume-Native LLM Live Session Architecture

**From:** Business Analyst Agent · **To:** CEO Agent (for approval) · **Priority:** P1 · **Date:** 2026-07-04
**Source:** `docs/specs/HUME-NATIVE-01-feature-brief.md` + `docs/brainstorm/ATTENDEE-HUME-ARCHITECTURE-brainstorm.md`
**Status:** DRAFT — pending CEO review. Section 11 (Open Questions) is empty per gate requirement.

---

## 1. Summary

Trial a second live-session brain architecture, toggle-gated and fully isolated from the
production LIVE-01 Custom-LLM-bridge path. When the new toggle is ON, a session's Hume EVI Config
is provisioned with its Language Model switched from Custom (our bridge) to Hume's own native/
supplemental LLM, carrying a single, mostly-static upfront prompt (behavior rules + full user
profile/intent context + full session content). From connection onward, Hume runs the entire
conversation with no per-turn steering from our code. Our own system independently watches the
live transcript to decide visual transitions (replacing reliance on Hume self-reporting), captures
a snapshot at each transition, and emails a compiled PDF at session end. After the call ends, a
batch job pulls the full transcript from Hume's Chat History API and extracts action items/glitches
via Claude. This is an explicit trial with two flagged technical unknowns to be resolved by a live
test call before broader use; toggle OFF (default) leaves LIVE-01 and current production Attendee+
Hume behavior completely untouched.

---

## 2. Goals / Non-Goals

### Goals
- Provide a toggle (`NEXT_PUBLIC_HUME_NATIVE_ENABLED`) that, when ON, provisions a session's Hume
  Config in native/supplemental LLM mode instead of Custom LLM mode.
- Assemble a versioned, mostly-static (>80% fixed) prompt template with `[CONTEXT]` and
  `[SESSION CONTENT]` placeholders, populated from existing, untrimmed data
  (`buildProfileContextForClio()`, `ice-breaker-analyzer` intent signals, existing whole-topic +
  tab-content generation from LIVE-01).
- Push the assembled prompt to Hume via `POST /v0/evi/configs` / `.../configs/{id}/versions` ahead
  of call-start for scheduled sessions, or at call-start for immediate sessions.
- Build a transcript-watching module that independently decides visual transitions without adding
  perceptible lag to Hume's responses.
- Capture a snapshot at each visual transition; compile all snapshots into a single PDF at session
  end; email it via Resend.
- Capture and store `chat_id` on `sessions`; build a post-session batch job (Inngest) that pulls
  the full transcript via Hume's Chat History API and extracts action items + glitches via Claude.
- Run one real, live test call to resolve the two flagged unknowns (prompt size acceptance; tool-
  call reliability under native LLM) and report results in a form Arun can act on.
- Full isolation: toggle OFF leaves LIVE-01 and current production Attendee+Hume (Custom LLM mode)
  completely unaffected — new modules, not inline branches sharing refs/state.

### Non-Goals (explicitly out of scope, per feature brief)
- No new user profile fields or data collection.
- No mid-call context injection mechanism (design is upfront-only, by decision, not investigation).
- No changes to Recall.ai or ElevenLabs code, infrastructure, or removal work.
- No rebuild of the stuck-tab/forced-advance backstop (`NUDGE_AT_TURN`/`FORCE_AT_TURN`) — the
  transcript-watching visualization module is the replacement mechanism, not a forced-advance
  backstop, and does not attempt to nudge Hume's own conversational pacing.
- No final go/no-go decision on Hume-native vs. Custom-LLM-bridge — that is Arun's decision after
  the live test call.
- No changes to topic selection, curriculum/plan generation, billing, or any part of the product
  not named here.

---

## 3. Users & Use Cases

- **Primary user:** Arun, running one live test call personally to evaluate the architecture.
- **Use case 1 (spike/validation):** Arun (or a test account) starts an immediate session with the
  toggle ON. System provisions a native-mode Hume Config with the assembled prompt, joins via
  Attendee, and the session runs entirely on Hume's own LLM. Arun observes conversation quality,
  visual transition timing, and whether tool calls fire correctly.
- **Use case 2 (scheduled session):** A session scheduled ahead of time has its prompt assembled
  and pushed to Hume's Config API before the meeting starts (toggle ON), so Hume is ready with full
  context the moment the bot joins.
- **Use case 3 (post-session review):** After any Hume-native session ends, a batch job pulls the
  transcript, extracts action items/glitches, and a PDF of visual snapshots is emailed to the user.
- **Use case 4 (toggle OFF):** Any session run with the toggle OFF behaves exactly as LIVE-01/
  production does today — unaffected by any code shipped in this spec.

---

## 4. Detailed Requirements

### 4.1 Toggle

- **Name:** `NEXT_PUBLIC_HUME_NATIVE_ENABLED` (boolean env var, matches `NEXT_PUBLIC_LIVE_CONDUCTOR_
  ENABLED` naming convention from LIVE-01). Default unset/`false`.
- **Branch point:** The toggle must be read at the point where a session's Hume Config is selected/
  provisioned — logically alongside (not inside) the LIVE-01 toggle check, in
  `app/dashboard/walkthrough/WalkthroughClient.tsx`'s session-start path, and in the
  scheduled-session prompt-push job. It must NOT branch only at the transport/adapter layer (that
  is the mistake explicitly flagged against the existing `NEXT_PUBLIC_VOICE_PROVIDER` toggle in the
  LIVE-01 brief).
- **Isolation requirement (hard, non-negotiable, per LIVE-01 precedent):** All new logic — Config
  provisioning, prompt assembly, transcript-watching, snapshot/PDF, post-session extraction — lives
  in new, standalone module(s) under `lib/voice/hume-native/` (new directory), invoked
  conditionally from the existing orchestration code. No shared refs, no duplicated ~70-line logic
  blocks copy-pasted between the native and Custom-LLM branches. If a helper is genuinely identical
  in both modes (e.g. reading the user profile), it is extracted into a shared, already-existing
  function and called from both — not duplicated.
- **Toggle OFF guarantee:** When OFF, none of the new modules are imported into the hot path in a
  way that could throw or change behavior — a dynamic/conditional require or an early-return guard
  at the top of each new module's entry point, so LIVE-01 and current production Attendee+Hume
  (Custom LLM) are provably unaffected even if this code has a bug.

### 4.2 Prompt Template Assembly

- **File:** `lib/voice/hume-native/prompt-template.ts` (new).
- **Structure:** A single exported constant `HUME_NATIVE_PROMPT_TEMPLATE` (versioned via a
  `PROMPT_TEMPLATE_VERSION` string constant, e.g. `'v1'`, bumped on any structural edit — not
  auto-generated, manually incremented by whoever edits the template).
- **Placeholder tags (exact list, bracketed, uppercase, unique strings for safe find-and-replace):**
  - `[CONTEXT]` — replaced with the full output of `buildProfileContextForClio()` (untrimmed)
    concatenated with the full detected-intent block (see 4.2.1 below).
  - `[SESSION CONTENT]` — replaced with the existing whole-topic background + full set of per-tab
    content already generated under LIVE-01's two-layer content pipeline
    (`lib/content/session-content-generator.ts`), concatenated in tab order. No new content
    generation call — reuse exactly what LIVE-01 produces.
- **Fixed portion (>80% of template, non-negotiable per brief):** behavior rules, tone, structure —
  drafted new for this spec (not copy of the LIVE-01 "Clio behavior" fragment, since that fragment
  assumes per-turn tool-steering from our bridge; this one must instruct Hume to self-pace,
  self-decide when to advance, and independently invoke `show_visual`/`advance_tab`/`end_session`
  tools without external prompting). Exact prompt copy is a build-time authoring task, not
  something this document freezes verbatim — the requirement is the >80% fixed / <20% variable
  ratio, the placeholder mechanism, and that the fixed portion explicitly instructs Hume to self-
  drive transitions and tool calls.
- **Assembly function:** `assembleHumeNativePrompt(input: { profileContext: string; intentContext:
  string; sessionContent: string }): string` — pure string replacement, no LLM call.
- **4.2.1 — Intent context sub-block:** A new small serializer, `buildIntentContextForHumeNative()`,
  reads the same fields `ice-breaker-analyzer.ts` already writes into `user_learning_profiles`
  (`learning_motivation`, `business_focus_lens`) and the `session_insights.extracted_signals` JSON
  (`learning_intent`, `knowledge_level`, `organizational_context`, `urgency`, `primary_driver`) for
  the user's most recent `session_insights` row, and renders them as a short labeled text block
  (mirroring the style of `buildProfileContextForClio()`). If no `session_insights` row exists yet
  (first-ever session, ice-breaker not yet run), this block is omitted entirely — not padded with
  placeholder text — and the fixed template must read sensibly with it absent.
- **Size discipline:** No pre-emptive trimming. The assembled prompt is pushed at full/normal size
  as the real test (see Section 4.6 — Validation Spike). If Hume's Config save or session behavior
  indicates a real limit, the fallback is documented in 4.6; until proven otherwise, full size is
  the standard.

### 4.3 Hume Config Provisioning

- **File:** `lib/voice/hume-native/config-provisioner.ts` (new).
- **Function:** `provisionNativeConfig(params: { sessionId: string; assembledPrompt: string })
  => Promise<{ configId: string }>`.
- **Mechanism:** `POST https://api.hume.ai/v0/evi/configs` (create) or
  `POST https://api.hume.ai/v0/evi/configs/{id}/versions` (new version of an existing config) via
  `HUME_API_KEY` (existing env var, already used by `app/api/hume-token/route.ts` and
  `app/api/debug/hume-chat/route.ts` — same auth header pattern: `X-Hume-Api-Key`).
  - Body sets `language_model` to Hume's native/supplemental option (not `CUSTOM_LANGUAGE_MODEL`)
    per Hume's Config API schema, and sets the system prompt field to the assembled prompt string.
  - One Hume Config per session is created fresh (not reused across sessions) to avoid stale-prompt
    bleed between users; the returned `configId` is what the client passes into `HumeAdapter`'s
    existing `configId` field at connect time (see 4.4) — no change needed to `HumeAdapter`'s
    connection URL construction, since it already takes `configId` as a parameter.
  - Tool definitions (`show_visual`, `advance_tab`, `end_session`) are attached to the Config exactly
    as documented for CLM mode today (same wire-protocol `tool_call`/`tool_response` pattern per the
    brainstorm's confirmed finding) — no new tool schema.
- **Error handling:** If the Config create/version call fails (non-2xx), the caller must NOT fall
  back to Custom-LLM mode silently (that would violate "no fallback/routing-around Attendee+Hume");
  instead the session start is blocked with a clear error surfaced to the initiating user/admin, and
  the failure is logged with the Hume API's response body (no secrets logged). This is a hard
  failure, not a soft degrade, because this is an explicit trial — silent fallback would corrupt the
  test.
- **Scheduled sessions:** the existing session-scheduling job (wherever a scheduled session's
  start time is known ahead of call time — to be confirmed against the scheduler's existing job
  file during implementation) calls `provisionNativeConfig()` ahead of the meeting time when the
  toggle is ON for that session, storing the returned `configId` on the session row (new column,
  see 4.5) so call-start just reads it rather than re-provisioning.

### 4.4 Client-Side Wiring

- `WalkthroughClient.tsx`: when `NEXT_PUBLIC_HUME_NATIVE_ENABLED` is true for a session, the
  client-side connect path calls a new server route (e.g. `app/api/hume-native/provision-config/
  route.ts`, new) to obtain the `configId` (or reads a pre-provisioned one from the session row for
  scheduled sessions), then passes that `configId` into `HumeAdapter.create()` exactly as today —
  `HumeAdapter` itself requires no code change, since Config-mode selection lives entirely upstream
  of it (this is the isolation boundary: `hume-adapter.ts` stays untouched).
  - Per the isolation requirement (4.1), this wiring is a small, clearly-commented conditional block
    at session-start, not an inline restructuring of the existing 
    `WalkthroughClient.tsx` orchestration function.

### 4.5 Schema Changes

- **Migration (new):** `supabase/migrations/0XX_hume_native_session_fields.sql`
  ```sql
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hume_chat_id TEXT;
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hume_native_config_id TEXT;
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hume_native_enabled BOOLEAN NOT NULL DEFAULT false;
  CREATE INDEX IF NOT EXISTS idx_sessions_hume_chat_id ON sessions(hume_chat_id) WHERE hume_chat_id IS NOT NULL;
  ```
  - `hume_chat_id`: captured from the existing `onConnect(sessionId)` callback in `hume-adapter.ts`
    (the `chat_id` from the `chat_metadata` event, line 133) — this callback already fires; the only
    change is that the caller now also persists it to `sessions.hume_chat_id` (one additional
    Supabase update call at the existing `onConnect` call site in `WalkthroughClient.tsx`, gated so
    it only runs when `hume_native_enabled` is true for that session — no behavior change for
    Custom-LLM-mode sessions, which don't need this field).
  - `hume_native_config_id`: set when `provisionNativeConfig()` succeeds; used by scheduled-session
    pre-provisioning to avoid re-provisioning at call time.
  - `hume_native_enabled`: per-session flag recording whether this specific session ran in native
    mode (distinct from the global env toggle — this is what post-session jobs and audit queries
    check, so a toggle flip mid-rollout doesn't misclassify historical sessions).
- **No other schema changes.** `session_insights` and `user_learning_profiles` are read-only for
  this feature (per 4.2.1) — no new columns needed there.

### 4.6 Validation Spike (mandatory, precedes full build usage)

Per the feature brief's explicit instruction, the two flagged unknowns must be resolved by an
actual test call, framed as an early phase:

**Spike scope:** the minimum plumbing to run one real call — toggle, Config provisioning (4.3),
prompt assembly (4.2), client wiring (4.4) — run against a single real test session before any
polish work on 4.7 (visualization tracking) or 4.8 (post-session extraction) is considered complete-
and-shippable (those modules can be built in parallel but are validated against spike results).

**Unknown 1 — Does Hume accept the full prompt at normal/production size?**
- **Definition of "accept":** (a) the `POST /v0/evi/configs` (or `.../versions`) call returns 2xx
  with a valid `config_id`; (b) a call started against that `config_id` actually connects
  (`chat_metadata` received, matching today's connect success signal already used by `HumeAdapter`);
  (c) Hume's responses during the call are coherent and on-topic (qualitative judgment by Arun
  during the test call, not automatable).
- **Pass:** all three (a)-(c) hold at full/normal size (behavior rules + full context + full profile
  + full session content combined, no trimming).
  **Result: full size becomes the standing ceiling — no further size-testing work needed.**
- **Fail path:** if (a) fails, capture and log Hume's exact error response (size limit, validation
  error, or other) — this defines the real ceiling. If (a) succeeds but (b) or (c) fail (call won't
  start, or responses are incoherent/degraded), that is also logged as a fail with the specific
  symptom. In either fail case: the required next step is trimming — first drop the intent context
  sub-block (4.2.1, lowest-priority per brief's own data-preservation ranking of full-profile > full-
  content > intent, since profile+content are named as unconditionally full in the brief), re-test;
  if still failing, this is escalated to Arun as a technical unknown that blocks proceeding, per the
  brief's explicit "we give up if absolutely no way to make this work."

**Unknown 2 — Does Hume's own LLM reliably fire visualization tool calls with no per-turn steering?**
- **Definition of pass/fail test:** during the one test call, the tester (Arun) follows the
  session's known tab structure and observes whether `show_visual`/`advance_tab`-equivalent tool
  calls fire at each natural tab boundary, without any message sent from our side during the call
  (confirming true native-mode autonomy).
- **Pass:** tool calls fire at all (or nearly all — brief allows "a few seconds of timing slack",
  which is about timing, not about whether the call fires at all) expected transition points across
  the test call, with no manual nudge required.
- **Fail:** one or more expected transitions never trigger a tool call. Per the brief, the fallback
  is explicitly NOT to rebuild the stuck-tab/forced-advance backstop (out of scope) — a fail here
  means the feature stays toggle-gated indefinitely (not shipped beyond the trial), and a note is
  logged in `BACKLOG.md` that a lighter-weight nudge mechanism could be explored in a future spec,
  per the brief's own suggestion. This build does not attempt to build that nudge mechanism now.

**Spike sign-off:** After the test call, a short written result (pass/fail per unknown, with the
specific evidence — Config response, tool-call log, qualitative note) is added to this document's
history (or a follow-up note in `BACKLOG.md`) so Arun has first-hand evidence to decide continue-
vs-revert, per the brief's stated success criterion. This decision itself is explicitly out of
scope for this spec to predetermine.

### 4.7 Visualization: Transcript-Watching + Snapshot + PDF Export

- **File:** `lib/voice/hume-native/transcript-visual-tracker.ts` (new).
- **Mechanism:** subscribes to the same `onMessage(text, source)` stream `HumeAdapter` already
  emits for every `assistant_message`/`user_message` event (no new Hume-side subscription needed —
  this is purely a consumer of data already flowing through the existing adapter callback). Runs a
  lightweight, non-blocking heuristic (e.g. a fast keyword/semantic-boundary check, or a cheap
  async Claude call fired off without awaiting the response inline) to judge when Clio appears to
  be wrapping up a section.
- **Non-negotiable performance constraint:** this tracking must run asynchronously relative to the
  audio pipeline — it must never block or delay `HumeAdapter`'s `onMessage`/`handleMessage`
  processing, audio queueing, or tool-response round-trip. Implementation must fire tracking logic
  in a non-blocking manner (e.g. `void trackTranscript(...)` fire-and-forget, or a queued
  microtask) so a slow tracking call cannot add lag to Hume's responsiveness. This is tested during
  the spike call by ear (does Clio sound laggy) — no formal automated latency test is required for
  this trial phase.
- **Timing tolerance:** a few seconds of slack either way in when a snapshot/transition decision
  fires is explicitly acceptable per the brief — this is not a hard real-time requirement.
- **Snapshot trigger:** the exact moment our tracker independently decides to move off a visual
  (i.e., the moment it would have triggered the next `advance_tab` in a non-native architecture, or
  observes Hume's own `advance_tab` tool call firing) is the trigger to capture a snapshot of the
  visual currently on screen.
- **Capture method:** reuse the existing shared-webpage rendering surface (same page Attendee's
  browser-mode bot already screen-shares, per LIVE-01's confirmed "no new rendering technology"
  constraint) — capture via a headless screenshot of the current visual's DOM region (e.g. Puppeteer/
  Playwright screenshot of the Attendee browser session's page, or a client-side canvas/DOM-to-image
  capture triggered by the tracker, whichever the existing Attendee browser-mode infrastructure
  supports without new video/rendering tech). Exact capture library choice must come from the
  approved list (no new dependency without justification) — if an existing screenshot utility isn't
  already present in the codebase, canvas-based capture via existing DOM APIs is the fallback,
  avoiding a new package.
- **Storage:** captured snapshots are stored as image files, keyed by `session_id` + sequence index,
  in Supabase Storage (existing infrastructure, official `@supabase/supabase-js` client — no new
  package) under a new bucket or path convention (e.g. `session-snapshots/{session_id}/{index}.png`).
- **PDF assembly trigger:** at session end (the same `end_session` tool-call event / `onDisconnect`
  path already wired in `HumeAdapter`), a job (Inngest, matching the existing async-job convention
  used elsewhere in this codebase) fetches all snapshots for that `session_id`, assembles them into
  a single PDF (one snapshot per page, in transition order) using an approved library — `pdf-lib` is
  NOT on the approved list; this requires either (a) using a package already present in the repo for
  PDF generation if one exists, or (b) explicit approval-list justification added as a code comment
  per the CLAUDE.md library rule, since no PDF-generation library appears on the current approved
  list. **Flagged for CEO/BA confirmation at build time** — resolved as: use whichever PDF library
  the codebase already depends on for any existing PDF need (checked at implementation time); if
  none exists, add one official/high-download package with the required code-comment justification,
  per the standing library-approval process — this is a technical, not product, decision and does
  not block spec approval.
- **Email delivery:** reuses the existing Resend integration (`lib/delivery/email.ts`) — a new
  function `sendSessionVisualsEmail(user, pdfBuffer, sessionId)` following the existing pattern of
  every other function in that file (returns `{ success, error? }`, uses the existing Resend client
  init, follows the same subject/template conventions as `sendSessionAgendaEmail` or similar).
- **Trigger point:** fired by the same post-session Inngest job that assembles the PDF, immediately
  after successful assembly — not on a separate schedule.

### 4.8 Post-Session Transcript Extraction (Action Items + Glitches)

- **File:** `inngest/hume-native-transcript-extractor.ts` (new), modeled directly on the existing
  `analyzeIceBreakerResponse` function pattern in `inngest/ice-breaker-analyzer.ts` (step-based,
  non-fatal failure handling, placeholder-key mock path).
- **Trigger:** event-driven at session end (e.g. `distill/session.hume-native.ended`, emitted from
  the same call-end path that fires `end_session` handling in `WalkthroughClient.tsx` / the Config's
  tool wiring), NOT cron/batch as the primary path — however, per Arun's explicit statement that
  "even a nightly batch is acceptable," a secondary safety-net cron job (e.g. daily, sweeping any
  `sessions` rows where `hume_native_enabled = true AND hume_chat_id IS NOT NULL AND
  action_items_extracted_at IS NULL`) is included as a catch-all for missed/failed event triggers.
  This mirrors the "batch/cron across a day's sessions is explicitly acceptable" language in the
  brief while keeping the primary path event-driven for lower latency.
- **Step 1:** `GET https://api.hume.ai/v0/evi/chats/{chat_id}/events` (confirmed working today via
  the existing debug endpoint `app/api/debug/hume-chat/route.ts`) using the session's stored
  `hume_chat_id`. Paginate if `page_size` truncates (existing debug endpoint uses `page_size=50` as
  an example default — production job must paginate through all events, not just the first page).
- **Step 2:** Claude call (same `@anthropic-ai/sdk` pattern as `ice-breaker-analyzer.ts` and
  `user-profile.ts` — `claude-sonnet-4-6`, placeholder-key mock guard) extracts: action items
  (list of strings) and glitches (list of `{description, severity}` or similar — exact shape is an
  implementation detail, not frozen here, following the existing loose-JSON-extraction pattern used
  elsewhere in this codebase).
- **Step 3:** persist extracted action items/glitches to a suitable existing or new column/table
  (exact target — e.g. a new `session_insights`-style row scoped to this feature, or a new
  `hume_native_session_extracts` table — is a build-time implementation decision; the requirement
  is that it is queryable per-session and does not overload `session_insights`'s existing shape,
  which is scoped to ice-breaker analysis specifically).
- **Failure handling:** non-fatal, matching `ice-breaker-analyzer.ts`'s convention — log and mark a
  status field (e.g. `extraction_status = 'failed'`), never throw uncaught, retry via Inngest's
  built-in retry (2-3 attempts, matching existing convention).

### 4.9 Existing/Dormant Code — Explicitly Untouched

- `lib/meeting-bot/recall.ts`, `lib/recall.ts`, `app/api/recall/*`, `lib/voice/elevenlabs-adapter.ts`,
  `lib/voice/relay-handler.ts` — no changes, no deletion, not referenced by any new module in this
  spec.
- `lib/voice/hume-adapter.ts` — no code changes. The `configId` it already accepts as a constructor
  parameter is sufficient; native vs. Custom mode is entirely a property of which `configId` is
  passed in, decided upstream. `injectContext()`'s existing no-op behavior (documented at lines
  273-280 as scoped to Custom-LLM configs) is irrelevant here since native mode never calls it with
  an expectation of effect — no change needed to that comment or behavior.
- `app/api/clio/chat/completions/route.ts` (LIVE-01's Custom-LLM bridge) — untouched; not in the
  loop at all for a native-mode call, by design.
- `live-conductor-bridge.ts`'s `NUDGE_AT_TURN`/`FORCE_AT_TURN` backstop — not reused, not rebuilt.

---

## 5. Data Model / Schema

Covered fully in 4.5. Summary of net-new persisted fields:

| Table | Column | Type | Purpose |
|---|---|---|---|
| `sessions` | `hume_chat_id` | TEXT | Hume's chat identifier, captured from `onConnect`, used for post-session transcript pull |
| `sessions` | `hume_native_config_id` | TEXT | Config ID provisioned for this session (native mode) |
| `sessions` | `hume_native_enabled` | BOOLEAN | Per-session record of whether native mode ran (independent of global toggle state at query time) |
| new table/rows (4.8, exact shape at build time) | — | — | Extracted action items + glitches per session |
| Supabase Storage | `session-snapshots/{session_id}/{index}.png` | image | Visual snapshots for PDF assembly |

No changes to `user_learning_profiles` or `session_insights` schemas — read-only consumption.

---

## 6. API Surface

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `app/api/hume-native/provision-config/route.ts` (new) | POST | Existing session auth (matches other authenticated session routes) | Assembles prompt, provisions Hume Config, returns `configId` |
| Hume REST: `POST /v0/evi/configs` / `.../configs/{id}/versions` | POST | `X-Hume-Api-Key: HUME_API_KEY` | Provision native-mode Config (external, already-approved vendor) |
| Hume REST: `GET /v0/evi/chats/{chat_id}/events` | GET | `X-Hume-Api-Key: HUME_API_KEY` | Post-session transcript pull (external, confirmed working via existing debug endpoint) |

No new public-facing API routes. No Zod schema needed beyond the existing session-auth pattern,
since `provision-config` takes only an implicit session context, not user-supplied input beyond
what's already validated elsewhere.

---

## 7. Non-Functional Requirements

- **Isolation:** toggle OFF must leave LIVE-01 and current production behavior provably unaffected
  (see 4.1).
- **Latency:** transcript-watching/visualization tracking must add zero perceptible lag to Hume's
  live responsiveness (see 4.7) — verified qualitatively during the spike call, not via automated
  benchmark for this trial phase.
- **Security:** `HUME_API_KEY` never logged; all Hume REST calls server-side only (no client-side
  exposure of the API key — the client only ever receives a `configId`, mirroring how
  `hume-token/route.ts` already keeps the key server-side and returns only a scoped access token).
- **No new approved-library additions** without a code-comment justification, per CLAUDE.md — this
  applies specifically to the PDF-assembly library choice flagged in 4.7.
- **No impact on billing/minute-verification logic** (`AUTOGEN-01`'s speak-verification via
  `onSpeakVerified`) — `HumeAdapter` is untouched, so this continues to function identically in
  native mode (the `assistant_message` + `chat_metadata` signals fire the same way regardless of
  which LLM Hume is using internally).

---

## 8. Rollout Plan

1. **Phase A — Spike (4.6):** toggle, Config provisioning, prompt assembly, client wiring built and
   tested against one real call. Blocks all further phases on unknown resolution.
2. **Phase B — Visualization tracking + snapshot/PDF (4.7):** can be built in parallel with Phase A
   plumbing but is validated against Phase A's spike call results before being considered done.
3. **Phase C — Post-session extraction (4.8):** built in parallel; validated once a real
   `hume_chat_id` exists from Phase A's test call.
4. **No production rollout beyond the trial** — toggle remains OFF by default; broader rollout is
   contingent on Arun's post-spike decision, which is out of scope for this spec to predetermine.

---

## 9. Acceptance Tests

1. **Toggle OFF, existing flow:** a session run with `NEXT_PUBLIC_HUME_NATIVE_ENABLED` unset/false
   behaves identically to current production LIVE-01/Custom-LLM-bridge — no new code path
   triggered, no schema writes to the three new `sessions` columns beyond their default values.
2. **Toggle ON, Config provisioning success:** `provisionNativeConfig()` returns a valid `configId`;
   `HumeAdapter.create()` connects successfully using it; `chat_metadata` received, `hume_chat_id`
   persisted to the session row.
3. **Toggle ON, Config provisioning failure:** Hume API returns non-2xx; session start is blocked
   with a clear error; no silent fallback to Custom-LLM mode occurs.
4. **Prompt assembly:** `assembleHumeNativePrompt()` correctly replaces both `[CONTEXT]` and
   `[SESSION CONTENT]` placeholders with no leftover bracketed tags in the output string; omits the
   intent sub-block cleanly when no `session_insights` row exists.
5. **Scheduled session pre-provisioning:** a scheduled session's Config is provisioned and
   `hume_native_config_id` stored ahead of the meeting start time; call-start reads the existing
   `configId` rather than re-provisioning.
6. **Spike Unknown 1 (prompt size):** documented pass/fail result per the criteria in 4.6, with
   Hume's actual response captured.
7. **Spike Unknown 2 (tool-call reliability):** documented pass/fail result per the criteria in 4.6,
   with an observation log of which transitions fired tool calls and which didn't.
8. **Visualization tracking does not add lag:** qualitative pass/fail — Arun's live assessment
   during the spike call that Clio's responsiveness is unaffected by the tracker running in the
   background.
9. **Snapshot + PDF + email:** at least one full session (from the spike call, assuming it runs long
   enough to have at least one visual transition) produces a snapshot, and a PDF containing that
   snapshot is emailed via Resend to the test account after session end.
10. **Post-session extraction:** the batch/event job successfully pulls the full transcript via
    `GET /v0/evi/chats/{chat_id}/events` for the spike call's `chat_id`, and Claude extracts at
    least a well-formed (possibly empty) action-items/glitches result without throwing.
11. **Session ending with toggle mid-flip:** if the toggle is flipped between session-scheduling and
    session-start, the session's already-stored `hume_native_enabled` flag (set at provisioning
    time, not read live at call-start) governs behavior for that specific session — no
    inconsistent half-native/half-Custom state.
12. **Scheduled session whose Config push fails ahead of time:** the pre-provisioning job's failure
    is logged and does not silently degrade to Custom-LLM mode; the session either retries
    provisioning before start or blocks with a clear error, consistent with requirement 4.3's hard-
    failure stance.

---

## 10. Edge Cases

- First-ever session for a user (no `user_learning_profiles` row, no `session_insights` row yet):
  `[CONTEXT]` placeholder still resolves — `buildProfileContextForClio()` already handles a profile
  with empty/default fields gracefully (per its existing implementation), and the intent sub-block
  is simply omitted (see 4.2.1).
- Hume Config provisioning succeeds but the call never actually connects (network/transport issue
  unrelated to native-mode itself) — this is an existing `HumeAdapter` reconnect/error path,
  unaffected by native mode, and is out of scope for new handling here.
- Session ends abnormally (dropped call, no `end_session` tool call fired) — the post-session
  extraction job's safety-net cron (4.8) still picks it up as long as `hume_chat_id` was captured at
  connect time, even without a clean `end_session` signal.
- Very short test call with zero visual transitions — PDF assembly job runs with zero snapshots;
  in that case, no PDF is generated and no email is sent (nothing to compile), logged as a no-op,
  not an error.
- Multiple visual transitions firing in rapid succession (Hume's own LLM moves fast) — snapshot
  capture must handle back-to-back triggers without dropping a snapshot; sequencing is by index, not
  by wall-clock dedup window, so rapid transitions are still each captured individually.

---

## 11. Open Questions

*(none — all questions from the feature brief are resolved above; any remaining implementation-
level choices explicitly flagged as build-time technical decisions in 4.7 (PDF library) and 4.8
(extraction storage shape) are non-blocking technical decisions, not product ambiguities, per the
CEO/BA governance model's technical-vs-product distinction)*

---

## 12. Approval

- [ ] CEO Agent review
- [ ] CEO Agent approval (required before any developer agent writes code)

**Escalation note for CEO review:** two items in this spec are flagged as build-time technical
decisions rather than frozen requirements — the PDF-assembly library choice (4.7) and the exact
storage shape for extracted action items/glitches (4.8, Step 3). Per the governance model's
technical-vs-product boundary, these do not require Arun's input and should not block approval;
they are noted here for visibility only.

---

## CEO Approval

**Status: APPROVED**
**Date:** 2026-07-04
**Reviewed by:** CEO Agent

This requirement document was checked against `docs/brainstorm/ATTENDEE-HUME-ARCHITECTURE-brainstorm.md`'s
Final Decision Summary (all 7 items) and found to accurately reflect every decision — nothing
invented, nothing dropped, nothing contradicted. Section 11 (Open Questions) is genuinely empty;
the two flagged technical unknowns (prompt-size acceptance, tool-call reliability) are handled as
an explicit validation-spike phase (Section 4.6) with defined pass/fail criteria and defined
fail-path behavior for each — not silently assumed to work. Standing constraints are respected:
toggle-gated with a clear default-off flag (`NEXT_PUBLIC_HUME_NATIVE_ENABLED`), fully isolated in a
new `lib/voice/hume-native/` module tree with `hume-adapter.ts`, `live-conductor-bridge.ts`, and all
existing Recall/ElevenLabs code explicitly untouched, no deletions, and all new external calls
(Hume Config API, Hume Chat History API) go through typed clients with secrets sourced only from
`process.env`. The two new requirements (visualization PDF export + email, post-session action-item/
glitch extraction) are both concretely specified, reusing existing infrastructure (Resend, Supabase
Storage, Inngest, the existing Hume debug-endpoint auth pattern) rather than inventing new
infrastructure. Nothing remains that would block a developer from building Phase A (the spike)
without further interpretation or guessing.

**No code has been written as part of this review** — this is a documentation approval only.
Development may proceed starting with Phase A (the validation spike, Section 4.6/8) per the
rollout plan in Section 8.
