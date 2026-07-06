# DEFER-QUESTION-01 — Requirement Document

**From:** CEO Agent (acting as BA for this turn — no separate BA dispatch was available; see note at bottom)
**To:** Developer
**Status:** APPROVED — ready to build
**Date:** 2026-07-06
**Supersedes:** live tool-call/DB-write approach for `defer_question` on the Hume-native voice path
**Tracker:** `docs/action-items.json` → `third-capability-missing`

---

## 1. Problem Statement

Clio has a third custom capability — gracefully deferring a question she can't or shouldn't answer
mid-session — that exists conceptually but is **broken on the live production voice path** (Hume-native,
via `lib/voice/relay-handler.ts`). Today, when the LLM decides to defer a question:

- The prompt instruction (`lib/clio-context-builder.ts:104`) tells Clio to *"call `defer_question`. Say
  'Great question — I've saved it for next time.'"* — i.e. it references a tool call.
- On the Hume-native relay (`lib/voice/relay-handler.ts:265-266`), `defer_question` is wired as a
  **no-op stub** — it acknowledges the tool call over the wire but never writes anything to the
  database.
- A working `defer_question` implementation *does* exist, but only on the old ElevenLabs walkthrough
  path (`app/dashboard/walkthrough/WalkthroughClient.tsx:972`, `app/api/defer-question/route.ts`),
  which is not the path real sessions run on.
- The result: deferred questions are spoken aloud correctly but never persisted, and never surface to
  the user or feed the next session's plan.

## 2. Arun's Direction (2026-07-06)

Drop the live tool-call/DB-write approach entirely for the Hume-native path. Instead:

1. Clio just **verbally acknowledges** the deferral in the moment — no tool call, no dependency on
   Hume's dashboard carrying a third custom tool into every session config.
2. The **existing post-call transcript job** — `inngest/session-quality-evaluator.ts`, the same cron
   that already flags coaching-quality issues — is **extended** to detect deferred-question moments
   from the transcript after the fact, and turn them into action items surfaced on the next session.

This removes the need to touch Hume's dashboard at all (the root cause of "silently missing" —
custom tools configured in Hume's UI don't reliably carry into every native session).

## 3. What Success Looks Like

- During a live session, when Clio defers a question, she says a natural acknowledgment
  (e.g. "Great question — I'll save that for next time.") with **no tool call involved**.
- Within 15 minutes of session evaluation (same cron cadence as today, 2–2.25 hrs post-call), the
  quality evaluator detects any deferred-question moments from the Recall.ai transcript and writes
  them to `sessions.deferred_questions` — the **same column and shape** the UI at
  `SessionDetailClient.tsx:902` already renders ("Saved for Follow-up" card).
- No schema change needed — `sessions.deferred_questions` already exists and is already rendered.
  This is purely: stop calling a broken tool → detect the same signal after the fact from transcript
  text.
- `docs/action-items.json` → `third-capability-missing` reflects final shipped status.

## 4. Scope

### In scope
- Remove the tool-call instruction from `lib/clio-context-builder.ts:104`; replace with a purely
  verbal instruction (no tool reference).
- Remove (or leave inert, see decision below) the `defer_question` stub handling in
  `lib/voice/relay-handler.ts:265-266` for the Hume-native path.
- Extend `inngest/session-quality-evaluator.ts` with a new detection step that scans the transcript
  for deferred-question moments and writes matches to `sessions.deferred_questions`.
- Do not touch the ElevenLabs walkthrough path (`WalkthroughClient.tsx`, `/api/defer-question/route.ts`)
  — it is a separate, already-working system for a different (non-production) flow. Leave it as is.

### Out of scope
- Any change to the `sessions.deferred_questions` column shape or the UI at
  `SessionDetailClient.tsx:902-929` — both already correct and unchanged.
- Any change to Hume dashboard configuration.
- Surfacing deferred questions anywhere other than the existing "Saved for Follow-up" card (e.g. no
  new email, no new dashboard widget). If Arun wants deferred questions actively pulled into the next
  session's plan content (not just displayed), that is a follow-up feature, not part of this fix.

## 5. Design Decision — Keyword-Match vs. LLM Call (resolved)

**Decision: keyword-match, following the existing no-LLM pattern in `session-quality-evaluator.ts`.**

