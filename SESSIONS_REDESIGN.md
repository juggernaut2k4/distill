# Sessions Redesign — Subtopic-Driven Duration & Topic-Grouped Sessions

**Decision date:** 2026-06-01  
**Owner:** Arun  
**Status:** Ready to build

---

## The Core Insight

A topic's duration and session count must be derived from the number of subtopics the LLM
decides it needs — not guessed arbitrarily. Every session is 15 minutes: 10 min of content
+ 5 min Q&A / transition.

**Duration formula:**
```
sessions_needed  = ceil(subtopic_count / 4)   # ~4 subtopics fit in 10 min
topic_duration   = sessions_needed × 15 min
```

Simple example:
- Topic has 4 subtopics → 1 session → 15 min shown in plan
- Topic has 7 subtopics → 2 sessions → 30 min shown in plan
- Topic has 11 subtopics → 3 sessions → 45 min shown in plan

---

## The 10-Minute Rule

Each session delivers 10 minutes of teaching content. 5 minutes are reserved for:
- Answering questions
- Recapping the key point
- Previewing the next session

Scripts and talking points are written for 10 min only. The session is presented to the user
as 15 min (so they plan accordingly), but Clio speaks for 10 min.

---

## Stories

---

### PLAN-001 — Curriculum planner LLM produces subtopics

**What changes:** `lib/curriculum/planner.ts`

Currently the LLM outputs sessions with `estimated_minutes: 15 | 20 | 25 | 30`.  
New: the LLM outputs sessions with `subtopics: string[]` and we compute `estimated_minutes`.

**Zod schema change:**
```typescript
// Before
estimated_minutes: z.number().int().refine((v) => [15, 20, 25, 30].includes(v))

// After
subtopics: z.array(z.string().min(3).max(200)).min(1).max(20),
// estimated_minutes removed from LLM output — computed after parsing:
// estimated_minutes = Math.ceil(subtopics.length / 4) * 15
```

**System prompt changes:**
- Remove: "ESTIMATED MINUTES RULES: Only use values 15, 20, 25, or 30"
- Add: "SUBTOPICS RULES: For each session, list every subtopic the user must understand to
  truly grasp this topic. There is no minimum or maximum — use as many as the topic requires.
  Simple concepts may need 2-3 subtopics. Complex strategic topics may need 8-12. Write each
  subtopic as a clear, specific learning point the user will understand after this section.
  Do NOT add subtopics just to pad — only include what genuinely matters."

**After parsing:**
```typescript
// Compute estimated_minutes from subtopic count
const sessionsNeeded = Math.ceil(session.subtopics.length / 4)
const estimatedMinutes = sessionsNeeded * 15
return { ...session, estimated_minutes: estimatedMinutes }
```

**Acceptance criteria:**
- [ ] Curriculum plan JSON includes `subtopics: string[]` per session
- [ ] `estimated_minutes` is always a multiple of 15
- [ ] Duration matches `ceil(subtopics.length / 4) × 15`
- [ ] Plan page shows 15, 30, 45 — never 20 or 25

---

### PLAN-002 — Session designer splits pre-planned subtopics into 15-min sessions

**What changes:** `lib/curriculum/session-designer.ts`, `app/api/plan/approve/route.ts`

Currently the session designer LLM invents subtopics from scratch using title + focus.  
New: it receives the pre-planned subtopics and groups them into 10-min sessions.

**`CurriculumTopicInput` interface:**
```typescript
export interface CurriculumTopicInput {
  session_id:        string
  title:             string
  focus:             string
  depth_level:       string
  estimated_minutes: number
  subtopics:         string[]   // ADD THIS — pre-planned by curriculum LLM
}
```

**New session designer logic:**
1. Receive `subtopics: string[]` (the full list for this topic)
2. Split into groups of 4: `chunk(subtopics, 4)`
3. For each group, call LLM to:
   - Write a specific session title for this chunk of subtopics
   - Add `type`, `duration_mins`, `learning_objective` per subtopic
   - Confirm session fits in 10 min of content
4. Return one `DesignedSession` per chunk

**LLM prompt update:**
```
You are designing a 15-minute learning session (10 min content + 5 min Q&A).

Topic: "${topic.title}"
Subtopics to cover in THIS session:
${subtopicChunk.map((s, i) => `${i+1}. ${s}`).join('\n')}

Rules:
1. Write a specific session title that names exactly what this chunk covers
2. Each subtopic gets ~2-3 minutes of content (total = 10 min)
3. Add a concise learning_objective for each subtopic
4. Assign a type: concept | example | application | pitfalls | practice | summary
5. The session is for a ${profile.role} in ${profile.industry}
```

