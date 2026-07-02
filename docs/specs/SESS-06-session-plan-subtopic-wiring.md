# SESS-06 — Session Plan Subtopic Wiring — Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-06-22

---

## 1. Purpose

When a user approves their curriculum plan, `session-designer-auto` creates session rows in the `sessions` table and stores LLM-designed subtopics in each row's `sub_sessions` column. Later, when the user launches a session, `generate-plan` reads `sub_sessions` to produce the teaching outline.

The bug is a **format mismatch**: `session-designer-auto` stores `sub_sessions` as `Array<{ title, type, duration_mins, learning_objective }>` (the full `DesignedSession.subtopics` object shape from `lib/curriculum/session-designer.ts`). `generate-plan/route.ts` at line 263 checks `Array.isArray(session.sub_sessions) && session.sub_sessions.length > 0` — this check passes — but `findSubtopicsFromCatalog()` is still reached for sessions where the column was populated with an earlier, now-mismatched format, or where the Inngest step silently failed to commit the insert.

A secondary manifestation: `KB-01` confirmed that `enabling-team-ai-s2` (and similar pre-fix sessions) has generic subtopics ("Core concepts", "Real-world application", "Key takeaways") because `session-designer-auto` never ran for it, leaving `sub_sessions` empty or null. For those rows a backfill is required.

Without this fix, every session that falls back to `findSubtopicsFromCatalog()` teaches 3 generic subtopics with 0 visual sections, producing a meaningless live session for the user.

---

## 2. User Stories

**As a learner launching a Clio session,**
I want the session outline to show the specific subtopics my curriculum was designed around,
so that the teaching content is relevant to my role and domain, not generic placeholders.

**As a Clio administrator performing a backfill,**
I want existing sessions with empty `sub_sessions` to be repaired from the curriculum plan data that already exists,
so that users who approved plans before this fix benefit immediately without needing to re-onboard.

---

## 3. Trigger / Entry Point

**Primary trigger (new sessions):**
- User approves a curriculum plan on `/dashboard/sessions`
- This fires `distill/plan.approved` Inngest event
- `session-designer-auto` Inngest function handles the event and inserts session rows

**Secondary trigger (backfill):**
- Admin or automated job calls `POST /api/admin/backfill-sub-sessions`
- Can be run manually once after deploy; or triggered from Inngest on deploy event

**Downstream consumer (the route this fix unblocks):**
- `POST /api/sessions/[id]/generate-plan` — reads `sessions.sub_sessions`, used every time a session is launched

**State requirements:**
- User must be authenticated (Clerk)
- User must have an approved `curriculum_plans` row with a populated `visible_sessions` JSONB array
- Each entry in `visible_sessions` must have a `subtopics: string[]` field (written by the curriculum LLM at plan-generation time)

---

## 4. Screen / Flow Description

This feature has no new user-facing screen. The fix is entirely in data wiring. The observable user effect is:

### State A — Session detail page, pre-launch (after fix)
- User navigates to a session on `/dashboard/sessions/[id]`
- The session detail shows the session title and a list of subtopics
- Subtopics displayed are the 4–6 role-specific ones from the curriculum plan (e.g. "What Anthropic Claude is and how it differs from other enterprise LLMs")
- The "Launch session" button is visible

### State B — Session launches, generate-plan runs (after fix)
- User clicks "Launch session"
- `POST /api/sessions/[id]/generate-plan` fires
- `session.sub_sessions` is non-empty and contains objects with a `.title` field
- The route reads `.title` from each object and produces a full teaching outline
- Visual sections are generated (non-zero count)
- Clio voice begins the session with the designed subtopic as the opening topic

### State C — Backfill (one-time, admin-only)
- Admin calls `POST /api/admin/backfill-sub-sessions`
- Endpoint finds all session rows where `sub_sessions IS NULL OR sub_sessions = '[]'`
- For each, it looks up the user's `curriculum_plans` row and finds the matching `visible_session` by `db_session_id`
- Writes the `subtopics: string[]` from the curriculum plan into `sessions.sub_sessions` in the correct object format
- Returns a summary: `{ repaired: N, skipped: M, errors: [] }`

---

## 5. Visual Examples

This fix has no new UI. For documentation clarity, the data states are shown below.

**Before fix — `sessions.sub_sessions` for a broken row:**
```
null
-- or --
[]
-- or --
[{"title":"Core concepts"},{"title":"Real-world application"},{"title":"Key takeaways"}]
```

