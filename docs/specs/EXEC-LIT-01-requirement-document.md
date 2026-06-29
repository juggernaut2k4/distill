# EXEC-LIT-01: Executive Technical Literacy Topics — Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-06-29

---

## 1. Purpose

Executive users on the Clio platform currently receive topic recommendations in two sections — "Trending in your field" and "Decisions you need to own" — plus a third section of personal AI tools to be fluent in. Both the trending and decisions sections frame every topic at the decision-making level: what to do, what to govern, what to fund. This framing is correct for operational leadership, but it leaves a specific conceptual gap.

When a vendor tells a CEO that their model uses RAG so it will not hallucinate, the CEO has no framework to evaluate that claim. When a CTO proposes fine-tuning vs. prompt engineering for a use case, the CEO cannot interrogate the tradeoff. When an engineer says the context window is too small for a set of documents, the CEO does not know what that means for the contract they are about to sign. These are not technical skills. They are conceptual anchors — the minimum vocabulary required for an executive to be credible and effective in any AI conversation.

Without this section, an executive who completes the Clio programme remains dependent on their technical team for interpretation of every AI claim. With it, they can hold their own in a vendor demo, ask penetrating questions of their CTO, and identify when a technical assertion does not hold up. The section is not a tutorial track and must never be framed as one. It is the kind of explanation a trusted CTO would give a board member over dinner: precise, respectful of the listener's intelligence, and immediately applicable to the conversations they are already having.

---

## 2. User Story

As a senior executive (roleLevel: c-suite, vp-dir, vp-technology, or vp-product),
I want a dedicated section of topic recommendations that gives me conceptual technical understanding of how AI systems actually work,
So that I can evaluate vendor claims, ask penetrating questions of my engineering team, and not be misled by technical language I cannot yet assess.

---

## 3. Trigger / Entry Point

- Route: `/topics` (the existing topics recommendations page)
- Trigger: page load — the page calls `GET /api/topics/recommendations` with the user's stored profile (role, roleLevel, primaryDomain, subDomain, aiMaturity, learningGoal, domainProficiency)
- User state required: authenticated (Clerk session present), onboarding complete, roleLevel resolves to `executive` tier via `getRoleTier()` — i.e. roleLevel is one of `c-suite`, `vp-dir`, `vp-technology`, or `vp-product`
- The new section renders as part of the normal page load. There is no separate trigger, route, or user action required to reveal it.
- Manager and technical tier users do not reach this code path. Their `getRoleTier()` result is `manager` or `technical`, and they receive different system and user prompts with no `how_it_works` section.

---

## 4. Screen / Flow Description

This feature has no new screens, modals, or user flows. It is an additive data change to an existing page. The complete flow is:

**Step 1 — User opens `/topics`**
The page fetches `/api/topics/recommendations` with their profile. For executive-tier users, the API now calls Claude with an updated system prompt and user prompt that requests 4 sections.

**Step 2 — API returns 4 sections**
The response includes sections in this order:
1. `trending` — 4 topics — "Trending in your field"
2. `decisions` — 4 topics — "Decisions you need to own"
3. `how_it_works` — 5 topics — "How it actually works"
4. `tools` — 3 topics — "Tools to be fluent in"

`how_it_works` appears at position 3, between `decisions` and `tools`. This places it above the fold before the tools section on most desktop viewports.

**Step 3 — Page renders sections**
The existing `Section` component renders `how_it_works` using the same layout as the other three sections. The section header shows the label "How it actually works" and the `Lightbulb` icon. Each of the 5 topics renders as a topic card with title and description.

**Step 4 — Claude unavailable (fallback path)**
If Claude times out or returns an unparseable response, the API returns `MOCK_RESPONSE_EXECUTIVE` with the `fallback: true` flag. The mock now includes the `how_it_works` section with 5 hardcoded topics. The user sees 4 sections in the correct order. The fallback is structurally indistinguishable from the live response.

**Step 5 — Cache hit path**
If a cache entry exists for this user's profile hash (keyed at `v5`), the cached sections are returned directly. No Claude call is made. Because the cache key version is bumped from `v4` to `v5`, all existing executive-tier cache entries are treated as misses on the first request after deployment, triggering a fresh Claude call that includes the new section.

At no point does the user take any action to see the new section. It is present on every topics page load for executive-tier users.

