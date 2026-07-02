# ROLE-01: Role-Based Topic Differentiation — Requirement Document
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-06-25

---

## 1. Purpose

The topic recommendations page shows every user an identical set of AI topics regardless of whether they are a C-suite executive, a software engineer, or a team manager. The hardcoded system prompt in `/api/topics/recommendations/route.ts` instructs Claude to act as "a senior AI learning advisor for executives" — so even when a developer or IC visits the page, they receive board-governance and AI-strategy topics that have no practical utility for their daily work.

The mock fallback (shown to real users on API timeout) compounds the problem: it is an entirely executive-framed list. A specialist seeing "ChatGPT for Executives" or "AI Governance for Leaders" as their first impression of Clio's personalisation will immediately conclude the product does not understand them.

Without this fix: every non-executive user's first interaction with Clio's topic selection is demonstrably wrong, eroding trust at the moment that matters most.

---

## 2. User Stories

**Story 1 — Executive tier (c-suite and vp-dir)**
As a C-suite executive or VP/Director,
I want to see AI topics framed around strategy, governance, and leadership,
So that I can build confidence in AI decisions I am accountable for without wading through hands-on technical content that is irrelevant to my role.

**Story 2 — Technical tier (specialist)**
As a developer, engineer, data scientist, or other technical specialist,
I want to see AI topics framed around implementation, tooling, and applied skills,
So that I can deepen technical capabilities that are directly applicable to my daily work.

**Story 3 — Manager tier (manager)**
As a team manager or team lead,
I want to see AI topics framed around team adoption, practical tools evaluation, and operational application,
So that I can equip my team with AI without needing either board-level governance or deep implementation knowledge.

---

## 3. Functional Requirements

**FR-01** — The recommendations API must accept a new optional field `roleLevel` in its request body. Valid values: `c-suite | vp-dir | vp-technology | vp-product | manager | specialist`. Invalid or missing values default to `manager`.

**FR-02** — The recommendations API must select one of three system prompts based on the `roleLevel` received:
- `c-suite` and `vp-dir` → executive system prompt
- `vp-technology` and `vp-product` → executive system prompt (these roles receive the same top-level topic framing as c-suite/vp-dir at the recommendations stage; the curriculum planner, which is already correct, provides the deeper differentiation)
- `manager` → manager system prompt
- `specialist` → technical system prompt
- null, empty, or unrecognised value → manager system prompt (safest neutral default, matching the inference fallback in the curriculum route)

**FR-03** — The three hardcoded fallback objects (MOCK_RESPONSE_EXECUTIVE, MOCK_RESPONSE_TECHNICAL, MOCK_RESPONSE_MANAGER) must each contain exactly 4 sections (trending, role, tools, goal) with 4 / 3 / 3 / 3 topics respectively, matching the structure of the existing MOCK_RESPONSE.

**FR-04** — The topics page must derive `roleLevel` from `profile.role` (free-text string stored in `clio_onboarding` in localStorage) using the same inference regex that exists in `/api/curriculum/generate/route.ts` lines 45–52. This derivation must happen inline in the topics page before the fetch call, not inside the API route.

**FR-05** — The `roleLevel` value must be included in the POST body sent to `/api/topics/recommendations`.

**FR-06** — The sessionStorage cache key must change from `clio_topic_recs` to `clio_topic_recs_${roleLevel}` so that a user whose role changes between sessions does not see stale executive-framed recommendations cached from a previous visit.

**FR-07** — When the API returns `fallback: true`, the topics page must select the correct role-differentiated fallback object client-side based on the derived `roleLevel`, not the API route (because the API timeout path cannot know which fallback was sent — all fallback paths in the route already return `MOCK_RESPONSE.sections`; the client now replaces that with its own role-aware selection).

**FR-08** — The `inferRoleLevel` function must be extracted into a shared utility file at `lib/curriculum/role-utils.ts` and imported by both `app/topics/page.tsx` and `app/api/curriculum/generate/route.ts`. This eliminates duplication and ensures both paths use identical logic.

**FR-09** — The custom topic input field (free-text "Add your own topic") must not be affected. It remains completely unconstrained by role.

**FR-10** — No database migration is required. No changes to the `topic_catalog` table, the `users` table, or the curriculum planner.

---

## 4. Three System Prompts (Full Text)

### System Prompt A — Executive (applies to roleLevel: c-suite, vp-dir, vp-technology, vp-product)

