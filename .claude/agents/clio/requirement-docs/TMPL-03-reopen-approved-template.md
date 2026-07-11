# TMPL-03: Reopen an Approved Template for Additional Feedback — Requirement Document
Version: 1.0
Status: APPROVED (see CEO Review, end of document)
Author: Business Analyst Agent
Date: 2026-07-11

## 0. Grounding Note (read before the spec)

This phase extends RTV-04 (`.claude/agents/clio/requirement-docs/RTV-04-template-library-and-approval.md`,
deployed) and coexists with TMPL-01 (`.claude/agents/clio/requirement-docs/TMPL-01-automated-feedback-fix-loop.md`,
deployed) — the `template_library` table, `PATCH /api/templates/library/[templateName]` endpoint,
`isConfiguredApprover()`, and `TemplateApprovalClient.tsx` are reused exactly as built, not
re-derived. Nothing below changes RTV-04's or TMPL-01's existing behavior for the `approve` /
`request_changes` / `reset_to_pending` actions, the fix loop, or `isTemplateApprovedForProduction()`
(RTV-05's gate). This document adds exactly one new action, reachable from exactly one new place
(an `approved` card), that does exactly one thing: move a template back to `pending_review` while
preserving its approved visual state.

**Facts confirmed directly against the live code before writing this spec, not assumed:**

- **`app/api/templates/library/[templateName]/route.ts`** (read in full): the `Body` Zod schema
  today accepts exactly `action: z.enum(['approve', 'request_changes', 'reset_to_pending'])`. The
  handler applies `STATUS_MAP[action]` and writes the corresponding `status` **unconditionally** —
  there is **no server-side check of the row's current `status` before applying `reset_to_pending`**
  (the only guard present anywhere in the route is the `approve`-specific `fix_state !== 'none'`
  check added by TMPL-01). This means `reset_to_pending` is not actually *blocked* from being called
  on an `approved` row today — it is simply never *exposed* there, because
  `TemplateApprovalClient.tsx` only renders that button on `changes_requested` cards. So the accurate
  statement is: **reachable today only through the UI's card-type gating, not through any backend
  status guard** — confirmed by reading both files, not assumed from the brief's framing.
- **`app/dashboard/admin/templates/TemplateApprovalClient.tsx`** (read in full): confirmed —
  `row.status === 'pending_review'` renders Approve/Request-changes (or the notes-confirmation
  step); `row.status === 'changes_requested'` renders exactly one button, "Move back to Pending
  Review" (`resetToPending()`, a direct single-click call with no confirmation step or notes field);
  `row.status === 'approved'` renders **no button at all** — only the static "Approved by … on …"
  caption (lines 273–278). There is genuinely no mutating action available on an approved card
  today, confirmed by reading the full conditional-render tree.
- **TMPL-01's automated fix loop** (confirmed by reading its requirement doc in full, Section 0 and
  Section 9): a new cycle's starting point for `Heatmap`/`Overlay` is whatever `style_overrides` is
  already on the row — "the new cycle's starting point is the previous cycle's already-applied
  `style_overrides`, so feedback like 'a little wider still' refines incrementally rather than
  starting from the original unfixed design" (TMPL-01 Section 9). This confirms the brief's
  reasoning: `style_overrides` is a durable, incremental record of the currently-approved look, not
  a transient value that should be discarded on reopen.
- **`lib/templates/approval.ts`'s `isTemplateApprovedForProduction(templateName)`** (read in full,
  lines 57–67): a plain, uncached Supabase read — `SELECT status FROM template_library WHERE
  template_name = $1`, returns `status === 'approved'`. It reads **live** on every call; there is no
  in-memory cache, no snapshot, nothing to invalidate. This is the exact fact the RTV-05-interaction
  question below turns on.
