# Content Methodology — Clio Session Content
_Approved by Arun, 2026-06-23. This document defines how all session content must be produced._

---

## Purpose

This document captures the exact approach that produced the approved content article for Session 1 ("Introducing Claude for Work — Why It Matters for a Technology Leader in Financial Services"). Every session and every topic must follow this methodology. Deviation requires explicit CEO approval.

---

## 1. Content Structure — 6 Sections per Subtopic (Approved)

Every subtopic article must contain exactly these six sections, in this order:

### 1.1 Overview
- What this concept is and why it matters for a senior executive
- 2–3 sentences only
- No definitions. No "AI is a type of technology that..." framing
- Written as peer-level context-setting, not an introduction

### 1.2 Key Facts
- 6–8 facts
- Every fact must be specific and citable: numbers, company names, contract terms, dates
- No vague generalisations ("many companies use AI")
- Numbered list
- Examples of what a good Key Fact looks like:
  - "Anthropic has raised over $7B from Google, Spark Capital, and others"
  - "Claude's context window is 200,000 tokens (~500 pages of text) in a single session"
  - "Average time savings on contract review tasks: 60–75% reduction in first-pass review time"

### 1.3 How It Works
- Technical explanation calibrated to VP level — accessible but not dumbed down
- Assumes the reader knows what an LLM is, what a model is, what an API is
- Explains the mechanism, not just the outcome
- Use concrete analogies only when they reduce confusion, not to compensate for skipping the explanation
- Length: 100–200 words

### 1.4 Enterprise Implications
- Must name the user's specific function and industry: "For a VP of Technology in financial services..."
- Answers: what does this mean for how I do my job, make decisions, manage risk, or talk to my board?
- This is the "so what" section — it must be answerable in a real executive conversation
- No generic "organisations can benefit" language

### 1.5 Common Misconceptions
- 2–4 items
- Format exactly: *"[The misconception stated as something a reasonable person might believe]"* — [The correction, stated directly and specifically]
- Misconceptions must be ones that actually circulate at the VP/C-suite level — not beginner confusion
- The correction must be specific, not just "that's not right"

### 1.6 Decision Questions
- 3–5 questions
- Must be answerable in a real meeting with a CTO, risk committee, or board
- Not comprehension checks ("what is Constitutional AI?")
- Must reference the user's specific context: "What does your current contract review workflow look like?"
- The user should feel equipped to answer these after reading the subtopic

---

## 2. Audience Calibration Rules (Approved)

### 2.1 VP/Director Audience (role_level = 'vp-dir')

**DO NOT:**
- Open with definitional content ("AI is a technology that...")
- Use phrases: "enterprise-grade", "AI is not a toy", "the AI revolution", "transformative"
- Start with "here are the major AI players" from scratch — they know the names
- Write foundational analogies (explaining neural networks with a kitchen metaphor)
- Use quiz-style Decision Questions ("What does CAI stand for?")

**DO:**
- Open on competitive positioning, procurement/compliance framing, or a specific decision they face in the next 90 days
- Assume they know what an LLM is, what an API is, what fine-tuning is
- Start from: what makes THIS model different, what it means for THEIR function, what they should say to THEIR C-suite
- Name their specific function and industry in every Enterprise Implication
- Make every Key Fact specific and citable — if a fact has no number or name attached, it is not a fact, it is an opinion
- Write Decision Questions they can bring into a real meeting

**Calibration test:** Before writing, ask: "Would a VP of Technology at a major financial services firm already know this?" If yes, do not explain it. Move to what they don't know, or what the implications are.

### 2.2 C-Suite Audience (role_level = 'c-suite')

All VP/Director rules apply, elevated further:

- Lead with board-level framing: competitive positioning against named peer firms, regulatory exposure as a financial risk
- Never explain how the technology works internally — only what it means for strategic decisions
- The "How It Works" section for C-suite is reframed as: "What the mechanism means for your risk profile"
- Name specific peer firms when relevant: "JP Morgan, Goldman Sachs, and HSBC have public deployments" — not "leading financial institutions"
- Every Decision Question must be something a board member or CEO would actually ask or be asked

### 2.3 Manager Audience

- One explanatory sentence per concept is acceptable
- Practical framing throughout: "here's what this means for your team's daily work"
- Less emphasis on board/risk framing, more on team workflow impact
- Decision Questions can include implementation-level questions: "Which team member would be the right person to run a pilot?"

---

## 3. Content-to-Script Derivation Rules (Approved)

