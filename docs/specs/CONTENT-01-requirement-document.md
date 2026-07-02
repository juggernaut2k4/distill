# Content Pipeline Redesign + User Psychology Capture — Requirement Document
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-06-23

---

## 1. Purpose

The current Clio content pipeline produces coaching sessions where the screen content and Clio's spoken words describe entirely different things. A VP of Technology watching a session on Claude's enterprise differentiation sees "Thinking Partner / Language as Interface / Financial Services Fit" on screen while Clio speaks about "Enterprise-grade / On-demand thinking partner / High-Stakes Text-Heavy Work." These are unrelated. The session is incoherent and cannot be corrected by user effort — the problem is structural.

There are four compounding root causes. First, the pipeline generates visualization items and coaching narrative in the same LLM call (Step 1), then generates the script separately in Step 3. When the cache returns a stale row from a prior generation run, Step 3 scripts against one `coaching_narrative` while the screen shows `visual_spec` from a different run. Second, the script calibration for VP and C-Suite audiences opens with definitional content ("enterprise-grade AI," "what is an LLM") that is condescending and wastes the session's first minute. Third, the session is a monologue — the user never speaks, and Clio never learns anything about what the user actually cares about. Fourth, there is no mechanism to store, analyse, or act on what a user says during a session.

Without this fix, every Clio session is structurally broken for real users today. The screen and voice will continue to desynch on any re-generation. VP-level users will continue receiving introductory-level framing. No user intent data will ever be captured.

---

## 2. User Story

**Story 1 — Executive attending a session:**
As a VP of Technology attending a Clio session,
I want the visual on screen to show exactly what Clio is currently teaching me,
So that I can follow along without cognitive switching between what I see and what I hear.

**Story 2 — Executive sharing context:**
As a VP of Technology attending a Clio session,
I want Clio to ask me an open question about my actual situation after the teaching segment,
So that my specific context (evaluation drivers, team status, use cases) shapes how future sessions are taught to me.

**Story 3 — Platform improving over time:**
As a returning Clio user,
I want the platform to remember what I told Clio in previous sessions about my intent and context,
So that each subsequent session is calibrated to what I actually care about, not just my onboarding answers.

---

## 3. Trigger / Entry Point

This feature does not have a user-visible entry point. It is a backend pipeline redesign. The pipeline is triggered when:

- **Trigger:** A session content generation request is made — either when a user approves their session plan, or when a manual re-generate is issued.
- **Current event name:** `clio/session.content.requested` (fired by `POST /api/sessions/[id]/generate-content`)
- **Event data:** `{ jobId: string, sessionId: string, userId: string }`
- **Handler location:** `inngest/session-content-pipeline.ts` — the `sessionContentPipeline` Inngest function
- **User state required:** The user must be authenticated (Clerk), the session must exist in the `sessions` table with a valid `id`, and the session must not already have `content_status = 'ready'` (the POST handler short-circuits in that case).
- **The ice breaker response capture** is triggered differently: during a live voice session via Recall.ai, the Inngest job `distill/session.ice-breaker.response` is emitted after a session ends. This is an async, post-session event — separate from content generation.

---

## 4. Screen / Flow Description

This section describes two distinct flows: (A) the content generation pipeline (backend, no user-visible screen), and (B) the live session experience with ice breaker (user-visible change).

### 4A. Content Generation Pipeline (Backend)

The pipeline runs inside `inngest/session-content-pipeline.ts`. The redesign changes the internal step sequence. There is no change to how the pipeline is triggered or how the user experiences the "generating" state.

**Current step sequence (broken):**
1. Generate content outline per subtopic — includes `coaching_narrative` + `visual_spec` in one call
2. Generate training script — reads `coaching_narrative` and `visual_spec` from Step 1
3. Select template
4. Generate template data — reads `visual_spec` from Step 1
5. Save to `topic_content_cache`
6. Mark session `content_status = 'ready'`

**New step sequence (redesigned):**

**Step A — Fetch session data** (unchanged from current)
Read `sessions` and `users` tables to get `subtopicTitles` and `userContext`.

**Step B — Mark session as generating** (unchanged)
Set `content_status = 'generating'` on `sessions`.

**Step C — Generate Content Articles**
Call the renamed function `generateContentArticles(sessionId, topicId, topicTitle, subtopicTitles, userId, userContext)` in `lib/content/session-content-generator.ts`.

For each subtopic, this function generates a `ContentArticle` — a comprehensive, unfiltered reference document that answers every substantive question a user could have about this subtopic. The article is structured (see Section 6 for schema). This replaces the current `SubSessionOutline.coaching_narrative` as the source of truth.

Output: one `ContentArticle` per subtopic. These are NOT stored individually yet — they are passed as input to Step D.

**Step D — Generate Script + Visualization Spec (atomic, per subtopic)**
For each subtopic, call `generateScriptAndVisualization(article, userContext)` in `lib/content/script-generator.ts`.

This is a single LLM call that produces both the script segments AND the visualization spec in one response. Structural desync is impossible because they share the same LLM call.

The script segments produced are, in order:
1. `TEACH` — spoken teaching, calibrated to role level, 2 minutes canonical length
2. `CHECKPOINT` — one targeted comprehension question that reveals whether the user can apply the concept
3. `ICE_BREAKER` — one open situational question designed to elicit the user's context, motivation, and use case (not a comprehension check)
4. `PROBE` — reframing fallback if the user seems uncertain on CHECKPOINT
5. `CONTINUE` — bridge to the next concept (for non-final subtopics)
6. `CLOSE` — session wrap-up (last subtopic only)

