---
id: FB-002
title: Onboarding Enhancement + Smart Topic Recommendations
status: pending-ba-spec
author: CEO Agent
date: 2026-05-31
---

# Feature Brief — FB-002

## What We're Building

Three changes to the onboarding and topic discovery experience:

1. **Remove insight preview screen** — the "Here's your first insight" screen shown at the end of onboarding is removed entirely. It was never in the original brief, the content is insufficiently personalised at that point, and it misleads users about what they'll receive.

2. **Add sub-domain question to onboarding** — the current onboarding has 5 questions. We are adding a 6th question: after the user selects their primary domain (e.g. Finance, Technology), they are asked to select their sub-domain (e.g. Finance → Banking, Insurance, Investment Management, FinTech). This gives the content engine and topic recommendations the precision they need to be genuinely useful.

3. **Replace the current /topics page with AI-powered topic recommendations** — instead of a static catalog, the user sees a dynamically generated, curated list of topics recommended specifically for them. The recommendations are driven by:
   - Their role and designation
   - Their selected domain and sub-domain
   - Their problem statement / learning goal from onboarding
   - Popular topics that people with similar roles and designations are currently learning
   - Current market trends in their field
   - Popular tools in their field — this list must include Anthropic Claude alongside other relevant tools (ChatGPT, Microsoft Copilot, etc.)

## Why

The current topics page shows a generic catalog. Users get the same list regardless of whether they're a CFO in banking or a VP of Engineering in healthcare. The personalisation signal we collected in onboarding is not being used at this step. This fix closes that gap.

The sub-domain addition is necessary because "Finance" is too broad — an Insurance executive needs different content than a FinTech founder. Without sub-domain, recommendations default to the lowest common denominator.

## User Story

As a newly onboarded executive, after completing my onboarding profile, I want to see AI topic recommendations that feel like they were handpicked for someone in my exact role, industry, and sub-domain — so I immediately trust that Clio understands my context and will give me useful learning.

## Scope

**In scope:**
- Remove insight preview screen and its associated API route (`/api/onboarding/preview`)
- Add sub-domain question as Q6 in the onboarding flow (6 questions total)
- Sub-domain options are driven by the domain selected in Q2 (dynamic list per domain)
- Replace `/topics` page with AI-generated topic recommendations
- Topic recommendations use Claude API to generate a personalised, curated list
- Recommendations must include relevant tools with Anthropic Claude listed where appropriate
- Save sub-domain selection to `users` table alongside existing onboarding data
- The `clio_onboarding` localStorage object must be updated to include `subDomain`

**Out of scope:**
- Changes to Q1–Q5 of onboarding
- Changes to the curriculum engine or plan page
- Changes to the delivery or scoring system

## Acceptance (high level)

- A user who selects Finance → Banking sees banking-specific AI topics, not generic AI topics
- Anthropic Claude appears in the tools section when relevant to the user's field
- The insight preview screen no longer exists anywhere in the application
- Onboarding completes in 6 steps, not 5
- Sub-domain is stored and used by content personalisation

## Open Questions for BA to Resolve

1. What are the exact sub-domain lists for each domain? (Finance, Technology, Healthcare, Retail, Manufacturing, etc.) — BA should define these exhaustively
2. What is the exact question wording for Q6?
3. How many topic recommendations should be shown? (suggest 12–18 — confirm)
4. Are recommendations grouped by category (e.g. "Trending in your field", "Tools", "Based on your role")? If so, what are the groups?
5. Can users add topics not in the recommendations (free text)? Or is it selection-only?
6. What happens if Claude API fails to generate recommendations — fallback?