```
You are a senior AI learning advisor for business leaders and executives. Your audience holds titles such as CEO, CFO, COO, CMO, CTO, VP, SVP, and Director. They are accountable for AI decisions at organisational scale — budgets, risk, competitive positioning, and team capability — but they do not write code or build models themselves.

Generate personalised AI topic recommendations for this leader based on their profile. Every topic you suggest must be immediately relevant to someone making strategic, operational, or leadership decisions about AI.

Rules for topic selection and framing:
- Frame every topic at the decision-maker level: what do they need to know to lead, evaluate, govern, or invest in AI — not how to build it.
- Prioritise topics that build confidence in AI conversations at board level, with vendors, with regulators, and with their own teams.
- Include topics on AI governance, risk, ROI, vendor evaluation, and competitive strategy — these are the executive's primary AI responsibilities.
- Do NOT suggest topics on prompt engineering mechanics, API integration, model fine-tuning, MLOps, or any hands-on technical skill. These belong to their team, not to them.
- Vocabulary: use "AI strategy", "AI governance", "competitive intelligence", "team enablement", "ROI", "risk framework" — not "tokens", "embeddings", "inference", "fine-tuning", "RAG".

Return ONLY valid JSON matching the specified schema. Be specific and practical — every topic must be immediately relevant to someone in their exact role and sub-domain.
```

### System Prompt B — Technical (applies to roleLevel: specialist)

```
You are a senior AI learning advisor for technical practitioners. Your audience holds titles such as Software Engineer, Senior Engineer, Data Scientist, Data Analyst, ML Engineer, Platform Engineer, and other individual contributor or specialist roles. They build and integrate AI systems as part of their daily work — writing code, calling APIs, evaluating models, and shipping AI-powered features.

Generate personalised AI topic recommendations for this practitioner based on their profile. Every topic you suggest must deliver hands-on, implementable knowledge that makes them more effective at building with AI.

Rules for topic selection and framing:
- Frame every topic at the implementation level: how to build, integrate, evaluate, optimise, or operate AI systems.
- Prioritise topics on Claude API, prompt engineering, agentic systems, RAG pipelines, model evaluation, AI tooling, and applied ML in production.
- Include topics that are immediately applicable: skills they can use in their next sprint, pull request, or architecture decision.
- Do NOT suggest topics on AI governance, board communication, vendor procurement, ROI frameworks, or organisational strategy — these belong to their leadership, not to them.
- Vocabulary: use "API", "prompt engineering", "context window", "embeddings", "RAG", "fine-tuning", "agentic systems", "LLM", "inference", "latency", "evaluation" — not "board-ready", "executive briefing", "governance", "stakeholder".

Return ONLY valid JSON matching the specified schema. Be specific and practical — every topic must be immediately relevant to someone in their exact role and sub-domain.
```

### System Prompt C — Manager (applies to roleLevel: manager, and any null/unrecognised value)

```
You are a senior AI learning advisor for team managers and team leads. Your audience holds titles such as Manager, Senior Manager, Team Lead, and Engineering Manager. They are responsible for the productivity and AI adoption of teams of 3–20 people. They need to evaluate and deploy AI tools for their function, coach their team on AI use, and report impact upward — without needing to build AI systems themselves or make board-level governance decisions.

Generate personalised AI topic recommendations for this manager based on their profile. Every topic you suggest must be practical and operational — things they can implement with their team in the next 30–60 days.

Rules for topic selection and framing:
- Frame every topic at the team-operations level: how to adopt, evaluate, deploy, and measure AI tools for a specific function or team.
- Prioritise topics on AI productivity tools, team adoption playbooks, evaluating AI tools for a function, measuring AI impact at team level, and practical prompt skills.
- Include topics that help them have credible AI conversations with both their team and their leadership.
- Do NOT suggest topics on hands-on model implementation, API integration, or MLOps — those are for their engineers. Do NOT suggest board-level governance, procurement, or investor framing — those are for their leadership.
- Vocabulary: use "AI adoption", "team productivity", "tool evaluation", "practical AI", "AI workflow", "measuring impact" — avoid both deep technical jargon and board-level strategic language.

Return ONLY valid JSON matching the specified schema. Be specific and practical — every topic must be immediately relevant to someone in their exact role and sub-domain.
```

---

## 5. Three Fallback Topic Lists (Full Text)

These are shown to real users when the Claude API is unavailable or times out. They must be high-quality and genuinely representative — not placeholder text.

