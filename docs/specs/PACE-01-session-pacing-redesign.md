# Feature Brief: PACE-01 — Session Pacing and Sequencing Redesign
From: CEO Agent (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-06-26

## Summary

Redesign how live sessions are structured and paced. Sessions currently open without a context anchor and run sections too long. This brief defines a fixed pacing formula, a fixed word budget, and a mandatory arc template that all sessions must follow.

## Problem Being Solved

Live session observation revealed two failures:

1. **No context anchor.** Session 1 opened directly into model comparison detail. Users had no frame for why this topic matters to their role or how it connects to what they already know. Without that anchor, the detail lands in a vacuum.

2. **Sections run too long.** Each section took approximately 5 minutes, which is too slow for an executive audience. Attention drops before the section closes.

## Goals

- Reduce each section to approximately 2 minutes: 1 minute of Clio teaching, followed by a question, followed by ~1 minute of Q&A (user answers, Clio gives feedback).
- Make the section count a deterministic function of session duration with no manual override needed.
- Enforce a fixed word budget per section so scripts stay within the 1-minute teach window.
- Give every session a mandatory structural arc so the user always knows where they are and ends with something actionable.

## Decisions Made (final — do not re-open)

| Decision | Choice |
|---|---|
| Section duration target | 2 min (1 min teach + 1 min Q&A) |
| Section count formula | `floor((durationMins - 2) / 2)` — no cap, applies at all durations |
| Script TEACH word budget | Fixed at 140 words per section |
| Section arc (every session) | Section 1 = context anchor; Sections 2 to N-1 = core concepts in dependency order; Section N = practical application / next action |
| Session 1 of any topic arc | Enrichment must enforce `depth_level = 'foundation'` |
| Tab count | Equals section count (e.g. 6–7 tabs for a 15-min session) |

## Non-Goals

- This brief does not redesign the visual tab component itself (that is LIVE-01 scope).
- It does not change how subtopics are stored or named (that is SESS-06 scope).
- It does not change session scheduling or frequency.

## Dependencies

1. **SESS-06 must be resolved first.** The section structure change will invalidate the KB content cache. Re-generating before SESS-06 is applied wastes LLM cost on wrong subtopics. BA must sequence PACE-01 implementation after SESS-06 is live.

2. **Coordinate with LIVE-01.** The viz desync fix (LIVE-01) touches the same section object structure. BA must align PACE-01 and LIVE-01 data schemas so they do not conflict.

## Questions for BA

1. How does the 140-word budget interact with the existing script generation prompt? Document the exact field and prompt change needed.
2. What is the DB representation of the "context anchor" arc role for Section 1? Is this a new field on `sub_sessions`, or enforced purely in the LLM prompt?
3. For the section count formula, what is the minimum session duration that produces at least 2 sections? Document the edge case (e.g. a 5-min session gives 1 section — what arc applies?).
4. How does `depth_level = 'foundation'` get enforced in the enrichment step — is it a param passed to the LLM, a DB column check, or both?
5. What cache invalidation is needed when this ships? Which sessions need to be re-generated, and in what order?
