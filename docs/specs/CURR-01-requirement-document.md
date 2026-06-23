# Curriculum Redesign — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-23

---

## 1. Purpose

The current curriculum engine produces plans that are structurally correct (right number of sessions, right arc types) but narratively incoherent. A VP of Technology receives 8 sessions that read like a topic list, not a story. There is no arc-level throughline, no chapter-level framing, and no scene-level narrative tension. Sessions feel disconnected from one another even when they cover the same domain.

Four compounding problems make this worse. First, the engine treats "VP of Technology" and "VP of Product" as the same role — both map to `vp-dir` — which means a VP of Technology building a procurement brief for cloud-based AI infrastructure receives the same session framing as a VP of Product defining an AI-assisted feature roadmap. These are different jobs with different vocabularies, different stakeholders, and different decisions to make. Second, the `ai_maturity` values collected in onboarding (`observer`, `emerging`, `practitioner`, `leader`) do not match the values the curriculum engine's system prompt uses internally (`beginner`, `intermediate`, `advanced`, `expert`). The normalisation bridge in `planner.ts` handles this correctly at runtime, but the onboarding saves raw UI values into the DB and different parts of the codebase use different vocabularies, creating silent confusion when reading the `users` table directly. Third, there is no automated check after plan generation to confirm that the visible sessions collectively cover all 7 learning dimensions that make a curriculum executive-grade (strategic, operational, technical, compliance, competitive, team management, personal productivity). A plan could ship with 8 sessions that all cluster in one or two dimensions, leaving the user with a curriculum that is deep in one area and blind in six others. Fourth, the post-session quality evaluation that exists in `session-quality-evaluator.ts` classifies comprehension responses (V1–V7) and evaluates 6 session quality criteria, but the results are stored and never fed back into plan adaptation or surfaced in any meaningful way to influence future session design.

Without this redesign, every curriculum plan is a list dressed as a journey. Users who complete 5 sessions have no sense of where they are in a story. VP of Technology users are given the same framing as VP of Product users. Plans may accidentally cover only 2 of 7 required learning dimensions. And the quality signals that exist are silently discarded.

---

## 2. User Story

**Story 1 — Executive encountering the plan for the first time:**
As a VP of Technology who has just approved a learning plan,
I want the plan page to communicate a coherent arc narrative — what story this curriculum tells across 8 sessions — not just a list of session titles,
So that I can immediately understand where this journey is taking me and why the sessions are in this order.

**Story 2 — VP of Technology vs VP of Product receiving different framing:**
As a VP of Technology evaluating AI vendor procurement options,
I want every session in my curriculum to frame examples around infrastructure decisions, security architecture, team adoption, and API integration — not product roadmaps or feature prioritisation,
So that the content is immediately applicable to the decisions I am actually making.

**Story 3 — User whose plan has a dimension gap:**
As a VP of Technology mid-way through a curriculum plan,
I want the platform to have automatically checked that my plan covers compliance and competitive landscape content — not just technical and strategic content — before I started,
So that I do not complete 8 sessions and still lack the vocabulary to address a board-level risk question.

---

## 3. Trigger / Entry Point

CURR-01 touches three distinct trigger points. None are user-visible entry points — all are backend changes to the curriculum generation pipeline and data model.

**Trigger 1 — Curriculum plan generation**
- Event: `clio/topics.selected` fires `curriculum-generator` Inngest function in `inngest/curriculum-generator.ts`
- The generation calls `generateCurriculumPlan()` in `lib/curriculum/planner.ts`, which calls `enrichCurriculumPlan()` in `lib/curriculum/enrichment.ts`
- CURR-01 adds a third call inside this pipeline: the 7-dimension coverage check, which runs after enrichment and before the plan is saved to `curriculum_plans`
- If the coverage check finds gaps, it triggers a gap-fill prompt that adds sessions to the plan before saving

**Trigger 2 — Post-session quality evaluation**
- Cron: every 15 minutes, `session-quality-evaluator` Inngest function in `inngest/session-quality-evaluator.ts` finds sessions completed 2–2.25 hours ago
- CURR-01 adds storage of the structured quality result (the 7-dimension classification) to the `session_quality_results` table after evaluation completes
- The quality evaluator already classifies V1–V7 responses and evaluates 6 criteria. CURR-01 does not change what is evaluated — it adds structured storage of the result. No adaptive reordering is built in this spec (that is SCR-01).

**Trigger 3 — Onboarding data save**
- Route: `POST /api/onboarding`
- CURR-01 changes the Zod enum for `roleLevel` to accept two new values: `vp-technology` and `vp-product`, in addition to the existing four values
- The onboarding UI already collects these as `roleId` values (`vp-technology`, `vp-product`) — they are currently discarded because the `roleLevel` Zod enum only accepts `c-suite | vp-dir | manager | specialist`
- After this change, `vp-technology` and `vp-product` are saved to `users.role_level` and used by the curriculum engine

**User state required:** All triggers require the user to be authenticated (Clerk). The quality evaluator additionally requires the session to have `status = 'completed'` and `quality_evaluated = false`.

---

## 4. Screen / Flow Description

This section describes four distinct flows: (A) the narrative curriculum generation pipeline, (B) the VP role separation, (C) the `ai_maturity` value alignment, and (D) the post-session quality result storage.

### 4A. Narrative Curriculum Generation Pipeline

The existing plan generation pipeline in `inngest/curriculum-generator.ts` calls `generateCurriculumPlan()` then `enrichCurriculumPlan()` then saves the plan. CURR-01 adds a fourth step between enrichment and save.

**Current pipeline (abridged):**
1. `generateCurriculumPlan()` — LLM generates arc/session/subtopic structure
2. `enrichCurriculumPlan()` — 2 Claude calls: arc classification (L1/L2/L3 + so_what) + quality scoring
3. Save to `curriculum_plans` (visible_sessions + queue_sessions)

**New pipeline after CURR-01:**

**Step 1 — Generate plan** (unchanged)
`generateCurriculumPlan()` runs as today. Output: `CurriculumOutput` with arcs, sessions, subtopics.