- **`.claude/agents/clio/requirement-docs/RTV-05-prefetch-and-dual-trigger-display.md`** Section 4.2
  (read in full — see the dedicated finding below): RTV-05's own gate (`sessions.rtv05_display_active`)
  is computed **once**, at a session's first connect, and explicitly **persisted and reused verbatim
  on every reconnect for that same session — never recomputed** for the life of that session. RTV-05's
  own spec states the reason in its own words: `template_library.status` is "the one input that
  genuinely can change mid-session: … which Arun can edit live via `/dashboard/admin/templates` while
  a call is in progress," and persisting the decision "closes this off entirely: the decision is
  invariant for a session's entire lifetime, immune even to a live edit in the admin UI while the call
  is in progress." **RTV-05 was written anticipating exactly the action this brief requests, and its
  own design already handles it correctly with no changes required here.**

## 1. Purpose

Design review is not a single pass. RTV-04 built the one-way path (`pending_review` →
`approved`/`changes_requested`) and TMPL-01 built an automated fix loop for the two newest
templates, but neither gives Arun a way back into review once a template has been approved. Today,
if Arun notices something he wants adjusted after approving — in a live session, or simply on
reflection — his only options are to leave it approved as-is or ask the orchestrator to route a
one-off manual change outside the governed workflow entirely. That is exactly the friction RTV-04
and TMPL-01 were built to eliminate, reappearing one step later in the approval lifecycle.

**What failure looks like without this:** every post-approval design thought Arun has either gets
silently dropped (he decides it's not worth the hassle) or gets handled as an ungoverned one-off
outside `template_library`, bypassing the review record RTV-04 exists to create. Either outcome
erodes the exact discipline ("no design ships without my personal sign-off, and that sign-off means
something") RTV-04's own Section 1 was built to guarantee.

## 2. User Story

As **Arun (product owner and sole design approver)**,
I want to move an already-approved template back into review, add more feedback, and have it
re-reviewed and re-approved,
So that approval is never a one-way door — I can keep refining a template's design for as long as I
want, using the exact same review mechanics every time.

As **the RTV-05 developer (future phase, already built and merged, not touched by this phase)**,
I want reopening an approved template to behave exactly as my own spec already assumed it would —
changing `isTemplateApprovedForProduction()`'s answer immediately for any new session, while never
retroactively disrupting a session that already started,
So that this new action requires zero changes to my already-shipped gate logic.

## 3. Trigger / Entry Point

- **Manual (human, new):** Arun (the configured approver — same `isConfiguredApprover()` check used
  by every other mutating action in this workflow, unchanged, fail-closed) visits
  `/dashboard/admin/templates` (existing route, unchanged), switches to the **Approved** tab
  (existing tab, unchanged), and clicks a new **"Reopen for review"** button that this phase adds to
  every card in that tab.
- **No new route.** This lives entirely inside the existing `TemplateApprovalClient.tsx` and the
  existing `PATCH /api/templates/library/[templateName]` endpoint, extended with one new `action`
  value.
- State required: signed in via Clerk, same as every other action in this workflow. No new auth
  model, no new environment variable.

## 4. Screen / Flow Description

### 4.0 Reused from RTV-04/TMPL-01 (unchanged, referenced not redrawn)

The standard in-session template shell, the three-tab structure (`Pending Review` / `Approved` /
`Changes Requested` — **no new tab, per the brief's explicit constraint**), the live-rendered
`TemplateRenderer` preview inside each card, the `Approve`/`Request changes` notes-confirmation flow,
the fix-loop status bulb and "View fix progress →" link, and the empty/error states are all exactly
as RTV-04 and TMPL-01 built them. This phase changes only the **Approved** tab's card actions
(Section 4.1) and, as a direct consequence of the status change, what that same card looks like once
it reappears in the **Pending Review** tab (Section 4.2).

### 4.1 New: the Approved-tab card gains one button

**Screen state — Approved tab, before reopening (unchanged from RTV-04):**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Pending Review (5)] [Approved (22)] [Changes Requested (0)]    │
│  ──────────────────────                                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ● Heatmap                      Approved by arun@… on Jul 10 │   │
│  │ "Graduated intensity across a small grid — e.g. AI          │   │
│  │  maturity by function."                                      │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │      [ live-rendered Heatmap, with any applied      │   │   │
│  │  │        style_overrides from a prior TMPL-01 fix ]    │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │  "Clean, on-brand."                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Screen state — Approved tab, this phase's change (new button added, always visible on every
approved card, disabled + tooltipped for non-approvers exactly like every other mutating button in
this workflow):**
```
│  │ ● Heatmap                      Approved by arun@… on Jul 10 │
│  │ "Graduated intensity across a small grid — e.g. AI          │
│  │  maturity by function."                                      │
│  │  ┌────────────────────────────────────────────────────┐   │
│  │  │      [ live-rendered Heatmap, unchanged ]             │   │
│  │  └────────────────────────────────────────────────────┘   │
│  │  "Clean, on-brand."                                          │
│  │                                                                │
│  │  [ Reopen for review ]                                        │
│  │  (disabled + tooltip "Only the configured approver can        │
│  │   reopen templates" for any other signed-in user, matching    │
│  │   every other action's tooltip wording exactly)                │
│  └──────────────────────────────────────────────────────────┘
```

