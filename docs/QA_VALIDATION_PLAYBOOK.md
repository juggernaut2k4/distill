# Clio — QA Validation Playbook
_CEO Agent reference. Run after every onboarding or content generation event._

---

## Stage 0 — Wait for Generation to Complete

Before validating anything, confirm all generation is done.

### Check content_status for all sessions
```sql
SELECT id, session_title, session_index, content_status, status
FROM sessions
WHERE user_id = '[userId]'
  AND status NOT IN ('cancelled')
ORDER BY session_index ASC;
```
**Gate:** All sessions must show `content_status = 'ready'` before proceeding to Stage 3+.

### Check async_jobs (if generation was triggered via generate-content)
```sql
SELECT id, status, progress, error_message, created_at, completed_at
FROM async_jobs
WHERE user_id = '[userId]'
ORDER BY created_at DESC
LIMIT 10;
```
**Gate:** All jobs must be `status = 'complete'`. Any `failed` = investigate before validating.

---

## Stage 1 — User Profile + Topic Selections

### Fetch user profile
```sql
SELECT id, role, industry, ai_maturity, role_level, topic_interests,
       learning_goal, worry_tags, plan_tier, plan_approved
FROM users
WHERE id = '[userId]';
```

### Validation criteria
| Field | Check |
|-------|-------|
| `role` | Non-null, matches what user said in onboarding |
| `industry` | Non-null, not 'general' unless explicitly chosen |
| `ai_maturity` | One of: observer/emerging/practitioner/leader |
| `role_level` | One of: c-suite/vp-dir/vp-technology/vp-product/manager/specialist |
| `topic_interests` | Array, 1–5 items, not empty |
| `learning_goal` | One of: quick_wins/steady_progress/deep_dive |
| `worry_tags` | Array, reflects user's stated concern |

---

## Stage 2 — Curriculum Plan (Topics → Arcs → Subtopics)

### Fetch active plan
```sql
SELECT id, visible_sessions, queue_sessions, raw_llm_output,
       generated_at, user_profile_hash,
       raw_llm_output->>'schema_version' as schema_version
FROM curriculum_plans
WHERE user_id = '[userId]'
  AND superseded_at IS NULL
ORDER BY generated_at DESC
LIMIT 1;
```

### For v2 plans: inspect arcs
`visible_sessions` contains arc objects with `comprehensive_subtopics[]`.
Each arc should have:
- `arc_name` — specific topic name (not "Introduction to AI")
- `arc_type` — domain / integrated / singleton
- `arc_description` — one sentence, role-specific
- `comprehensive_subtopics` — 8–35 items, specific not vague
- `is_visible` — true for arcs in visible plan

### Arc quality rubric (CEO judgement)
| Criterion | Pass | Fail |
|-----------|------|------|
| Relevance | Directly applicable to user's role + industry | Generic; could apply to anyone |
| Specificity | Subtopic names are concrete learning points | Vague ("Overview of X", "Introduction") |
| Career value | A VP/Director would feel this advances their credibility | Feels like a textbook chapter |
| Ordering | Context anchor first → concepts → practical action last | Random order |
| Coverage | No obvious gap for a user at this maturity level | Missing a key concept they'd need |
| Worry addressed | At least one arc directly addresses stated worry | Worry ignored |

### Expected arc/session counts by learning_goal
| learning_goal | mins/session | subtopics/session |
|---------------|-------------|-------------------|
| quick_wins | 5 min | 2 subtopics |
| steady_progress | 15 min | 6 subtopics |
| deep_dive | 30 min | 14 subtopics |

Formula: `floor((sessionMins - 2) / 2)` = subtopics per session.

---

## Stage 2A — Role Differentiation & Coverage Checks (Automated)

_Run immediately after Stage 2. Fully automated — no SQL required._

### Endpoint

```
GET /api/admin/qa-role-checks?userId=<userId>
```

Replace `<userId>` with the target user's Clerk user id. Omit the param to check your own account.

### What it checks

