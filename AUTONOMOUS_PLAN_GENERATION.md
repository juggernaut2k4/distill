# Autonomous Plan Generation — Design & Todos

## What changes

Move all LLM work out of browser-triggered HTTP calls into Inngest background jobs.
The browser fires events; Inngest does the computation; the browser polls for results.

---

## Event chain

```
POST /api/topics  (topics saved to DB)
    │
    ├── supersede old curriculum_plans row (if exists)
    ├── delete old draft sessions (if exists)
    └── fire Inngest event: "clio/topics.selected"
                │
                ▼
        [Job 1] curriculum-generator
                │  generateCurriculumPlan() → LLM
                │  save to curriculum_plans
                └── fire Inngest event: "clio/plan.generated"
                            │
                            ▼
                    [Job 2] session-designer-auto
                            │  designSessionsForTopic() × each visible topic → LLM
                            └── insert sessions with status='draft'

User lands on /dashboard/plan
    → polls /api/curriculum/plan until plan exists
    → renders plan for review
    → clicks "Approve"
            │
            ▼
    POST /api/plan/approve  (zero LLM — pure DB writes)
        │  UPDATE sessions SET status='scheduled' WHERE plan_id=X AND status='draft'
        │  UPDATE curriculum_plans SET is_approved=true
        └── UPDATE users SET plan_approved=true
                │
                └── redirect to /dashboard/sessions (sessions now visible)
```

---

## Todos (build in order)

### T1 — Create `inngest/curriculum-generator.ts`
- Trigger: `clio/topics.selected` event (data: userId)
- Step 1: load user profile + topics from DB
- Step 2: call `generateCurriculumPlan()` 
- Step 3: supersede existing plan if profile hash changed (same logic as curriculum/generate route)
- Step 4: save new plan to curriculum_plans
- Step 5: fire `clio/plan.generated` event (data: planId, visibleSessions, userId)
- Retries: 3

### T2 — Create `inngest/session-designer-auto.ts`
- Trigger: `clio/plan.generated` event (data: planId, visibleSessions, userId)
- Step 1: load user profile (role, industry, maturity, learning_goal)
- Step 2: for each visible session → call `designSessionsForTopic()` with subtopics
- Step 3: insert all designed sessions with `status='draft'`, `curriculum_plan_id=planId`
- Step 4: update curriculum_plans.visible_sessions with db_session_ids (same as approve route does today)
- Retries: 3

### T3 — Modify `app/api/topics/route.ts`
- After saving topics: supersede existing non-approved plan + delete its draft sessions
- Fire `inngest.send({ name: 'clio/topics.selected', data: { userId } })`
- Remove the inline `plan_generated_at` update (moved to end of Job 1)
- Keep plan-ready email/SMS (fires after topics saved — tells user plan is being built)

### T4 — Modify `app/api/plan/approve/route.ts`
- Remove: all `designSessionsForTopic()` calls
- Remove: session INSERT loop
- Add: `UPDATE sessions SET status='scheduled' WHERE curriculum_plan_id=plan.id AND status='draft'`
- Keep: curriculum_plans update (is_approved, approved_at, visible_sessions)
- Keep: users update (plan_approved, active_plan_id)
- Keep: approval email + SMS

### T5 — Modify `app/dashboard/plan/PlanClient.tsx`
- Remove: the `fetch('/api/curriculum/generate', { method: 'POST' })` call
- Replace with: polling loop — check `/api/curriculum/plan` every 4s until plan appears
- Show "Preparing your plan..." state while polling (same visual as generating spinner today)
- Safety fallback: after 90s of polling with no plan → call /api/curriculum/generate directly
  (handles case where Inngest failed all 3 retries)

### T6 — Modify `app/dashboard/sessions/page.tsx`
- Add `.neq('status', 'draft')` to sessions query
- Draft sessions are invisible until approve flips them to 'scheduled'

### T7 — Register new Inngest functions in `app/api/inngest/route.ts`
- Import and add: `curriculumGenerator`, `sessionDesignerAuto` to the serve() array

---

## Key invariants

- `status='draft'` sessions never appear on /dashboard/sessions (filtered out)
- Approve never calls LLM — it only flips draft→scheduled
- If topics change before approval: old plan superseded, old draft sessions deleted, fresh generation starts
- If Inngest fails all retries: PlanClient falls back to calling /api/curriculum/generate directly after 90s
- Sessions always tied to `curriculum_plan_id` for cleanup targeting
