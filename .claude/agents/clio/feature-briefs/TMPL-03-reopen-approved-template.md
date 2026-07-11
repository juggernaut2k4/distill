# Feature Brief: TMPL-03 — Reopen an Approved Template for Additional Feedback
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-11

## What Arun Said (verbatim intent)
"I also need an approved template to move to pending review and add additional feedback, review and
approve again."

A template that has already been approved (via RTV-04's workflow) currently has no path back to
review — Arun wants to be able to reopen it, leave more feedback, have it re-reviewed, and approve
it again. This was explicitly flagged as an out-of-scope gap in both prior specs:
- RTV-04 built no "reopen an approved template" action at all.
- TMPL-02's Section 9 named this exact gap: "Arun wants to give feedback on an already-`approved`
  template. Not possible today... This is a real gap but is not mentioned in the TMPL-01 brief and
  is explicitly out of scope here."

## Context / Known Prior State (verify against current code, do not assume)
- `template_library.status` currently has exactly 3 values: `pending_review`, `approved`,
  `changes_requested` (RTV-04, `supabase/migrations/065_rtv04_template_library.sql`).
- `PATCH /api/templates/library/[templateName]` (RTV-04, extended by TMPL-01) currently supports
  exactly 3 actions: `approve`, `request_changes`, `reset_to_pending` — the last of these already
  moves a `changes_requested` row back to `pending_review`, clearing `reviewed_by`/`reviewed_at`/
  `review_notes` (and, per TMPL-01's extension, `fix_state`). This existing action is the closest
  precedent for what this brief needs, but it is currently only reachable from `changes_requested`,
  not from `approved` — confirm this by reading the actual route file, don't assume.
- `TemplateApprovalClient.tsx`'s UI currently only shows Approve/Request-changes buttons on
  `pending_review` cards, and a "Move back to Pending Review" button on `changes_requested` cards —
  `approved` cards currently show no mutating action at all (only the "Approved by ... on ..."
  caption). Confirm this by reading the actual component.
- TMPL-01's automated fix loop (`Heatmap`/`Overlay` only) is triggered by the `request_changes`
  action specifically, and already handles "incremental refinement" — its own spec states a new fix
  cycle's starting point is whatever `style_overrides` is already on the row, so feedback like "a
  little wider still" refines an already-approved look rather than starting from scratch. This
  strongly suggests reopening an approved template should NOT reset `style_overrides` — the whole
  point is refining what's already approved, not discarding it. Confirm this reasoning holds by
  reading TMPL-01's actual behavior, don't just take this brief's word for it.

## The Problem Being Solved
Design review is not always a single pass — Arun may approve a template, then notice something
later (in a live session, or on reflection) that he wants adjusted. Today there is no way back into
the review workflow for an already-approved template; the only options are to leave it approved as-is
or to build a workaround. This blocks exactly the "review, approve, then decide you want one more
change" loop that's completely normal for a design-approval process.

## What Success Looks Like
- A new action, reachable from an `approved` template's card, that moves it back to `pending_review`
  — reusing (or closely mirroring) the existing `reset_to_pending` semantics: clear `reviewed_by`/
  `reviewed_at`, but preserve `style_overrides` (the currently-approved visual state) so any
  follow-up feedback refines from there, not from a blank slate.
- Once reopened, Arun uses the EXISTING "Request changes" flow (already built, already triggers
  TMPL-01's automated fix loop for Heatmap/Overlay, already works for the other 25 templates as a
  plain status+note) to leave the additional feedback — BA should determine whether reopening and
  leaving feedback should be one combined action or two separate steps (reopen, then use the
  existing Request-changes button), and justify whichever is chosen. Reusing what already exists is
  preferred over duplicating UI/API surface, per this project's standing practice — but state this
  explicitly as a design decision, don't assume it silently.
- The re-review/re-approve cycle after reopening works identically to a template's very first
  review — same buttons, same auth gate, no special-casing needed for "this was previously
  approved."
- This action is available for all 27 templates, not just Heatmap/Overlay (TMPL-01's automated fix
  loop only kicks in afterward if the specific template happens to be Heatmap/Overlay and Arun uses
  Request-changes — the reopen action itself is a generic RTV-04-level capability, not specific to
  the 2 templates with automated fixing).

## Known Constraints (do not expand scope)
- Gated by the exact same `isConfiguredApprover()` check as every other mutating action in this
  workflow — no new or weakened auth pattern.
- Does not touch RTV-05's gate or `isTemplateApprovedForProduction()` — reopening a template for
  review does not, by itself, un-approve it for live-session purposes until BA confirms whether it
  should. **This is a real open design question, not a technical detail**: if a template is
  currently approved AND already in active use by RTV-05 (once that phase is enabled), does
  reopening it for review immediately make `isTemplateApprovedForProduction()` return `false` again
  (since status is no longer `approved`), and is that the correct/desired behavior, or does Arun
  expect the template to keep serving live traffic on its last-approved design until he explicitly
  approves the new one? State this explicitly — do not silently assume either answer, since RTV-05
  is not yet enabled in production today so the practical stakes are currently zero, but the answer
  should be correct in the spec for whenever RTV-05 does go live.
- Do not touch TMPL-01's fix-generator/slot-allowlist logic — this brief only concerns the
  status-transition action to get a template back into `pending_review`, not the fix-generation
  mechanism itself.
- Reuse the existing 3-tab structure (`Pending Review`/`Approved`/`Changes Requested`) — no new tab.

## Process
Read `.claude/agents/clio/requirement-docs/RTV-04-template-library-and-approval.md` and
`.claude/agents/clio/requirement-docs/TMPL-01-automated-feedback-fix-loop.md` in full for grounding
— do not re-derive their designs. Read the actual current `PATCH` route and
`TemplateApprovalClient.tsx` to confirm today's exact behavior before proposing the new action.

Write the full 12-section Requirement Document to
`.claude/agents/clio/requirement-docs/TMPL-03-reopen-approved-template.md`. Section 11 must be
empty — resolve the RTV-05-interaction question above with your own best technical judgment (it is
answerable from the code: check whether `isTemplateApprovedForProduction()` reads `status` alone or
something else, and reason from there) rather than deferring it, unless it's genuinely Arun's product
call rather than a technical one. Suggested id: `TMPL-03-reopen-approved-template`.