---

## 5. Visual Examples

The following text wireframes describe only the new section. All surrounding sections (trending, decisions, tools) are unchanged in structure.

**State A — Section renders normally (live Claude response or mock fallback)**

```
┌─────────────────────────────────────────────────────────┐
│  [Section header]                                       │
│  💡 How it actually works              [Lightbulb icon] │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Why context window size changes what AI can    │   │
│  │  do for you                                     │   │
│  │  The single technical spec that determines      │   │
│  │  whether an AI tool can handle your real        │   │
│  │  workload.                                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  RAG vs fine-tuning: the question your vendor   │   │
│  │  is hoping you won't ask                        │   │
│  │  Two very different bets on where your data     │   │
│  │  lives and who controls it.                     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  [topic 3]                                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  [topic 4]                                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  [topic 5]                                      │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**State B — Section position in full page order**

```
┌─────────────────────────────────────────────────────────┐
│  📈 Trending in your field          [4 topic cards]     │
├─────────────────────────────────────────────────────────┤
│  💼 Decisions you need to own       [4 topic cards]     │
├─────────────────────────────────────────────────────────┤
│  💡 How it actually works           [5 topic cards]     │  ← NEW
├─────────────────────────────────────────────────────────┤
│  🔧 Tools to be fluent in           [3 topic cards]     │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

**Read from database:**
- `topic_recommendations_cache` table — queried by `profile_hash` (SHA-256 of `v5|tier|role|primaryDomain|subDomain|effectiveMaturity|learningGoal`). If a row exists, its `sections` JSONB column is returned directly. No schema change to this table is required.

**Written to database:**
- `topic_recommendations_cache` table — on a cache miss, the Claude response (4 sections including `how_it_works`) is written to `sections` JSONB with the `v5`-keyed hash. Existing `v4` rows are not deleted; they become unreachable because the key no longer resolves to them. They will expire naturally or be cleaned up by any existing TTL/cleanup jobs.
- `hit_count` and `last_used_at` are updated on cache hits (existing behaviour, unchanged).

**External API called:**
- Anthropic Messages API via `@anthropic-ai/sdk` — POST to Claude with the updated `SYSTEM_PROMPTS.executive` and `USER_PROMPTS.executive`. The response is a JSON string containing 4 sections. No change to model, `max_tokens`, or other call parameters.

**No localStorage or sessionStorage changes.** The topics page may cache the API response in component state for the duration of the page session, but this is existing behaviour and is not changed.

**In-memory constants changed (route.ts only):**
- `MOCK_RESPONSE_EXECUTIVE` — gains a fourth section entry in the `sections` array
- `SECTION_METADATA` — gains one new key-value entry
- `KNOWN_SECTION_KEYS` array in `shapeResponse()` — gains one new string element
- `buildCacheKey()` version prefix — changes from `'v4'` to `'v5'`
- `SYSTEM_PROMPTS.executive` — one sentence replaced
- `USER_PROMPTS.executive` — section count instruction and format line updated; framing paragraph for `how_it_works` added

---

## 7. Success Criteria (Acceptance Tests)

Each criterion is verifiable by a developer or QA agent without manual inspection of Claude's reasoning.

✓ Given a user with roleLevel `c-suite` opens `/topics`, when the page loads and Claude responds successfully, then the response contains exactly 4 sections with ids `trending`, `decisions`, `how_it_works`, `tools` in that order.

✓ Given the 4-section response, when the page renders, then a section with header text "How it actually works" and the `Lightbulb` icon is visible between the "Decisions you need to own" section and the "Tools to be fluent in" section.

✓ Given the `how_it_works` section renders, when a developer inspects `sections.find(s => s.id === 'how_it_works')`, then it returns a section object with exactly 5 topic entries, each having a non-empty `id`, `title`, and `description`.

✓ Given a generated `how_it_works` topic, when its `title` and `description` are checked, then neither field contains the words or phrases: "learn to", "step-by-step", "tutorial", "build", or "implement".

✓ Given Claude is unavailable and the fallback is served (`fallback: true`), when the topics page renders, then it still displays 4 sections including `how_it_works` with exactly 5 topics matching the hardcoded mock topics verbatim.

✓ Given a user with roleLevel `c-suite` who has an existing `v4` cache entry, when they load `/topics` after deployment, then the `v5` cache key produces a miss, a fresh Claude call is made, and the response includes the `how_it_works` section.