| Check | What it tests | Source | Pass threshold |
|-------|--------------|--------|---------------|
| 5A — Role Differentiation | Arc names contain role-tier keywords | `curriculum_plans.visible_sessions[].arc_name` | 60% of arcs match |
| 5B — Content Orientation | Subtopic titles contain role-tier keywords | `sessions.sub_sessions[]` (string titles) | 50% of titles match |
| 5C — Topic Coverage | Plan covers foundational AI tooling (technical) or user's stated interests (exec/manager) | Arc names vs keyword list or `topic_interests` | Binary: ≥1 arc matches |

### Keyword lists per tier

**Executive** (c-suite, vp-dir, vp-technology, vp-product):
`govern, governance, strategy, strategic, roi, cost, vendor, risk, board, compliance, budget, oversight, policy, evaluate, investment, stakeholder, executive`

**Manager** (manager):
`team, workflow, process, adoption, productivity, collaboration, onboard, training, manage, operational, rollout, change management`

**Technical** (specialist):
`implement, build, code, api, deploy, debug, architect, framework, integrate, prompt engineering, llm, model, pipeline, engineer, developer, sdk, token, fine-tun`

Matching is case-insensitive substring. `fine-tun` matches `fine-tuning`.

### Sample curl

```bash
curl -s "https://distill-peach.vercel.app/api/admin/qa-role-checks?userId=USER_ID_HERE" \
  -H "Cookie: __session=YOUR_CLERK_SESSION_COOKIE" | jq .
```

### Interpreting the response

All checks pass → `"ok": true`, issues: `["None — all checks passed"]`

Any failure → `"ok": false`, issues array has one line per failing check with the ratio and threshold.

### Gate

Proceed to Stage 3 only when `ok: true`. If any check fails, file the issue in BACKLOG.md as `QA-ROLE-XX` and investigate the curriculum generator prompt for role-tier framing before onboarding additional users.

---

## Stage 3 — Sessions Created (Post-Approval)

### Fetch all sessions
```sql
SELECT id, session_title, session_index, duration_mins, status,
       content_status, sub_sessions, topic_id, curriculum_session_id,
       curriculum_plan_id
FROM sessions
WHERE user_id = '[userId]'
  AND status NOT IN ('cancelled')
ORDER BY session_index ASC;
```

### Session quality rubric
| Criterion | Pass | Fail |
|-----------|------|------|
| Title specificity | "Why Financial Firms Choose Claude Over GPT-4" | "Part 1", "Introduction", "Session 1" |
| sub_sessions count | Matches PACE-01 formula for duration_mins | Empty, or wrong count |
| sub_sessions format | Array of `{title, type, duration_mins, learning_objective}` | null or generic strings |
| Duration match | `duration_mins` matches user's learning_goal | All sessions 15 min despite deep_dive |
| Section 1 type | 'concept' or 'application' (context anchor) | 'summary' first |
| Section N type | 'application' or 'practice' (practical action last) | 'concept' last |

### Check sub_sessions are non-generic
Red flags in subtopic titles:
- "Core concepts"
- "Real-world application"  
- "Key takeaways"
- "Introduction to..."
- "Overview of..."

These indicate session-designer fallback fired. Root cause: `sub_sessions` was null when designer ran.

---

## Stage 4 — KB Content (topic_content_cache)

### Fetch all cache rows for a session
```sql
SELECT subtopic_slug, subtopic_title, template_type,
       pipeline_status, generated_at, industry, role,
       section_data->'type' as section_type,
       jsonb_array_length(section_data->'data'->'items') as item_count
FROM topic_content_cache
WHERE topic_id = '[DB_SESSION_UUID]'
  AND pipeline_status = 'ready'
ORDER BY generated_at ASC;
```

### Check for stale / wrong-key rows
```sql
-- Flag rows stored under wrong key (should be DB session UUID, not topic slug)
SELECT topic_id, COUNT(*) as rows,
       MIN(generated_at) as oldest,
       MAX(generated_at) as newest
FROM topic_content_cache
WHERE user_id = '[userId]'   -- if column exists
   OR topic_id IN (
     SELECT id FROM sessions WHERE user_id = '[userId]'
   )
GROUP BY topic_id;
```