**Step 2 — Narrative enrichment** (enhanced)
`enrichCurriculumPlan()` runs as today but the system prompt for Call 1 (arc classification) is extended to also produce three new narrative fields per session:

- `scene_narrative`: one sentence (max 25 words) describing what this session reveals to the learner — written as a chapter teaser, not a topic summary. Example: "You discover why Constitutional AI matters more than any policy document your compliance team will write."
- `arc_throughline`: the same string shared by all sessions in the same arc — a 1–2 sentence arc-level narrative that answers "what story does this arc tell?" Written once per arc, replicated to each session for storage convenience.
- `session_chapter_position`: a string label for this session's role in the arc narrative: `opening` | `building` | `pivot` | `climax` | `resolution`. Assigned by the LLM based on the session's arc_position and content.

These three fields are added to the `EnrichedSession` type and stored in `raw_llm_output.enriched_plan`.

**Step 3 — 7-Dimension Coverage Check** (new)
After enrichment, a local (no Claude call) function `checkDimensionCoverage(enrichedPlan, userProfile)` runs against all visible sessions.

The 7 required dimensions and how they are detected:

| Dimension | ID | Detection: keywords in session title + subtopics + so_what (case-insensitive) |
|---|---|---|
| Strategic | `strategic` | strategy, vision, roadmap, board, competitive, market position, investment, priority |
| Operational | `operational` | workflow, process, implement, deploy, rollout, team adoption, day-to-day, operationalise |
| Technical | `technical` | model, API, architecture, infrastructure, integration, security, token, data pipeline |
| Compliance | `compliance` | compliance, regulatory, governance, risk, audit, legal, policy, GDPR, SOC2, HIPAA |
| Competitive | `competitive` | competitor, landscape, benchmark, vendor, alternative, OpenAI, Google, Microsoft, market |
| Team Management | `team_management` | team, hire, upskill, enablement, culture, change management, train, staff, adoption |
| Personal Productivity | `personal_productivity` | personal, my workflow, time, productivity, own use, daily, habit, prompt, assistant |

A dimension is counted as **covered** if at least one visible session contains at least 2 keyword matches for that dimension across its title, subtopics array (joined), and `so_what` string (joined).

A dimension is counted as **missing** if it has fewer than 2 keyword matches across all visible sessions.

**Coverage threshold:** At least 5 of the 7 dimensions must be covered for the plan to pass without gap-fill. (The remaining 2 are allowed to be absent — not every user profile requires all 7. For example, a technical specialist does not need Personal Productivity framing.)

**If fewer than 5 dimensions are covered:**
A gap-fill Claude call runs (separate from the 2 enrichment calls). The prompt receives:
- The current list of visible session titles and their subtopics
- The list of missing dimension IDs
- The user's role, roleLevel, industry, and maturity

The gap-fill prompt instructs Claude to return a JSON array of new sessions — one session per missing dimension that cannot be covered by modifying an existing session's subtopics — to be inserted into the visible sessions list. Each new session has the same schema as an existing session (title, focus, subtopics, arc_position, etc.) and is appended at the end of the most relevant arc, displacing the lowest-quality queued session.

Gap-fill sessions are flagged in their `queue_rationale` field with the string `"gap-fill: [dimension_id]"` even though `is_visible = true`, so downstream monitoring can identify them.

**Coverage result stored:** A `dimension_coverage_result` JSONB object is stored in `curriculum_plans.raw_llm_output` with the shape described in Section 6.

**Step 4 — Save plan** (unchanged, same DB write as today)
`curriculum_plans` row is inserted with the enriched + gap-filled visible sessions.

### 4B. VP Role Separation

The onboarding UI already presents two sub-options under `vp-dir`:

- "Technology & Engineering" → `roleId: 'vp-technology'`
- "Product" → `roleId: 'vp-product'`

Currently, the `POST /api/onboarding` Zod schema rejects these values because `roleLevel` only accepts `c-suite | vp-dir | manager | specialist`. The UI sends `roleLevel: 'vp-dir'` and `role: 'vp-technology'` (the roleId flows into the `role` field). This means the `users.role_level` column always stores `vp-dir` for both VP of Technology and VP of Product, and the curriculum engine never distinguishes between them.

**After this change:**

1. The `OnboardingSchema` `roleLevel` enum is extended to include `vp-technology` and `vp-product`
2. The onboarding UI sends `roleLevel: 'vp-technology'` (not `vp-dir`) when the user selects "Technology & Engineering" under the VP/Director level
3. The onboarding UI sends `roleLevel: 'vp-product'` (not `vp-dir`) when the user selects "Product" under the VP/Director level
4. `users.role_level` stores `vp-technology` or `vp-product` for these users
5. `lib/curriculum/planner.ts` — `roleLevelLabel` and `roleLevelInstruction` maps are extended with entries for `vp-technology` and `vp-product` (see Section 5 for the exact text)
6. The fallback case (unknown roleLevel) in the planner maps `vp-technology` and `vp-product` to the `vp-dir` instruction if somehow they arrive without a specific entry — never silently drops them
7. `inngest/session-quality-evaluator.ts` — the `SENIORITY_MARKERS` map is extended with entries for `vp-technology` and `vp-product`

The `vp-dir` roleLevel value is **retained** and continues to work for users who did not select a sub-role (e.g., users who onboarded before this change, or who selected a VP/Director role not listed under the technology/product sub-options).

**VP of Technology instruction (added to `roleLevelInstruction` in `planner.ts`):**
"Frame all content for a VP of Technology who owns engineering team adoption, infrastructure decisions, and technical risk. Examples must involve: API procurement vs SaaS tradeoffs, security architecture for AI systems, how to evaluate model quality for production use cases, and how to present build-vs-buy recommendations upward to the CTO or CFO. Do NOT use board-level P&L framing. Do NOT use product roadmap or feature prioritisation framing."

