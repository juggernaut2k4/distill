# Distill — Scaling Playbook & Build Backlog

> **Purpose:** Live working document. Updated throughout each build session.
> Captures process rules, tasks, stories, decisions, and open questions as we brainstorm.
> At the end of each session: review, prioritize, group, then build.
>
> **Last updated:** 2026-07-03

---

## The 3 Non-Negotiable Process Rules

These govern ALL content creation at scale — across every topic, session, and user.
Every story we build must respect these rules. Any violation is a P0 bug.

---

### Rule 1 — The Slug Contract

**What it says:**
Subtopic titles must produce identical slugs across all three paths that touch them:
1. Session plan (`session_plan.subtopics[].title`) — set when the plan is created
2. Inngest content pipeline — reads titles, stores cache rows with derived slugs
3. GET endpoint — derives slugs from session plan to look up cache rows

One canonical `slugify()` function. Used everywhere. Never inlined separately.

**Why this matters:**
If any path derives a different slug from the same title, cache lookups return nothing → `training_script: null` → content generation appears broken even when everything ran correctly. We hit this exact bug yesterday with 3 divergent paths producing 3 different slug strings for the same subtopic.

**The Rule in Code:**
```typescript
// lib/utils/slugify.ts — THE ONLY slugify function in the codebase
export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 60)
}
```
- Import from this path everywhere — never redefine inline
- When Claude returns subtopic titles, override with the original input title before slugging
- Cache rows must be indexed by both stored slug AND title-derived slug (dual-key map) for resilience

**Acceptance Criteria:**
- [ ] Single `slugify()` exported from `lib/utils/slugify.ts`
- [ ] All 3 paths import and use it
- [ ] Unit test: same title through all 3 paths = same slug
- [ ] Integration test: generate content → GET endpoint always finds rows

---

### Rule 2 — The Content Gate

**What it says:**
A session is only marked `content_status = 'ready'` when ALL of the following are true:
1. All subtopics have `pipeline_status = 'ready'` in `topic_content_cache`
2. Automated QA passes on ≥80% of subtopics (`qa_passed = true`)
3. The `mark-session-ready` Inngest step completes without error

Until all 3 conditions are met, the session stays `generating`. If the pipeline exhausts retries, it sets `content_status = 'failed'` — never leaves it ambiguous.

**Why this matters:**
Right now, the `mark-session-ready` step (Inngest step 6) fails silently after retries. Subtopics are correctly written to cache, but the session status is stuck at `generating` then goes to `failed`. The content IS there — the gate is broken. Users and tests can't trust the status field.

**Current bug:** Inngest `onFailure` only sends an admin alert — it never sets `content_status = 'failed'`. Something else sets it to 'failed' (TBD — needs Inngest dashboard investigation).

**The Rule in Code:**
```typescript
// In onFailure handler — inngest/session-content-pipeline.ts
// Must set content_status = 'failed' so the UI shows a clear error, not a spinner
await supabase.from('sessions').update({ content_status: 'failed' }).eq('id', sessionId)
```

**Acceptance Criteria:**
- [ ] `onFailure` sets `content_status = 'failed'` on the session
- [ ] Step 6 (`mark-session-ready`) failure is logged with the specific error
- [ ] Investigate and fix the root cause of step-6 failure (Inngest dashboard)
- [ ] E2E test 8 passes on `content_status = 'ready'` (not just the subtopic guard)
- [ ] QA gate is enforced: `qa_passed < 80%` blocks session from going ready

---

### Rule 3 — The Regeneration Protocol

**What it says:**
When a session needs new content (topic changed, cache expired, quality failed, explicit reset):

1. **DELETE** cache rows for that session's subtopics via `DELETE /api/sessions/${id}/generate-content`
2. **Wait** — do NOT serve content in the gap. Show a "generating" state to users.
3. **Trigger** a fresh Inngest run via `POST /api/sessions/${id}/generate-content`
4. **Do NOT** await the POST — fire-and-forget, then poll GET every 15s
5. **Poll** until `content_status = 'ready'` OR all subtopics have `pipeline_status = 'ready'`
6. **Timeout** at 4 minutes — if not done, show error + allow manual retry

**Why this matters:**
If two Inngest runs are in flight simultaneously (old run + new reset run), they race on step 6 and corrupt the session status. The DELETE + wait pattern ensures only one run is active.

**The Rule in Code:**
- DELETE endpoint must invalidate cache rows AND reset session `content_status = 'pending'`
- POST endpoint must check if a run is already in flight (`content_status = 'generating'`) and skip firing a duplicate Inngest event
- All generation triggers from the UI must go through this protocol — no direct Inngest event sends from client code

