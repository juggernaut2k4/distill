---
id: FB-004
title: Intelligent Curriculum Engine + Progressive Recommendation System
status: spec-approved
author: CEO Agent
date: 2026-05-31
---

# Feature Brief — FB-004

## 1. What Arun Said

> "Whether the user selects all the topics we recommended or added new topics on their own or selected one topic only from the recommended — no matter what their selection is, we need to create a learning plan based on their selection but keeping their selection as the focus point. The level of information and content we cover will be based on their role and other selections they made."

> "We need to put in some thought here and be intelligent about it. It is not a black and white decision. Based on the user selection, there could be topics that need separate topic arcs and learning paths like domain knowledge or strategy, but few topics need to combine and become an integrated plan like AI in operations, usage of Claude etc. So we need to use LLM to read and understand user selection, then list a learning path."

> "You can even provide a learning path up to 10 sessions (show to user) but keep another 50 sessions in queue. Based on user progression, you decide what other topics will be beneficial and the user will be interested in, and based on that recommend the topics. Here we need to use some algorithm or LLM thought process to understand the user psychology to recommend the learning paths and topics so they can add to their learning plan and progress. More learning is more business for us."

---

## 2. The Problem Being Solved

**Current state:**
- Clio currently generates a single AI-produced learning session for the user's selected topic set
- There is no session sequencing, no multi-session arc, and no progression logic
- The system does not reason about whether topics should be grouped together or kept separate
- There is no queue of future sessions — the user reaches a dead end after their first session
- There is no mechanism to recommend what comes next based on what the user has engaged with
- Completion, skipping, and feedback signals are not used to shape future content
- The business has no engine to drive users toward more sessions — the primary lever for retention and upgrades

**The gap this feature fills:**
A user today selects topics, gets a single session, and stops. There is no reason for them to return. This feature creates a structured, intelligent, continuously growing learning journey that evolves with the user — giving them a reason to come back every day, every week, and to stay subscribed.

---

## 3. What Success Looks Like

**For the user:**
- After selecting topics, the user sees a structured learning plan of up to 10 sessions — not a wall of content, but a clear, titled, sequenced plan with one session highlighted as "Start here"
- Sessions feel coherent — domain topics go deep in their arc; tool topics flow together naturally; the user never wonders "why is this here?"
- As the user progresses, new sessions appear in their plan without them having to search or re-onboard
- Recommendations feel intelligent — the next session genuinely feels like the right next step given what they just learned
- A user who selected one topic still gets a full, sensible learning path

**For the business:**
- Average sessions completed per user increases materially (target: from ~1 to 5+ in first 30 days)
- User-initiated topic additions increase (surfaced recommendations drive action)
- Churn at the end of the visible plan drops to near zero — there is always something next
- Subscription upgrades correlate with hitting plan capacity limits (Pro users get deeper queues, more recommendations)

**Measurable signals:**
- Session completion rate per user per week
- Recommendation acceptance rate (user adds recommended topic to plan)
- Average sessions in queue per active user
- Sessions completed before churn event

---

## 4. The Four Layers

### Layer 1: LLM-Powered Curriculum Classification

When a user finalises their topic selection (the "Build my learning plan" action), the system passes the full topic set to an LLM with the user's role, industry, AI maturity level, and worry tags as context.

The LLM does not treat topics as a flat list. It reads the selection as a signal and makes a structural decision:

**Separate arc:** Topics that are domain-anchored or strategy-anchored are given their own arc with depth and sequence. Example: "AI Governance" gets a 4-session arc covering foundations → risk frameworks → regulatory landscape → board communication. It would be wrong to merge this with a tool topic.

**Integrated path:** Topics that are tool-oriented or workflow-oriented (e.g., Claude for Work, AI in Operations, Agentic AI Basics) are woven into a single coherent learning path rather than siloed. They share context and reference each other.

**Singleton handling:** If the user selected only one topic, the LLM generates a meaningful single arc covering breadth-to-depth for that topic at the appropriate level for their role.

The output of Layer 1 is a structured curriculum object: a list of session definitions (title, focus, arc name, position in arc, estimated duration, role-adjusted depth level). This object is stored and becomes the source of truth for the visible plan and the shadow queue.

