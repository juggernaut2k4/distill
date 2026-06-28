# CURR-SEQ-01 — Pedagogical Curriculum Sequencer

**Status:** Approved — implement immediately  
**Owner:** CEO Agent  
**Date:** 2026-06-27  

---

## 1. Problem Statement

When a user's curriculum plan is generated, sessions are ordered sequentially by the arc structure the LLM produced. Arc 1 sessions always come before Arc 2 sessions — regardless of whether Arc 2 content is actually a prerequisite for Arc 1.

**Example of bad ordering today:**
- Session 1: "Implementing LLM Streaming APIs" (advanced, hands-on)
- Session 2: "How LLMs Work: Tokens & Context Windows" (foundational — SHOULD BE FIRST)
- Session 3: "Evaluating AI Vendors" (strategic)

A user who tries to implement streaming before understanding tokens and context windows will be lost. The system is ordering by arc creation order, not by pedagogical dependency.

Additionally, user-selected topics and LLM-generated topics are not stitched — they appear as two independent blocks rather than an interleaved, coherent learning path.

---

## 2. Goal

After all draft sessions are created, run an LLM-powered analysis that:

1. Reads all sessions together (title + focus + subtopics)
2. Identifies prerequisite relationships between them
3. Returns an optimal pedagogical ordering — foundational first, applied last
4. Reassigns `session_index` values to match that order
5. Updates `visible_sessions` in `curriculum_plans` to reflect the reordered list
6. Stores the sequencing rationale for auditability

---

## 3. Sequencing Rules the LLM Must Follow

In priority order:

1. **Prerequisite-first**: If session B uses concepts introduced in session A, A must come before B.
2. **Foundational before applied**: Conceptual understanding before hands-on implementation before strategic application.
3. **Respect user intent on relative order**: When two sessions have no dependency relationship and a user explicitly selected one, prefer the user's ordering as a tiebreaker.
4. **Avoid adjacent repetition**: Don't place two sessions on the same subtopic back-to-back.
5. **Hook early**: The first session should be the most accessible and immediately relevant to the user's stated worry/goal — not the most abstract.

---

## 4. Data Flow

```
session-designer-auto: insert-draft-sessions (existing)
         ↓
[NEW STEP] sequence-sessions
  1. Load all inserted sessions (title, focus, sub_sessions)
  2. Call Claude: "Given these N sessions for a [role] in [industry] learning AI,
     return the optimal pedagogical sequence"
  3. Claude returns: { ordered_session_ids: [...], rationale: "..." }
  4. UPDATE sessions SET session_index = new_index for each session
  5. Reorder visible_sessions array in curriculum_plans to match
  6. UPDATE curriculum_plans SET sequencing_rationale = rationale
         ↓
kickoff-session-1-content (existing — uses session at new index 1)
```

---

## 5. Claude Prompt Design

**System prompt:**
```
You are a learning experience designer. You receive a list of AI learning sessions 
designed for a business executive. Your job is to return the optimal sequence 
for a learner to work through these sessions.

Return ONLY valid JSON. No markdown, no explanation outside the JSON.
```

**User prompt:**
```
Learner profile:
- Role: {role}
- Industry: {industry}  
- AI maturity: {maturity}
- Learning goal: {learningGoal}
- Primary concern: {worry}

Sessions to sequence (total: {N}):
{sessions as numbered list: index | title | focus | subtopics[0..2]}

Sequencing rules:
1. Foundational concepts must precede sessions that build on them
2. The first session must be accessible and directly relevant to the learner's concern
3. Practical/implementation sessions follow conceptual sessions
4. Strategic application sessions come last

Return JSON:
{
  "ordered_session_ids": ["<uuid>", "<uuid>", ...],
  "rationale": "<2-3 sentences explaining the key sequencing decisions>"
}

The ordered_session_ids array must contain exactly {N} UUIDs matching the input session IDs.
```

---

## 6. Validation Rules

Before writing new indexes, validate Claude's response:
- `ordered_session_ids` must be an array
- Length must exactly equal the number of draft sessions
- Every session ID from the DB must appear exactly once
- No duplicates

If validation fails: log a warning, keep original ordering, mark plan with `sequencing_status = 'fallback_order'`.

---

## 7. DB Changes

**`curriculum_plans` table — two new columns:**

| Column | Type | Default | Purpose |
|---|---|---|---|
| `sequencing_rationale` | `TEXT` | `NULL` | Claude's explanation of why sessions are in this order |
| `sequencing_status` | `TEXT` | `'pending'` | `pending` / `completed` / `fallback_order` |

Migration: `049_curriculum_sequencing.sql`

---

## 8. QA Endpoint — Step 7 of Validation

`GET /api/admin/qa-curriculum-order?userId=<id>`

Returns:
```json
{
  "ok": true,
  "sessions_in_order": [
    { "index": 1, "title": "...", "focus": "...", "is_foundational": true },
    { "index": 2, "title": "...", "focus": "...", "is_foundational": false },
    ...
  ],
  "sequencing_rationale": "...",
  "sequencing_status": "completed",
  "issues": ["None — all checks passed"]
}
```

Checks:
- `sequencing_status` is `completed` (not `fallback_order` or `pending`)
- All sessions have a non-null, non-empty title
- No adjacent sessions have the same `curriculum_session_id` prefix (avoids repetition)
- Session 1 is not the highest-numbered session from the original order (confirms resequencing actually happened)

---

## 9. 6-Step Validation → 7-Step Validation

The mandatory QA checklist when Arun provides a user ID becomes:

| Step | What to Check | How |
|---|---|---|
| 1 | Topics saved to DB | Vercel logs: `POST /api/topics 200` |
| 2 | LLM curriculum in v2 arc format | Vercel logs: `[curriculum-generator] Plan generated` |
| 3 | Sessions designed with real LLM titles | Vercel logs: `[session-designer-auto] N arcs → M sessions` |
| 4 | Plan page shows flat session list | Vercel logs: `updatedVisible` written |
| 5 | KB content pipeline complete | Vercel logs: `verified N cache row(s)` |
| 6 | Content/viz/script quality | `GET /api/admin/qa-session-context?sessionId=<id>` |
| **7** | **Curriculum pedagogically sequenced** | **`GET /api/admin/qa-curriculum-order?userId=<id>`** |

---

## 10. Non-Goals

- Does not change the adapt-plan.ts reactive reordering — that remains for post-session signal-based reordering
- Does not reorder completed or in-progress sessions — only draft sessions
- Does not run again after plan is approved (one-time at generation time)

---

## 11. Error Handling

- If Claude API fails: keep original order, set `sequencing_status = 'fallback_order'`, log `[curriculum-sequencer] ERROR`
- If response is invalid JSON: same fallback
- If ID array is wrong length/has duplicates: same fallback
- Fallback never causes the pipeline to fail — session 1 content generation still proceeds

---

## 12. Acceptance Criteria

- [ ] New `sequence-sessions` step fires after `insert-draft-sessions` in session-designer-auto
- [ ] Sessions in DB have new `session_index` values reflecting pedagogical order
- [ ] `visible_sessions` array order matches new `session_index` order
- [ ] `curriculum_plans.sequencing_rationale` is populated
- [ ] `curriculum_plans.sequencing_status = 'completed'` on success
- [ ] Fallback path works: original order preserved when Claude fails
- [ ] Migration 049 applied
- [ ] `GET /api/admin/qa-curriculum-order?userId=<id>` returns `ok: true`
- [ ] Step 7 added to QA validation memory