**VP of Product instruction (added to `roleLevelInstruction` in `planner.ts`):**
"Frame all content for a VP of Product who owns AI-assisted feature strategy, model integration in the product, and competitive differentiation through AI capability. Examples must involve: when to use AI in the product vs when it is over-engineering, how to frame AI features for users without technical backgrounds, managing model latency and cost as product constraints, and presenting AI roadmap trade-offs to engineering and leadership. Do NOT use infrastructure or procurement framing. Do NOT use board-level P&L framing."

**VP of Technology label (added to `roleLevelLabel` in `planner.ts`):**
"VP of Technology (owns engineering team adoption, technical infrastructure decisions, and AI vendor evaluation)"

**VP of Product label (added to `roleLevelLabel` in `planner.ts`):**
"VP of Product (owns AI feature strategy, model integration in product, and competitive differentiation through AI)"

**Seniority markers for quality evaluator (added to `SENIORITY_MARKERS` in `session-quality-evaluator.ts`):**
- `vp-technology`: `['infrastructure', 'engineer', 'architecture', 'api', 'security', 'build', 'deploy', 'integrate']`
- `vp-product`: `['product', 'feature', 'roadmap', 'user', 'launch', 'priorit', 'ship', 'competitive']`

### 4C. `ai_maturity` Value Alignment

**Current state:**
The onboarding UI collects one of four values: `observer | emerging | practitioner | leader`. These are saved raw to `users.ai_maturity`. The `normaliseMaturity()` function in `lib/curriculum/planner.ts` maps these to canonical values at runtime. The mapping is correct and already covers these values. The onboarding API Zod schema also accepts legacy values (`beginner`, `intermediate`, `advanced`, `expert`, free-text variants) for backward compatibility.

**The alignment problem:**
There are three distinct vocabularies in use simultaneously:
1. **UI vocabulary** (what onboarding collects): `observer | emerging | practitioner | leader`
2. **Canonical vocabulary** (what the curriculum engine reasons with): `beginner | intermediate | advanced | expert`
3. **DB-stored values** (what is actually in `users.ai_maturity`): a mix of all of the above, depending on when the user onboarded

No single vocabulary is wrong — `normaliseMaturity()` handles the translation correctly. The problem is that reading `users.ai_maturity = 'practitioner'` directly (e.g. in an admin dashboard, a monitoring query, or a future feature) requires knowing the normalisation table to understand what it means. There is no canonical DB-level value.

**The fix:**
Normalise `ai_maturity` at the point of save — the onboarding API writes the canonical value to the DB, not the raw UI value. The `normaliseMaturity()` function already exists and is correct. Apply it before the upsert.

In `app/api/onboarding/route.ts`, before the `userRecord` upsert:

```typescript
// Normalise to canonical DB value before saving
const canonicalMaturity = normaliseMaturity(data.aiMaturity)
// Then use canonicalMaturity instead of data.aiMaturity in the upsert
```

After this change:
- `users.ai_maturity` always contains one of: `beginner | intermediate | advanced | expert`
- The onboarding Zod schema continues to accept `observer | emerging | practitioner | leader | beginner | intermediate | advanced | expert` (and legacy values) — the normalisation happens server-side after validation
- `normaliseMaturity()` remains in `planner.ts` as a guard for any values that arrive through routes other than `/api/onboarding` (e.g., direct DB edits, legacy migration rows)
- A backfill migration normalises all existing `users.ai_maturity` values to the canonical vocabulary (migration 040 — see Section 6)

### 4D. Post-Session Quality Result Storage

The `session-quality-evaluator.ts` Inngest function already:
- Classifies V1–V7 checkpoint responses (keyword scoring)
- Evaluates 6 session quality criteria (topic coverage, seniority framing, industry example, depth vs maturity, actionable close, subtopic transitions)
- Updates `knowledge_profiles` with `avg_variant_score`, `comprehension_status`, and `gaps`
- Updates `quality_evaluated` and `quality_criteria_results` on the `sessions` table

**What is missing:** The 7-dimension quality classification described in 4A is not stored against the session. After CURR-01, the `session-quality-evaluator` also:

1. Runs `checkSessionDimensions(clioText, sessionTitle, roleLevel, industry)` — a local keyword function (same 7-dimension keyword map from Section 4A) applied to the Clio transcript text of this specific session
2. Writes the resulting `SessionDimensionResult` JSONB to a new column `quality_dimension_result` on the `sessions` table (migration 041 — see Section 6)

This is the extent of quality result storage in CURR-01. The stored data is the raw material for SCR-01 (adaptive reordering), which is out of scope for this spec.

---

## 5. Visual Examples

### 5A. Narrative Fields on Plan Screen (Developer Reference — not a user-facing change to the plan UI)

The plan screen currently shows session cards with `title` and `focus`. The narrative fields added by CURR-01 are stored in the DB but the plan UI does not change in this spec. A future spec will add arc narrative display to the plan page. Developer reference only:

```
curriculum_plans.raw_llm_output.enriched_plan.arcs[0]:
─────────────────────────────────────────────────────
arc_name: "Claude in Financial Services"
arc_throughline: "In this arc, you go from understanding what
  makes Claude architecturally different to being able to frame
  a procurement recommendation to your CFO without needing the
  CTO to interpret it for you."

  sessions[0]:
    title: "Claude's Safety Architecture"
    scene_narrative: "You discover why Constitutional AI matters
      more than any policy document your compliance team will
      write."
    session_chapter_position: "opening"

  sessions[1]:
    title: "200K Context Window — What It Means for FinServ"
    scene_narrative: "You realise the contract-review use case
      your team dismissed as 'too complex for AI' is now the
      easiest one to start with."
    session_chapter_position: "building"

  sessions[2]:
    title: "Teams vs API Tiers — Matching Data Governance"
    scene_narrative: "You gain the procurement vocabulary to
      answer your legal team's data-residency objection before
      they raise it."
    session_chapter_position: "climax"
─────────────────────────────────────────────────────
```

### 5B. VP Role Separation — Onboarding Flow (UI Change)

