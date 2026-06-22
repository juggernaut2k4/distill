# TERM-01 — Terminology Migration Plan
Version: 1.0
Status: PHASE 1 COMPLETE — Phase 2 and 3 pending
Author: Business Analyst Agent
Date: 2026-06-22

---

## 1. Executive Summary

The Clio codebase contains a critical naming collision: the word **"subtopics"** is used to mean two structurally different things in the same codebase.

**TYPE A — Tabs inside a live session (THE COLLISION).**
These are the navigable segments displayed during a live Clio voice coaching session. A single Session might have 3–6 of them. Examples: "What is a context window?", "Why token limits matter for executives". These are what the user clicks through as tabs during the session. They are stored in `sessions.subtopics` (JSONB) and in `session_plan.subtopics` (JSONB within `sessions.session_plan`).

**TYPE B — AI-generated curriculum planning items (CORRECT USAGE).**
These are the line-items the curriculum planner LLM produces when designing a learning arc — e.g. the list of topics a sub-topic covers before the session designer chunks them into sessions. They live entirely within `lib/curriculum/planner.ts`, `lib/curriculum/enrichment.ts`, `lib/curriculum/types.ts`, and `lib/content/curriculum.ts`. The word "subtopics" in these files is accurate and should not change.

**The official terminology hierarchy is:**
```
Topic → Sub-topic → Session → Sub-session
```

TYPE A things are **Sub-sessions**. They should be called that everywhere: in TypeScript identifiers, in database column names, and in API response fields.

**Without this migration**, any developer reading `sessions.subtopics` must know from context whether they are looking at TYPE A or TYPE B. This ambiguity has already produced bugs (visualization fallback root cause, documented in `project_visualization_fallback.md`) and will produce more as the codebase grows.

**Current state:** TYPE A identifiers use `subtopics` / `Subtopic` / `subtopics: []` throughout TypeScript source, one database column (`sessions.subtopics`), and all seven affected API response fields.

**Target state:** TYPE A identifiers use `subSessions` / `SubSession` / `sub_sessions` throughout TypeScript source, the database column `sessions.sub_sessions`, and API response fields named `sub_sessions`.

---

## 2. Scope

### Phase 1 — TypeScript Internal Rename (Activity 1, running in parallel with this document)

**IN SCOPE:**
- All TypeScript variable names, local constants, function parameter names, and type/interface names that refer to TYPE A items
- Specifically: `SessionPlanSubtopic` → `SessionPlanSubSession`, `SubtopicSchema` → `SubSessionSchema`, `Subtopic` (the exported type from `lib/curriculum/session-designer.ts`) → `SubSession`, `AgendaEmailSubtopic` → `AgendaEmailSubSession`, and all lowercase `subtopics` variable names in TYPE A contexts
- All files in: `lib/session-plan.ts`, `lib/curriculum/session-designer.ts`, `inngest/session-agenda-email.ts`, `inngest/session-plan-generator.ts`, `inngest/session-content-async.ts`, `inngest/session-content-pipeline.ts`, `app/api/sessions/[id]/generate-plan/route.ts`, `app/api/sessions/[id]/generate-content/route.ts`, `app/api/plan/approve/route.ts`, `app/api/sessions/schedule/route.ts`

**NOT IN SCOPE for Phase 1:**
- The database column `sessions.subtopics` — stays as `subtopics` until Phase 2
- API response JSON field names — stay as `subtopics` until Phase 3
- Any Supabase `.select()` string that names the column — stays as `'subtopics'` until Phase 2
- The Zod input schema field `subtopics` in `app/api/sessions/schedule/route.ts` — the DB column must be renamed first

**Zero application impact:** Phase 1 is purely internal TypeScript renaming. No DB queries change. No API contracts change. The running application is unaffected.

### Phase 2 — Database Column Rename

**IN SCOPE:**
- Rename `sessions.subtopics` (JSONB) → `sessions.sub_sessions` in Supabase
- Update every Supabase `.select()`, `.update()`, and `.insert()` call that names this column
- Update the Zod request schema field in `app/api/sessions/schedule/route.ts` from `subtopics` to `sub_sessions`

**NOT IN SCOPE for Phase 2:**
- API response JSON field names (the field returned to callers) — stays as `subtopics` in JSON until Phase 3
- Frontend component prop names — unchanged until Phase 3 changes the API contract

### Phase 3 — API Response Field Name Rename

**IN SCOPE:**
- Rename the `subtopics` field in JSON responses from all seven affected endpoints to `sub_sessions`
- Update every frontend component and page that reads this field from API responses

### Permanently OUT OF SCOPE (never change)

The following files use `subtopics` to mean TYPE B (curriculum planning items) and must NOT be touched by this migration:
- `lib/curriculum/types.ts` — `CurriculumSession.subtopics: string[]`
- `lib/curriculum/planner.ts` — LLM prompt and Zod schema for curriculum plan output
- `lib/curriculum/enrichment.ts` — dimension-coverage checks on curriculum sessions
- `lib/content/curriculum.ts` — hardcoded topic catalog with `subtopics: string[]` arrays
- `lib/content/topic-context-generator.ts` — uses TYPE B subtopics for context generation
- `lib/content/curriculum-from-selection.ts` — curriculum-from-selection pipeline

The word "subtopics" in those files refers to items in a curriculum plan, which is the correct English meaning, and aligns with the TYPE B definition.

---

## 3. Phase 2 — Database Column Rename (Detailed Steps)

