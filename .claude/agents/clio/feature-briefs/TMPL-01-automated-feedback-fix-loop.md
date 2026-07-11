# Feature Brief: TMPL-01 — Automated Template Feedback → LLM Fix → Re-Review Loop
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-10

## Series context
Follow-on to RTV-04 (template library + human-approval workflow, deployed, commit e8fbccc/890ce10).
RTV-04 built the review/approval workflow itself (`template_library` table, admin page at
`/dashboard/admin/templates`, `PATCH /api/templates/library/[templateName]`) but the
"Request changes" action only writes a status + note to the database — nothing acts on it. Arun
now wants that loop automated: his feedback should trigger an LLM to actually fix the template and
resubmit it for his review, repeating until he approves.

This does NOT touch RTV-05 or the display-switch gate (`isTemplateApprovedForProduction()`,
`selectApprovedTemplate()`) — those remain exactly as built. This is purely about what happens
between "Arun requests changes" and "Arun sees a fixed version," still gated by the same
`status = 'approved'` requirement before anything can ever go live.

## What Arun Said (verbatim intent, lightly organized)
1. He submits feedback on a template (already possible today via "Request changes" + a note).
2. That feedback should be sent to an LLM, which fixes the template.
3. Once fixed, the template's status moves back to "pending review" automatically (no manual
   "Move back to Pending Review" click required).
4. When Arun checks back, he can either **approve** or **add more feedback** — the cycle repeats
   until approved. No fixed retry cap was stated — implicitly "until approved," so the design must
   handle indefinite cycles gracefully, not fail after N attempts silently.
5. **Hard scope constraint, stated explicitly and repeatedly:** when feedback is sent, the fix must
   be scoped to ONLY that one template. No other template's code may change. **Only the CSS/visual
   styling of that specific template should be changed** — not its data shape, not shared
   components, not any other template's renderer.
6. **New status UI, explicit color scheme (Arun's exact words):**
   - Approved → green
   - Pending review → blue
   - Submitted for feedback (i.e. `changes_requested`, mid-fix or awaiting Arun's re-review after a
     fix) → red
   - Arun explicitly invited additions: "let me know if you need any other status or colors" — if
     the design below requires an intermediate status (e.g. "LLM is currently fixing this"), BA
     should propose a color for it and flag it back rather than inventing one silently.
7. Described as a "bulb or button" showing status — a small, glanceable visual indicator per
   template card, not necessarily replacing the existing tab structure.

## The Problem Being Solved
Today, review friction is entirely manual: Arun leaves a note, and unless he tells the orchestrator
directly, nothing happens — there's no notification, no automated remediation, and even resubmitting
a fixed template for his review requires a manual status-reset click. For 27 templates (2 of which,
Heatmap/Overlay, are genuinely new and likely to need iteration), this manual loop doesn't scale and
adds a full orchestrator round-trip to every single design tweak.

## The Real Technical Constraint (BA must resolve, not skip)
The requested "CSS fix" is not a database field — it is real source code. Each template's visual
design lives in its own React/Tailwind renderer component
(`components/templates/renderers/Heatmap.tsx`, `Overlay.tsx`, and 25 others for the pre-existing
templates). "The LLM fixes the template" necessarily means an LLM edits a real `.tsx` file, and that
change is not visible to Arun until it is built and deployed. This is fundamentally different from
RTV-04's existing status-flip actions and needs its own architecture:

- Does the LLM edit the renderer file directly (requiring a commit + Vercel deploy before the fix
  is visible), or does the system need a runtime style-override mechanism (e.g. a `style_overrides`
  JSON column the renderer reads at render time) so a fix appears without a full deploy cycle?
  BA must pick one and justify it — do not leave this ambiguous.
- **Scope enforcement is a hard requirement, not a suggestion.** Whatever mechanism is chosen must
  make it structurally difficult (ideally impossible) for an LLM-authored fix to touch anything
  outside the one target template's own visual styling — no shared component files, no other
  renderer, no data-shape/type changes. Propose a concrete technical guardrail (e.g. diff scope
  validation before accepting the LLM's output; a constrained edit target such as a per-template
  style/config object rather than open file-editing) — "the LLM was told not to" is not sufficient
  by this project's own standing security posture (CLAUDE.md: "never dangerouslySetInnerHTML",
  "never eval/Function", "no dynamic code execution").