**Interaction (decided, not left ambiguous):** clicking "Reopen for review" is a **single-click
action with no confirmation dialog and no notes field** — matching the existing "Move back to
Pending Review" button exactly (`resetToPending()`, the closest and most directly analogous existing
action), not the two-step notes-confirmation pattern used by `Approve`/`Request changes`. **Why:**
this action carries no free-text input of its own — Arun's actual feedback is captured by the
existing "Request changes" flow one step later (Section 4.2), so there is nothing here for a notes
field to hold. Adding a confirmation step for an action that is itself fully reversible (reopening
and then simply re-approving with no changes is a completely valid, harmless outcome — Section 9) has
no real safety benefit over the established single-click pattern already used for the one existing
action ("Move back to Pending Review") that is structurally closest to this one: a plain status
transition with no content of its own.

On click: `PATCH /api/templates/library/Heatmap { action: 'reopen_for_review' }` → on success, the
card animates (existing Framer Motion `AnimatePresence` pattern, unchanged) out of the Approved tab
and into the Pending Review tab.

### 4.2 The resulting card — deliberately indistinguishable from a first-time review (decided)

**Screen state — Pending Review tab, immediately after reopening:**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Pending Review (6)] [Approved (21)] [Changes Requested (0)]    │
│  ──────────────────────                                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ● Heatmap                                    [NEW]           │   │
│  │ "Graduated intensity across a small grid — e.g. AI          │   │
│  │  maturity by function."                                      │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │      [ live-rendered Heatmap — IDENTICAL pixels to   │   │   │
│  │  │        the Approved-tab preview a moment ago; any    │   │   │
│  │  │        style_overrides from a prior fix are still    │   │   │
│  │  │        applied, unchanged ]                           │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │                                                              │   │
│  │  [Approve for production]   [Request changes]              │   │
│  │  (identical buttons, identical auth gate, identical         │   │
│  │   notes-confirmation flow as any pending_review card —      │   │
│  │   no "previously approved" banner, no special-casing)       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Decided explicitly, not left to accident:** the reopened card shows **no "previously approved"
indicator, no reference to the old approval note, no history of the prior review**. This is a direct
consequence of clearing `reviewed_by`/`reviewed_at`/`review_notes` (Section 6) and is the correct
behavior per the brief's own success criterion — "the re-review/re-approve cycle after reopening
works identically to a template's very first review … no special-casing needed for 'this was
previously approved.'" This is also consistent with existing behavior: `approve` and
`request_changes` already overwrite `reviewed_by`/`reviewed_at`/`review_notes` on every single call
with no history retained across cycles — reopening introduces no new information-loss pattern that
doesn't already exist in this table today.

From here, Arun uses the **existing, unmodified** "Request changes" button (Section 4.2 above) to
leave his additional feedback — this is a deliberate two-step design, justified in full in Section 6.

### 4.3 Error / edge screen states