### Fallback A — Executive (MOCK_RESPONSE_EXECUTIVE)

```typescript
const MOCK_RESPONSE_EXECUTIVE: RecommendationsResponse = {
  sections: [
    {
      id: 'trending',
      label: 'Trending in your field',
      icon: 'TrendingUp',
      topics: [
        {
          id: 'ai-governance-leaders',
          title: 'AI Governance for Leaders',
          description: 'Building oversight structures that satisfy your board, regulators, and risk teams.',
        },
        {
          id: 'agentic-ai-enterprise',
          title: 'Agentic AI in the Enterprise',
          description: 'What autonomous AI systems mean for your operations, risk exposure, and workforce.',
        },
        {
          id: 'ai-competitive-intelligence',
          title: 'AI Competitive Intelligence',
          description: 'How to read what your competitors are doing with AI before it becomes a threat.',
        },
        {
          id: 'ai-investment-decisions',
          title: 'Making AI Investment Decisions',
          description: 'A framework for deciding which AI bets to fund and which to defer.',
        },
      ],
    },
    {
      id: 'role',
      label: 'Based on your role',
      icon: 'Briefcase',
      topics: [
        {
          id: 'ai-strategy-leaders',
          title: 'AI Strategy for Leaders',
          description: 'How to define, communicate, and execute an AI strategy your organisation can act on.',
        },
        {
          id: 'evaluating-ai-vendors',
          title: 'Evaluating AI Vendor Pitches',
          description: 'The five questions that separate real AI capability from a polished sales demo.',
        },
        {
          id: 'ai-roi-frameworks',
          title: 'Measuring AI ROI',
          description: 'Proven methods to quantify and communicate the return on AI investments.',
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools to master',
      icon: 'Wrench',
      topics: [
        {
          id: 'anthropic-claude-executives',
          title: 'Anthropic Claude for Executives',
          description: 'Using Claude for analysis, briefing preparation, and decision support.',
        },
        {
          id: 'chatgpt-enterprise',
          title: 'ChatGPT Enterprise',
          description: 'What the enterprise tier offers and whether it fits your organisation.',
        },
        {
          id: 'microsoft-copilot-leadership',
          title: 'Microsoft Copilot for Leadership',
          description: 'Automating executive documents, presentations, and communications.',
        },
      ],
    },
    {
      id: 'goal',
      label: 'Based on your goal',
      icon: 'Target',
      topics: [
        {
          id: 'ai-fluency-executives',
          title: 'AI Fluency for Executives',
          description: 'What every senior leader needs to know to hold their own in any AI conversation.',
        },
        {
          id: 'board-ai-communication',
          title: 'Communicating AI to Your Board',
          description: 'How to present AI risk, opportunity, and progress at board level.',
        },
        {
          id: 'ai-team-enablement',
          title: 'Enabling Your Team with AI',
          description: 'How leaders accelerate AI adoption without becoming the bottleneck.',
        },
      ],
    },
  ],
}
```

### Fallback B — Technical (MOCK_RESPONSE_TECHNICAL)

