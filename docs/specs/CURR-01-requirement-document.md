# CURR-01 — Content-First Session Architecture
## Requirement Document

Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-26

---

## 1. Feature Summary

This feature changes how Clio divides a learning topic into sessions. Today the planner LLM generates arcs, sessions, and subtopics in a single pass. This forces the subtopic count to be determined before the LLM has established how many subtopics the topic actually requires for complete coverage. The result is silent content loss: subtopics that do not fit the per-session formula are never generated and never appear in any session.

CURR-01 separates subtopic enumeration from session division into two distinct steps. In Step 1, the planner LLM produces one flat `comprehensive_subtopics` list per arc — every subtopic needed for complete understanding, with no session boundaries and no artificial cap. In Step 2, a new pure-code function `organizeSubtopicsIntoSessions` divides that flat list into sessions based on the user's preferred session duration. Session count becomes a function of content, not of a formula. Every subtopic the LLM identifies is guaranteed to appear in exactly one session.

Three pre-existing bugs are fixed as part of this change: an incorrect `estimated_minutes` formula that derives session duration from subtopic count rather than user preference, a Zod schema cap of `max(6)` subtopics that silently truncates 30-minute sessions, and a generic "executive learning platform" prompt framing in the session-designer that ignores the user's `roleLevel`.

---

## 2. Background and Motivation

### Current flow

1. `generateCurriculumPlan()` in `lib/curriculum/planner.ts` calls the Anthropic API with a system prompt that instructs the LLM to generate `arcs[] → sessions[] → subtopics: string[]` in a single response.
2. The prompt's `SUBTOPICS RULES` section instructs: "For a 15-minute session: at least 6 subtopics. For a 30-minute session: at least 14 subtopics." The per-session count is baked into the LLM instruction.
3. After the LLM responds, `estimated_minutes` is computed as `Math.ceil(subtopics.length / 4) * 15` — a formula that derives duration from subtopic count.
4. The approve route calls `designSessionsForTopic()` in `lib/curriculum/session-designer.ts`.
5. Inside `designFromPreplannedSubtopics()`, the code calls `chunkArray(subtopics, sectionCount)` where `sectionCount = Math.max(2, Math.floor((maxMins - 2) / 2))`, then iterates over chunks and makes one LLM call per chunk.
6. `DesignedSessionSchema` caps subtopics at `max(6)`, which means any 30-minute session (which should have 14 subtopics) fails Zod validation silently.

### Where it breaks — the silent drop

The planner LLM is asked to answer two questions simultaneously: "What does this arc need for complete coverage?" and "How many subtopics fit in this session duration?" These are different questions with different answers. When the LLM tries to satisfy both at once, it anchors on the per-session count instruction and stops enumerating once each session is filled — even if the arc genuinely requires more coverage.

Concrete example: a developer user selects "How Claude Works." The topic warrants 40 subtopics for thorough coverage. The planner generates 6 sessions of 6 subtopics each — 36 total. The remaining 4 subtopics (covering rate limits, batching strategies, error handling patterns, and streaming vs. synchronous API behaviour) are never generated. They do not appear in any session, are not flagged as deferred, and are invisible to the user. The user completes all 6 sessions and walks away with an incomplete understanding of the topic. Nothing in the system signals that content was dropped.

### Why this matters

Users who complete a plan and feel the coverage was shallow do not re-subscribe. The product's core promise — "complete confidence in the topic you selected" — is broken when content is dropped silently. CURR-01 makes session count an honest reflection of what the topic requires.

### Bug inventory (fixed as part of this spec)

**Bug A** — `estimated_minutes = Math.ceil(subtopics.length / 4) * 15`
This formula derives session duration from subtopic count. After CURR-01, the session organizer derives subtopic count from session duration. The formula now produces nonsense: 10 subtopics → 30 mins, but the user prefers 15-min sessions. Fix: derive `duration_mins` directly from `PlannedSession.duration_mins` which is computed from `sessionMins`.

**Bug B** — `DesignedSessionSchema` caps `subtopics` at `max(6)`
A 30-minute session with 14 pre-allocated subtopics fails Zod validation. The LLM call in `designFromPreplannedSubtopics` returns 14 subtopic objects; the schema silently rejects or truncates to 6. Fix: raise cap to `max(30)`.

**Bug C** — Session-designer prompt opens with "You are a curriculum designer for an executive learning platform"
A specialist user (software engineer, developer) receives executive framing for practitioner-level content. The prompt does not use the `roleLevel` value that is available in the calling code. Fix: inject `roleLevel` into the session-designer prompt using the same instruction map already defined in `planner.ts`.

---

## 3. User Stories

