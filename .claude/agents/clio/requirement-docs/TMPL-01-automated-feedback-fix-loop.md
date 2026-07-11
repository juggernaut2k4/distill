# TMPL-01: Automated Template Feedback → LLM Fix → Re-Review Loop — Requirement Document
Version: 1.0
Status: APPROVED (see CEO Review, end of document)
Author: Business Analyst Agent
Date: 2026-07-10

## 0. Grounding Note (read before the spec)

This phase extends RTV-04 (`.claude/agents/clio/requirement-docs/RTV-04-template-library-and-approval.md`,
deployed) — the `template_library` table, `/dashboard/admin/templates` admin page, and
`PATCH /api/templates/library/[templateName]` endpoint are reused exactly as built, not
re-derived. Nothing below changes RTV-04's existing `pending_review` / `approved` /
`changes_requested` statuses, the `isConfiguredApprover()` fail-closed gate, or
`isTemplateApprovedForProduction()` (RTV-05's gate). This document only adds what happens
automatically between "Arun clicks Request changes" and "Arun sees a fixed version."

**The Feature Brief's central open question, resolved:** does the LLM edit the real `.tsx`
renderer file (requiring a commit + Vercel deploy before Arun can see the fix), or does the
system use a runtime style-override mechanism? **This spec chooses the runtime style-override
path.** Reasoning, checked directly against this codebase:

- This project's deploy pipeline is Vercel + GitHub with no in-app hot-swap of compiled React
  components (confirmed: `CLAUDE.md`'s stack table, no CI/CD or git-write tooling anywhere in
  `lib/`). For an LLM to "edit the renderer file" would require the running Next.js app to hold
  git write credentials and either shell out to `git`/call the GitHub API to commit, or invoke a
  Vercel deploy — none of which is an approved package or pattern anywhere in this codebase, and
  committing unreviewed LLM-authored source directly to `main` is a materially bigger governance
  departure than anything built in the RTV series so far.
- A style-override column (`template_library.style_overrides`, jsonb) that the renderer reads at
  render time needs no build and no deploy — a fix is a single `UPDATE` statement, live on Arun's
  next page load. This directly satisfies requirement #3 ("moves back to pending review
  automatically") without inventing any deploy-status-polling machinery.
- Read in full for this decision: `components/templates/renderers/Heatmap.tsx` and `Overlay.tsx`.
  Both already hardcode their visual parameters as literal Tailwind classes and a small number of
  named constants (`INTENSITY_STYLES`, `COLOR_HEX`, `MAX_ROWS`/`MAX_COLUMNS`, `PANEL_W`/`PANEL_H`).
  **Important technical fact this design depends on:** Tailwind compiles class names statically at
  build time by scanning source files — a dynamic class-name string coming from a database column
  at runtime would never be in the compiled CSS and would silently do nothing. This is why style
  overrides in this spec are applied via inline `style={{ }}` attributes (plain CSS, evaluated at
  render time, no build step involved) layered on top of the existing Tailwind-driven shell, never
  as dynamic Tailwind class strings.
- This same choice also resolves the brief's deploy-question (Q5) as a structural non-issue rather
  than a tradeoff to arbitrate: **there is no deploy in this design, so "autonomous deploy vs.
  orchestrator-verified deploy" does not apply.** The project's standing discipline of independent
  verification before anything ships is preserved in spirit, not abandoned — it becomes mechanical
  schema/format validation of the LLM's JSON output (Section 4.1) before a fix is ever shown to
  Arun as "ready," which is the correct analogue of `tsc`/build verification when there is no code
  being shipped. Arun's own re-review at that point is the final human check, exactly as it already
  is for a first-time review.

**Scope enforcement, resolved:** because the fix mechanism only ever writes a JSON value into one
column of one row (`template_library.style_overrides` WHERE `template_name = <target>`), it is
structurally impossible for a fix cycle to touch any other row, any other table, or any file —
there is no file-write code path anywhere in this design for the LLM's output to travel through.
Section 4.1 adds two further layers on top of that structural fact: a fixed per-template allowlist
of stylable "slots," and closed-set/range validation of every proposed value.

**Arun's live addendum (added mid-spec, both fully designed in below, not deferred):**
1. On a failed fix attempt, the LLM must self-diagnose and retry automatically (his words: *"if
   llm fails, llm needs to identify the fix and deploy again"*) — not stop after one attempt. A
   bounded cap is still required (Arun did not specify a number and explicitly left it to this
   document to pick a sane one) — designed in Section 4.2 / 6 as **5 automatic attempts per fix
   cycle**, each attempt informed by why the previous one was rejected.
2. A separate, per-template **progress/console view**, linked from below each template card, showing
   timestamped log entries of what the fix pipeline is doing, plus a manual **"nudge"** action
   (status check or force-retrigger) for when Arun has waited (his stated reference point: ~30
   minutes) and seen nothing. Fully designed in Section 4.3 and Section 6.

**Two new accent-color tokens are proposed below (Section 4.2) — flagged explicitly, not silently
added**, per Arun's own instruction ("let me know if you need any other status or colors"). This is
a proposal for CEO/Arun confirmation at spec-review time, not a blocking open question — see
Section 4.2 for the full reasoning and Section 11 for why this is not listed there.

## 1. Purpose

RTV-04 built the "Request changes" action, but today it only writes a status and a note — nothing
acts on it. For 27 templates, and especially the 2 genuinely new ones (`Heatmap`, `Overlay`) that
are actively being iterated on, every visual tweak currently requires a full manual round-trip:
Arun leaves a note, tells the orchestrator directly, the orchestrator asks a developer agent to
edit the renderer, the change is committed and deployed, and only then can Arun re-review. This
does not scale and adds a multi-step delay to every small design tweak.

This phase closes that loop. Arun's own free-text feedback becomes the trigger for an LLM-generated
visual fix, scoped by construction to only that one template's approved set of style parameters,
validated mechanically before Arun ever sees it, and automatically resubmitted for his re-review —
repeating for as many rounds as he needs, with a distinct, honest state for when the automation
cannot produce a valid fix. Without this phase, the "Changes Requested" tab remains a queue of notes
nobody acts on automatically, and the friction RTV-04 was built to reduce simply reappears one step
earlier in the pipeline.

**What failure looks like without this:** Arun keeps having to personally route every visual nit
through the orchestrator; the 2 new templates take many manual cycles to converge on something
approvable; RTV-05 stays blocked longer than necessary because template approval is a bottleneck.

## 2. User Story

As **Arun (product owner and sole design approver)**,
I want to leave feedback on a template and see a fix attempt at it automatically, without having to
personally ask the orchestrator to make the change,
So that reviewing and iterating on templates is fast enough to actually do for all 27 of them.

As **Arun**, when I check back after leaving feedback, I want to clearly see (a) whether a fix is
still being worked on, (b) whether it succeeded and is ready for me to look at again, or (c) whether
it failed and needs my attention — and I want a way to see exactly what the system has been doing
and to nudge it if it looks stuck,
So that I never have to guess what's happening or wonder if my feedback silently went nowhere.

As **the RTV-05 developer (future phase, not built yet)**,
I want this automated loop to be structurally incapable of moving a template to `approved` on its
own, and incapable of touching any file or any other template's row,
So that `isTemplateApprovedForProduction()` remains exactly as trustworthy as RTV-04 already made it,
regardless of how many automated fix cycles a template went through to get there.

## 3. Trigger / Entry Point

No new route for the core loop — it lives entirely inside the existing
`/dashboard/admin/templates` page (RTV-04, unchanged) plus one new route for the progress view
(Section 4.3).

- **Manual (human, existing action, extended):** Arun (the configured approver — same
  `isConfiguredApprover()` check, unchanged, fail-closed) clicks **"Request changes"** on a card in
  the **Pending Review** tab (this action is unavailable on `approved` or `changes_requested` cards
  today and remains so — see Section 9) and submits notes. This is the same UI action RTV-04 already
  built; this phase only extends what happens after submission.
- **Automatic (backend, new):** the instant that submission is accepted server-side, the same
  `PATCH` request that flips `status` to `changes_requested` also sets `fix_state = 'generating'`
  and fires an Inngest event, `clio/template.fix_requested` (naming convention confirmed against
  `inngest/feedback-processor.ts`'s existing `clio/feedback.received` pattern). No second click, no
  separate "generate fix" button — this matches Arun's own stated flow ("he submits feedback... that
  feedback should be sent to an LLM").
- **Manual (human, new — the nudge action):** from the new per-template progress view (Section 4.3),
  Arun can trigger a status check or force a new fix attempt. Gated by the same
  `isConfiguredApprover()` check as every other mutating action in this workflow.
- State required for all of the above: signed in via Clerk, same as RTV-04. No new auth model.

## 4. Screen / Flow Description

### 4.0 Reused from RTV-04 (unchanged, referenced not redrawn)

The standard in-session template shell (RTV-04 Section 4.0), the `Pending Review` / `Approved` /
`Changes Requested` tab structure, the `Approve` confirmation flow, and the empty/error states are
all exactly as RTV-04 built them. This phase changes the **Changes Requested** tab's card content
(Section 4.2) and the **Pending Review** tab's card content when a card arrived there via an
automated fix (Section 4.2), and adds one new route (Section 4.3).

### 4.1 Structural Enforcement Mechanism for the Fix Loop (new)

Two layers, mirroring RTV-04's own two-layer enforcement pattern (Section 4.1 of that document) but
for style **overrides** instead of generated **content**:

**Layer 1 — a fixed, per-template allowlist of "style override slots."** Each template that
participates in this loop (this phase: `Heatmap` and `Overlay` only, matching the existing
`RTV04_VALIDATED_TEMPLATES` precedent already in `lib/templates/generator.ts` line 25 — the same
project convention of scoping new mechanisms to the 2 actively-iterated templates first, not
retrofitting all 25 pre-existing ones without separate sign-off) declares, once, by a human
developer, the exact set of visual parameters an automated fix may ever change. This is authored
directly against the real renderer code, not invented in the abstract. Representative example, read
directly from `Heatmap.tsx`:

| Slot | Constrains | Valid values |
|---|---|---|
| `intensity-0` … `intensity-4` | the 5 heat-ramp cell colors (today hardcoded in `INTENSITY_STYLES`) | one of the project's approved accent hex values only (closed set — see below, never an arbitrary hex) |
| `cell-size` | the fixed `64px` cell width/height | integer, 48–96 (px) |
| `cell-gap` | the `m-0.5` gap between cells | integer, 0–8 (px) |

And from `Overlay.tsx`:

| Slot | Constrains | Valid values |
|---|---|---|
| `zone-color-purple/cyan/amber/green` | the 4 fixed `COLOR_HEX` zone-marker colors | one of the project's approved accent hex values only |
| `callout-width` / `callout-height` | the fixed `220px × 96px` callout card | integer, width 180–280 / height 80–130 (px) |
| `panel-border-width` | the base panel's `border-2` | integer, 1–4 (px) |

These tables are illustrative of the kind of slot list a developer authors per template — the exact
final slot names/ranges are a one-time implementation task for the developer agent building this
phase, not something the LLM ever gets to define or expand.

**Color values are drawn from a closed set, not free-form hex.** Per `CLAUDE.md`'s own design system
("No renderer introduces a color outside this set" — confirmed in RTV-04 Section 4.0), any
color-type slot's proposed value must be one of the project's existing approved accent tokens
(`#7C3AED`, `#A855F7`, `#06B6D4`, `#F59E0B`, `#10B981`, `#EF4444`, plus the 2 new tokens proposed in
Section 4.2 if confirmed) — never an arbitrary hex string the LLM invents. This eliminates
off-brand-color risk by construction, not by asking the LLM nicely.

**Layer 2 — mechanical, all-or-nothing validation before anything is shown to Arun as "ready."** A
new validator checks a proposed override object against exactly that template's slot table:
- Any key not in the allowlist → the entire proposed fix is rejected (not partially applied).
- Any value failing its slot's specific check (not in the closed color set; not an integer in the
  stated range) → the entire proposed fix is rejected.
- Only if every key and every value passes does the fix get applied and the template move to
  `pending_review`.

**The LLM itself never has file-system or git access, and never sees any other template's data.**
Its input is exactly: the target template's current `sample_data`, its current `style_overrides` (if
any, for incremental refinement), its slot allowlist with per-slot constraints spelled out, and
Arun's feedback text. There is no channel through which it could even attempt to reference another
file — this is defense in depth on top of Layer 2's mechanical check.

### 4.2 The Fix Cycle — states, retries, and the new statuses/colors (new)

**Data model concept:** the existing `status` column keeps its exact 3 RTV-04 values
(`pending_review` / `approved` / `changes_requested`) — the 3 tabs are unchanged. A new `fix_state`
column (`none` / `generating` / `failed`) is layered underneath `changes_requested` only — it is
always `none` when `status` is `pending_review` or `approved`. This directly answers "do you need an
additional status" without disturbing the 3-tab structure Arun already has (he explicitly said the
indicator doesn't need to replace the tab structure).

**Proposed status/color mapping — flagged explicitly for confirmation, not silently invented:**

| Status shown | Underlying `status` / `fix_state` | Color | Note |
|---|---|---|---|
| Approved | `approved` / `none` | green `#10B981` | unchanged, existing token |
| Pending Review | `pending_review` / `none` | **blue `#3B82F6`** (NEW token) | Arun asked for "blue" explicitly; `CLAUDE.md`'s existing palette has no blue today (its closest is cyan `#06B6D4`, defined for a different purpose — "secondary highlights, data" — so reusing cyan risks a confusing double-meaning). Proposing one new token, reserved for this status only. |
| Submitted for feedback | `changes_requested` / `none` | red `#EF4444` | unchanged, existing token, Arun's exact mapping |
| Generating fix | `changes_requested` / `generating` | amber `#F59E0B` (existing token, reused for "in progress") | pulsing/spinning `Loader2` icon (already imported in `TemplateApprovalClient.tsx`), label "Generating fix…" |
| Fix failed | `changes_requested` / `failed` | **orange `#F97316`** (NEW token) | Must be visually distinct from red (`changes_requested` itself already means "awaiting Arun," not "broken" — conflating the two would undermine the glanceable-status goal) and from amber (`generating`, a different, non-alarming meaning). `AlertTriangle` icon (lucide-react, same approved package), label "Fix failed — needs attention." |

Both new tokens are a small, additive extension to the fixed 6-color system in `CLAUDE.md` — used
nowhere else in the product, scoped to this one status indicator, and explicitly surfaced here per
Arun's own invitation rather than added without comment. This is a proposal awaiting confirmation at
the normal CEO/Arun spec-review step already built into this project's governance model — see
Section 11 for why this is not a blocking open question.

**The "bulb" per card:** each template card shows a small colored status dot matching the table above
— glanceable, doesn't require reading text to know the state.

**Bounded automatic retry (Arun's live addendum #1).** When `fix_state` becomes `generating`, the
Inngest function below runs up to **5 attempts** in the same cycle before giving up:

- **Why 5, and why bounded at all:** each attempt is a real Anthropic API call — with no deploy step
  in this design (Section 0), attempts are cheap relative to a file-edit-and-deploy design, which is
  a real point in the override architecture's favor now that unattended retrying is required. But
  "unbounded silent retry" is exactly the operational-cost risk the orchestrator flagged and Arun
  acknowledged needs a cap. 5 gives real room for the LLM to self-correct using the specific reason
  its previous attempt was rejected (matching Arun's own words — "identify the fix and... again")
  without an unbounded cost/latency tail. This is a wider allowance than the "1 retry" convention
  already established in `generator.ts`'s Layer 1 (Section 4.1's under-floor retry) because that
  retry addresses a much narrower, mechanically-detected problem (a too-short field); here the model
  is interpreting open-ended free text into a structured, constrained fix, where more self-correction
  headroom is reasonable.
- **What each retry sees:** the full history of this cycle's prior rejected attempts (each proposed
  override set plus the specific reason it was rejected — unknown key, out-of-range/non-approved
  value, malformed JSON, or the model's own "unable to address" self-report), so each attempt can
  genuinely self-diagnose rather than blindly repeating the same mistake.
- **Immediate terminal cases (no further retries even if attempts remain):** if the model itself
  reports it cannot express Arun's feedback within the allowed slot set (e.g. "add a new zone" or "
  change the whole layout" — structurally out of scope for a styling-only fix), retrying will not
  help — the cycle goes straight to `fix_state = 'failed'` with that explanation, rather than burning
  the remaining attempt budget.
- **After 5 attempts (or an immediate terminal case):** `fix_state` becomes `failed`, visibly and
  permanently until Arun acts — never silently stops retrying without a visible signal. `status`
  never moves to `pending_review` on a failed cycle.
- **Never assume the loop always converges.** Per Arun's own stated risk tolerance, this is treated
  as a genuinely experimental mechanism — the bounded-retry-then-visible-failure design exists
  precisely so a human (Arun, or the orchestrator via the progress view) always has a clear, visible
  point to step in if automation isn't converging, rather than the system ever implying "still
  working" indefinitely.
- **Arun's manual "Force retrigger" (Section 4.3) is explicitly uncapped** — because it requires his
  own deliberate action each time, it is not the silent/unattended cost risk the 5-attempt cap
  guards against. Each force-retrigger simply runs one more attempt (attempt 6, 7, … as needed).

**Approval is blocked while a fix is in flight or failed, enforced server-side, not just by hiding
the button.** Today's UI only shows the Approve button when `status === 'pending_review'`, which
already prevents Arun from approving mid-fix through the UI — but this phase adds an explicit
server-side guard to `PATCH .../[templateName]` too: an `approve` action is rejected with `400` if
`fix_state !== 'none'`, so a direct API call cannot bypass the intended flow either (matching this
codebase's established "never trust the client" convention — e.g. `reviewed_by` is already never
client-supplied).

### 4.3 New: Per-Template Fix Progress View (Arun's live addendum #2)

**New route:** `app/dashboard/admin/templates/[templateName]/progress/page.tsx` +
`TemplateFixProgressClient.tsx`.

**Entry point:** a small text link, **"View fix progress →"**, appears below any template card that
has ever had at least one fix cycle (i.e. has at least one `template_fix_log` row — see Section 6).
It does not appear on a card with no fix history (nothing to show). While `fix_state` is `generating`
or `failed`, the link is visually emphasized (amber/orange respectively, matching the card's own
bulb color) so it's obvious there's something to check, not just a static footer link.

**Screen — Fix Progress view:**
```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Template Library         Heatmap — Fix Progress         │
│                                                                    │
│  Status: ● Generating fix (attempt 3 of 5)                        │
│  Last update: 2 minutes ago                                        │
│                                                                    │
│  Current cycle                                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 14:02:01  Feedback received: "Cells feel too dense —       │   │
│  │           more breathing room between them."                │   │
│  │ 14:02:03  Attempt 1 of 5 started                             │   │
│  │ 14:02:11  Validation failed — proposed key "cell-padding"   │   │
│  │           is not an allowed slot for Heatmap. Retrying.      │   │
│  │ 14:02:14  Attempt 2 of 5 started                             │   │
│  │ 14:02:21  Validation failed — "cell-gap" value 14 is        │   │
│  │           outside the allowed range (0–8). Retrying.         │   │
│  │ 14:02:24  Attempt 3 of 5 started                             │   │
│  │           (in progress...)                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                    │
│  [ Check status now ]        [ Force retrigger fix attempt ]      │
│  (both disabled + tooltip "Only Arun can do this" for non-        │
│   approvers)                                                       │
│                                                                    │
│  ▸ Previous cycles (2)                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Screen — terminal failure state (after 5 attempts exhausted):**
```
│  Status: ⚠ Fix failed — needs attention                            │
│  Last update: 34 minutes ago                                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ... (full attempt history as above) ...                     │   │
│  │ 14:05:02  Attempt 5 of 5 failed — "zone-color-teal" is not   │   │
│  │           an approved color token.                            │   │
│  │ 14:05:02  Fix cycle failed after 5 attempts. Needs Arun's    │   │
│  │           attention or a manual design change.                │   │
│  └──────────────────────────────────────────────────────────┘   │
│  [ Check status now ]        [ Force retrigger fix attempt ]      │
```

**Screen — nudge action feedback (inline, no navigation):** clicking "Check status now" appends a
fresh log line (`14:36:10  Status checked by arun@… — still generating fix (attempt 3 of 5), no
change since last check.`) and refreshes the view. Clicking "Force retrigger fix attempt" appends
(`14:36:40  Fix attempt force-retriggered by arun@… (attempt 6)`) and immediately starts a new
attempt, uncapped by the 5-attempt automatic limit (Section 4.2).

**Screen — no fix history yet (should rarely be linked to, included per the "describe every state"
rule):**
```
│           No fix cycles yet for this template.                     │
```

## 5. Visual Examples

All new/changed screen states are drawn in full in Section 4.2 (status bulb/color table doubles as
the visual spec for the card-level indicator) and Section 4.3 (the 4 progress-view states). The
`Approved` tab, the `Approve` confirmation flow, and the empty/error states are unchanged from
RTV-04's own Section 4.3 wireframes and are not redrawn here.

## 6. Data Requirements

**New migration `067_tmpl01_automated_fix_loop.sql`:**
```sql
ALTER TABLE template_library
  ADD COLUMN IF NOT EXISTS fix_state           text        NOT NULL DEFAULT 'none', -- 'none' | 'generating' | 'failed'
  ADD COLUMN IF NOT EXISTS style_overrides     jsonb       NOT NULL DEFAULT '{}'::jsonb, -- currently-applied slot values
  ADD COLUMN IF NOT EXISTS fix_changes_summary text,                                -- LLM's own account of what it changed, shown to Arun
  ADD COLUMN IF NOT EXISTS fix_failure_reason  text,                                -- populated only when fix_state = 'failed'
  ADD COLUMN IF NOT EXISTS fix_attempt_count   int         NOT NULL DEFAULT 0,       -- attempts used in the current cycle
  ADD COLUMN IF NOT EXISTS fix_cycle_id        text,                                -- app-generated id, changes on each new cycle/force-retrigger — guards against a stale/slow invocation overwriting a fresher one
  ADD COLUMN IF NOT EXISTS fix_last_activity_at timestamptz;                        -- last time any progress log entry was written; drives "time since last update"

CREATE INDEX IF NOT EXISTS idx_template_library_fix_state ON template_library (fix_state) WHERE fix_state <> 'none';

CREATE TABLE IF NOT EXISTS template_fix_log (
  id               bigserial   PRIMARY KEY,
  template_name    text        NOT NULL REFERENCES template_library(template_name) ON DELETE CASCADE,
  fix_cycle_id     text        NOT NULL,
  attempt_number   int,                       -- null for cycle-level events (feedback_received, nudge actions)
  event_type       text        NOT NULL,      -- 'feedback_received' | 'attempt_started' | 'validation_result' | 'attempt_failed' | 'fix_succeeded' | 'fix_failed_terminal' | 'nudge_status_check' | 'nudge_force_retrigger'
  message          text        NOT NULL,
  actor            text,                      -- set for nudge events only, the authenticated approver's email — never client-supplied
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_template_fix_log_template ON template_fix_log (template_name, created_at);
```

**Reads:**
- `template_library.*` — extended with the columns above; existing `GET /api/templates/library`
  needs no code change (`select('*')` already returns new columns).
- `template_fix_log` — read by the new progress view only, ordered by `created_at`.
- Per-template slot allowlists (`STYLE_OVERRIDE_SLOTS`) — a fixed, code-defined table (not stored in
  the DB), read by the fix generator and its validator.

**Writes:**
- `PATCH /api/templates/library/[templateName]` (extended, same endpoint, same auth):
  - `action: 'request_changes'` now additionally sets `fix_state = 'generating'`,
    `fix_attempt_count = 0`, a fresh `fix_cycle_id`, clears `fix_changes_summary` /
    `fix_failure_reason`, writes a `feedback_received` log row, and fires
    `inngest.send({ name: 'clio/template.fix_requested', data: { templateName, notes, fixCycleId } })`
    after the DB write succeeds.
  - `action: 'approve'` — new guard: rejected with `400` if `fix_state !== 'none'` (Section 4.2).
  - `action: 'reset_to_pending'` — unchanged, additionally resets `fix_state` to `none`.
- New Inngest function `inngest/template-fix-generator.ts`, triggered by `clio/template.fix_requested`,
  Inngest-level `retries: 0` (this function owns its own bounded retry internally — Section 4.2 — so
  the platform's own retry is explicitly disabled to avoid an uncontrolled multiplication of attempts
  or a stale re-run overwriting a newer cycle):
  - Fetches the row's current `sample_data`, `style_overrides`, and the target template's slot
    allowlist.
  - Runs up to 5 attempts (Section 4.2): each attempt calls a new `generateStyleFix()` function
    (`lib/templates/fix-generator.ts`), reusing the exact `@anthropic-ai/sdk` client/mock-guard
    pattern already established in `lib/templates/generator.ts` (module-level `isPlaceholder` check,
    `MODEL = 'claude-sonnet-4-6'`, `console.log('[MOCK ...]')` fallback when the API key is a
    placeholder) — not a new AI integration pattern.
  - Each attempt is validated by a new `validateStyleOverrides(templateName, proposed)` function
    against that template's slot allowlist (Section 4.1) — all-or-nothing.
  - Writes a `template_fix_log` row at every step (attempt start, validation result, success, or
    terminal failure) and updates `fix_last_activity_at` each time.
  - Before writing its final result, re-checks that `fix_cycle_id` on the row still matches the one
    this invocation started with — if a force-retrigger (Section 4.3) has since replaced it, this
    invocation discards its result rather than overwriting a fresher cycle's outcome.
  - On success: `UPDATE template_library SET status = 'pending_review', fix_state = 'none',
    style_overrides = <merged>, fix_changes_summary = <summary>, fix_failure_reason = NULL`.
  - On exhaustion/terminal failure: `UPDATE template_library SET fix_state = 'failed',
    fix_failure_reason = <reason>` — `status` stays `changes_requested` throughout.
  - Registered in `app/api/inngest/route.ts`'s `functions` array alongside the existing list.
- New `GET /api/templates/library/[templateName]/progress` — any authenticated user (read-only,
  matches the existing library-list read pattern); returns the row's current `fix_state`,
  `fix_attempt_count`, `fix_last_activity_at`, and the full `template_fix_log` history for that
  template, newest cycle first.
- New `POST /api/templates/library/[templateName]/nudge` — gated by the same
  `isConfiguredApprover()` check as every mutating action in this workflow (403 for anyone else,
  403 for everyone if the approver email is unset, matching `lib/templates/approval.ts` exactly).
  Body: `{ action: 'status_check' | 'force_retrigger' }` (Zod-validated).
  - `status_check`: writes a `nudge_status_check` log row with the authenticated `actor` email and
    the current state; no other side effects.
  - `force_retrigger`: writes a `nudge_force_retrigger` log row, assigns a **new** `fix_cycle_id` on
    the row (superseding any in-flight invocation per the guard above) while leaving
    `fix_attempt_count` to continue incrementing rather than resetting to 0 (Section 4.2 — this is
    the uncapped manual escape valve, distinct from the capped automatic loop), and fires a fresh
    `clio/template.fix_requested` event.

**One-time renderer wiring (human-authored, part of this phase's build, not per-cycle):**
`components/templates/TemplateRenderer.tsx` is modified once to fetch the row's `style_overrides` for
`Heatmap`/`Overlay` specifically and pass them down as a new optional prop; `Heatmap.tsx` and
`Overlay.tsx` are modified once to apply any present override via inline `style={{ }}` layered on top
of their existing Tailwind classes (e.g. `style={{ backgroundColor: overrides?.['intensity-2'] }}`
alongside the existing `className`). The other 25 renderers receive no new prop and are untouched.

**localStorage/sessionStorage:** none, consistent with RTV-04.

## 7. Success Criteria (Acceptance Tests)

✓ Given Arun (the configured approver) clicks "Request changes" on a `pending_review` template with
notes, then `status` becomes `changes_requested`, `fix_state` becomes `generating` in the same
response, and a `clio/template.fix_requested` event is emitted — all before the HTTP response
returns (no separate manual trigger needed).

✓ Given the fix generator proposes an override whose keys and values all pass validation, then
`template_library` is updated to `status = 'pending_review'`, `fix_state = 'none'`,
`style_overrides` reflects the new values, and `fix_changes_summary` is non-empty and visible on the
Pending Review card.

✓ Given the fix generator proposes an override containing a key not in that template's slot
allowlist, then the entire proposed fix is rejected (not partially applied), a `validation_result`
log entry records the specific reason, and a new attempt starts (up to the 5-attempt cap).

✓ Given 5 attempts have all failed validation (or the model reports the feedback is structurally
out of scope), then `fix_state` becomes `failed`, `fix_failure_reason` is populated and visible, and
`status` remains `changes_requested` — it never silently becomes `pending_review`.

✓ Given a template's `fix_state` is `generating` or `failed`, when a direct `PATCH` request with
`{ action: 'approve' }` is sent (bypassing the UI, which already hides the button), then the API
returns `400` and `status` does not change.

✓ Given a user who is not `TEMPLATE_LIBRARY_APPROVER_EMAIL`, when they call
`POST /api/templates/library/Heatmap/nudge` with `{ action: 'force_retrigger' }`, then the API
returns `403` and no new fix cycle starts.

✓ Given Arun opens a template's Fix Progress view while a cycle is running, then he sees every log
entry so far with a timestamp on each, the current attempt number out of 5, and a "time since last
update" indicator computed from `fix_last_activity_at`.

✓ Given Arun clicks "Force retrigger fix attempt" on a `failed` cycle, then a new attempt starts
immediately (not gated by the 5-attempt cap), a `nudge_force_retrigger` log entry records his email
and the time, and `fix_cycle_id` changes so any straggling prior invocation discards its result on
completion rather than overwriting the new attempt.

✓ Given this migration is applied and no fix cycle has ever been requested for `Overlay`, then no
"View fix progress" link appears on its card, and `isTemplateApprovedForProduction('Overlay')`,
`selectTemplate()`, and every other RTV-04/RTV-05 behavior are unaffected (regression check —
additive only).

## 8. Error States

- **Anthropic API call fails (network/timeout/error) during an attempt:** treated as a failed
  attempt like any validation failure — logged (`attempt_failed`, reason = the error), counts toward
  the 5-attempt cap, retried per the normal loop.
- **LLM returns malformed JSON:** same treatment — logged, retried, counts toward the cap.
- **LLM explicitly reports it cannot address the feedback within the allowed slots:** immediate
  terminal failure (does not consume remaining attempts — Section 4.2), reason shown verbatim to
  Arun (e.g. "This feedback implies a layout/content change, not a styling change, and isn't
  expressible through this template's approved style slots.").
- **Nudge endpoint, wrong user or unset approver env:** `403`, identical behavior/logging to the
  existing `PATCH` endpoint's `isConfiguredApprover()` check — no new auth pattern introduced.
- **Nudge endpoint, malformed body:** `400` via Zod, matching this project's established convention.
- **Progress view fails to load the log:** plain error state, "Couldn't load fix progress. Refresh to
  try again." — same pattern as RTV-04's existing library-load error state.
- **A stale/superseded Inngest invocation finishes after a force-retrigger already started a newer
  cycle:** its result is discarded via the `fix_cycle_id` check (Section 6) — it does not overwrite
  the newer cycle's `style_overrides` or `fix_state`, and does not double-log against the new cycle
  (it logs against its own now-stale `fix_cycle_id`, which the progress view does not show as
  current).

## 9. Edge Cases

- **Arun wants to give feedback on an already-`approved` template.** Not possible today — RTV-04's
  own UI only shows Approve/Request-changes buttons when `status === 'pending_review'`, and there is
  no "reopen an approved template" action anywhere in RTV-04 or this phase. This is a real gap but is
  not mentioned in the TMPL-01 brief and is explicitly out of scope here (Section 10) — flagged so it
  is not assumed to work.
- **Arun submits new feedback while a fix is already `generating` from a previous submission.** Not
  reachable through the UI today (Request Changes/Approve buttons only render for
  `pending_review`, and once `changes_requested`, only "Move back to Pending Review" is shown) — so
  there is no double-submission path via the UI. A direct API call attempting `request_changes` while
  `status` is already `changes_requested` is handled the same way the endpoint already handles any
  `action` — it re-applies the same update (new cycle, new `fix_cycle_id`), which is safe but is
  called out as an accepted, low-probability possibility rather than a scenario requiring new
  guard logic.
- **The fix succeeds, moves to `pending_review`, and Arun immediately requests changes again.** A
  brand new cycle starts (`fix_attempt_count` resets to 0, new `fix_cycle_id`); the new cycle's
  starting point is the previous cycle's already-applied `style_overrides`, so feedback like "a
  little wider still" refines incrementally rather than starting from the original unfixed design.
- **A template's slot allowlist doesn't yet exist for it (any of the other 25 templates).** The fix
  loop is not offered for those templates in this phase — `Request changes` on a non-`Heatmap`/
  `Overlay` template behaves exactly as RTV-04 built it today (status-only, no automated fix),
  consistent with the existing `RTV04_VALIDATED_TEMPLATES` scoping precedent in `generator.ts`.
- **Mobile/desktop:** internal admin tool, desktop-only, consistent with RTV-04's own precedent.
- **Two nudges in quick succession (status check, then force-retrigger seconds later):** both are
  logged in order with their own timestamps; `force_retrigger`'s new `fix_cycle_id` supersedes
  whatever was in flight, per the guard in Section 6/8.

## 10. Out of Scope

- **Proactive notifications** (email/SMS/Slack alert when a fix fails or completes). Arun discovers
  state by revisiting the admin page or the progress view — consistent with today's fully-manual
  "he checks back" model (his own words). Not built in this phase.
- **Reopening an already-`approved` template for feedback.** Not built in RTV-04, not requested in
  this brief — flagged in Section 9, not solved here.
- **Extending the fix loop, or its slot allowlists, to the other 25 pre-existing templates.** Scoped
  to `Heatmap`/`Overlay` only, matching the existing `RTV04_VALIDATED_TEMPLATES` precedent — a
  follow-up recommendation, not silently expanded.
- **Any actual file edit or deployment as part of a fix.** Explicitly rejected in Section 0 in favor
  of the runtime style-override design.
- **Semantic verification that a fix truly addresses Arun's English-language feedback.** This phase
  verifies structural validity (allowed keys, allowed/ranged values) mechanically, and asks the LLM
  to summarize what it changed — it does not run a second AI "judge" to confirm the fix looks right.
  That final judgment remains Arun's, at re-review, exactly as it already is for a first-time review.
- **Tab-level aggregate indicators** (e.g. a colored dot on the "Changes Requested" tab itself
  summarizing whether any card inside is `generating`/`failed`). Only the per-card bulb and the
  per-card progress-view link are built this phase.
- **RTV-05's live wiring, `show_visual`, or `isTemplateApprovedForProduction()`.** Untouched, as
  stated repeatedly above — this phase is entirely upstream of that gate.

## 11. Open Questions

None. Both of the Feature Brief's original open technical questions, and both of Arun's live
addendum items, are resolved with direct evidence or reasoned technical judgment, not deferred:

1. **File-edit-and-deploy vs. runtime style-override** — Section 0: runtime style-override chosen and
   justified against this codebase's actual deploy pipeline and Tailwind's static compilation model.
2. **Scope enforcement** — Section 4.1: structural (single-row, single-column write path) plus a
   fixed per-template slot allowlist with closed-set/ranged value validation.
3. **Failure handling** — Section 4.2: a distinct `fix_state = 'failed'` sub-status, never silently
   presented as `pending_review`.
4. **Deploy question** — Section 0: dissolved by the architecture choice — there is no deploy for
   this loop to gate.
5. **Bounded auto-retry count (Arun's addendum #1)** — Section 4.2: 5 automatic attempts per cycle,
   with reasoning for that specific number, plus an uncapped manual "force retrigger" escape valve
   that requires Arun's own deliberate action each time.
6. **Progress/console view + nudge (Arun's addendum #2)** — Section 4.3 and Section 6: new route,
   new log table, new read and nudge endpoints, fully specified.

The 2 new accent-color tokens proposed in Section 4.2 (`accent-blue` for Pending Review, `accent-
orange` for Fix Failed) are a clearly-flagged proposal awaiting confirmation at the normal CEO/Arun
spec-review step, not a blocking ambiguity — a reasoned default (with full justification for why the
existing 6-token palette doesn't already cover these two meanings) is given in Section 4.2, per this
project's standing practice of deciding and justifying rather than leaving design questions open
when a sound default exists.

## 12. Dependencies

- RTV-04's `template_library` table, `PATCH`/`GET /api/templates/library[...]` endpoints,
  `isConfiguredApprover()`, and `TemplateApprovalClient.tsx` — extended, not replaced.
- New migration `067_tmpl01_automated_fix_loop.sql` (Section 6).
- One-time developer authoring of `STYLE_OVERRIDE_SLOTS` for `Heatmap` and `Overlay` (Section 4.1) —
  a real, scoped implementation task, not automatically derivable from this spec alone.
- One-time modification of `TemplateRenderer.tsx`, `Heatmap.tsx`, `Overlay.tsx` to read and apply
  `style_overrides` (Section 6) — must ship as part of this same phase; the mechanism has nowhere to
  apply its output without it.
- `inngest/client.ts` and `app/api/inngest/route.ts` — new function registered alongside the existing
  list, same conventions.
- No dependency on RTV-05 — this phase does not touch `isTemplateApprovedForProduction()` or any
  live-session wiring.
- **CEO/Arun confirmation of the 2 proposed new accent-color tokens** (Section 4.2) before this spec
  is considered fully approved — everything else in this document can be built regardless of that
  confirmation, since the underlying `fix_state`/status values are independent of which hex colors
  represent them on screen.

---

## CEO Review

Approved. Section 11 confirmed empty of blocking questions. Independently spot-checked against the
live codebase before approval:

- Confirmed `Heatmap.tsx`'s `INTENSITY_STYLES` map and hardcoded `w-[64px] h-[64px]` cell sizing
  match the slot-table example in Section 4.1 exactly.
- Confirmed `Overlay.tsx`'s `COLOR_HEX` map and `w-[220px] h-[96px]` callout sizing and `border-2`
  panel border match Section 4.1's example exactly.
- Confirmed `RTV04_VALIDATED_TEMPLATES` exists at `lib/templates/generator.ts` line 25 — the
  document's citation is exact, not approximate.
- Confirmed the `clio/feedback.received` event-naming precedent in
  `inngest/feedback-processor.ts` — the proposed `clio/template.fix_requested` name follows the
  same convention.

The core architectural decision — runtime style-override (`template_library.style_overrides`, read
at render time via inline styles) instead of LLM-authored file edits — is approved as clearly
correct, not just adequate. It eliminates an entire class of risk this project has not faced before
(an LLM with any path to committing/deploying source code) rather than merely mitigating it, and the
reasoning that dynamic Tailwind class strings from a DB column would silently fail at runtime is
accurate given how this codebase's build pipeline works. The two-layer scope enforcement (single-row
JSON write with no file-system path at all, plus a fixed per-template allowlist with closed-set
color/ranged-numeric validation) is genuinely structural, not policy-based — approved without
reservation.

The bounded-5-attempt automatic retry with an uncapped manual force-retrigger, and the `fix_state`
sub-status design (not disturbing Arun's 3-tab structure), are both approved as sound resolutions
that satisfy Arun's live addendum without introducing an unbounded cost/latency risk.

**On the two proposed accent-color tokens** (`accent-blue` for Pending Review, `accent-orange` for
Fix Failed): the reasoning is sound — cyan already carries a different established meaning, and red/
amber are each already spoken for by other states in this same indicator. Proposing these to Arun
directly for a quick confirmation rather than deciding unilaterally, per his own explicit invitation
to be asked. Per Section 12's own note, this does not block the build — the two hex values can be
swapped after the fact with no other change, so the build proceeds now.

Developer agent: build exactly what Sections 4, 6, and 12 specify. `Heatmap`/`Overlay` only, per the
established `RTV04_VALIDATED_TEMPLATES` scoping — do not extend the slot-allowlist mechanism to any
other template as part of this build. Do not touch RTV-05's gate or any live-session wiring.