### Target

Rename the JSONB column `sessions.subtopics` to `sessions.sub_sessions`.

The column was introduced in migration `022_session_designer.sql` with:
```sql
ADD COLUMN IF NOT EXISTS subtopics jsonb DEFAULT '[]';
COMMENT ON COLUMN sessions.subtopics IS 'LLM-designed subtopics for this session: [{title, type, duration_mins, learning_objective}].';
```

Its value is an array of objects shaped like `[{ title: string, type: string, duration_mins: number, learning_objective: string }]`.

---

### Step 2.1 — Write the Migration SQL

Create file: `supabase/migrations/033_rename_subtopics_to_sub_sessions.sql`

```sql
-- ─── 033_rename_subtopics_to_sub_sessions.sql ─────────────────────────────
-- Phase 2 of TERM-01 terminology migration.
-- Renames sessions.subtopics → sessions.sub_sessions.
-- The column stores LLM-designed sub-sessions (tabs in a live session):
-- [{title, type, duration_mins, learning_objective}]
-- "subtopics" was a misnomer — these are navigable sub-sessions, not curriculum subtopics.

-- Step A: Add the new column, copying all existing data
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS sub_sessions jsonb DEFAULT '[]';

UPDATE sessions
  SET sub_sessions = subtopics
  WHERE subtopics IS NOT NULL;

COMMENT ON COLUMN sessions.sub_sessions IS
  'LLM-designed sub-sessions (tabs) for this session: [{title, type, duration_mins, learning_objective}]. Renamed from subtopics (TERM-01).';

-- Step B: Drop the old column
-- NOTE: Only run this AFTER the dual-write period (Step 2.3) and verification gate (Step 2.4) are complete.
-- Kept here as a reminder — apply in a separate migration: 034_drop_subtopics_column.sql
```

Create a separate file for the drop: `supabase/migrations/034_drop_subtopics_column.sql`

```sql
-- ─── 034_drop_subtopics_column.sql ────────────────────────────────────────
-- Final step of Phase 2 (TERM-01).
-- Drops the old sessions.subtopics column after dual-write period is verified complete.
-- Do NOT apply until verification gate 2.4 passes.

ALTER TABLE sessions DROP COLUMN IF EXISTS subtopics;

COMMENT ON TABLE sessions IS 'Updated 034: subtopics column removed, replaced by sub_sessions.';
```

**Files to create:**
- `/Users/arunprakash/Documents/claudeWS/distill/distill/supabase/migrations/033_rename_subtopics_to_sub_sessions.sql`
- `/Users/arunprakash/Documents/claudeWS/distill/distill/supabase/migrations/034_drop_subtopics_column.sql`

**Test before proceeding to Step 2.2:**
```bash
# Apply migration 033 to the Supabase project
npx supabase db push

# Verify both columns exist with the same data
# Connect to DB and run:
# SELECT id, subtopics, sub_sessions FROM sessions LIMIT 5;
# Result: sub_sessions should match subtopics for every row
```

**Rollback if Step 2.1 goes wrong:**
```sql
ALTER TABLE sessions DROP COLUMN IF EXISTS sub_sessions;
```

---

### Step 2.2 — Dual-Write Period

While both columns exist, update every write path to write to **both** `subtopics` and `sub_sessions`. This ensures no data is lost if a rollback is needed.

Every Supabase `.update()` or `.insert()` that writes `subtopics` must also write `sub_sessions` with the same value.

**Files to change:**

**`app/api/sessions/schedule/route.ts`** (line 14)
- The Zod request body currently has `subtopics: z.array(z.string()).default([])`.
- Change to accept both: add `sub_sessions: z.array(z.string()).default([])` as an alias, or rename. During dual-write, write to both columns in the Supabase upsert.
- Current Supabase write: wherever this route writes `subtopics:` to the sessions table, add `sub_sessions:` with the same value.

**`app/api/plan/approve/route.ts`** (lines 100, 120)
- Line 100: `subtopics: cs.subtopics as string[] | undefined` — add `sub_sessions: cs.subtopics as string[] | undefined` alongside it.
- Line 120: `subtopics: ds.subtopics` — add `sub_sessions: ds.subtopics` alongside it.
- Line 192: `.select('id, session_index, subtopics')` — change to `.select('id, session_index, subtopics, sub_sessions')` (reads both during transition).

**`app/api/sessions/[id]/generate-plan/route.ts`** (lines 283, 301, 318, 360)
- Each Supabase `.update({ subtopics: ... })` call — add `sub_sessions: ...` with the same value alongside.
- Line 241: `.select('id, session_title, topic_id, session_plan, subtopics')` — add `sub_sessions` to the select.

**`inngest/session-plan-generator.ts`** (lines 60, 81)
- Each `{ subtopics: subtopicsAfterFirst }` and `{ subtopics: allSubtopics }` Supabase update — add `sub_sessions:` alongside.

**`inngest/session-content-async.ts`** (lines 69, 324)
- Line 69: `.select(... 'subtopics')` — add `sub_sessions` to select.
- Line 324: `.update({ session_plan: { ...plan, subtopics: updatedSubtopics } })` — this writes to `session_plan` JSONB (a nested field), not the column directly; flag for Phase 3 (session_plan.subtopics is part of the API field rename, not the column rename).