**`approve/route.ts` change:**
```typescript
// Pass cs.subtopics to the designer
const designed = await designSessionsForTopic(
  { ...cs, subtopics: cs.subtopics ?? [] },   // pass pre-planned subtopics
  profile,
  maxMins
)
```

**Acceptance criteria:**
- [ ] Sessions are created with subtopics from the curriculum plan (not invented)
- [ ] Topic with 8 subtopics → 2 sessions of 4 subtopics each
- [ ] Each session title is specific to its chunk of subtopics
- [ ] Session duration = 15 min (10 min content)

---

### SESS-001 — Sessions screen groups sessions by source curriculum topic

**What changes:** `app/dashboard/sessions/page.tsx`, `app/dashboard/sessions/SessionsClient.tsx`

Currently: flat list split into Upcoming / Past  
New: grouped by curriculum topic, showing topic → sessions hierarchy

**Data needed on each session:**
```typescript
interface Session {
  id: string
  session_index: number
  session_title: string | null
  status: string
  duration_mins: number
  curriculum_session_id: string | null   // ADD — links to source topic
  curriculum_topic_title: string | null  // ADD — resolved from curriculum_plans
}
```

**Server component change (`page.tsx`):**
- Fetch sessions with `curriculum_session_id`
- Fetch the active curriculum plan → get `visible_sessions`
- Join: for each session, look up `curriculum_session_id` in `visible_sessions` to get topic title

**`SessionsClient.tsx` redesign:**
- Group sessions by `curriculum_session_id`
- For each group, show:
  - Topic name (from curriculum plan) as section header
  - Session count badge: "2 sessions" / "1 session"
  - Each session card under the topic

**Visual layout:**
```
Your Learning Plan
──────────────────────────────────────────────
  AI Tools for Executive Work
  ┌─────────────────────────────────────────┐
  │ Anthropic Claude for Work    2 sessions │
  │   Session 3: Why Claude Thinks...  15m  │
  │   Session 4: Longer Context...     15m  │
  ├─────────────────────────────────────────┤
  │ Your AI Toolkit              1 session  │
  │   Session 1: Claude and ChatGPT... 15m  │
  └─────────────────────────────────────────┘
```

- Sessions without a `curriculum_session_id` (old sessions) → "Other Sessions" group
- Keep "Upcoming" / "Past" split within each topic group, or remove if confusing

**Acceptance criteria:**
- [ ] Sessions screen shows topics as section headers
- [ ] Each topic shows session count badge
- [ ] Sessions are listed under their source topic
- [ ] Clicking a session navigates to `/dashboard/sessions/{uuid}`
- [ ] Old sessions without curriculum link fall into "Other" group

---

### PLAN-003 — Plan screen shows subtopics under each topic card

**What changes:** `components/plan/SessionCard.tsx`, `app/dashboard/plan/PlanClient.tsx`

Currently: session cards show title, focus, duration (~15 min, ~20 min), depth badge.  
New: duration is always a multiple of 15. Optionally: expandable subtopic list.

**Minimal change (duration fix):**
- If `session.estimated_minutes` is computed correctly by PLAN-001, the plan screen
  already shows the right number — no extra code needed here.

**Optional enhancement (subtopic list):**
- Add a collapsible "subtopics" section under each session card
- Shows the list of subtopics as bullet points
- Collapsed by default; expand on click

**Acceptance criteria:**
- [ ] Plan screen never shows 20 or 25 min — only 15, 30, 45, 60
- [ ] Duration matches the session count for that topic × 15

---

## Build Order

1. **PLAN-001** first — this is the data source everything else depends on
2. **PLAN-002** next — session designer must receive the subtopics from PLAN-001
3. **SESS-001** next — sessions screen can only group correctly once sessions have `curriculum_session_id` (already exists) and topic titles are resolved
4. **PLAN-003** last — purely cosmetic, can ship independently

## Files touched

| File | Story | Change |
|------|-------|--------|
| `lib/curriculum/planner.ts` | PLAN-001 | Add subtopics to schema + prompt, compute duration |
| `lib/curriculum/session-designer.ts` | PLAN-002 | Accept + split pre-planned subtopics |
| `app/api/plan/approve/route.ts` | PLAN-002 | Pass cs.subtopics to designer |
| `app/dashboard/sessions/page.tsx` | SESS-001 | Fetch curriculum plan for topic titles |
| `app/dashboard/sessions/SessionsClient.tsx` | SESS-001 | Group by topic |
| `components/plan/SessionCard.tsx` | PLAN-003 | Optional subtopic list |