```typescript
const MOCK_RESPONSE_TECHNICAL: RecommendationsResponse = {
  sections: [
    {
      id: 'trending',
      label: 'Trending in your field',
      icon: 'TrendingUp',
      topics: [
        {
          id: 'agentic-systems-production',
          title: 'Agentic Systems in Production',
          description: 'Building, evaluating, and safely deploying autonomous AI agents in real systems.',
        },
        {
          id: 'rag-pipelines-engineers',
          title: 'RAG Pipelines for Engineers',
          description: 'Retrieval-augmented generation: architecture, chunking, retrieval, and evaluation.',
        },
        {
          id: 'llm-evaluation-practitioner',
          title: 'LLM Evaluation for Practitioners',
          description: 'How to measure model quality systematically — beyond vibe checks.',
        },
        {
          id: 'multimodal-apis',
          title: 'Multimodal APIs in Practice',
          description: 'Using vision, audio, and document capabilities in production AI applications.',
        },
      ],
    },
    {
      id: 'role',
      label: 'Based on your role',
      icon: 'Briefcase',
      topics: [
        {
          id: 'prompt-engineering-engineers',
          title: 'Prompt Engineering for Engineers',
          description: 'Systematic prompt design, chaining, and evaluation for production use cases.',
        },
        {
          id: 'building-ai-features',
          title: 'Building AI-Powered Features',
          description: 'End-to-end patterns for integrating LLMs into product features safely.',
        },
        {
          id: 'ai-code-review',
          title: 'AI-Assisted Code Review',
          description: 'Using LLMs to catch bugs, suggest refactors, and enforce patterns at PR time.',
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools to master',
      icon: 'Wrench',
      topics: [
        {
          id: 'anthropic-claude-developers',
          title: 'Anthropic Claude API for Developers',
          description: 'Messages API, tool use, streaming, and context management in production.',
        },
        {
          id: 'github-copilot-engineers',
          title: 'GitHub Copilot for Engineers',
          description: 'Beyond autocomplete: using Copilot for architecture, tests, and debugging.',
        },
        {
          id: 'cursor-ai-ide',
          title: 'Cursor AI IDE',
          description: 'The AI-native editor and how to use it for complex multi-file refactors.',
        },
      ],
    },
    {
      id: 'goal',
      label: 'Based on your goal',
      icon: 'Target',
      topics: [
        {
          id: 'llm-fundamentals-engineers',
          title: 'LLM Fundamentals for Engineers',
          description: 'Tokens, context windows, temperature, and inference — what every builder must know.',
        },
        {
          id: 'ai-safety-practitioners',
          title: 'AI Safety for Practitioners',
          description: 'Prompt injection, jailbreaks, and output validation in production systems.',
        },
        {
          id: 'mlops-llm-era',
          title: 'MLOps in the LLM Era',
          description: 'Deploying, monitoring, and updating LLM-powered systems in production.',
        },
      ],
    },
  ],
}
```

### Fallback C — Manager (MOCK_RESPONSE_MANAGER)

```typescript
const MOCK_RESPONSE_MANAGER: RecommendationsResponse = {
  sections: [
    {
      id: 'trending',
      label: 'Trending in your field',
      icon: 'TrendingUp',
      topics: [
        {
          id: 'ai-team-adoption',
          title: 'AI Adoption Playbook for Teams',
          description: 'A practical guide to rolling out AI tools across a team of 5–20 people.',
        },
        {
          id: 'ai-productivity-measurement',
          title: 'Measuring AI Productivity Gains',
          description: 'How to quantify and report AI impact at team level without complex tooling.',
        },
        {
          id: 'ai-tools-landscape',
          title: 'AI Tools Landscape for Managers',
          description: 'What is actually useful right now versus what is vendor hype.',
        },
        {
          id: 'agentic-ai-teams',
          title: 'Agentic AI and Your Team',
          description: 'What autonomous AI workflows mean for how your team operates day to day.',
        },
      ],
    },
    {
      id: 'role',
      label: 'Based on your role',
      icon: 'Briefcase',
      topics: [
        {
          id: 'evaluating-ai-tools-function',
          title: 'Evaluating AI Tools for Your Function',
          description: 'A structured approach to trialling, selecting, and deploying AI tools for your team.',
        },
        {
          id: 'coaching-team-ai',
          title: 'Coaching Your Team on AI',
          description: 'How to build AI habits across a team without mandating a specific tool.',
        },
        {
          id: 'ai-workflows-operations',
          title: 'AI Workflows for Operations',
          description: 'The highest-leverage AI use cases for operational and cross-functional teams.',
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools to master',
      icon: 'Wrench',
      topics: [
        {
          id: 'anthropic-claude-managers',
          title: 'Anthropic Claude for Managers',
          description: 'Using Claude for performance reviews, status reports, and team communications.',
        },
        {
          id: 'notion-ai-teams',
          title: 'Notion AI for Teams',
          description: 'Building shared AI-powered docs, templates, and wikis your team actually uses.',
        },
        {
          id: 'microsoft-copilot-managers',
          title: 'Microsoft Copilot for Managers',
          description: 'Automating meeting notes, action tracking, and reporting across your team.',
        },
      ],
    },
    {
      id: 'goal',
      label: 'Based on your goal',
      icon: 'Target',
      topics: [
        {
          id: 'ai-fluency-managers',
          title: 'AI Fluency for Managers',
          description: 'What every manager needs to understand to lead an AI-enabled team.',
        },
        {
          id: 'prompt-skills-managers',
          title: 'Practical Prompt Skills',
          description: 'The prompting techniques that deliver the most value with the least effort.',
        },
        {
          id: 'ai-change-management',
          title: 'AI Change Management',
          description: 'How to handle team resistance, upskilling gaps, and workflow disruption.',
        },
      ],
    },
  ],
}
```

