# RTV-05: Live Pre-Fetch + Dual-Trigger Toggle-Gated Display Switch (Full Integration) — Requirement Document
Version: 1.0
Status: APPROVED (see CEO Review, end of document)
Author: Business Analyst Agent
Date: 2026-07-10

---

## ROLLOUT READINESS GATE — READ THIS BEFORE ANYTHING ELSE

**This phase must not be enabled in production today, and this spec's own design makes that
self-enforcing, not just a promise.** Two independent preconditions must both hold before the
toggle this document introduces can safely be flipped ON for real traffic:

1. **RTV-03's accuracy evidence** must show the tracker meets its bounded-worst-case bar in real
   sessions (per RTV-03 Section 7's `rtv03_accuracy_reports`), and
2. **Arun must have individually approved**, via `/dashboard/admin/templates` (RTV-04), the
   specific templates the sessions in question will actually route through.

**Neither is satisfied as of this writing.** Verified live against Supabase project
`nqxlpcshouboplhnuvrh` on 2026-07-10, directly, not assumed:
- `template_library`: **all 27 rows are `status = 'pending_review'`. Zero are `'approved'`.**
- `sessions`: **11 total sessions; zero have `rtv_eligible = true`; zero have `session_markers`
  populated.**

This document's own design (Section 4, Question 1 and Question 4) makes this a **structural**
fact, not a policy reminder: the toggle this phase introduces defaults OFF, and — per the design
below — even if a future developer flipped it ON in an environment exactly like today's, the
session-start gate in Section 4.2 would independently and correctly compute "display authority
inactive" for every single session, because it requires every non-bookend topic's assigned
template to individually be `status = 'approved'` in the live `template_library` table, and today
that is true for zero templates. **The gate does not rely on anyone remembering not to flip the
toggle — it is provably inert on today's data by construction**, the same property RTV-03
established for its own toggle via the `rtv_eligible` column.

This phase is being written now because it is planning work — a specification, not live code —
and does not touch what any real user sees.

---

## 0. Grounding note (read before the spec)

Everything below is checked directly against the live codebase and the live Supabase project
(`nqxlpcshouboplhnuvrh`), not against the Feature Brief's citations alone.

- **The `show_visual` Hume-native handler** is at `app/dashboard/walkthrough/WalkthroughClient.tsx`
  lines **874–961** (not ~767 as the brief estimated — the file has grown since RTV-01/03 landed).
  Its existing screen-write is the `screenQueueRef`-chained `scroll_to` POST at **lines 910–925**.
  This is the **only** code path this phase suppresses in the ON+gate-passed state (Section 4.3).
  Everything else in that handler (idx resolution, split-context injection at lines 892–901, and
  the returned TEACH-script instruction text at lines 927–946) is confirmed **unchanged** in every
  state — this is what "content-prep behavior preserved" means concretely (Feature Brief, Known
  Constraints).
- **There is a second `show_visual` handler, at lines 1104–1213, inside the ElevenLabs
  `Conversation.startSession` block.** Confirmed out of scope: line 1059 (`return // skip
  ElevenLabs path`) and line 1061 (`// ── END HUME path`) prove the Hume-native branch returns
  before this second handler is ever reached on the Hume-native path. This phase touches **only**
  the first (Hume-native) `show_visual` handler, never the ElevenLabs one — consistent with the
  brief's Hume-native-only scope guardrail (#16).
- **RTV-03 is already fully built and merged**, not just approved-on-paper. Confirmed by direct
  read of `WalkthroughClient.tsx`:
  - `rtvStateRef` / `rtvTopicsRef` (lines 562–563), seeded exactly as RTV-03 specified.
  - The tracker-hit block is at **lines 850–870**, inside the Hume-native `onMessage(text, 'ai')`
    handler, running strictly after NAV/farewell logic (unchanged). Today it is **log-only**: on a
    hit, it advances `rtvStateRef.current` and writes three audit rows
    (`rtv03_state_advance` / `rtv03_quick_summary_cue` / `rtv03_next_topic_cue`) via
    `buildRtv03AuditMetadata()` — **it does not call `/api/walkthrough-state`, does not touch
    `screenQueueRef`, and does not write `sectionsRef`/`currentSectionIndexRef`.** This is exactly
    the "hard scope boundary: observe-only" RTV-03 committed to, and it is precisely where this
    phase's new pre-fetch/display logic gets inserted (Section 4.3, Question 1/3).
  - `lib/content/rtv03-tracker.ts`'s `checkRtv03Transition()` (confirmed, read in full) implements
    the depth-2 lookahead exactly as RTV-03's approved spec describes: a hit on `current+1`'s
    markers returns `{ toState: current+1, lookaheadDepth: 1, correctionType: 'normal' }`; absent
    that, a hit on `current+2`'s markers returns `{ toState: current+2, lookaheadDepth: 2,
    correctionType: 'gap_jump' }`; otherwise `null`. This function is pure and reused verbatim by
    this phase — nothing about it changes.
  - `provision-config/route.ts` (confirmed, read in full) already computes `rtv03Active` (line 483:
    `rtvTrackingEnabled && summaryModeEnabled && rtvEligibleForThisRequest`) and returns
    `rtv03: { sessionId, topics }` (lines 484–495) only when all conditions hold, and persists
    `sessions.rtv03_tracking_enabled = rtv03Active` (line 505) at connect time. This exact request
    already has `sections` loaded in memory (line 122's `select('topic_title, sections,
    training_scripts')`) — this phase's new session-level approval gate (Section 4.2) is added
    immediately alongside this existing computation, reusing the same in-memory `sections`, no new
    query needed to enumerate topics.
- **RTV-04 is already fully built and merged**, not just spec-approved. Confirmed by direct read:
  - `lib/templates/approval.ts`'s `isTemplateApprovedForProduction(templateName): Promise<boolean>`
    (lines 57–67) is the real, live, fail-closed function this phase reuses verbatim — a missing
    row or any `status !== 'approved'` returns `false`.
  - `lib/templates/selector.ts`'s `selectApprovedTemplate()` (lines 164–174) gates **only**
    `Heatmap`/`Overlay` (`APPROVAL_GATED_TEMPLATES`, line 22) through
    `isTemplateApprovedForProduction()` — the other 25 template names (23 content templates + 2
    structural bookends) bypass that check entirely today, because that gate was built to protect
    only the two genuinely new template types, not to re-litigate the 25 already-live ones. **This
    matters a great deal for this phase**, addressed head-on in Question 4: this phase's own
    hard-refuse gate is independent of, and strictly broader than, `selectApprovedTemplate()`'s
    existing gate — it checks every non-bookend template a session will use, not just the two new
    ones.
  - `template_library` (confirmed schema, migration `065_rtv04_template_library.sql`): primary key
    `template_name`, `status` (`pending_review | approved | changes_requested`), all 27 rows seeded
    at `pending_review` (verified live, above).
- **`walkthrough_state.sections`** (confirmed via `lib/session-plan.ts` and
  `inngest/session-content-pipeline.ts`, both read in full) is populated once, at session-plan
  time, for every session including Hume-native summary-mode ones — **not** left empty for this
  path. Each entry is `{ id, type: TemplateName, data: TemplateSection['data'], meta: TemplateMeta,
  status }`, where `type` was decided by `selectApprovedTemplate()` (`lib/session-plan.ts` line 54;
  `inngest/session-content-pipeline.ts` line 443) and `data` was either a cache hit from
  `topic_content_cache` or a fresh `generateTemplateData()` call, **at plan time** — this existing
  `data` is exactly the "cached content" requirement #20 forbids this phase from displaying via the
  new path; it is also the only content that exists as a fallback if this phase's own live
  generation fails (Section 8). `sections[i].type` is the load-bearing signal this phase uses to
  know which approved template a topic is assigned to — **no new template-assignment storage is
  needed**; RTV-05 reads the same field `show_visual` already reads.
  - **SessionOverview/SessionSummary never pass through `selectTemplate()`/`generateTemplateData()`**
    (`lib/templates/session-bookends.ts`, confirmed, read in full — bookend TEACH content is fixed,
    deterministic string templating, no LLM call ever). This phase must never attempt to
    live-generate or overwrite a bookend's `data` (Question 5).
  - `lib/templates/generator.ts`'s `generateTemplateData(templateType, subtopicTitle,
    sessionTitle, userContext, adjacentTopics?, contentSpec?): Promise<TemplateSection['data']>`
    (lines 1022–1029, confirmed) is the exact live-generation function this phase reuses — same
    function `session-plan.ts`/`session-content-pipeline.ts` already call, with an `isPlaceholder`
    Anthropic-key mock guard already built in (so builds/dev never break, Section 8). This phase
    calls it **live, at pre-fetch time, in the running session** — never at plan/authoring time —
    which is what makes its output "never cached" (#20): each pre-fetch call is a fresh Anthropic
    call, its result is written directly into `walkthrough_state.sections[idx].data` for this one
    session's runtime state only, never into `topic_content_cache`.
  - `lib/templates/generator.ts`'s `validateTemplateData()` (line 1194, confirmed) is RTV-04's
    Layer-1 char-budget/floor enforcement — this phase reuses it on every live-generated result
    before writing it, so fixed-container discipline (#12/#13) holds for pre-fetched content
    exactly as it holds for plan-time content.
- **`POST /api/walkthrough-state/[userId]`** (confirmed, read in full,
  `app/api/walkthrough-state/[userId]/route.ts`) already supports two commands via an identical
  fetch-current-array → splice/replace → write-back pattern: `scroll_to` (lines 189–207, updates
  `current_section_index` only) and `insert_section` (lines 209–249, replaces the `sections` array
  wholesale after inserting one element). **`insert_section` has zero call sites anywhere in
  `WalkthroughClient.tsx` today** (confirmed via full-file grep) — it was built defensively by
  LIVE-06 but nothing currently invokes it. This phase adds a **third** command,
  `update_section_data`, following the exact same fetch/splice/write-back shape as `insert_section`
  (Section 6.3) — the established pattern for mutating one array element without disturbing
  `current_section_index`.
- **`provision-config/route.ts` already has the exact `UserContext`-construction pattern this
  phase's new pre-fetch route needs**, reused verbatim: an inline `users` query
  (`.select('role, industry, ai_maturity, role_level')`, lines 195–196) and an inline
  `inferRoleLevel(role)` fallback (lines 215–217, mirroring `inngest/session-content-pipeline.ts`
  line 57's module-level version) for when `role_level` is null. This phase's new pre-fetch route
  copies this exact pattern rather than inventing a new one (Section 6.1).
- **Latest applied migration is `065_rtv04_template_library.sql`** (confirmed via directory
  listing) — this phase's migration is `066_rtv05_display_switch.sql` (Section 12).

---

## 1. Purpose

RTV-02 (markers), RTV-03 (observe-only tracking), and RTV-04 (template library + approval
workflow) each produce one piece of a puzzle that, until now, has never been assembled: a live
visualization that actually follows what Clio is saying, in real time, switching in sync with her
voice instead of only on her own `show_visual` tool call.

This phase assembles that puzzle — **and, because it is the piece that finally touches what a real
participant sees, it is also the piece that must resolve the single highest-risk decision in the
entire RTV series**: if both `show_visual` and the new tracker-driven mechanism can ever write the
screen, they will race — the exact class of bug already found and fixed once as `LIVE-06`
(screen-skip). Get the toggle wrong here and a senior executive's session can flicker, skip a
screen, or freeze on a stale one — a broken product experience at exactly the moment (a live
session) where trust matters most.

Failure mode without this phase: the RTV series remains three well-tested, well-evidenced
components with no integration — pre-fetching and precise-sync display never actually happen, and
the product never delivers on its stated goal ("the visualization tracks Clio's voice").

## 2. User Story

As **a session participant (senior executive)**,
I want the on-screen visualization to switch to the next topic exactly when Clio starts teaching
it, fully formed with no loading state, and to never show me the wrong topic, a stuck screen, or a
flicker between two competing displays,
So that the screen feels like a natural, trustworthy extension of what she's saying — not a
separate, occasionally-broken system running alongside her.

As **Arun (product owner, the one who requires that no unapproved design or unproven tracker ever
reaches a real session)**,
I want this phase's own code to make it structurally impossible to enable the new display path
until I have individually approved the templates involved and RTV-03's accuracy evidence is good
enough,
So that flipping a toggle can never accidentally bypass either gate, even by mistake, even months
from now when nobody remembers this conversation.

As **a QA engineer**,
I want an explicit, testable proof that exactly one code path writes the screen in each toggle
state, with no window in which both could fire,
So that I can verify the anti-`LIVE-06` guarantee directly, not just take it on faith.

(There is no third, purely observational user story here — unlike RTV-03, this phase's entire
purpose is to become user-visible once its own readiness gate is satisfied. Until then, per the
Rollout Readiness Gate above, a participant experiences **zero difference**, provably.)

## 3. Trigger / Entry Point

- **No new route, no new page.** This phase extends the existing Hume-native voice session
  lifecycle in `app/dashboard/walkthrough/WalkthroughClient.tsx` — the same component RTV-01/03
  already extended, at the same `/dashboard/walkthrough/[userId]` route (and its bot-view
  counterpart).
- **New toggle:** `NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED`. Read with strict `=== 'true'` (the
  established pattern in this file — unset, `'false'`, `'1'`, `'TRUE'`, any typo all resolve to
  OFF), in **two** places, both required to read the identical env var so there is one source of
  truth for both the server's gating decision and the client's decision to ever instantiate the new
  code paths:
  1. **Server-side**, in `app/api/hume-native/provision-config/route.ts`, at connect time —
     computes the session-level `rtv05DisplayActive` gate (Section 4.2) and includes it in the
     response.
  2. **Client-side**, in `WalkthroughClient.tsx` — gates whether the tracker-hit block's new logic
     (Section 4.3) ever runs at all, as a defense-in-depth belt-and-suspenders check alongside the
     server-computed flag (Section 4.3, Question 1).
- **Activating conditions for the session-level gate (all evaluated once, server-side, at first
  connect — Section 4.2):**
  1. `NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED === 'true'` (this phase's new toggle).
  2. RTV-03's own `rtv03Active` is true for this session (existing, unchanged: Hume-native +
     summary mode + `NEXT_PUBLIC_RTV_TRACKING_ENABLED === 'true'` + `sessions.rtv_eligible ===
     true`) — this phase's display authority can never be active without RTV-03's tracker also
     being active, since the tracker is the only source of transition hits.
  3. **Every** non-bookend topic in this session (`sections[1..N]`, from the same
     `walkthrough_state.sections` already loaded for this request) has `type` values that are
     **all individually** `isTemplateApprovedForProduction(type) === true` against the live
     `template_library` table, checked fresh for this connect.
  - All three must hold. If any is false, `rtv05DisplayActive = false` for this session's entire
    lifetime (Section 4.2) — today, condition 3 alone is false for every session (zero approved
    templates), so the gate resolves to `false` unconditionally, regardless of condition 1's env
    var value.
- **State required:** identical to RTV-03's — a Hume-native, summary-mode session with
  `rtv_eligible = true` and a populated `session_markers`/`sections`. No additional user state.

## 4. Screen / Flow Description

There is no new UI. Per the governance model, this section documents the internal event sequence
at the same precision a UI flow would receive — this is the entire deliverable of this phase.

### 4.1 What does NOT change, in either toggle state

- The participant's screen is, in every state, driven by exactly one write: an update to
  `walkthrough_state.current_section_index`, read by the existing, completely unmodified 2-second
  poll loop and rendered by the existing, unmodified `SessionStack`/`TemplateRenderer`.
- `show_visual`'s handler (lines 874–961) **always fires** when the LLM calls the tool, in every
  toggle state. Its idx-resolution logic (lines 880–901), its split-context injection, and its
  returned TEACH-script instruction text (lines 927–946) are **never modified, never skipped** —
  this is the "content-prep behavior preserved" requirement. The **only** thing this phase ever
  conditionally suppresses is the specific `screenQueueRef`-chained `scroll_to` write at lines
  910–925.
- RTV-03's tracker-hit block continues to run unconditionally (log-only audit rows always written,
  in every toggle state) — this phase only ever **adds** logic inside that block, gated so the
  addition is fully inert unless the session-level gate passed (Section 4.3).

### 4.2 The session-level gate — computed once, server-side, never revisited mid-session (Question 1 foundation)

This is the single most important design decision in this document, and it exists specifically to
make the anti-`LIVE-06` proof airtight (Question 1, Section 4.3 gives the full proof).

**Why a session-level gate, not a per-transition runtime check:** the Feature Brief asks for a
per-template, per-render approval check (Known Constraint, Question 4) — and this phase delivers
exactly that, but with one considered, disclosed refinement: the individual per-template checks are
all performed **once, upfront, for the whole session**, at the same moment RTV-03's own
`rtv03Active` is already computed, rather than re-evaluated at the instant of each individual
screen switch. This is a deliberate, technical resolution of a real tension — evaluating template
approval at the literal moment of each switch would mean the decision "which mechanism owns the
screen right now" could in principle differ from one transition to the next within the same
session (e.g. if a template's approval were edited mid-call via the admin UI), which reintroduces
exactly the dual-writer risk this phase exists to eliminate: if authority could ever flip mid-session,
there would be a window where both `show_visual`'s suppressed write and the tracker's write are
simultaneously "sort of" eligible, which is the `LIVE-06` failure mode by another name. A **single,
frozen, whole-session decision** — made once, before either writer's code can ever execute for this
session — removes that window by construction, not by a runtime guard. This is the same category
of judgment call RTV-03's CEO review already accepted for the depth-2 lookahead resolution: a
technical/algorithmic decision within BA authority that makes a stated correctness requirement
(here: "exactly one authoritative writer, provably") actually hold, rather than merely asserting it
holds.

This does not weaken the individual per-template check itself — every non-bookend template this
session will ever route through **is** checked, individually, fresh, against the live
`template_library` table, for this specific session, at this specific connect. It only fixes *when*
that already-individual check happens.

**Exact computation, added to `app/api/hume-native/provision-config/route.ts` immediately
alongside the existing `rtv03Active`/`rtv03ResponseField` computation (~lines 477–495):**

```
rtv05EnvToggleOn = process.env.NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED === 'true'

