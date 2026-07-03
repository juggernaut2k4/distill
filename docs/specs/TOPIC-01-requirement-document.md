# Topic Taxonomy & Curation Redesign — Requirement Document
Version: 1.2
Status: **CEO-APPROVED — 2026-07-02.** All 8 of 8 open questions fully RESOLVED with Arun's direct answers, including Q6 (altitude standard), explicitly confirmed by Arun ("sure proceed with the reason") on 2026-07-02. Zero open items remain. Cleared for Developer.
Author: Business Analyst Agent (drafted by CEO Agent in this pass — see note below)
Date: 2026-07-02 (Section 11 resolved 2026-07-02; Q6 explicitly confirmed by Arun 2026-07-02)

**Process note:** This document was authored directly by the CEO Agent in the same task as the Feature Brief, per explicit instruction not to stall on a delegated BA sub-task. It follows the standard BA Requirement Document template exactly. Section 11 has been resolved with Arun's direct answers on all 8 questions, including Q6, which Arun explicitly confirmed rather than leaving as a CEO inference. This document is CEO-APPROVED and cleared for Developer agents to build against.

---

## 1. Purpose

Clio's topic recommendation system currently hard-boxes every user into one of three fixed content tiers based on inferred role (`executive`, `technical`, `manager` — see `lib/curriculum/role-utils.ts`). Each tier's system prompt (`app/api/topics/recommendations/route.ts`) explicitly forbids content outside its lane: the executive prompt instructs Claude never to frame anything as "tutorial or skill-building," the manager prompt instructs Claude to exclude "hands-on model implementation" because "those are for their engineers." This means a VP who genuinely wants to learn how to use Claude day-to-day, or a developer who wants leadership content because they're on a promotion track, is structurally prevented from ever seeing it — the system doesn't fail to guess their interest, it actively excludes the category by design.

Separately, topic "altitude" is inconsistent and has no system-wide standard. Some tiers' prompts patch this locally (the `technical` tier prompt bans titles like "RAG Pipelines with Hybrid Search" in favor of bare names like "RAG"), but there is no rule applied across all three tiers or across the separate `topic_catalog` DB table (342 seeded rows), so narrow, unbrowsable topics can and do reappear.

Without this fix: users continue to receive a systematically incomplete view of what's available to learn, based on an assumption about their role that may be wrong or incomplete for that specific person. This directly contradicts Arun's stated product principle that content must be role-appropriate but not role-restrictive — real people have mixed intent.

---

## 2. User Story

**Story 1 — Executive with practical intent:**
As a VP of Technology,
I want to see topics on using Claude day-to-day, not just governance and vendor evaluation,
So that I can build my own AI fluency, not just make decisions about other people's use of it.

**Story 2 — Developer with leadership intent:**
As a Software Engineer preparing for a promotion to management,
I want to see leadership and team-enablement topics alongside technical ones,
So that the platform supports where I'm going, not just where I am today.

**Story 3 — Any user browsing topics:**
As any Clio user on the topic selection screen,
I want to see a small number of the most relevant sections up front, with the option to expand for more,
So that I'm not overwhelmed by a long, undifferentiated list.

---

## 3. Trigger / Entry Point

- **Route:** `/onboarding` (topic selection step) and `/topics` (post-onboarding "add more topics" flow) — both currently render via `app/topics/page.tsx`.
- **API trigger:** `POST /api/topics/recommendations`, called client-side on page load once the user's stored profile (`role`, `roleLevel`, `primaryDomain`, `subDomain`, `learningGoal`, `aiMaturity`, `domainProficiency`) is available.
- **User state required:** User must have completed enough of onboarding to have a role and at least a primary domain captured. No auth is currently required at this route (confirmed: the recommendations endpoint does not call Supabase or check session).
- **This document does not change the trigger mechanism** — it changes what happens inside the handler and what the UI does with the response, per the open questions in Section 11 (specifically Q3–Q4) which determine whether onboarding capture itself changes.

---

## 4. Screen / Flow Description