The onboarding page currently sends `role: 'vp-technology'` to the API when the user selects "Technology & Engineering" under VP/Director. After CURR-01, the API also receives `roleLevel: 'vp-technology'` instead of `roleLevel: 'vp-dir'`.

```
Step 0 — Level Selection:
┌─────────────────────────────────────────────────┐
│  What best describes your level?                │
│                                                 │
│  [Executive / C-Suite]    → roleLevel: c-suite  │
│  [VP / Director]          → roleLevel: vp-dir   │  ← expands to sub-step
│  [Manager / Team Lead]    → roleLevel: manager  │
│  [Specialist / IC]        → roleLevel: specialist│
└─────────────────────────────────────────────────┘

Step 1 (sub-step under VP/Director) — Function Selection:
┌─────────────────────────────────────────────────┐
│  What function do you lead?                     │
│                                                 │
│  [Technology & Engineering]                     │
│    → roleLevel: vp-technology                   │
│    → role: vp-technology                        │
│                                                 │
│  [Product]                                      │
│    → roleLevel: vp-product                      │
│    → role: vp-product                           │
│                                                 │
│  [Finance]     → roleLevel: vp-dir, role: vp-finance
│  [Marketing]   → roleLevel: vp-dir, role: vp-marketing
│  [Operations]  → roleLevel: vp-dir, role: vp-operations
│  [People/HR]   → roleLevel: vp-dir, role: vp-people
│  [Other]       → roleLevel: vp-dir, role: vp-other
└─────────────────────────────────────────────────┘

Note: Only Technology and Product receive dedicated roleLevel values.
All other VP/Director sub-roles continue to use roleLevel: vp-dir.
```

### 5C. 7-Dimension Coverage Check — Result Shape (Developer Reference)

```
curriculum_plans.raw_llm_output.dimension_coverage_result:
──────────────────────────────────────────────────────────
{
  "checked_at": "2026-06-23T14:32:00Z",
  "visible_session_count": 8,
  "dimensions": {
    "strategic":            { "covered": true,  "match_count": 4 },
    "operational":          { "covered": true,  "match_count": 3 },
    "technical":            { "covered": true,  "match_count": 6 },
    "compliance":           { "covered": true,  "match_count": 2 },
    "competitive":          { "covered": false, "match_count": 0 },
    "team_management":      { "covered": true,  "match_count": 3 },
    "personal_productivity":{ "covered": false, "match_count": 1 }
  },
  "covered_count": 5,
  "missing_dimensions": ["competitive", "personal_productivity"],
  "gap_fill_triggered": true,
  "gap_fill_sessions_added": 1
}
──────────────────────────────────────────────────────────
```

---

## 6. Data Requirements

### 6A. New Fields on `EnrichedSession` Type (TypeScript, no migration)

In `lib/curriculum/types.ts`, add three new fields to the `EnrichedSession` interface:

```typescript
export interface EnrichedSession {
  // ... existing fields unchanged ...

  // CURR-01: Narrative curriculum fields
  scene_narrative: string              // max 25 words: what this session reveals
  arc_throughline: string             // arc-level narrative (same string for all sessions in arc)
  session_chapter_position: 'opening' | 'building' | 'pivot' | 'climax' | 'resolution'
}
```

These fields are populated by the extended Call 1 in `enrichCurriculumPlan()`. They are stored in `curriculum_plans.raw_llm_output.enriched_plan` as part of the existing JSONB column — no schema migration required for these fields.

### 6B. New JSONB Sub-field on `curriculum_plans` (no migration — existing JSONB column)

A new key `dimension_coverage_result` is written into `curriculum_plans.raw_llm_output` alongside the existing `enriched_plan` key.

Shape:

```typescript
interface DimensionCoverageResult {
  checked_at: string                          // ISO timestamp
  visible_session_count: number
  dimensions: Record<
    'strategic' | 'operational' | 'technical' | 'compliance' |
    'competitive' | 'team_management' | 'personal_productivity',
    { covered: boolean; match_count: number }
  >
  covered_count: number                       // 0–7
  missing_dimensions: string[]               // dimension IDs that did not pass
  gap_fill_triggered: boolean
  gap_fill_sessions_added: number            // 0 if gap_fill_triggered is false
}
```

No migration required — this is a new key in the existing `raw_llm_output` JSONB column on `curriculum_plans`.

### 6C. Migration 040 — Normalise `ai_maturity` in `users` Table

This migration backfills all existing `users.ai_maturity` values to the canonical vocabulary.

```sql
-- Migration 040: Normalise ai_maturity to canonical vocabulary
-- Safe to run at any time — idempotent. Updates only rows with non-canonical values.
-- After this migration, users.ai_maturity will only contain:
--   beginner | intermediate | advanced | expert

UPDATE users SET ai_maturity = 'beginner'
WHERE ai_maturity IN ('observer', 'no experience');

UPDATE users SET ai_maturity = 'intermediate'
WHERE ai_maturity IN ('emerging', 'some experience', 'somewhat experience', 'evaluator', 'pilot');

UPDATE users SET ai_maturity = 'advanced'
WHERE ai_maturity IN ('practitioner', 'scaler');

UPDATE users SET ai_maturity = 'expert'
WHERE ai_maturity = 'leader';

-- Catch-all: set any remaining unknown values to 'intermediate' (safe default)
UPDATE users SET ai_maturity = 'intermediate'
WHERE ai_maturity NOT IN ('beginner', 'intermediate', 'advanced', 'expert')
  AND ai_maturity IS NOT NULL;
```

### 6D. Migration 041 — Add `quality_dimension_result` Column to `sessions`

```sql
-- Migration 041: Add quality dimension result column to sessions
-- Stores the per-session 7-dimension keyword classification from session-quality-evaluator.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS quality_dimension_result JSONB DEFAULT NULL;

COMMENT ON COLUMN sessions.quality_dimension_result IS
  'JSONB: 7-dimension keyword classification of this session transcript. '
  'Shape: { evaluated_at: string, dimensions: Record<string, { covered: boolean, match_count: number }>, covered_count: number }. '
  'Null until session-quality-evaluator runs for this session. Written by CURR-01.';
```