if (isReconnect_or_rtv05_display_active_already_persisted_for_this_session):
    // Section 4.2a — reuse the PERSISTED decision verbatim. Never recompute.
    rtv05DisplayActive = sessionRow.rtv05_display_active === true
else:
    // First connect for this session. Compute once, then persist immediately.
    if not rtv05EnvToggleOn or not rtv03Active:
        rtv05DisplayActive = false
    else:
        nonBookendTypes = distinct( sections[i].type for i in 1..N )   // sections already in memory
        approvals = await Promise.all( nonBookendTypes.map(isTemplateApprovedForProduction) )
        rtv05DisplayActive = approvals.every(a => a === true)

    write sessions.rtv05_display_active = rtv05DisplayActive   // same update() call as
                                                                 // sessions.rtv03_tracking_enabled

response += { rtv05: { displayActive: rtv05DisplayActive } }   // only when rtv03 field is also present
```

- **"First connect" vs "reconnect" detection:** reuses the same signal already available at this
  point in `provision-config` — whether `sessions.rtv05_display_active` is `NULL` (never computed)
  vs already `true`/`false` (computed on a prior connect for this same session). This mirrors
  exactly how `sessions.rtv03_tracking_enabled` is persisted once and is available to read on any
  subsequent request for the same session row.
- **Why this must be persisted and reused, not just recomputed identically each time:**
  `rtv03Active`'s three inputs (Hume-native flag, summary-mode flag, `rtv_eligible`) are all fixed
  at content-authoring time and never change mid-session, so recomputing it fresh on every connect
  is already safe — RTV-03 never needed a persist-and-reuse rule for this reason. **This phase
  introduces the one input that genuinely can change mid-session: `template_library.status`, which
  Arun can edit live via `/dashboard/admin/templates` while a call is in progress.** Without
  persisting the decision, a mid-session reconnect (WebSocket drop + auto-reconnect, an ordinary
  occurrence per `LIVE-06b`) could theoretically compute a **different** `rtv05DisplayActive` value
  than the session started with, if Arun approved or reset a template's status in the interim —
  which would mean the authoritative writer for this one session could flip mid-call. Persisting
  the value at first connect and reusing it verbatim on every subsequent connect for the same
  session closes this off entirely: **the decision is invariant for a session's entire lifetime,
  immune even to a live edit in the admin UI while the call is in progress.**
- **Bookends are excluded from the "every non-bookend topic" check** — `sections[0]`/`sections[N+1]`
  (`SessionOverview`/`SessionSummary`) never pass through `selectTemplate()` and have no
  `template_library` row to check; they are unconditionally safe to switch via either mechanism,
  since their content is always the same fixed, deterministic data regardless of which writer
  switches to them (Question 5).

### 4.3 The dual-trigger toggle design — the code-path-level proof (Question 1, the core deliverable)

**OFF state (`rtv05DisplayActive` is false — today, unconditionally, for every session):**

- The **sole** authoritative screen writer is `show_visual`'s existing `scroll_to` write
  (`WalkthroughClient.tsx` lines 910–925), **completely unmodified**, firing exactly as it does
  today, through the existing `screenQueueRef`/`SCREEN_MIN_DISPLAY_MS` chain.
- RTV-03's tracker-hit block (lines 850–870) runs exactly as RTV-03 built it: it advances
  `rtvStateRef` and writes the three audit rows. This phase's new logic (pre-fetch trigger, display
  trigger) is wrapped in `if (rtv05DisplayActiveRef.current) { ... }` (Section 4.4) — a single
  boolean read, seeded once at connect from the server's `rtv05.displayActive` field and **never
  reassigned afterward** for the life of the component instance. When this is false, that whole
  block of new code is dead — not merely "chooses not to write," but never executed at all.
- **Proof of no concurrent second writer:** the tracker's new code is provably unreachable in this
  state (a single, write-once boolean guard evaluated false), so there is no code path anywhere in
  the client that could issue a competing `scroll_to`/`update_section_data` write. This state is,
  by construction, **byte-identical to today** — no new code executes at all.

**ON + gate-passed state (`rtv05DisplayActive` is true — requires all of Section 4.2's conditions,
including every non-bookend template individually approved):**

- The `show_visual` handler's existing `scroll_to` write (lines 910–925) is wrapped:
  ```
  if (!rtv05DisplayActiveRef.current) {
    // existing screenQueueRef-chained scroll_to write — UNCHANGED CODE, lines 910–925
  }
  // else: intentionally suppressed — the tracker is sole authority this session.
  ```
  Everything else in the handler (idx resolution, split-context injection, the returned
  instruction text) still runs — `show_visual` still "fires" in every sense the LLM and the rest of
  the handler can observe; only this one specific write is skipped.
- The tracker-hit block (lines 850–870) gains new logic, gated identically:
  ```
  if (rtv05DisplayActiveRef.current) {
    // (a) DISPLAY step for hit.toState — the sole authoritative screen writer this session.
    // (b) PRE-FETCH step for hit.toState + 1 — fire-and-forget, never blocks (a).
  }
  ```
  Both steps are detailed in Question 2/3 below. Critically: **step (a) reuses the exact same
  `screenQueueRef` object and `SCREEN_MIN_DISPLAY_MS` floor** `show_visual` uses — it is not a
  second, independent queue. This means even in the (structurally impossible, per the proof below,
  but worth stating) case of two tracker hits landing close together, they inherit `LIVE-06`'s
  existing serialization discipline automatically, for free.
- **Proof of no concurrent second writer:** `rtv05DisplayActiveRef.current` is a single boolean,
  assigned exactly once (at connect, from the server's frozen, session-lifetime-invariant decision
  — Section 4.2) and never reassigned for the rest of the component's life. The `show_visual`
  write and the tracker's write are gated by **the exact same boolean, read as each other's logical
  negation** (`if (!flag)` vs `if (flag)`) — there is no code path, no race, no timing window in
  which both conditions can be true simultaneously, because they are literally `X` and `!X` on the
  same read of the same never-mutated variable. This is stronger than a two-independent-checks
  design (which could theoretically diverge if evaluated at slightly different times): here, one
  flag decides both, and it never changes.
- **Tie to `LIVE-06`:** this is the same class of guarantee `LIVE-06` established for
  `screenQueueRef` itself ("two calls fired close together execute in order, never both partially
  applied") — this phase adds a *second, higher-level* guarantee one layer up: which mechanism is
  even allowed to *enqueue* a write in the first place is itself serialized to exactly one, for the
  whole session, before either could ever enqueue anything.

**QA-verifiable, mirroring RTV-03's own three-way verification (Section 4b of that spec):**
1. **Code review gate:** a one-line grep confirms the `show_visual` `scroll_to` block is the only
   write site wrapped in `if (!rtv05DisplayActiveRef.current)`, and the tracker block's new writes
   are the only site wrapped in `if (rtv05DisplayActiveRef.current)` — same variable, negated,
   nowhere else referenced as a write-gate.
2. **Automated unit assertion:** a test asserting `rtv05DisplayActiveRef.current` is assigned
   exactly once in the component's lifecycle (at the `provision-config` response handler) and
   never reassigned anywhere else in the file — a grep-checkable invariant, same style as RTV-03's
   "distinct ref objects" test.
3. **Live A/B recording diff:** run the identical session content twice — once with the session-level
   gate forced false, once forced true (both possible today only in a test environment, since
   production cannot satisfy condition 3) — and diff screen-transition timestamps against the
   Recall.ai transcript, exactly as RTV-03's own verification method 2 already does.

### 4.4 Pre-fetch (Question 2 / brainstorm #7)

**Trigger:** the same signal RTV-03 already produces for `rtv03_quick_summary_cue` — a tracker hit
advancing state to `newState`. On **that** hit, pre-fetch is kicked off for `newState + 1` (the
topic *after* the one just entered), not for `newState` itself. This reuses RTV-03's disclosed,
approved design (its own Question 2 answer: `rtv03_quick_summary_cue` and `rtv03_next_topic_cue`
share one signal) rather than inventing a second one — and it is a deliberate, disclosed
reinterpretation worth stating plainly:

**Disclosed design choice:** the brainstorm's original framing was "pre-fetch fires when tracking
crosses topic N's *own* quick-summary checkpoint, generating content *for topic N+1*." RTV-03's
built tracker only ever produces one signal per topic — the golden-word hit that confirms *entry
into* that topic. Because a topic's golden word is, by RTV-02's own design, a term that "cannot
miss" being said *while teaching that topic* (not necessarily at its very title moment), a hit
confirming entry into topic `newState` is already evidence Clio has been teaching it for some time
— this is the natural, already-available proxy for "wrapping up the previous checkpoint," and using
it to kick off generation for the topic *after* the one just entered gives **substantial real lead
time** (the remaining duration of teaching `newState`, typically tens of seconds to several minutes
per session pacing) rather than the near-zero lead time that would result from generating and
displaying off the identical instant. This is the single most defensible construction available
given RTV-03's own disclosed one-signal limitation, and it is stated here explicitly rather than
silently assumed.

**Bootstrap case (the first real topic, `section_index = 1`):** there is no hit that "enters state
0" (state 0 is seeded, never detected — RTV-03 Section 4a). Pre-fetch for `section_index = 1` is
therefore kicked off once, immediately, at tracker initialization — the same point
`rtvTopicsRef.current = rtv03.topics` is set in the Hume connect block (line 703) — gated on
`rtv05DisplayActiveRef.current` being true. This gives the full duration of the Overview bookend
(typically brief, fixed content) as lead time, which is the best available proxy for "about to need
topic 1."

**Exact mechanism:**
1. Skip entirely (no-op, resolve immediately) if the target `section_index` is out of bounds, or
   its `sections[idx].type` is `'SessionOverview'`/`'SessionSummary'` — bookends are never
   live-generated (Question 5).
2. Skip if a pre-fetch for this exact `section_index` is already in flight or already completed for
   this session (tracked in a new client ref, `rtv05StagedContentRef: Map<number,
   Promise<TemplateSection['data'] | null>>`, keyed by `section_index`) — pre-fetch fires **at
   most once per section per session**.
3. Otherwise, `fetch('/api/rtv05/prefetch-section', { method: 'POST', body: { userId, sectionIndex
   } })` — fire-and-forget from the caller's perspective (the promise is stored in
   `rtv05StagedContentRef`, awaited later only by the display step, Section 4.5 — it never blocks
   the tracker-hit handler itself, matching RTV-03's "never throws uncaught inside `onMessage`"
   discipline).
4. **New server route `POST /api/rtv05/prefetch-section`** (`app/api/rtv05/prefetch-section/route.ts`):
   - Re-reads `walkthrough_state.sections` fresh from the DB for this `userId` (defense in depth —
     never trusts a client-supplied `type`/`meta` for a content decision, matching this codebase's
     established convention).
   - Re-confirms the target index is in-bounds and non-bookend (redundant with the client's own
     check, cheap, and closes any theoretical gap if the client-side check were ever bypassed).
   - Builds `UserContext` by querying `users` for `role, industry, ai_maturity, role_level`
     (identical query shape to `provision-config/route.ts` lines 195–196) and applying the same
     `inferRoleLevel(role)` fallback (lines 215–217) when `role_level` is null.
   - Calls `generateTemplateData(sections[idx].type, sections[idx].meta.subtopicTitle,
     sections[idx].meta.sessionTitle, userContext, { previous: sections[idx-1]?.meta.subtopicTitle,
     next: sections[idx+1]?.meta.subtopicTitle })` — the exact function `session-plan.ts` already
     calls, called here **live, at runtime**, never at plan/authoring time.
   - Runs the result through `validateTemplateData()` (RTV-04's existing char-budget/floor
     enforcement) before accepting it.
   - **Timeout/retry policy (new constants, `RTV05_GENERATION_TIMEOUT_MS = 20_000`,
     `RTV05_GENERATION_MAX_RETRIES = 1`):** one attempt, then — on timeout or thrown error — exactly
     one retry, then give up. This is a considered, disclosed choice, not arbitrary: it mirrors
     RTV-04's own Layer-1 "one retry, then fall back" pattern for the identical
     `generateTemplateData()`/`validateTemplateData()` surface (the closest available precedent —
     closer than LIVE-01's aggressive 10-attempt/4s loop, which exists to cover a near-zero-lead-time
     scenario this phase does not have). 20 seconds per attempt is generous given the substantial
     lead time established above; two attempts worst-case is ≤40s, still normally well inside a
     topic's teaching duration.
   - **On success:** writes the validated data via the new `update_section_data` command (Section
     6.3) to `sections[idx].data`, preserving `id`/`type`/`meta`/`status` unchanged. Returns
     `{ ok: true }`.
   - **On failure after retries exhausted:** returns `{ ok: false }`. **Does not write anything** —
     `sections[idx].data` is left exactly as it already was (the plan-time content). This is the
     documented, bounded fallback the display step (Section 4.5) relies on.
5. **#20 compliance:** the freshly-generated data is written only into this session's
   `walkthrough_state` row — never into `topic_content_cache`, never into `template_library`, never
   into any table another session or user could ever read. Each pre-fetch call is a fresh Anthropic
   call every single time this code path runs, for this session only — there is no code path in
   this phase that reads a previous session's generated content.

### 4.5 Display (Question 3 / brainstorm #8)

**Trigger:** the tracker hit that confirms entry into `targetIdx` (`hit.toState`) — the same event
that produces `rtv03_next_topic_cue`. Precisely the disclosed-shared-signal design RTV-03 already
built and logs distinctly (`same_signal_as_next_topic_cue: true`); this phase does not add a second
signal, consistent with RTV-03's own scope discipline (its Question 2 answer explicitly flagged
inventing a new marker as unrequested scope expansion).

**Exact mechanism, inside the `if (rtv05DisplayActiveRef.current)` block (Section 4.3), immediately
after `rtvStateRef.current = hit.toState` and the three existing audit writes:**
1. Look up `rtv05StagedContentRef.current.get(targetIdx)` (the promise from a prior pre-fetch call
   for this exact index, if one was ever started for it — normally yes, started when the tracker
   entered `targetIdx - 1`, or at bootstrap for `targetIdx === 1`).
2. If a promise exists, `await` it, bounded by a new constant `RTV05_DISPLAY_WAIT_MS = 15_000` (a
   defensive ceiling — by the time display fires, pre-fetch has typically already had a full
   topic's teaching duration to complete; this bound only matters in the rare case of an unusually
   fast transition). If it resolves (`{ ok: true }` from Section 4.4) before the bound, or was
   already resolved, proceed immediately — no perceptible wait in the normal case, satisfying #14
   ("appears immediately, fully formed").
3. If no promise exists for `targetIdx` (pre-fetch was never started — e.g. a `gap_jump` skipped
   directly to a topic whose own prior-topic hit never fired, Section 9), or the bound in step 2
   elapses without resolution, or the promise resolved `{ ok: false }`: **proceed anyway, using
   whatever is already in `sections[targetIdx].data`** (the plan-time content). This is a disclosed,
   bounded, rare-case fallback: it means that one section, that one time, is not freshly
   live-generated (a narrow, explicit exception to #20, never the normal path) — but the **display
   switch itself is never blocked or delayed indefinitely**, because blocking indefinitely risks
   exactly the "stuck screen" failure mode this whole series exists to prevent (the higher-priority
   guarantee, per the brief's "get this wrong and screens skip, flicker, or stick").
4. Issue the `scroll_to` write for `section_index = targetIdx`, through the **identical**
   `screenQueueRef`/`SCREEN_MIN_DISPLAY_MS` chain `show_visual` uses (same ref object, same
   constant, same code shape as lines 910–925) — this satisfies the Feature Brief's explicit
   requirement to integrate with, not bypass, `LIVE-06`'s existing serialization.
5. **Tolerance target, grounded in RTV-03's measured accuracy:** the display lands at the moment
   the tracker's hit fires — RTV-03's own accuracy report already measures and discloses the gap
   between a topic's true first-mention moment and the tracker's detection moment (its worked
   example shows deltas from 2.7s to 41.5s, Section 5 of that spec). This phase inherits that exact
   distribution as its own precise-sync tolerance — it does not and cannot improve on RTV-03's
   detection latency, since it uses RTV-03's signal unmodified. **The rollout readiness gate above
   is precisely what stands between "this tolerance is acceptable" being a promise vs. being
   evidenced** — RTV-03's own accuracy reports are the mechanism for deciding that, not this
   document.

### 4.6 Bookends in the ON state (Question 5)

- Overview's initial appearance requires no action from this phase: `current_section_index`
  already defaults to `0` and nothing in this design writes to it before the tracker's first hit —
  identical in every toggle state.
- Both bookends' **display** transitions are handled by the exact same generic Section 4.5 logic —
  a hit landing on `section_index = 0` (never happens, state 0 has no incoming hit) or `= N+1`
  (Summary, via its literal "summary" marker, exactly like any topic) triggers the identical
  `scroll_to` write. No special-casing needed for the switch itself.
- Both bookends are **excluded from pre-fetch** (Section 4.4, step 1) — their `data` is fixed,
  deterministic, and was already correctly populated at plan time by `session-bookends.ts`; this
  phase must never attempt to regenerate or overwrite it. This also means pre-fetch triggered when
  entering the last real topic (state `N`) correctly no-ops for its target (`N+1` = Summary), and
  there is no pre-fetch target beyond Summary (`N+2` does not exist — bounds-checked, Section 4.4
  step 1).
- **No collision with real topics:** RTV-02 confirmed (Section 5.3 of that spec) the bookend
  markers are the literal words "overview"/"summary," structurally distinct from any golden word
  (which must, by RTV-02's uniqueness check, appear in exactly one *topic*, and bookends are never
  topics) — so a bookend hit and a topic hit can never be confused with each other by
  `checkRtv03Transition()`, unchanged by this phase.

---

## 5. Visual Examples

No UI exists for this phase. In its place, a text sequence diagram of one full transition in the
ON + gate-passed state, and the OFF-state sequence for contrast — the two states this phase's
entire correctness rests on.

**OFF state (today, unconditionally) — unchanged from pre-RTV-05 behavior:**
```
Clio (LLM) calls show_visual({ section_index: 2 })
  → handler runs (idx resolution, split-context injection, returns TEACH text)
  → screenQueueRef chain: scroll_to(2) queued, respects SCREEN_MIN_DISPLAY_MS
  → DB: current_section_index = 2
  → poll loop (≤2s later): screen shows section 2

