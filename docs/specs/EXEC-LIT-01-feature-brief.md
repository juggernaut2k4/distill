# Feature Brief: Executive Technical Literacy Section
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-06-29

---

## What Arun Said

The executive recommendations page currently gives leaders governance and strategy topics — "AI Governance for Leaders", "Evaluating AI Vendor Pitches", "Communicating AI to Your Board". That framing is correct for operational decisions. But there is a gap: executives who need conceptual technical understanding — enough to hold their own in a conversation with their CTO, enough to ask the right questions in a vendor demo — have no dedicated section.

Arun wants a third section added to the executive recommendations tier. The framing is: "what a CTO would explain to a board member over dinner." The goal is understanding, not building. Examples given:

- Why context window size changes what you can do with AI
- Fine-tuning vs RAG vs prompt engineering (the tradeoffs, not the implementation)
- How LLMs generate text (enough to understand hallucination risk)
- Why model size doesn't always mean better (cost, latency, use-case fit)
- What "training data cutoff" means for your AI vendor choices
- How embeddings power AI search and why it matters for enterprise data

This is curiosity-driven literacy. It is not a tutorial. It is not a beginner track. It is the conceptual vocabulary that lets an executive evaluate claims, ask penetrating questions, and not be misled.

---

## The Problem Being Solved

Executive users on the governance/strategy track currently receive topics in two sections: "Trending in your field" and "Decisions you need to own." Both frame every topic at the decision-making level, which is correct — but it means every topic is about what to do, never about what a thing is or how it works.

This leaves a specific literacy gap. When a vendor tells a CEO that "our model uses RAG so it won't hallucinate," the CEO has no framework to evaluate that claim. When a CTO proposes fine-tuning vs. prompt engineering for a use case, the CEO cannot interrogate the tradeoff. When an engineer says the context window is "too small for your documents," the CEO does not know what that means for the contract they are about to sign.

These are not technical skills. They are conceptual anchors that make an executive credible and effective in AI conversations. Without them, the executive must either defer entirely to their technical team or bluff. Neither is acceptable for a senior leader.

The current executive system prompt and user prompt explicitly exclude this category. The system prompt says "Do NOT suggest topics on prompt engineering mechanics, API integration, model fine-tuning, MLOps, or any hands-on technical skill." The user prompt instructs Claude to return `trending`, `decisions`, and `tools` — no slot exists for conceptual technical literacy.

---

## What Success Looks Like

An executive with roleLevel `c-suite`, `vp-dir`, `vp-technology`, or `vp-product` opens the topics page and sees three sections:

1. "Trending in your field" — 4 topics (unchanged)
2. "Decisions you need to own" — 4 topics (unchanged)
3. "How it actually works" — 5 topics, each framed as conceptual understanding, not skill-building

The third section topics feel like something you would read in a long-form business magazine explainer, not an engineering tutorial. After reading a session on any topic in this section, the executive can:
- Explain the concept in plain language to a non-technical peer
- Ask one penetrating question of a vendor or engineer that demonstrates they understand the tradeoff
- Identify when a technical claim being made to them does not hold up

The section label in the UI reads "How it actually works" with icon `Lightbulb`.

When Claude is unavailable and the mock fallback is served, the fallback includes this third section with 5 hardcoded topics matching the framing above. The fallback is indistinguishable in structure from the live response.

No manager or technical tier topics are affected. The page layout, collapse logic, and section rendering components are unchanged — the new section renders through the same `Section` component as the existing two.

---

## Known Constraints

### Must happen:
- The new section is a visible primary section. It is not hidden, not collapsed, and not in `advancedSections`. It renders in position 3, after "Decisions you need to own."
- The CONTENT-01 calibration rule applies: no beginner framing. The section must not describe topics as "Introduction to X," "Basics of Y," or "X for Beginners." Every topic title and description assumes the reader is intelligent and time-poor, not inexperienced.
- The executive system prompt (`SYSTEM_PROMPTS.executive`) must be updated to permit and instruct Claude to generate conceptual technical literacy topics, while still prohibiting hands-on implementation topics.
- The executive user prompt (`USER_PROMPTS.executive`) must be updated to request exactly 3 sections — `trending` (4 topics), `decisions` (4 topics), `how_it_works` (5 topics) — and must give Claude enough guidance on framing to consistently produce conceptually-framed, non-tutorial topics.
- `SECTION_METADATA` must gain an entry for the new section key (`how_it_works`), with label "How it actually works" and icon `Lightbulb`.
- `KNOWN_SECTION_KEYS` in `shapeResponse()` must include `how_it_works` so Claude's response parses correctly.
- `MOCK_RESPONSE_EXECUTIVE` must be updated to include the new section with 5 hardcoded topics matching the approved examples above. The existing two sections are not changed.
- The cache key version prefix must be bumped from `v4` to `v5` in `buildCacheKey()` so that cached executive responses without the new section are invalidated and regenerated on the next request.
- No changes to manager tier. No changes to technical tier. No changes to `MOCK_RESPONSE_MANAGER`, `MOCK_RESPONSE_TECHNICAL`, `MOCK_RESPONSE_TECHNICAL_BEGINNER`, or their system/user prompts.