---

## 6. roleLevel Derivation Logic

### New shared utility: `lib/curriculum/role-utils.ts`

This function must be created as a new file and imported by both `app/topics/page.tsx` and `app/api/curriculum/generate/route.ts`. The generate route currently defines `inferRoleLevel` as an inline function (lines 45–52). That inline definition must be removed and replaced with an import from this utility.

```typescript
// lib/curriculum/role-utils.ts

/**
 * Infers a structured roleLevel from a free-text role string.
 * Matches the logic used in /api/curriculum/generate/route.ts.
 *
 * Returns one of: 'c-suite' | 'vp-dir' | 'vp-technology' | 'vp-product' | 'manager' | 'specialist'
 *
 * Default is 'manager' — the safest neutral tier for ambiguous or missing role strings.
 */
export function inferRoleLevel(role: string): string {
  const r = role.toLowerCase().trim()
  if (/engineer|developer|analyst|scientist|designer|specialist|architect|researcher|consultant/.test(r)) return 'specialist'
  if (/manager|team.lead|lead/.test(r)) return 'manager'
  if (/vp |vice.president/.test(r)) return 'vp-dir'
  if (/director/.test(r)) return 'vp-dir'
  if (/ceo|cto|cfo|coo|cmo|chief/.test(r)) return 'c-suite'
  return 'manager'
}

/**
 * Maps a roleLevel to one of three recommendation tiers.
 * Used by both the topics page (client-side fallback selection)
 * and the recommendations API (system prompt selection).
 */
export function getRoleTier(roleLevel: string): 'executive' | 'technical' | 'manager' {
  switch (roleLevel) {
    case 'c-suite':
    case 'vp-dir':
    case 'vp-technology':
    case 'vp-product':
      return 'executive'
    case 'specialist':
      return 'technical'
    case 'manager':
    default:
      return 'manager'
  }
}
```

### How the topics page uses this (the exact change to `app/topics/page.tsx`)

Inside the `useEffect` that reads from localStorage (currently at line 236), immediately after reading `profile` from `clio_onboarding`, add:

```typescript
import { inferRoleLevel } from '@/lib/curriculum/role-utils'

// After: profile = JSON.parse(raw) as StoredProfile
const roleLevel = inferRoleLevel(profile.role ?? '')
```

Then include `roleLevel` in the fetch body:

```typescript
body: JSON.stringify({
  role: profile.role ?? '',
  primaryDomain: rawDomain,
  subDomain: profile.subDomain ?? '',
  learningGoal,
  aiMaturity,
  roleLevel,   // ← new field
}),
```

Note: `lib/curriculum/role-utils.ts` is a plain TypeScript module with no React or Next.js imports. It can be imported directly in `app/topics/page.tsx` (a client component) without issues.

---

## 7. API Contract Change

### Current request schema (RecommendationsSchema in `app/api/topics/recommendations/route.ts`)

```typescript
const RecommendationsSchema = z.object({
  role: z.string().max(100).optional().default(''),
  primaryDomain: z.string().max(100).optional().default(''),
  subDomain: z.string().max(100).optional().default(''),
  learningGoal: z.string().max(200).optional().default(''),
  aiMaturity: z.string().max(50).optional().default('intermediate'),
})
```

### Updated request schema

```typescript
const RecommendationsSchema = z.object({
  role: z.string().max(100).optional().default(''),
  primaryDomain: z.string().max(100).optional().default(''),
  subDomain: z.string().max(100).optional().default(''),
  learningGoal: z.string().max(200).optional().default(''),
  aiMaturity: z.string().max(50).optional().default('intermediate'),
  roleLevel: z.enum(['c-suite', 'vp-dir', 'vp-technology', 'vp-product', 'manager', 'specialist'])
             .optional()
             .default('manager'),
})
```

`roleLevel` is optional with a default of `'manager'` so that existing callers (any page that calls this endpoint without the new field) continue to work correctly and receive manager-framed topics rather than breaking.

### Response contract: unchanged

The response shape (sections array, fallback flag) does not change. The API always returns 200. No new response fields.

### System prompt selection logic in the route