The script is ALWAYS derived from the content article. It is never generated independently.

### 3.1 The Derivation Rule

1. **Content article** is written first (comprehensive, 600–800 words per subtopic, 6 sections)
2. **Script** is derived from 3 chosen items in the content article — not generated from a summary
3. **Visualization** is generated in the same LLM call as the script — the exact same 3 items

This structural lock means desync is architecturally impossible: the script teaches item A, B, C. The visualization shows items A, B, C. They are generated together from the same 3 items in the same call.

### 3.2 Script Structure (per subtopic)

**TEACH segment**
- ~2 minutes (~240 words)
- Covers exactly 3 items drawn from the content article's Key Facts, How It Works, or Enterprise Implications sections
- Written for the VP audience calibration rules (section 2.1)
- No setup, no preamble — begins immediately on the first differentiator
- Example opening: "You're probably evaluating Claude alongside GPT-4 or Gemini. Here are the three things that change the decision..."

**CHECKPOINT segment**
- 1 targeted comprehension question
- Tied to the user's specific function: "Which of those three will your risk or compliance team push back on first?"
- Not a knowledge quiz — a situational application question

**ICE_BREAKER segment**
- 1 open conversational question
- Genuinely invites the user to share their real context — not a follow-up to the TEACH
- Example: "What's the specific context driving this evaluation for you right now?"
- The user's response is stored and analysed post-session to update their learning profile
- Must not be phrased as a comprehension check

### 3.3 What Does Not Change Between Content and Script

- The 3 items chosen for TEACH are drawn verbatim from the content article — no paraphrasing that changes substance
- The script does not introduce any claim, fact, or implication not present in the content article
- If the content article says a context window is 200K tokens, the script says 200K tokens — not "an extremely large context"

---

## 4. Reference Content Library Pattern (Approved)

### 4.1 The Rule

When content for a topic is generated and approved by Arun, save it to `docs/content/[topic-id].md`.

Before generating new content for ANY topic:
1. Check if `docs/content/[topic-id].md` exists
2. If it **exists**: load it as context, extract the relevant subtopic section, derive script and visualization from it — do NOT regenerate
3. If it **does not exist**: generate fresh using the 6-section structure above, then save it immediately after generation

### 4.2 Naming Convention

File name: `[topic-id].md`

The `topic-id` is the same identifier used in `topic_content_cache.topic_id`. Format: kebab-case, descriptive enough to be unambiguous.

Examples:
- `anthropic-claude-for-work-s1.md`
- `ai-strategy-executive-fundamentals.md`
- `enabling-team-ai-s1.md`

### 4.3 File Header (Required)

Every content library file must open with:

```
# Session Content: [Session Title]
**Session title:** [Full session title]
**Topic ID:** `[topic-id]`
**Audience:** [Role, Industry, AI maturity level]
**Approved by:** Arun, [date]
**Status:** APPROVED — use as reference for script + visualization generation

---

## How to use this file
[Standard usage instructions]
```

### 4.4 Updating Existing Content

If Arun approves a change to an existing content article:
1. Edit the file in `docs/content/`
2. Re-derive the script and visualization from the updated content
3. Update the `Status` line with the revision date
4. Do not create a new file — edit the existing one

### 4.5 Library Growth Objective

Over time, the `docs/content/` library grows as more topics and sessions are generated and approved. As the library grows, generation cost drops and quality improves: new sessions can reference adjacent approved articles rather than generating from scratch.

---

## 4B. Bullet Filtering: Which Bullets to Keep Per Item

This section documents the exact filtering logic applied in the session that produced the approved worked example (section 5A). It must be applied every time bullets are selected for an item. The goal is to reduce a pool of 3–5 candidate bullets down to the final 1–3 that will become tabs.

Apply the five filters in order.

---

### Filter 1 — Drop setup bullets the user already knows

Rule: "Would a VP at this maturity level already know this in principle?"

If YES → drop it. Speak it as 5-second spoken context during another tab if needed, but do not make it a tab.

Examples applied in session:
- "Standard AI learns to sound right, not be right" → dropped (an intermediate-maturity VP knows this already)
- "CAI: model evaluates its own output before responding" → dropped (mechanism detail; speakable in 10 seconds)

---

### Filter 2 — Drop implementation/technical detail bullets

Rule: "Is this something the user needs to understand to make a decision, or something they need to understand to build it?"

VP audience = decision-maker, not builder. If the bullet is builder detail → drop it. Speak briefly as context if it helps orient the listener.