### Must not happen:
- Do not frame any topic in this section as a skill to build ("you will learn to implement," "hands-on," "step-by-step"). The framing is always "understand" or "know how to evaluate."
- Do not add the section to the manager or technical tiers. It is executive-only.
- Do not change the `advancedSections` logic. This section is not advanced — it is primary.
- Do not add any new API routes, database tables, or UI components. This is a prompt and mock data change only.
- Do not change the number of topics in the existing two executive sections.

---

## Current State (for BA reference)

The file to change is `app/api/topics/recommendations/route.ts`.

The executive mock (`MOCK_RESPONSE_EXECUTIVE`, line 67) currently has three sections: `trending`, `decisions`, and `tools`. The `tools` section ("Tools to be fluent in") is the existing third section — it is NOT being replaced. The new `how_it_works` section becomes a fourth section in the mock and in Claude's response. The user prompt currently instructs Claude to return `{ "trending": [...], "decisions": [...], "tools": [...] }` — this must become `{ "trending": [...], "decisions": [...], "tools": [...], "how_it_works": [...] }`.

Wait — re-read the brief scope. Arun's instruction says "A third section added to executive recommendations." The current mock has three sections (`trending`, `decisions`, `tools`). The intent is a new conceptual-literacy section. The BA must confirm with the analysis below whether this becomes a fourth section alongside `tools`, or whether `tools` is displaced to position 4. The BA should read the current mock data and the user prompt as written (lines 67–146 and 454–465) before deciding. The CEO's view: `tools` serves a different purpose (personal fluency with specific AI tools) and should be retained. The conceptual literacy section slots in at position 3, making `tools` position 4. The user prompt must be updated to request 4 sections total.

The system prompt (line 374) currently contains this explicit prohibition: "Do NOT suggest topics on prompt engineering mechanics, API integration, model fine-tuning, MLOps, or any hands-on technical skill." This prohibition must be narrowed so that Claude understands it applies to hands-on skill-building but not to conceptual understanding of those same subjects. The rewrite must draw a clear line: "how RAG works conceptually" is permitted; "how to build a RAG pipeline" is not.

The cache key version is currently `v4` (line 658). Bumping to `v5` invalidates all existing executive-tier cache entries. This is a deliberate trade-off: stale two-section responses would be served until TTL otherwise.

---

## Questions for BA

The following questions must be answered in the Requirement Document before a developer writes a single line of code.

**Q1: Section count and position**
The current executive mock has 3 sections (`trending`, `decisions`, `tools`). Is the new `how_it_works` section inserted at position 3 (before `tools`), or appended at position 4 (after `tools`)? The CEO's recommendation is position 3, but the BA must confirm this is correct by reading the current mock and user prompt, and must specify the final section order explicitly.

**Q2: User prompt section count update**
The current user prompt instructs Claude to "Return exactly 3 sections." After this change, what is the instruction? Specify the exact section keys, topic counts, and the revised format line (currently `Format: { "trending": [...], "decisions": [...], "tools": [...] }`).

**Q3: System prompt rewrite for the prohibition boundary**
The current prohibition says "Do NOT suggest topics on prompt engineering mechanics, API integration, model fine-tuning, MLOps, or any hands-on technical skill." Write the replacement language that permits conceptual-literacy framing of these same subjects while still prohibiting hands-on skill topics. The line must be precise enough that Claude consistently generates conceptual topics in `how_it_works` and never slips into tutorial or skill-building framing.

**Q4: Exact framing instruction for `how_it_works` in the user prompt**
What instruction does the user prompt give Claude for generating the `how_it_works` section? Write the full paragraph, including: what question each topic should answer, the framing standard ("what a CTO would explain to a board member over dinner"), what to avoid, and any examples or anti-examples Claude should use as calibration.