The visualization spec produced contains exactly 3 items. These 3 items are the same 3 things Clio names explicitly in the TEACH segment. The script and visualization are locked together by the same LLM call.

**Step E — Select Template** (unchanged function, changed input)
Call `selectTemplate(subtopicTitle, position)` — same function as today.

**Step F — Generate Template Data** (unchanged function, changed input)
Call `generateTemplateData(templateType, subtopicTitle, sessionTitle, userContext, undefined, contentSpec)` where `contentSpec` is populated from the `visual_spec` output of Step D. The `contentSpec.items` field carries the 3 locked items from the script. This is unchanged in function signature but now receives items that come from Step D rather than Step C.

**Step G — Save to `topic_content_cache`** (upsert, changed conflict key)
Upsert the complete record: content article, training script, template data, visualization spec. Conflict resolution on `(topic_id, subtopic_slug, industry, role)` — this constraint already exists from migration 035. No new migration required for the upsert itself. See Section 6F for the duplicate-row cleanup migration (migration 036-next).

**Step H — Mark session ready** (unchanged guard logic from current KB-01 fix)
Verify cache rows exist before marking `content_status = 'ready'`.

### 4B. Live Session — Ice Breaker Experience

The ice breaker is a new segment type (`ICE_BREAKER`) that appears in the script after the `CHECKPOINT` segment, for every subtopic. During the live Recall.ai voice session, Clio reads the `ICE_BREAKER` segment text as spoken dialogue.

**From the user's perspective:**

After the 2-minute TEACH and the CHECKPOINT question, the user hears Clio ask an open question — not "did you understand that?" but something genuinely conversational about their situation, for example: "What's the specific context driving this evaluation for you right now — is it a use case your team's already experimenting with, or more 'I need to be able to speak to this intelligently with my CTO'?"

The user speaks their answer. Recall.ai captures the full session transcript. No special UI is shown to the user during this moment — it is spoken conversation.

After the session ends, the system captures the ice breaker response. This happens asynchronously. There is no in-session blocking on any LLM call for response capture.

### 4C. Post-Session Intent Analysis (Async Background Job)

After the live session ends, an Inngest function `analyzeIceBreakerResponse` is triggered by the event `distill/session.ice-breaker.response`. This function:

1. Reads the raw ice breaker response from `session_insights` (see Section 6)
2. Calls Claude with a structured extraction prompt to identify: `learning_intent`, `knowledge_level`, and `organizational_context`
3. Writes extracted signals to `session_insights.extracted_signals` (JSONB)
4. Upserts into `user_learning_profiles` the relevant fields that the signals map to

There is no UI for reviewing this data in this version (out of scope per CEO brief).

---

## 5. Visual Examples

### 5A. Pipeline Step Sequence

The pipeline is not user-visible. The wireframe below illustrates the execution flow for developer reference:

```
INNGEST: session-content-pipeline
──────────────────────────────────────────────────
Step A │ fetch-session-data
       │   → reads sessions, users
       │
Step B │ mark-generating
       │   → sessions.content_status = 'generating'
       │
Step C │ generate-content-articles  [ONE call for ALL subtopics]
       │   → input:  subtopicTitles[], userContext
       │   → output: ContentArticle[] (one per subtopic)
       │   → NOT saved to DB yet
       │
       For each subtopic (sequential loop):
       │
Step D │ generate-script-and-visualization  [ONE atomic LLM call per subtopic]
       │   → input:  ContentArticle, userContext
       │   → output: TrainingScript (with ICE_BREAKER segment)
       │             VisualizationSpec (exactly 3 items, same as TEACH names)
       │
Step E │ select-template  [unchanged]
       │   → selectTemplate(subtopicTitle, position)
       │
Step F │ generate-template-data  [unchanged function, new contentSpec input]
       │   → generateTemplateData(..., contentSpec from Step D)
       │
Step G │ save-to-cache  [upsert on (topic_id, subtopic_slug, industry, role)]
       │   → writes: content_article, training_script, section_data, template_type
       │
Step H │ mark-session-ready  [unchanged guard logic]
       │   → sessions.content_status = 'ready' (only if rows verified)
──────────────────────────────────────────────────
```

### 5B. New Script Segment Sequence (per subtopic)

```
SUBTOPIC: "Constitutional AI and Enterprise Safety"
─────────────────────────────────────────────────────────────────
[TEACH — 2 min, ~240 words]
"You're probably evaluating Claude alongside at least one other
model, so let me give you the three differentiators that will
matter most to your risk and compliance team.

On your screen you'll see three items. First:
Constitutional AI — this is Anthropic's training methodology that
makes Claude systematically less likely to give confidently wrong
answers in high-stakes domains. For FinServ, that translates
directly to compliance exposure...

Second: 200K context window — this means you can feed it an
entire contract, regulatory document, or earnings call and it
holds the full context. No chunking, no retrieval hallucination.

Third: Teams vs API tiers — the data governance story is
completely different at each tier. Teams = no training on your
data. API via Bedrock = you own the data pipeline..."

[CHECKPOINT — 60 sec]
"Which of those three factors will your risk and compliance team
push back on first?"

[ICE_BREAKER — 60 sec]
"What's the specific context driving this evaluation for you right
now — is it a use case your team's already experimenting with, or
more 'I need to be able to speak to this intelligently with my
CTO'?"

[PROBE — 60 sec]
"Let me try a different angle — if I put it this way:
your compliance team already has a checklist for new SaaS tools.
Constitutional AI just gives you a new row to add to that
checklist..."

[CONTINUE — 45 sec]
"Good. So the core takeaway is: regulated compliance via
architecture, not just policy. Let's carry that into the next
section."

[CLOSE — last subtopic only, 120 sec]
"That wraps today's session. We covered Constitutional AI,
context window implications, and tier-based data governance.
You now have the vocabulary to ask your CTO the right procurement
questions without needing them to explain the technology to you.
Next time, we'll be looking at Teams rollout vs API procurement —
come with any questions from today."
─────────────────────────────────────────────────────────────────
```