**`inngest/session-content-pipeline.ts`** (line 82)
- `.select('id, session_title, topic_id, topics, session_plan, curriculum_session_id, subtopics')` — add `sub_sessions` to select.
- Line 108: `const jsonbSubtopics = (session.subtopics as ...)` — change to read from `sub_sessions` (since by this point 033 has been applied, `sub_sessions` is populated).

**Test before proceeding to Step 2.3:**
```bash
# Trigger a plan approval for a test session.
# Then verify in DB:
# SELECT id, subtopics, sub_sessions FROM sessions WHERE curriculum_plan_id IS NOT NULL LIMIT 5;
# Both columns must be non-null and contain identical data.
npx tsc --noEmit  # Must pass with zero errors
npm run build     # Must pass
```

**Rollback if Step 2.2 goes wrong:**
```sql
-- Remove sub_sessions column (migration 033 created it)
ALTER TABLE sessions DROP COLUMN IF EXISTS sub_sessions;
```
Then revert the TypeScript files to write only to `subtopics`.

---

### Step 2.3 — Read Switchover

Update all Supabase `.select()` calls to read from `sub_sessions` instead of `subtopics`. The code no longer reads from `subtopics`; it reads from `sub_sessions`. Writes still go to both (dual-write continues until Step 2.5).

This is done by replacing every `.select('... subtopics ...')` with `.select('... sub_sessions ...')` in the files listed in Step 2.2, and updating the variable assignment on the TypeScript side from `session.subtopics` to `session.sub_sessions`.

**Files to change** (same files as Step 2.2 — switchover of the read side only):

In each file, the pattern `(session as unknown as { subtopics?: unknown }).subtopics` becomes `(session as unknown as { sub_sessions?: unknown }).sub_sessions`.

In `app/api/sessions/[id]/generate-plan/route.ts` lines 263–264:
```typescript
// Before:
const designedSubtopics = Array.isArray(session.subtopics) && session.subtopics.length > 0
  ? (session.subtopics as Array<{ title: string }>).map((s) => s.title)
// After:
const designedSubSessions = Array.isArray(session.sub_sessions) && session.sub_sessions.length > 0
  ? (session.sub_sessions as Array<{ title: string }>).map((s) => s.title)
```

In `app/api/plan/approve/route.ts` lines 201:
```typescript
// Before:
(s) => Array.isArray(s.subtopics) && (s.subtopics as unknown[]).length > 0
// After:
(s) => Array.isArray(s.sub_sessions) && (s.sub_sessions as unknown[]).length > 0
```

**Test before proceeding to Step 2.4:**
```bash
npx tsc --noEmit
npm run build

# Manual API test — approve a plan and verify session content generates correctly:
curl -X POST https://distill-peach.vercel.app/api/plan/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{"planId": "<plan_id>"}'
# Assert: sessions are created with sub_sessions populated, content generation fires

# Verify DB read is coming from sub_sessions (not subtopics):
# SELECT id, sub_sessions FROM sessions WHERE sub_sessions != '[]'::jsonb LIMIT 5;
# All should have data.
```

**Rollback if Step 2.3 goes wrong:**
Revert TypeScript changes in Step 2.3 to read from `subtopics` again. No DB change needed — both columns still exist.

---

### Step 2.4 — Verification Gate

All of the following must be true before proceeding to Step 2.5:

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npm run build` passes with zero errors
- [ ] `sessions.sub_sessions` column exists and is non-null for all sessions that previously had non-null `subtopics`
- [ ] A full end-to-end flow has been verified: topic selection → curriculum plan approval → sessions created with `sub_sessions` populated → content generation fires → live session loads tabs correctly
- [ ] No Supabase query in the codebase references `subtopics` as a column name (grep confirms: `grep -rn "\.select.*subtopics\|update.*subtopics" app/ inngest/ lib/ | grep -v "session_plan"`)
- [ ] Phase 2 has been stable in production (Vercel) for at least 48 hours with no errors related to `sub_sessions` being null or missing
- [ ] The baseline API responses captured in Section 5.1 still match (same data, just served from the new column)

---

### Step 2.5 — Drop Old Column

Only after the verification gate in Step 2.4 is fully passed, apply migration 034:

```bash
npx supabase db push  # Applies 034_drop_subtopics_column.sql
```

Also remove the dual-write code — every place that writes `subtopics:` alongside `sub_sessions:` can now drop the `subtopics:` side.

**Files to change:** Same files as Step 2.2 — remove the redundant `subtopics:` write from every Supabase update/insert call.

**Test after Step 2.5:**
```bash
# Verify column is gone:
# SELECT column_name FROM information_schema.columns WHERE table_name='sessions' AND column_name='subtopics';
# Must return zero rows.

npx tsc --noEmit
npm run build
# Run the same end-to-end flow as Step 2.4 to confirm nothing breaks.
```

**Rollback if Step 2.5 goes wrong:**
```sql
-- Recreate the column and restore data from sub_sessions
ALTER TABLE sessions ADD COLUMN subtopics jsonb DEFAULT '[]';
UPDATE sessions SET subtopics = sub_sessions WHERE sub_sessions IS NOT NULL;
COMMENT ON COLUMN sessions.subtopics IS 'Restored from sub_sessions (TERM-01 rollback).';
```
Then re-add the dual-write code to the TypeScript files.

---

## 4. Phase 3 — API Response Field Name Rename (Detailed Steps)

### Target

Rename the `subtopics` key in JSON API responses to `sub_sessions` across all seven affected endpoints.

This is a breaking change to the API contract. Every frontend component that consumes these fields must be updated in the same deployment.

**Important distinction:** `session_plan.subtopics` (the JSONB key inside the `session_plan` column's JSON value) is a separate concern from the API response field. When an API route returns `session_plan` as an object, the nested `session_plan.subtopics` key is also visible to callers. Both the top-level field and the nested field must be renamed in Phase 3.

---

### Endpoint 1: `POST /api/sessions/schedule`

**File:** `app/api/sessions/schedule/route.ts`

**Request body change:**
```jsonc
// Before:
{ "sessionId": "...", "subtopics": ["...", "..."], "scheduledAt": "..." }