[RTV-03 tracker, running in parallel, log-only]
onMessage("...top_p and temperature control...") → hit detected (state 1→2)
  → rtvStateRef.current = 2
  → audit rows written (rtv03_state_advance, quick_summary_cue, next_topic_cue)
  → NO write to walkthrough_state. NO effect on the screen.
```

**ON + gate-passed state (requires Section 4.2's gate — not possible in production today):**
```
[Tracker hit: state 1→2, matched "top_p"]
  rtvStateRef.current = 2
  audit rows written (unchanged from RTV-03)

  if (rtv05DisplayActiveRef.current) {                      // true only when gate passed
    // DISPLAY step for targetIdx = 2
    staged = rtv05StagedContentRef.get(2)                    // started when state 0→1 fired
    await staged (already resolved — plenty of lead time)
    screenQueueRef chain: scroll_to(2) queued, respects SCREEN_MIN_DISPLAY_MS
    → DB: current_section_index = 2, sections[2].data = <freshly generated>
    → poll loop: screen shows section 2, fully formed, no warm-up

    // PRE-FETCH step for targetIdx + 1 = 3
    fetch('/api/rtv05/prefetch-section', { sectionIndex: 3 })
    rtv05StagedContentRef.set(3, thatPromise)                 // resolves well before state 2→3 fires
  }