```typescript
import { getRoleTier } from '@/lib/curriculum/role-utils'

// Replace the hardcoded systemPrompt constant with:
const tier = getRoleTier(parsed.data.roleLevel)
const systemPrompt = SYSTEM_PROMPTS[tier]

// Where SYSTEM_PROMPTS is a record defined at module level:
const SYSTEM_PROMPTS: Record<'executive' | 'technical' | 'manager', string> = {
  executive: `...` , // full text from Section 4, System Prompt A
  technical: `...` , // full text from Section 4, System Prompt B
  manager:   `...` , // full text from Section 4, System Prompt C
}
```

### Fallback selection: client-side, not API-side

The API's three existing fallback return sites (`catch` block, timeout, parse failure) all currently return `MOCK_RESPONSE.sections`. After this change, these sites must return the correct tier's sections. The API has `roleLevel` in `parsed.data` by the time these fallbacks execute (the parse step runs before Claude is called), so the route can select the correct fallback:

```typescript
import { getRoleTier } from '@/lib/curriculum/role-utils'

const MOCK_RESPONSES = {
  executive: MOCK_RESPONSE_EXECUTIVE,
  technical: MOCK_RESPONSE_TECHNICAL,
  manager:   MOCK_RESPONSE_MANAGER,
}

// At each fallback return site, replace MOCK_RESPONSE with:
const tier = getRoleTier(parsed.data.roleLevel)
return NextResponse.json({ fallback: true, sections: MOCK_RESPONSES[tier].sections } as FallbackResponse)
```

Note: the first fallback (Zod parse failure, line 257 in the current route) fires before `parsed.data` is available. At that point `roleLevel` is unknown — use the manager fallback (`MOCK_RESPONSE_MANAGER`) as the safe default.

---

## 8. Acceptance Criteria

All criteria must be verifiable by a QA engineer in a browser without database access.

**AC-01 — Executive path (live Claude)**
Given a user whose `clio_onboarding` localStorage contains `role: "CEO"`,
When they visit `/topics`,
Then the topics page sends a POST to `/api/topics/recommendations` with `roleLevel: "c-suite"`,
And the returned topic titles contain words from the set {strategy, governance, ROI, leaders, board, executives, vendor} in at least 2 of the 4 section headers or topic titles,
And no topic title contains the words {API, prompt engineering, fine-tuning, agentic systems, MLOps}.

**AC-02 — Technical path (live Claude)**
Given a user whose `clio_onboarding` localStorage contains `role: "Software Engineer"`,
When they visit `/topics`,
Then the topics page sends a POST with `roleLevel: "specialist"`,
And the returned topic titles contain words from the set {API, engineering, developer, build, production, systems, code} in at least 2 sections,
And no topic title contains the words {governance, board, ROI framework, executive briefing}.

**AC-03 — Manager path (live Claude)**
Given a user whose `clio_onboarding` localStorage contains `role: "Engineering Manager"`,
When they visit `/topics`,
Then the topics page sends a POST with `roleLevel: "manager"`,
And the returned topic titles contain words from the set {team, adoption, manager, productivity, tools, practical} in at least 2 sections,
And topic titles do not contain {board, governance, API integration, MLOps, fine-tuning}.

**AC-04 — Executive fallback (mock)**
Given `ANTHROPIC_API_KEY` is set to a `PLACEHOLDER_` value,
And a user with `role: "CFO"` visits `/topics`,
Then the page renders the executive fallback list,
And topic titles from MOCK_RESPONSE_EXECUTIVE are visible (e.g. "AI Governance for Leaders", "AI Strategy for Leaders"),
And no topic title from MOCK_RESPONSE_TECHNICAL or MOCK_RESPONSE_MANAGER is visible.

**AC-05 — Technical fallback (mock)**
Given `ANTHROPIC_API_KEY` is a placeholder,
And a user with `role: "Data Scientist"` visits `/topics`,
Then the page renders the technical fallback list,
And topic titles from MOCK_RESPONSE_TECHNICAL are visible (e.g. "RAG Pipelines for Engineers", "Prompt Engineering for Engineers"),
And no executive or manager fallback topics are visible.

**AC-06 — Manager fallback (mock)**
Given `ANTHROPIC_API_KEY` is a placeholder,
And a user with `role: "Manager"` visits `/topics`,
Then the page renders the manager fallback list,
And topic titles from MOCK_RESPONSE_MANAGER are visible (e.g. "AI Adoption Playbook for Teams", "Evaluating AI Tools for Your Function"),
And no executive or technical fallback topics are visible.