**After fix — `sessions.sub_sessions` for a correctly wired row:**
```json
[
  { "title": "What Anthropic Claude is and how it differs from other enterprise LLMs",
    "type": "concept", "duration_mins": 5, "learning_objective": "..." },
  { "title": "Why financial services firms are adopting Claude at the function level",
    "type": "example", "duration_mins": 5, "learning_objective": "..." },
  { "title": "Claude consumer vs Claude for Work — the regulatory boundary",
    "type": "concept", "duration_mins": 5, "learning_objective": "..." },
  { "title": "What function-level adoption means for a VP of Technology",
    "type": "application", "duration_mins": 5, "learning_objective": "..." },
  { "title": "Most common first-mover mistakes technology leaders make",
    "type": "pitfalls", "duration_mins": 5, "learning_objective": "..." },
  { "title": "How to frame the Claude opportunity to CTO/CIO in one sentence",
    "type": "application", "duration_mins": 5, "learning_objective": "..." }
]
```

**Backfill endpoint response (text only — no UI):**
```
┌──────────────────────────────────────────┐
│  POST /api/admin/backfill-sub-sessions   │
│                                          │
│  Response 200:                           │
│  {                                       │
│    "repaired": 9,                        │
│    "skipped": 0,                         │
│    "errors": []                          │
│  }                                       │
└──────────────────────────────────────────┘
```

---

## 6. Data Requirements

### Tables read

| Table | Columns read | Purpose |
|---|---|---|
| `sessions` | `id`, `user_id`, `sub_sessions`, `curriculum_plan_id`, `curriculum_session_id` | Identify broken rows; read subtopics for generate-plan |
| `curriculum_plans` | `id`, `user_id`, `visible_sessions` | Source of designed subtopics for backfill |

### Tables written

| Table | Column written | When | Value |
|---|---|---|---|
| `sessions` | `sub_sessions` | On insert (session-designer-auto) | `Array<SubtopicObject>` — see shape below |
| `sessions` | `sub_sessions` | On backfill (admin endpoint) | Same shape, sourced from curriculum_plans |

### `sub_sessions` column format (canonical after this fix)

Each element must match `SubtopicSchema` from `lib/curriculum/session-designer.ts`:

```typescript
{
  title:              string   // 3–120 chars — this is what generate-plan reads
  type:               'concept' | 'example' | 'application' | 'pitfalls' | 'practice' | 'summary'
  duration_mins:      number   // integer, 2–20
  learning_objective: string   // 5–300 chars
}
```

**Important:** `generate-plan/route.ts` only reads `.title`. The other fields are available for future use (e.g. content type routing, visual section selection) but are not consumed today. They must still be stored correctly so they are available without a migration when consumed.

### `curriculum_plans.visible_sessions` structure (source for backfill)

Each element is a `VisibleSession` object. The relevant fields for this fix:

```typescript
{
  session_id:      string    // curriculum-side ID — matches sessions.curriculum_session_id
  db_session_id:   string    // UUID of the sessions row — use this to join
  subtopics:       string[]  // plain strings from curriculum LLM — must be mapped to SubtopicObject on write
  title:           string
  focus:           string
  depth_level:     string
  estimated_minutes: number
}
```

### Mapping rule (string[] → SubtopicObject[])

When writing from `curriculum_plans.visible_sessions[n].subtopics` (a `string[]`), map as follows:

```typescript
subtopics.map((title, i) => ({
  title,
  type: 'concept',           // default — no type information in plain-string source
  duration_mins: Math.max(2, Math.floor(estimatedMinutes / subtopics.length)),
  learning_objective: title  // use title as proxy — no richer data available from this source
}))
```

This mapping is used by the **backfill path only**. The `session-designer-auto` path already receives full `SubtopicObject[]` from `designSessionsForTopic()` and must store them as-is.

### APIs called

None. All reads and writes go through the Supabase JS SDK (`@supabase/supabase-js`). No external API calls.

### Inngest events

No new events. The fix is inside an existing Inngest step (`insert-draft-sessions`) and an existing handler flow.

---

## 7. Success Criteria (Acceptance Tests)

**AC-01 — New session: subtopics stored on insert**
Given a user approves a curriculum plan with `visible_sessions[0].subtopics = ["Topic A", "Topic B", "Topic C"]`,
when `session-designer-auto` completes the `insert-draft-sessions` step,
then the resulting `sessions` row has `sub_sessions` = a non-empty array where each element has a `.title` string matching the designed subtopics from `designSessionsForTopic()`.

**AC-02 — New session: generate-plan uses designed subtopics**
Given a session row has `sub_sessions` populated with 4–6 SubtopicObjects,
when `POST /api/sessions/[id]/generate-plan` is called,
then `findSubtopicsFromCatalog()` is NOT called, the subtopics array has 4–6 items (not 3), and none of the titles are "Core concepts", "Real-world application", or "Key takeaways".