The LLM prompt must be engineered to produce deterministic, structured output (JSON). The BA spec must define the exact output schema.

### Layer 2: Visible Plan (Up to 10 Sessions)

The user is shown a structured learning path of up to 10 sessions immediately after plan generation. This is their confirmed, actionable curriculum.

Each session card in the visible plan shows:
- Session title
- Arc name (e.g., "AI Governance Arc — Session 2 of 4")
- Estimated reading/learning time
- Status: Not started / In progress / Complete
- A single "Start" call to action on the first incomplete session

The visible plan is not editable by the user (they cannot re-order sessions), but they can add topics which may add sessions to the plan via the recommendation engine.

The user must see and approve this plan before their first session begins. This is not automatic. "This is your plan — ready to start?" is a moment of commitment.

### Layer 3: Shadow Queue (Up to 50 Sessions)

Behind the visible plan, the system pre-generates a deeper queue of up to 50 additional session definitions. These are not shown to the user in full — they never see a wall of 60 sessions. They only see what is immediately ahead of them.

The shadow queue is built by the same LLM pass that generates the visible plan (or in a subsequent async step immediately after). It covers:

- Natural next steps and deeper dives in each arc from the visible plan
- Adjacent topics not explicitly selected but clearly beneficial given the user's profile and selections
- Breadth expansions: new topic areas the user has not selected but that users with this profile commonly find valuable
- Role-specific challenge topics: content that addresses the user's stated "biggest worry" in depth

The shadow queue is a pre-computed reservoir. Sessions are promoted from queue to visible plan as the user progresses through Layer 4's recommendation engine.

Storage: the full queue is stored in the database (not generated on demand). Queue entries include their rationale (why this was included) so the recommendation engine can use it for ranking.

### Layer 4: Progressive Recommendation Engine

As the user progresses, the engine continuously selects the next session(s) to promote from the shadow queue into the visible plan, maintaining the visible plan at a healthy length (target: always 3–7 sessions remaining in the visible plan).

**Input signals the engine reads:**

- **Completion signal:** User finishes a session → arc advances, next session in that arc is promoted. Finishing a full arc → engine opens a new arc or recommends a new topic.
- **Skip/dropout signal:** User skips a session type or drops out mid-session → similar sessions are deprioritised in queue ranking. The engine notes the style preference.
- **Feedback signal:** Y/N feedback on content quality → Y means "more like this" (depth/style), N means "adjust" (depth, format, or topic).
- **Recency and relevance:** Trending topics in the user's industry or role-adjacent challenges are surfaced earlier in the queue ranking.
- **Progression psychology:** The engine alternates between depth sessions (harder, deeper in an arc) and breadth sessions (new arc introduction) to prevent cognitive fatigue. A user who has done 3 consecutive deep sessions gets a breadth session next.
- **Business alignment:** A user who has exhausted their visible plan and has no queue sessions is a churn risk. The engine must always maintain sessions in queue. Keeping the queue full is a first-class system objective.

**Recommendation surface:**
When the queue has sessions that score highly and are adjacent to the user's current position, the engine surfaces them as explicit recommendations: "Based on your progress, we think you'd benefit from [Topic X]. Add it to your plan?" The user accepts or dismisses. Acceptance adds the topic to their plan and triggers new session generation for it.

This recommendation surface is the primary growth and retention mechanism. It is displayed on the dashboard and may be surfaced in email/SMS delivery.

---

## 5. Known Constraints