**Current state (as verified in code, `app/topics/page.tsx`):**
1. Page loads, infers `roleLevel` from stored profile via `inferRoleLevel()`.
2. Calls `/api/topics/recommendations`. Response is 3–4 `RecommendationSection[]` objects, each with a fixed `id`/`label`/`icon` determined entirely by the user's tier (executive gets `trending`/`decisions`/`how_it_works`/`tools`; technical gets `tools`/`concepts`/`apply`; manager gets `trending`/`team`/`tools`).
3. All returned sections render as full expanded grids (`Section` component, line 148) — every topic in every returned section is visible immediately, no collapsing except the one special-cased "Advanced topics" block for beginner-tier technical users.
4. User taps topic cards to select/deselect (multi-select, `selectedIds` state).

**Target state — RESOLVED per Section 11 (Q1, Q2, Q4, Q6):**
1. Page loads, calls a revised recommendations flow that scores/ranks topics for this specific user using the four-factor rubric (role/goal relevance, trending, practical usefulness, career-progression fit — Section 11 Q1), combining role signal and cross-cutting intent inferred from existing profile data (Section 11 Q3).
2. Response includes a numeric relevance score (0–100) per section/topic, determined by the Q1 rubric — not fixed by tier membership alone.
3. UI measures available above-the-fold viewport height on load and expands as many top-scoring sections as comfortably fit before requiring scroll (Section 11 Q2 — viewport-driven, not a fixed section count), with the remainder rendered as collapsed, tappable headers (generalizing today's one-off "Advanced topics" pattern to all sections).
4. Topic titles across all tiers conform to the altitude rubric in Section 11 Q6 (3–8 words, browsable shelf item) — granular mechanics (e.g., a specific technique) are not standalone topics; they live as sessions/lessons inside a broader topic. (Note: `topic_catalog` table is explicitly NOT retroactively audited against this rubric — see Section 11 Q5 deferral.)

Build sequence: prompt rewrite (steps 1–2, including mock/fallback update) ships first, UI restructuring (step 3) ships second — see Section 11 Q4 for full reasoning.

---

## 5. Visual Examples

**Current (verified):**
```
┌─────────────────────────────────────────────────┐
│  Choose your topics                              │
│                                                   │
│  📈 Trending in your field                       │
│  [Topic card] [Topic card]                       │
│  [Topic card] [Topic card]                       │
│                                                   │
│  💼 Decisions you need to own                    │
│  [Topic card] [Topic card]                       │
│  ...                                             │
│                                                   │
│  (beginner + technical tier only)                │
│  ▸ Advanced topics — unlock when you're ready    │
└─────────────────────────────────────────────────┘
```

**Proposed target — RESOLVED per Section 11 Q1/Q2/Q6:**
```
┌─────────────────────────────────────────────────┐
│  Choose your topics                              │
│                                                   │
│  [Top-ranked section 1 — expanded]               │   ┐
│  [Topic card] [Topic card]                       │   │ as many sections as fit
│                                                   │   │ above the fold at this
│  [Top-ranked section 2 — expanded]               │   │ viewport height
│  [Topic card] [Topic card]                       │   ┘ (Q2 — measured, not fixed)
│                                                   │
│  ▸ [Section 3 — collapsed, tap to expand]        │
│  ▸ [Section 4 — collapsed, tap to expand]        │
│  ▸ [Section 5 — collapsed, tap to expand]        │
└─────────────────────────────────────────────────┘
```
Section order is determined by the Q1 four-factor score (role/goal relevance, trending, practical usefulness, career-progression fit). Number of sections shown expanded is a runtime measurement of above-the-fold space, not a hardcoded count — a short mobile viewport may show only 1 section expanded, a tall desktop viewport may show more. Exact copy/button labels (e.g., collapse-header wording) remain an Engineering/copy implementation detail, consistent with BA practice of not inventing UI microcopy in the requirement document itself.

---

## 6. Data Requirements

**Read:**
- `users` table: `role`, `roleLevel`/inferred equivalent, `primary_domain`, `sub_domain`, `domain_proficiency`, `ai_maturity`, `learning_goal` (existing columns, confirmed in use by `/api/topics/recommendations` and `/api/topics/catalog`). Per Q3, these existing columns are the sole basis for inferring cross-cutting intent — no new column is added.
- `topic_catalog` table (~342 rows, 57 domains) — RESOLVED (Q5): remains a dead path, not revived, not audited/re-leveled against the Q6 altitude rubric as part of this feature.
- `topic_recommendations_cache` — profile-hash-keyed cache of prior LLM-generated sections (`app/api/topics/recommendations/route.ts`, `buildCacheKey`/`getCachedRecommendations`). Cache key structure needs revision (versioned key bump, as done previously for `v5`) since the response shape changes (per-section numeric score added) and prompt content changes (exclusions removed) — existing cached entries reflect the old tier-locked, unscored shape and must not be served as-is post-rollout.
- `role_topic_cache` — pre-generated cache keyed on role×industry×maturity, currently unused by the live path. RESOLVED (Q5): stays unused; not revived by this feature.

**Written:**
- RESOLVED (Q3): no new writes. No new intent-capture data is stored anywhere — mixed intent is inferred at read/generation time from existing `users` columns, not persisted separately.

**APIs called:**
- Anthropic Messages API (`claude-sonnet-4-6`) — existing integration in `/api/topics/recommendations/route.ts`. Prompt content changes per Q1 (scoring rubric) and Q6 (altitude rubric) and to remove hard category exclusions; the SDK call pattern does not need to change.

---

## 7. Success Criteria (Acceptance Tests)

Section 11 is now resolved; the following acceptance tests are finalized against those resolutions.

✓ Given a user whose role infers to the `executive` tier, when they load `/topics`, then at least one returned topic is NOT strategy/governance-framed (e.g., a practical tool-use topic can appear) — proving the hard category exclusion in the current executive system prompt has been removed.

✓ Given a user whose role infers to the `technical` tier, when they load `/topics`, then at least one returned topic can be leadership/team-oriented if their captured intent signal (inferred from existing profile fields per Q3) supports it — proving the hard exclusion in the current technical/manager prompts has been removed.

✓ Given the recommendations response, when rendered, then the number of sections shown expanded by default is determined by available above-the-fold viewport height at load time (Q2) — not a hardcoded count — and the remainder are shown as collapsed, expandable headers. Test must assert this behavior across at least two distinct simulated viewport heights (e.g., short mobile vs. tall desktop) to confirm the count actually varies.

✓ Given any topic title returned by the system (LLM-generated), when checked against the altitude rubric (Q6: 3–8 words, browsable shelf item, not a standalone narrow technique), then it conforms. `topic_catalog` rows are explicitly excluded from this test per the Q5 deferral (dead path, not read live).

✓ Given the Claude API is unavailable or returns unparseable output, when the fallback mock response is used, then the fallback also reflects the new ranking/section-visibility behavior (per-section score present, no hard tier exclusions), not the old fixed-tier mock shape (all 4 `MOCK_RESPONSE_*` constants in `route.ts` need review/rewrite, not just the live prompt).

✓ Given the response payload, when inspected, then each section/topic carries a numeric relevance score (0–100) reflecting the Q1 four-factor rubric (role/goal relevance, trending, practical usefulness, career-progression fit) — proving scoring is genuinely multi-factor, not a placeholder value.

✓ Given the existing `topic_recommendations_cache` contains entries from before this rollout, when a user hits `/topics` post-rollout, then a stale pre-rollout cache entry (old tier-locked, unscored shape) is not served — cache key must be version-bumped as part of this rollout (see Section 6).

---

## 8. Error States

- **Claude API failure/timeout:** existing 20s `AbortController` timeout and multi-strategy JSON parse recovery (`parseClaudeResponse`, strategies A–E2) are already robust and should be preserved. Fallback mock content must be updated to match the new (non-tier-locked) behavior — see Section 7.
- **Zod validation failure on request body:** existing behavior returns a safe manager-tier fallback. Since tier remains a valid role signal even after hard exclusions are removed (Q1 scoring still reads role), the manager-tier fallback can remain the safe default — it simply also carries neutral Q1 scores rather than a locked category set. No structural change needed here beyond the mock/fallback content update already required by Section 7.
- **Empty/malformed `topic_catalog` data:** N/A — per Q5, `topic_catalog` is not revived as a data source for this feature, so this error path does not apply.
- **Cache staleness:** RESOLVED per Section 6 — the `topic_recommendations_cache` key must be version-bumped (as done previously for `v5`) as part of this rollout, since old cached entries reflect the pre-rollout tier-locked, unscored response shape and must not be served post-rollout.

---

## 9. Edge Cases

- User with no `primaryDomain` / minimal onboarding data — today falls back to `getRoleTier('manager')`-equivalent default; new logic must define an equivalent safe default without relying on the tier system being removed.
- User whose inferred role is ambiguous (e.g., "Head of AI" — could infer specialist or executive) — `inferRoleLevel()` regex-based inference is fragile and already a known ambiguity source; this feature does not necessarily need to fix role inference itself, but ranking should be resilient to a wrong role guess (this is arguably the direct point of the "mixed intent" requirement — role fallback errors should matter less once the system also weighs non-role signals).
- Returning user vs. first-time user: returning users hitting `/topics` post-onboarding to add more topics should ideally benefit from any accumulated intent signal (session history, feedback) if that becomes part of ranking — otherwise they get identical treatment to a first-time load, which may be an under-build. Flagged for BA to size as in/out of scope.
- Beginner-maturity users: current system already collapses "Advanced topics" for beginners specifically. The redesign must decide whether maturity-based collapsing is a special case of the new general collapsing mechanism or a separate, additional rule layered on top.
- Mobile vs. desktop: `Section` grid is already responsive (`grid-cols-1 sm:grid-cols-2`); collapsing/expanding interaction needs the same responsive treatment, no new constraint identified.

---

## 10. Out of Scope

- Reworking `inferRoleLevel()`'s regex-based role inference logic itself — this feature addresses what the system does with role/intent signal, not how role is parsed from free text.
- **Reconciling the three role taxonomies** (`lib/content/taxonomy.ts` ROLES, `lib/learning/taxonomy.ts` ROLES, `lib/curriculum/role-utils.ts` roleLevel/RoleTier) — explicitly deferred per Section 11 Q5 as separate technical-debt cleanup tracked against `SCALING_PLAYBOOK.md` C-04. Not part of TOPIC-01.
- **Reviving `topic_catalog` / `role_topic_cache` as system of record** — explicitly deferred per Section 11 Q5. TOPIC-01 continues to use live LLM generation with caching; the dead-path catalog table is untouched.
- **Auditing/re-leveling existing `topic_catalog` rows** against the Q6 altitude rubric — out of scope per Q5, since the table isn't in the live read path.
- The prerequisite-based session-sequencing logic in `lib/content/curriculum.ts` (`buildCurriculum`, `groupIntoSessions`) — this is a downstream consumer of "which topics were selected," not the topic *selection/curation* surface this feature targets. Any topic-altitude changes may indirectly affect it, but restructuring session sequencing itself is not part of this feature.
- CURR-02 (recommended-for-you queue plumbing fix, already shipped earlier this session) — explicitly a separate, already-completed item; not to be reopened or conflated here even though it touches adjacent files (`app/api/curriculum/plan/route.ts`, `app/api/curriculum/generate/route.ts`).
- Onboarding flow redesign — RESOLVED per Section 11 Q3 as fully out of scope; no new onboarding capture is added by this feature.
- Any new external "trending topics" data feed or integration — Q1's trending factor is reasoned about qualitatively by the LLM within the existing Anthropic integration, not sourced from a new API (no new vendor is being added, consistent with the approved-libraries list in CLAUDE.md).

---

## 11. Open Questions — ALL RESOLVED 2026-07-02

**Q1: Ranking mechanism. RESOLVED: Hybrid, LLM-scored against explicit weighted criteria — not an arbitrary formula.**

Arun's instruction was to think through what actually makes a topic "important" for this user and design the ranking so it's genuinely good, not just pick a formula. The recommended approach:

At generation time, the Claude prompt in `app/api/topics/recommendations/route.ts` scores every candidate topic against four named criteria, and returns a numeric relevance score (0–100) per section/topic alongside the existing content:
1. **Role & stated-goal relevance** — does this map to the user's actual `role`, `roleLevel`, `learningGoal`, and captured domain/proficiency? (highest weight)
2. **Trending / high-demand in their industry** — is this a topic seeing elevated real-world attention in their `primaryDomain` right now (the prompt should reason about this qualitatively; no new external trending-data feed is being introduced in this feature)
3. **Practical/immediate usefulness** — can the user act on or apply this soon, vs. purely theoretical
4. **Career-progression relevance** — does this support where the user is *heading* (e.g., a promotion track), not just their current-role competence — this is the direct mechanism that satisfies User Story 2

The LLM returns a score per topic/section using these four factors as explicit named rubric items in the system prompt (not left to the model's own judgment of "importance"). Sections/topics are then sorted by score, and the top-scoring sections are what render expanded by default (see Q2). This is deliberately LLM-scored rather than a hand-tuned deterministic formula, because "trending" and "career-progression fit" are not signals we have clean structured data for — they require reasoning, which is what the LLM step is for. Full rubric wording is an Engineering/prompt-authoring task once this spec is approved, not specified further here.

**Q2: Default visible count. RESOLVED: Viewport-driven, not a fixed number.**

No hardcoded N. The UI measures available above-the-fold height on load (`window.innerHeight` minus header/nav chrome) and expands as many top-ranked sections (by Q1 score) as comfortably fit without requiring a scroll, subject to a minimum of 1 and a sensible implementation-time floor/ceiling for degenerate viewport sizes (e.g., very short mobile viewports still show at least the single top section expanded; very tall desktop viewports don't force excessive expansion beyond however many sections exist). This is a responsive display rule, not a content-ranking rule — ranking (Q1) determines *order*, viewport measurement determines *how many* of that ordered list render expanded before the rest collapse to tappable headers. Section 4 and Section 5 (wireframe) are updated accordingly below.

**Q3: Capturing cross-cutting intent. RESOLVED: No new onboarding capture.**

Mixed/cross-cutting intent is inferred purely from existing collected signals — `role`, `roleLevel`, `domainProficiency`, `learningGoal`, `aiMaturity`, and in-app behavior (session history, feedback, prior topic selections) where available. `app/onboarding/page.tsx` is unchanged by this feature. This also resolves the Section 6 "Written" ambiguity: **no new writes to `users` or a new intent-signals table are required for TOPIC-01.**

**Q4: Prompt strategy vs. UI-only change. RESOLVED: Both — sequenced prompt rewrite first, then UI restructuring.**

Arun wants both changes and delegated build sequencing to CEO judgment. Recommended order, with reasoning:

1. **Prompt rewrite first** (`app/api/topics/recommendations/route.ts`): remove the hard category exclusions in the three tier prompts, and introduce the Q1 scoring rubric so the API starts returning a relevance score per section/topic. Rationale: the UI progressive-disclosure work (step 2) is *consumed by* the ranking output — the UI can't sensibly decide what to expand/collapse until the API actually emits a real per-section score instead of a fixed tier-membership list. Building UI against fake/placeholder scores first would mean rebuilding it once real scores land. Also lower-risk to validate independently: the new prompt's output can be sanity-checked directly against the acceptance tests in Section 7 (e.g., "at least one non-strategy topic for executive tier") before any UI ships.
2. **UI restructuring second**: implement the viewport-driven expand/collapse (Q2) once the API reliably returns ranked, scored sections. This also naturally folds in the existing one-off "Advanced topics" collapse behavior into the new general mechanism (see Section 9 Edge Cases).
3. **Fallback/mock content update** (Section 7, `MOCK_RESPONSE_*` constants) should land alongside step 1, since the mocks must reflect the same non-tier-locked, scored shape — not as an afterthought.

**Q5: Reconciling the three role taxonomies. RESOLVED: Defer — do NOT fold into TOPIC-01. Reasoning below.**

Decision: TOPIC-01 does **not** reconcile `lib/content/taxonomy.ts` ROLES, `lib/learning/taxonomy.ts` ROLES, and `lib/curriculum/role-utils.ts` roleLevel/RoleTier into one system. This is logged as separate technical-debt cleanup, tracked against `SCALING_PLAYBOOK.md` C-04, NOT closed by this feature.

Reasoning: TOPIC-01's actual mechanism of change is (a) removing hard category exclusions from the prompt text and (b) adding a scoring layer on top of role signal — it reads role/tier data, it does not need all three taxonomies to agree with each other to do that. Reconciling three taxonomies is a genuine, separately-scoped migration (touching every call site of each of the three systems, with its own regression risk) that would roughly double this feature's blast radius for no functional gain toward the actual user stories (mixed-intent visibility, progressive disclosure). Bundling it in violates the "implement literally, don't over-build" principle — Arun asked for the topic curation problem to be fixed, not a taxonomy migration. If left unreconciled, the risk is purely maintenance friction (three sources of truth to keep mentally synced), not a user-facing defect, so it is safe to defer. Recommend opening a separate backlog item for the taxonomy unification, referencing C-04, to be picked up independently.

**On the related sub-question** (revive `topic_catalog`/`role_topic_cache` as system of record, or keep deprecated): also **deferred/kept as-is** for the same reason — the live LLM-generation + cache path is what TOPIC-01 modifies; reviving a dead table as a new source of truth is an unrelated architectural change, not required to fix the exclusion/altitude/visibility problems this feature targets.

**Q6: Altitude standard. RESOLVED — explicitly confirmed by Arun ("sure proceed with the reason").**

Because fixing topic altitude (narrow, unbrowsable topics reappearing) is literally named in Section 1 as one of the two core problems this feature exists to solve, CEO proposed applying an explicit rubric system-wide. Arun has explicitly confirmed this is correct: **YES — define and apply an explicit rubric system-wide**, specifically:

> A topic title must be a browsable "shelf item": 3–8 words, representing a coherent subject a user would recognize and choose to explore — not a single narrow implementation technique or mechanic. Granular techniques (e.g., "RAG Pipelines with Hybrid Search") live as sessions/lessons *inside* a broader topic (e.g., "Retrieval-Augmented Generation"), never as a standalone top-level topic.

Applied to: all three tier prompts in `app/api/topics/recommendations/route.ts`, and — per the Q5 resolution above — NOT retroactively audited against the currently-dead `topic_catalog` table, since that table isn't in the live read path and auditing it would be scope creep against an already-deferred system.

**Confirmed by Arun directly, not a CEO inference. No further confirmation required.**

**Q7: Rollout scope. RESOLVED by CEO code verification — no escalation needed, no conflict found.**

Verified directly via codebase search (`grep` across the live `app/` tree, excluding stale `.claude/worktrees/` agent branches): the only two production references to `/api/topics/recommendations` are `app/api/topics/recommendations/route.ts` itself and `app/topics/page.tsx`. No other page or component duplicates this call. Confirmed: both the first-time onboarding topic-selection step and the post-onboarding "add more topics" flow render through this single shared component/endpoint, so **a single fix covers both surfaces** — no separate rollout-scope decision or Arun escalation required.

**Q8: Rollout mechanism. RESOLVED: Feature flag / gradual rollout. Confirmed by Arun ("definitely toggle.").**

This ships behind a feature flag rather than as a direct replacement, given it changes the first-run experience for every new user on `distill-peach.vercel.app`. Flag name, default state, and rollback trigger are an Engineering implementation detail to be defined at build time, not specified further in this document.

---

## 12. Dependencies

- Existing `/api/topics/recommendations` endpoint and its Anthropic SDK integration (already built, to be modified not replaced from scratch).
- Existing `topic_recommendations_cache` table — already exists, requires a versioned cache-key bump (per Section 6/8) but no schema migration. `role_topic_cache` and `topic_catalog` remain unused/deferred per Q5 — not a dependency of this feature.
- `SCALING_PLAYBOOK.md` C-04 — explicitly NOT closed by this feature per Q5's resolution; remains open, tracked separately for the future taxonomy-reconciliation cleanup.
- No dependency on `app/onboarding/page.tsx` — RESOLVED per Q3, no new onboarding capture required.
- Feature-flag/rollout infrastructure for gradual rollout per Q8 — Engineering to confirm existing mechanism (env-var flag, user-percentage rollout, etc.) at build time.
- ROLE-01 (`docs/specs/ROLE-01-role-based-topic-differentiation.md` / requirement doc) — this feature directly modifies behavior ROLE-01 introduced. BA and CEO should treat TOPIC-01 as a refinement/supersession of ROLE-01's tier-locking mechanism, not a from-scratch rebuild, to avoid re-litigating already-settled role-framing decisions unnecessarily.