**AC-03 — Backfill: repairs empty rows**
Given `user_3FV2YjHmbMdCS9YnyeFTelDvKUc` has 9 sessions with empty `sub_sessions`,
when `POST /api/admin/backfill-sub-sessions` is called,
then all 9 sessions have `sub_sessions` populated with SubtopicObjects whose `.title` values match the subtopics in `curriculum_plans.visible_sessions` for that user,
and the response body reports `{ repaired: 9, skipped: 0, errors: [] }`.

**AC-04 — Backfill: Session 1 shows correct subtopics**
Given the backfill has run for `user_3FV2YjHmbMdCS9YnyeFTelDvKUc`,
when `POST /api/sessions/[session_1_id]/generate-plan` is called,
then the resulting plan contains exactly these 6 subtopics (in any order):
1. "What Anthropic Claude is and how it differs from other enterprise LLMs"
2. "Why financial services firms are adopting Claude at the function level"
3. "Claude consumer vs Claude for Work (Teams/API) — the regulatory boundary"
4. "What 'function-level adoption' means for a VP of Technology"
5. "Most common first-mover mistakes technology leaders make"
6. "How to frame the Claude opportunity to CTO/CIO in one sentence"

**AC-05 — Backfill: already-populated rows are skipped**
Given a session row already has `sub_sessions` with 4+ elements,
when the backfill runs,
then that row is NOT overwritten,
and the response reports it in `skipped` (not `repaired`).

**AC-06 — Backfill: no matching curriculum plan**
Given a session row has empty `sub_sessions` and no matching `curriculum_plans` row can be found (orphaned session),
when the backfill runs,
then the row is skipped (not errored),
and the session's `sub_sessions` remains unchanged,
and the response includes the session ID in an `orphaned` list (or `skipped` with a note — implementation choice, must be logged).

**AC-07 — TypeScript compiles clean**
Given the changes are applied,
when `npx tsc --noEmit` is run,
then it exits with code 0 and zero type errors.

**AC-08 — generate-plan fallback still works for truly legacy sessions**
Given a session row has `sub_sessions = null` AND no matching curriculum plan exists,
when `POST /api/sessions/[id]/generate-plan` is called,
then `findSubtopicsFromCatalog()` is called as the final fallback and the session still generates (degraded but not broken).

---

## 8. Error States

### session-designer-auto insert step

| Error condition | Current behavior | Required behavior after fix |
|---|---|---|
| Supabase insert fails (network, constraint) | Inngest retries the step | No change — Inngest retry handles this |
| `ds.subtopics` is empty array | Stores `[]` | Same — `generate-plan` will then fall back to catalog (acceptable: session designer should never produce 0 subtopics; the schema enforces `.min(1)`) |
| `ds.subtopics` is undefined | Would store `undefined` → Supabase ignores column | Must not happen — `DesignedSessionSchema` requires `subtopics` to be present; if Zod parse fails, `buildFallbackSessions()` is returned which includes default subtopics |

### Backfill endpoint

| Error condition | Response |
|---|---|
| Caller is not authenticated or not an admin | `401 Unauthorized` |
| Supabase read fails | `500` with error message; no partial writes committed for that batch |
| One session's write fails | Log error, continue to next session, include session ID in `errors[]` in response body |
| `curriculum_plans.visible_sessions` is malformed JSON | Skip that user's sessions, include in `errors[]` |
| Endpoint called twice | Idempotent — second call reports `repaired: 0, skipped: N` because rows already have data |

### generate-plan route (no changes to this file, but documenting expected behavior post-fix)

| Error condition | Expected behavior |
|---|---|
| `sub_sessions` has objects but missing `.title` field | `.map(s => s.title)` returns `undefined` values → subtopics array contains undefined → `buildInitialPlan` receives bad input. This should not happen if fix is correct. If it does, generate-plan should catch and fall back to catalog. |
| `sub_sessions` is present but `length === 0` | Falls through to `findSubtopicsFromCatalog()` — correct existing behavior |

---

## 9. Edge Cases

**Session split across multiple sessions from one curriculum topic**
The curriculum LLM may assign 6 subtopics to a topic, and `designFromPreplannedSubtopics()` may split these into 2 sessions of 3 subtopics each (based on `SUBTOPICS_PER_SESSION = 4`). Each resulting `sessions` row must receive its own slice of subtopics (not all 6). This is already handled by `designFromPreplannedSubtopics()` — the fix must not flatten or re-join the slices.