### 5C. Visualization — Locked to Script (3 Items)

```
SCREEN DISPLAY (rendered by template system, unchanged)
─────────────────────────────────────────────────────────────────
┌─────────────────────────────────────────────────────┐
│  What Makes Claude Different in Enterprise          │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Constitutional AI                            │  │
│  │  Fewer confident wrong answers in regulated   │  │
│  │  domains — by training design, not policy     │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  200K Context Window                          │  │
│  │  Full documents, no chunking required         │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Teams vs API Tiers                           │  │
│  │  Data governance matched to procurement       │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  As a VP of Technology in FinServ: the Teams tier   │
│  removes the data-training objection from legal.    │
└─────────────────────────────────────────────────────┘

Items on screen = exact items Clio named in TEACH
Script TEACH names: Constitutional AI | 200K Context | Teams vs API
Screen items:       Constitutional AI | 200K Context | Teams vs API
─────────────────────────────────────────────────────────────────
```

---

## 6. Data Requirements

### 6A. New Type: `ContentArticle`

Add field `content_article` to the `SubSessionOutline` interface in `lib/content/session-content-generator.ts`. This field is distinct from `coaching_narrative` (which is retained for backward compatibility with existing KB entries but is no longer the script source of truth).

`content_article` is a structured object:

```typescript
interface ContentArticle {
  subtopic_title: string
  subtopic_slug: string
  // Core knowledge: answers every question a user could ask
  sections: {
    overview: string            // 100-150 words: what this is and why it matters now
    key_facts: string[]         // 4-6 specific, citable facts with numbers where available
    how_it_works: string        // 100-150 words: mechanism, not theory
    enterprise_implications: string  // 100-150 words: what it means for the buyer/decision-maker
    common_misconceptions: string[]  // 2-4 myths with corrections
    decision_questions: string[]     // 3-5 questions the user should be able to answer after this
  }
  // Metadata
  role_relevance: string        // one sentence: why this matters to this specific role
  industry_angle: string        // one sentence: specific to the user's industry
  source_concepts: string[]     // key terms used in this article (for future indexing)
}
```

Total content article: approximately 600-800 words across all sections. No word limit enforced — comprehensive is the goal. This is never shown to the user directly; it is the source document for Step D.

### 6B. New Type: `ScriptSegmentType` — add `ICE_BREAKER`

In `lib/content/script-generator.ts`, update the union type:

```typescript
// Current:
export type ScriptSegmentType = 'TEACH' | 'CHECKPOINT' | 'PROBE' | 'CONTINUE' | 'CLOSE'

// After this change:
export type ScriptSegmentType = 'TEACH' | 'CHECKPOINT' | 'ICE_BREAKER' | 'PROBE' | 'CONTINUE' | 'CLOSE'
```

### 6C. New Type: `ScriptAndVisualizationOutput`

The combined output of the new atomic Step D LLM call:

```typescript
interface VisualizationSpec {
  headline: string     // max 8 words — visual section title
  items: [string, string, string]  // exactly 3 items — typed tuple, not array
  so_what: string      // max 30 words, personalised to role/industry
}

interface ScriptAndVisualizationOutput {
  segments: ScriptSegment[]      // in order: TEACH, CHECKPOINT, ICE_BREAKER, PROBE, CONTINUE (+ CLOSE on last)
  visualization_spec: VisualizationSpec
  total_duration_seconds: number
}
```

The `items` field is typed as a 3-tuple (not `string[]`) to make it structurally impossible to produce a different count without a TypeScript error.

### 6D. New Table: `session_insights`

This table stores raw and extracted ice breaker responses per session.

```sql
CREATE TABLE IF NOT EXISTS session_insights (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id          uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id             text        NOT NULL,  -- Clerk user ID
  subtopic_slug       text        NOT NULL,  -- which subtopic's ice breaker this is
  -- Raw capture
  raw_transcript      text        NOT NULL,  -- verbatim spoken response from Recall.ai transcript
  segment_type        text        NOT NULL DEFAULT 'ice_breaker_response',
  captured_at         timestamptz NOT NULL DEFAULT now(),
  -- Extracted signals (written by background job, null until job runs)
  extracted_signals   jsonb       DEFAULT NULL,
  -- extracted_signals shape:
  -- {
  --   "learning_intent": string,         -- e.g. "prepare for CTO conversation"
  --   "knowledge_level": string,         -- e.g. "knows LLM basics, unfamiliar with deployment tiers"
  --   "organizational_context": string,  -- e.g. "team is in early POC, vendor evaluation ongoing"
  --   "urgency": "low" | "medium" | "high",
  --   "primary_driver": string           -- e.g. "compliance", "cost", "competitive"
  -- }
  analysis_status     text        NOT NULL DEFAULT 'pending',  -- pending | complete | failed
  analyzed_at         timestamptz DEFAULT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_insights_session
  ON session_insights (session_id);

CREATE INDEX IF NOT EXISTS idx_session_insights_user
  ON session_insights (user_id, captured_at DESC);

ALTER TABLE session_insights ENABLE ROW LEVEL SECURITY;

-- Service role only — no direct client reads
CREATE POLICY "service_role_all_si" ON session_insights
  USING (auth.role() = 'service_role');
```