// After:
{ "sessionId": "...", "sub_sessions": ["...", "..."], "scheduledAt": "..." }
```

**Zod schema change** (line 14):
```typescript
// Before:
subtopics: z.array(z.string()).default([]),
// After:
sub_sessions: z.array(z.string()).default([]),
```

**Frontend callers:** Search for callers of this endpoint across all components. The schedule flow in `app/dashboard/schedule-setup/ScheduleSetupClient.tsx` must send `sub_sessions` instead of `subtopics` in the request body.

**Must change in lockstep:** `ScheduleSetupClient.tsx` and the route handler.

---

### Endpoint 2: `POST /api/plan/approve`

**File:** `app/api/plan/approve/route.ts`

**Response shape change:** This endpoint does not return `subtopics` directly in its response body — it writes to the DB and fires content generation. However, during Phase 2 the internal variable names will already use `sub_sessions`. If this route returns session data in its response (check the actual return statement), rename any `subtopics` key in the response object.

**What must change:** Lines 100 and 120 refer to `cs.subtopics` and `ds.subtopics` which are reading from the curriculum plan data structure (TYPE B — do NOT rename). Confirm these are reading from the curriculum plan, not the sessions table column, before touching them.

**Lockstep requirement:** No frontend component change needed if the response does not include a `subtopics` field. Verify by reading the full return statement of this route.

---

### Endpoint 3: `GET /api/sessions/[id]/generate-plan`

**File:** `app/api/sessions/[id]/generate-plan/route.ts`

**Response shape change:**
```jsonc
// Before (the route returns a plan object):
{
  "plan_status": "ready",
  "subtopics": [
    { "id": "...", "title": "...", "visual_status": "ready", "template_section": { ... }, "skipped": false }
  ]
}

// After:
{
  "plan_status": "ready",
  "sub_sessions": [
    { "id": "...", "title": "...", "visual_status": "ready", "template_section": { ... }, "skipped": false }
  ]
}
```

The PATCH handler on this route (toggle-skip) also uses `subtopicId` in the request body:
```jsonc
// Before:
{ "subtopicId": "...", "skipped": true }

// After:
{ "subSessionId": "...", "skipped": true }
```

**Frontend callers:**
- `app/dashboard/walkthrough/WalkthroughClient.tsx` — reads the plan response and maps over sub-sessions. Must change field access from `.subtopics` to `.sub_sessions`, and the PATCH body field from `subtopicId` to `subSessionId`.
- `app/api/recall/bot/route.ts` — line 87–88: reads `plan.subtopics` for logging. Must change to `plan.sub_sessions`.

**Must change in lockstep:** `WalkthroughClient.tsx`, `app/api/recall/bot/route.ts`, and the route handler. All three in the same deployment.

---

### Endpoint 4: `GET /api/sessions/[id]/generate-content`

**File:** `app/api/sessions/[id]/generate-content/route.ts`

**Response shape change** (line 112):
```jsonc
// Before:
{
  "session_id": "...",
  "session_title": "...",
  "subtopics": [
    { "title": "...", "slug": "...", "pipeline_status": "ready", "training_script": "...", "content_outline": { ... }, "template_type": "..." }
  ]
}

// After:
{
  "session_id": "...",
  "session_title": "...",
  "sub_sessions": [
    { "title": "...", "slug": "...", "pipeline_status": "ready", "training_script": "...", "content_outline": { ... }, "template_type": "..." }
  ]
}
```

**Frontend callers:**
- `app/dashboard/walkthrough/WalkthroughClient.tsx` — polls this endpoint to check content pipeline status. Must change `.subtopics` field access to `.sub_sessions`.

**Must change in lockstep:** `WalkthroughClient.tsx` and the route handler.

---

### Endpoint 5: `GET /api/kb/topics/[topicId]`

**File:** `app/api/kb/topics/[topicId]/route.ts`

**Response shape change** (lines 25, 41, 163, 168, 174):

The response includes a `sessions` array where each session has a `subtopic_count` field (this is a count, not the array — the name `subtopic_count` should become `sub_session_count`) and a top-level `total_subtopics` should become `total_sub_sessions`.

```jsonc
// Before:
{
  "arc_title": "...",
  "sessions": [
    {
      "session_title": "...",
      "session_index": 1,
      "subtopic_count": 4,
      "status": "completed"
    }
  ],
  "sections": [ ... ],
  "total_subtopics": 16
}