**US-01:** As a developer learning "How Claude Works," I want all subtopics covered across as many sessions as the content requires, so that I do not finish the curriculum with gaps in my understanding of topics the topic actually needed to address.

**US-02:** As a user who prefers 30-minute sessions, I want sessions to be fully packed with the correct number of subtopics for that duration — and if an arc's remaining subtopics are too few to fill a complete 30-minute session, I want them combined with the next arc's opening subtopics rather than wasted in a near-empty session.

**US-03:** As a user who prefers 15-minute sessions, I want the number of sessions in my plan to be automatically calculated from the total subtopics the topic requires, so I learn everything at my preferred pace without any content being silently dropped.

**US-04:** As a specialist or developer user, I want the session content framed for a technical practitioner — not for a senior business executive — so that the examples and vocabulary match how I actually work.

---

## 4. Functional Requirements

**FR-01:** The planner LLM produces `comprehensive_subtopics: string[]` per arc — a flat, ordered list of all subtopics needed for complete understanding of that arc. The LLM does not divide subtopics into sessions.

**FR-02:** `comprehensive_subtopics` contains ALL subtopics the LLM determines are necessary for complete coverage of the arc. No artificial minimum or maximum is imposed by the prompt. The Zod schema ceiling of `max(100)` is a safety guard only, not a target or expectation.