- **Failure handling — explicitly requested by the orchestrator, not yet answered by Arun:** what
  happens if the LLM's fix doesn't actually build, doesn't address the feedback, or errors out? The
  status must never silently move to "pending review" (implying "ready for Arun") if the fix is
  actually broken or incomplete. Propose a fail-safe: e.g., a fix attempt that fails validation stays
  in a distinct state (not silently `pending_review`) with the failure reason visible to Arun, and/or
  a bounded automatic retry before flagging for human (orchestrator) intervention.
- **Deploy question:** does an accepted LLM fix trigger an actual production deployment
  automatically, or does it stage the change for the orchestrator to review/deploy? Given this
  project's governance model (no code ships without independent verification — established
  throughout the RTV series), BA should propose whether this loop deploys autonomously or requires
  an orchestrator-verified deploy step per cycle, and state the tradeoff plainly (speed of iteration
  vs. the project's established practice of always independently verifying before shipping).

## What Success Looks Like
- Arun leaves feedback on a template (existing UI, extended per this spec).
- An LLM fix is generated, scoped and verified to touch only that one template's visual styling.
- On a valid, verified fix: status automatically becomes "pending review" (no manual reset needed).
- On an invalid/failed fix: status does NOT silently become "pending review" — a distinct,
  visible failure state (or a bounded retry) applies instead, per BA's design.
- Arun sees the four (or BA-justified additional) statuses with the exact color scheme he specified,
  as a glanceable indicator per template card.
- The cycle (feedback → fix → pending review → approve or more feedback) can repeat indefinitely
  until Arun approves — no artificial hard stop that blocks him from iterating further.
- **Nothing about this changes RTV-05's gate**: `status = 'approved'` is still required before a
  template can ever be selected for a live session, regardless of how many fix cycles it took to
  get there.

## Known Constraints (do not expand scope)
- Scope strictly to visual/CSS-level changes for the ONE template under review — never touch
  `sample_data`'s underlying shape/type, never touch another template's file, never touch shared
  components (`TemplateRenderer.tsx`, `containerBudgets.ts`, `selector.ts`, `approval.ts`,
  `generator.ts`) as part of a fix cycle.
- Only the configured approver (`TEMPLATE_LIBRARY_APPROVER_EMAIL`) may submit feedback or approve —
  reuse the existing fail-closed `isConfiguredApprover()` check, do not weaken it.
- Do not touch RTV-05's display-switch gate, `isTemplateApprovedForProduction()`, or
  `selectApprovedTemplate()` — this phase is upstream of all of that.
- Approved library packages only (per CLAUDE.md's approved list) — the LLM fix generation reuses
  the existing `@anthropic-ai/sdk` client pattern already used by `lib/templates/generator.ts`, not
  a new AI integration.
- No `eval()`, `Function()`, or dynamic code execution — if an LLM-authored code change is ever
  written to a file, it must go through the same static, typed code path every other change in this
  codebase does (tsc, build), never executed as a string at runtime.

## Process
Write the full 12-section Requirement Document to
`.claude/agents/clio/requirement-docs/TMPL-01-automated-feedback-fix-loop.md`. Read
`.claude/agents/clio/requirement-docs/RTV-04-template-library-and-approval.md` in full first for
grounding on the existing table/API/UI this phase extends — do not re-derive its design, build on
it. Resolve the two open technical questions above explicitly (file-edit-and-deploy vs.
runtime-style-override; autonomous deploy vs. orchestrator-verified deploy) rather than deferring
them — if a genuine ambiguity remains after your own research that only Arun can resolve, list it
in Section 11 rather than guessing, but exhaust the codebase/precedent-based research first (this
project's standing pattern throughout the RTV series). Suggested id: `TMPL-01-automated-feedback-fix-loop`.