**Non-approver viewing the Approved tab:** button renders visibly (read-only viewing is allowed for
everyone, matching RTV-04's own convention) but disabled, with the standard tooltip. Identical visual
treatment to every other gated button already in this component.

**Network failure on reopen click:**
```
│  │  [ Reopen for review ]   ← button returns to normal state, card       │
│  │                            stays in Approved tab unchanged, no        │
│  │                            partial status change. Arun can retry.     │
```
(Matches this component's existing `patchTemplate()` catch-block behavior exactly — non-fatal, row
stays in its previous tab.)

## 5. Visual Examples

All new/changed screen states are drawn in full above: Section 4.1 (Approved-tab button, before and
after this phase's addition) and Section 4.2 (the resulting Pending Review card). The three-tab
shell, the notes-confirmation flow for `Approve`/`Request changes`, and every other screen state are
unchanged from RTV-04/TMPL-01 and are not redrawn here.

## 6. Data Requirements

**No new migration.** Every column this action writes already exists (`status`, `reviewed_by`,
`reviewed_at`, `review_notes` from migration `065_rtv04_template_library.sql`; `fix_state`,
`fix_changes_summary`, `fix_failure_reason` from migration `067_tmpl01_automated_fix_loop.sql`,
already applied per TMPL-01). This phase is a pure application-layer change: one new `action` value
in an existing Zod enum, one new branch in an existing route handler, one new button in an existing
client component.

**Writes — `app/api/templates/library/[templateName]/route.ts`, extended:**
- `Body` schema's action enum extended to
  `z.enum(['approve', 'request_changes', 'reset_to_pending', 'reopen_for_review'])`.
- **New server-side guard, decided (this action is new, so scoping it correctly from the start is
  not "retrofitting" — it is simply defining the new action's own contract correctly; existing
  actions' lack of a current-status guard is unchanged, pre-existing behavior, not touched by this
  phase):** `reopen_for_review` is only accepted when the row's current `status === 'approved'`;
  otherwise the request returns `400` and no column changes. This matches the "never trust the
  client" discipline already established for `reviewed_by` in this same file, applied here to the
  status-transition itself.
- **On success, the update payload is:**
  ```ts
  {
    status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    fix_state: 'none',            // defensive — already 'none' by construction (see Section 9)
    fix_changes_summary: null,    // decided: see justification below
    fix_failure_reason: null,     // defensive — already null when fix_state is 'none'
    updated_at: new Date().toISOString(),
  }
  ```
- **`style_overrides`, `sample_data`, `container_spec`, `fix_cycle_id`, `fix_attempt_count` are left
  entirely untouched — not part of the update payload at all.** This is the one deliberate,
  load-bearing decision in this whole spec, and it is justified directly against TMPL-01's own
  design: `style_overrides` is the durable record of the template's currently-approved visual state,
  and TMPL-01's own fix cycles already treat it as the *starting point* for incremental refinement,
  not a value that gets reset between cycles. Wiping it on reopen would mean the very first
  "Request changes" after a reopen throws away every prior fix and starts the LLM from the
  template's original, pre-fix appearance — directly contradicting the "a little wider still" kind
  of incremental refinement TMPL-01's own Section 9 describes as the intended behavior. Preserving it
  is therefore not merely "safe" but the only choice consistent with the system this action plugs
  into.
- **Why `fix_changes_summary` IS cleared (the one field this action does reset, and why):** on an
  `approved` row, `fix_state` is always `'none'` by construction (TMPL-01's `approve` action already
  rejects approval with `400` while `fix_state !== 'none'` — see `route.ts` lines 77–90 — so no row
  can ever reach `approved` while a fix is mid-flight or failed). But `fix_changes_summary` is **not**
  cleared when a fix cycle succeeds and moves a row to `pending_review`→…→`approved` in the normal
  flow — it persists as history. Left untouched, a reopened card would show a stale "Automated fix
  applied: <description from months-old cycle>" banner (the existing UI condition,
  `row.status === 'pending_review' && row.fix_changes_summary`, `TemplateApprovalClient.tsx` line
  304) on a card that has had no new activity since reopening — misleadingly implying something just
  happened. Clearing it on reopen prevents that stale banner; it does not affect `style_overrides`
  (the actual visual state, which must persist) at all — only the historical description text. The
  next real fix cycle (if any) repopulates it exactly as TMPL-01 already does.
- **`fix_cycle_id`/`fix_attempt_count` are left untouched** — they carry no visible UI meaning while
  `fix_state === 'none'` (only the Fix Progress view reads them, as history, which is fine to retain)
  and TMPL-01's own `request_changes` branch already assigns a fresh `fix_cycle_id` and resets
  `fix_attempt_count` to `0` whenever a new cycle actually starts, so there is nothing stale left
  active by leaving them alone here.
- **No new Inngest event, no new log row, no new table.** Reopening a template that has no
  feedback attached to it yet is not a fix-loop event — `template_fix_log` continues to log only
  actual fix-cycle activity (`feedback_received`, attempts, nudges), unchanged from TMPL-01. If Arun
  subsequently clicks the existing "Request changes" button, that action already writes its own
  `feedback_received` log row and fires `clio/template.fix_requested` exactly as it does today for
  any pending_review card, with zero new code required.

**Reads:** none beyond what `GET /api/templates/library` already returns (`select('*')` already
includes every column this action touches).

**localStorage/sessionStorage:** none, consistent with RTV-04/TMPL-01.

## 6a. Scope: reachable for all 27 templates (confirmed, not assumed)

This action reads and writes only `template_library` columns common to every row regardless of
`provenance` (`existing`/`new`) or fix-loop eligibility — it never calls or checks
`isFixLoopTemplate()` at all. There is no reason to scope it narrower than RTV-04's own approval
workflow itself: any of the 27 templates can be approved, so any of the 27 can be reopened. This
matches the brief's expectation and RTV-04's own precedent (`approve`/`request_changes` already work
identically across all 27 rows).

## 6b. Design decision: two separate steps, not one combined action (decided, justified)

**Decision: reopening and leaving feedback are two separate steps** — click "Reopen for review"
(this phase, no notes field), then, once the card is in the Pending Review tab, click the
**existing, unmodified** "Request changes" button to leave the actual feedback text (RTV-04/TMPL-01,
untouched).

**Why, weighed against combining them into one action:**
- **The brief's own stated success criterion is satisfied only by keeping them separate:** "the
  re-review/re-approve cycle after reopening works identically to a template's very first review —
  same buttons, same auth gate, no special-casing needed." A combined action would necessarily
  special-case the reopen-with-feedback path (e.g., a different request payload shape, a different
  resulting `fix_state` transition happening in one network call instead of two) — exactly the
  special-casing this criterion asks to avoid.
- **A reopen does not always come with feedback.** Arun may reopen a template purely to look at it
  again with fresh eyes — TMPL-01's own Section 9 edge case for the *existing* system already treats
  "reopen, then immediately approve with no changes" as a fully valid, expected outcome once this
  gap is closed (that edge case explicitly names this brief as the place it would be solved). Forcing
  a notes field into the reopen click itself would imply feedback is mandatory every time, which is
  not true.
- **Reuse over duplication, per this project's standing practice** (explicitly invoked by the brief):
  building a second notes-taking UI/API surface that mirrors "Request changes" almost exactly would
  duplicate existing, already-tested code (the confirmation textarea, the `PATCH` notes handling, the
  TMPL-01 fix-loop trigger for `Heatmap`/`Overlay`) for no functional gain — the existing button
  already does exactly what's needed, one tab-transition later.
- **The two-step flow costs Arun one extra click, in exchange for zero new special-casing anywhere in
  the system.** Given this is an infrequent, deliberate admin action (not a high-frequency flow where
  click-count matters), this tradeoff clearly favors reuse.

## 7. Success Criteria (Acceptance Tests)

✓ Given Arun (the configured approver) clicks "Reopen for review" on an `approved` template, then
`status` becomes `pending_review`, `reviewed_by`/`reviewed_at`/`review_notes` become `null`,
`fix_changes_summary`/`fix_failure_reason` become `null`, `fix_state` remains `'none'`, and
`style_overrides`/`sample_data`/`container_spec` are byte-for-byte unchanged in the same response.

✓ Given a template with non-empty `style_overrides` from a prior TMPL-01 fix cycle (e.g. `Heatmap`)
is reopened, then the live-rendered preview on the resulting Pending Review card is pixel-identical
to its preview a moment earlier on the Approved tab — the approved look is never discarded or reset.

✓ Given a user who is **not** `TEMPLATE_LIBRARY_APPROVER_EMAIL`, when they call `PATCH
/api/templates/library/Heatmap` with `{ action: 'reopen_for_review' }` directly (bypassing the
disabled UI button), then the API returns `403` and `status` remains `approved`.

✓ Given `TEMPLATE_LIBRARY_APPROVER_EMAIL` is unset in the environment, when **anyone** calls this
action, then it returns `403` (fail closed, identical to every other action in this endpoint).

✓ Given a template whose current `status` is `pending_review` or `changes_requested` (not
`approved`), when `{ action: 'reopen_for_review' }` is submitted, then the API returns `400` with a
clear error message and no column changes.

✓ Given a template has just been reopened, when Arun clicks the existing, unmodified "Request
changes" button and submits notes, then behavior is byte-for-byte identical to submitting Request
Changes on any other `pending_review` card — for `Heatmap`/`Overlay`, TMPL-01's automated fix loop
triggers exactly as built (`fix_state = 'generating'`, new `fix_cycle_id`, `feedback_received` log
row, `clio/template.fix_requested` event fired); for the other 25 templates, it is a plain
status+note change, exactly as RTV-04 built it.

✓ Given a live session has already connected and computed `sessions.rtv05_display_active = true`
(persisted) before Arun reopens one of that session's non-bookend assigned templates, when that same
session reconnects afterward (e.g. a `LIVE-06b`-style drop/recover), then the persisted value `true`
is reused verbatim (per RTV-05 Section 4.2's own, already-built design) and the in-progress session's
display behavior is completely unaffected by the reopen.

✓ Given a **new** session connects after Arun reopens a previously-approved template that is one of
its non-bookend topics' assigned types, then `isTemplateApprovedForProduction()` returns `false` for
that template on this fresh read, and — assuming `NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED` is on —
that new session's `rtv05DisplayActive` computation resolves `false` for its entire lifetime (per
RTV-05's own "every non-bookend template must be individually approved" rule), until the template is
re-approved and a further new session connects.

✓ Given all 27 templates, when any one is `approved`, then "Reopen for review" is available and
behaves identically regardless of `provenance` or fix-loop eligibility — the action never checks
`isFixLoopTemplate()`.

✓ Given the reopen network call fails client-side, then the card remains in the Approved tab
unchanged, the button returns to its normal (non-loading) state, and Arun can retry — no partial
state, matching this component's existing failure handling for every other action.

## 8. Error States

- **Wrong user:** `403 { error: 'Only the configured approver may change template approval
  status.' }` — identical message/shape to every other gated action in this endpoint (no new error
  copy introduced).
- **`TEMPLATE_LIBRARY_APPROVER_EMAIL` unset:** `403` for everyone, same one-time server warning log
  as every other action (`isConfiguredApprover()`, unchanged).
- **Current status is not `approved`:** `400 { error: 'Cannot reopen — template is not currently
  approved.' }`. No partial state change.
- **Malformed/missing body:** `400` via the existing Zod validation, unchanged pattern.
- **DB update failure:** `500 { error: 'Update failed' }`, identical existing generic handling.
- **Client-side network failure:** non-fatal — row stays in its previous tab (existing
  `patchTemplate()` catch-block behavior, unchanged), Arun can retry.

## 9. Edge Cases

- **The RTV-05-interaction question (resolved in full, with code evidence — the central question
  this brief asked BA to answer):**
  - `isTemplateApprovedForProduction()` (`lib/templates/approval.ts` lines 57–67) performs a plain,
    uncached Supabase read of `template_library.status` on every single call. The instant a
    template's `status` changes from `approved` to `pending_review` via this action, any *subsequent*
    call to this function for that template name returns `false` — there is nothing to invalidate,
    because nothing is cached.
  - **RTV-05's own gate (`sessions.rtv05_display_active`) is computed exactly once, at a session's
    first connect, and explicitly persisted and reused verbatim on every reconnect for that same
    session — never recomputed** (RTV-05 requirement doc, Section 4.2, confirmed by direct read).
    RTV-05's own spec identifies `template_library.status` as "the one input that genuinely can
    change mid-session" specifically because Arun can edit it live via this same admin page while a
    call is in progress, and states plainly: "Persisting the value at first connect and reusing it
    verbatim on every subsequent connect for the same session closes this off entirely: the decision
    is invariant for a session's entire lifetime, immune even to a live edit in the admin UI while the
    call is in progress."
  - **Conclusion, precisely stated:** reopening an `approved` template has **zero effect on any
    session that already connected and computed its display-authority decision** — that decision is
    frozen for the session's whole lifetime, including across reconnects, exactly as RTV-05 was
    designed to guarantee. It **does** have an immediate, real effect on any **new** session that
    connects *after* the reopen: at that connect, RTV-05's gate computation calls
    `isTemplateApprovedForProduction()` fresh for every non-bookend template the new session will use,
    sees `pending_review` for the reopened one, and — because RTV-05 requires **every** non-bookend
    template to individually be approved — that new session's overall `rtv05DisplayActive` resolves
    `false` for its entire lifetime, until the template is re-approved and yet another new session
    connects. **This is exactly the behavior RTV-05's own design already produces, correctly, with no
    changes required by this phase.**
  - **Precedent within this same project confirming the pattern generalizes:** RTV-04's own Section 9
    edge case states, for a different trigger (`container_spec` changing after approval), "an
    approval is a sign-off on a specific rendered design, not a standing blank check for that
    template name forever." Reopening for review is the human-initiated version of the same
    principle — an approval's authority for *future* sessions ends the moment `status` changes away
    from `approved`, while sessions already relying on the prior decision are structurally insulated
    by RTV-05's persist-once design, not by this phase doing anything special.
  - **Practical stakes today:** RTV-05 is not enabled in production (`NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED`
    is off by default and, per RTV-05's own Rollout Readiness Gate, zero templates were approved as of
    that document's writing), so this has zero live impact today — but the answer above is verified
    correct for whenever RTV-05 does go live, per the brief's own instruction.
- **Reopening a template with an active fix history (`Heatmap`/`Overlay`):** always safe —
  `fix_state` is guaranteed `'none'` on any `approved` row (TMPL-01's own `approve` action already
  rejects approval while `fix_state !== 'none'`), so there is never a fix cycle "in flight" to
  interrupt by reopening.
- **Reopen, then immediately re-approve with no feedback given:** a fully valid, expected outcome —
  Arun looked again and decided it's still fine. Identical mechanics to any first-time approval;
  `reviewed_by`/`reviewed_at` are freshly set again.
- **Two reopen requests racing (e.g. a double-click):** the second request, if it reads the row
  before the first commits, could in principle also pass the `status === 'approved'` guard and apply
  a redundant, idempotent update; if it reads after, it correctly receives `400`. Either outcome is
  harmless (last-write-wins on a single-approver workflow, matching the existing, accepted
  concurrency behavior already documented for every other action on this table, e.g. RTV-04 Section
  9's "two people approve at once" case).
- **Reopening one of the 25 templates with no fix-loop support:** identical mechanics — moves to
  `pending_review`; a subsequent "Request changes" behaves exactly as RTV-04 built it for those 25
  templates today (status + note only, no automated fix), consistent with `RTV04_VALIDATED_TEMPLATES`
  scoping.
- **Reopening `QuoteCallout` (the generic-fallback special case):** no special handling — the generic
  card is reviewed and re-approved exactly as any other template, matching RTV-04's own Section 9
  treatment of this case.
- **Mobile/desktop:** internal admin tool, desktop-only, consistent with RTV-04/TMPL-01's own
  precedent.

## 10. Out of Scope

- **Any change to `isTemplateApprovedForProduction()`, RTV-05's session-level gate computation, or
  any live-session wiring.** This phase relies entirely on RTV-05's already-built, already-merged
  design (Section 9) and touches none of that code.
- **A combined "reopen + leave feedback in one step" action.** Deliberately two separate steps
  (Section 6b), reusing the existing "Request changes" flow rather than duplicating it.
- **Any new migration or schema change.** Every column this action writes already exists from
  migrations `065`/`067`.
- **A "previously approved" history banner or audit trail on the reopened card.** Deliberately absent
  (Section 4.2) — matches this table's existing behavior of overwriting review metadata on every
  status-changing action, and satisfies the brief's "no special-casing" success criterion directly.
- **A confirmation dialog or notes field on the "Reopen for review" button itself.** Single-click,
  matching the existing "Move back to Pending Review" precedent (Section 4.1).
- **Extending the automated fix loop, or its slot allowlists, to any additional templates.** Entirely
  untouched by this phase — TMPL-01's `Heatmap`/`Overlay` scoping is unaffected.
- **Adding a current-status guard to the pre-existing `approve` / `request_changes` /
  `reset_to_pending` actions.** Their existing (unguarded, UI-gated-only) behavior is untouched;
  only the brand-new `reopen_for_review` action defines and enforces its own status precondition.

## 11. Open Questions

None. The brief's central technical question (the RTV-05-interaction question) is resolved with
direct code evidence in Section 9, not deferred: `isTemplateApprovedForProduction()` is confirmed
uncached and reads live; RTV-05's own gate is confirmed to persist its decision once per session and
never recompute, per that document's own Section 4.2, which was itself written anticipating exactly
this scenario. The action name, its exact field-level behavior (what is cleared vs. preserved), the
27-template scope, the single-click UI decision, and the two-step-vs-combined-action design are all
resolved with justification in Sections 4, 6, and 6b, per the brief's own instruction to resolve
these with technical judgment rather than leave them open.

## 12. Dependencies

- RTV-04's `template_library` table, `PATCH /api/templates/library/[templateName]` endpoint,
  `isConfiguredApprover()`, and `TemplateApprovalClient.tsx` — extended, not replaced.
- TMPL-01's `fix_state`/`style_overrides`/`fix_changes_summary`/`fix_failure_reason` columns
  (migration `067_tmpl01_automated_fix_loop.sql`, already applied) — read and selectively written by
  this action; no new migration required.
- No dependency on RTV-05 being enabled in production — this phase's correctness relies only on
  RTV-05's already-built, already-merged gate design (Section 4.2 of that document), not on the
  `NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED` toggle's current value.
- No dependency on TMPL-01's fix-generator/slot-allowlist logic — this phase only concerns the
  status-transition action itself, per the brief's own scope constraint.

---

## CEO Review

Approved. Section 11 confirmed empty. Independently spot-checked before approval:

- Confirmed the current PATCH route's action enum has exactly 3 values (`approve`, `request_changes`,
  `reset_to_pending`) with no `reopen_for_review` — this genuinely doesn't exist yet.
- Confirmed the only status-guard in the route today is the `fix_state !== 'none'` check on `approve`
  — `reset_to_pending` has no current-status guard, exactly as the spec states.
- Confirmed `TemplateApprovalClient.tsx`'s `row.status === 'approved'` block only renders the static
  caption — no mutating button exists on approved cards today.
- Confirmed `isTemplateApprovedForProduction()` is a plain, uncached, live Supabase read — exactly as
  the RTV-05-interaction finding depends on.
- Independently recall (having built and verified RTV-05 myself earlier in this project) that its
  gate computation is persisted once per session and never recomputed — this spec's finding matches
  my own prior verification precisely.

The core design decisions are approved without reservation: preserving `style_overrides` on reopen
(consistent with TMPL-01's incremental-refinement model), clearing `reviewed_by`/`reviewed_at`/
`review_notes`/`fix_changes_summary` (no stale banners, no special-casing a reopened card differently
from a first-time review), the new `status === 'approved'` precondition on this new action only, and
the deliberate two-step design (reopen, then reuse the existing Request-changes flow) rather than
duplicating UI/API surface. The RTV-05-interaction analysis is correct and requires no changes to
RTV-05 itself — this is exactly the scenario that phase's persist-once design was built to handle.

Developer agent: implement exactly what Sections 4 and 6 specify — one new action, one new button, no
new migration, no new route. Do not touch RTV-05, TMPL-01's fix-generator logic, or add a confirmation
dialog/notes field to the reopen action itself.
