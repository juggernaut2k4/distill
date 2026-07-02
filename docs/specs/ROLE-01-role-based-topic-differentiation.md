# Feature Brief: ROLE-01 — Role-Based Topic Differentiation
From: CEO Agent
To: Business Analyst Agent
Priority: P1
Date: 2026-06-25

---

## What Arun Said

The topic catalog and topic recommendations show the same set of topics regardless of whether the user is a VP/executive or a developer/IC. Examples of what should happen:
- A VP of Technology or C-Suite exec should see: "AI for Executives", "Leading AI Transformation", "Governing AI Risk", "AI Strategy for Leaders"
- A Developer/Engineer/Specialist should see: "Claude for Developers", "Prompt Engineering for Engineers", "Building AI-Powered Apps", "Agentic Systems in Production"
- A Manager/Team Lead should see topics in between — practical application, team productivity, evaluating AI tools

---

## The Problem Being Solved

Clio currently serves fundamentally different user populations — business executives making strategic decisions, technical practitioners building systems, and managers implementing tools at team level — but shows every user the same topic recommendations.

This creates three compounding failures:

1. **Wrong topics surface for the wrong people.** A C-suite exec sees "Prompt Engineering for Engineers" or "Agentic Systems in Production" — immediately signalling the product doesn't understand them. A developer sees "AI Strategy for Leaders" or "Governing AI Risk" — content that has zero practical utility for their day job.

2. **The mock fallback is the worst offender.** The hardcoded `MOCK_RESPONSE` in `/api/topics/recommendations/route.ts` (lines 46–142) is entirely executive-framed: "ChatGPT for Executives", "AI Governance for Leaders", "Building an AI Strategy". A developer or IC seeing this fallback gets content that is actively unhelpful to them.

3. **The live Claude path under-uses available context.** The recommendations endpoint receives `role`, `primaryDomain`, `subDomain`, `aiMaturity`, and `learningGoal` — but the system prompt is hardcoded as "senior AI learning advisor for executives" regardless of who is asking. A specialist or manager gets executive framing applied to their recommendations even though the LLM has their actual role.

The net effect: every user's first impression of Clio's personalisation is demonstrably wrong for anyone who is not a senior executive.

---

## What Success Looks Like

After this feature is built:

- A user who identified as a Developer/Engineer during onboarding sees technical topics ("Building Agentic Systems", "Prompt Engineering in Production", "Claude API for Developers") on the topics page — not board-level governance content.
- A C-Suite or VP/Director user sees strategic leadership content ("AI Strategy for Leaders", "Governing AI Risk", "Evaluating AI Vendors") — not hands-on coding topics.
- A Manager/Team Lead sees practical operational content ("AI Adoption Playbook for Teams", "Evaluating AI Tools for Your Function", "Measuring AI Productivity") — positioned between the two extremes.
- The mock fallback is also role-differentiated — if Claude is unavailable, the fallback still shows role-appropriate hardcoded content, not a single executive-only list.
- The seed-topics endpoint (`/api/admin/seed-topics`) already does partial role differentiation via `relevantRoles` on each topic row — this feature wires that signal into the recommendations flow.

---

## Current Architecture: What Each Layer Does and Doesn't Do

Understanding where the problem lives requires reading all three layers:

### Layer A: Topic Catalog (`topic_catalog` table, seeded via `/api/admin/seed-topics`)

The seed endpoint already computes `relevant_roles: string[]` per topic row using `getRolesForDomain()` from taxonomy. Role IDs in use here: `ceo`, `cto`, `coo`, `cfo`, `product-manager`, `developer`, `data-scientist`, `data-analyst`, `designer`, `marketing`, `hr`, `director`.

These are the taxonomy `ROLES` — a different vocabulary from the `roleLevel` values used in the curriculum planner (`c-suite`, `vp-dir`, `vp-technology`, `vp-product`, `manager`, `specialist`).

The `relevant_roles` column exists and is populated. It is not currently used to filter what a user sees.

### Layer B: Topic Recommendations (`/api/topics/recommendations`)

This is a pure Claude call — it does NOT query the `topic_catalog` table at all. It generates topic suggestions fresh each time from the user's profile stored in `localStorage` during onboarding.

The user prompt correctly includes `role`, `primaryDomain`, `subDomain`, `aiMaturity`, and `learningGoal`.

The critical bug is the system prompt: `'You are a senior AI learning advisor for executives.'` — this is hardcoded regardless of the user's actual role. A specialist or manager gets the same executive advisor framing, which biases the topics Claude generates toward executive content.