### 6E. `user_learning_profiles` — Fields Updated by Ice Breaker Analysis

The background analysis job updates the following existing columns in `user_learning_profiles` (all columns already exist from migrations 017 and 031):

| Column | Update logic |
|--------|-------------|
| `learning_motivation` | Derived from `extracted_signals.primary_driver`: `compliance` → `compliance_driven`; `competitive` → `opportunity_driven`; `cost` → `fear_driven` |
| `business_focus_lens` | Derived from `extracted_signals.primary_driver` directly |
| `vocab_fingerprint.detected_register` | Inferred from vocabulary in raw transcript |
| `vocab_fingerprint.domain_terms` | Key domain terms extracted from raw transcript (capped at 30 total across all sessions) |
| `profile_confidence` | Increments: `low` (0-2 sessions with ice breaker responses), `medium` (3-6), `high` (7+) |
| `sessions_used_for_profile` | Incremented by 1 each time the background job completes successfully |

No new columns are added to `user_learning_profiles` by this feature.

### 6F. Database Migration: Duplicate Row Cleanup

The existing unique constraint on `topic_content_cache` as of migration 035 is:
```sql
UNIQUE (topic_id, subtopic_slug, industry, role)
```

This constraint is the correct conflict key for upserts. The pipeline already uses `{ onConflict: 'topic_id,subtopic_slug' }` (without industry and role) — this must be updated to `{ onConflict: 'topic_id,subtopic_slug,industry,role' }` in `inngest/session-content-pipeline.ts`.

A cleanup migration (next available number after 037, which we call **migration 038**) must run before the updated pipeline goes live, to eliminate any duplicate rows that would cause the new upsert to fail:

```sql
-- Migration 038: Clean up duplicate topic_content_cache rows
-- before the new pipeline goes live with the correct composite upsert.
-- Keeps the most recently generated row per (topic_id, subtopic_slug, industry, role).
-- Safe to run as a one-time operation — idempotent.

DELETE FROM topic_content_cache
WHERE id NOT IN (
  SELECT DISTINCT ON (topic_id, subtopic_slug, industry, role) id
  FROM topic_content_cache
  ORDER BY topic_id, subtopic_slug, industry, role, generated_at DESC
);
```

### 6G. New Inngest Event + Function

**New event emitted** at the end of a live session (by the Recall.ai webhook handler or session-end handler):
```
Event name: distill/session.ice-breaker.response
Event data: {
  sessionId: string,
  userId: string,
  subtopicSlug: string,
  rawTranscript: string    -- the user's spoken response, extracted from Recall.ai transcript
}
```

**New Inngest function:** `analyzeIceBreakerResponse` in `inngest/ice-breaker-analyzer.ts`
- Triggered by: `distill/session.ice-breaker.response`
- Step 1: Write raw transcript to `session_insights` (INSERT)
- Step 2: Call Claude with extraction prompt (see Section 7 for quality bar)
- Step 3: Update `session_insights.extracted_signals` and set `analysis_status = 'complete'`
- Step 4: Upsert `user_learning_profiles` with derived signal values
- Retry config: `{ retries: 2 }` — failure is non-fatal; the session still completed

### 6H. Reads

The `generateContentArticles` function reads:
- `sessions` table: `session_title`, `topic_id`, `sub_sessions`, `session_plan`
- `users` table: `role`, `industry`, `ai_maturity`, `role_level`
- `user_learning_profiles` table: all columns (passed as `profileContext` string into script generation prompt when `profile_confidence = 'medium'` or `'high'`)
- `topic_content_cache` table: existing content for this `topic_id` (to avoid repeating concepts)
- `sessions` table: previous completed sessions for this user (to build context)

### 6I. No localStorage / sessionStorage Changes

This feature has no frontend changes. No client-side storage is used.

---

## 7. Success Criteria (Acceptance Tests)

**AC-01 — Script and screen items are always identical**
Given a session on any topic for any user, when the content pipeline completes, then the 3 items in `topic_content_cache.training_script` TEACH segment match exactly (character-for-character after normalisation) the 3 items in `topic_content_cache.section_data.data` that the template renders on screen.

**AC-02 — Re-generation does not desynch**
Given a session that has been generated once (content_status = 'ready'), when the content_status is reset to 'pending' and the pipeline is re-run for the same session, then the screen items and TEACH script items remain in sync — no stale rows from the prior run appear on screen.

**AC-03 — VP-calibration rules are enforced**
Given a user with `role_level = 'vp-dir'` or `role_level = 'c-suite'`, when a session is generated on any AI topic, then the TEACH segment does NOT contain any of these phrases or their close equivalents: "let me explain what an LLM is", "AI is enterprise-grade", "AI is not a toy", "what is a large language model", "here's how AI works at a basic level". The TEACH segment DOES open with a sentence that assumes existing AI familiarity (e.g. assumes the user knows what a model is, and opens on competitive landscape, procurement, or risk framing).

