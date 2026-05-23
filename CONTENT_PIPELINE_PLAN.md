# Content Pipeline Plan
_Created: 2026-05-23 | Owner: Arun_

---

## What Exists Today (Reuse)

| File | What it does | Reuse plan |
|---|---|---|
| `lib/templates/generator.ts` | Claude generates data for 7 template types | Extend with 5 new types |
| `lib/templates/selector.ts` | Picks template type based on subtopic | Extend selection logic |
| `lib/session-plan.ts` | Orchestrates visual generation per session | Wire new pipeline into this |
| `lib/session-ai.ts` | Claude visual spec generation for live walkthrough | Reference pattern for script gen |
| `lib/topic-cache.ts` | `getCachedSection()` / `setCachedSection()` | Reuse for all new outputs |
| `topic_content_cache` table | Stores generated template data per subtopic | Reuse — add `script` column |
| `inngest/session-plan-generator.ts` | Runs visual gen on session.scheduled event | Add content + script steps |
| `components/diagrams/FlowDiagram.tsx` | SVG-based flow renderer | Replace with React Flow versions |
| `app/api/sessions/[id]/generate-plan` | Triggers generation, polls status | Add new steps to this |

---

## Trigger Point

**When**: User clicks "Approve" on session plan  
**Where**: `SessionDetailClient.tsx` → calls `/api/plan/approve`  
**Current behaviour**: Sets `users.plan_approved = true`, sends email/SMS  
**New behaviour**: Also emits Inngest event `distill/session.content.generate` with `{ sessionId, userId }`

---

## The Full 6-Step Pipeline

### Step 0 — Template Library (One-time build, never regenerated)
Pre-built React Flow components. 12 templates total. Each is a standalone React component with typed props. These are the CANVAS — AI fills data into them later.

### Step 1 — Generate Content
- Fetch the session topic + subtopics from DB
- Query `topic_content_cache` for this user's previous sections (same topic area)
- Query `sessions` table for completed sessions (same user) to see what's already taught
- Call Claude: "Here is what has already been covered: [...]. Generate content outline for [topic] that BUILDS on this, not repeats it."
- Output: array of subtopic sections with `{ subtopic, content_summary, key_concepts[], what_references_previous[] }`

### Step 2 — Generate Training Script
- For each subtopic section from Step 1
- Call Claude with training persona: "You are a patient expert trainer. Write a training script for [subtopic] with teaching content, then stop and ask a checkpoint question, then continue."
- Script format:
  ```
  TEACH: [2-3 min of material]
  CHECKPOINT: [question to check understanding]
  PROBE: [follow-up if they don't understand]
  CONTINUE: [bridge to next concept]
  ```
- Save script to `topic_content_cache.meta.script` per subtopic

### Step 3 — Select Template
- For each subtopic, analyze the content type
- Claude or rule-based logic picks template:
  - Process with steps → StepFlow
  - A vs B comparison → ComparisonTable
  - Branching decisions → Flowchart
  - Central concept with branches → ConceptMap
  - Events in order → Timeline
  - Tree/hierarchy → Hierarchy
  - Numbers/metrics → StatsInfographic
  - New term/definition → ConceptDefinition
  - Good vs bad → ProsCons
  - Real example → CaseStudy
  - Summary → KeyTakeaway
  - FAQ → QuestionAnswer
- Save `template_type` to `topic_content_cache`

### Step 4 — Generate Template Data
- Call Claude to fill the chosen template's data schema with section content
- Each template has a strict typed data schema (see below)
- Save to `topic_content_cache.data`

### Step 5 — Render & Save to KB
- Template data in DB is rendered by the React Flow template component
- User can view from Knowledge Base
- User can give feedback → triggers regeneration of that section only

---

## Template Library — All 12 Types

### Framework: React Flow (`@xyflow/react`) + Dagre layout
- React Flow handles nodes/edges rendering
- Dagre handles automatic layout (no overlap, no manual positioning)
- Every template is fully responsive — fits any screen width
- Every template is interactive — zoom, pan, hover tooltips

### Template 1: ConceptDefinition
**Use when**: Introducing a new term or idea  
**Layout**: 3-node vertical flow — What → Why → How  
**Data schema**:
```ts
{ term: string, definition: string, why_it_matters: string, how_it_works: string, example: string }
```

### Template 2: ComparisonTable
**Use when**: Comparing 2-3 options, tools, or approaches  
**Layout**: Side-by-side nodes with a shared criteria list  
**Data schema**:
```ts
{ criteria: string[], options: { name: string, values: string[], recommended: boolean }[] }
```

### Template 3: StepFlow
**Use when**: A process with ordered steps (3-7 steps)  
**Layout**: Horizontal or vertical chain of numbered nodes  
**Data schema**:
```ts
{ title: string, steps: { number: number, label: string, detail: string, icon?: string }[] }
```

### Template 4: ProsCons
**Use when**: Weighing advantages and disadvantages  
**Layout**: Two columns — green left (pros), red right (cons)  
**Data schema**:
```ts
{ subject: string, pros: { point: string, weight: 'high'|'medium'|'low' }[], cons: { point: string, weight: 'high'|'medium'|'low' }[] }
```

### Template 5: CaseStudy
**Use when**: A real-world example that illustrates the concept  
**Layout**: Story arc — Context → Problem → Solution → Result  
**Data schema**:
```ts
{ company: string, context: string, problem: string, solution: string, result: string, lesson: string }
```

