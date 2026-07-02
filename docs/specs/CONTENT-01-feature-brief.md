# Feature Brief: Content Pipeline Redesign + User Psychology Capture
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-06-23

---

## What Arun Said

Arun ran a live Clio session and found two critical problems:

**Problem 1 — Content, script, and visualization are out of sync.**
The screen showed "Thinking Partner / Language as Interface / Financial Services Fit" while Clio spoke about "Enterprise-grade / On-demand thinking partner / High-Stakes Text-Heavy Work". The visual items and the spoken items were entirely different things. This made the session incoherent.

**Problem 2 — The session is a monologue, not a conversation.**
The current script is a 5-7 minute monologue. A VP of Technology sits and listens but never gets to say what they actually care about, what they already know, or what's driving their interest. Clio doesn't learn anything about the user's specific situation. There is no real conversation.

Arun's direction on how to fix this:

1. **Content** — no filtration, comprehensive, detailed, answers all possible questions on the topic.
2. **Script** — written FROM the content. About 2 mins of teach, then pause, check understanding, then ice breaker — a real conversation with a stranger. Length scales with session duration and interaction budget. Calibrated to VP level: skip "enterprise grade, not a toy" — that is too basic for this audience.
3. **Visualization** — generated FROM the script. Content that goes into the visualization must align with what the script covers. Don't change how visualizations are generated or rendered — only change the actual content (the data passed in) so it matches the script.
4. **User psychology** — Clio should connect with the user and make them open up. Analyze their psychology and intent to learn so Clio can generate future content prioritizing their intent.

---

## The Problem Being Solved

### Problem A: Pipeline order produces structural desynchronization

The current pipeline runs: **Content (Step 1) → Visualization (Step 2) → Script (Step 3)**.

Step 1 (`session-content-generator.ts`) generates `coaching_narrative` and `visual_spec.items` together as part of a single `SubSessionOutline`. Step 2 generates a visual template from `visual_spec`. Step 3 generates the script and is instructed to reference `visual_spec.items` by name in the TEACH segment.

In theory this works. In practice, when the KB cache is stale (Step 1 was previously run with different subtopic titles, or under a different topic_id key), Step 3 reads a `coaching_narrative` and `visual_spec` that belong to a different generation run. The script and the visual end up in different universes.

The root cause is the **cache key problem**: `topic_content_cache` is keyed by `topic_id`, not by `(topic_id, subtopic_slug)`. A re-generate call creates new rows instead of upserting into the existing row, so old rows persist alongside new ones. The GET handler resolves by title-slug matching, but stale rows from prior runs still exist in the table and can be returned.

### Problem B: Script calibration is wrong for VP-level users

The script generator's TEACH segment opens with broad context-setting ("enterprise grade", "AI is not a toy", "what is an LLM"). For a VP of Technology or C-Suite user, this is condescending and wastes the session. These users arrive with baseline competency and want competitive landscape, procurement implications, team adoption strategy, and risk framing — not definitions.

### Problem C: The ice breaker is not functioning as designed

The CHECKPOINT segment exists and asks questions, but it is designed as a comprehension check ("did you understand what I just said?"). The design intent is different: the ice breaker should be an open, genuine conversation-starter that makes the user share their actual situation, motivation, and context. There is no mechanism to capture the user's response or use it for anything — it disappears into the voice session with no effect on future content.

### Problem D: User intent is not captured or used

When a user answers the ice breaker, Clio has no way to record what they said, analyze it, or feed it back into future session content generation. The user's expressed intent (what they care about, what they already know, what's driving the evaluation) is the most valuable signal Clio has — and it is currently discarded.

---

## What Success Looks Like

### After this is built:

1. **Perfect sync, every session.** A user running a session on "What Anthropic Claude is and how it differs from other LLMs in enterprise" will see exactly 3 items on screen — "Constitutional AI → regulated compliance", "200K context → full documents no chunking", "Teams vs API tiers → data governance" — and Clio will speak about those exact three items in that exact order. The visual and the voice are the same content.