**Acceptance Criteria:**
- [ ] DELETE resets session `content_status` to `'pending'`
- [ ] POST is idempotent — if already `'generating'`, return 200 without firing a second event
- [ ] UI shows "generating" spinner during the window between DELETE and ready
- [ ] E2E test validates full reset → regenerate → ready cycle in under 4 minutes

---

## Task & Story Backlog (Built Live)

> Stories are added here as we discuss throughout the day.
> Format: **[ID] Title** — outcome, complexity, dependencies

### Process Infrastructure

| ID | Story | Outcome | Complexity | Status |
|----|-------|---------|------------|--------|
| P-01 | Extract `slugify()` to `lib/utils/slugify.ts`, import everywhere | Rule 1 enforced in code | S | Not started |
| P-02 | Fix `onFailure` in Inngest pipeline to set `content_status = 'failed'` | Rule 2 enforced | S | Not started |
| P-03 | Investigate Inngest step-6 failure root cause (dashboard logs) | Know why mark-session-ready fails | S | Not started |
| P-04 | Make DELETE endpoint reset `content_status = 'pending'` | Rule 3 enforced | S | Not started |
| P-05 | Make POST endpoint idempotent (skip if already generating) | Rule 3 enforced | S | Not started |
| P-06 | Add unit test: same title → same slug across all 3 paths | Rule 1 regression-proof | S | Not started |
| P-07 | Add E2E test: DELETE → POST → poll → ready cycle | Rule 3 regression-proof | M | Not started |

### Content Quality

| ID | Story | Outcome | Complexity | Status |
|----|-------|---------|------------|--------|
| Q-01 | QA gate: block `mark-session-ready` if `qa_passed < 80%` | Rule 2: quality enforced at pipeline level | M | Not started |
| Q-02 | QA dashboard: view qa_passed/failed counts per domain | Ops visibility | M | Not started |

### Curriculum Intelligence

| ID | Story | Outcome | Complexity | Status |
|----|-------|---------|------------|--------|
| C-01 | Add `role_relevance`, `related`, `unlocks` fields to `topic_catalog` table | Topic relationship graph exists in DB | M | Not started |
| C-02 | Build role → foundation topics injection: auto-add mandatory beginner topics per role | Users always get the right starting point regardless of their selection | M | Not started |
| C-03 | Use `lib/learning/taxonomy.ts` `primaryDomains` to drive curriculum generation (not just UI display) | Role data flows into actual plan, not just topic page ordering | M | Not started |
| C-04 | Replace hardcoded 23-topic AI catalog in `curriculum.ts` with `topic_catalog` DB queries | One catalog, not two disconnected systems | L | Not started |
| C-05 | Role-calibrated subtopic generation: pass role+industry to subtopic prompt, not just topic title | CEO and CFO get different subtopics on same topic | M | Not started |
| C-06 | Prerequisite awareness in curriculum builder: when user picks advanced topic, auto-inject prerequisites with explanation | "We added Data Strategy because AI in Finance requires it" | M | Not started |

### Trial & Conversion Funnel

| ID | Story | Outcome | Complexity | Status |
|----|-------|---------|------------|--------|
**Full funnel: Onboarding → Curriculum Preview → Card → Trial Session → Activate**

| ID | Story | Outcome | Complexity | Status |
|----|-------|---------|------------|--------|
**Full funnel: Onboarding → Curriculum Preview → Card → Trial Session (instant) → Activate**