**AC-07 — sessionStorage cache is role-keyed**
Given a user with `role: "CEO"` has previously visited `/topics` (cache key `clio_topic_recs_c-suite` is set),
When the same browser session is used by a user with `role: "Software Engineer"`,
Then the page reads from `clio_topic_recs_specialist`, not `clio_topic_recs_c-suite`,
And the executive-framed topics are not displayed to the engineer.

**AC-08 — Custom topic input unaffected**
Given any user on the topics page,
When they type a custom topic (e.g. "Quantum computing basics") and click Add,
Then the topic is added and pre-selected regardless of their roleLevel,
And the custom topic is labelled "Custom" and can be removed independently.

**AC-09 — Missing roleLevel defaults gracefully**
Given a POST request to `/api/topics/recommendations` that omits the `roleLevel` field entirely,
Then the API responds with manager-tier topics (system prompt C or MOCK_RESPONSE_MANAGER),
And the response HTTP status is 200,
And the response shape is identical to a standard successful response.

**AC-10 — `inferRoleLevel` is not duplicated**
Given the codebase after this change is shipped,
Then `grep -r "inferRoleLevel" app/` returns zero matches (the inline definition in `generate/route.ts` has been removed),
And `grep -r "inferRoleLevel" lib/curriculum/role-utils.ts` returns one match (the canonical definition).

---

## 9. Edge Cases

**EC-01 — `role` is empty string or null in localStorage**
`inferRoleLevel('')` returns `'manager'` (the default branch). The API receives `roleLevel: 'manager'` and returns manager-tier topics. The user sees a reasonable neutral topic set. No error is thrown.

**EC-02 — `role_level` is stored in the DB but not reflected in localStorage**
The topics page derives `roleLevel` from `profile.role` (free-text string in localStorage), not from the DB `role_level` column. These may diverge if the user's job title was updated in the DB after onboarding. This is acceptable: the topics page is a pre-auth or early-session surface. The curriculum planner (which is already role-differentiated) uses the DB value. The slight inconsistency between topics recommendations and curriculum is low-risk. Aligning these is a future concern, not in scope for this build.

**EC-03 — A new roleLevel value is added to the enum in the future**
`getRoleTier()` has an explicit `default` branch that returns `'manager'`. Any future roleLevel value not yet in the switch will silently fall to manager-tier. This is safe and will not break the build.

**EC-04 — User visits `/topics` multiple times in one browser session with different profiles**
The cache key `clio_topic_recs_${roleLevel}` is computed from the current localStorage value of `profile.role` on each page load. If the localStorage profile changes between visits (e.g. user completed onboarding again), the new roleLevel produces a different cache key and the page fetches fresh recommendations. Old cached entries for other roleLevels remain in sessionStorage but are never read (they are under a different key).

**EC-05 — `profile.role` is a job title not matching any pattern in `inferRoleLevel`**
Examples: "Founder", "Consultant", "Entrepreneur", "Partner". None of these match any regex in the current inference logic. The function returns `'manager'` (the default). These users see manager-tier topics. This is a known limitation of the text-matching approach inherited from the curriculum route. It is acceptable for this build. A future improvement could add explicit patterns for Founder/Partner/Consultant.

**EC-06 — Zod parse failure (malformed request body)**
The Zod parse failure branch fires before `parsed.data.roleLevel` is available. This branch must use `MOCK_RESPONSE_MANAGER` as the fallback (the safe neutral default) rather than trying to access the unparsed body.

**EC-07 — Claude API times out (>20 seconds)**
The AbortController timeout fires, the catch block runs, and the API returns `{ fallback: true, sections: MOCK_RESPONSES[tier].sections }`. The `tier` is computed from `parsed.data.roleLevel`, which is available because Zod parsing succeeded before the Claude call. The user sees their role-appropriate fallback, not an executive-only list.

**EC-08 — Two-vocabulary problem: taxonomy ROLES vs roleLevel**
`topic_catalog.relevant_roles` uses taxonomy IDs (`ceo`, `developer`, `product-manager`, etc.). The `inferRoleLevel` function maps free-text role strings to `roleLevel` values (`c-suite`, `specialist`, `manager`, etc.). These are two separate vocabularies. This build does not connect the topic catalog to the recommendations flow — the recommendations endpoint calls Claude directly and does not query the catalog. The vocabulary mismatch is therefore not a runtime issue for this build. Any future build that wires the catalog into recommendations must implement an explicit mapping between the two vocabularies. The BA spec for that future build must include the full mapping table.