2. **VP-calibrated opening.** A VP of Technology opens a session and Clio's first sentence is: "You're probably evaluating Claude alongside at least one other model..." — not "Let me explain what an LLM is." The session starts at the right altitude for the audience.

3. **A real ice breaker moment.** After the 2-minute teach, Clio asks a genuine open question like "What's the specific context driving this evaluation for you right now — is it a use case your team's already experimenting with, or more 'I need to be able to speak to this intelligently with my CTO'?" The question is designed to make the user open up, not test them.

4. **Intent captured and used.** The user's response to the ice breaker is stored against their profile. A background process analyzes it (role-level, what they already know, what they're trying to solve) and updates their `content_profile` so the next session's subtopic ordering and depth reflects what they actually said they care about.

5. **No stale cache desync.** Re-generating a session's content does not create duplicate rows. The upsert uses `(topic_id, subtopic_slug)` as the conflict key. Old data is cleanly replaced.

---

## Known Constraints

### Must happen:
- **Generation order is non-negotiable:** Content (comprehensive article) → Script (calibrated, ice breaker included) → Visualization data (locked to script items). BA must spec this as a hard sequencing requirement.
- **Visualization rendering unchanged.** Only the data passed into the visualization template changes. The template system, the `selectTemplate` call, the `generateTemplateData` call — none of that changes. The output that feeds them must now come from the script, not directly from `visual_spec` generated in Step 1.
- **VP-level rules are explicit, not inferred.** The BA must define explicit prompt rules for what to skip at `vp-dir` and `c-suite` roleLevel. These rules must be hardcoded into the prompt in `script-generator.ts`, not left to the LLM's judgment.
- **Ice breaker is a new segment type.** The existing `ScriptSegmentType` is `TEACH | CHECKPOINT | PROBE | CONTINUE | CLOSE`. A new type `ICE_BREAKER` must be added. The ice breaker replaces or supplements the CHECKPOINT — BA must specify exactly where it sits in the segment order and whether CHECKPOINT is retained.
- **Cache upsert fix is P0.** The `topic_content_cache` table must upsert on `(topic_id, subtopic_slug)` as the conflict key. Without this fix, all other changes risk producing stale desync again on re-generation.
- **User response capture is async.** The live voice session cannot block on an LLM call during a user's spoken response. The architecture must be: capture response → store raw → analyze in background (Inngest job or similar) → update profile. BA must spec the async path.

### Must not happen:
- Do not change the visualization template system (selector, renderer, template types). Only the content data changes.
- Do not add the ice breaker analysis to the synchronous content generation pipeline — it would block the session start.
- Do not make the ice breaker a comprehension check ("did you understand X?"). It must be an open situational question designed to elicit the user's context, not their recall.
- Do not remove the CHECKPOINT segment. CHECKPOINT is a different function (comprehension gate) from ICE_BREAKER (intent/context discovery). Both are needed; BA must spec how they coexist.

---

## Analysis of Current Pipeline (for BA reference)

The pipeline is triggered via `POST /api/sessions/[id]/generate-content`, which fires an Inngest event (`clio/session.content.requested`). The handler in `inngest/session-content-pipeline.ts` runs the steps sequentially per subtopic.

**Current step order (actual, as found in code):**

- **Step 1** — `generateSessionContentOutline` in `session-content-generator.ts`
  - Generates `coaching_narrative` + `visual_spec` (headline, items, template_hint, so_what) together
  - Stores result in `topic_content_cache.content_outline`
  - This is the intended single source of truth, but it produces visual_spec and coaching_narrative in one pass which means visuals are fixed before the script is written

- **Step 2** — `selectTemplate` + `generateTemplateData`
  - Reads `visual_spec` from Step 1 to generate the rendered visual template data
  - Stores result in `topic_content_cache` (template_type, visual data)