### 6E. `users.role_level` — New Accepted Values

`users.role_level` is a `TEXT` column (migration 026, no enum constraint). No migration is required to store the new `vp-technology` and `vp-product` values — the column already accepts any text.

The only schema change is in the Zod validation in `app/api/onboarding/route.ts`:

```typescript
// Before:
roleLevel: z.enum(['c-suite', 'vp-dir', 'manager', 'specialist']).default('c-suite'),

// After:
roleLevel: z.enum(['c-suite', 'vp-dir', 'vp-technology', 'vp-product', 'manager', 'specialist']).default('c-suite'),
```

### 6F. Reads Required

**Curriculum generation pipeline reads:**
- `users` table: `role`, `role_level`, `industry`, `ai_maturity`, `topic_interests`, `plan_tier`, `worry_tags`
- `curriculum_plans` table: existing plan for cache-hit check (`user_profile_hash`)

**Post-session quality evaluator reads (unchanged from existing):**
- `sessions` table with joined `users` — `role`, `industry`, `ai_maturity`, `active_plan_id`, `recall_bot_id`, `ended_at`
- `topic_content_cache` table: `subtopic_slug`, `content_outline` (for checkpoint question extraction)
- `knowledge_profiles` table: existing profile for upsert logic
- Recall.ai API: `/api/v1/bot/{recall_bot_id}/transcript`

**No new reads are required by CURR-01** beyond the data already fetched in these two functions.

### 6G. Writes Summary

| Location | What is written | Trigger | Migration required |
|---|---|---|---|
| `curriculum_plans.raw_llm_output.enriched_plan` | `scene_narrative`, `arc_throughline`, `session_chapter_position` on each session | Plan generation | None (existing JSONB) |
| `curriculum_plans.raw_llm_output.dimension_coverage_result` | 7-dimension coverage result + gap-fill metadata | Plan generation | None (existing JSONB) |
| `users.ai_maturity` | Canonical value (`beginner` / `intermediate` / `advanced` / `expert`) | Onboarding API POST + backfill | Migration 040 |
| `users.role_level` | `vp-technology` or `vp-product` for qualifying VP users | Onboarding API POST | None (TEXT column) |
| `sessions.quality_dimension_result` | Per-session 7-dimension coverage from transcript | Session quality evaluator cron | Migration 041 |

---

## 7. Success Criteria (Acceptance Tests)

**AC-01 — Narrative fields present on all enriched sessions**
Given a curriculum plan is generated for any user profile with a valid `ANTHROPIC_API_KEY`, when `curriculum_plans.raw_llm_output.enriched_plan` is read, then every session object contains `scene_narrative` (non-empty string, max 25 words), `arc_throughline` (non-empty string, same value for all sessions in the same arc), and `session_chapter_position` (one of: `opening`, `building`, `pivot`, `climax`, `resolution`).

**AC-02 — Arc throughline is consistent within each arc**
Given a plan with multiple sessions in the same arc (e.g. 3 sessions in "Claude in Financial Services"), when `enriched_plan.arcs[0].sessions` is inspected, then `arc_throughline` is identical across all 3 sessions in that arc.

**AC-03 — VP of Technology receives different curriculum framing than VP of Product**
Given User A has `role_level = 'vp-technology'` and User B has `role_level = 'vp-product'`, and both have the same `industry` and `ai_maturity`, when plans are generated for both users on the same topic, then: the visible sessions for User A contain at least 2 keywords from the set `['infrastructure', 'api', 'security', 'architecture', 'procurement', 'build']` in their subtopics and `role_hint` fields; the visible sessions for User B contain at least 2 keywords from the set `['product', 'feature', 'roadmap', 'user experience', 'launch', 'competitive']` in their subtopics and `role_hint` fields; and neither user's plan contains keywords that belong exclusively to the other's domain.

**AC-04 — `vp-technology` and `vp-product` are saved to `users.role_level`**
Given a user completes onboarding and selects "Technology & Engineering" under VP/Director, when `POST /api/onboarding` is called with `{ roleLevel: 'vp-technology', role: 'vp-technology', ... }`, then the `users` table row for that user has `role_level = 'vp-technology'` and the API returns `{ success: true }` with HTTP 200. (Same test for `vp-product`.)

**AC-05 — `ai_maturity` saved as canonical value after onboarding**
Given a user completes onboarding and selects the option that maps to `observer` in the UI, when `POST /api/onboarding` is called with `{ aiMaturity: 'observer', ... }`, then the `users` table row for that user has `ai_maturity = 'beginner'` — not `'observer'`.

**AC-06 — All four UI maturity values normalise correctly at save**
Given the onboarding API receives each of the four UI values in separate calls, when the DB is queried after each call, then: `observer` → `beginner`, `emerging` → `intermediate`, `practitioner` → `advanced`, `leader` → `expert`.

**AC-07 — Migration 040 normalises existing rows**
Given migration 040 has been applied, when `SELECT DISTINCT ai_maturity FROM users` is run, then the result set contains only values from `{beginner, intermediate, advanced, expert}` (plus any `NULL` rows).

**AC-08 — 7-dimension coverage check runs and result is stored**
Given a curriculum plan is generated for any user, when `curriculum_plans.raw_llm_output` is read, then a key `dimension_coverage_result` is present and contains `checked_at`, `visible_session_count`, `dimensions` (an object with all 7 dimension IDs as keys), `covered_count`, `missing_dimensions`, `gap_fill_triggered`, and `gap_fill_sessions_added`.

**AC-09 — Plans with fewer than 5 covered dimensions trigger gap-fill**
Given a test plan is generated where 3 of the 7 dimensions would have 0 keyword matches, when the coverage check runs, then `gap_fill_triggered = true` and at least one gap-fill session is added to the visible sessions list, and `gap_fill_sessions_added >= 1`.

**AC-10 — Plans that already cover 5+ dimensions do not trigger gap-fill**
Given a test plan is generated that covers 5 or more dimensions natively, when the coverage check runs, then `gap_fill_triggered = false` and `gap_fill_sessions_added = 0`, and the visible session count is unchanged from what `generateCurriculumPlan()` returned.

