# Feature Brief: TOPIC-01 — Topic Taxonomy & Curation Redesign
From: CEO Agent
To: Business Analyst Agent
Priority: P1
Date: 2026-07-02

---

## What Arun Said

The system currently shows users a narrow, role-boxed set of topics. A VP in Technology only sees strategy/leadership/vendor-comparison topics, never "learn what the tool itself actually does." This is wrong: real people have cross-cutting intent regardless of role — a developer might genuinely want leadership content because they're going for a promotion; a VP might genuinely just want to learn how to use Claude day-to-day, not approve budgets for it. This principle applies to EVERY role and EVERY category (tools, domains, concepts) — not just tools, not just VPs.

Separately: the current topic list has the wrong "altitude." Example given: "API for chaining" as a topic is too narrow/specific — nobody browses a list and picks that. Either "API" should be the topic with "chaining" as one lesson inside it, or vice versa — but topics need to sit at a sensible browsing altitude, with granular mechanics living as sessions inside a topic, not as the topic itself.

On the interface: don't dump a flat list. Show the most interesting/logical topics as visible section headers; collapse the rest so the user can expand a section to see more.

The core ask: the system needs to genuinely identify which tools/domains/topics a given person is likely to care about — accounting for mixed intent — rather than mechanically generating from a fixed role-to-topic-category mapping.

Confirmed directly by Arun: this is approved to proceed to spec.

---

## The Problem Being Solved

**Confirmed by direct code inspection** (not assumed — re-verified in this session):

1. **Rigid role-tier boxing is real and is the live code path.** `app/topics/page.tsx` calls `POST /api/topics/recommendations` (`app/api/topics/recommendations/route.ts`), which buckets every user into exactly one of three tiers via `getRoleTier()` in `lib/curriculum/role-utils.ts`: `executive`, `technical`, or `manager`. Each tier has a hardcoded system prompt (lines 404–444) that explicitly forbids cross-tier content — e.g. the executive prompt says "Do not frame any topic as a tutorial... skill-building exercise," and the manager prompt says "Do NOT suggest topics on hands-on model implementation... those are for their engineers." This is precisely the mechanical role→category mapping Arun described, and it hard-blocks the exact scenarios he gave (a VP wanting daily-use Claude tips, a developer wanting leadership content).

2. **This tier system was itself a deliberate prior feature (ROLE-01, approved 2026-06-25)**, which intentionally built role-differentiated prompts to stop showing identical topics to everyone. TOPIC-01 does not reverse the goal of role-appropriate framing — it corrects the side effect: role should influence weighting/relevance, not act as a hard content-category gate.

3. **Two parallel topic systems confirmed still coexisting:**
   - `lib/content/curriculum.ts` — a hardcoded ~22-entry array with `prerequisites`, used for prerequisite-aware session sequencing. Titles here (e.g. "AI Governance & Risk," "Measuring AI ROI") are reasonably altitude-correct.
   - `topic_catalog` DB table (~342 rows / 57 domains, seeded via `app/api/admin/seed-topics/route.ts`), queried by `app/api/topics/catalog/route.ts` with real role-filtering (`.contains('relevant_roles', [userRole])`) and a `role_topic_cache` pre-generation layer — **but this endpoint is confirmed NOT called by the live topics page.** The live page only calls `/api/topics/recommendations`, which generates topics fresh via an LLM call every time (with a `topic_recommendations_cache` keyed on profile hash) and never touches `topic_catalog` or `role_topic_cache` at all.
   - `SCALING_PLAYBOOK.md` row **C-04** already logs this exact fragmentation as a known, unstarted backlog item ("Replace hardcoded 23-topic AI catalog in `curriculum.ts` with `topic_catalog` DB queries — One catalog, not two disconnected systems," size L, status Not started). TOPIC-01 should resolve C-04 as part of this work, not as a separate future task.

4. **Three non-reconciled role/taxonomy vocabularies confirmed:**
   - `lib/content/taxonomy.ts` — `ROLES` = 8 generic free-text strings (e.g. `'CEO / MD / President'`). Used by the legacy `matchContentToUser`/`ContentItem` system; not the live topic flow.
   - `lib/learning/taxonomy.ts` — `ROLES` = 12 structured `Role` objects, each with explicit `primaryDomains`/`otherDomains` arrays (e.g. `cto` → primaryDomains `['ai-ml','devops','software-arch',...]`). This is the fixed role→domain mapping structure Arun is objecting to in principle; it drives `/api/topics/catalog` (the dead-path endpoint) and onboarding/seeding.
   - `lib/curriculum/role-utils.ts` — a third vocabulary: `roleLevel` (`'c-suite' | 'vp-dir' | 'vp-technology' | 'vp-product' | 'manager' | 'specialist'`) inferred from free text, then collapsed via `getRoleTier()` into the three `RoleTier` buckets that actually drive the live recommendation prompts.
   These three systems do not share IDs or a common source of truth, and a role like "VP of Technology" can be classified differently by each.

