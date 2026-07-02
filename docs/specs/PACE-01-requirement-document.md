# PACE-01 — Session Pacing and Sequencing Redesign — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-26

---

## 1. Purpose

Live session observation revealed two structural failures in how Clio sessions are currently designed. First, sessions open directly into subject-matter detail with no context anchor — the user has no frame for why the topic matters to their role or how it connects to what they already know, so detail lands in a vacuum. Second, each section takes approximately five minutes, which loses an executive audience before the section closes.

This feature redesigns the structural rules that govern every live session: how many sections a session has, how long each section runs, what word budget constrains the teaching script, and what mandatory arc shape ensures every session opens with context and closes with a concrete action.

Without this change, Clio sessions continue to feel too long and too disconnected from the user's prior knowledge, reducing engagement and eroding the product's core value of efficient, targeted learning.

---

## 2. User Stories

**As a learner in a Clio live session,**
I want each section to last approximately two minutes,
so that my attention is not taxed before a section ends and I get natural momentum through the session.

**As a learner starting any Clio session,**
I want the first section to tell me why this topic matters to my specific role and how it connects to what I already know,
so that the rest of the session has a frame and I am not dropped into detail cold.

**As a learner finishing any Clio session,**
I want the final section to give me a concrete action or decision I can take immediately,
so that learning translates into something I can do today, not just something I now know.

**As a curriculum designer (Clio system),**
I want the number of sections to be a deterministic function of session duration,
so that no manual tuning is required when session lengths change.

---

## 3. Trigger / Entry Point

**What triggers this feature:**
The section count formula and arc structure are enforced at content generation time, not at session runtime. They fire when the async content pipeline generates a session's subtopics and scripts.

**Entry point — content pipeline trigger:**
- `POST /api/sessions/[id]/generate-content` is called (by the user clicking "Start session" or by the background cron job `session-content-cron`)
- This emits the `clio/session.content.requested` Inngest event
- `sessionContentAsync` in `inngest/session-content-async.ts` handles the event
- Step `step-1-outline` calls `generateSessionContentOutline()` in `lib/content/session-content-generator.ts`, which is where subtopic count (section count) is determined
- Step `process-batch-{i}` calls `generateTrainingScript()` in `lib/content/script-generator.ts` for each subtopic, which is where the TEACH word budget is enforced

**Entry point — session designer trigger:**
- `session-designer-auto` Inngest function runs when a curriculum plan is approved
- It calls `designSessionsForTopic()` in `lib/curriculum/session-designer.ts`, which determines subtopic count per session
- This is the upstream source of `sessions.sub_sessions`, which the content pipeline consumes

**State requirements:**
- User must have an approved curriculum plan with `sessions` rows populated
- Session must have `content_status != 'ready'` (pipeline skips already-ready sessions)
- `ANTHROPIC_API_KEY` must be a real key (placeholder falls back to mock content)

**Route:** No new route. Changes are in the generation pipeline functions.

---

## 4. Screen / Flow Description

This feature has no new user-facing screen. The observable effect is that live sessions have the correct number of tabs and the correct arc structure when a user launches them. The changes are entirely in the content generation layer.

### What the user observes (after this change ships)

**State A — Session launches, section tabs render**

User clicks "Start session" on `/dashboard/sessions/[id]`. After content is generated, the live session screen shows a tab strip. The number of tabs equals the number of sections, which is derived by the formula: `floor((durationMins - 2) / 2)`.

For a 15-minute session: `floor((15 - 2) / 2) = 6` tabs.
For a 30-minute session: `floor((30 - 2) / 2) = 14` tabs (no cap applied).
For a 5-minute session: `floor((5 - 2) / 2) = 1` — floor formula gives 1. Because the minimum is 2 sections (see FR-04), the session is given 2 sections instead.

**State B — User is in Section 1 (context anchor)**

Clio's opening teach segment frames the topic around the user's role. It does NOT begin with model details or domain concepts. It establishes: "Here is why this topic is on your radar right now, and here is how it connects to what you already know." The tab label for Section 1 reflects this framing (topic-agnostic arc role, not a concept name).

**State C — User is in Sections 2 to N-1 (core concepts)**