---

## 10. Out of Scope

- **Topic catalog filtering**: The `topic_catalog.relevant_roles` column exists and is populated. Wiring it into the recommendations flow (as a Claude context injection or as a pre-filter) is explicitly out of scope. This build changes only the system prompt and fallback objects.
- **Curriculum planner changes**: `lib/curriculum/planner.ts` is already correctly role-differentiated. No changes to that file.
- **DB migration**: No new columns, no changes to the `users` table, no migration files.
- **`vp-technology` and `vp-product` distinct prompts**: These two levels are folded into the executive tier for topic recommendations. The curriculum planner already differentiates them at the deeper planning stage. Adding two more system prompt variants for topic selection (an earlier, coarser stage) adds complexity without proportionate user value.
- **Post-session recalibration**: The CEO brief mentions that the catalog seed assigns `relevant_roles` per topic. Aligning the recommendations flow to query catalog rows (rather than calling Claude) is a potential future optimisation, not part of this build.
- **Profile edit page**: Users cannot change their role after onboarding. Any role change therefore requires re-onboarding. This limitation is not introduced or changed by this build.
- **Onboarding localStorage write**: `roleLevel` is not written to `clio_onboarding` in localStorage as part of this build. The topics page re-derives it from `profile.role` on every load. This is correct and intentional — it avoids requiring an onboarding change and keeps the source of truth as the role string.

---

## 11. Open Questions

None. All questions from the CEO brief have been resolved as follows:

Q1 (shared utility vs inline): Resolved — `inferRoleLevel` must be extracted to `lib/curriculum/role-utils.ts`. The complexity is minimal (one new file, two import statements changed) and the deduplication benefit is concrete.

Q2 (exact wording for technical and manager system prompts): Resolved — full text written in Section 4.

Q3 (`vp-technology` and `vp-product` separate prompts or folded into executive): Resolved — folded into executive tier. The recommendations step is a coarse selection surface. The curriculum planner already provides the fine-grained differentiation these roles need at content-generation time.

Q4 (client-side filter guard if Claude returns wrong-tier topics despite new prompt): Resolved — no client-side filter is implemented. The new system prompt is explicit and constraining. A post-hoc keyword filter on topic titles would be fragile (keyword blocklist can never be complete), would silently remove valid topics (e.g. "AI Governance" appears in some technical contexts), and would add complexity for a low-probability failure mode. Trust the new prompt. If hallucination becomes a measured problem in production, revisit with a structured-output approach.

Q5 (sessionStorage cache key): Resolved — key changes to `clio_topic_recs_${roleLevel}`. This correctly busts the cache on role change. Clearing the cache on every visit would cause an unnecessary Claude call on every page re-visit, which is worse for latency and cost.

Q6 (files to change): Confirmed — exactly three files change:
1. `lib/curriculum/role-utils.ts` (new file)
2. `app/api/topics/recommendations/route.ts` (system prompt + schema + fallback objects)
3. `app/topics/page.tsx` (roleLevel derivation + cache key + fetch body)

Plus one file gets a minor import change: `app/api/curriculum/generate/route.ts` (remove inline `inferRoleLevel`, import from `role-utils.ts`).

Q7 (roleLevel in localStorage): Resolved — do not write it to localStorage. Re-derive inline in the topics page from `profile.role`. This is simpler and avoids an onboarding change. The derivation is a pure function call with no async work.

---

## 12. Dependencies

**Must exist before build starts:**
- `app/api/topics/recommendations/route.ts` — exists, confirmed readable above
- `app/topics/page.tsx` — exists, confirmed readable above
- `app/api/curriculum/generate/route.ts` — exists; the inline `inferRoleLevel` function on lines 45–52 is the source of truth for the inference logic being extracted

**Must be true at runtime:**
- `clio_onboarding` key in localStorage must contain a `role` field for `inferRoleLevel` to operate. If `role` is absent, `inferRoleLevel('')` returns `'manager'` safely — no hard dependency.
- `ANTHROPIC_API_KEY` environment variable — if present and non-placeholder, the live Claude path runs. If absent or placeholder, all three fallback objects must be present in the route file to be returned correctly.

**No dependencies on:**
- Any new DB column or migration
- Any change to the onboarding flow
- Any change to the curriculum planner
- Any change to the topic catalog or seed endpoint
