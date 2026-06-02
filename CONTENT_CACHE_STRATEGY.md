# Content Cache Strategy

## Core Insight

Most of what Clio generates is not unique to an individual user.
Topic structure, visual slides, and core concept explanations are the same
for everyone learning the same topic. Only the framing and "so what for you"
narration varies — and even that is cacheable at the role+industry level.

As the user base grows, LLM cost per new user approaches zero.

---

## Three Cache Layers

### Layer 1 — Curriculum Plan Cache

**What:** Arc structure, topic ordering, subtopics list per topic.  
**Key:** `SHA256(role + "::" + maturity + "::" + sorted_topics).slice(0,16)`  
**Reuse:** 100% — two users with the same role, maturity, and topic selections
get an identical plan structure.  
**Storage:** `curriculum_plan_templates` table (new) — one row per unique profile hash.  
**Already exists:** `buildProfileHash()` in `lib/curriculum/planner.ts` and
`user_profile_hash` column in `curriculum_plans` — today this only caches
per-user. Extending it cross-user is the new work.

**Flow:**
```
User selects topics (unauthenticated) → profile hash computed
POST /api/curriculum/generate-preview
    → lookup curriculum_plan_templates WHERE profile_hash = ?
    → cache hit: return instantly, zero LLM
    → cache miss: run generateCurriculumPlan() → save as template → return
Cache result in localStorage: clio_plan_preview = { hash, plan }

User lands on /dashboard (after signup + payment):
    → check localStorage for clio_plan_preview
    → if found: POST /api/curriculum/save-preview (copy template to user's curriculum_plans, zero LLM)
    → clear localStorage
    → user navigates to /dashboard/plan → plan already there, instant
```

---

### Layer 2 — Session Visual Content Cache

**What:** Visual slide specs and diagrams for each subtopic.  
**Key:** `SHA256(topic_title + "::" + subtopic_title).slice(0,16)`  
**Reuse:** 100% — a slide explaining "How attention mechanism works" is identical
regardless of who is learning it.  
**Storage:** `topic_content_cache` table (already exists) — already stores
visual specs per subtopic. Today it is per-user; extend to be shared.

**Flow:**
```
session-designer-auto fires for a user's plan
    → for each subtopic: check topic_content_cache WHERE content_hash = ?
    → cache hit: copy visual spec directly, zero LLM
    → cache miss: generate visual spec via LLM → save to cache → use it

First user to learn "What is RAG?" pays the LLM cost.
Every subsequent user gets it instantly.
```

**Note:** The `topic_content_cache` table already has this data — the change
is to make lookups cross-user (remove the `user_id` filter from cache reads,
keep it on writes for ownership tracking).

---

### Layer 3 — Narration Script Cache

**What:** Clio's speaking script, role-specific "so what" framing, worked examples.  
**Key:** `SHA256(topic_title + "::" + subtopic_title + "::" + role + "::" + industry).slice(0,16)`  
**Reuse:** Across all users with the same role and industry — a CFO in Banking
learning "AI Governance risks" gets the same script framing as another CFO in Banking.  
**Storage:** `script_cache` table (new) — one row per topic+subtopic+role+industry combination.

**Flow:**
```
session-content-pipeline fires for a session
    → for each subtopic: check script_cache WHERE script_hash = ?
    → cache hit: use cached script, zero LLM
    → cache miss: generate script via LLM → save to cache → use it

What stays live (never cached):
    → Clio's Q&A responses during the session (always real-time)
    → User-specific follow-up questions
```

---

## What Stays Unique Per User

- Clio's live conversational responses during Q&A
- Follow-up questions based on what the user just said
- Anything the user types or speaks during a session

These can never be cached — they depend on the specific conversation in flight.

---

## Economics as User Base Grows

| User count | Layer 1 (plan) | Layer 2 (visuals) | Layer 3 (scripts) | LLM calls vs. Day 1 |
|---|---|---|---|---|
| User 1 | Miss → generate | Miss → generate | Miss → generate | 100% |
| User 10 (same profile) | Hit → instant | Hit → instant | Hit → instant | ~0% |
| User 10 (new profile) | Miss → generate | Partial hit (topics overlap) | Miss → generate | ~40% |
| User 100+ | >90% hit rate across layers | ~95% hit rate | ~80% hit rate | <10% |

---

## Implementation Order

1. **Layer 1 first** — highest impact, affects every new user before they even sign up.
   - New table: `curriculum_plan_templates (profile_hash, visible_sessions, queue_sessions, generated_at)`
   - New endpoint: `POST /api/curriculum/generate-preview` (public, uses template table)
   - New endpoint: `POST /api/curriculum/save-preview` (auth required, copies template to user)
   - Dashboard bootstrap: check localStorage → save-preview → clear cache

2. **Layer 2** — already partially implemented via `topic_content_cache`.
   - Change cache reads to be cross-user (remove user_id filter on SELECT)
   - Add `content_hash` column (topic_title + subtopic_title hash) as lookup key

3. **Layer 3** — build after Layer 2 is validated.
   - New table: `script_cache (script_hash, topic_title, subtopic_title, role, industry, script_json)`
   - Modify `session-content-pipeline` to check cache before generating

---

## Tables Needed

```sql
-- Layer 1
CREATE TABLE curriculum_plan_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_hash    text NOT NULL UNIQUE,
  visible_sessions jsonb NOT NULL,
  queue_sessions  jsonb NOT NULL DEFAULT '[]',
  generated_at    timestamptz NOT NULL DEFAULT now(),
  use_count       integer NOT NULL DEFAULT 1
);
CREATE INDEX ON curriculum_plan_templates (profile_hash);

-- Layer 3 (Layer 2 already exists as topic_content_cache)
CREATE TABLE script_cache (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_hash   text NOT NULL UNIQUE,
  topic_title   text NOT NULL,
  subtopic_title text NOT NULL,
  role          text NOT NULL,
  industry      text NOT NULL,
  script_json   jsonb NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  use_count     integer NOT NULL DEFAULT 1
);
CREATE INDEX ON script_cache (script_hash);
```

---

*Status: Design complete. Not yet built.*  
*Build Layer 1 first — highest leverage, unblocks the pre-auth plan generation flow.*