**AC-11 — session-quality-evaluator writes `quality_dimension_result` to sessions**
Given a session has `status = 'completed'`, `quality_evaluated = false`, `ended_at` between 2 and 2.25 hours ago, and a valid `recall_bot_id`, when the 15-minute cron runs, then `sessions.quality_dimension_result` is a non-null JSONB object containing `evaluated_at`, `dimensions` (7 keys), and `covered_count` for that session.

**AC-12 — Fallback plan still stores dimension coverage result**
Given `ANTHROPIC_API_KEY` is set to a placeholder value, when `generateCurriculumPlan()` runs and returns the deterministic fallback plan, then `dimension_coverage_result` is still written to `raw_llm_output` based on the keyword check applied to the fallback sessions. `gap_fill_triggered` is `false` (gap-fill requires a real API key and is skipped in mock mode).

**AC-13 — `vp-dir` users are unaffected by VP role separation**
Given a user whose `role_level = 'vp-dir'` (set before this change was deployed), when a curriculum plan is generated for them, then the plan generates without error and the `roleLevelInstruction` for `vp-dir` is applied (generic VP/Director framing), not `vp-technology` or `vp-product`.

---

## 8. Error States

### 8A. Call 1 narrative extension fails (scene_narrative not returned)
If the extended arc classification Claude call returns sessions without the three new narrative fields (e.g. due to a schema change mid-deploy or model refusal), the merge step falls back to defaults:
- `scene_narrative`: `"${session.title} — a key part of your learning journey."`
- `arc_throughline`: `"This arc builds your understanding of ${arc_name}."`
- `session_chapter_position`: derived from `arc_position`: position 1 → `opening`; positions 2 to arc_length-1 → `building`; final position → `resolution`

The plan is still saved. No error is thrown. A console warning is logged: `[enrichment][WARN] narrative fields missing for session "${title}" — using fallback`.

### 8B. Gap-fill Claude call fails
If the gap-fill Claude call throws or returns invalid JSON, the plan is saved without the gap-fill sessions. `gap_fill_triggered = true` but `gap_fill_sessions_added = 0`. A console error is logged: `[curriculum-generator][ERROR] gap-fill call failed for user ${userId} — plan saved without gap-fill sessions`. The plan delivery is not blocked. The plan is marked with `dimension_coverage_result.gap_fill_triggered = true` so monitoring can detect it.

### 8C. Gap-fill returns sessions that fail Zod validation
Each gap-fill session is validated with `SessionSchema` before insertion. Sessions that fail validation are silently dropped (logged at WARN level). If all gap-fill sessions fail validation, the outcome is the same as 8B.

### 8D. `normaliseMaturity` receives an unknown value at onboarding save
If `data.aiMaturity` arrives with a value not in `normaliseMaturity`'s switch statement (e.g. a future UI value not yet handled), the function returns `'intermediate'` (its existing default). This is already the correct behaviour — no change required.

### 8E. `role_level = 'vp-technology'` or `'vp-product'` arrives at a function that only checks the four legacy values
Any function that uses a `Record<string, string>` map (like `roleLevelInstruction` in `planner.ts` or `SENIORITY_MARKERS` in `session-quality-evaluator.ts`) and receives an unknown key falls back to the `vp-dir` equivalent via nullish coalescing. This is already the pattern used in both files (`?? roleLevel` for the label map, and `'c-suite'` hardcoded as fallback in the quality evaluator). After CURR-01, explicit entries for `vp-technology` and `vp-product` are added to both maps, so the fallback only fires if a third VP sub-role is introduced in future without updating these maps.

### 8F. Session quality evaluator: `quality_dimension_result` write fails
If the Supabase update to `sessions.quality_dimension_result` fails (network error, column not yet migrated), the quality evaluator logs the error and continues to the existing `quality_evaluated = true` mark. The session is marked as evaluated even if the dimension result was not saved. This prevents the session from being re-evaluated on the next cron tick. The dimension result can be recomputed in a future one-off job if needed.

### 8G. Coverage check runs against zero visible sessions
If `enrichedPlan` has no visible sessions (e.g. all were moved to queue by the quality threshold), `checkDimensionCoverage` returns `covered_count = 0` and `gap_fill_triggered = false`. No gap-fill runs (there are no visible sessions to add new ones alongside). The result is stored as-is. This is an edge case that indicates an upstream problem (the quality threshold moved everything to queue), not a CURR-01 failure.

---

## 9. Edge Cases

**Edge case 1 — User with `role_level = 'vp-technology'` but the enrichment API key is a placeholder**
The fallback plan from `buildFallbackPlan()` is returned. Narrative fields use the default fallback strings (Section 8A). The `roleLevelInstruction` lookup is still applied to the fallback plan's `role_hint` field — fallback plan session `role_hint` values reference the `vp-technology` framing instruction. Dimension coverage check still runs against fallback sessions. Gap-fill is skipped (requires API key).

**Edge case 2 — A user who previously onboarded with `role_level = 'vp-dir'` selects "Technology & Engineering" in a second onboarding flow (profile update)**
The second `POST /api/onboarding` call upserts `role_level = 'vp-technology'`. The existing `curriculum_plans` row is superseded because the `user_profile_hash` changes (the hash includes `roleLevel`). A new plan is generated with `vp-technology` framing.

**Edge case 3 — `normaliseMaturity` is called with `null` or empty string**
The function's switch statement falls to the `default` case and returns `'intermediate'`. This is existing behaviour. No change.

**Edge case 4 — Arc with only one session (singleton arc)**
`session_chapter_position` defaults to `'opening'` (there is no `building`, `pivot`, `climax`, or `resolution` in a single-session arc). `arc_throughline` is a single sentence. This is valid output.