**Q5: Topic count for `how_it_works`**
The brief states 5 topics. Confirm this is correct and specify whether 5 is a fixed requirement or a range (e.g. 4–6). The user prompt instruction must tell Claude the exact count.

**Q6: The 5 hardcoded mock topics**
Write the exact 5 mock topics for `MOCK_RESPONSE_EXECUTIVE`'s `how_it_works` section. Each must have: `id` (URL-safe slug), `title` (max 7 words, no "Introduction to" or "Basics of"), `description` (one sentence, max 18 words, framed as what the executive can evaluate or understand — not do or build). Use the six examples Arun provided as the source; select and refine 5 of them.

**Q7: `SECTION_METADATA` entry**
Specify the exact object to add to `SECTION_METADATA`: key, `label` string, and `icon` string. Confirm `Lightbulb` is the correct Lucide icon name (verify it exists in the lucide-react icon set).

**Q8: Cache invalidation impact**
Bumping the cache key from `v4` to `v5` invalidates all cached responses across all tiers (executive, manager, technical), not just executive. Is this acceptable, or should the BA spec a tier-scoped cache key format that allows per-tier invalidation? If a scoped format is preferred, specify exactly how the key string changes.

**Q9: Personalisation of `how_it_works`**
The other two executive sections are personalised to the user's role, domain, and sub-domain. Should `how_it_works` topics also be personalised to domain/sub-domain, or are they domain-agnostic (the same conceptual AI literacy topics regardless of whether the user is in Financial Services or Retail)? The user prompt instruction must reflect this decision.

**Q10: Acceptance criteria for framing quality**
Define the pass/fail test a developer or QA agent can apply to verify that a generated `how_it_works` topic is correctly framed. Specifically: what words or phrases in a topic title or description would cause a QA fail (e.g. "implement," "build," "step-by-step," "beginners")? And what words or phrases confirm a pass (e.g. "understand," "evaluate," "why," "what it means for")?

---

## Scope Boundaries (what this brief does NOT include)

- This brief does not change the topics page UI, the section rendering component, or the collapse/expand logic.
- This brief does not add a new icon component. `Lightbulb` must already exist in the installed version of lucide-react. If it does not, the BA must specify an alternative from the existing icon set.
- This brief does not change the onboarding flow, the user profile schema, or how roleLevel is determined.
- This brief does not change the manager or technical tier prompts, mocks, or section structures.
- This brief does not change the cache table schema — only the version prefix in `buildCacheKey()`.
- This brief does not add personalisation logic beyond what the existing user prompt already does for the `trending` and `decisions` sections.

---

## Files the BA Must Read Before Writing the Spec

1. `/Users/arunprakash/Documents/claudeWS/distill/distill/app/api/topics/recommendations/route.ts` — the complete file, in particular:
   - `MOCK_RESPONSE_EXECUTIVE` (lines 67–146): the existing 3-section mock
   - `SYSTEM_PROMPTS.executive` (lines 374–385): the prohibition language to be revised
   - `USER_PROMPTS.executive` (lines 445–465): the section instruction to be extended
   - `SECTION_METADATA` (lines 504–514): where the new key/label/icon entry goes
   - `KNOWN_SECTION_KEYS` in `shapeResponse()` (line 526): where `how_it_works` must be added
   - `buildCacheKey()` (line 658): where the version prefix is bumped
2. `/Users/arunprakash/Documents/claudeWS/distill/distill/docs/specs/CONTENT-01-feature-brief.md` — for CONTENT-01 calibration rules (no beginner framing, orient first, etc.)
3. `/Users/arunprakash/Documents/claudeWS/distill/distill/.claude/agents/clio/business-analyst.md` — BA agent instructions

---

## Handoff to Business Analyst Agent

BA Agent: this is a contained, single-file change. The Requirement Document should be lean — not every section needs three paragraphs. What it must be is complete: every question above answered, the exact prompt text written out (not described), the exact mock topics written out (not illustrated), and acceptance criteria specific enough that a developer can write a test.

The output spec file should be saved to: `docs/specs/EXEC-LIT-01-requirement-document.md`

Priority is P1. No user-facing flow is broken today. Move at normal pace but write completely — Q1 through Q10 must all be answered before this brief leaves your hands.