- **Step 3** — `generateTrainingScript` in `script-generator.ts`
  - Reads `coaching_narrative` and `visual_spec.items` from Step 1
  - Is instructed to reference `visual_spec.items` by name in TEACH
  - In theory synced; in practice breaks when cache is stale

**The root cause of desync:** Step 1 generates both `coaching_narrative` AND `visual_spec` in a single LLM call. The intent is that both are locked together. But when the cache returns a stale row (old `visual_spec` from a prior run), Step 3 writes a script against the new `coaching_narrative` but the stale `visual_spec` is what gets shown on screen.

**The redesign intent:** Step 1 generates comprehensive content (article-level). Step 2 (renamed) generates the script FROM the content, and the script explicitly names 3 items that will appear on screen. Step 3 (renamed) generates the visualization DATA from the script's named items — not from a separately-generated `visual_spec`. This way the visualization is always a direct reflection of what the script said.

---

## Sample Quality Bar (Approved by Arun)

The BA must use this as the reference standard when writing acceptance criteria. This is not an aspirational example — it is the exact quality level the spec must produce.

### Content (comprehensive article):
Topic: "What Anthropic Claude is and how it differs from other LLMs in enterprise"
- Constitutional AI training approach
- 200K context window vs GPT-4 / Gemini
- Teams vs API vs consumer tier (data governance by tier)
- Why FinServ specifically: data controls, no training on customer data, HIPAA BAA available
- Procurement path: Teams → API via Bedrock for regulated data

### Script (2-min TEACH, VP-calibrated):
Opening: "You're probably evaluating Claude alongside at least one other model..."
- NOT: "Let me explain what an LLM is" or "AI is enterprise-grade now"
3 differentiators named explicitly:
1. Constitutional AI → regulated compliance
2. 200K context → full documents, no chunking required
3. Teams vs API tiers → matched to procurement and data governance needs

CHECKPOINT: "Which of those three factors will your risk and compliance team push back on first?"

ICE_BREAKER: "What's the specific context driving this evaluation for you right now — is it a use case your team's already experimenting with, or more 'I need to be able to speak to this intelligently with my CTO'?"

### Visualization (locked to script):
- Headline: "What Makes Claude Different in Enterprise"
- Items (exactly 3 — the same 3 Clio just taught):
  1. Constitutional AI → fewer confident wrong answers
  2. 200K context → full documents, no chunking
  3. Teams vs API tiers → matched data governance

---

## Questions for BA

The following questions must be answered in the Requirement Document. These are not optional — the developer cannot build without clear answers to each.

**Q1: New pipeline step naming and sequencing**
The current steps are informally Step 1 / Step 2 / Step 3. After the redesign, what are the exact step names and their order? For example: "Step 1: Content Article → Step 2: Script (with ice breaker) → Step 3: Visualization Data." Specify whether Step 2 and Step 3 are sequential or can run in parallel, and whether the Inngest pipeline structure changes.

**Q2: ICE_BREAKER segment placement and format**
Where exactly does ICE_BREAKER appear in the segment sequence for each subtopic? Options: (a) after CHECKPOINT on every subtopic, (b) only on the first subtopic, (c) only on the last subtopic (CLOSE position), (d) once per session, not per subtopic. Also: is CHECKPOINT retained, removed, or merged with ICE_BREAKER?

**Q3: How many items does the visualization show?**
The approved example shows exactly 3 items. Is 3 the fixed number, or is it 3-5 as the current code allows? If the script teaches 3 things, the visual must show 3 things. The BA must define this constraint explicitly and translate it into a prompt rule.

**Q4: VP-level calibration — exact skip rules**
Arun said: "skip 'enterprise grade, not a toy', that's too basic for this audience." The BA must enumerate the complete list of content types/phrases to skip for `vp-dir` and `c-suite`, and specify what to START with instead. These become explicit negative/positive prompt instructions in `script-generator.ts`.