✓ Given a user with roleLevel `manager`, when they load `/topics`, then their response contains no `how_it_works` section — the manager tier is unaffected.

✓ Given a user with roleLevel `specialist`, when they load `/topics`, then their response contains no `how_it_works` section — the technical tier is unaffected.

✓ Given the `SECTION_METADATA` map, when `shapeResponse()` processes a Claude response containing a section with `id: 'how_it_works'`, then the rendered section has `label: 'How it actually works'` and `icon: 'Lightbulb'` — not the `'Circle'` fallback.

✓ Given the `SECTION_ICON_MAP` in `app/topics/page.tsx`, when the `how_it_works` section is rendered and `section.icon` is `'Lightbulb'`, then the `Lightbulb` component from lucide-react is used — not the `TrendingUp` fallback.

---

## 8. Error States

**Claude API unavailable or timeout:**
The existing fallback path activates. `MOCK_RESPONSE_EXECUTIVE` is returned with `fallback: true`. Because the mock now includes the `how_it_works` section, the user sees all 4 sections. No degraded state, no missing section, no error message.

**Claude returns parseable JSON but omits `how_it_works`:**
`shapeResponse()` builds sections from whatever keys Claude returned. A response with only `trending`, `decisions`, and `tools` will produce a 3-section page. This is not a crash — but it is a framing failure (Claude ignored the prompt instruction). It is handled the same way as today when Claude omits any section: the section is absent from the page, no error is shown. The QA acceptance test at criterion 1 above would catch this in testing.

**Claude returns `how_it_works` with fewer than 5 topics:**
`shapeResponse()` maps whatever topics are present. The section renders with however many topics Claude returned. No crash. The QA acceptance test at criterion 3 catches this in testing.

**`Lightbulb` icon not registered in `SECTION_ICON_MAP`:**
The page falls back to the `FALLBACK_SECTION_ICONS` map, which will also not contain `how_it_works` unless added, and then to the hardcoded default `'TrendingUp'`. This means the section renders with the wrong icon. This is why both `SECTION_ICON_MAP` and `FALLBACK_SECTION_ICONS` in `app/topics/page.tsx` must be updated as part of this change (see Section 12 — Dependencies).

**Cache write failure:**
Existing behaviour — the response is returned to the user regardless. The cache miss is logged. No user-visible impact.

**Cache read failure:**
Existing behaviour — a fresh Claude call is made. No user-visible impact.

---

## 9. Edge Cases

**First load after deployment — existing executive users with `v4` cache entries:**
The cache key is now `v5|...`. Any existing `v4` row does not match. The user gets a cache miss and a fresh Claude call on their first post-deployment load. The response will include `how_it_works`. On subsequent loads, the `v5` entry is served from cache. No action needed from the user or ops team.

**Executive users whose `v4` cache was written with `tools` as the third section:**
These rows are abandoned (unreachable via the `v5` key). They remain in the database but cause no harm — they are stale data with an unreachable hash. No migration or cleanup is required.

**User with roleLevel `vp-technology` or `vp-product`:**
`getRoleTier()` maps both to `executive`. They receive the updated executive prompt and the `how_it_works` section. No special handling needed.

**User with no `primaryDomain` or `subDomain` set:**
These fields default to `''` in the Zod schema. The user prompt template interpolates empty strings: `"${subDomain} within ${primaryDomain}"` becomes `" within "`. This is existing behaviour for all executive sections. The `how_it_works` section is domain-agnostic (same 5 topics regardless of domain when Claude generates them), so this edge case has no additional impact on the new section.

**`how_it_works` section in `advancedSections` collapse logic:**
The collapse logic is `maturity === 'beginner' && tier === 'technical'`. Executive tier never triggers this condition. The `how_it_works` section is never collapsed. No change to collapse logic is needed or permitted.

**Mock topics in the fallback serving an executive in a non-AI domain:**
The 5 hardcoded mock topics are domain-agnostic AI literacy topics. They are always served verbatim regardless of the executive's domain. This is intentional — the mock is a fallback, not a personalised response.

**User who adds a custom topic while `how_it_works` is present:**
Custom topic addition is an existing feature. It appends to the user's topic list and does not interact with section structure. No impact.

---

## 10. Out of Scope