**AC-04 — ICE_BREAKER is present in every subtopic's script**
Given any generated session, when the training script for any subtopic is inspected in `topic_content_cache.training_script.segments`, then exactly one segment of type `ICE_BREAKER` is present per subtopic, appearing after the `CHECKPOINT` segment and before the `PROBE` segment.

**AC-05 — ICE_BREAKER is an open situational question, not a comprehension check**
Given the `ICE_BREAKER` segment text for any generated subtopic, when reviewed, then it must ask about the user's situation, motivation, or use case — it must not ask "did you understand", "can you recall", "what does X mean", or any variant of a knowledge recall question. The question must be open-ended (not yes/no), and must reference one of: the user's evaluation context, their team's status, a driving use case, or a stakeholder they need to address.

**AC-06 — Exactly 3 visualization items, not 2 or 4**
Given any generated subtopic, when `topic_content_cache.training_script` visualization_spec is inspected, then `visualization_spec.items` has exactly 3 entries. Given the generated `section_data` for the same subtopic, when the rendered template data is inspected, then it contains exactly 3 primary items (steps, components, insights, quadrants, etc. — depending on template type). Never 2, never 4.

**AC-07 — Upsert replaces stale content, not appends**
Given a `topic_content_cache` row exists for `(topic_id='X', subtopic_slug='Y', industry='financial-services', role='vp')`, when the pipeline runs again for the same session, then after completion there is still exactly 1 row for that combination in `topic_content_cache`, not 2.

**AC-08 — Content article is comprehensive**
Given any generated content article in `topic_content_cache.content_outline.content_article`, when inspected, then it contains all 6 required sections (`overview`, `key_facts`, `how_it_works`, `enterprise_implications`, `common_misconceptions`, `decision_questions`), `key_facts` has at least 4 entries, `common_misconceptions` has at least 2 entries, and `decision_questions` has at least 3 entries.

**AC-09 — Ice breaker response is captured and stored**
Given a live session that has ended and an ice breaker was reached, when the `distill/session.ice-breaker.response` Inngest event fires, then a new row is written to `session_insights` with `segment_type = 'ice_breaker_response'`, `analysis_status = 'pending'`, and a non-empty `raw_transcript`.

**AC-10 — Background analysis job extracts and stores signals**
Given a `session_insights` row with `analysis_status = 'pending'`, when `analyzeIceBreakerResponse` completes, then `extracted_signals` is a non-null JSONB object containing at minimum `learning_intent`, `knowledge_level`, `organizational_context`, and `primary_driver`; `analysis_status` is `'complete'`; and `user_learning_profiles.sessions_used_for_profile` has been incremented by 1.

**AC-11 — Pipeline still completes when Anthropic API key is placeholder**
Given `ANTHROPIC_API_KEY` is set to a placeholder value, when the content pipeline runs, then it completes without throwing, returns mock content for all steps, and marks `content_status = 'ready'` — matching current mock-mode behaviour.

**AC-12 — Manager-level users still receive some definitional content**
Given a user with `role_level = 'manager'`, when a session is generated, then the TEACH segment includes at least one explanatory sentence that defines or contextualises a key concept (not exclusively competitive-landscape-only framing as specified for vp-dir/c-suite).

---

## 8. Error States

### 8A. Step C (Content Article Generation) fails
If the Claude call in `generateContentArticles` fails (timeout, API error, JSON parse failure), the Inngest step throws. Inngest retries up to 2 times with exponential backoff (existing pipeline retry config). If all retries exhaust, `onFailure` fires the admin alert email via `sendAdminAlert`. The session remains in `content_status = 'generating'` — the stale-ready recovery cron will detect it and re-trigger. The user sees no error — the "Generating your session..." state persists.

### 8B. Step D (Script + Visualization) fails for one subtopic
If the Claude call in `generateScriptAndVisualization` fails or the response does not parse as valid JSON, the `step.run` for that subtopic throws and Inngest retries the full step (not just that subtopic). On total failure, admin alert fires. Other subtopics that succeeded are already written to cache and are not affected.

**Fallback within Step D:** If the parsed JSON has `visualization_spec.items` with a count other than 3, the code corrects it: if fewer than 3 items, duplicate the last item to fill to 3; if more than 3 items, truncate to first 3. This prevents downstream template failures. The correction is logged as a warning: `[session-content-pipeline][WARN] visualization_spec item count corrected from N to 3`.

### 8C. Step F (Template Data Generation) fails
Identical to current behaviour — `generateTemplateData` has its own try/catch that falls back to `getMockData(templateType, subtopicTitle)`. The session still completes.

### 8D. Step G (Upsert) fails
If the Supabase upsert fails (constraint violation, network error), the code throws — matching the KB-01 fix already in place (`if (upsertError) throw`). Inngest retries. Admin alert fires on exhaustion.

### 8E. Ice Breaker Analyzer fails
If `analyzeIceBreakerResponse` fails (Claude error, parse failure, Supabase error), the `session_insights` row remains with `analysis_status = 'pending'`. The function retries 2 times. On exhaustion, `analysis_status` is set to `'failed'` and a console error is logged. This is non-fatal — the live session is already complete, and the user profile simply does not get updated from this session's ice breaker.