Example applied in session:
- "No chunking, no retrieval layer, no lost context" → dropped (implementation detail; VP does not need a tab for this)

---

### Filter 3 — Drop bullets implied by other bullets (redundancy check)

Rule: "If you keep the other bullets in this item, does this one add new information?"

If NO → drop it. The insight is already covered.

Examples applied in session:
- "Directly reduces FinServ compliance exposure at generation layer" → dropped (implied by the two failure-mode bullets kept above it)
- "Claude as productivity tool = not a decision engine" → merged into "Productivity tool + human review = outside MRM scope"

---

### Filter 4 — Move action/coaching bullets to ICE BREAKER

Rule: "Is this bullet telling the user what to DO rather than what to KNOW?"

Action and coaching bullets do not belong as visualization tabs. They belong in the ICE BREAKER spoken segment or next steps.

Examples applied in session:
- "Know this cold — it's the question that stalls every FS AI conversation" → moved to ICE BREAKER
- "Pre-answer it in your risk committee briefing, don't wait to be asked" → moved to ICE BREAKER
- "Pilot hypothesis: specific task, 4 weeks, measurable output" → moved to ICE BREAKER
- "Already AWS? Bedrock = one addendum, no new vendor review" → spoken as context during the API/Bedrock tab, not its own tab

---

### Filter 5 — Apply the default (1–2 bullets; go to 3 only if genuinely justified)

After filters 1–4, check what remains:

- If 1 or 2 remain → done
- If 3 or more remain → ask: "Do each of these genuinely need their own tab and visualization, or can any be spoken as context during another tab?"
- 3 bullets is allowed when the item has 3 genuinely distinct things (e.g., 3 deployment tiers = 3 different decisions = 3 tabs)
- 4–5 bullets is rare — only if the item is unusually complex AND the time math works (120s ÷ 5 = 24 sec per bullet, which is very fast)

Example applied in session:
- Item 2 (three tiers): 3 bullets kept because there are genuinely 3 different tiers with 3 different risk profiles. Each tier requires a different decision from the VP. Justified.

---

### What to keep (positive rules)

After filtering, the bullets you keep should be one or more of:

- **Core insight** — the one thing that changes how the user thinks about this
- **Role/industry application** — what it means specifically for their function and sector
- **Business case number** — a specific, citable metric (60–75%, 200K tokens, 7 days, etc.)
- **Consequence** — what goes wrong if they ignore this (only if the stakes are genuinely high)

---

### Worked example (from the approved session)

**Item 1 — Constitutional AI (5 candidates → 2 kept)**

| Bullet | Decision | Reason |
|--------|----------|--------|
| Standard AI learns to sound right, not be right | Drop | VP already knows this (Filter 1) |
| CAI: model evaluates its own output before responding | Drop | Mechanism detail; speakable in 10 sec (Filter 1) |
| Failure mode shifts: "I'm not sure" not wrong citation | Keep | Core insight |
| Hallucinated regulation vs expressed uncertainty — audit difference | Keep | FinServ role/industry application |
| Directly reduces FinServ compliance exposure | Drop | Implied by the two bullets above (Filter 3) |

**Item 2 — Three tiers (5 candidates → 3 kept)**

| Bullet | Decision | Reason |
|--------|----------|--------|
| Consumer tier: Anthropic may train on your conversations | Drop | VP won't use consumer tier; spoken as 5-sec framing |
| Teams: no training on data, SOC 2 Type II, SSO | Keep | Distinct tier, distinct risk profile |
| API/Bedrock: zero retention, HIPAA BAA, your AWS contract | Keep | Distinct tier, distinct risk profile |
| Wrong tier for regulated data = contractual exposure | Keep | High-stakes consequence |
| Already AWS? Bedrock = one addendum, no new vendor review | Drop → Spoken | Useful context; not a decision-level tab (Filter 4) |

3 bullets justified by Filter 5: three genuinely distinct tiers, each requiring a different VP decision.

**Item 3 — 200K context window (5 candidates → 2 kept)**

| Bullet | Decision | Reason |
|--------|----------|--------|
| 300-page vendor contract fits in a single session | Keep | Concrete, visual, memorable core insight |
| No chunking, no retrieval layer, no lost context | Drop | Implementation detail (Filter 2) |
| 60–75% time saving on first-pass contract review | Keep | Business case number |
| Regulatory text + internal policy + prior submission — one session | Drop → Spoken | Extension of bullet 1; speakable as context |
| Pilot hypothesis: specific task, 4 weeks, measurable output | Drop → ICE BREAKER | Action step, not a tab (Filter 4) |

