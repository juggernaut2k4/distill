# Retroactive Spec: LIVE-01 Follow-up Fixes (silence handling, visual retry, fallback text removal)

**Status:** Retroactive — code already committed and deployed. This spec documents what was
approved and built, and is being used to verify nothing was missed or impacted outside scope.
**Date:** 2026-07-04

## Why retroactive
These three fixes were built and shipped directly during live-testing, in the same conversation
where Arun gave the exact instructions below. Per standing process, a spec should have preceded the
build. Arun's direction: let the deployments stand (don't revert working code), but write the spec
now and verify the implementation actually matches it — fix only what's missing, nothing else.

## Non-negotiable constraint (applies to all three items)
**Must not impact any existing, already-working functionality** — topic selection, LLM topic
generation, curriculum/session generation, the old script + 22-template rendering pipeline, or any
other part of the product not explicitly named below. No existing code may be deleted without
separate explicit approval.

---

## Item 1 — Silence / no-response handling

**Requirement (Arun's exact words):** "clio keeps waiting after saying something. clio can assume
that user is good in case user is silent. if clio asks questions and user did not respond then clio
can say if not responded, you will end the session politely assuming user has trouble talking in the
mic or hearing due to technical difficulty and ends session."

**Approved design (agreed in conversation):** two-stage escalation — a gentle check-in after a period
of silence, then a graceful session end (framed as "assuming a technical/audio issue," never as the
user being unresponsive/ignoring Clio) if silence continues after the check-in.

**Approved simplification (explicitly flagged and accepted):** trigger on general two-sided silence
after Clio finishes speaking, not narrowly restricted to "only after a literal question" — reliable
question-detection was out of scope for this pass.

**What must be verified against the shipped code (commit `294b899`):**
1. Does the timer only escalate after both sides have gone silent for the threshold duration — not
   during Clio's own uninterrupted speech?
2. Does the timer reset correctly on BOTH Hume and ElevenLabs paths, using existing signals (no new
   listeners added that could carry their own risk)?
3. Is Stage 1 (check-in) distinct from Stage 2 (end call), with Stage 2 only firing after Stage 1 has
   already fired and further silence has passed?
4. Does the end-call path reuse the EXISTING `end-call` mechanism (`/api/sessions/end-call`,
   `endCallOnServer`) built earlier today, rather than a new/parallel termination path?
5. Is the framing used in the graceful end message consistent with "assuming a technical issue,"
   not blaming the user?
6. Confirm: zero existing lines of code were modified in `WalkthroughClient.tsx` — this must be
   purely additive (new refs, new constants, new conditional block), per the no-impact constraint.

---

## Item 2 — Retry visual generation instead of a hard 10-second cutoff

**Requirement (Arun's exact words):** "yes we need retry for 4 seconds, remove the 10 second hard
rule" — followed by explicit approval of the specific numbers: "its ok to extend, we can retry 10
times with 4 second so worst case 40 seconds, lets give it a try."

**Approved design:** replace the single 10-second hard timeout (`LIVE_CONDUCTOR_TRANSITION_BUFFER_MS`)
with a retry loop: up to 10 attempts, 4 seconds each, returning immediately on first success, `null`
(same existing fallback) only if all 10 attempts fail.

**What must be verified against the shipped code (commit `239b68a`):**
1. Are the two new constants (`LIVE_CONDUCTOR_VISUAL_ATTEMPT_TIMEOUT_MS = 4000`,
   `LIVE_CONDUCTOR_VISUAL_MAX_ATTEMPTS = 10`) actually used in the retry loop, not just declared?
2. Does the loop return immediately on the first successful attempt, rather than always running all
   10?
3. Is the original `LIVE_CONDUCTOR_TRANSITION_BUFFER_MS` constant left untouched (it has a separate,
   unrelated purpose per the code comments) — only its use as the tab-2+ visual timeout should have
   changed, not the constant itself if it's used elsewhere?
4. Confirm the tab-1 deterministic agenda path (`buildAgendaVisual`) was NOT touched — it has no LLM
   call and doesn't need retries.
5. Confirm the known timing tradeoff (worst case ~40s now exceeds what Clio's natural transition
   speech was designed to "cover") was flagged in a code comment, not silently absorbed as a
   non-issue — this is expected per Arun's explicit approval, just needs to be visible for future
   reference.
6. Confirm zero existing lines outside `live-conductor-prompt.ts` / `live-conductor-visual.ts` /
   `live-conductor-bridge.ts` were touched.

---

## Item 3 — Remove the "Listening in — no visual for this section" fallback text

**Requirement (Arun's exact words):** "no i only asked to remove the listening in text. the bold text
above it should be displayed."

**Approved design:** in `LiveConductorVisual.tsx`'s null-fallback render, remove only the muted
"Listening in — no visual for this section." line. The bold tab-title line above it must remain
untouched.

**What must be verified against the shipped code (commit `239b68a`):**
1. Confirm exactly one line was removed (the muted fallback text), and the bold tab-title `<p>` is
   still present and unchanged.
2. Confirm no other JSX, styling, or logic in `LiveConductorVisual.tsx` was touched (e.g., the
   non-null/populated-data render path, the 22-template renderers, or anything outside this one
   component).

---

## Explicit non-impact checklist (must be confirmed true for ALL three items combined)
- [ ] No changes to `lib/curriculum/planner.ts`, `inngest/curriculum-generator.ts`, or any topic
      selection / LLM topic generation code.
- [ ] No changes to `inngest/session-designer-auto.ts`, `inngest/session-content-cron.ts`,
      `inngest/session-content-pipeline.ts`'s non-live-conductor branch, or any session-generation code.
- [ ] No changes to the old script-generator (`lib/content/script-generator.ts`) or the 22-template
      renderer system (`components/templates/renderers/*`, `lib/templates/*`).
- [ ] No changes to anything in `app/api/plan/*`, `app/api/topics/*`, `app/api/checkout/*`, or billing.
- [ ] No deletions beyond the one explicitly-approved text line in Item 3.

## Next step
Route this spec to a fresh CEO-agent review pass: re-read the actual diffs of commits `239b68a` and
`294b899` line-by-line against every checklist item above. Report PASS/FAIL per item. If anything is
missing or doesn't match, fix ONLY that specific gap — do not re-open or re-litigate anything that
already checks out.
