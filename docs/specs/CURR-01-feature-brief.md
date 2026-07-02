# CURR-01 — Content-First Session Architecture
## CEO Feature Brief

Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-26

---

## The Problem

When Clio plans a learning curriculum today, it generates sessions and subtopics at the same time. The LLM picks a topic — say, "How Claude Works" — and produces a set of sessions, each with a fixed subtopic count driven by session duration (6 subtopics for a 15-minute session). If a topic genuinely needs 40 subtopics to teach completely but the formula only allocates 36 across 6 sessions, the remaining 4 subtopics are silently dropped. The user never sees them. The learning feels incomplete, and they cannot tell why.

This is a structural flaw, not a content quality problem. The formula decides how many subtopics fit before the LLM has had a chance to figure out how many the topic actually needs.

---

## The Solution

Separate subtopic enumeration from session division. Do them in two distinct steps.

Step 1 — the LLM enumerates all subtopics for an arc, with no session boundaries and no cap. It asks: "What does a learner need to know to fully understand this arc?" The answer is a flat, ordered list. Coverage completeness is the only criterion.

Step 2 — pure code (no LLM, no randomness) divides that flat list into sessions based on the user's preferred session duration. 15-minute sessions get 6 subtopics each. 30-minute sessions get 14. The division is mechanical and deterministic. Nothing is dropped.

If an arc's last chunk of subtopics is too small to stand alone as a full session, those subtopics carry over and combine with the first subtopics of the next arc to fill one cross-arc session. If the remainder is large enough to stand alone as a shorter session, it does.

The result: every subtopic the LLM identifies gets a session. Session count is driven by content, not by a formula.

---

## What Changes

- Planner LLM output shape: arcs now emit `comprehensive_subtopics[]` (flat list per arc) instead of `sessions[{ subtopics[] }]`
- Planner system prompt: replaces per-session subtopic count instructions with arc-level coverage completeness instructions
- New file `lib/curriculum/session-organizer.ts`: pure-code function that divides arc subtopics into sessions
- Session-designer: receives pre-allocated subtopics, does no internal chunking, schema cap raised from 6 to 30 subtopics, gets `roleLevel` injected into prompt
- Three bug fixes shipped alongside: wrong `estimated_minutes` formula, schema cap at 6, generic "executive platform" framing

---

## What Does NOT Change

- Script generation (140-word TEACH per subtopic — unchanged)
- Visualization generation (3-item visual per subtopic — unchanged)
- Knowledge base structure and storage
- Tier limits (starter: 5 visible sessions, pro/executive: 10 visible sessions)
- Session delivery, scheduling, and the approve flow
- The enrichment pipeline (FB-007 3-layer narrative runs after the planner, unchanged)

---

## Expected User Outcome

A user who selects "Claude" as their learning topic and prefers 15-minute sessions will get exactly as many sessions as needed to cover every subtopic the LLM identifies as essential — whether that is 4 sessions or 12. Nothing is dropped. The curriculum feels complete because it is complete.