**Backfill: curriculum plan has multiple arcs / multiple visible_sessions entries per user**
The join must be by `db_session_id` (the UUID stored in `visible_sessions[n].db_session_id`) matching `sessions.id`. Do not join by array position or `session_index` — these may not be aligned if sessions were partially deleted.

**Backfill: session is `completed` or `active`**
The backfill should still repair `sub_sessions` for completed sessions — the KB content pipeline reads these too (via `generate-plan`). Do not skip based on status.

**User with no curriculum plan (pre-curriculum-engine users)**
Some early users have sessions but no `curriculum_plans` row. Their sessions will have empty `sub_sessions` and no source to backfill from. These are orphaned sessions — skip them, log them, do not error.

**`visible_sessions` entry has `subtopics: []` (empty string array)**
If the curriculum LLM produced a topic with zero subtopics (should not happen, but defensively), the backfill must skip wiring for that session and log it. Do not write an empty array — leave it null so future re-design can fill it.

**Concurrent backfill runs**
If the endpoint is called twice simultaneously, both runs will find the same empty rows, attempt to write the same data. This is safe because writes are idempotent (same source data). The second run's writes are redundant but harmless. No locking is required.

---

## 10. Out of Scope

- Changes to the `generate-plan` route itself — the route's reading logic (`sub_sessions` → `.title` map) is correct and must not change.
- Changes to `findSubtopicsFromCatalog()` — this remains the final fallback for truly orphaned sessions and must be preserved.
- UI changes to the session detail page — subtopic display on the session card is a separate feature.
- Changes to how the curriculum LLM generates subtopics — the content of the subtopics is out of scope; this fix is purely about wiring the data from plan to session row.
- Session re-design (allowing a user to regenerate their curriculum plan) — separate feature.
- Automated detection and alerting when `sub_sessions` is empty post-insert — monitoring/observability out of scope for this fix.
- The `visual sections` count issue mentioned in the bug context — if visual sections are zero, that is a separate problem in `generate-plan`'s visual generation logic, not a subtopic wiring issue. Do not conflate.

---

## 11. Open Questions

None. All questions were answered by the engineering investigation before this spec was written.

---

## 12. Dependencies

| Dependency | Status | Notes |
|---|---|---|
| `lib/curriculum/session-designer.ts` — `SubtopicSchema` and `DesignedSession` types | Exists | Types must be imported by the backfill endpoint to validate data before writing |
| `curriculum_plans.visible_sessions` JSONB column populated | Exists | Written at plan-generation time; source of truth for backfill |
| `sessions.sub_sessions` JSONB column | Exists | Already in schema; no migration required |
| `sessions.curriculum_plan_id` and `sessions.id` columns | Exists | Used as join key in backfill |
| Admin auth guard | Exists | Backfill endpoint must use the same admin guard used by other `/api/admin/*` routes |
| `inngest/session-designer-auto.ts` — `insert-draft-sessions` step | Exists | The step to be verified/fixed is at lines 106–139 of this file |

---

## Implementation Notes for Developer

These notes are not requirements — they are guard rails to prevent the developer from going down incorrect paths based on what the code investigation found.

**1. The insert at line 124 already runs `sub_sessions: ds.subtopics`.**
Before writing any code, verify whether the column is actually empty for affected sessions by querying:
```sql
SELECT id, sub_sessions FROM sessions WHERE user_id = 'user_3FV2YjHmbMdCS9YnyeFTelDvKUc';
```
If `sub_sessions` is non-null and non-empty, the bug may be downstream (format mismatch on read) rather than a missing write. Diagnose before changing the insert.

**2. The `sub_sessions` Postgres column type.**
Confirm the column type is `jsonb` (not `text` or `json`). If it is `text`, the `Array.isArray()` check in generate-plan will fail because Supabase returns a string, not a parsed array. This could be the actual root cause for some rows.

**3. The backfill maps `string[]` → `SubtopicObject[]`.**
The source in `curriculum_plans.visible_sessions[n].subtopics` is a plain `string[]` (the curriculum LLM outputs strings). The `sessions.sub_sessions` format is `SubtopicObject[]`. Use the mapping rule defined in Section 6. Do not store bare strings.

**4. Join for backfill is `visible_sessions[n].db_session_id === sessions.id`.**
`db_session_id` is written back into `curriculum_plans.visible_sessions` at the end of `insert-draft-sessions` (line 135 of `session-designer-auto.ts`). Use this field. Do not use array position.

**5. Do not modify `generate-plan/route.ts` unless the type investigation reveals a genuine mismatch.**
The reading logic is correct for the canonical format. The fix is in the writing path (session-designer-auto) and the backfill.