### Template 6: KeyTakeaway
**Use when**: End-of-section summary, 3-5 key points  
**Layout**: Card cluster — central title with radiating takeaway cards  
**Data schema**:
```ts
{ topic: string, takeaways: { headline: string, detail: string, icon: string }[] }
```

### Template 7: QuestionAnswer
**Use when**: FAQ, checkpoint questions, common misconceptions  
**Layout**: Accordion-style Q&A node pairs  
**Data schema**:
```ts
{ section_title: string, qa_pairs: { question: string, answer: string, followup?: string }[] }
```

### Template 8: Flowchart
**Use when**: Decision trees, branching logic, "if X then Y" structures  
**Layout**: Top-down DAG with diamond decision nodes and rectangular action nodes  
**Data schema**:
```ts
{ title: string, nodes: { id: string, type: 'start'|'decision'|'action'|'end', label: string, detail?: string }[], edges: { from: string, to: string, label?: string }[] }
```

### Template 9: ConceptMap
**Use when**: A central idea with multiple related branches (relationships, ecosystem overview)  
**Layout**: Radial — central node, child nodes radiate outward  
**Data schema**:
```ts
{ central_concept: string, branches: { label: string, relationship: string, children?: { label: string, note?: string }[] }[] }
```

### Template 10: Timeline
**Use when**: Chronological events, history, evolution of a technology  
**Layout**: Horizontal or vertical timeline with date markers  
**Data schema**:
```ts
{ title: string, events: { date: string, label: string, detail: string, significance: 'major'|'minor' }[] }
```

### Template 11: Hierarchy
**Use when**: Org charts, taxonomies, nested categories, tree structures  
**Layout**: Top-down tree with parent → children relationships  
**Data schema**:
```ts
{ root: { label: string, children: HierarchyNode[] } }
// HierarchyNode: { label: string, detail?: string, children?: HierarchyNode[] }
```

### Template 12: StatsInfographic
**Use when**: Key numbers, metrics, market data, survey results  
**Layout**: Grid of stat cards — large number, label, context  
**Data schema**:
```ts
{ title: string, stats: { value: string, unit?: string, label: string, context: string, trend?: 'up'|'down'|'neutral', icon: string }[] }
```

---

## Files to Create

### New Components (12 templates)
```
components/templates/
  ConceptDefinitionTemplate.tsx
  ComparisonTableTemplate.tsx
  StepFlowTemplate.tsx
  ProsConsTemplate.tsx
  CaseStudyTemplate.tsx
  KeyTakeawayTemplate.tsx
  QuestionAnswerTemplate.tsx
  FlowchartTemplate.tsx
  ConceptMapTemplate.tsx
  TimelineTemplate.tsx
  HierarchyTemplate.tsx
  StatsInfographicTemplate.tsx
  TemplateRenderer.tsx          ← maps template_type → component, passes data
  index.ts                      ← barrel export
```

### New Lib Files
```
lib/content/
  script-generator.ts           ← Step 2: training script generation with checkpoints
  session-content-generator.ts  ← Step 1: content outline + previous session awareness
```

### New API Routes
```
app/api/sessions/[id]/
  generate-content/route.ts     ← POST: triggers full 6-step pipeline for a session
```

### New Inngest Function
```
inngest/
  session-content-pipeline.ts   ← triggered by distill/session.content.generate
```

### New Migration
```
supabase/migrations/
  013_content_pipeline.sql      ← adds script column to topic_content_cache
```

## Files to Modify

| File | Change |
|---|---|
| `lib/templates/selector.ts` | Add selection logic for 5 new template types |
| `lib/templates/generator.ts` | Add data generators for 5 new template types |
| `lib/session-plan.ts` | Call new pipeline after plan approval |
| `app/api/plan/approve/route.ts` | Emit `distill/session.content.generate` event |
| `app/dashboard/sessions/[id]/SessionDetailClient.tsx` | Show script + visuals from new pipeline |

---

## Package to Install
- `@xyflow/react` — React Flow v12 (nodes/edges, zoom/pan, responsive)
- `dagre` — Auto-layout algorithm (no overlap guarantee)
- `@dagrejs/dagre` — TypeScript-typed version

---

## Build Order

1. **Install packages** — React Flow + dagre
2. **Build all 12 template components** (Step 0) — no AI needed yet, just UI shells with typed props + sample data
3. **Build `TemplateRenderer`** — maps type → component
4. **Extend `selector.ts` and `generator.ts`** — add new template types
5. **Build `session-content-generator.ts`** — Step 1 (content + previous session awareness)
6. **Build `script-generator.ts`** — Step 2 (training script)
7. **Build `generate-content` API route** — Step 3-5 orchestration
8. **Build `session-content-pipeline.ts` Inngest** — background job
9. **Wire approval trigger** — modify `plan/approve` to emit event
10. **Update SessionDetailClient** — show script + visuals

---

## Open Questions / Decisions Made

| Question | Decision |
|---|---|
| Visual framework | React Flow + Dagre (responsive, no overlap, interactive) |
| Output format | Interactive React components rendered in-browser |
| Script format | TEACH → CHECKPOINT → PROBE → CONTINUE cycle |
| Template rebuild? | Never auto-rebuilt — one-time shell, AI only fills data |
| Previous session context | Query `topic_content_cache` + `sessions.notes` for same user |
| Template modification | User can give KB feedback → only data regenerated, not shell |