Each section covers one concept. The TEACH segment is 140 words or fewer. Clio delivers it in approximately one minute. A question follows. Total section duration is approximately two minutes (one minute TEACH, one minute Q&A). Sections are ordered by conceptual dependency — each section builds on the previous one.

**State D — User is in Section N (practical application)**

The final section does not introduce a new concept. It gives the user one concrete action or decision they can take based on what was covered. It names that action explicitly. It connects the topic back to the user's role.

---

## 5. Functional Requirements

### FR-01 — Section count formula

The number of sections (subtopics) generated for a session must be exactly:

```
sectionCount = floor((durationMins - 2) / 2)
```

`durationMins` is read from `sessions.duration_mins`. The value `2` is reserved for session overhead (opening and closing transitions). The divisor `2` represents the two-minute target per section.

This formula is applied in two places:
1. `lib/curriculum/session-designer.ts` — `designFromPreplannedSubtopics()` sets `SUBTOPICS_PER_SESSION`. This constant must be replaced with the formula result for the session's `duration_mins`.
2. `lib/content/session-content-generator.ts` — `generateSessionContentOutline()` receives `subtopicTitles[]`. The caller (`session-content-async.ts`) derives `subtopicTitles` from `sessions.sub_sessions`. The formula is enforced upstream at the session-designer step, so by the time the content pipeline runs, `subtopicTitles` already has the correct count.

There is no cap on the upper bound. A 30-minute session produces 14 sections. A 60-minute session produces 29 sections. The formula applies at all durations without an upper cap.

### FR-02 — Minimum section count

The minimum number of sections is 2, regardless of what the formula produces.

If `floor((durationMins - 2) / 2) < 2`, the section count is set to 2.

This applies for session durations of 5 minutes or fewer:
- 5-minute session: `floor((5 - 2) / 2) = 1` → overridden to 2
- 4-minute session: `floor((4 - 2) / 2) = 1` → overridden to 2
- 3-minute session: `floor((3 - 2) / 2) = 0` → overridden to 2

Arc for a 2-section session: Section 1 = context anchor, Section 2 = core concept (the practical application role of Section N collapses into the single core section since there is no room for a separate final section). When `sectionCount = 2`, Section 2 serves double duty as both the core concept and the practical application.

The minimum session duration supported by the schema is 3 minutes (enforced by `DesignedSessionSchema` in `session-designer.ts` at `duration_mins: z.number().int().min(3)`). The system never sees a session below 3 minutes.

### FR-03 — Tab count equals section count

The number of tabs rendered in the live session UI must equal `sectionCount`. This is a derived consequence of FR-01: because each subtopic becomes one tab, and section count equals subtopic count, no additional UI logic is required. The tab strip renders one tab per entry in `sessions.sub_sessions` (or per section in `sessions.session_plan.sub_sessions`). FR-03 is satisfied automatically when FR-01 is correctly implemented upstream.

### FR-04 — Mandatory arc structure

Every session must follow this arc:

| Section position | Arc role | Content rule |
|---|---|---|
| Section 1 | Context anchor | Establishes why this topic matters to the user's role. Connects to prior knowledge. Does NOT open with domain concepts or model details. |
| Sections 2 to N-1 | Core concepts in dependency order | Each section covers one concept. Ordered so that each concept unlocks the next. |
| Section N (last) | Practical application | One concrete action or decision the user can take based on what was covered. No new concepts introduced. |

When `sectionCount = 2`: Section 1 is the context anchor. Section 2 is both the core concept and the practical application.

When `sectionCount = 3`: Section 1 is the context anchor. Section 2 is the core concept. Section 3 is the practical application.

This arc is enforced in the prompt sent to `generateSessionContentOutline()`. See FR-06 for the exact prompt language.

### FR-05 — 140-word TEACH budget

The TEACH segment of every section's training script must be 140 words or fewer.

**How this is enforced:**

The word budget is enforced at generation time via an explicit instruction in the prompt sent to `generateScriptAndVisualization()` (in `lib/content/script-generator.ts`, the `generateScriptAndVisualization` function). The current prompt at line 488 already uses `wordsPerSubtopic` as a proactive budget, calculated as:

```typescript
const wordsPerSubtopic = Math.round((durationMins * 140) / totalSubtopics)
```

PACE-01 changes this calculation. Under PACE-01 the TEACH budget is fixed at 140 words regardless of duration and subtopic count. The formula above must be replaced with the constant `140`.