**FR-03:** Subtopics within each arc are ordered: context anchor first (why this arc matters for the user's specific role), core concepts in dependency order in the middle (each concept assumes the previous one is understood), practical action last (one thing the user can do or decide differently after this arc).

**FR-04:** `organizeSubtopicsIntoSessions(arcs, sessionMins)` is a pure TypeScript function — no async operations, no LLM calls, no external dependencies. It lives in `lib/curriculum/session-organizer.ts`.

**FR-05:** `subtopicsPerSession = Math.max(2, Math.floor((sessionMins - 2) / 2))`. For 15-minute sessions: 6. For 30-minute sessions: 14. For 5-minute sessions: 2 (the enforced minimum).

**FR-06:** Sessions within an arc are formed by taking complete chunks of `subtopicsPerSession` from the arc's `comprehensive_subtopics` list, in order. Each complete chunk becomes one session of full duration.

**FR-07 — Cross-arc packing rule:** If the remainder of an arc's subtopics after all complete chunks has fewer than `Math.ceil(subtopicsPerSession / 2)` items, those subtopics carry over and are prepended to the first subtopics of the next arc to fill one combined session. That session carries both arc names (`arc_names: [arcA.arc_name, arcB.arc_name]`) and `is_cross_arc: true`.

**FR-08:** If the remainder of an arc's subtopics has at least `Math.ceil(subtopicsPerSession / 2)` items, those subtopics form their own shorter session. `tab_count` equals the remainder count. The session is not padded with empty or placeholder subtopics. This is a valid shorter session.

**FR-09 — No drops guarantee:** The total number of subtopics across all output `PlannedSession[]` objects must equal the total number of subtopics across all input arc `comprehensive_subtopics` arrays. Every input subtopic appears in exactly one output session.

**FR-10:** Each session's `duration_mins` is derived from its actual subtopic count: `Math.max(5, Math.round((subtopics.length / subtopicsPerSession) * sessionMins / 5) * 5)`. Full sessions receive exactly `sessionMins`. Shorter sessions (remainder sessions per FR-08) receive a proportional duration rounded to the nearest 5 minutes, minimum 5 minutes.

**FR-11:** `DesignedSessionSchema` in `lib/curriculum/session-designer.ts` raises the subtopics array cap from `max(6)` to `max(30)`.

**FR-12:** The session-designer prompt opening is dynamically set based on `roleLevel`, using the same framing labels already defined in `planner.ts`. The literal string "You are a curriculum designer for an executive learning platform" is removed.

**FR-13:** `designFromPreplannedSubtopics()` receives a single `PlannedSession`'s pre-allocated subtopics and makes exactly one LLM call per invocation. The `chunkArray` call and the `for (const chunk of chunks)` loop are removed. One `PlannedSession` in — one `DesignedSession` out.

**FR-14:** `buildFallbackPlan()` is updated to produce arcs with `comprehensive_subtopics[]` rather than `sessions[{ subtopics[] }]`, so the fallback is compatible with the new organizer without a separate code path.

**FR-15:** The session organizer only processes arcs where `is_visible: true`. Queue arcs (where `is_visible: false`) remain as arc-level entries; no sessions are generated for them until they are unlocked.

---

## 5. Data Model Changes

### 5a. New ArcSchema (planner output — replaces current ArcSchema in `lib/curriculum/planner.ts`)

```typescript
export const ArcSchema = z.object({
  arc_name:                z.string().min(1).max(100),
  arc_type:                z.enum(['domain', 'integrated', 'singleton']),
  arc_description:         z.string().min(10).max(1000),
  comprehensive_subtopics: z.array(z.string().min(3).max(1000)).min(1).max(100),
  is_visible:              z.boolean(),
  queue_rationale:         z.string().max(2000).nullable(),
})
```

The `sessions` array is removed from `ArcSchema`. Fields previously embedded in `SessionSchema` (`session_id`, `title`, `focus`, `arc_position`, `arc_length`, `depth_level`, `role_hint`) are removed from the planner output. They are produced by the session-designer after the organizer runs.

`SessionSchema` is retained for the `generateQueueExtension` function, which still produces individual session objects for queue extension calls. That function is not changed in this spec.

### 5b. New `CurriculumOutputSchema` field

```typescript
export const CurriculumOutputSchema = z.object({
  arcs:               z.array(ArcSchema).min(1).max(10),
  total_visible:      z.number().int().min(0).max(10),  // now = count of visible arcs
  total_queued:       z.number().int().min(0).max(50),  // now = count of queued arcs
  generated_at:       z.string(),
  user_profile_hash:  z.string().optional().default(''),
  schema_version:     z.literal('v2').default('v2'),    // NEW — used by approve route
})
```

`schema_version: 'v2'` allows the approve route to detect which shape a stored `raw_llm_output` uses, enabling the old path to keep working for existing approved plans.

### 5c. `PlannedSession` type (output of session organizer — new file)

```typescript
// lib/curriculum/session-organizer.ts
export type PlannedSession = {
  session_index: number    // 0-based, global across all arcs
  arc_names:     string[]  // 1 arc normally; 2 when is_cross_arc is true
  subtopics:     string[]  // the exact subtopics allocated to this session
  duration_mins: number    // actual minutes (rounded to nearest 5, minimum 5)
  tab_count:     number    // equals subtopics.length
  is_cross_arc:  boolean   // true when subtopics span 2 arcs
}
```

### 5d. `DesignedSessionSchema` change

```typescript
// lib/curriculum/session-designer.ts
const DesignedSessionSchema = z.object({
  session_title:   z.string().min(5).max(200),
  session_summary: z.string().min(10).max(1000),
  duration_mins:   z.number().int().min(3).max(60),
  subtopics:       z.array(SubtopicSchema).min(1).max(30),  // was max(6)
})
```

### 5e. Sessions table — no new columns required

`sessions.duration_mins` already exists. Its value will now be populated from `PlannedSession.duration_mins` rather than from the old `estimated_minutes` formula. No migration is required.

### 5f. Backward compatibility — existing plans

Existing plans store the old schema in `curriculum_plans.raw_llm_output` (JSONB). Those plans have no `schema_version` field. The approve route detects the absence of `schema_version: 'v2'` and uses the existing `visible_sessions` code path unchanged. No existing plans are affected.

---

## 6. Algorithm Specification

Full pseudocode for `organizeSubtopicsIntoSessions`:

```
function organizeSubtopicsIntoSessions(
  arcs: Array<{ arc_name: string; comprehensive_subtopics: string[]; is_visible: boolean }>,
  sessionMins: number
): PlannedSession[]

  subtopicsPerSession = max(2, floor((sessionMins - 2) / 2))
  halfSession         = ceil(subtopicsPerSession / 2)
  result              = []
  sessionIndex        = 0
  carryOver           = { subtopics: [], arc_names: [] }

  for each arc in arcs where arc.is_visible === true:

    // Merge carry-over from previous arc with this arc's subtopics
    pool         = [...carryOver.subtopics, ...arc.comprehensive_subtopics]
    poolArcNames = deduplicatePreserveOrder([...carryOver.arc_names, arc.arc_name])
    carryOver    = { subtopics: [], arc_names: [] }

    // Emit full-size sessions
    while pool.length >= subtopicsPerSession:
      chunk      = pool.splice(0, subtopicsPerSession)
      isCrossArc = poolArcNames.length > 1
      result.push({
        session_index: sessionIndex++,
        arc_names:     isCrossArc ? poolArcNames : [arc.arc_name],
        subtopics:     chunk,
        duration_mins: sessionMins,
        tab_count:     chunk.length,
        is_cross_arc:  isCrossArc,
      })
      // After the first full chunk is emitted, all remaining pool items are
      // from the current arc only — reset poolArcNames
      poolArcNames = [arc.arc_name]

    // Handle remainder (pool.length is now 0 to subtopicsPerSession-1)
    if pool.length === 0:
      continue

    else if pool.length >= halfSession:
      // Large enough for its own shorter session
      isCrossArc = poolArcNames.length > 1
      result.push({
        session_index: sessionIndex++,
        arc_names:     poolArcNames,
        subtopics:     pool,
        duration_mins: roundToNearest5(pool.length * sessionMins / subtopicsPerSession),
        tab_count:     pool.length,
        is_cross_arc:  isCrossArc,
      })

    else:
      // Too small — carry over into next arc
      carryOver = { subtopics: pool, arc_names: poolArcNames }

  // Flush remaining carry-over after the last visible arc
  if carryOver.subtopics.length > 0:
    result.push({
      session_index: sessionIndex++,
      arc_names:     carryOver.arc_names,
      subtopics:     carryOver.subtopics,
      duration_mins: roundToNearest5(carryOver.subtopics.length * sessionMins / subtopicsPerSession),
      tab_count:     carryOver.subtopics.length,
      is_cross_arc:  carryOver.arc_names.length > 1,
    })

  return result

helper: roundToNearest5(n: number): number
  return Math.max(5, Math.round(n / 5) * 5)

helper: deduplicatePreserveOrder(names: string[]): string[]
  return [...new Set(names)]
```

### Worked example A — 15-minute sessions (subtopicsPerSession = 6, halfSession = 3)

Arc A: 16 subtopics. Arc B: 9 subtopics.

- Arc A chunks: A[1-6] → Session 0 (15 min); A[7-12] → Session 1 (15 min)
- Arc A remainder: A[13-16] = 4 items. 4 >= halfSession (3) → own shorter session → Session 2 (duration: roundToNearest5(4/6 * 15) = roundToNearest5(10) = 10 min)
- Arc B: pool = B[1-9]. Full chunk: B[1-6] → Session 3 (15 min). Remainder: B[7-9] = 3 items. 3 >= halfSession (3) → own shorter session → Session 4 (duration: roundToNearest5(3/6 * 15) = roundToNearest5(7.5) = 10 min)
- Output: 5 sessions. Total subtopics in: 25. Total subtopics out: 6+6+4+6+3 = 25. Nothing dropped.

### Worked example B — 30-minute sessions (subtopicsPerSession = 14, halfSession = 7)

Arc A: 18 subtopics. Arc B: 5 subtopics.

- Arc A chunks: A[1-14] → Session 0 (30 min)
- Arc A remainder: A[15-18] = 4 items. 4 < halfSession (7) → carry over
- carryOver = { subtopics: A[15-18], arc_names: ['Arc A'] }
- Arc B: pool = [A-15, A-16, A-17, A-18, B-1, B-2, B-3, B-4, B-5] = 9 items. 9 < subtopicsPerSession (14) → check remainder. 9 >= halfSession (7) → own shorter session → Session 1 (duration: roundToNearest5(9/14 * 30) = roundToNearest5(19.3) = 20 min), arc_names: ['Arc A', 'Arc B'], is_cross_arc: true
- Output: 2 sessions. Total subtopics in: 23. Total subtopics out: 14+9 = 23. Nothing dropped.

---

## 7. Updated Planner Prompt Instructions

The following changes are made to `buildSystemPrompt()` in `lib/curriculum/planner.ts`.

### Remove entirely

The entire `SUBTOPICS RULES` section:
```
SUBTOPICS RULES:
- For each session, generate enough subtopics to fill the session duration at 2 minutes per subtopic.
  For a 15-minute session: at least 6 subtopics. For a 30-minute session: at least 14 subtopics.
  Minimum 2 subtopics per session regardless of duration.
  Formula: floor((session_duration_mins - 2) / 2), minimum 2.
- Write each subtopic as a specific, concrete learning point (not a vague category name).
...
```

The entire `SUBTOPIC ORDERING` section:
```
SUBTOPIC ORDERING (within each session):
Order subtopics from most foundational to most advanced...
```

All JSON output example instructions that reference `sessions[].subtopics` within arc objects.

### Add — ARC SUBTOPICS instruction block

Replace the above with the following instruction, placed where `SUBTOPICS RULES` previously appeared:

```
ARC SUBTOPICS:
For each arc, generate a COMPREHENSIVE list of ALL sub-topics the learner needs to understand
this arc completely. Do NOT divide sub-topics by session — session division happens automatically
after you respond. Do NOT cap, limit, or pad the sub-topic count artificially.

Every sub-topic that earns its place must appear. A sub-topic earns its place if skipping it
would leave the learner with a gap in their understanding of this arc.

Typical arc subtopic counts:
- A focused, single-concept arc: 8–12 sub-topics
- A broad, multi-concept arc: 20–35 sub-topics
There is no required count. Coverage completeness is the only criterion.

SUBTOPIC ORDERING within each arc:
Order sub-topics from most foundational to most advanced so the learner can follow them
in sequence without back-referencing. Follow this structure:

1. Context anchor (always first): why this arc matters specifically to this user's role.
   Do NOT open with a definition or the topic name. Open with: "Here is the decision or
   pressure you face right now as a [role] that makes this arc immediately relevant."
   Connect to something the user already knows or a situation they currently face.

2. Core concepts (middle sub-topics): one concept per sub-topic, in dependency order.
   Each sub-topic should assume the previous one is understood. Earlier sub-topics unlock later ones.

3. Practical action (always last): one specific thing the user can do or decide differently
   after completing this arc. Name it explicitly. Connect it to their role and industry.

SUBTOPIC FORMAT:
Write each sub-topic as a specific, concrete learning point — not a vague category name.
Bad:  "Overview of Claude"
Good: "How to choose between claude-haiku-4-5 and claude-sonnet-4-6 based on latency and
       cost requirements for your team's production use case"

Do NOT pad with sub-topics that are not genuinely needed. Every sub-topic must earn its place.
```

### Updated JSON output shape

The JSON example in the prompt must be updated. Each arc object changes from:
```json
{
  "arc_name": "string",
  "arc_type": "domain" | "integrated" | "singleton",
  "sessions": [ { "session_id": "...", "subtopics": [...] } ]
}
```

To:
```json
{
  "arc_name": "string",
  "arc_type": "domain" | "integrated" | "singleton",
  "arc_description": "string — one sentence: what this arc teaches and why it matters for this user",
  "comprehensive_subtopics": ["string", "string", "..."],
  "is_visible": true | false,
  "queue_rationale": "string | null"
}
```

`total_visible` and `total_queued` in the output now refer to arc counts (arcs where `is_visible` is true or false), not session counts. The prompt must state this explicitly.

---

## 8. Session-Designer Prompt Update

### Function signature change

`designFromPreplannedSubtopics()` gains a `roleLevel: string` parameter:

```typescript
async function designFromPreplannedSubtopics(
  topic:     CurriculumTopicInput,
  profile:   DesignerUserProfile,
  maxMins:   number,
  apiKey:    string,
  roleLevel: string,
): Promise<DesignedSession[]>
```

`designSessionsForTopic()` (the public export) must also accept and pass through `roleLevel`.

### Prompt opening — dynamic framing map

Remove:
```
You are a curriculum designer for an executive learning platform.
```

Replace with a lookup from this map (build this as a `const` in the function):

```typescript
const designerFraming: Record<string, string> = {
  'c-suite':
    'You are a curriculum designer for senior business executives — C-Suite leaders who own P&L and are accountable to the board.',
  'vp-dir':
    'You are a curriculum designer for senior functional leaders — VPs and Directors who lead a function and report to C-Suite.',
  'vp-technology':
    'You are a curriculum designer for engineering leaders and technology decision-makers — VPs of Technology who own engineering team adoption, infrastructure decisions, and AI vendor evaluation.',
  'vp-product':
    'You are a curriculum designer for product leaders — VPs of Product who own AI-assisted feature strategy and competitive differentiation through AI capability.',
  'manager':
    'You are a curriculum designer for managers and team leads who implement AI tools day-to-day and manage teams doing the same.',
  'specialist':
    'You are a curriculum designer for software engineers, developers, and technical practitioners who use AI tools directly in their work.',
}
const framingOpener = designerFraming[roleLevel] ?? 'You are a curriculum designer for working professionals.'
```

### Duration line update

Change:
```
Design ONE 15-minute learning session (10 minutes of content + 5 minutes reserved for Q&A).
```

To:
```
Design ONE learning session (${maxMins} minutes of content).
```

### Chunking removal

Remove:
- The call to `chunkArray(subtopics, sectionCount)` 
- The `const sectionCount = Math.max(2, Math.floor((maxMins - 2) / 2))` line at the top of `designFromPreplannedSubtopics`
- The `for (const chunk of chunks)` loop and everything inside it that iterates per-chunk

The function body simplifies to: receive `topic.subtopics` (already pre-allocated by the organizer), build one prompt, make one LLM call, return one `DesignedSession`. The subtopic list passed to the LLM is `topic.subtopics` directly — not a chunk of it.

### Fallback path

`buildFallbackSessions()` is called when the LLM fails after 3 attempts. The call passes `topic.subtopics` and `maxMins`. The fallback does not need to change — it already generates a session from the subtopics it receives. The chunk-index reference in the fallback call (`chunks.indexOf(chunk) + 1`) is removed along with the chunk loop.

---

## 9. Edge Cases

**EC-01 — Arc with 0 comprehensive_subtopics:** Skip the arc entirely. Log a warning: `[session-organizer] arc "${arc.arc_name}" has 0 comprehensive_subtopics — skipped`. Do not push any session for it. Do not add it to carryOver.

**EC-02 — quick_wins preference (5-minute sessions):** `subtopicsPerSession = max(2, floor((5-2)/2)) = max(2,1) = 2`. `halfSession = ceil(2/2) = 1`. Sessions have exactly 2 subtopics each. Remainders of 1 subtopic always carry over (1 < halfSession of 1 is false; 1 >= 1 is true — own shorter session of 1 subtopic). This produces many short sessions. This is correct behaviour for this preference.

**EC-03 — Single arc with exactly 1 subtopic:** `pool = [subtopic1]`. Full chunk loop does not fire (1 < 2 = subtopicsPerSession for quick_wins; for 15-min, 1 < 6). Remainder: 1. For 15-min sessions, halfSession = 3. 1 < 3 → carry over. Carry-over flush after arc loop: produces 1 final session with 1 subtopic (duration: roundToNearest5(1/6 * 15) = roundToNearest5(2.5) = 5 min, enforced minimum 5). Valid output.

**EC-04 — Last arc's carry-over is the only remaining content:** The flush block after the arc loop handles this correctly. It produces one final session with whatever subtopics remain in `carryOver`. `is_cross_arc` is true if `carryOver.arc_names.length > 1`.

**EC-05 — Cross-arc session with unequal contributions from each arc:** The session receives subtopics from both arcs. `arc_names` lists both. The session-designer prompt does not reference arc names in its content framing — it uses `topic.title` and the user profile. No arc-specific framing is injected that would produce incorrect content for a cross-arc session.

**EC-06 — Arc produces exactly `subtopicsPerSession` subtopics:** One full chunk. No remainder. No carry-over. One session produced. Valid.

**EC-07 — LLM returns >100 subtopics for one arc:** Zod validation (`max(100)`) rejects the arc. The planner catches the Zod error, truncates `comprehensive_subtopics` to the first 100 entries, logs `[planner] arc "${arc_name}" exceeded max(100) comprehensive_subtopics — truncated`, and re-validates. If re-validation passes, the truncated arc is used. If re-validation fails for another reason, the planner falls back to `buildFallbackPlan()`.

**EC-08 — Empty arcs array passed to organizer:** Return `[]`. Do not throw. No logging required.

**EC-09 — All arcs are is_visible: false:** The organizer filters to `arc.is_visible === true` only. With no visible arcs, the result is `[]`. The approve route handles this the same as today when `visible_sessions` is empty.

**EC-10 — User's `learning_goal` is null or unrecognised:** `getSessionDuration()` already returns 15 as the default. No change needed. The organizer receives `sessionMins = 15` and proceeds normally.

**EC-11 — Two consecutive arcs both produce remainders smaller than halfSession:** Arc A's remainder carries into Arc B. Arc B's pool (carryOver + Arc B subtopics) is processed normally. If Arc B itself produces a remainder smaller than halfSession, that remainder carries into Arc C. This chains correctly through any number of consecutive small-remainder arcs without special handling.

**EC-12 — Cross-arc session title passed to session-designer:** `topic.title` is set to `arc_names.join(' + ')` (e.g. "Context Windows + Prompt Engineering"). The session-designer generates a specific `session_title` in its response that reflects the actual subtopics covered. The combined label is only the input title; the LLM output overwrites it.

---

## 10. Non-Functional Requirements

**NFR-01:** `organizeSubtopicsIntoSessions` is a pure synchronous function. It must complete in under 10 milliseconds for any realistic input (up to 10 arcs × 100 subtopics = 1,000 subtopics). No async, no I/O, no external calls.

**NFR-02:** The planner LLM call must complete within the existing 180-second `AbortController` timeout. The new arc shape produces a larger JSON response (flat subtopic list per arc rather than nested session arrays), but the 8,192 max_tokens budget is sufficient for a 10-arc plan with 35 subtopics per arc (approximately 3,500–4,000 output tokens).

**NFR-03:** No new database columns are required. `PlannedSession` is an in-memory intermediate type. `sessions.duration_mins` already exists and will be populated from `PlannedSession.duration_mins`.

**NFR-04:** The new planner output is stored in `curriculum_plans.raw_llm_output` as JSONB with `schema_version: 'v2'`. Existing rows without this field continue to use the old code path. No migration is required.

**NFR-05:** Session count in the new architecture will be higher than in the old architecture for topics with many subtopics. This is expected, correct, and not capped. Plan tier limits (5 visible arcs for starter, 10 for pro/executive) apply at the arc level — they constrain which arcs are visible, not the session count per arc.

**NFR-06:** The `generateQueueExtension` function is not changed. It continues to produce individual `Session` objects with `subtopics[]` for queue extension calls. The old `SessionSchema` is retained for this purpose.

**NFR-07:** `npx tsc --noEmit` must pass with zero type errors after all changes in this spec are applied.

**NFR-08:** The enrichment pipeline (`enrichCurriculumPlan()` in `lib/curriculum/enrichment.ts`) reads from `withDuration.arcs`. After CURR-01, those arcs no longer contain `sessions[]`. The enrichment pipeline must be inspected for any reference to `arc.sessions` and updated if breakage is found. TypeScript will surface this in NFR-07.

---

## 11. Open Questions

None. All questions are resolved below.

**Q: What happens to plans already approved under the old schema?**
Existing plans are unaffected. Their `raw_llm_output` has no `schema_version: 'v2'` field. The approve route detects its absence and continues using the existing `visible_sessions` array path. No migration, no re-generation, no change to existing users' plans.

**Q: Does the visible/queued arc concept still apply?**
Yes. The planner still marks each arc as `is_visible: true` or `false`. `total_visible` and `total_queued` in the planner output now refer to arc counts. The organizer only processes visible arcs. Queue arcs remain as arc-level entries; sessions are not generated for them until an arc is unlocked by the user completing prerequisite sessions.

**Q: Is there a cap on the number of sessions a user can have?**
No hardcoded session count cap. Content determines session count. Plan tier limits (5 visible arcs for starter, 10 for pro/executive) constrain which arcs are visible; each arc generates as many sessions as its subtopics require.

**Q: Does the session-designer still get called once per session?**
Yes. After the organizer produces `PlannedSession[]`, the approve route calls `designSessionsForTopic()` once per `PlannedSession`. One `PlannedSession` in — one `DesignedSession` out. No internal chunking inside the designer.

**Q: What framing does the session-designer use for a cross-arc session?**
The session-designer prompt references `topic.title` (set to `arc_names.join(' + ')`) and the user profile. It does not reference arc names in content framing instructions. The `arc_names[]` field is metadata for the organizer and the DB record — not injected into the LLM prompt beyond being part of the session title input.

**Q: Does the enrichment pipeline need to change?**
The enrichment pipeline (`enrichCurriculumPlan()`) reads `arc.sessions[]`. After CURR-01, arcs no longer have `sessions[]` in their v2 shape. The enrichment pipeline must be updated to work with the new arc shape — it should read `arc.comprehensive_subtopics` rather than `arc.sessions[].subtopics`. This is classified as a dependency (Section 12, Dependencies), not an open question, and must be handled in the same build step as the planner change.

---

## 12. Build Order

All steps must be completed in sequence. `npx tsc --noEmit` must pass after Step 6 before any code is committed.

### Step 1 — Update `lib/curriculum/planner.ts`

**1a.** Replace `ArcSchema`: remove `sessions: z.array(SessionSchema)`. Add `arc_description: z.string().min(10).max(1000)`, `comprehensive_subtopics: z.array(z.string().min(3).max(1000)).min(1).max(100)`, `is_visible: z.boolean()`, `queue_rationale: z.string().max(2000).nullable()`.

**1b.** Update `CurriculumOutputSchema`: add `schema_version: z.literal('v2').default('v2')`. Update comments on `total_visible` and `total_queued` to note they now count arcs, not sessions.

**1c.** Update `buildSystemPrompt()`: replace the `SUBTOPICS RULES` and `SUBTOPIC ORDERING` sections with the `ARC SUBTOPICS` instruction block from Section 7. Update the JSON output example to the new arc shape.

**1d.** Update `buildFallbackPlan()`: replace the per-session subtopic arrays with a flat `comprehensive_subtopics` array per arc. The fallback arc should have the 4 template subtopics from the existing templates collapsed into a flat list. Return arcs in the v2 shape so `organizeSubtopicsIntoSessions` can process fallback output without a separate code path.

**1e.** Fix Bug A: remove `estimated_minutes: Math.ceil(s.subtopics.length / 4) * 15` from the `withDuration` map. Session duration is no longer computed in the planner — it is computed by the organizer from `PlannedSession.duration_mins`.

**1f.** Update the `Arc` type alias: `export type Arc = z.infer<typeof ArcSchema>`. All usages of `Arc` throughout the codebase that access `arc.sessions` will become TypeScript errors — find and fix all of them as part of this step.

### Step 2 — Create `lib/curriculum/session-organizer.ts` (new file)

**2a.** Export the `PlannedSession` type as specified in Section 5c.

**2b.** Export `organizeSubtopicsIntoSessions(arcs, sessionMins): PlannedSession[]` implementing the algorithm from Section 6 exactly.

**2c.** Export `subtopicsPerSessionForDuration(sessionMins: number): number` as a named helper so tests and callers can use the formula without duplicating it.

**2d.** Write JSDoc on the exported function: purpose, parameters, return shape, cross-arc packing rule, no-drops guarantee.

**2e.** No dependencies on Anthropic SDK, Supabase, or any I/O module. Only standard TypeScript.

### Step 3 — Update `lib/curriculum/session-designer.ts`

**3a.** Fix Bug B: change `DesignedSessionSchema` subtopics cap from `max(6)` to `max(30)`.

**3b.** Fix Bug C: add `roleLevel: string` parameter to `designFromPreplannedSubtopics()`. Update `designSessionsForTopic()` to accept and pass through `roleLevel`. Build the `framingOpener` string from the `designerFraming` map defined in Section 8.

**3c.** Remove the `chunkArray` call and the `for (const chunk of chunks)` loop from `designFromPreplannedSubtopics()`. The function now makes exactly one LLM call per invocation. All of `topic.subtopics` are the content for this one session.

**3d.** Update the prompt string: replace the framing opener with `framingOpener`. Replace "Design ONE 15-minute learning session" with "Design ONE learning session (${maxMins} minutes of content)."

**3e.** Remove the chunk-index reference from the fallback call at the bottom of the function (the line that referenced `chunks.indexOf(chunk) + 1` to number the fallback session).

### Step 4 — Update `app/api/plan/approve/route.ts`

**4a.** After loading `plan`, check `schema_version`:
```typescript
const rawOutput = plan.raw_llm_output as { schema_version?: string; arcs?: unknown[] } | null
const isV2 = rawOutput?.schema_version === 'v2'
```

**4b.** If `isV2`:
- Extract visible arcs from `rawOutput.arcs` (filter `is_visible === true`)
- Call `organizeSubtopicsIntoSessions(visibleArcs, maxMins)` to get `PlannedSession[]`
- For each `PlannedSession`, call `designSessionsForTopic()` with `topic.subtopics = plannedSession.subtopics`, `maxMins = plannedSession.duration_mins`, and `roleLevel` from the user record

**4c.** If not `isV2`: use the existing `visible_sessions` path unchanged.

**4d.** When inserting sessions into the DB for v2 plans:
- `duration_mins` = `PlannedSession.duration_mins`
- `session_index` = `PlannedSession.session_index + 1` (DB is 1-based)
- `session_title` = the `DesignedSession.session_title` returned by the designer
- For cross-arc sessions, set `arc_name` in the DB record to `PlannedSession.arc_names[0]` (primary arc name for display)

### Step 5 — Update `app/api/curriculum/generate/route.ts`

**5a.** Validate the planner output with the updated `CurriculumOutputSchema` (v2 schema). Store the result in `curriculum_plans.raw_llm_output` — the `schema_version: 'v2'` field will be included automatically because it is in the schema with a default.

**5b.** Update `curriculum_plans.visible_sessions`: in v2, this column should store the arc objects (arc_name, arc_description, comprehensive_subtopics, is_visible) rather than session objects. The approve route reads this column when `draftCount === 0` and builds sessions from it using the organizer.

### Step 6 — TypeScript check and enrichment pipeline

**6a.** Run `npx tsc --noEmit`. Fix all type errors before proceeding.

**6b.** Inspect `lib/curriculum/enrichment.ts` for any reference to `arc.sessions` or `session.subtopics` accessed through an arc's sessions array. Update these references to use `arc.comprehensive_subtopics` or adapt to the v2 arc shape. The TypeScript check in 6a will surface these errors.

**6c.** Confirm `npx tsc --noEmit` is clean after enrichment updates.

---

## Dependencies

The following must be true before this spec can be built:

1. **PACE-01 must be applied.** `getSessionDuration()` in `session-designer.ts` already reads `learning_goal` and returns the correct `sessionMins`. Confirmed deployed.

2. **The enrichment pipeline (`lib/curriculum/enrichment.ts`) must be inspected and updated** to work with the v2 arc shape (no `sessions[]` on arcs). This is part of Step 6 in the build order, not a pre-condition. TypeScript will surface any breakage.

3. **`generateQueueExtension` is unaffected** — it produces flat `Session[]` objects using the old `SessionSchema`. It is not changed in this build.

4. **No database migrations are required** for this spec. All changes are to TypeScript types, Zod schemas, LLM prompts, and in-memory data structures. The `sessions` and `curriculum_plans` tables already have the columns needed.