// After:
{
  "arc_title": "...",
  "sessions": [
    {
      "session_title": "...",
      "session_index": 1,
      "sub_session_count": 4,
      "status": "completed"
    }
  ],
  "sections": [ ... ],
  "total_sub_sessions": 16
}
```

The internal function `buildSubtopicSlugIndex` (line 47) is also renamed as part of Phase 1 to `buildSubSessionSlugIndex`.

**Frontend callers:**
- `components/kb/KBSessionPreview.tsx` — reads `subtopic_count` from session objects. Must change to `sub_session_count`.
- Any component reading `total_subtopics` from this response.

**Must change in lockstep:** `KBSessionPreview.tsx` and the route handler, in the same deployment.

---

### Endpoint 6: `POST /api/recall/bot`

**File:** `app/api/recall/bot/route.ts`

**Change scope:** This endpoint does not return `subtopics` in its JSON response to callers. The `subtopics` references on lines 87–88 are internal logging statements only. They will be updated as part of Phase 1 (TypeScript rename) to read from `plan.sub_sessions`. No API contract change is needed here.

**Frontend callers:** None for the `subtopics` field.

**Action:** Confirm by reading the full response shape returned from this route. If `subtopics` does not appear in the response body, no Phase 3 change is needed.

---

### Endpoint 7: `GET /api/kb/topics`

**File:** `app/api/kb/topics/route.ts`

**Response shape change** (lines 66, 80, 86–88):

```jsonc
// Before:
[
  {
    "topic_id": "llm-basics",
    "arc_title": "LLM Basics",
    "sessions": [ ... ],
    "subtopics": [
      { "slug": "context-windows", "title": "Context Windows & Tokens", "type": "concept" }
    ]
  }
]

// After:
[
  {
    "topic_id": "llm-basics",
    "arc_title": "LLM Basics",
    "sessions": [ ... ],
    "sub_sessions": [
      { "slug": "context-windows", "title": "Context Windows & Tokens", "type": "concept" }
    ]
  }
]
```

**Frontend callers:**
- `app/dashboard/knowledge-base/KBIndexClient.tsx` (lines 16, 232, 238, 239) — defines `subtopics: Array<...>` on its local type and maps over `topic.subtopics`. Must rename the local type field and all accessor calls to `sub_sessions`.

**Must change in lockstep:** `KBIndexClient.tsx` and the route handler.

---

## 5. Regression Strategy

### 5.1 Pre-Migration Baseline

Before starting Phase 2, capture the current API responses for all affected endpoints. These become the comparison baseline for post-phase verification.

**Admin auth setup** (required for all curl commands below):
```bash
# Get an admin session token
curl -s -X POST https://distill-peach.vercel.app/api/auth/session \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: <ADMIN_SECRET>" \
  -d '{"userId": "user_3FTbCaBIwb3PLgEWVUxoCRcqfp4"}' \
  | jq '.token'
# Save the token as $TOKEN
```

**Baseline capture commands:**

```bash
export TOKEN="<token from above>"
export BASE="https://distill-peach.vercel.app"
export USER_ID="user_3FTbCaBIwb3PLgEWVUxoCRcqfp4"

# 1. KB topics index
curl -s "$BASE/api/kb/topics" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.[0] | {topic_id, subtopics_count: (.subtopics | length)}' \
  > /tmp/baseline_kb_topics.json

# 2. KB topic detail (use a real topicId from the KB index response)
export TOPIC_ID="<topic_id from step 1>"
curl -s "$BASE/api/kb/topics/$TOPIC_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{total_subtopics, sessions: [.sessions[] | {session_title, subtopic_count}]}' \
  > /tmp/baseline_kb_topic_detail.json

# 3. Generate-content for a known session (use a real sessionId)
export SESSION_ID="<a session id for this user>"
curl -s "$BASE/api/sessions/$SESSION_ID/generate-content" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{session_title, subtopics_count: (.subtopics | length), subtopics_statuses: [.subtopics[] | .pipeline_status]}' \
  > /tmp/baseline_generate_content.json

# 4. Generate-plan for the same session
curl -s "$BASE/api/sessions/$SESSION_ID/generate-plan" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{plan_status, subtopics_count: (.subtopics | length)}' \
  > /tmp/baseline_generate_plan.json

echo "Baseline captured. Files in /tmp/baseline_*.json"
```

Save all four baseline files. After each phase, re-run the same calls (substituting `subtopics` with `sub_sessions` after Phase 3) and diff against the baseline to confirm data integrity.

---

### 5.2 Per-Phase Verification Gates

#### Phase 1 Verification

| Check | How to verify |
|---|---|
| TypeScript compiles | `npx tsc --noEmit` — zero errors |
| Build passes | `npm run build` — zero errors |
| No TYPE A `Subtopic` type names remain | `grep -rn "SessionPlanSubtopic\|AgendaEmailSubtopic" app/ inngest/ lib/session-plan.ts` — zero results |
| Application runtime unaffected | Deploy to Vercel preview, load a live session, navigate all tabs — no console errors |
| DB column unchanged | Query `\d sessions` in Supabase SQL editor — column still named `subtopics` |

#### Phase 2 Verification (after Step 2.3, before Step 2.5)

**Automated checks:**
```bash
npx tsc --noEmit   # Zero errors
npm run build      # Zero errors
```

**DB data integrity check:**
```sql
-- Run in Supabase SQL editor
SELECT
  COUNT(*) FILTER (WHERE subtopics != sub_sessions) AS mismatch_count,
  COUNT(*) FILTER (WHERE subtopics IS NOT NULL AND sub_sessions IS NULL) AS missing_sub_sessions,
  COUNT(*) FILTER (WHERE sub_sessions IS NOT NULL AND subtopics IS NULL) AS missing_subtopics