The updated prompt instruction for the TEACH segment must read exactly:

```
1. TEACH (exactly 140 words — hard limit, no exceptions)
   You have 140 words for this segment. Count carefully. If your draft exceeds 140 words,
   cut from the least important sentence first. Never cut the final takeaway sentence.
   Write with confidence and precision. No filler, no hedging, no padding.
   Every sentence must teach something new.
   [remainder of TEACH rules unchanged]
```

The `duration_seconds` hint written into the JSON response must reflect 140 words at a spoken pace of 140 words per minute = 60 seconds:

```json
{ "type": "TEACH", "content": "...", "duration_seconds": 60 }
```

**Post-generation enforcement (server-side guard):**
After the LLM returns the TEACH segment, a word count check is run before the result is stored. If the word count exceeds 140, the TEACH content is truncated at the last complete sentence boundary at or before the 140-word mark. This guard is added inside `processSubtopic()` in `session-content-async.ts` immediately after the LLM call returns, before the upsert to `topic_content_cache`.

Word count method: `content.trim().split(/\s+/).length`. A "word" is any whitespace-delimited token. NAV directives (`[NAV:tab_0]`) count as one word each.

### FR-06 — Topic-agnostic context anchor prompt

The session designer prompt sent to `generateSessionContentOutline()` must enforce Section 1 as a context anchor without naming the specific topic being taught. The purpose is to prevent the LLM from using the topic name as a shortcut and instead forcing genuine context framing.

The following instruction must be added to the prompt in `generateSessionContentOutline()` (in `lib/content/session-content-generator.ts`), inserted after the `SUBTOPICS TO COVER` list and before the `TASK` block:

```
SECTION STRUCTURE RULES — MANDATORY
The subtopic list above is ordered. You must follow this arc exactly:

Section 1 — Context anchor (always first, regardless of topic):
  Do NOT open with the topic name or a definition of what is being taught.
  Instead, open with: "Here is why this is on your radar right now as a [role] in [industry]."
  Connect to something the user already knows or a decision they are currently facing.
  The goal is to give the user a frame before any detail arrives.

Sections 2 to N-1 — Core concepts in dependency order:
  Each section covers exactly one concept.
  Order them so understanding each one unlocks the next.
  Do not reorder the subtopics from the list — the list is already in dependency order.

Section N — Practical application (always last):
  Do not introduce any new concept in this section.
  Give one specific action or decision the user can take based on what was covered today.
  Name the action explicitly. Connect it to the user's role.
```

This instruction is prompt-only. There is no new database field for arc role. The arc structure is enforced at generation time and is implicit in the ordering and content of the subtopics stored in `sessions.sub_sessions`.

### FR-07 — Session 1 depth_level = 'foundation'

For the first session of any topic arc, the enrichment step must enforce `depth_level = 'foundation'`.

**Current state:** `lib/curriculum/enrichment.ts` receives `depth_level` as a field on each session from the planner output (type: `'beginner' | 'intermediate' | 'advanced'`). The enrichment function passes `depth_level` through unchanged from the planner — it does not modify it. The planner in `lib/curriculum/planner.ts` assigns `depth_level: 'beginner'` to the first session template in the fallback (lines 379 and 389) and the LLM prompt instructs the LLM to order subtopics from most foundational to most advanced.

**What PACE-01 changes:** The CEO brief uses the term `depth_level = 'foundation'`, but the existing schema only accepts `'beginner' | 'intermediate' | 'advanced'` (enforced by Zod in `SessionSchema` in `planner.ts` and in `EnrichmentInput` in `enrichment.ts`). The value `'foundation'` does not exist in the current type system.

**Resolution:** Do NOT add a new enum value `'foundation'` to the schema. The correct implementation is:

1. The planner already assigns `depth_level: 'beginner'` to arc_position 1 sessions (the first session). This is the correct encoding of "foundation" in the existing schema.
2. The enrichment prompt in `callArcClassification()` already classifies first sessions as `L1_foundation` by layer tag.
3. FR-07 is implemented as a **prompt instruction added to `designFromPreplannedSubtopics()`** in `session-designer.ts`:

```
Rule: The first subtopic in this session is a context anchor. It must establish foundational
framing for the topic — why it matters to this user's role — before any technical detail.
Do not start with a concept definition. Start with relevance.
```