**Item 4 — MRM exemption (5 candidates → 2 kept)**

| Bullet | Decision | Reason |
|--------|----------|--------|
| MRM applies to models making regulated decisions | Keep | Sets up the logic |
| Claude as productivity tool = not a decision engine | Drop → Merged | Merged into bullet below (Filter 3) |
| Human review in the loop = outside MRM scope | Keep (merged) | Conclusion with merged context |
| Know this cold — it's the question that stalls FS AI conversations | Drop → ICE BREAKER | Coaching, not a tab (Filter 4) |
| Pre-answer it in your risk committee briefing | Drop → ICE BREAKER | Action step, not a tab (Filter 4) |

---

## 4C. Long Concept Detection and Time Reallocation (Approved by Arun, 2026-06-23)

### The problem

Some concepts cannot be explained with working understanding in 60 seconds. A formula, a multi-step calculation, a framework with interacting components — rushing these produces surface-level delivery the user cannot apply. That is worse than not covering the concept at all.

### Detection: flag a bullet/tab as a Long Concept if ANY of these are true

1. **Has a formula or calculation** — must be shown step by step, not just stated
2. **Sequential dependency** — user cannot understand part B without first understanding part A
3. **Multiple interacting components** — not a list, but relationships between items that must be grasped together
4. **60 seconds produces surface knowledge, not working knowledge** — user could repeat it but not apply it

Example of a Long Concept: "explaining the formula to calculate cycle time reduction metrics and its benefits" — requires: what cycle time is → the formula → how to read the output → what good looks like. Cannot be delivered in 60 seconds with working understanding.

### Decision logic (apply per bullet/tab at content design time)

```
For each bullet/tab:
  → "Can Clio explain this with working understanding in 60 seconds?"

  YES → proceed normally, standard 60-sec slot

  NO → estimate genuine time needed (90 sec / 2 min / 3 min)
       → ask: "Must this be in THIS session, or can it be pushed to the next?"

       CAN PUSH → push to next session
                → log it in session notes: "Deferred to Session N: [concept] — [reason]"
                → free up the time slot, redistribute to remaining items

       MUST INCLUDE → extend this item's time allocation
                    → recalculate remaining session capacity
                    → drop bullets or whole items to compensate
                    → session total must still equal the target duration
```

### Rule: when to push vs. when to include

**Push to next session if:**
- Concept needs >3 min to explain with working understanding AND
- User can encounter it with prior context built up in this session (not a foundational dependency)

**Must include if:**
- Nothing else in the session makes sense without it (foundational — everything downstream depends on it)
- It is the core purpose of the session (not a supporting detail)

### Recalculation when a Long Concept must stay (worked example)

Session: 15 min, originally planned for 4 standard items