FROM sessions;
-- All three counts must be 0
```

**API verification (responses should still return `subtopics` field at this phase — the column is renamed but the API field name has not changed yet):**
```bash
curl -s "$BASE/api/sessions/$SESSION_ID/generate-content" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.subtopics | length'
# Must return same count as baseline
```

**UI flow to verify manually:**
1. Sign in as test user
2. Navigate to dashboard → Plan
3. Approve a pending plan (or use an already-approved plan)
4. Navigate to Knowledge Base — confirm sessions appear with correct sub-session counts
5. Open a live session (walkthrough) — confirm all tabs load
6. Confirm Clio voice responds to questions

**Inngest job verification:**
- Trigger `distill/session.content.requested` event for a session
- Check Inngest dashboard — job must complete without `sub_sessions is null` errors
- Check Supabase — `sessions.sub_sessions` must be populated for that session

#### Phase 3 Verification

**Automated checks:**
```bash
npx tsc --noEmit
npm run build
```

**API contract verification (field name has now changed):**
```bash
# KB topics — must have sub_sessions, not subtopics
curl -s "$BASE/api/kb/topics" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.[0] | has("sub_sessions")'
# Must return: true

curl -s "$BASE/api/kb/topics" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.[0] | has("subtopics")'
# Must return: false

# Generate-content — field renamed
curl -s "$BASE/api/sessions/$SESSION_ID/generate-content" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{has_sub_sessions: has("sub_sessions"), has_subtopics: has("subtopics")}'
# Must return: {"has_sub_sessions": true, "has_subtopics": false}

# KB topic detail — totals renamed
curl -s "$BASE/api/kb/topics/$TOPIC_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{total_sub_sessions, has_old: has("total_subtopics")}'
# Must return: {"total_sub_sessions": <number>, "has_old": false}
```

**UI flow to verify manually:**
1. Knowledge Base index page loads — sub-session pills render correctly under each topic card
2. KB topic detail page shows correct `sub_session_count` per session row
3. Walkthrough page loads tabs (sub-sessions) correctly — no blank tab list
4. Schedule setup flow works end-to-end — sessions get scheduled with correct sub-session data

---

### 5.3 Rollback Procedure

#### Phase 2 Rollback (before Step 2.5 — column drop not yet applied)

If something goes wrong after migration 033 is applied but before migration 034:

```sql
-- In Supabase SQL editor:
ALTER TABLE sessions DROP COLUMN IF EXISTS sub_sessions;
-- The subtopics column was never touched, so all data is intact.
```

Then revert all TypeScript changes from Steps 2.2 and 2.3 (git revert the commit).

If migration 034 has already been applied (column drop):
```sql
ALTER TABLE sessions ADD COLUMN subtopics jsonb DEFAULT '[]';
UPDATE sessions SET subtopics = sub_sessions WHERE sub_sessions IS NOT NULL;
COMMENT ON COLUMN sessions.subtopics IS 'Restored from sub_sessions — TERM-01 rollback.';
```

#### Phase 3 Rollback

Phase 3 is a code-only change (no DB involved). Rollback is a git revert of the Phase 3 commit.

After reverting, verify:
```bash
curl -s "$BASE/api/kb/topics" -H "Authorization: Bearer $TOKEN" | jq '.[0] | has("subtopics")'
# Must return: true (old field name is back)
```

#### How to Verify Rollback Succeeded

For Phase 2 rollback:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'subtopics';
-- Must return one row
```
And re-run the baseline API calls from Section 5.1 — responses must match the captured baseline exactly.

For Phase 3 rollback:
Re-run all four baseline curl commands from Section 5.1 — all must return the original field names and the same data counts.

---

### 5.4 Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration 033 applies but some rows get NULL `sub_sessions` because the UPDATE statement missed rows where `subtopics = '[]'::jsonb` | Low | High — content generation breaks for those sessions | Use `WHERE subtopics IS NOT NULL` not `WHERE subtopics != '[]'`. Run the mismatch SQL check in 5.2 before Step 2.5. |
| A developer applies migration 034 (column drop) before the 48h stability window | Medium | High — data loss is irreversible without a Supabase point-in-time restore | 034 is a separate file from 033. Add a gate comment to 033 making the dependency explicit. Never include both in the same `db push` batch. |
| An Inngest job running mid-migration reads the old column while a new deployment writes only to `sub_sessions` | Medium | Medium — individual sessions may fail content generation | During Phase 2, keep all Inngest jobs in dual-write mode before switching reads. Confirm no Inngest jobs are in-flight before applying migration 033 (check Inngest dashboard). |
| Phase 3 frontend/API update is deployed in two separate deploys (e.g. API first, frontend second) causing a field-not-found error in the UI | High | Medium — UI shows empty tab list for affected sessions during the gap | Deploy Phase 3 as a single Vercel deploy that includes both API route and frontend component changes. Test on a preview deployment before promoting to production. |
| `lib/curriculum/types.ts` or `lib/content/curriculum.ts` (TYPE B files) are accidentally modified | Low | High — breaks curriculum plan generation for all users | Add a header comment to each TYPE B file: `// TYPE B subtopics — curriculum planning items. Do NOT rename (see TERM-01).` |
| The `session_plan` JSONB value's internal `subtopics` key (inside `sessions.session_plan`) is overlooked and not renamed in Phase 3 | Medium | Medium — `session-content-async.ts` line 324 writes `session_plan.subtopics`; if the KB reader expects `sub_sessions` it will miss the data | Explicitly track `session_plan.subtopics` as a Phase 3 item. Add it to the files reference in Section 8. |

