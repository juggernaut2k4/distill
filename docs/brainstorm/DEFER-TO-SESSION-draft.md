# Draft for discussion — "Defer to a future session" mechanism

_Status: brainstorm draft, not a spec. For Arun + Claude discussion. Nothing here is decided._

## The behavior we're designing

During a live session, Hume (Clio's voice) is speaking about the current tab's content but has access
to the whole topic as background context. A user can ask something that goes deeper than what's
appropriate to improvise live. Instead of giving a shallow answer, Clio should be able to:

1. Recognize "this deserves a real answer, not a live improvisation."
2. Say something like "great question — let me build that out properly and walk you through it next time."
3. Have that moment turn into an actual concrete addition to the user's curriculum: a new session (or
   an addition to an existing upcoming session) that goes deep on exactly that question.

## Open questions to resolve in the follow-up discussion

### A. How does Hume/Claude signal "this is a defer, not an answer"?
Likely a new tool call — something like `defer_to_session(question, why_it_needs_depth)` — called
instead of just answering in the transcript. This makes the defer event structured and machine-readable,
rather than us trying to detect "sounds like Clio dodged something" from free text after the fact
(we already learned today, painfully, that text-pattern-matching on live speech is fragile — see the
farewell-detection bug). A tool call is the more reliable signal.

### B. What happens right after the tool is called, during the live session?
- Does Clio just say her deferral line and move on immediately?
- Or does the tool call itself trigger some acknowledgment back to Clio (e.g., "noted, continuing")
  that she then relays to the user in her own words?

### C. Where does the deferred question live until it becomes a session?
- A new row in some `deferred_questions` (or similar) table, tied to the session_id, user_id, the raw
  question text, and Clio's own note on why it needs depth?
- Or folded directly into the existing `session_insights` table (already built for CONTENT-01's
  ice-breaker capture) as a different `insight_type`?

### D. When/how does a deferred question actually turn into a new session?
Two candidate approaches, not mutually exclusive:
- **Reuse SCR-01's plan-adaptation machinery** (`inngest/adapt-plan.ts`, confirmed already built and
  live as of today) — it already listens for signals and reorders/adjusts the plan. Could a deferred
  question be treated as a new kind of signal that this same job consumes, to insert a new session
  (or expand an existing queued one) rather than just reordering?
- **A dedicated new job** that specifically watches for deferred questions and, once one exists,
  generates a focused new session on exactly that question (using the existing content-generation
  pipeline, scoped to the specific question rather than a whole topic).

Reusing SCR-01's machinery is likely the lower-risk option — same job, extended, rather than a new
parallel system — but this needs to be looked at directly against what `adapt-plan.ts` currently does
before assuming it's a clean fit.

### E. Where does the new session go in the plan?
- Right after the current session (most relevant while it's fresh), or
- Wherever the topic-priority scoring would naturally place it (reusing the same prioritization logic
  from plan generation)?

### F. Does the user get any say, or is this fully automatic?
- Does the new/expanded session just quietly appear in their plan?
- Or does it show up like the existing "Recommended for you" panel (built for CURR-02) — visible,
  with a reason attached, and the user can accept/dismiss it, same pattern as breadth-expansion topics?
  This would reuse existing UI/API (`accept-recommendation`/`dismiss-recommendation`) rather than
  inventing a new interaction.

### G. How many deferred questions justify a whole new session vs. just enriching an existing one?
- One deep question → one dedicated short session?
- Multiple smaller deferred questions across a topic → batched into one session at the end of the arc?
- This probably depends on real usage data we don't have yet — worth treating as "start simple (one
  question = one flag), refine once we see actual patterns" rather than over-designing up front.

## What this does NOT need to solve right now
- The live "should I answer now or defer" judgment call itself (that's a prompt/behavior design
  question, part of the main real-time-context work, not this doc).
- The exact timer/time-remaining injection mechanism (explicitly deferred to after the main
  implementation, per Arun's 2026-07-03 direction).

## Suggested next step for the follow-up discussion
Look directly at `inngest/adapt-plan.ts`'s current logic (what signal shape it consumes today) before
deciding between option D's two candidates — that's the one open question here that isn't a pure
product decision and actually benefits from a quick code check first.