### 8F. Ice Breaker response not captured (no event emitted)
If the Recall.ai webhook does not fire or the ice breaker segment is not identifiable in the transcript, no event is emitted and no `session_insights` row is written. The pipeline is unaffected — ice breaker capture is best-effort.

### 8G. Slow pipeline — user waits for "Generating..."
No change from current behaviour. The UI polls `GET /api/sessions/[id]/generate-content` and shows per-subtopic progress. Content generation is asynchronous and the user is informed.

---

## 9. Edge Cases

**Edge case 1 — Re-generation while session is active (content_status = 'generating')**
The POST handler already short-circuits on `content_status = 'ready'`. It does NOT short-circuit on `'generating'`. If a user manages to trigger a second POST while the first pipeline is running, two pipeline instances will race. The upsert constraint (`UNIQUE (topic_id, subtopic_slug, industry, role)`) ensures the last writer wins without creating duplicates. This is acceptable — the correct content will be in cache after either run completes.

**Edge case 2 — Subtopic count mismatch (Claude returns fewer subtopics than requested)**
If `generateContentArticles` returns fewer `ContentArticle` objects than `subtopicTitles.length`, the pipeline logs a warning and processes only the returned articles. The session may have 1-2 subtopics without content — they show as `pipeline_status = 'pending'` in the GET response. If any subtopic fails, the session is left in `generating` (not marked ready). The pipeline will retry on the next trigger. **Decision (Arun, 2026-06-23):** Partial runs stay in `generating` — stale content will be cleared and retried, not surfaced as ready.

**Edge case 3 — User with role_level not in the calibration map**
If `userContext.roleLevel` is not one of `c-suite | vp-dir | manager | specialist`, the script generator falls back to the `manager` calibration rule (some definitional content, practical framing). This is the safest default.

**Edge case 4 — Ice breaker question during first-ever subtopic vs later subtopics**
The ice breaker appears on every subtopic (not just the first). For a user on their first-ever session, the first ice breaker question has no prior context to draw on. The question must still be open and situational but does not reference prior sessions. For subtopics after the first, the script generator receives `profileContext` from `user_learning_profiles` which may (if populated) allow the ice breaker to reference what was previously shared. For the first session, `profileContext` is empty.

**Edge case 5 — Profile confidence is 'low' (0-2 sessions)**
When `profile_confidence = 'low'`, the `profileContext` block is NOT injected into the script generation prompt. The session uses maturity-level calibration only. This matches the existing behaviour in `generateTrainingScript` where `profileBlock` is conditionally included.

**Edge case 6 — Duplicate `session_insights` rows for same subtopic**
If the `distill/session.ice-breaker.response` event is emitted twice for the same session and subtopic (e.g., webhook retry), two rows would be written. This is acceptable for V1 — the analysis job will process both but only the first `user_learning_profiles` upsert persists. A future migration can add a unique constraint on `(session_id, subtopic_slug, segment_type)` if deduplication is needed.

**Edge case 7 — User's `role_level` is `specialist`**
Specialist-level users are practitioners, not executives. The VP calibration rules (skip definitions) do NOT apply. Specialists receive the full definitional content, technical depth, and implementation detail. The `roleLevelInstruction` map for `specialist` is unchanged.

**Edge case 8 — Session has 0 subtopics**
If `subtopicTitles` is empty (an upstream bug, e.g. SESS-06 not yet fixed), the pipeline skips the per-subtopic loop entirely. Zero rows are written to `topic_content_cache`. Step H detects zero rows and throws, preventing the session from being marked ready. This matches the existing KB-01 guard. No new handling required.

---

## 10. Out of Scope

The following are explicitly NOT part of this feature:

1. **Visualization rendering system changes.** The `selectTemplate` function, `generateTemplateData` function, all template types, the ReactFlow rendering, the tab manifest, and the visual display in the live session are unchanged. Only the data fed into `generateTemplateData` changes.

2. **Onboarding flow changes.** Role-level and profile data are read as-is from existing columns. No new onboarding questions or steps.

3. **UI for reviewing ice breaker responses.** There is no admin or user-facing screen to view captured intent signals. That is a future feature.

4. **Recall.ai integration changes.** The integration that captures live session transcripts is unchanged. This spec only defines what to do with transcript data once it exists in the system.

5. **Subtopic sequencing / recommendation engine.** The data captured by ice breaker analysis is stored (per this spec) but the algorithm that changes which subtopics to surface in future sessions is not in scope. The data is stored so that future work can use it.

6. **Playlist-level content reordering.** Changing the order of sessions in a curriculum plan based on intent signals is out of scope.

7. **Canonical script duration target change.** The `adaptScriptToDuration` function is not changed in this spec. The canonical TEACH duration remains as set in the LLM prompt; the adaptation logic is unchanged. The "2-minute TEACH" is the prompt instruction, not a change to the adaptation algorithm.

8. **`coaching_narrative` field removal.** The existing `coaching_narrative` field on `SubSessionOutline` is retained for backward compatibility with existing KB entries. It is not used as the script source in new generations.

9. **Changes to `getCachedSection` or `setCachedSection` in `lib/topic-cache.ts`.** The cache read in Step F is unchanged — if a cached section exists, it is used. Only the fallback generation path receives the new `contentSpec` input.