**Q5: Ice breaker response capture — exactly what is stored**
When the user responds to the ice breaker in the live voice session, what is captured? Options: (a) raw transcript of their spoken response, (b) Recall.ai transcript segment, (c) a structured extract (intent type, known concepts, driving use case). Where is it stored — new column on `sessions` table, new table, or added to `user_learning_profile`? BA must define the schema.

**Q6: Ice breaker analysis — what the background job produces**
When the background job analyzes the ice breaker response, what is the output? Specifically: does it produce a list of subtopics to prioritize, a depth-level adjustment, a "user mental model" text summary, or all three? Where does the output live and how does the next session's `generateSessionContentOutline` call read it?

**Q7: Content article format — what "comprehensive" means precisely**
The current `coaching_narrative` is 250-350 words. The new "comprehensive article" (Step 1) — what is its word count target? Is it structured (sections with headers) or prose? Does it include source-level facts (specific numbers like "200K context window") or is it a framework-level narrative? The BA must define the format so the LLM prompt can be written precisely.

**Q8: Cache key conflict resolution**
The upsert fix requires `(topic_id, subtopic_slug)` as the conflict key. Is this a new unique index on `topic_content_cache` that requires a migration? What happens to existing duplicate rows — are they deleted, or does the upsert simply overwrite the most recent? BA must specify what migration 035 (or next available) does and whether existing cache data needs to be cleared.

**Q9: Which roleLevel values trigger the VP-calibration rules?**
The current `roleLevelInstruction` map has keys: `c-suite`, `vp-dir`, `manager`, `specialist`. Do the VP-calibration rules (skip definitions, start at competitive landscape) apply to `vp-dir` only, or also `c-suite`? What about `manager` — does the manager still get some definitional content?

**Q10: Session duration impact on script length**
Arun said "about 2 mins of teach." The current canonical TEACH is 5-7 minutes (300-420 seconds), then `adaptScriptToDuration` condenses it. Under the redesign, is the canonical TEACH now 2 minutes? Or is 2 minutes the condensed target for a short session, with the canonical still being 5-7 min? This affects both the prompt in `script-generator.ts` and the `adaptScriptToDuration` logic.

---

## Scope Boundaries (what this brief does NOT include)

- This brief does not redesign the visualization rendering system. Template types, the `selectTemplate` function, and the `generateTemplateData` function are out of scope. Only the data fed into them changes.
- This brief does not redesign the onboarding flow. Role-level and profile data are read as-is from existing columns.
- This brief does not include a UI for reviewing captured ice breaker responses. That is a future feature.
- This brief does not change the Recall.ai integration or how live session transcripts are captured. It only specifies what to do with the transcript data once captured.
- Playlist-level content sequencing (which subtopics to surface in future sessions) is a downstream consequence of intent capture, but the algorithm for that sequencing is not in scope for this brief. The BA should specify only the data that is stored, not the full recommendation engine.

---

## Handoff to Business Analyst Agent

BA Agent — you have been passed this Feature Brief. Before writing the Requirement Document, read the following files:

1. `/Users/arunprakash/Documents/claudeWS/distill/distill/lib/content/session-content-generator.ts` — current Step 1
2. `/Users/arunprakash/Documents/claudeWS/distill/distill/lib/content/script-generator.ts` — current Step 3 (script)
3. `/Users/arunprakash/Documents/claudeWS/distill/distill/inngest/session-content-pipeline.ts` — understand the full step sequence and where Steps 2 (template) and 3 (script) are called
4. `/Users/arunprakash/Documents/claudeWS/distill/distill/lib/templates/generator.ts` — understand what data `generateTemplateData` receives (this is what changes, not the function itself)
5. The approved example in the "Sample Quality Bar" section above — treat this as a specification, not an illustration

Your Requirement Document must cover all 12 standard sections plus answers to all 10 questions (Q1–Q10) above in Section 11. Do not pass the spec to a developer with any of Q1–Q10 unanswered.

The output spec file should be saved to: `docs/specs/CONTENT-01-requirement-document.md`

This is P0. The session experience is broken for users today. Move fast but write completely.