One item is flagged as Long Concept — genuinely needs 4 min (2 min speak + 1 min interaction + 1 min for the concept's complexity):

```
15 min total
- 3 min Q&A / next session discussion
- 4 min long concept slot
= 8 min remaining
÷ 3 min per standard item
= 2 standard items maximum

Result: drop one item entirely. Session now has 1 long concept + 2 standard items.
```

### Recalculation when pushed (worked example)

One item flagged as Long Concept, pushed to next session:

```
15 min total
- 3 min Q&A
- 0 min for pushed concept (removed)
= 12 min remaining
÷ 3 min per standard item
= 4 standard items

Result: slot freed, fill with next-best item from the filtered candidate list.
Log: "Deferred to next session: [concept name] — needs 4 min, not foundational to this session."
```

### What gets logged when pushing

In the session content output, add a `deferred_concepts` field:

```
deferred_concepts: [
  {
    concept: "cycle time reduction formula and calculation",
    reason: "needs 3+ min with working understanding — not foundational to session 1",
    send_to_session: 2,
    suggested_placement: "opening item, before any metrics discussion"
  }
]
```

The next session's content design picks this up automatically from the prior session's deferred list.

### Summary rule

> Never compress a concept that needs genuine time. Either give it the time it needs (and cut elsewhere) or push it to where it fits. A 60-second surface explanation of a complex concept is negative value — it creates false confidence without working knowledge.

---

## 5. Content Generation Pipeline — Steps 5–7 (Corrected 2026-06-23)

This section replaces any prior understanding of how bullets, visualizations, and tabs are structured. The previous model assumed a hardcoded count (always 3 items, always 3 bullets). That model is retired. The following is the approved replacement.

---

### Step 5 — Bullets per item: flexible (1–5), time-constrained

- Each item has 1–5 bullets, not a fixed number
- Constraint: the item must be fully explainable in **120 seconds total**
- Time per bullet = 120s ÷ number of bullets:
  - 1 bullet → 120 sec
  - 2 bullets → 60 sec each
  - 3 bullets → 40 sec each
  - 4 bullets → 30 sec each
  - 5 bullets → 24 sec each
- Default recommendation: **1–2 bullets**. Only add more if the item genuinely requires it
- Each bullet must be <10 words
- This timing is the direct input to script generation — Clio knows exactly how long to speak per bullet

---

### Step 6 — Visualization uses ALL bullets, no hardcoded count

- Whatever bullets the item has → all of them become visualization items
- 2 bullets → visualization has 2 items
- 4 bullets → visualization has 4 items
- Nothing hardcoded. No picking a subset. No "always 3 items."

---

### Step 7 — Each bullet = its own tab + its own visualization

- Each bullet is an individual tab in the session UI
- Each tab has exactly 1 visualization explaining that bullet
- Clio speaks to explain the visualization on each tab, then advances to the next
- Total tabs for the session = total bullets across all items
- Example: 4 items × average 2 bullets = ~8 tabs for a 15-min session

---

### What feeds the script generator (per bullet/tab)

- The bullet content (<10 words)
- Time available to speak it (120s ÷ N bullets in this item)
- User role + industry (calibration)
- Visualization content for that tab (so Clio references what's on screen)

---

## 5A. Worked Example — 15-min session, VP of Technology, Financial Services

**Session length calculation:**
- 15 min − 3 min Q&A = 12 min of teach time
- 12 min ÷ 3 min per item = **4 items selected**

**Item breakdown:**

| Item | Bullets | Tabs | Time per bullet |
|------|---------|------|-----------------|
| Constitutional AI → visible uncertainty, not hallucination | 2 | 2 | 60 sec |
| Three tiers: consumer vs Teams vs API/Bedrock | 3 | 3 | 40 sec |
| 200K context → full contracts in one session | 2 | 2 | 60 sec |
| Does not trigger model risk management (SR 11-7) | 2 | 2 | 60 sec |

**Session totals:**
- Total tabs: 9
- Total speak time: 12 min
- Q&A time: 3 min

---

## 6. What Makes This Content Different from What Was Being Generated Before

This section exists to prevent regression. Any agent generating content must understand what changed and why.

### Before This Methodology

| Dimension | Before |
|-----------|--------|
| Content format | `coaching_narrative` — 250–350 words, summary-level |
| Script length | 5–7 minute monologues expanded from the summary |
| Script style | Started at definitional level, built up to implications |
| Visualization | Generated separately from script, independent LLM call |
| Desync risk | High — script and viz from different calls with different framing |
| Audience calibration | Generic — no explicit VP vs C-suite rules |

### After This Methodology (Now)

| Dimension | Now |
|-----------|-----|
| Content format | Full 6-section article, 600–800 words per subtopic, citable facts |
| Script length | ~2 minutes (TEACH) + CHECKPOINT + ICE_BREAKER |
| Script style | Opens immediately at competitive/procurement/compliance level |
| Visualization | Generated in the same call as the script — same 3 items, structurally locked |
| Desync risk | Zero — atomic generation |
| Audience calibration | Explicit VP/Director and C-Suite rules with named DO/DO NOT phrases |

### The Key Insight

The coaching_narrative was a brief summary that then required a script to expand it — creating two layers of interpretation where errors compound. The new model has one authoritative source (the content article), and the script is a strict derivation of 3 items from it. Less interpretation means less drift.

---

## 7. Quality Checklist (Run Before Saving Any Content Article)

- [ ] Does every Key Fact have a specific number, name, or citable detail?
- [ ] Does the Enterprise Implication name the user's specific function and industry?
- [ ] Does the Overview avoid definitional framing?
- [ ] Are Common Misconceptions ones that actually circulate at VP/C-suite level?
- [ ] Are Decision Questions answerable in a real meeting (not a quiz)?
- [ ] Is total article length 600–800 words per subtopic?
- [ ] Does the "How It Works" section assume LLM literacy?

If any checkbox fails, revise before saving.

---

_CONTENT-METHODOLOGY.md v1.3 | Updated 2026-06-23 — Step 4C added: Long Concept Detection and Time Reallocation | Maintained by CEO Agent_