This specification does not cover and developers must not implement the following:

- Changes to the manager tier system prompt, user prompt, mock data, or section structure.
- Changes to the technical tier system prompt, user prompt, mock data, or section structure.
- Changes to `MOCK_RESPONSE_TECHNICAL`, `MOCK_RESPONSE_TECHNICAL_BEGINNER`, or `MOCK_RESPONSE_MANAGER`.
- Changes to the onboarding flow, user profile schema, or how `roleLevel` is determined or stored.
- Changes to the topics page UI layout, the `Section` rendering component, or the topic card component.
- Changes to the `advancedSections` collapse/expand logic.
- Changes to the `topic_recommendations_cache` table schema (no new columns, no new indexes, no migration file).
- New API routes, database tables, or React components of any kind.
- Personalisation of the `how_it_works` section by domain, sub-domain, or maturity beyond what the updated system prompt and user prompt already instruct Claude to do. The mock always returns the same 5 topics.
- A manual cache wipe, migration, or backfill of existing `v4` cache rows.
- Any change to `MOCK_RESPONSE_EXECUTIVE`'s existing `trending`, `decisions`, or `tools` sections — topic count, topic content, labels, and icons for those three sections are unchanged.
- Any post-session processing, cron jobs, or content generation pipelines.

---

## 11. Open Questions

None.

All questions (Q1–Q10) from the feature brief have been answered by the CEO prior to this document being written. The answers are incorporated directly into the relevant sections above and into the verbatim copy in Section 12.

---

## 12. Dependencies

### Other files that must change as part of this spec

This spec covers one primary file and one secondary file. Both must be changed in the same deployment. Shipping only one will cause a broken state.

**Primary file: `app/api/topics/recommendations/route.ts`**

Five discrete changes are required:

**Change 1 — `MOCK_RESPONSE_EXECUTIVE` (around line 67)**
Add a fourth section to the `sections` array, in position 3 (after `decisions`, before `tools`). Verbatim section object:

```
{
  id: 'how_it_works',
  label: 'How it actually works',
  icon: 'Lightbulb',
  topics: [
    {
      id: 'why-context-windows-matter',
      title: 'Why context window size changes what AI can do for you',
      description: 'The single technical spec that determines whether an AI tool can handle your real workload.',
    },
    {
      id: 'rag-vs-finetuning-exec',
      title: 'RAG vs fine-tuning: the question your vendor is hoping you won\'t ask',
      description: 'Two very different bets on where your data lives and who controls it.',
    },
    {
      id: 'how-llms-generate-text',
      title: 'How LLMs actually generate text — and why that creates hallucination risk',
      description: 'One paragraph that will change how you read every AI-generated output.',
    },
    {
      id: 'model-size-exec',
      title: 'Why bigger models are not always better for your use case',
      description: 'Cost, latency, and fit — the tradeoffs your engineering team is already making without you.',
    },
    {
      id: 'training-cutoff-exec',
      title: 'What "training data cutoff" means for your AI vendor decision',
      description: 'The invisible expiry date on every AI model and why it matters for compliance.',
    },
  ],
}
```

**Change 2 — `SECTION_METADATA` (around line 504)**
Add the following entry to the map:

```
how_it_works: { label: 'How it actually works', icon: 'Lightbulb' },
```

**Change 3 — `KNOWN_SECTION_KEYS` in `shapeResponse()` (line 526)**
Add `'how_it_works'` to the array. The array currently reads:
```
['trending', 'skills', 'decisions', 'team', 'tools', 'role', 'goal']
```
It must become:
```
['trending', 'skills', 'decisions', 'team', 'tools', 'how_it_works', 'role', 'goal']
```

**Change 4 — `SYSTEM_PROMPTS.executive` (around line 382)**
Replace the current prohibition sentence:
```
Do NOT suggest topics on prompt engineering mechanics, API integration, model fine-tuning, MLOps, or any hands-on technical skill. These belong to their team, not to them.
```
With this replacement sentence:
```
Do not frame any topic as a tutorial, step-by-step guide, or skill-building exercise. Frame every topic — including technical ones — as insight a leader needs to make better decisions or ask better questions.
```