---

## 6. Dependency Map

Files that cannot be changed independently — they must be deployed together.

### Phase 2 Dependency Tree

```
Migration 033 applied to DB
    └── ALL of these code changes must be in the SAME Vercel deploy:
        ├── app/api/sessions/schedule/route.ts        (dual-write)
        ├── app/api/plan/approve/route.ts             (dual-write + read from sub_sessions)
        ├── app/api/sessions/[id]/generate-plan/route.ts  (dual-write + read from sub_sessions)
        ├── app/api/sessions/[id]/generate-content/route.ts (read from sub_sessions)
        ├── inngest/session-plan-generator.ts         (dual-write)
        ├── inngest/session-content-async.ts          (read from sub_sessions)
        └── inngest/session-content-pipeline.ts       (read from sub_sessions)

Migration 034 applied to DB  ← MUST NOT be in the same deploy as 033
    └── ALL of these code changes must be in the SAME Vercel deploy:
        ├── app/api/sessions/schedule/route.ts        (remove subtopics write)
        ├── app/api/plan/approve/route.ts             (remove subtopics write)
        ├── app/api/sessions/[id]/generate-plan/route.ts  (remove subtopics write)
        └── inngest/session-plan-generator.ts         (remove subtopics write)
```

### Phase 3 Dependency Tree

```
Phase 3 API + Frontend — ALL must be in the SAME Vercel deploy:
│
├── Endpoint: GET /api/kb/topics  (route.ts)
│   └── MUST ship with: app/dashboard/knowledge-base/KBIndexClient.tsx
│
├── Endpoint: GET /api/kb/topics/[topicId]  (route.ts)
│   └── MUST ship with: components/kb/KBSessionPreview.tsx
│
├── Endpoint: GET /api/sessions/[id]/generate-plan  (route.ts)
│   └── MUST ship with:
│       ├── app/dashboard/walkthrough/WalkthroughClient.tsx
│       └── app/api/recall/bot/route.ts  (reads plan.sub_sessions)
│
├── Endpoint: GET /api/sessions/[id]/generate-content  (route.ts)
│   └── MUST ship with: app/dashboard/walkthrough/WalkthroughClient.tsx
│
└── Endpoint: POST /api/sessions/schedule  (route.ts)
    └── MUST ship with: app/dashboard/schedule-setup/ScheduleSetupClient.tsx
```

The key constraint: **never deploy an API route change without deploying its frontend consumer changes in the same Vercel deployment.** On Vercel, a single `git push` deploys all files atomically — use this. Do not split Phase 3 across multiple PRs or commits that deploy separately.

---

## 7. Go/No-Go Checklist

### Before Starting Phase 2

- [ ] Phase 1 TypeScript rename is deployed to production and stable for at least 24 hours — no errors in Vercel logs related to renamed identifiers
- [ ] Baseline API responses are captured and saved (see Section 5.1) — files exist at `/tmp/baseline_*.json` or equivalent
- [ ] Migration 033 SQL has been reviewed by a second person — the UPDATE statement, the COMMENT, and the absence of a DROP command have all been confirmed
- [ ] Migration 034 SQL is prepared but NOT yet in the migration queue
- [ ] The mismatch SQL query (Section 5.2) is ready to run immediately after migration 033 applies
- [ ] Rollback SQL for Phase 2 (Section 5.3) is written down and accessible without needing to read this document
- [ ] No Inngest jobs are currently in-flight for the affected sessions — checked in Inngest dashboard
- [ ] All TypeScript changes for Steps 2.2 and 2.3 are committed to a branch and have passed `npx tsc --noEmit` and `npm run build` locally

### Before Starting Phase 3

- [ ] Phase 2 (including migration 034 drop) has been stable in production for at least 48 hours — zero errors in Vercel runtime logs related to `sub_sessions`
- [ ] A Vercel preview deploy of all Phase 3 changes (API routes + frontend components together) has been tested end-to-end:
  - [ ] KB index page renders session sub-sessions correctly
  - [ ] KB topic detail page shows correct counts
  - [ ] Walkthrough (live session) loads all tabs
  - [ ] Schedule setup flow completes without errors
- [ ] All five API contract verification curl commands (Section 5.2, Phase 3) have been run against the preview and returned the expected results
- [ ] TYPE B files (`lib/curriculum/`, `lib/content/curriculum.ts`) have been confirmed unmodified — `git diff` shows zero changes to those files
- [ ] The Phase 3 PR contains both API route changes and frontend changes — it has been confirmed that no API route file is in a separate PR from its frontend consumer

---

## 8. Files Reference — Complete List

### Phase 1 Files (TypeScript internal rename — already in progress)