- **User topic selections are the non-negotiable focus point.** The curriculum engine interprets and structures them — it does not replace or override them. If a user selected three topics, all three are covered.
- **Role, industry, maturity level, and worry tags from onboarding drive depth calibration.** A CFO and an IT Manager selecting "AI in Finance" get different depth and angle. The LLM must receive the full user profile, not just the topic list.
- **The visible plan is approved by the user before first session begins.** Automatic start without confirmation is not acceptable.
- **Sessions must remain individually completable in 15–20 minutes.** Depth must be adjusted by session count within an arc, not by making individual sessions longer.
- **No changes to the topic catalog, topic selection UI, or onboarding questions** are in scope for this feature (those are FB-002 and FB-003 territory).
- **The shadow queue must not be visible to the user in full.** Showing 50 sessions would create overwhelm for time-poor executives. Only the active visible plan is shown.
- **Plan tier gates:** The depth of the shadow queue and the recommendation frequency should reflect the user's subscription tier (Starter: shallower queue and basic recommendations; Pro: full queue; Executive: queue + proactive 1:1 session suggestions via Clio voice). The BA must define the exact gates.
- **Approved AI SDK:** Only `@anthropic-ai/sdk` with `claude-sonnet-4-6` is permitted for LLM calls in this feature. No other AI provider.

---

## 6. Questions for BA

The Business Analyst must answer all of the following before development begins. No question may be left open. If an answer requires a decision from Arun, the BA must escalate; the developer must not assume.

**Q1 — LLM output schema**
What is the exact JSON schema the curriculum classification LLM must return? Define every field, type, and optional/required status for both session definitions (visible plan) and queue entries. Include: arc name, session title, session focus, position in arc, arc length, depth level, role-adjusted content hint, rationale (for queue entries), estimated duration in minutes.

**Q2 — Arc vs. integrated path decision criteria**
What explicit rules or heuristics should the LLM prompt use to decide whether a topic gets its own arc vs. is integrated with others? Provide at least 5 concrete examples of topics and their classification outcome, with reasoning. This will be used to write and test the system prompt.

**Q3 — Visible plan vs. shadow queue split**
When the LLM generates the full curriculum, how does the system decide which sessions go into the visible plan (up to 10) and which go into the shadow queue? Is it strictly the first 10 sessions in arc order? Or is there a selection logic (e.g., one session per arc as a "taster", then deeper sessions go to queue)?

**Q4 — Progression trigger rules**
Define precisely when the recommendation engine promotes a session from queue to visible plan. Is it triggered by: session completion event? Visible plan dropping below a threshold (e.g., fewer than 3 remaining sessions)? Both? Something else? Define the threshold and the trigger.

**Q5 — Recommendation surface UX**
Where exactly on the dashboard does the "We think you'd benefit from X — add it to your plan?" recommendation appear? Define: position on page, maximum number of recommendations shown at once, dismiss behaviour (is it permanent or does it resurface?), and what happens after the user accepts (immediate session generation? or queued?).

**Q6 — Subscription tier gating**
Define the exact differences in curriculum features by tier:
- Free/Trial: what does a user get? One session only? A limited visible plan?
- Starter: visible plan size, shadow queue size, recommendation frequency
- Pro: visible plan size, shadow queue size, recommendation frequency
- Executive: anything additional (e.g., Clio voice session suggestions)?

**Q7 — Single-topic edge case**
If a user selects exactly one topic, what is the expected visible plan? Define: minimum number of sessions generated, arc structure, and how the LLM handles a very narrow selection (e.g., just "Prompt Engineering") for a non-technical user vs. a technical user.

**Q8 — Session completion definition**
What constitutes a "completed" session for the purposes of the progression engine? Options: user reaches end of session content? User explicitly clicks "Mark complete"? User spends a minimum time on the page? The definition determines the accuracy of the completion signal — and a loose definition would make the recommendation engine unreliable.

**Q9 — Shadow queue regeneration**
When does the system regenerate or extend the shadow queue? If a user's queue drops to fewer than N sessions (because sessions have been promoted to the visible plan), does the system generate more? What triggers regeneration, and does it require another LLM call or can it be rule-based extrapolation?

**Q10 — Failure mode handling**
If the LLM call for curriculum classification fails or returns malformed JSON, what does the user see? Define the fallback: static default plan? Error message with retry? Partial plan with what was parseable? This must be specified — the developer must not decide this alone.

---

*Feature Brief FB-004 | Author: CEO Agent | Date: 2026-05-31 | Status: pending-ba-spec*
*Next step: Business Analyst Agent reads this brief and produces a full Requirement Document covering all 12 sections, with all 10 questions in Section 11 answered before development begins.*