Also replace the current vocabulary restriction line:
```
Vocabulary: use "AI strategy", "AI governance", "competitive intelligence", "team enablement", "ROI", "risk framework" — not "tokens", "embeddings", "inference", "fine-tuning", "RAG".
```
With this replacement that permits conceptual technical vocabulary in the `how_it_works` section only:
```
Vocabulary for governance/strategy topics: use "AI strategy", "AI governance", "competitive intelligence", "team enablement", "ROI", "risk framework". Vocabulary for conceptual-literacy topics (how_it_works): technical terms such as "context window", "RAG", "fine-tuning", "training cutoff", "hallucination" are permitted — framed as concepts the executive needs to evaluate, not skills they need to build.
```

Then add the following paragraph to `SYSTEM_PROMPTS.executive`, after the existing rules block and before the final "Return ONLY valid JSON" instruction:

```
Include a section with id 'how_it_works', label 'How it actually works', icon 'Lightbulb', containing 5 topics. These are conceptual literacy topics — not implementation guides. Frame each as what a CTO would explain to a board member who asked 'how does that actually work?'. Each topic title should be a question or a direct insight, not a course name. Each description (max 20 words) should make the executive feel smarter for reading it, not like they are being taught.
```

**Change 5 — `USER_PROMPTS.executive` (around line 445)**
Replace the current section instruction block:
```
Return exactly 3 sections. Think from this executive's perspective — what do they need to own, decide, and understand about AI?

1. "trending" — 4 topics: urgent AI developments in ${subDomain} within ${primaryDomain} that this leader must be aware of right now.
2. "decisions" — 4 topics: the specific AI decisions, governance choices, and strategic calls that a ${role} in ${primaryDomain} needs to own. Frame each as a decision they must make.
3. "tools" — 3 topics: the AI tools this executive should be personally fluent in — not their team's tools, theirs.
```
With:
```
Return exactly 4 sections. Think from this executive's perspective — what do they need to own, decide, understand, and be fluent in?

1. "trending" — 4 topics: urgent AI developments in ${subDomain} within ${primaryDomain} that this leader must be aware of right now.
2. "decisions" — 4 topics: the specific AI decisions, governance choices, and strategic calls that a ${role} in ${primaryDomain} needs to own. Frame each as a decision they must make.
3. "how_it_works" — 5 topics: conceptual technical literacy — what a CTO would explain to a board member who asked "how does that actually work?". Frame each as understanding, not skill-building. Titles should be questions or direct insights. Descriptions (max 20 words) should make the executive feel smarter, not taught.
4. "tools" — 3 topics: the AI tools this executive should be personally fluent in — not their team's tools, theirs.
```

Replace the current format line:
```
Format: { "trending": [...], "decisions": [...], "tools": [...] }
```
With:
```
Format: { "trending": [...], "decisions": [...], "how_it_works": [...], "tools": [...] }
```

**Change 6 — `buildCacheKey()` (line 658)**
Change the version prefix from `'v4'` to `'v5'`:
```
// v5: bump invalidates v4 entries; adds how_it_works section to executive tier
const canonical = ['v5', tier, role, primaryDomain, subDomain, effectiveMaturity, learningGoal]
```

---

**Secondary file: `app/topics/page.tsx`**

Two changes are required. Without these changes, the `how_it_works` section will render with the wrong icon (`TrendingUp` fallback instead of `Lightbulb`).

**Change A — lucide-react import line (line 8)**
`Lightbulb` must be added to the named import from `lucide-react`. Current import:
```
TrendingUp, Briefcase, Wrench, Target, Code2, Users, Plus, ArrowRight, BookOpen, ChevronRight,
```
Required: add `Lightbulb` to this list.

**Change B — `SECTION_ICON_MAP` (line 58–66)**
Add `Lightbulb` as an entry in the map:
```
Lightbulb,
```

**Change C — `FALLBACK_SECTION_ICONS` (line 68–77)**
Add the following entry so the icon fallback resolves correctly even if `SECTION_METADATA` provides a key that does not match:
```
how_it_works: 'Lightbulb',
```

---

### Pre-conditions that must be true before build starts

- The `topic_recommendations_cache` table must exist (it does — existing feature).
- lucide-react must be installed at a version that exports `Lightbulb` (confirmed: `node -e "const lr = require('lucide-react'); console.log('Lightbulb' in lr)"` returns `true` in this repo).
- No database migration is required.
- No new environment variables are required.
- No new npm packages are required.