Reasoning:
- `session-quality-evaluator.ts` is explicitly documented as "No AI calls — all classification is
  keyword-scoring (<500ms per response)" (file header, line 9). Every other detector in this file
  (V1–V7 comprehension classifier, 6 quality criteria, 7-dimension coverage) follows this pattern.
  Introducing a `session-ai.ts`-style Claude call here would be the only LLM-backed step in an
  otherwise pure-function file, adding cost, latency, and a new failure mode (API error handling,
  placeholder-key mocking) to a batch job that currently has none.
- The deferral acknowledgment phrase is **prompted by us** (`clio-context-builder.ts`), not free-form
  user language — Clio always says a close variant of a fixed acknowledgment. This is a much narrower,
  more reliable matching problem than the open-ended comprehension classification the V1–V7 keyword
  system already handles successfully. Keyword/phrase matching is sufficient and reliable here because
  we control one side of the exchange (Clio's own scripted acknowledgment phrase).
- Risk if wrong: a missed deferred question just doesn't appear on the follow-up card — a soft
  degradation, not a broken session or bad data. This tolerance justifies the cheaper approach.
- If Arun later finds real transcripts where Clio's phrasing drifts enough to miss matches, upgrading
  this one step to an LLM call is a contained, low-risk follow-up (the file already has a template
  for isolating one step and falling back safely — see Step I's try/catch pattern at line 705-731).

## 6. Functional Requirements

### 6.1 Prompt change — `lib/clio-context-builder.ts`

Replace line 104:
```
`9. For complex or off-topic questions: call defer_question. Say "Great question — I've saved it for next time."`,
```
with a purely verbal instruction, no tool-call reference, e.g.:
```
`9. For complex or off-topic questions: do NOT try to answer in depth. Say something close to "Great question — let's save that for next time so I can give it a proper answer," then return to the script. Do not call any tool for this.`,
```
The acknowledgment phrase must remain a **recognizable, consistent pattern** (anchored on "save" /
"next time" language) — this is the exact string family the new evaluator step will match against.
Keep the phrase family narrow and documented so the two files stay in sync.

### 6.2 Relay handler — `lib/voice/relay-handler.ts`

Current (lines 265-266):
```ts
} else if (tool_name === 'defer_question') {
  if (expects_response) sendResult('Question deferred.')
}
```
Since the prompt no longer instructs Clio to call this tool, this branch should become dead code on
the Hume-native path. Leave the branch in place (harmless fallback — falls through to the generic
"Tool acknowledged" handler if somehow still invoked) rather than deleting it, to avoid breaking
anything if a stale Hume config still has the tool registered. No functional change required here
beyond the prompt change in 6.1 making it unreachable in practice. **Do not delete this branch** —
removing it entirely risks an "Unknown tool call" warning path being hit if Hume's dashboard config
lags behind the prompt change during rollout.

### 6.3 New detection step — `inngest/session-quality-evaluator.ts`

Add a new step inside `evaluateSession`, after Step E (quality criteria) and before Step I (final
write), following the exact structural pattern already used by Steps A–H:

**New keyword/phrase set** (co-located near the top of the file, alongside `VARIANT_KEYWORDS` etc.):
```ts
const DEFERRAL_PHRASES = [
  "save that for next time",
  "save it for next time",
  "let's save that",
  "great question", // only counted in combination with a save/next-time phrase nearby, see below
]
```
Matching logic:
- Scan `clioUtterances` (already computed in the existing speaker-identification step) for utterances
  where the Clio text contains a "save ... for next time" pattern (use a small set of literal phrase
  variants matching the family locked in 6.1, not a single hardcoded string, so minor rewording by the
  LLM at generation time still matches).
- For each match, look at the **user utterance immediately preceding** the matched Clio utterance
  (previous utterance by a `userSpeakers` speaker, by transcript order) — this is treated as "the
  deferred question" text, since that's the shape of the interaction (user asks something off-script,
  Clio defers it).
- Fallback if no preceding user utterance is found within a reasonable window: skip that match (do not
  fabricate a question) — same conservative "skip on ambiguity" behavior the checkpoint-pairing logic
  already uses at Step C (line 519, 528: `if (!matchedUtterance) continue`).
- Build entries in the exact shape the UI already expects (see `SessionDetailClient.tsx` type
  `DeferredQuestion` at line 40, and the write shape in `app/api/defer-question/route.ts` lines 10-13):
  ```ts
  { question: string, deferred_at: string }
  ```
  `deferred_at`: use the matched Clio utterance's timestamp translated to an ISO string
  (session `ended_at` minus remaining-duration offset is not available at word-level precision in this
  job; acceptable approach — use `session.ended_at` as a single timestamp for all entries found in that
  session, since the existing UI only displays time-of-day and multiple entries per session are
  expected to share within-session granularity that isn't reconstructable from cron-batch data with
  sub-minute precision anyway). Document this approximation inline as a comment.

**Write path:**
- Append detected entries to `sessions.deferred_questions` using the same append-don't-overwrite
  pattern as `app/api/defer-question/route.ts` (fetch existing array, concat, update) — do this in the
  same Step I write block (line 704-731) rather than a separate DB round trip, to keep the one existing
  try/catch fallback (write without new field if column missing) covering this too.
- If `sessions.deferred_questions` write fails, follow the exact same fallback pattern already coded at
  line 717-731 (retry without the new field) — do not introduce a second, different error-handling
  style in this file.

### 6.4 No new DB migration

`sessions.deferred_questions` already exists (confirmed via `app/api/defer-question/route.ts` and
`SessionDetailClient.tsx`). No `ALTER TABLE` needed.

## 7. Acceptance Criteria

1. `lib/clio-context-builder.ts` no longer instructs Clio to call `defer_question` — verified by
   `grep -n "defer_question" lib/clio-context-builder.ts` returning no matches, and the replacement
   line present.
2. `npx tsc --noEmit` passes clean after all changes.
3. `inngest/session-quality-evaluator.ts` compiles, and a unit-style manual trace (see Test Plan)
   correctly extracts a deferred-question pair from a synthetic transcript containing the phrase
   family from 6.1.
4. No regression to any of the 6 existing quality criteria, the V1–V7 classifier, or the 7-dimension
   coverage check — all existing logic in the file is untouched except the new step's insertion point.
5. Writing to `sessions.deferred_questions` reuses the append pattern (does not clobber existing
   entries written by any other path, e.g. if the ElevenLabs walkthrough path is ever used again for
   the same session).
6. `docs/action-items.json` → `third-capability-missing` status updated to reflect the shipped fix.

## 8. Test Plan

Since this is a batch/cron job with no existing test file wired up for it in `tests/`, verification is
via `npx tsc --noEmit` plus a manual dry-run trace:

1. Type-check clean.
2. Construct a small synthetic `RecallUtterance[]` array in a scratch script (not committed) with a
   Clio utterance containing "let's save that for next time" preceded by a user utterance asking a
   question, and confirm the extraction logic (once isolated as a pure function, ideally exported for
   testability the same way `classifyResponse` and `checkSessionDimensions` are already exported)
   returns the expected `{question, deferred_at}` shape.
3. Confirm the new step is additive — running the full `evaluateSession` function against existing
   fixtures (if any exist) or a mock session row does not throw and does not alter unrelated fields.

## 9. Files Changed

- `lib/clio-context-builder.ts` (line ~104) — prompt instruction change.
- `inngest/session-quality-evaluator.ts` — new keyword set + new detection step + write-path
  integration into existing Step I.
- `docs/action-items.json` — status update for `third-capability-missing`.
- No changes to: `lib/voice/relay-handler.ts` (left as-is per 6.2), `app/dashboard/sessions/[id]/SessionDetailClient.tsx`
  (already correct), `app/dashboard/walkthrough/WalkthroughClient.tsx`, `app/api/defer-question/route.ts`
  (ElevenLabs path untouched), no new SQL migration.

## 10. Open Questions

None. All decisions in this document were resolvable from Arun's 2026-07-06 direction, the existing
code shape, and the standing "keyword-match, no new LLM call" precedent already established in this
exact file. No escalation needed.

---

## Note on process

The Business Analyst agent dispatch that should normally produce this document did not return a file
to disk — checked `docs/specs/` directly and confirmed no `DEFER-QUESTION-01` file existed before
writing this one. Per Arun's standing instruction not to leave things "waiting in the background,"
the CEO agent wrote this requirement document directly, using the same structure the BA agent would
have used, and is now proceeding to build against it in the same turn. This is a deviation from the
normal CEO→BA→Developer chain, made explicitly to unblock a stalled turn — flagging it here rather
than silently skipping the gate.