[Meanwhile, if Clio also calls show_visual({ section_index: 2 })]
  handler runs fully (TEACH text still returned to the LLM)
  if (!rtv05DisplayActiveRef.current) { ... }                 // FALSE — this block does not execute
  // No second write. No race. No flicker.
```

---

## 6. Data Requirements

### 6.1 Reads
- `walkthrough_state.sections` (already loaded by `provision-config` for other purposes; also
  re-read fresh by the new pre-fetch route, Section 4.4 step 4) — source of each `section_index`'s
  assigned `type` and `meta`.
- `template_library.status` — read individually, per distinct non-bookend `type` in the session,
  once at first connect (Section 4.2), via the existing `isTemplateApprovedForProduction()`.
- `sessions.rtv05_display_active`, `sessions.rtv03_tracking_enabled`, `sessions.rtv_eligible`,
  `sessions.session_markers` — all existing or newly-added columns on the same row, read together
  in the same connect request `provision-config` already makes.
- `users.role, industry, ai_maturity, role_level` — read fresh by the new pre-fetch route (Section
  4.4 step 4), identical query shape to `provision-config`'s own existing self-heal path.
- `process.env.NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED` — read once per connect (server) and once
  per component mount (client, from the connect response — never re-derived independently client-side).

### 6.2 Writes

**New migration `supabase/migrations/066_rtv05_display_switch.sql`** (additive only):
```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtv05_display_active boolean;
```
Nullable, no default, no backfill. `NULL` ⇔ "never computed" (pre-this-phase sessions, or a session
whose first connect hasn't happened yet) — treated identically to `false` by every consumer.

- **`sessions.rtv05_display_active`** — written once, at first connect, in
  `provision-config/route.ts`, in the same `update()` call that already writes
  `rtv03_tracking_enabled` (line 505). Never rewritten on a reconnect for the same session (Section
  4.2).
- **`walkthrough_state.sections[idx].data`** — overwritten in place by the new
  `update_section_data` command (Section 6.3), only for the specific `section_index` a successful
  pre-fetch targeted. `id`/`type`/`meta`/`status` on that element are preserved unchanged.
- **`walkthrough_state.current_section_index`** — written by the display step (Section 4.5) via the
  existing `scroll_to` command, identical shape to `show_visual`'s own write.
- No write to `topic_content_cache`, `template_library`, `session_markers`, or any table another
  session/user could ever read — satisfying #20.

### 6.3 API changes

- **`POST /api/hume-native/provision-config`** — additive response field, present only when `rtv03`
  is also present:
  ```ts
  { configId: string, rtv03?: {...}, rtv05?: { displayActive: boolean } }
  ```
- **New `POST /api/rtv05/prefetch-section`** (`app/api/rtv05/prefetch-section/route.ts`):
  - Body: `{ userId: string, sectionIndex: number }` (Zod-validated).
  - Public, userId-keyed, no Clerk session — same convention as
    `/api/walkthrough-state/[userId]` and `/api/generate-visual` (called from the Recall.ai
    headless browser tab, which has no Clerk session).
  - Never returns 5xx for a generation failure — always `{ ok: true | false }` with 200, matching
    `/api/generate-visual`'s existing "never error the agent tool call" convention (even though this
    route isn't a tool call itself, the caller is the same fire-and-forget client code style).
  - Internally: re-reads `sections`, re-validates bounds/non-bookend, builds `UserContext`, calls
    `generateTemplateData()` → `validateTemplateData()` → writes via `update_section_data` on
    success.
- **Extended `POST /api/walkthrough-state/[userId]`** — new third command, added to the existing
  `SectionCommand` union (`app/api/walkthrough-state/[userId]/route.ts`), following the identical
  fetch-then-write-back shape already used by `insert_section` (lines 219–240):
  ```ts
  type UpdateSectionDataCommand = {
    command: 'update_section_data'
    section_index: number
    data: TemplateSection['data']
  }
  ```
  Handler: fetch current `sections`; validate `section_index` is in bounds and the element's
  existing `type` is not `'SessionOverview'`/`'SessionSummary'` (defense in depth — bookends are
  never overwritten even if this route were ever called incorrectly); replace only that element's
  `data` field, preserving `id`/`type`/`meta`/`status`; write the full array back (same last-write-
  wins semantics `insert_section` already has — no new concurrency model introduced). Does **not**
  touch `current_section_index`.

### 6.4 In-memory / client state (new, in `WalkthroughClient.tsx`)
- `rtv05DisplayActiveRef: React.MutableRefObject<boolean>` — seeded `false`, assigned exactly once
  from the `provision-config` response, never reassigned (Section 4.3's proof).
- `rtv05StagedContentRef: React.MutableRefObject<Map<number, Promise<{ ok: boolean }>>>` — seeded
  empty, entries added by pre-fetch calls, read by the display step. Not persisted to
  `localStorage`/`sessionStorage`/`walkthrough_state` — purely in-memory for the life of the
  component, same as every other RTV-03 ref.
- New constants: `RTV05_GENERATION_TIMEOUT_MS = 20_000`, `RTV05_GENERATION_MAX_RETRIES = 1`,
  `RTV05_DISPLAY_WAIT_MS = 15_000`.

---

## 7. Success Criteria (Acceptance Tests)

1. ✓ **Toggle OFF (today's default) — byte-identical.** Given
   `NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED` unset, when any Hume-native session connects, then
   `provision-config`'s response contains no `rtv05` field, `rtv05DisplayActiveRef.current` is
   never set to `true`, `show_visual`'s `scroll_to` write (lines 910–925) fires exactly as before,
   and no `update_section_data` or new-route call is ever made.

2. ✓ **Toggle ON but any non-bookend template unapproved (true for every session today —
   zero approved) — gate resolves false, byte-identical to test 1.** Given
   `NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED = 'true'` and a session whose `sections[1..N]` include at
   least one `type` with `template_library.status !== 'approved'`, when the session connects, then
   `rtv05DisplayActive` is computed `false`, persisted as `false`, and returned as `{ rtv05: {
   displayActive: false } }` — behavior identical to test 1 for the rest of the session.

3. ✓ **All conditions satisfied — gate resolves true, persists, and is reused on reconnect.**
   Given the toggle is on, RTV-03's `rtv03Active` is true, and every one of this session's
   non-bookend `sections[i].type` values individually have `template_library.status = 'approved'`,
   when the session connects, then `rtv05DisplayActive = true` is computed and persisted; when the
   *same session* reconnects later (simulated `LIVE-06b` drop/recover), then the persisted value
   `true` is reused verbatim without recomputation — even if a test harness flips one of those
   templates back to `pending_review` in `template_library` between the two connects (proving
   session-lifetime invariance, Section 4.2).

4. ✓ **Exactly one writer, OFF state.** Given `rtv05DisplayActiveRef.current === false`, when a
   tracker hit fires, then no `scroll_to`/`update_section_data` call originates from the tracker
   block; when `show_visual` is called, its existing `scroll_to` write fires normally.

5. ✓ **Exactly one writer, ON+gate-passed state.** Given `rtv05DisplayActiveRef.current === true`,
   when `show_visual` is called by the LLM, then its handler runs to completion (returns the TEACH
   instruction text) but the specific `scroll_to` write block never executes (assert no fetch to
   `/api/walkthrough-state` originates from that code path); when a tracker hit fires in the same
   session, then its `scroll_to` write **does** execute through `screenQueueRef`.

6. ✓ **Pre-fetch produces live, uncached content.** Given a tracker hit advances state to
   `newState`, when pre-fetch for `newState + 1` runs, then `generateTemplateData()` is called with
   a fresh Anthropic request (assert the mock/real call fires, not a `topic_content_cache` read),
   its result passes `validateTemplateData()`, and it is written to
   `sections[newState+1].data` via `update_section_data` without altering `current_section_index`.

7. ✓ **No warm-up when pre-fetch completed with lead time.** Given pre-fetch for `targetIdx`
   completed well before the corresponding display-triggering hit fires, when the display step
   runs, then it proceeds immediately (no perceptible wait) and the screen shows the freshly
   generated content with no loading state ever rendered.

8. ✓ **Bounded fallback when pre-fetch is late or failed.** Given pre-fetch for `targetIdx` has not
   resolved (or resolved `{ ok: false }`) by the time its display-triggering hit fires and
   `RTV05_DISPLAY_WAIT_MS` has elapsed, when the display step runs, then it proceeds anyway using
   the pre-existing `sections[targetIdx].data` (never blocks indefinitely, never shows a stuck
   screen).

9. ✓ **Bookends are never live-generated.** Given a tracker hit enters `section_index = 0` or
   `= N+1`, when pre-fetch is evaluated for that index (or for the index after the last real
   topic), then no `generateTemplateData()` call is ever made for a bookend index, and the bookend's
   `data` is never altered by this phase.

10. ✓ **Full end-to-end (only meaningful once the readiness gate is genuinely satisfied — not
    achievable in production today, per this document's own Rollout Readiness Gate).** Given a real
    summary-mode Hume-native session with the toggle on, RTV-03 accuracy evidence meeting its bar,
    and every relevant template Arun-approved, when the session runs start to finish, then the
    screen switches for every topic and both bookends in sync with Clio's voice within RTV-03's
    measured tolerance, with zero flicker or stuck screens, and the OFF-state acceptance tests (1,
    2, 4) continue to pass for any session not meeting the gate.

---

## 8. Error States

- **`isTemplateApprovedForProduction()` throws or times out during the session-level gate
  computation:** treated as `false` for that template (fail closed, matching the function's own
  documented behavior on `error || !data`) — `rtv05DisplayActive` resolves `false` for the session;
  connect proceeds unaffected (mirrors RTV-03's "a tracker failure must never block session
  connect").
- **`generateTemplateData()` throws or times out in the pre-fetch route, after the one retry:**
  route returns `{ ok: false }`; `sections[idx].data` is left untouched; the display step's bounded
  fallback (Section 4.5 step 3) handles this — never surfaced to the participant as an error.
- **`validateTemplateData()` rejects the generated data (still under floor after its own internal
  retry):** per RTV-04's existing behavior, falls back to that template's hand-written mock data —
  this phase writes whatever `validateTemplateData()` ultimately returns (mock or real), never a
  known-floor-violating field.
- **`update_section_data` write fails (network/DB error):** logged non-fatal, matching every other
  `walkthrough_state` write in this codebase; `sections[idx].data` simply remains whatever it was
  before the attempt — the display step's fallback (Section 4.5 step 3) covers this identically to
  a generation failure.
- **The display step's `scroll_to` write fails:** identical existing handling to `show_visual`'s own
  write failure (logged, non-fatal, queue chain never rejects — `LIVE-06`'s existing guarantee,
  unmodified).
- **A tracker hit fires for a `targetIdx` this session never had a chance to pre-fetch (e.g. a
  `gap_jump` skipping a topic whose own predecessor hit never fired — Section 9):** no entry in
  `rtv05StagedContentRef` — the display step's "no promise exists" branch (Section 4.5 step 3)
  handles this identically to a failed/late pre-fetch: proceed using existing `sections[idx].data`.
- **`sessions.rtv05_display_active` write fails at first connect:** logged non-fatal; the in-memory
  `rtv05DisplayActive` value computed for *this* connect is still used for *this* connect's client
  session (the client already received it in the response) — only a future reconnect's "reuse
  persisted value" step would be affected, and it would simply recompute fresh instead (falling
  back to the same computation, not failing open or closed incorrectly).

---

## 9. Edge Cases

- **`gap_jump` skips a topic's own pre-fetch target.** If the tracker jumps directly from state `k`
  to `k+2` (topic `k+1`'s golden word never heard), then pre-fetch for `k+2` was still started when
  state `k` was entered (targeting `k+1`... no — per Section 4.4, entering state `k` starts
  pre-fetch for `k+1`, not `k+2`). On a `gap_jump` landing on `k+2`, there is therefore **no**
  pre-fetch entry for `k+2` in `rtv05StagedContentRef` (only one for `k+1`, now orphaned/unused).
  The display step's "no promise exists" fallback (Section 4.5 step 3) applies: `k+2` displays
  using its pre-existing plan-time content this one time, and pre-fetch for `k+3` starts immediately
  as normal from this new current state. One wasted generation call (for the skipped `k+1`) and one
  fallback-content display (for `k+2`) — a narrow, bounded, disclosed cost of the `gap_jump` case,
  never a stuck or wrong screen.
- **A session with only one non-bookend topic (`N = 1`):** states are `0, 1, 2`. Pre-fetch for
  section 1 fires at bootstrap; pre-fetch triggered on entering state 1 targets state 2, which is
  the Summary bookend — correctly no-op'd per Section 4.4 step 1.
- **`insert_section` is invoked mid-session (currently has zero call sites anywhere in this
  codebase, confirmed by grep — Section 0):** would shift `sections` array indices out of alignment
  with RTV-02's fixed `section_index` marker space. Since nothing today calls this command, this is
  not a live risk for this phase; flagged as a dependency note (Section 12) for whichever future
  phase first wires up a real caller of `insert_section` — that phase would need to also reconcile
  RTV-02/03/05's `section_index` assumptions, which is out of scope here.
- **Same-utterance double-match (both `current+1` and `current+2` match in one utterance):** handled
  identically to RTV-03's own resolution — depth-1 wins, `hit.toState = current+1`. This phase's
  pre-fetch/display logic operates on whatever single `hit` RTV-03's `checkRtv03Transition()`
  returns; it never re-derives or second-guesses that result.
- **The session-level gate resolves `true`, but a template's approval is later reset to
  `pending_review` (e.g. its `container_spec` changes, per RTV-04's own edge case) mid-session:**
  the already-persisted `rtv05_display_active = true` is reused verbatim for the remainder of this
  session (Section 4.2/test 3) — the newly-unapproved status only affects **future** sessions'
  first connects, never a session already in progress. This is a deliberate, disclosed trade-off in
  favor of the stronger, race-proof guarantee (Section 4.2's rationale).
- **Mobile vs. desktop:** not applicable — no UI surface, identical to RTV-03.

---

## 10. Out of Scope

- **Improving RTV-03's detection latency or accuracy.** This phase consumes RTV-03's signal exactly
  as built; any future improvement to detection precision (e.g. a dedicated marker for the
  quick-summary checkpoint, flagged as a possible future refinement in RTV-03's own Section 10) is a
  separate, later phase.
- **A per-transition (as opposed to per-session) approval re-check.** Deliberately resolved as a
  session-level, connect-time gate instead (Section 4.2), for the race-proofing reasons given there.
- **Any change to `template_library`, the approval admin UI, or `isTemplateApprovedForProduction()`
  itself.** This phase is a pure consumer of RTV-04's existing, unmodified gate.
- **Any change to RTV-02's marker-generation algorithm or RTV-03's state machine
  (`checkRtv03Transition`).** Both are reused verbatim, unmodified.
- **ElevenLabs or Hume-Custom-LLM support.** Hume-native summary-mode only, per the brief's scope
  guardrail (#16) — confirmed via the second, untouched `show_visual` handler (Section 0).
  `insert_section` wiring for any future caller — explicitly deferred (Section 9).
- **A content cache for pre-fetched visuals.** Explicitly forbidden by #20 — every pre-fetch call is
  a fresh live generation, every session, with no persistence beyond that session's own
  `walkthrough_state` row.
- **Retrofitting fixed-size containers onto the 23 pre-existing templates.** Already flagged as a
  follow-up in RTV-04; unaffected and untouched here.
- **Actually flipping the toggle ON in production.** Explicitly gated on both RTV-03's accuracy
  evidence and Arun's individual template approvals — the Rollout Readiness Gate at the top of this
  document, not a decision this phase makes for itself.

---

## 11. Open Questions

None. All seven of the Feature Brief's questions are resolved above with direct evidence, not
deferred:

1. **#18 toggle design — the core deliverable.** Toggle named
   `NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED`, default OFF. Exact code-path-level authority proof —
   Section 4.3, with the session-level gate (Section 4.2) that makes the proof airtight rather than
   merely asserted. Tied explicitly to `LIVE-06`/`screenQueueRef` throughout Section 4.3/4.5.
2. **Pre-fetch (#7).** Trigger, generation call, staging location, and the #14 "no warm-up"
   mechanism — Section 4.4. No caching — Section 4.4 point 5, Section 6.2. Disclosed reinterpretation
   of "which topic's checkpoint triggers which topic's generation" — stated explicitly in Section
   4.4, not silently assumed.
3. **Display (#8).** Exact write, tolerance target (grounded in RTV-03's own measured accuracy,
   not invented), and `screenQueueRef`/`SCREEN_MIN_DISPLAY_MS` integration — Section 4.5.
4. **Approved-template enforcement.** Session-level, per-template, live-table check (Section 4.2),
   explicitly distinguished from and stricter than `selectApprovedTemplate()`'s existing
   Heatmap/Overlay-only gate (Section 0) — with the deliberate, disclosed timing choice (upfront vs.
   per-render) justified in Section 4.2.
5. **Bookends.** Section 4.6 — display handled generically, pre-fetch explicitly excluded, no
   collision with real topics (grounded in RTV-02's literal-marker design).
6. **End-to-end acceptance.** Test 10 (Section 7) covers the full real-session path; tests 1–2 cover
   the OFF/gate-not-satisfied byte-identical path; the Rollout Readiness Gate at the top of this
   document states the precondition explicitly and grounds it in live, queried evidence.
7. **Rollback.** Tests 1 and 2 (Section 7) are the explicit, testable ACs: toggle OFF, or gate not
   satisfied, is byte-identical to today's `show_visual`-driven behavior with no code change needed
   to revert — flipping the env var (or simply never satisfying the approval gate, as is true today)
   is the entire rollback mechanism.

---

## 12. Dependencies

- **RTV-02, RTV-03, RTV-04** — all three approved, merged, and confirmed live (Section 0). Hard
  dependencies, already satisfied for *building* this phase (though not for *enabling* it — see the
  Rollout Readiness Gate).
- **New migration `066_rtv05_display_switch.sql`** — adds `sessions.rtv05_display_active` (nullable
  boolean, additive only).
- **`NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED`** — new env var, documented in `.env.local.example`
  with a `false`/unset default per this project's standing convention.
- **`RTV_MARKER_GENERATION_ENABLED`, `NEXT_PUBLIC_RTV_TRACKING_ENABLED`** — must be on and
  producing real `rtv_eligible = true` sessions for this phase's display path to ever have anything
  to act on (currently: zero such sessions, Section "Rollout Readiness Gate").
- **`TEMPLATE_LIBRARY_APPROVER_EMAIL`** must be configured, and Arun must individually approve the
  relevant templates via `/dashboard/admin/templates`, before condition 3 of Section 4.2 can ever be
  satisfied for any session (currently: zero templates approved).
- **Files a developer will change or add:**
  1. **New:** `app/api/rtv05/prefetch-section/route.ts` — the pre-fetch generation route (Section
     4.4, 6.3).
  2. **`app/api/hume-native/provision-config/route.ts`** — add the session-level gate computation
     (Section 4.2) alongside the existing `rtv03Active` block; persist `rtv05_display_active` in the
     same `update()` call as `rtv03_tracking_enabled`; add `rtv05` to the JSON response.
  3. **`app/api/walkthrough-state/[userId]/route.ts`** — add the `update_section_data` command
     (Section 6.3), following `insert_section`'s existing fetch/replace/write-back shape.
  4. **`app/dashboard/walkthrough/WalkthroughClient.tsx`**:
     - Add `rtv05DisplayActiveRef`, `rtv05StagedContentRef`, and the three new constants (Section
       6.4).
     - Wrap the existing `scroll_to` write (lines 910–925) in `if
       (!rtv05DisplayActiveRef.current) { ... }` — no other change to that block.
     - Add the pre-fetch/display logic inside the existing tracker-hit block (lines 850–870),
       gated on `if (rtv05DisplayActiveRef.current) { ... }` — RTV-03's existing log-only code
       inside that block is otherwise unchanged.
     - Read `rtv05` from the `provision-config` response (alongside the existing `rtv03` read at
       line 693) and assign `rtv05DisplayActiveRef.current` exactly once.
  5. **`.env.local.example`** — add `NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED=false`.
  6. **New test file:** `tests/unit/rtv05-display-gate.test.ts` — covers tests 1–9 (Section 7)
     against mocked Supabase/Anthropic; test 10 is a manual/real-session acceptance check, only
     meaningful once the Rollout Readiness Gate is genuinely satisfied.

**Nothing else changes.** `checkRtv03Transition()`, `isTemplateApprovedForProduction()`,
`selectApprovedTemplate()`, `generateTemplateData()`, `validateTemplateData()`, and every existing
`show_visual`/poll-loop/`screenQueueRef` code path not explicitly listed above are reused verbatim,
unmodified.

---

## CEO Review

Approved. Section 11 confirmed empty. Independently spot-checked against the live codebase before
approval, not taken on the BA's word alone:

- Confirmed two distinct `show_visual` handlers exist in `WalkthroughClient.tsx` (Hume-native at
  ~874, ElevenLabs at ~1104) — the document's Hume-native-only scope claim (#16) holds.
- Confirmed `insert_section` has zero real call sites in that file (only two comments reference it)
  — the document's "not a live risk today" framing for that command is accurate.
- Confirmed `lib/templates/selector.ts`'s `APPROVAL_GATED_TEMPLATES` is exactly `{Heatmap, Overlay}`
  and `selectApprovedTemplate()` only routes those two through `isTemplateApprovedForProduction()` —
  the document's claim that this phase's own session-level gate is strictly broader (checks every
  non-bookend template, not just the two new ones) is correct and necessary, not overstated.
- Confirmed via a live query against Supabase project `nqxlpcshouboplhnuvrh` at approval time: all 27
  `template_library` rows are still `status = 'pending_review'`, zero `approved`. The Rollout
  Readiness Gate's central claim — that this phase is provably inert on today's data regardless of
  the env toggle — holds as of this review.

The core design decision (Section 4.2: computing the approval gate once per session at first
connect, persisted and reused verbatim across reconnects, rather than re-checked per transition) is
approved as the correct resolution of the race — it is the same class of judgment call RTV-03's own
depth-2 lookahead resolution required, and the reasoning for why a per-transition check would
reintroduce a `LIVE-06`-style window is sound and explicitly disclosed rather than asserted.

Developer agent: build exactly what Section 12 lists. Do not enable
`NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED` in production as part of this build — ship with it
unset/false, matching every other RTV-phase default. Flipping it on, and any related template
approvals, remain Arun's decision alone, gated by the Rollout Readiness Gate at the top of this
document — nothing in the build task changes that.