5. **Altitude problem partially confirmed, not literally reproduced.** The literal string "API for chaining" was not found in the current codebase (`lib/content/curriculum.ts` topics are generally board/decision-level and reasonably scoped). However, the live LLM-generated `technical` tier prompt explicitly instructs Claude to produce topic titles as bare tool/concept names ("Claude," "RAG," "MCP") with a rule against titles like "RAG Pipelines with Hybrid Search" — showing the team has already hit this altitude problem once and patched it locally within one tier's prompt, rather than establishing a system-wide altitude standard. The risk of narrow/mis-leveled topics reappearing (in `topic_catalog`'s 342 seeded rows, in other tiers' prompts, or in future prompt edits) is real and unaddressed structurally.

6. **UI already does partial progressive disclosure, not none.** `app/topics/page.tsx` renders grouped `RecommendationSection[]` (not a flat list) and has one collapsible block: an "Advanced topics — unlock when you're ready" section (line ~617) shown only when `maturity === 'beginner'` and populated only for the `technical` tier's beginner fallback. There is no general "show top sections, collapse the rest, let user expand for more" pattern across all sections/tiers — today's collapsing is a single special case (advanced-for-beginners), not the general progressive-disclosure UX Arun described.

---

## What Success Looks Like

- A user's topic recommendations reflect their *actual* likely interests — a blend of role-typical relevance and cross-cutting personal intent (promotion track, tool fluency, curiosity) — rather than being hard-gated to one of three fixed content categories by role.
- Every role and every category (tools, domains, concepts, strategy) can surface for any user when genuinely relevant; role shifts weighting/likelihood, not eligibility.
- Topics sit at a browsable "shelf" altitude — specific enough to be meaningful, broad enough to browse — with granular mechanics (e.g. "chaining") living as sessions/lessons inside a topic rather than as standalone topics.
- The topics page shows a curated set of headline sections/topics by default, with the option to expand for more — not a flat wall of topics, and not the single hardcoded "Advanced topics" special case that exists today.
- The system has one coherent topic source of truth (resolves `SCALING_PLAYBOOK.md` C-04) rather than two disconnected catalogs.

---

## Known Constraints

- Do not regress the legitimate part of ROLE-01: role-appropriate framing/vocabulary (an executive should still not see a raw implementation tutorial framed as "how to build") should still generally happen — the fix is to stop role from being a hard content-category gate, not to remove role-awareness entirely.
- No code starts until the BA spec is written and CEO-approved per the governance model in this repo's `CLAUDE.md`.
- Must only use approved libraries/vendors already in this project (Anthropic SDK, Supabase). No new vendor calls.
- Must not break onboarding or the live topics page in production (`distill-peach.vercel.app`) during rollout — BA should specify whether this ships behind a flag or as a direct replacement.

---

## Questions for BA

1. **Ranking mechanism:** How should "most interesting/logical" topics be determined for the default-visible section headers — LLM-scored relevance, a fixed scoring formula (role match + intent signal + popularity), or something else? Needs a concrete, testable definition, not "show the good ones."
2. **Default visible count:** How many sections/topics are visible by default vs. collapsed? Needs a specific number with rationale (not "a reasonable amount").
3. **Capturing cross-cutting intent:** Does this require new onboarding capture (e.g. an explicit "what do you want to get out of this" free-text or multi-select field), or should mixed intent be inferred purely from existing signals (role, domain proficiency, learning goal, in-app behavior)? If new capture is needed, does it touch the onboarding flow (`app/onboarding/page.tsx`) and is that in scope for TOPIC-01 or a separate follow-up?
4. **Prompt strategy vs. UI-only change:** Is this primarily a new LLM prompt/generation strategy (replacing or substantially rewriting the three tier-locked system prompts in `app/api/topics/recommendations/route.ts`), primarily a UI restructuring (progressive disclosure), or both? The brief implies both, but BA should size and sequence them explicitly since they can likely ship independently.
5. **Reconciling the three role taxonomies:** Should TOPIC-01 unify `lib/content/taxonomy.ts` ROLES, `lib/learning/taxonomy.ts` ROLES, and `lib/curriculum/role-utils.ts` roleLevel/RoleTier into one system as part of this feature, or is that a separate technical-debt cleanup ticket? Given `/api/topics/catalog` + `role_topic_cache` currently sit dead/unused behind the live LLM-generation path, BA should also recommend whether to deprecate that path, revive it as the new source of truth, or continue leaving it unused.
6. **Altitude standard:** Should the BA define an explicit topic-altitude rubric (e.g. "topic = ~3-8 words, browsable as a shelf item; anything more granular becomes a session/lesson within a topic") that applies system-wide (all three tiers' prompts, plus `topic_catalog` seeding), and should existing `topic_catalog` rows be audited/re-leveled against it?
7. **Resolving C-04:** Should this feature formally close out `SCALING_PLAYBOOK.md` row C-04 (single catalog, not two disconnected systems) as part of its scope, given the two systems are directly relevant to this redesign?
8. **Rollout scope:** Does this apply to first-time onboarding topic selection only, the ongoing `/topics` page (post-onboarding "add more topics" flow), or both? Confirm both surfaces call the same endpoint today (`/api/topics/recommendations`) per this investigation, so a single fix likely covers both — BA should confirm no other surface independently duplicates this logic.