**Edge case 5 — Plan with 10 visible sessions (Pro/Executive tier)**
The coverage check runs against all 10 visible sessions. With more sessions, more keywords appear naturally, making it less likely that gap-fill is needed. If coverage is already at 5+ dimensions with 10 sessions, no gap-fill fires. If gap-fill does fire, the new session is appended within the visible list (it is already visible — it was generated to fill the gap), and the visible count becomes 11. The tier limit cap in `curriculum-generator.ts` is checked after gap-fill and the lowest-priority visible session is moved to the queue if the cap is exceeded.

**Edge case 6 — Gap-fill session has no natural arc to join**
If the user has only one arc and the gap-fill session covers a dimension that does not belong to that arc's topic (e.g. a `compliance` gap session for a user whose only arc is "Claude for Work"), the gap-fill session is appended to the existing arc with `arc_position = arc_length + 1` and `arc_length` is incremented. The session's title makes clear it is a supplementary coverage session (e.g. "Compliance Considerations for AI Tools in Your Role").

**Edge case 7 — First-ever VP of Technology user (no DB rows with `role_level = 'vp-technology'` exist yet)**
The onboarding API saves `vp-technology` without issue (the column is TEXT, no constraint). The planner looks up `roleLevelInstruction['vp-technology']` and finds the new entry. The enrichment Call 1 receives `roleLevel: 'vp-technology'` in the user message. No special handling required.

**Edge case 8 — `dimension_coverage_result` already exists on `curriculum_plans.raw_llm_output`**
If plan regeneration runs for the same user (profile changed), the supersede step deletes the old plan row and inserts a new one. The new `raw_llm_output` is a fresh object — no risk of stale `dimension_coverage_result` persisting.

---

## 10. Out of Scope

The following are explicitly NOT part of CURR-01:

1. **Adaptive plan reordering based on quality signals.** The `quality_dimension_result` stored in this spec is the raw material for SCR-01 (Adaptive Script System). SCR-01 is a separate feature. CURR-01 stores the data; SCR-01 acts on it.

2. **UI changes to the plan screen.** The plan page does not change in this spec. The `arc_throughline`, `scene_narrative`, and `session_chapter_position` fields are stored in the DB but not displayed to the user. A future spec will add narrative display to the plan UI.

3. **Additional VP sub-roles beyond Technology and Product.** Only `vp-technology` and `vp-product` receive dedicated `roleLevel` values and curriculum instructions. All other VP/Director sub-roles (Finance, Marketing, Operations, HR) continue to use `role_level = 'vp-dir'`.

4. **Changes to the session-designer or session-content-pipeline.** The session designer (`inngest/session-designer-auto.ts`) and content pipeline (`inngest/session-content-pipeline.ts`) are unchanged by this spec. The narrative fields stored in `enriched_plan` are not yet used by the content pipeline (that integration is a future spec).

5. **Changes to the onboarding UI.** The onboarding page already collects `vp-technology` and `vp-product` as `roleId` values under the VP/Director level. The only UI change is ensuring the page sends `roleLevel: 'vp-technology'` (not `roleLevel: 'vp-dir'`) in the API payload when those sub-roles are selected. This is a one-line change to the onboarding form submission — but the UI component structure and visual design do not change.

6. **The `buildCurriculum()` function in `lib/curriculum/index.ts`.** This is the older 4-layer curriculum pipeline (rules-engine → specialist → validator → retry). It is not used by the primary `curriculum-generator.ts` Inngest function — `generateCurriculumPlan()` in `planner.ts` is used instead. `buildCurriculum()` is not touched in this spec.

7. **`lib/curriculum/validator.ts` changes.** The existing validator checks session count (8-12), foundation count, arc sequence, justification length, and total minutes. The 7-dimension check is not added to this validator. It runs as a separate post-enrichment step in the Inngest function, not as part of the validation layer.

8. **Changes to the `knowledge_profiles` table.** The quality evaluator already upserts `knowledge_profiles` based on V1–V7 classification. CURR-01 does not add new columns to this table.

9. **Per-session narrative display in the walkthrough.** The live session walkthrough (`WalkthroughClient.tsx`) is not changed by this spec.

10. **Backfill of narrative fields for existing plans.** Existing `curriculum_plans` rows will not have `scene_narrative`, `arc_throughline`, `session_chapter_position`, or `dimension_coverage_result` in their `raw_llm_output`. This is acceptable — these fields will only be present on plans generated after CURR-01 ships. Existing plans are not regenerated.

---

## 11. Open Questions

None.

All questions have been resolved by the Business Analyst using best judgment for a VP of Technology audience and the existing codebase evidence. Resolutions are documented below for transparency.

**Q1 — What exactly does "3-layer narrative curriculum" mean in data terms?**

Resolved. The three layers are L1_foundation, L2_core, and L3_strategic — these already exist in the `EnrichedSession.layer` field (from FB-007). "Narrative" in data terms means three new fields on `EnrichedSession`: `scene_narrative` (per-session), `arc_throughline` (per-arc, replicated), and `session_chapter_position` (per-session). These are added to the existing Call 1 system prompt in `enrichCurriculumPlan()`. The data structure is defined in Section 6A.

**Q2 — Does "VP separate roleId" mean new DB columns, or new values in an existing column?**

Resolved. New values in the existing `users.role_level` TEXT column. No new columns, no migration for the column itself. Only a Zod enum update in `/api/onboarding/route.ts` and new entries in the `roleLevelLabel` and `roleLevelInstruction` maps in `planner.ts`. Migration 040 is for `ai_maturity` normalisation only.

**Q3 — What is the exact mapping from onboarding UI maturity values to DB canonical values?**

Resolved in Section 4C and Migration 040. `observer → beginner`, `emerging → intermediate`, `practitioner → advanced`, `leader → expert`. This is exactly what `normaliseMaturity()` already does — CURR-01 applies it at save time rather than only at runtime.

**Q4 — What are the 7 dimensions and how are they detected?**

Resolved in Section 4A. The 7 dimensions are: strategic, operational, technical, compliance, competitive, team_management, personal_productivity. Detection is keyword-based (local, no Claude call) applied to the concatenated string of `session.title + subtopics.join(' ') + so_what` for each visible session. A dimension is covered if at least 2 keyword matches are found across all visible sessions for that dimension. The full keyword map is in the table in Section 4A.