| ID | Story | Outcome | Complexity | Status |
|----|-------|---------|------------|--------|
| T-01 | Orientation selector — rule-based algorithm picks 1 best subtopic for role+industry+interest | FS CEO gets "Claude vs GPT for FS"; retail COO gets something different. Right subtopic = right aha. | M | **Not started** (verified 2026-07-03 — no `orientation` code anywhere in `app/` or `lib/`) |
| T-02 | Pre-generate orientation content in parallel during "Building your plan..." screen | By the time user finishes reading curriculum + entering card (~3-5 min), content has been ready for 3+ min. Instant launch. | M | **Not started** (verified 2026-07-03 — `app/onboarding/page.tsx` submit flow only POSTs profile + `router.push('/topics')`; "Building your plan..." screen is a pure client spinner, no parallel generation call) |
| T-03 | Orientation uses existing session content pipeline — just 1 subtopic instead of 5 | No new pipeline needed. Reuse outline→script→template→cache flow. Completes in ~33s. | S | **Not started**, blocked on T-01 (existing pipeline in `lib/curriculum/session-designer.ts` + `lib/templates/generator.ts` is reusable once T-01 exists) |
| T-04 | Static fallback orientation content — 1 pre-written session per role (CEO/CTO/CFO etc.) | If pre-generation fails (API timeout), fallback is served instantly. Experience degrades gracefully. | M | **Not started** (verified 2026-07-03 — no fallback content files for any role) |
| T-05 | Curriculum Preview page — full 9-topic list with per-topic justification, sessions 4-9 locked | The sales page. Free, pre-payment. Per-topic FS-CEO justifications close the deal before the session. | M | **Not started** (verified 2026-07-03 — `app/topics/page.tsx` exists but has no locked-session state and no per-topic justification copy; not a dedicated pre-payment sales page) |
| T-06 | Card collection page (Stripe SetupIntent, pre-session) — plan selected here, NOT charged yet | Prevents abuse. By this point user has seen their plan — card friction is lowest it will ever be. | M | **DONE** (verified 2026-07-03 — `app/api/checkout/route.ts` creates a real Stripe `setupIntents.create({usage:'off_session'})`; `app/checkout/page.tsx` renders Stripe `PaymentElement`; `app/api/checkout/confirm/route.ts` attaches payment method + creates subscription with `trial_period_days: 3`, no charge until trial ends. Doc previously said "Not started" — it was stale, code was already correct. Not yet gated behind a Curriculum Preview page since T-05 doesn't exist.) |
| T-07 | Increase trial minutes from 5 → 15 to cover 1 full orientation subtopic (~10 min) | Current 5 min blocks the aha moment entirely. 15 min covers the session with buffer. | S | **DONE 2026-07-03** — changed the two places a trialing user's minute balance is set: `app/api/checkout/confirm/route.ts:113` and `app/api/webhooks/stripe/route.ts:59`, both `5 → 15`. `npx tsc --noEmit` clean. No other UI copy hardcodes the old "5 min" trial figure. |
| T-08 | Auto-launch orientation session immediately after card saved — no navigation, instant start | Zero friction between "card saved" and "session starts". Content already in DB. | S | **Not started**, blocked on T-01/T-02 (verified 2026-07-03 — checkout success currently routes to `/dashboard/welcome`, a generic setup spinner, then `/dashboard`) |
| T-09 | Post-trial activation screen — shows curriculum, plan, last 4 card digits, [Confirm & Start] | One-click confirm at peak intent. No re-entering details. Conversion ask when desire is highest. | M | **Not started** (verified 2026-07-03 — `app/api/checkout/activate/route.ts` exists and ends the trial early/charges now, but is wired to a plain dashboard "Activate plan" button, not a dedicated screen showing curriculum + last-4 card digits) |

**Verification note (2026-07-03):** This table previously read "Not started" for all of T-01–T-09. Code investigation found the table was stale on T-06 (Stripe SetupIntent flow was already fully and correctly built — real SDK calls, no mocks, no charge before trial end). T-07 was a genuine 2-location constant fix, now done. T-01, T-02, T-03, T-04, T-05, T-08, T-09 are genuinely not started and are one connected feature — the orientation content pipeline, the Curriculum Preview sales page, and the auto-launch/activation screens all depend on each other and on product decisions not yet made (see CEO escalation).

### Recommendations Engine

| ID | Story | Outcome | Complexity | Status |
|----|-------|---------|------------|--------|
| R-01 | Completion recommendation: "X of Y recommended topics for your role covered" with gap list | User sees their progress toward role readiness | M | Done (via CURR-02) |
| R-02 | Unlock recommendation: after completing topic X, show what X unlocks | Creates progression feel, drives continued learning | M | Done (via CURR-02) |
| R-03 | Minutes-aware recommendation: frame missing topics as "75 more minutes to complete your path" | Natural purchase trigger without forced upsell | S | Done 2026-07-03 |
| R-04 | API: `GET /api/recommendations` — returns { roleGaps, unlocked, nextBest } for current user | Powers all recommendation UI surfaces | M | Done (via CURR-02) |
| R-05 | UI: Recommendations panel on dashboard — "Continue your CFO path" with 3 topic cards | User sees what to do next after each session | M | Done 2026-07-03 |

**R-03 / R-05 assumed defaults (2026-07-03)** — proceeded without a full BA Q&A round since these are low-stakes, reversible UI decisions. Logged here as documented assumptions, not silent guesses:
1. Dashboard-home panel shows only **1** recommendation (vs. the plan page's up-to-2/up-to-1 by tier), given limited home real estate.
2. Minutes-aware framing (R-03) only renders when the recommended session's estimated duration would meaningfully eat into the remaining balance — specifically when `minutesBalance < 2 × session's estimated_minutes` (default 20 min if unknown). Not shown on every recommendation, to avoid clutter/false urgency.
3. Accepting a recommendation from dashboard home behaves identically to the plan page: calls `POST /api/curriculum/accept-recommendation` directly, adds the session to the plan, and shows an inline "Added to your plan" success state — no redirect off the dashboard.

Implementation: `HomeRecommendationSection` in `app/dashboard/DashboardClient.tsx` fetches `GET /api/curriculum/plan` client-side, takes `recommendations[0]`, and reuses `components/plan/RecommendationCard.tsx` (extended with optional `minutesBalance` / `minutesIncluded` / `estimatedMinutes` props for the minutes-aware copy).

---

## Architecture Decisions (Curriculum)

| Decision | What we decided | Why |
|----------|----------------|-----|
| Single catalog | Replace the 23-topic hardcoded catalog in `curriculum.ts` with the `topic_catalog` DB table (347 topics) | One source of truth, works across all domains not just AI |
| Role → curriculum (not just UI) | `primaryDomains` from `lib/learning/taxonomy.ts` must feed into curriculum generation | Role data is already there but unused downstream |
| Subtopics are role-scoped | Same topic generates different subtopics per role | The real personalization value is at this level |
| Recommendations = learning value first | Recommend because they benefit the user; purchase moment follows naturally when balance runs low | Avoids manipulative upsell feeling |
| Interest = the spine | When user names a specific product/tool, that IS the curriculum — not one topic in it | First draft had Claude as 1 of 9 topics — user would have felt misled |
| Constitutional AI merged into interest topic | Not a standalone session for beginners | Too granular on its own; belongs as a subtopic of "Claude: Capabilities & Design" |
| Data Strategy is mandatory for deployment intent | Any CEO/CTO/CDO in any industry with intermediate+ maturity must get Data Strategy | Most common deployment failure — model is ready, data is not |
| Industry mandatory topics are non-negotiable | FS → AI Governance + AI Security always. Healthcare → HIPAA + Clinical AI always | These protect the user in their regulatory environment regardless of what they asked for |

---

## Curriculum Engine Architecture

> Describes the 4-layer system that ensures every user — regardless of role, industry, interest, or maturity —
> receives a curriculum that passes the same quality bar as the CEO in FS example above.
> The questions we asked manually during the brainstorm session are encoded as automated checks.

---

### Layer 1 — Topic Relationship Graph (Data, built once)

Every topic in `topic_catalog` must carry these relationship fields:

```sql
ALTER TABLE topic_catalog ADD COLUMN IF NOT EXISTS
  role_relevance    jsonb,     -- { "ceo": "high", "cto": "medium", "cfo": "low", ... }
  industry_tags     text[],    -- ["financial-services", "healthcare", "retail", ...]
  requires          text[],    -- topic slugs that must precede this topic
  expands_to        text[],    -- topic slugs generated when user names this as their interest
  mandatory_for     text[],    -- industry slugs where this topic is always included
  arc_position      text,      -- 'foundation' | 'interest' | 'context' | 'deploy' | 'govern'
  interest_keywords text[]     -- ["claude", "anthropic", "constitutional ai"] for fuzzy matching
```

This graph is the foundation. Without it the engine guesses. With it, the engine only makes judgment calls at the edges.

**Population strategy:** Seed the graph for the FS CEO example first (10 topics fully wired). Then extend to cover the top 5 role × industry combinations. LLM-assist the bulk population — write a prompt that takes a topic name and outputs all 7 fields in JSON.

---

### Layer 2 — Rules Engine (5 automated checks, deterministic)

These are the exact questions asked during the brainstorm, encoded as TypeScript functions:

```typescript
// lib/curriculum/rules-engine.ts

// CHECK 1 — Interest Depth
// "Does the user's stated interest appear in ≥4 topics?"
function checkInterestDepth(interest: string, candidates: Topic[]): Topic[] {
  const interestTopics = candidates.filter(t => matchesInterest(t, interest))
  if (interestTopics.length < 4) {
    const expansions = getExpansions(interest) // from topic_catalog.expands_to
    candidates.push(...expansions)
  }
  return candidates
}

// CHECK 2 — Foundation Present
// "Are there 2-3 prerequisite foundation topics before the interest path?"
function checkFoundation(candidates: Topic[]): Topic[] {
  const foundation = candidates.filter(t => t.arc_position === 'foundation')
  if (foundation.length < 2) {
    const prerequisites = getPrerequisites(candidates[0]) // chain up requires[]
    candidates.unshift(...prerequisites)
  }
  return candidates
}

// CHECK 3 — Industry Mandatory Topics
// "Does the user's industry have non-negotiable topics?"
function checkIndustryMandatory(industry: string, candidates: Topic[]): Topic[] {
  const mandatory = getMandatoryTopics(industry) // topics where mandatory_for includes industry
  for (const topic of mandatory) {
    if (!candidates.find(c => c.slug === topic.slug)) candidates.push(topic)
  }
  return candidates
}

// CHECK 4 — Breadth Guard
// "Is there at least one topic that goes beyond the specific named tool?"
function checkBreadth(interest: string, candidates: Topic[]): Topic[] {
  const isProductInterest = isSpecificProduct(interest) // Claude, Copilot, Salesforce AI, etc.
  if (isProductInterest) {
    const hasComparative = candidates.some(t => t.arc_position === 'context')
    if (!hasComparative) candidates.push(getBreadthTopic(interest, userIndustry))
  }
  return candidates
}

// CHECK 5 — Data Strategy Guard
// "Does the curriculum include data infrastructure readiness?"
function checkDataStrategy(role: string, maturity: string, candidates: Topic[]): Topic[] {
  const needsDataStrategy = ['ceo', 'cto', 'cdo', 'cio'].includes(role) ||
                             maturity === 'intermediate' || maturity === 'advanced'
  const hasDataStrategy = candidates.some(t => t.slug === 'data-strategy')
  if (needsDataStrategy && !hasDataStrategy) {
    candidates.push(getTopicBySlug('data-strategy'))
  }
  return candidates
}
```

Rules run in order: Interest Depth → Foundation → Industry Mandatory → Breadth → Data Strategy.
Each rule only adds topics, never removes. The LLM layer handles removal.

---

### Layer 3 — LLM as Education Specialist (judgment calls only)

After the rules engine produces a scored candidate list, a single constrained Claude call handles what rules can't:

```
SYSTEM: You are a curriculum designer for executive education. You make only
structural decisions — sequencing, merging, splitting, and writing justifications.
You do not generate new topics. You work only with the candidate list provided.

USER: Given this candidate topic list for a [role] in [industry] at [maturity] level,
interested in [interest]:

[topic list with arc_position for each]

Do the following in order:

1. SEQUENCE: Enforce this arc — Foundation → Interest → Context → Deploy → Govern.
   Reorder any topic that violates this sequence. Do not change topic names.

2. MERGE: Identify any two topics that cover >60% of the same content for a [maturity]
   learner. Merge them into one session. Combine their subtopic lists.

3. SPLIT: Identify any topic that requires understanding >3 distinct concepts before
   moving on. Flag it for splitting. (For beginners: split. For advanced: keep merged.)

4. COUNT: Target 8-12 sessions total.
   If >12: move lowest role_relevance topics to Tier 4 (recommended next).
   If <8: check if any Tier 4 topics belong in the main curriculum.

5. JUSTIFY: Write one sentence per topic explaining WHY it is in this curriculum
   for this specific [role] + [industry] + [interest] combination.
   This sentence is shown to the user on the Curriculum Preview page.

Return JSON: { sessions: [{ slug, title, arc_position, justification }], tier4: [...] }
```

This call is constrained and auditable. The rules engine does the heavy lifting. Claude only sequences, merges, and writes the "why."

---

### Layer 4 — Validation (catches regressions, no LLM)

After the LLM pass, run rule-based assertions before saving to DB:

```typescript
// lib/curriculum/validator.ts

function validateCurriculum(curriculum: Topic[], input: UserProfile): ValidationResult {
  const errors: string[] = []

  if (curriculum.filter(t => t.arc_position === 'foundation').length < 2)
    errors.push('FAIL: fewer than 2 foundation topics')

  const interestTopics = curriculum.filter(t => matchesInterest(t, input.interest))
  if (interestTopics.length < 4)
    errors.push(`FAIL: interest "${input.interest}" appears in only ${interestTopics.length} topics`)

  const mandatory = getMandatoryTopics(input.industry)
  for (const m of mandatory) {
    if (!curriculum.find(t => t.slug === m.slug))
      errors.push(`FAIL: mandatory topic "${m.slug}" missing for industry "${input.industry}"`)
  }

  if (curriculum.length < 8 || curriculum.length > 12)
    errors.push(`FAIL: session count ${curriculum.length} outside 8-12 range`)

  const arcOrder = ['foundation', 'interest', 'context', 'deploy', 'govern']
  // check that arc_positions appear in correct order (no govern before foundation)
  validateArcSequence(curriculum, arcOrder, errors)

  return { valid: errors.length === 0, errors }
}
```

If validation fails → retry LLM call with the specific failures listed in the prompt (max 2 retries).
If still failing → use the role's default safe curriculum from `lib/curriculum/defaults/[role].ts`.

---

### How This Scales to Every Combination

| User | What the engine does automatically |
|------|------------------------------------|
| CEO · FS · Claude | Interest expansion (6 Claude topics) + FS mandatory (governance, model risk) + Data Strategy guard + arc: Know→See→Compare→Deploy→Govern |
| CTO · Healthcare · LLMs | Interest expansion (architecture, fine-tuning, RAG) + Healthcare mandatory (HIPAA, clinical AI safety) + Data Strategy (always for CTO) |
| CMO · Retail · Personalisation | Interest expansion (recommendation engines, AI personalisation) + no mandatory compliance + breadth guard adds competitive landscape topic |
| CFO · Any · AI ROI | Interest IS a role-mandatory topic — ROI becomes the spine, governance and risk wrap around it |
| Beginner · any role · any interest | Foundation layer is 3 topics, interest path starts simpler, deploy/govern layers are awareness-level not practitioner-level |
| Advanced · CTO · any interest | Foundation compressed (1 topic), interest goes deeper, deploy/govern layers are operational not conceptual |

**Maturity calibration:** maturity level does not change which topics appear — it changes the depth of subtopics within each session. A beginner CEO and an advanced CEO both study "AI Governance" — beginner's subtopics are conceptual framing, advanced user's subtopics are operational implementation.

---

### New Stories — Curriculum Engine Build

| ID | Story | Outcome | Complexity | Status |
|----|-------|---------|------------|--------|
| C-07 | Add graph fields to `topic_catalog` (`requires`, `expands_to`, `mandatory_for`, `arc_position`, `role_relevance`, `interest_keywords`) | Layer 1 data graph exists | M | Not started |
| C-08 | Seed graph data for FS CEO example (10 topics fully wired) — use as integration test fixture | Engine can be validated end-to-end before broad population | S | Not started |
| C-09 | LLM-assist bulk population of graph fields for top 50 topics | Graph covers most common combinations without manual work | M | Not started |
| C-10 | Build `lib/curriculum/rules-engine.ts` — 5 automated checks (Interest Depth, Foundation, Industry Mandatory, Breadth, Data Strategy) | Layer 2 rules engine | M | Not started |
| C-11 | Build `lib/curriculum/specialist.ts` — constrained LLM call for sequencing, merging, splitting, justification | Layer 3 education specialist | M | Not started |
| C-12 | Build `lib/curriculum/validator.ts` — assertion suite + retry logic + role default fallbacks | Layer 4 validation | M | Not started |
| C-13 | Integration test: CEO · FS · Claude · beginner → produces the 10-topic canonical curriculum exactly | Engine validated against the reference example | M | Not started |
| C-14 | Wire new curriculum engine into `app/api/topics/generate/route.ts`, replacing current implementation | New engine live in production | L | Not started |

---

---

## Reference Example: CEO in Financial Services, interested in Claude

> **Canonical test case.** Every piece of the curriculum engine must produce this output for this input.
> Validated through two rounds of education specialist review (2026-05-30).
> First version had Claude appearing in only 1 topic — corrected to the blended 10-topic list below.

**Input:** role=`ceo`, industry=`financial-services`, interest=`Claude`, maturity=`beginner`

---

### How the Engine Produces This Curriculum

**Step 1 — Role resolution**
CEO `primaryDomains`: `ai-ml`, `leadership`, `digital-transformation`, `finance`, `data-decisions`, `innovation`, `risk`

**Step 2 — Interest expansion (Interest Depth Rule)**
"Claude" → interest is a named product → must expand to ≥4 topics that fully cover it for this role + industry:
- `claude-fundamentals` — capabilities, design philosophy, Constitutional AI
- `claude-for-fs` — real FS use cases (document analysis, compliance drafting, research)
- `ai-vendor-eval` — Claude vs GPT vs Gemini (the CEO's actual decision)
- `claude-deployment` — Bedrock, Enterprise, API options at CEO awareness level
- `claude-safety-fs` — data privacy, model risk, FCA expectations (Claude-specific)

**Step 3 — Foundation prerequisite injection**
`claude-fundamentals` requires → `generative-ai-fundamentals`, `how-llms-work`
These are auto-injected before the interest path regardless of selection.

**Step 4 — Strategic context (Breadth Guard)**
Interest is a specific product → must add ≥1 comparative or landscape topic: `ai-in-finance-forecasting`
Must add Data Strategy: CEO with deployment intent + FS industry → `data-strategy` is non-negotiable.

**Step 5 — Industry mandatory overlay**
Financial Services mandatory topics: `ai-governance-risk` (FCA/SEC), `ai-security-privacy` (GDPR + model risk)
Merged into a combined Governance+ROI session to keep total to 10.

**Step 6 — LLM arc sequencing**
Sequence enforced: Foundation → Interest Deep → Context → Deploy → Govern

---

### Final Curriculum (10 sessions · ~250 minutes)

| # | Session | Arc Stage | Why it's here |
|---|---------|-----------|---------------|
| 1 | Generative AI Fundamentals | Foundation | Prerequisite — can't understand Claude without this |
| 2 | How Large Language Models Work | Foundation | Claude IS an LLM — this directly explains what it is |
| 3 | Claude: Capabilities, Design Philosophy & Constitutional AI | Interest | The spine — what the user asked for; Constitutional AI merged here (not a separate session for a beginner) |
| 4 | Claude for Financial Services: Real Use Cases | Interest | Claude in their exact context — document analysis, compliance, research, client comms |
| 5 | Data Strategy & Infrastructure | Context | Non-negotiable for FS CEO with deployment intent — Claude is only as good as your data |
| 6 | AI Vendor Evaluation: Claude vs GPT vs Gemini | Context | Now meaningful — they know Claude deeply first before comparing |
| 7 | AI in Finance & Forecasting (broader AI landscape) | Context | Breadth guard — peers use ML forecasting, credit scoring tools beyond Claude; CEO needs this for board conversations |
| 8 | Deploying Claude: Bedrock, Enterprise & API Options for FS | Deploy | Actionable — what does a Claude deployment actually look like at CEO level |
| 9 | AI Security, Privacy & Model Risk (all AI, not just Claude) | Govern | FCA, GDPR, Basel — applies across all AI tools, not Claude-specific |
| 10 | AI Governance, ROI & Board Justification | Govern | Merged governance + ROI — how to oversee and justify the Claude investment to the board |

**Learning arc:** Know it (1–3) → See it in context (4–5) → Compare it (6–7) → Deploy it (8) → Govern it (9–10)

### Tier 4 — Recommended next (shown after plan approval, not in initial curriculum)
- AI Regulation & Compliance — EU AI Act (unlocks after session 9)
- AI Competitive Intelligence (unlocks after session 7)
- Building an AI-Ready Culture (unlocks after session 10)
- Change Management for AI (unlocks after session 10)
> "4 more topics · ~80 minutes · to complete your FS CEO AI Readiness path"

### What the first curriculum got wrong (and why)
The first draft had "Claude" appearing in only 1 topic (AI Vendor Evaluation).
The user said "I want to learn about Claude" and received a generic AI curriculum with Claude as a footnote.
**The fix:** When a user names a specific product or tool, that product IS the spine of the curriculum — not one bullet in it.
Constitutional AI was originally a separate session — merged into Session 3 for beginners (too granular on its own).
Data Strategy was dropped — recovered because: FS + CEO + deployment intent = Data Strategy is mandatory, always.

### Subtopic personalization example: "Claude for Financial Services" (Session 4)
1. "How JPMorgan, Goldman, and HSBC are actually using Claude today — not the press releases, the real use cases"
2. "Document analysis at scale: how Claude reads 200-page prospectuses and flags what matters in 30 seconds"
3. "Compliance drafting with Claude: generating FCA-ready documentation without the billable hours"
4. "What you can and can't send to Claude — data classification for FS executives"
5. "The FS CEO's Claude starter kit: the 3 workflows to deploy in your first 90 days"

### Business model moment
- User balance: 120 min (standard pack)
- Plan needs: 250 min
- Gap shown: "130 more minutes to complete your FS CEO Claude path"
- Recommended pack: Standard Pack (120 min)

---

## Full Trial Funnel (Confirmed Design)

```
STEP 1 — Landing page
  "Start your free trial" CTA

STEP 2 — Onboarding questions (2 min, no account yet)
  Role → Industry → Maturity → What do you want to learn?

STEP 3 — Account creation (Clerk — email/Google)

STEP 4 — "Building your plan..." screen (10 seconds)
  TWO things happen IN PARALLEL immediately:
  ├─ [A] Full curriculum: 9 topics + per-topic justifications generated
  └─ [B] Orientation session content PRE-GENERATED ← background, fire-and-forget
           → Orientation selector picks best 1 subtopic for role+industry+interest
           → outline → script → template data → cached in DB (~33 seconds)
           → Marked ready BEFORE user finishes reading curriculum preview
  Both complete before user leaves this screen.

STEP 5 — Curriculum Preview page (FREE, no card yet)
  Full 9-topic list with per-topic justification (role+industry framing)
  Sessions 1-3 unlocked (foundation), sessions 4-9 shown with lock icon
  Time estimate shown: "9 sessions · ~225 minutes · at your pace"
  [Start my trial session →] CTA at bottom
  (Orientation content already ready in DB at this point)

STEP 6 — Card Collection (Stripe SetupIntent — NO charge yet)
  Plan selection: Starter / Pro / Executive
  Framing: "Your first session is free. We hold your card to prevent
            misuse of our trial — nothing charged until you confirm."
  Stripe embedded card form
  [Start my trial session →]
  While user types card details: orientation content has been ready for ~3-4 min

STEP 7 — Trial Session AUTO-LAUNCHES (no navigation, instant)
  Full Clio experience:
    → Clio voice intro (ElevenLabs)
    → Visual template (role+industry personalized)
    → 1 subtopic, ~8-10 min, complete insight
    → Checkpoint question (interactive)
    → Clio voice outro: "That's your trial session. Here's your full path..."
  Content loads instantly — pre-generated during Step 4.

STEP 8 — Post-trial Activation Screen (full-screen, one-click)
  "You completed your trial session."
  Shows full 9-topic curriculum again (reinforces value)
  "Activate [Pro Plan] — card ending in 4242 will be charged £X/month"
  [Confirm & Start Learning]    [Change plan]
  No re-entering card details. Lowest friction at highest intent moment.

STEP 9 — Full access unlocked
  All 9 sessions available in dashboard
  Sessions scheduled, ready to launch
```

---

## Decisions Made — Trial & Conversion

| Decision | What we decided | Why |
|----------|----------------|-----|
| Trial = aha session, not sampler | 1 complete, perfectly chosen subtopic in 8-10 min — full Clio voice + visual + checkpoint | Users decide in the aha window, not after 30 min |
| Show curriculum BEFORE payment | Full 9-topic list with per-topic justification shown free, before card entry | The curriculum IS the sales pitch — it's why they enter their card |
| Card collected BEFORE trial session | Stripe SetupIntent at Step 6 — no charge yet, plan selected here | Prevents abuse; by this point user has seen their plan and is leaning in so card friction is lower |
| Sessions 4-9 visible but locked | Specific session titles + justifications shown locked | "Unlock AI Governance & Risk — FCA/SEC compliance for FS" is more compelling than "unlock more content" |
| Paywall = one-click confirmation | After aha session, activation screen shows plan + last 4 of card + [Confirm] | No re-entering details — card already saved. Lowest possible friction at highest intent moment. |
| Orientation session is full Clio stack | Voice (ElevenLabs) + visual template + checkpoint question — nothing cut for trial | They should finish thinking "if that's ONE subtopic, imagine 9 full sessions" |
| Orientation session is role+industry+interest personalized | CEO in FS gets "Claude vs GPT for financial services"; retail COO gets something different | Generic trial session wastes the personalization advantage that justifies the subscription |
| Pre-generate orientation content in parallel | Fire generation during "Building your plan..." screen — content ready in ~33s, user takes 3-5 min to read preview + enter card | Zero wait when user clicks "Start session". Instant launch every time. |
| Reuse existing pipeline for orientation | Create a single-subtopic session and run existing outline→script→template→cache pipeline | No new pipeline to build or maintain. ~33s completion vs ~2.5 min for full session. |
| Static fallback per role | Pre-written orientation content for CEO/CTO/CFO/etc. served if pre-generation fails | Graceful degradation. Trial never breaks even if Claude API is slow. |

---

## Open Questions (To Resolve Today)

- Which domain do we start scaling content for first?
- What does "done" look like for a domain — all sessions generated? All QA passing?
- Do we generate content proactively (bulk, all sessions) or lazily (on first user visit)?
- What's the right cache TTL for content? 60 days is current default — is that right?
- When a topic in the catalog changes, do we auto-invalidate related cache rows?

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-30 | Subtopic slugs must always derive from session_plan titles, never Claude output | Claude paraphrases → slug mismatch → cache miss |
| 2026-05-30 | "All subtopics pipeline_status=ready" = success condition, even if session status lags | Step-6 race condition — content is there, status is wrong |
| 2026-05-30 | Fire-and-forget POST for content generation, poll GET | Awaiting 2-min POST causes ETIMEDOUT |
| 2026-05-30 | 4 roles: CEO/Product, Curriculum Architect, Technical (4 sub-roles), Content Ops | Clear ownership per layer |
| 2026-05-30 | Interest = the spine of the curriculum, not one topic in it | First draft had "Claude" in 1 of 9 topics — user would feel misled |
| 2026-05-30 | Named product interest (Claude, Copilot, etc.) must expand to ≥4 topics | Enforced by Interest Depth rule in the rules engine |
| 2026-05-30 | Data Strategy is mandatory for CEO/CTO/CDO with deployment intent | Most common real-world deployment failure; cannot be optional for these roles |
| 2026-05-30 | Industry mandatory topics are always included regardless of user's stated interest | FS → AI Governance + AI Security always. Regulatory protection, not optional |
| 2026-05-30 | Maturity changes subtopic depth, not which topics appear | Consistent topic set across maturity levels; personalization is at subtopic granularity |
| 2026-05-30 | 4-layer curriculum engine: Data Graph → Rules Engine → LLM Specialist → Validation | Deterministic where possible; LLM only for judgment calls (sequencing, merging, justifications) |
| 2026-05-30 | Canonical test case: CEO · FS · Claude · beginner → 10 sessions, specific arc | Every engine change must produce this output; it is the integration test fixture |