This prompt instruction is the only change required. No new DB column, no schema change, no new enum value. The existing `depth_level: 'beginner'` on arc_position-1 sessions correctly signals foundation-level content to downstream consumers.

### FR-08 — Cache invalidation on ship

When PACE-01 ships, existing `topic_content_cache` rows generated under the old pacing rules must be invalidated so sessions regenerate with the new structure.

**Which rows to clear:**
All rows in `topic_content_cache` where `pipeline_status = 'ready'`. Rows with `pipeline_status = 'generating'` or `pipeline_status = 'failed'` are left as-is (they will be retried by the pipeline anyway).

**How to clear:**
A one-time SQL statement run in Supabase after deploy:

```sql
UPDATE topic_content_cache
SET pipeline_status = 'pending'
WHERE pipeline_status = 'ready';
```

This does not delete rows. It resets their status so the pipeline treats them as needing regeneration on next session launch. The `session_content_cron` Inngest job will pick up sessions with `content_status != 'ready'` on its next run.

**When to run:**
After SESS-06 is merged and its migration is applied (see Section 12). Running cache invalidation before SESS-06 is live means the pipeline regenerates content using the old (wrong) subtopics from `findSubtopicsFromCatalog()`, which wastes LLM calls and produces incorrectly-structured content.

**Scope:** All users, all sessions. There is no per-user or per-session scoping. The new pacing rules apply universally.

---

## 6. Non-Functional Requirements

**NFR-01 — No new LLM calls during a live session.**
All pacing and arc structure changes are applied at content generation time (the async pipeline), not at session runtime. The live session reads pre-generated content from `topic_content_cache`. No additional latency is introduced during a session.

**NFR-02 — Pipeline must not fail on formula edge cases.**
If `floor((durationMins - 2) / 2)` produces a value less than 2, the system must apply the minimum of 2 silently without error. This must be handled with a `Math.max(2, ...)` guard, not a thrown exception.

**NFR-03 — Backward compatibility with existing sessions.**
Sessions that have already been generated and have `content_status = 'ready'` continue to work unchanged until the cache invalidation SQL is run. The invalidation is a deliberate one-time operation, not automatic.

**NFR-04 — TypeScript strict mode compliance.**
No changes to existing type definitions in `SubtopicSchema`, `DesignedSession`, or `EnrichmentInput`. The `depth_level` enum remains `'beginner' | 'intermediate' | 'advanced'`. `npx tsc --noEmit` must exit clean after PACE-01 changes.

**NFR-05 — Mock path must also respect section count.**
When `ANTHROPIC_API_KEY` is a placeholder, `buildFallbackSessions()` in `session-designer.ts` must also apply the `sectionCount` formula. Currently it hardcodes 3 subtopics. After PACE-01, it must receive `durationMins` and compute `Math.max(2, Math.floor((durationMins - 2) / 2))` subtopics.

---

## 7. Data Model Changes

No new tables. No new columns. No new migrations.

The following fields are read but not changed:

| Field | Table | Notes |
|---|---|---|
| `duration_mins` | `sessions` | Read by the session designer to compute `sectionCount`. Already exists. |
| `sub_sessions` | `sessions` | Written by session designer with the new `sectionCount` subtopics. Schema unchanged — still `Array<SubtopicObject>`. |
| `pipeline_status` | `topic_content_cache` | Set to `'pending'` by the cache invalidation SQL on ship. Existing values: `'pending' | 'generating' | 'ready' | 'failed'`. No new values added. |

The only data operation associated with PACE-01 is the one-time cache invalidation SQL in FR-08.

---

## 8. API and Interface Changes

### 8A — `lib/curriculum/session-designer.ts`

**Function: `designFromPreplannedSubtopics()`**

Current: `const SUBTOPICS_PER_SESSION = 4` (hardcoded constant, line 103).