10. **Changes to `adaptScriptToDuration`.** Duration adaptation is unchanged. The developer must not modify this function as part of this spec.

---

## 11. Open Questions

None.

All 10 questions from the CEO brief (Q1–Q10) are resolved below.

**Q1 — New pipeline step naming and sequencing**
Resolved in Section 4A. The new step names are: Step C (Content Articles), Step D (Script + Visualization — atomic), Step E (Select Template), Step F (Template Data), Step G (Save to Cache), Step H (Mark Ready). Steps D, E, F, G are sequential within each subtopic loop — they cannot run in parallel because each step's output feeds the next. Step C is one call covering all subtopics. The Inngest pipeline structure (one `sessionContentPipeline` function, sequential `step.run` calls) is unchanged. No new Inngest function is added for generation; the new `analyzeIceBreakerResponse` is a separate function for post-session processing only.

**Q2 — ICE_BREAKER placement and format**
Resolved in Sections 4A and 4B. ICE_BREAKER appears after CHECKPOINT on every subtopic. Segment order per subtopic: TEACH → CHECKPOINT → ICE_BREAKER → PROBE → CONTINUE (+ CLOSE on last subtopic). CHECKPOINT is retained — it serves a different function (comprehension gate) from ICE_BREAKER (intent/context discovery). Both are needed. ICE_BREAKER is not a per-session single occurrence — it appears once per subtopic. The format of the ICE_BREAKER question is always: open-ended, situational, referencing the user's context (team, use case, stakeholder, evaluation driver), not recalling content.

**Q3 — How many items the visualization shows**
Resolved in Sections 4A, 5C, and 6C. Exactly 3 items, always. This is enforced structurally: the `VisualizationSpec.items` field is typed as a 3-tuple `[string, string, string]`, not `string[]`. The LLM prompt instructs exactly 3. The runtime correction fallback (Section 8B) fixes any deviation. The prompt rule for `generateTemplateData` when `contentSpec` is provided already instructs "do not substitute" — with 3 items, the template renders exactly those 3.

**Q4 — VP-level calibration — exact skip rules**
Resolved here. These are the explicit prompt instructions for `role_level = 'vp-dir'` and `role_level = 'c-suite'`:

**NEGATIVE rules (DO NOT include any of the following for vp-dir or c-suite):**
- Do not open with any definition of what an LLM or AI is. Assume the user knows.
- Do not use phrases: "enterprise-grade", "AI is not a toy", "let me explain what [term] means", "at a basic level", "to understand AI you need to know", "AI has evolved significantly".
- Do not include analogies that explain foundational technology concepts (e.g. "think of AI like a very smart calculator").
- Do not present competitive landscape as "here are the players" from scratch — assume awareness of OpenAI, Google, Anthropic.

**POSITIVE rules (DO start with one of the following for vp-dir or c-suite):**
- Open with: competitive positioning, procurement implications, regulatory/compliance framing, risk differentiation between vendors, team adoption strategy, or the question "what does this mean for a decision you need to make in the next 90 days."
- Examples of valid TEACH opening sentences: "You're probably evaluating [vendor] alongside at least one other model..." / "The procurement question your legal team will ask is..." / "Your compliance team's objection to any LLM is always the same — data governance..." / "The differentiator that actually matters in regulated industries is..."
- Go deep on: vendor differentiation, procurement paths, data governance by tier, compliance architecture, team adoption strategy.

**Manager rule (role_level = 'manager'):** Include one explanatory sentence per key concept — functional, not definitional. Example: "Constitutional AI is Anthropic's training approach — what it means in practice is fewer confident wrong answers in high-stakes domains." Managers receive practical framing, not board-level strategic framing and not definitional-only content.

**Specialist rule (role_level = 'specialist'):** Unchanged from current — full technical depth, implementation detail, API specifics.

**Q5 — Ice breaker response capture — exactly what is stored**
Resolved in Section 6D. The `session_insights` table stores: `session_id`, `user_id`, `subtopic_slug`, `raw_transcript` (verbatim spoken response from Recall.ai transcript), `segment_type = 'ice_breaker_response'`, and `extracted_signals` (written by background job, initially null). Storage is in the new `session_insights` table — not `sms_conversations` (that is for SMS delivery channel), not `user_learning_profiles` (that holds derived signals, not raw text), not added as a column to `sessions`. The `session_insights` table is the correct home for raw conversational captures.

**Q6 — Ice breaker analysis — what the background job produces**
Resolved in Sections 4C, 6D, and 6E. The background job (`analyzeIceBreakerResponse`) produces a structured extract with 5 fields: `learning_intent` (string — what the user wants to get from this), `knowledge_level` (string — what they already know), `organizational_context` (string — team/vendor/use case context), `urgency` (enum: low/medium/high), `primary_driver` (string — the dominant motivation: compliance, cost, competitive, capability, team). The output is stored in `session_insights.extracted_signals`. It then updates 6 columns in `user_learning_profiles` as specified in Section 6E. The output does NOT include a list of subtopics to prioritise — subtopic sequencing is out of scope for this spec (per CEO brief). The data stored provides the raw material for future sequencing logic.

