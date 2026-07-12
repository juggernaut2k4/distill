# Feature Brief: TMPL-04 — force_retrigger Sends No Feedback Text (Bug Fix)
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 (live bug, blocking Arun's actual feedback right now)
Date: 2026-07-12

## What Happened
Arun's Overlay feedback was stuck for over an hour due to an Inngest sync gap (root-caused and
fixed separately — see `docs/action-items.json`'s `tmpl-01-inngest-sync-gap-overlay-stuck` entry).
After the sync was fixed, Arun clicked "Force retrigger fix attempt." The job ran this time
(`fix_attempt_count` went from 0 to 1), but immediately failed with:
`"No reviewer feedback was provided, so there is nothing to address with a style override."`

## Root Cause (confirmed directly against the live code and database)
`app/api/templates/library/[templateName]/nudge/route.ts`'s `force_retrigger` branch hardcodes
`notes: ''` in the Inngest event payload it sends:
```ts
data: { templateName, notes: '', fixCycleId: newFixCycleId, forceRetrigger: true },
```
The original feedback Arun typed when he first clicked "Request changes" is NOT lost — it is still
sitting on the row's own `review_notes` column (confirmed live: `template_library.review_notes` for
Overlay still contains his full original feedback text verbatim). It is simply never read or
forwarded by this route. The generator (`lib/templates/fix-generator.ts`'s `generateStyleFix()`)
correctly reports "no feedback provided" because, from its perspective, none was — an empty string is
exactly what it received.

**TMPL-01's own requirement document never specified what `notes` value `force_retrigger` should
send** — it only says "fires a fresh `clio/template.fix_requested` event," leaving the payload's
`notes` field unspecified. The build agent's choice of `''` was a reasonable-looking default that
turns out to defeat the entire purpose of a retry: a retry with no context to act on can never
succeed.

## What Success Looks Like
- `force_retrigger` reads the row's current `review_notes` and passes that exact text as `notes` in
  the Inngest event payload, instead of an empty string — so a retry actually has the original
  feedback to work with, matching what a user intuitively expects "retry" to mean.
- No other behavior changes: attempt-count handling, `fix_cycle_id` generation, the uncapped nature
  of manual force-retrigger, and every other part of Sections 4.2/4.3/6 of TMPL-01's spec are
  unaffected.
- Confirm this doesn't regress the automatic (non-force) path — `request_changes`'s own handler
  already correctly passes `notes` from the request body when a NEW cycle starts; this fix only
  concerns the force-retrigger path's payload construction, which is a separate code path.

## Known Constraints (do not expand scope)
- This is a one-line-class bug fix to `app/api/templates/library/[templateName]/nudge/route.ts` — do
  not touch `lib/templates/fix-generator.ts`, `lib/templates/fix-cycle-runner.ts`,
  `lib/templates/styleOverrideSlots.ts`, or the Inngest job itself.
- Do not add a new UI affordance for editing feedback text at retrigger time — Arun's ask was simply
  for the retry to work with what he already submitted, not a new editing flow.

## Process
Write a short requirement document (still all 12 sections, but this is a narrow bug fix — keep each
section tight and proportionate to the fix's actual size) to
`.claude/agents/clio/requirement-docs/TMPL-04-force-retrigger-notes-fix.md`. Confirm the fix by
reading the actual current nudge route file yourself before writing anything. Section 11 must be
empty. Suggested id: `TMPL-04-force-retrigger-notes-fix`.