### Template type → content type mapping (validation rules)
| Content type | Expected template | Red flag if using |
|-------------|-------------------|-------------------|
| Comparison (X vs Y, model tiers) | ComparisonTable | DefinitionTriptych |
| Step-by-step process | StepFlow or ChevronProcess | DefinitionTriptych |
| Definition / what-is | ConceptDefinition or DefinitionTriptych | ComparisonTable |
| Pros/cons tradeoffs | ProsCons | DefinitionTriptych |
| Case study / example | CaseStudy | ConceptDefinition |
| Statistics / data point | StatCallout | DefinitionTriptych |
| Decision framework | HorizontalDecision or TwoByTwoMatrix | DefinitionTriptych |
| Timeline / history | Timeline | StepFlow |
| Single strong concept | AnswerSpotlight or KeyTakeaway | ComparisonTable |
| How-it-works architecture | ConceptMap or Hierarchy | DefinitionTriptych |

**Key check:** Count how many rows use `DefinitionTriptych`. If >40% of rows use it, the `template_hint` from LLM is not being used correctly.

### Content quality rubric
| Criterion | Pass | Fail |
|-----------|------|------|
| Item count | 3 items exactly (for templates with items) | 1 item, or >5 items |
| Item specificity | "Claude Sonnet: 200K token context, best for document analysis" | "Model 1", "Option A" |
| Role framing | Mentions the user's role/industry context | Generic |
| No jargon overload | Explained like a trusted peer | Acronym soup |
| So-what present | Ends with role-specific implication | Stops at description |

---

## Stage 5 — Script + Visualization Alignment

### Fetch script for a subtopic
```sql
SELECT subtopic_slug, subtopic_title, template_type,
       training_script,
       section_data->'data'->'items' as viz_items
FROM topic_content_cache
WHERE topic_id = '[DB_SESSION_UUID]'
  AND pipeline_status = 'ready'
ORDER BY generated_at ASC;
```

### Alignment validation rules
1. **Item count match:** `viz_items` must have exactly 3 items. TEACH script must reference exactly those 3 items by name.
2. **NAV markers present:** TEACH segment must contain `[NAV:tab_0]`, `[NAV:tab_1]`, `[NAV:tab_2]` at the moment each item is introduced.
3. **Word count:** TEACH segment ≤ 280 words (2 min at 140wpm). Count with: `length(training_script->'segments'->0->>'content') - length(replace(...))`.
4. **ICE_BREAKER present:** Should be an open situational question, not a comprehension check.
5. **CHECKPOINT present:** Must be role-specific (mentions their actual decision/situation), not "Did you understand?".
6. **Segment order:** ICE_BREAKER → TEACH → CHECKPOINT (→ PROBE → CONTINUE).

### Duration alignment check
| Session duration | Expected TEACH length | Expected total segments |
|-----------------|----------------------|------------------------|
| 5 min | ≤70 words (30s) | 2–3 |
| 15 min | ≤140 words (1 min) | 4–5 |
| 30 min | ≤280 words (2 min) | 5–6 |

---

## Stage 6 — End-to-End Signal Check

Quick pass to confirm nothing is broken at the system level:

```sql
-- Sessions with missing sub_sessions (will teach generic content)
SELECT id, session_title, session_index
FROM sessions
WHERE user_id = '[userId]'
  AND (sub_sessions IS NULL OR jsonb_array_length(sub_sessions::jsonb) = 0)
  AND status NOT IN ('cancelled');

-- Cache rows with wrong industry/role (personalization bypassed)
SELECT topic_id, subtopic_slug, industry, role
FROM topic_content_cache
WHERE topic_id IN (SELECT id FROM sessions WHERE user_id = '[userId]')
  AND (industry = '' OR role = '');

-- Sessions where content_status never reached ready
SELECT id, session_title, content_status, status
FROM sessions
WHERE user_id = '[userId]'
  AND content_status != 'ready'
  AND status = 'scheduled';
```

---

## How to Run This Playbook

1. User completes onboarding → get their `userId` from Clerk or Supabase
2. Run Stage 0 — wait until all sessions show `content_status = 'ready'`
3. Run Stages 1–2 — validate plan quality (can run immediately after plan generates)
4. Run Stages 3–6 — validate after `content_status = 'ready'` for all sessions
5. File any failures as LIVE-XX or CONTENT-XX items in BACKLOG.md

_Playbook version: 1.0 | Created: 2026-06-26 | Owner: CEO Agent_