**Q7 — Content article format — what "comprehensive" means**
Resolved in Section 6A. The content article is a structured object with 6 named sections (overview, key_facts, how_it_works, enterprise_implications, common_misconceptions, decision_questions). Total target length: 600-800 words. It is structured (named sections), not free-form prose. It includes source-level facts with specific numbers where available (e.g. "200K token context window", "HIPAA BAA available for API tier"). It is the comprehensive reference from which the script and visualization are derived. It is stored in `topic_content_cache.content_outline` alongside the existing `SubSessionOutline` fields — specifically in a new `content_article` sub-field on the `SubSessionOutline` type. No separate table is created for it.

**Q8 — Cache key conflict resolution**
Resolved in Sections 6F and 4A. The unique constraint as of migration 035 is already `(topic_id, subtopic_slug, industry, role)`. The current pipeline code uses `{ onConflict: 'topic_id,subtopic_slug' }` — this is wrong and must be corrected to `{ onConflict: 'topic_id,subtopic_slug,industry,role' }` in `inngest/session-content-pipeline.ts`. Before the code change goes live, migration 038 runs to delete duplicate rows, keeping only the most recently generated row per composite key. No existing non-duplicate rows are deleted. The migration is idempotent.

**Q9 — Which roleLevel values trigger VP-calibration rules**
Resolved in Q4 answer above and Section 7 AC-12. VP-calibration rules (skip definitions, start at competitive/procurement/compliance) apply to BOTH `vp-dir` AND `c-suite`. `manager` receives a middle path: one explanatory sentence per concept, practical framing, no board-level authority framing. `specialist` is unchanged — full technical depth.

**Q10 — Session duration impact on script length**
Resolved here. The 2-minute TEACH is the canonical target for the new script generation prompt. This replaces the current canonical of 5-7 minutes (300-420 seconds). The LLM prompt in `generateScriptAndVisualization` instructs: "Write a TEACH segment of approximately 120 seconds (about 240 words in spoken language at an executive coaching pace)." The `adaptScriptToDuration` function is NOT changed in this spec — it remains available for condensation when a session is shorter than the time that 3 subtopics × 120 seconds would fill. The practical effect: for a 15-minute session with 3 subtopics, each subtopic gets ~5 minutes; the 2-minute TEACH leaves 3 minutes for CHECKPOINT + ICE_BREAKER + PROBE + CONTINUE, which is correct. For a 30-minute session with 3 subtopics, each subtopic gets ~10 minutes; the 2-minute TEACH is unchanged, and `adaptScriptToDuration` is called to expand the other segments to fill time (or additional subtopics are added by the curriculum engine). The canonical TEACH being 2 minutes means `adaptScriptToDuration` is now more likely to expand than to compress — the developer should verify the adaptation logic handles `availableSeconds > canonicalSeconds` correctly (currently it only compresses).

---

## 12. Dependencies

### What must exist before this can be built:

1. **Migration 035 must be applied in Supabase.** The unique constraint `(topic_id, subtopic_slug, industry, role)` must exist for the corrected upsert to work. Verify: `\d topic_content_cache` in psql should show the `topic_content_cache_composite_key` constraint.

2. **Migration 038 (new) must run before pipeline code changes go live.** The duplicate row cleanup must happen before the new `onConflict` clause is used, or existing duplicates will cause upsert errors. Migration 038 SQL is in Section 6F.

3. **Migration for `session_insights` table must be applied.** The new table in Section 6D is migration 039. It must run before the post-session event handler attempts to write to it.

4. **KB-01 fix must be deployed** (`inngest/session-content-pipeline.ts` upsert error check and Step H guard). This spec builds on those fixes — the upsert error throw and the row-count guard are both assumed to already be in place.

5. **The Recall.ai webhook handler or session-end handler must be able to emit `distill/session.ice-breaker.response` events.** The exact trigger point for this event depends on how the live session transcript is processed. This integration point is marked as a dependency — the developer building CONTENT-01 must coordinate with whoever owns the Recall.ai transcript pipeline. If that pipeline is not ready, the ice breaker capture (Steps 4C, 6D, 6G) should be stubbed with a TODO comment and shipped separately.

6. **`user_learning_profiles` table must have all columns from migrations 017 and 031.** The background analysis job writes to `learning_motivation`, `business_focus_lens`, `vocab_fingerprint`, `profile_confidence`, and `sessions_used_for_profile`. All of these columns were added in prior migrations.

### Build sequence within this feature:

1. Write migration 038 (cleanup) and migration 039 (`session_insights` table)
2. Apply migration 038 in Supabase (cleanup duplicates)
3. Apply migration 039 in Supabase (new table)
4. Update `lib/content/session-content-generator.ts`: add `ContentArticle` type, rename `generateSessionContentOutline` to `generateContentArticles`, update return type
5. Update `lib/content/script-generator.ts`: add `ICE_BREAKER` to `ScriptSegmentType`, add `VisualizationSpec` type (3-tuple), add `ScriptAndVisualizationOutput` type, add `generateScriptAndVisualization` function (replaces `generateTrainingScript` for new pipeline)
6. Update `inngest/session-content-pipeline.ts`: reorder steps C → D → E → F → G → H, fix `onConflict` key
7. Create `inngest/ice-breaker-analyzer.ts`: new Inngest function for post-session analysis
8. Register new Inngest function in `app/api/inngest/route.ts`
9. TypeScript check: `npx tsc --noEmit` must pass with zero errors

### Deployment order:
- Migrations 038 + 039 first (safe to deploy before code — no code depends on them yet)
- Code changes second (pipeline will immediately use the new constraint and new steps)
- No feature flag needed — the pipeline change is transparent to the user