| File | Change |
|---|---|
| `lib/session-plan.ts` | Rename `SessionPlanSubtopic` interface → `SessionPlanSubSession`; rename all local variables `subtopics` → `subSessions` in TYPE A contexts; rename functions `generateFirstSubtopicVisual` → `generateFirstSubSessionVisual`, `generateRemainingSubtopicVisuals` → `generateRemainingSubSessionVisuals` |
| `lib/curriculum/session-designer.ts` | Rename `SubtopicSchema` → `SubSessionSchema`; rename exported type `Subtopic` → `SubSession`; rename local variable `subtopics` → `subSessions` in the TYPE A context (lines 101–142) — note: LLM prompt strings containing the word "subtopics" as instructional text for the LLM can stay or be updated for clarity |
| `inngest/session-agenda-email.ts` | Rename `AgendaEmailSubtopic` → `AgendaEmailSubSession`; rename local variable `subtopics` → `subSessions` |
| `inngest/session-plan-generator.ts` | Rename `subtopics` event data field → `subSessions` in the event handler signature; rename local variable `subtopicsAfterFirst` → `subSessionsAfterFirst`; rename `allSubtopics` → `allSubSessions` |
| `inngest/session-content-async.ts` | Rename local variable `rawSubtopics` → `rawSubSessions`; rename `planSubtopics` → `planSubSessions`; rename `totalSubtopics` → `totalSubSessions`; rename `updatedSubtopics` → `updatedSubSessions` |
| `inngest/session-content-pipeline.ts` | Rename function `getSubtopicsForSession` → `getSubSessionsForSession`; rename local variables `subtopicsFromDb` → `subSessionsFromDb`, `planSubtopics` → `planSubSessions`, `jsonbSubtopics` → `jsonbSubSessions` |
| `app/api/sessions/[id]/generate-plan/route.ts` | Rename local variables `designedSubtopics` → `designedSubSessions`, `subtopicsAfterFirst` → `subSessionsAfterFirst`, `allSubtopics` → `allSubSessions`; rename request body field `subtopicId` → `subSessionId` (PATCH handler, line 339) |
| `app/api/sessions/[id]/generate-content/route.ts` | Rename local variables `planSubtopics` → `planSubSessions`, `rawSubtopicsGet` → `rawSubSessionsGet`, `subtopicMap` → `subSessionMap` |
| `app/api/plan/approve/route.ts` | Rename local variable references; NOTE: lines 100/120 read from TYPE B curriculum data — do not rename those |

### Phase 2 Files (DB column rename)

| File | Change |
|---|---|
| `supabase/migrations/033_rename_subtopics_to_sub_sessions.sql` | CREATE — adds `sub_sessions` column, copies data |
| `supabase/migrations/034_drop_subtopics_column.sql` | CREATE — drops `subtopics` column (apply after 48h stability) |
| `app/api/sessions/schedule/route.ts` | Zod schema: `subtopics` → `sub_sessions`; Supabase write: dual-write then drop `subtopics` side |
| `app/api/plan/approve/route.ts` | `.select('... subtopics')` → `.select('... sub_sessions')`; Supabase writes: dual-write then drop |
| `app/api/sessions/[id]/generate-plan/route.ts` | `.select('... subtopics')` → `.select('... sub_sessions')`; all Supabase `.update({ subtopics: ... })` → `.update({ sub_sessions: ... })` (dual-write then drop) |
| `inngest/session-plan-generator.ts` | Supabase update calls: dual-write `sub_sessions` alongside `subtopics`, then drop `subtopics` side |
| `inngest/session-content-async.ts` | `.select('... subtopics')` → `.select('... sub_sessions')`; read from `sub_sessions` |
| `inngest/session-content-pipeline.ts` | `.select('... subtopics')` → `.select('... sub_sessions')`; read from `session.sub_sessions` |

### Phase 3 Files (API response field rename)

| File | Change |
|---|---|
| `app/api/kb/topics/route.ts` | Response: rename field `subtopics` → `sub_sessions` in the JSON object built at lines 80/86 |
| `app/api/kb/topics/[topicId]/route.ts` | Response: rename `subtopic_count` → `sub_session_count` (line 163); rename `total_subtopics` → `total_sub_sessions` (line 174); internal: rename `buildSubtopicSlugIndex` → `buildSubSessionSlugIndex` |
| `app/api/sessions/[id]/generate-plan/route.ts` | Response: rename `subtopics` key → `sub_sessions` in all returned plan objects (lines 283, 301, 318, 360) |
| `app/api/sessions/[id]/generate-content/route.ts` | Response: rename `subtopics` → `sub_sessions` in the response object (line 112) |
| `app/api/sessions/schedule/route.ts` | Request body Zod field (already done in Phase 2): confirm `sub_sessions` is the field name |
| `app/api/recall/bot/route.ts` | Internal: rename `plan.subtopics` → `plan.sub_sessions` in log statements (lines 87–88) — no API contract change |
| `inngest/session-content-async.ts` | Internal: `session_plan.subtopics` key in the update at line 324 — rename to `session_plan.sub_sessions` — this changes the JSONB key inside `session_plan` column |
| `app/dashboard/knowledge-base/KBIndexClient.tsx` | Type definition line 16: `subtopics:` → `sub_sessions:`; all accessor calls `.subtopics` → `.sub_sessions` (lines 232, 238, 239) |
| `app/dashboard/walkthrough/WalkthroughClient.tsx` | All reads of `.subtopics` from generate-plan and generate-content API responses → `.sub_sessions` |
| `components/kb/KBSessionPreview.tsx` | Reads `subtopic_count` from session data → `sub_session_count` |
| `app/dashboard/plan/PlanClient.tsx` | Line 180: `l.subtopics?.[0]` — **CONFIRMED TYPE B** (reads from `buildCurriculum()` fallback plan, curriculum lesson items). Do NOT rename. |
| `components/plan/LearningPathView.tsx` | Line 142: `selectedTopic.subtopics.map(...)` — **CONFIRMED TYPE B** (plan view "What you'll learn" list, curriculum sub-topics). Do NOT rename. |

---

*TERM-01 Migration Plan | Project: Clio | Author: Business Analyst Agent | Version: 1.0*