Required: Replace with:
```typescript
const sectionCount = Math.max(2, Math.floor((maxMins - 2) / 2))
```
`maxMins` is already a parameter of this function (the session's `duration_mins`). Use it directly.

The `chunkArray(subtopics, sectionCount)` call on line 104 must use `sectionCount` instead of `SUBTOPICS_PER_SESSION`.

**Function: `buildFallbackSessions()`**

Current: hardcodes 3 subtopics (concept, application, summary).

Required: Accept the session's `durationMins` (already available as `maxMins` in all callers). Compute `sectionCount = Math.max(2, Math.floor((maxMins - 2) / 2))`. Dynamically build `sectionCount` subtopics. For the minimal case (`sectionCount = 2`): one concept subtopic and one summary/application subtopic. For larger counts: fill with alternating concept/application/summary types up to `sectionCount`.

**Function: `designSessionsForTopic()` — legacy LLM path (no pre-planned subtopics)**

The legacy LLM prompt (lines 216–255) currently instructs `2–5 subtopics per session`. This must be updated to instruct exactly `sectionCount` subtopics, where `sectionCount = Math.max(2, Math.floor((maxMins - 2) / 2))`. The prompt variable for subtopic count must reference this formula result, not a hardcoded range.

Add the Section Structure Rules from FR-06 to the legacy path prompt as well.

**Function: `designFromPreplannedSubtopics()` — prompt addition**

Add the foundation framing instruction from FR-07 to the prompt block (after `Rules:`, before `Respond ONLY with valid JSON`).

### 8B — `lib/content/session-content-generator.ts`

**Function: `generateSessionContentOutline()`**

Add the Section Structure Rules block from FR-06 to the prompt, between the `SUBTOPICS TO COVER` list and the `TASK` block.

No changes to the function signature, return type, or Zod schema.

### 8C — `lib/content/script-generator.ts`

**Function: `generateScriptAndVisualization()`**

Change line 431:
```typescript
// Before
const wordsPerSubtopic = Math.round((durationMins * 140) / totalSubtopics)

// After
const wordsPerSubtopic = 140
```

Change the TEACH prompt instruction to the exact text specified in FR-05. Change the `duration_seconds` hint in the JSON template from `Math.round(wordsPerSubtopic / 140 * 60)` to the fixed value `60`.

**Function: `generateTrainingScript()`** (legacy async path)

This function's TEACH instruction currently targets `300-420 seconds of spoken content — 5-7 minutes, ~600-840 words` (line 196). Under PACE-01, the TEACH must be 140 words maximum. Change the instruction to:

```
1. TEACH (exactly 140 words — hard limit)
   You have 140 words. Write with full confidence and precision.
   No filler, no hedging. Every sentence must teach something.
   [remainder of rules unchanged]
```

Change `duration_seconds` in the JSON template for TEACH from `360` to `60`.

### 8C — `inngest/session-content-async.ts`

**Function: `processSubtopic()`**

Add a post-generation word count guard after the LLM returns the script, before the upsert. This applies to the TEACH segment of the `adaptedScript` result:

```typescript
// Word count guard: enforce 140-word TEACH budget
const teachSegment = adaptedScript.segments.find(s => s.type === 'TEACH')
if (teachSegment) {
  const words = teachSegment.content.trim().split(/\s+/)
  if (words.length > 140) {
    console.warn(`[session-content-async] TEACH word count ${words.length} exceeds 140 — truncating at sentence boundary`)
    // Truncate at last sentence boundary at or before word 140
    const truncated = words.slice(0, 140).join(' ')
    const lastSentence = truncated.lastIndexOf('.')
    teachSegment.content = lastSentence > 0 ? truncated.slice(0, lastSentence + 1) : truncated
  }
}
```

---

## 9. Acceptance Criteria

**AC-01 — Section count formula: 15-minute session**
Given a session with `duration_mins = 15`,
when `designFromPreplannedSubtopics()` runs,
then `sub_sessions` is written with exactly `floor((15 - 2) / 2) = 6` subtopic objects.

**AC-02 — Section count formula: 30-minute session**
Given a session with `duration_mins = 30`,
when `designFromPreplannedSubtopics()` runs,
then `sub_sessions` is written with exactly `floor((30 - 2) / 2) = 14` subtopic objects.

**AC-03 — Minimum section count: 5-minute session**
Given a session with `duration_mins = 5`,
when `designFromPreplannedSubtopics()` runs,
then `sub_sessions` is written with exactly 2 subtopic objects (formula gives 1, minimum override gives 2).

**AC-04 — Minimum section count: 3-minute session**
Given a session with `duration_mins = 3`,
when `designFromPreplannedSubtopics()` runs,
then `sub_sessions` is written with exactly 2 subtopic objects (formula gives 0, minimum override gives 2).

**AC-05 — Tab count equals section count**
Given a 15-minute session with `sub_sessions` containing 6 subtopics,
when the live session UI renders,
then the tab strip shows exactly 6 tabs (one per subtopic).

**AC-06 — TEACH word count within budget**
Given a generated TEACH segment for any subtopic in any session,
when the TEACH content is split on whitespace,
then the word count is 140 or fewer.

**AC-07 — Post-generation truncation guard fires correctly**
Given the LLM returns a TEACH segment with 160 words,
when `processSubtopic()` runs the word count guard,
then the stored TEACH content has 140 words or fewer, and ends at a complete sentence boundary (i.e., the last character is a period or question mark).

**AC-08 — Context anchor prompt does not hardcode topic**
Given the prompt sent to `generateSessionContentOutline()` for any session,
when the Section Structure Rules block is inspected,
then it does not contain the specific topic title (e.g., "LLM Fundamentals") in the Section 1 instruction — the instruction uses `[role]` and `[industry]` placeholders only.

**AC-09 — Section 1 content establishes context, not definition**
Given a generated session content outline for Session 1 of any topic arc,
when the first subtopic's `coaching_narrative` is read,
then it does not begin with a definition of the topic (e.g., "An LLM is..."), and it does contain language connecting the topic to the user's role and current context.

**AC-10 — Section N content provides a concrete action**
Given a generated session content outline for any session,
when the last subtopic's `coaching_narrative` is read,
then it contains at least one explicit action or decision framed for the user's role (e.g., "Your next step is..." or "The decision you need to make is...").

**AC-11 — Fallback (mock) path respects section count**
Given `ANTHROPIC_API_KEY` is a placeholder,
when `buildFallbackSessions()` is called for a 15-minute session,
then the returned session has exactly 6 subtopics.

**AC-12 — depth_level = 'beginner' on arc_position 1 sessions**
Given a curriculum plan where arc_position 1 sessions have `depth_level = 'beginner'` (assigned by the planner),
when `enrichCurriculumPlan()` runs,
then those sessions are classified as `L1_foundation` by the enrichment LLM (this is already the expected enrichment behavior; no code change required, AC-12 is a regression guard).

**AC-13 — Cache invalidation SQL sets all ready rows to pending**
Given `topic_content_cache` has N rows with `pipeline_status = 'ready'`,
when the cache invalidation SQL from FR-08 is executed,
then all N rows have `pipeline_status = 'pending'` and zero rows remain with `pipeline_status = 'ready'`.

**AC-14 — TypeScript compiles clean**
Given all PACE-01 code changes are applied,
when `npx tsc --noEmit` is run,
then it exits with code 0 and zero errors.

---

## 10. Edge Cases

**Session with exactly 6 minutes duration**
`floor((6 - 2) / 2) = 2`. Produces the minimum 2-section session without needing the override. Both sections render normally.

**Session with a pre-planned subtopic list shorter than sectionCount**
If the curriculum planner provides 3 subtopics for a 15-minute session (which calls for 6 sections), `designFromPreplannedSubtopics()` will chunk 3 subtopics into one session of 3 sections — not 6. The formula only controls the chunk size; it cannot create subtopics that do not exist in the input. If the curriculum planner provides fewer subtopics than `sectionCount`, the session receives fewer sections than the formula targets.

Resolution: The curriculum planner prompt must generate at least `sectionCount` subtopics per session arc. This is enforced by updating the planner prompt to instruct a minimum subtopic count equal to `sectionCount` for the session's duration. This is an additional change to `lib/curriculum/planner.ts` that is within scope of PACE-01.

**Session with a very large number of subtopics (e.g. 30-minute session = 14 sections)**
The content pipeline processes subtopics in batches of 3 (line 176 in `session-content-async.ts`). 14 subtopics = 5 batches. This is within normal operating parameters. No batch size change required.

**adaptScriptToDuration called on a 140-word TEACH segment**
`adaptScriptToDuration()` compares `canonicalSeconds` to `availableSeconds` and skips adaptation if within 10%. With TEACH fixed at 60 seconds (140 words), a 15-minute session with 6 sections allocates `(15 * 60) / 6 - 120 = 30` seconds per non-close subtopic, which is less than the 60-second TEACH. The adaptation function will attempt to condense the TEACH to 30 seconds (approximately 70 words). This is a conflict: PACE-01 sets a 140-word budget; `adaptScriptToDuration` would then cut it to 70 words.

Resolution: `adaptScriptToDuration()` must not condense the TEACH segment below 140 words. Add a floor guard: `availableSeconds = Math.max(60, availableSeconds)` for the TEACH segment specifically, before the condensing prompt is called.

**2-section session arc assignment**
When `sectionCount = 2`, Section N is both the core concept and the practical application. The Section Structure Rules prompt (FR-06) must explicitly state: "When there are exactly 2 sections, Section 2 serves as both the core concept and the practical application. Give one concrete action at the end of Section 2."

**LIVE-01 interaction: `section_index` field**
LIVE-01 (backlog entry, no spec yet as of 2026-06-26) plans to replace fuzzy title matching in `WalkthroughClient.tsx` with index-based section lookup. LIVE-01 will pass `section_index` (integer) in the `show_visual()` tool call and embed `[NAV:tab_0]`, `[NAV:tab_1]`, `[NAV:tab_2]` directives in the TEACH segment.

The `[NAV:tab_N]` directives already exist in the `generateScriptAndVisualization()` prompt (line 494–496 in `script-generator.ts`). PACE-01 does not change or remove these directives. The TEACH word count guard (FR-05) must count NAV directive tokens as words but must not strip them during truncation — if truncation falls on a `[NAV:tab_N]` token, preserve the directive by truncating one sentence earlier.

The only shared field between PACE-01 and LIVE-01 in the section object is the `segments` array of `TrainingScript`. PACE-01 changes the TEACH segment word budget. LIVE-01 changes how the index embedded in the TEACH segment is used at runtime. These changes are additive and do not conflict, provided LIVE-01 reads `section_index` from the TEACH content rather than deriving it from the tab count — which is what the `[NAV:tab_N]` directive approach already does.

No schema alignment meeting between PACE-01 and LIVE-01 is required. The shared interface is `ScriptSegment.content: string`. Both features write to / read from the `content` field without introducing conflicting structure.

---

## 11. Open Questions

All five questions from the CEO brief are resolved below. No questions remain open.

**CEO Q1: How does the 140-word budget interact with the existing script generation prompt?**

The existing prompt in `generateScriptAndVisualization()` (line 488, `script-generator.ts`) uses:
```typescript
const wordsPerSubtopic = Math.round((durationMins * 140) / totalSubtopics)
```
This is replaced with the constant `140`. The prompt instruction changes from "approximately N words" to "exactly 140 words — hard limit." The `duration_seconds` hint in the JSON template changes from the dynamic calculation to the fixed value `60`. The same change applies to `generateTrainingScript()` (legacy path) where the TEACH instruction currently targets 600–840 words — this is replaced with the 140-word instruction. Full details in FR-05 and Section 8.

**CEO Q2: What is the DB representation of the "context anchor" arc role for Section 1?**

There is no new database field. Arc role is enforced entirely in the LLM prompt (FR-06). Section 1's arc role is implicit in its position (first in the ordered `sub_sessions` array) and in the prompt instructions that govern what its content must be. No migration is required.

**CEO Q3: For the section count formula, what is the minimum session duration that produces at least 2 sections?**

The formula `floor((durationMins - 2) / 2) >= 2` is first satisfied at `durationMins = 6` (gives exactly 2). Sessions of 3, 4, or 5 minutes produce 0 or 1 from the formula and are overridden to 2 by the `Math.max(2, ...)` guard. The minimum session duration in the schema is 3 minutes. A 3-minute session produces `floor((3-2)/2) = 0` → overridden to 2. There is no supported session duration that produces fewer than 2 sections after the guard is applied.

**CEO Q4: How does `depth_level = 'foundation'` get enforced in the enrichment step?**

The term `'foundation'` does not exist in the codebase. The existing type system uses `'beginner' | 'intermediate' | 'advanced'` (enforced by Zod in `SessionSchema` and `EnrichmentInput`). The curriculum planner already assigns `depth_level: 'beginner'` to arc_position-1 sessions (lines 379, 389 in `planner.ts`). The enrichment LLM classifies these as `L1_foundation` by layer tag. PACE-01 does not add a new enum value or DB column. The foundation framing instruction is implemented as a prompt addition to `designFromPreplannedSubtopics()` (FR-07) and as the Section Structure Rules prompt addition to `generateSessionContentOutline()` (FR-06). It is prompt-only and DB-value-free.

**CEO Q5: What cache invalidation is needed when this ships? Which sessions need to be re-generated, and in what order?**

All rows in `topic_content_cache` with `pipeline_status = 'ready'` must be reset to `'pending'` via the SQL in FR-08. This covers all users and all sessions universally — there is no filtering by user or topic. The order of regeneration is determined by the `session_content_cron` Inngest job, which processes sessions as users launch them. No manual per-session re-triggering is required. The invalidation SQL must be run after SESS-06 is merged and its migration applied, not before (see Section 12 for the exact gate).

---

## 12. Dependencies and Build Order

### Dependency 1 — SESS-06 (blocking, must ship first)

SESS-06 fixes the wiring between `curriculum_plans.visible_sessions[n].subtopics` and `sessions.sub_sessions`. Until SESS-06 ships:

- `sessions.sub_sessions` for many sessions is null or contains generic subtopics ("Core concepts", "Real-world application", "Key takeaways")
- If the PACE-01 section count formula is applied now, it would compute a new `sectionCount` but the subtopic source material would be wrong
- If the cache is invalidated now and sessions regenerate, they regenerate with the wrong subtopics

Gate: PACE-01 cache invalidation SQL (FR-08) must not be run until:
1. SESS-06 code is merged to main
2. SESS-06 migration (no new migration required per SESS-06 spec) is verified live
3. The backfill endpoint `POST /api/admin/backfill-sub-sessions` has been run and confirmed (response shows `repaired: N, skipped: 0, errors: []`)

PACE-01 code changes (the formula, the prompts, the word budget) can be written and merged before SESS-06, but the cache invalidation SQL must not run until SESS-06 is confirmed live.

### Dependency 2 — LIVE-01 (coordinate, not blocking)

LIVE-01 (visualization desync fix) is not a blocker for PACE-01 code changes. However:

- Both features touch `lib/content/script-generator.ts` and specifically the `TrainingScript.segments` array
- LIVE-01 will modify how `[NAV:tab_N]` directives are interpreted at runtime
- PACE-01 changes the TEACH word budget and the prompt that generates TEACH content

Coordination requirement: The developer implementing PACE-01 must confirm with the LIVE-01 developer that the `[NAV:tab_N]` directives in the TEACH content are preserved by the 140-word truncation guard. Specifically: the truncation guard added in `processSubtopic()` must not remove a `[NAV:tab_N]` token even if truncation falls at that word position. The rule is: truncate at the last sentence boundary at or before word 140, where sentence boundary means a period or question mark character, and NAV directives embedded mid-sentence are treated as non-removable anchors.

If LIVE-01 ships before PACE-01: no conflict. The `[NAV:tab_N]` directives are already in the prompts and PACE-01 leaves them in place.
If PACE-01 ships before LIVE-01: no conflict. The word budget change does not affect how `WalkthroughClient.tsx` currently resolves tabs.
If both ship in the same deploy: review the truncation guard together before merging.

### Dependency 3 — `lib/curriculum/planner.ts` subtopic count update

The curriculum planner prompt must generate at least `sectionCount` subtopics per topic arc. This change is within PACE-01 scope (see Edge Cases, first item). The developer must update `lib/curriculum/planner.ts` to pass the computed `sectionCount` into the prompt instruction for minimum subtopics per session. This is a prompt change only, no schema change.

### Build order within PACE-01

1. Update `lib/curriculum/session-designer.ts` — formula and fallback
2. Update `lib/curriculum/planner.ts` — subtopic count instruction
3. Update `lib/content/session-content-generator.ts` — Section Structure Rules prompt
4. Update `lib/content/script-generator.ts` — 140-word TEACH budget
5. Update `inngest/session-content-async.ts` — post-generation word count guard
6. Write and verify all acceptance criteria (AC-01 through AC-14)
7. Merge SESS-06 and run backfill (prerequisite gate)
8. Run cache invalidation SQL in Supabase production
9. Monitor first regenerated sessions to confirm 6 tabs on 15-minute sessions and 140-word TEACH segments