The mock fallback is a single executive-framed list with no role branching.

### Layer C: Curriculum Planner (`lib/curriculum/planner.ts`)

The planner is already fully role-differentiated. It uses `roleLevel` with six levels (`c-suite`, `vp-dir`, `vp-technology`, `vp-product`, `manager`, `specialist`) and generates entirely different system prompts per level, including framing instructions, audience labels, and depth caps. This layer is working correctly.

### Layer D: Onboarding → Profile stored in localStorage

The onboarding stores `role` (free-text job title) and `primaryDomain`/`subDomain`. It does NOT currently store `roleLevel` in localStorage. The `roleLevel` is only available server-side (inferred from the user's DB row in `/api/curriculum/generate`).

The topics page calls the recommendations endpoint using only `profile.role` (a free-text string like "CTO" or "Software Engineer") — not a structured `roleLevel` enum.

---

## Recommended Approach

### Fix Layer B first — it is the highest-impact, lowest-risk change.

The recommendations endpoint already receives `role` as a string. The fix is:

1. **Add a `roleLevel` field to the recommendations request body.** Derive it on the client side (topics page) using the same inference logic already in `/api/curriculum/generate` (lines 45–52 of that route). Store it in `localStorage` during onboarding or compute it inline before the fetch call.

2. **Replace the hardcoded system prompt** in `/api/topics/recommendations` with a role-adaptive one that changes framing, vocabulary, and topic type based on `roleLevel`. Three tiers are sufficient and safe to implement without over-engineering:
   - `executive` (covers c-suite + vp-dir): strategic intelligence, board-ready framing, no hands-on content
   - `technical` (covers specialist + developer persona): hands-on skills, implementation depth, applied content
   - `manager` (covers manager tier and ambiguous roles): operational and team-level, practical application

3. **Replace the single hardcoded `MOCK_RESPONSE`** with three role-differentiated fallback objects (executive / technical / manager). The topics page selects which one to use based on the `roleLevel` sent in the request body.

### Also fix Layer D (onboarding → localStorage): one small addition.

The client-side profile hash computation in the topics page (line 402–415) already uses `role` and `maturity`. It should also include `roleLevel` in the localStorage payload so the recommendations endpoint can receive it without re-deriving it from raw role text on every call.

### Do NOT change Layer A (topic catalog) or Layer C (planner) in this build.

- Layer A: The `relevant_roles` column exists but is not used by the recommendations flow (which doesn't query the catalog). Wiring it in would require either: (a) changing the recommendations endpoint to query Supabase instead of calling Claude, or (b) using the catalog topics as context fed into the Claude prompt. Both are viable future enhancements but are out of scope here — the simpler system-prompt fix delivers the core user value with less risk.
- Layer C: Already working correctly. No changes.

---

## Role-Level Definitions for the BA Spec

The BA must define what topics are appropriate per roleLevel. Below is the directional guide — the BA must validate exact examples against the topic catalog before finalising.

| roleLevel | Who they are | What they should see | What they must NOT see |
|---|---|---|---|
| `c-suite` | CEO, CFO, COO, CMO, CHRO | AI strategy, governance, board communication, vendor evaluation, ROI frameworks, competitive intelligence | Hands-on coding, API integration, model fine-tuning, prompt engineering mechanics |
| `vp-dir` | VP, SVP, Director (non-technical function) | Same as c-suite but with more team enablement, less board framing | Same exclusions as c-suite; also exclude pure execution/IC content |
| `vp-technology` | VP of Technology, CTO | AI for technical infrastructure, build-vs-buy, security architecture, model evaluation, engineering team adoption | Board-level P&L framing; product roadmap content |
| `vp-product` | VP of Product, Head of Product | AI feature strategy, model integration in products, latency/cost as product constraints, competitive differentiation | Infrastructure/procurement framing; board P&L content |
| `manager` | Manager, Team Lead | AI tools adoption, team productivity, practical application, evaluating tools for the function | Board-level governance; deep technical implementation |
| `specialist` | Developer, Engineer, Data Scientist, IC | Hands-on skills, API usage, prompt engineering, agentic systems, MLOps, technical evaluation | Executive governance framing; strategic/board content |

---

## Known Risks and Edge Cases

### 1. Two vocabularies: ROLES (taxonomy) vs roleLevel (planner)
The `topic_catalog.relevant_roles` column uses taxonomy role IDs (`ceo`, `developer`, etc.). The planner uses `roleLevel` (`c-suite`, `specialist`, etc.). Any future work connecting Layer A to the recommendations flow must include a mapping table. The BA spec should document this mapping explicitly.

### 2. roleLevel is not stored in localStorage today
The topics page computes profile data from `clio_onboarding` in localStorage. `roleLevel` is not currently stored there — it is only computed server-side. The fix must either: (a) add `roleLevel` to the localStorage payload written during onboarding, or (b) re-derive it in the topics page from `profile.role` using the same regex inference already in `/api/curriculum/generate`. Option (b) is simpler and avoids a migration.

### 3. sessionStorage caches recommendations per session
Line 239 of the topics page reads from `sessionStorage.getItem('clio_topic_recs')`. If a user's recommendations were cached under their old role and they re-visit the page in the same browser session, they see stale results. The cache key should include `roleLevel` to bust correctly when role changes. The BA spec must address this.

### 4. Mock fallback is shown to users even in production when Claude times out
The fallback is not a dev-only guard — it is shown to real users on API timeout or failure (20s timeout). All three role-differentiated fallback lists must therefore be high-quality, genuinely representative examples, not placeholder text.

### 5. User picks cross-role topics (custom input field)
Users can type any topic into the "Add your own topic" field. This bypasses role filtering entirely and is correct behaviour — the custom input is intentionally unconstrained. The fix should not break this.

### 6. Topic catalog gap: specialist/developer topics may be sparse
The seed-topics endpoint generates content per domain using `ROLES` from taxonomy, and it does assign `relevant_roles` including `developer`, `data-scientist` etc. However the catalog has never been queried in the recommendations flow, so it is unknown whether the seeded content is high-quality for technical audiences. The BA spec should note this gap but the fix does not depend on catalog quality — the Claude-generated recommendations path is independent of the catalog.

---

## What Needs BA Spec Before Build Starts

The BA must define and document all of the following before any code is written:

1. **roleLevel derivation on the client side**: exact regex/logic to map free-text `role` string to `c-suite | vp-dir | vp-technology | vp-product | manager | specialist`. Must match what the server already uses in `/api/curriculum/generate` lines 45–52. Should this live in a shared utility function?

2. **Three system prompts for the recommendations endpoint**: full text of executive / technical / manager system prompts. Must specify vocabulary, tone, prohibited topic types, and what "good" looks like for each audience.

3. **Three fallback MOCK_RESPONSE objects**: complete hardcoded topic lists for executive / technical / manager tiers. Each must have 4 sections (trending, role, tools, goal) with the correct topic counts matching the current structure.

4. **sessionStorage cache key**: should `clio_topic_recs` become `clio_topic_recs_${roleLevel}` to bust on role change? Or should the cache be cleared on every visit? BA to recommend.

5. **Acceptance criteria**: at minimum, three browser-testable scenarios — one per tier — confirming the correct topic framing appears for each roleLevel.

6. **Files to change**: confirm scope. Expected list: `app/topics/page.tsx`, `app/api/topics/recommendations/route.ts`. Confirm nothing else changes.

7. **Does `roleLevel` need to be added to the localStorage payload during onboarding?** If yes, BA must spec which onboarding step writes it and what the key name is. If no (re-derive inline), BA must confirm the re-derivation happens in the topics page before the fetch call, not inside the API route.

---

## Does This Require a DB Migration?

No. This fix is entirely in application code:
- `app/api/topics/recommendations/route.ts` — system prompt change + fallback branching
- `app/topics/page.tsx` — roleLevel derivation + pass to API + cache key update

No new DB columns. No migration. The `topic_catalog.relevant_roles` column already exists and is not touched by this build.

---

## Questions for BA

1. Should the roleLevel derivation be extracted into a shared utility (e.g. `lib/curriculum/role-utils.ts`) that both the topics page and `/api/curriculum/generate` import? This would eliminate duplication of the inference regex. Recommend: yes, but only if it does not block the build — the BA should assess complexity.

2. The recommendations system prompt currently says "for executives." What is the exact wording for the technical and manager variants? The BA must write these out in full — do not leave as directional notes.

3. For `vp-technology` and `vp-product`: should these get distinct system prompt variants, or are they folded into a single `executive` tier for the recommendations step? The planner treats them as distinct. The BA should decide based on whether the topic-selection stage (pre-curriculum) benefits from that level of differentiation.

4. If the Claude API call returns topics that are role-mismatched despite the new system prompt (hallucination risk), should there be a client-side filter guard, or do we trust Claude + the new prompt? BA to recommend.