**Q5 — What constitutes pass vs fail for each of the 7 dimensions?**

Resolved. Pass: at least 2 keyword matches (across all visible sessions combined, not per-session) for that dimension. Fail: 0 or 1 keyword matches. The threshold of 2 (not 1) prevents a single incidental word match from counting as "covered." The overall plan threshold is 5 of 7 covered dimensions.

**Q6 — What does the automated in-session quality evaluation produce, and where does it go?**

Resolved in Sections 4D and 6D. The existing quality evaluator already classifies V1–V7 responses and evaluates 6 criteria. CURR-01 adds one new output: a `quality_dimension_result` JSONB written to `sessions.quality_dimension_result` via Migration 041. This is a local keyword check of the Clio session transcript against the same 7-dimension keyword map used for plan coverage. No new Claude calls. The result is stored for future use by SCR-01.

**Q7 — Does the gap-fill make a new Claude call? Which model? What are the retries?**

Resolved in Section 4A. Yes, gap-fill makes one new Claude call using `claude-sonnet-4-6` with `max_tokens: 2048`. The call has a 15-second timeout (matching `CALL_TIMEOUT_MS` in `enrichment.ts`). There are no retries for the gap-fill call — if it fails, the plan saves without gap-fill sessions (Section 8B). Retries on the overall Inngest function handle transient failures.

**Q8 — What happens to existing plans and users after migration 040 runs?**

Resolved in Section 6C. Migration 040 is a one-time UPDATE that normalises all `users.ai_maturity` values in the DB. It is idempotent (safe to run multiple times). Existing plans (`curriculum_plans` rows) are not touched. The `user_profile_hash` in existing plans uses `normaliseMaturity()` at generation time, so plans generated before CURR-01 already used the canonical value in the hash even if the raw DB value was `'observer'`. After migration 040, the DB and the hash are consistent.

**Q9 — Which next migration numbers are available?**

Resolved by inspecting the migrations directory. Migrations 038 and 039 are already applied (confirmed by directory listing: `038_cleanup_duplicate_cache_rows.sql`, `039_session_insights.sql`). The next available numbers are 040 and 041. Migration 040 is `ai_maturity` normalisation; migration 041 is `quality_dimension_result` column.

**Q10 — Does the `arc_throughline` go on the arc object or on each session object?**

Resolved. It is stored on each session object (replicated from the arc level). This avoids changing the `EnrichedArc` type (which would require updating all consumers) and makes it simpler to read the narrative for any session without a two-level lookup. The LLM is instructed to produce the same `arc_throughline` string for all sessions in the same arc.

---

## 12. Dependencies

### What must be true before CURR-01 can be built:

1. **Migration 038 and 039 must already be applied in Supabase.** These are confirmed deployed (directory listing shows both files exist). No action needed.

2. **Migration 040 must run before the onboarding API change ships.** If the code change (normalise at save) ships before migration 040 runs, new users will start storing canonical values while old users still have raw UI values in the DB. This is acceptable for a brief window — `normaliseMaturity()` handles both vocabularies at runtime. However, migration 040 should be applied within the same deploy window.

3. **Migration 041 must run before the quality evaluator code change ships.** The column must exist before the Inngest function tries to write to it. Migration 041 is safe to run before the code — the column will simply be null until the evaluator runs.

4. **KB-01 fix must be deployed** (`inngest/session-content-pipeline.ts` upsert error check). Confirmed deployed (BACKLOG.md shows KB-01 as Done 2026-06-09).

5. **FB-007 (3-layer enrichment) must be fully deployed.** CURR-01 extends the `EnrichedSession` type and the enrichment pipeline. The `enrichCurriculumPlan()` function in `lib/curriculum/enrichment.ts` and the `EnrichedSession` type in `lib/curriculum/types.ts` must be in their FB-007 state (confirmed by reading the source — they are deployed and correct).

6. **The `session-quality-evaluator.ts` Inngest function must be registered and running.** Confirmed in the codebase. CURR-01 adds one write step to the existing per-session evaluation logic — the evaluator must be operational for `quality_dimension_result` to be written.

### Build sequence within CURR-01:

1. Write migration 040 (`ai_maturity` normalisation) — apply in Supabase first, before onboarding code changes
2. Write migration 041 (`quality_dimension_result` column) — apply in Supabase, before quality evaluator code changes
3. Update `lib/curriculum/types.ts`: add `scene_narrative`, `arc_throughline`, `session_chapter_position` to `EnrichedSession`
4. Update `lib/curriculum/enrichment.ts`: extend Call 1 system prompt to request the three new narrative fields; update the session assembly block to read and store the new fields with fallback defaults
5. Write `checkDimensionCoverage()` function in `lib/curriculum/enrichment.ts` (or a new file `lib/curriculum/coverage-check.ts`) — local, no Claude dependency
6. Write `runGapFill()` function — single Claude call that returns sessions to insert; validate each with `SessionSchema`
7. Update `inngest/curriculum-generator.ts`: after `enrichCurriculumPlan()`, call `checkDimensionCoverage()`, conditionally call `runGapFill()`, write `dimension_coverage_result` to `rawLlmOutput` before `save-plan` step
8. Update `app/api/onboarding/route.ts`: extend `roleLevel` Zod enum, apply `normaliseMaturity()` before userRecord upsert
9. Update `lib/curriculum/planner.ts`: add `vp-technology` and `vp-product` entries to `roleLevelLabel` and `roleLevelInstruction`
10. Update `inngest/session-quality-evaluator.ts`: add `vp-technology` and `vp-product` to `SENIORITY_MARKERS`; add `checkSessionDimensions()` call and write result to `sessions.quality_dimension_result`
11. TypeScript check: `npx tsc --noEmit` — zero errors

### Deployment order:

- Migrations first (040, 041) — safe before code ships
- Code changes in a single PR: steps 3–10 together
- No feature flag required — all changes are backend pipeline additions or backward-compatible data additions
