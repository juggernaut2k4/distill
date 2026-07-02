# Clio — Current Product Backlog
_Last updated: 2026-06-23 | Source of truth for active work_

---

## How to read this

- **P0** — Blocker. Nothing downstream works without this.
- **P1** — Core feature. Ships in the next sprint.
- **P2** — Enhancement. Queued after P1.
- **Status**: `Not started` | `In progress` | `CEO brief done` | `BA spec needed` | `Approved, build ready` | `Done`

---

## P0 — Blockers (fix first)

### LIVE-01 — Live Session: Visualization Shows Wrong Content (Display/Speech Desync)
**Status:** ✅ Already fixed in code — confirmed 2026-06-26. `show_visual` uses `section_index` (integer) as primary lookup; falls back to exact string match only. No fuzzy matching.
**What:** During a live session, the on-screen visualization shows content from a different generation run than what Clio is speaking. Example: screen showed "Thinking Partner / Language as Interface / Financial Services Fit" (Jun 15 data) while Clio spoke "Enterprise-grade / On-demand thinking partner / High-Stakes Text-Heavy Work" (Jun 23 script). Completely different items.
**Root cause:** `WalkthroughClient.tsx` (lines 321–332) resolves which section to display by **fuzzy-matching the topic title string** against `s.meta.subtopicTitle`. When Claude's generation rephrases a subtopic title slightly (e.g. "AI Strategy" vs "AI strategy"), the match can fail or hit a stale cached section from a prior run. Combined with stale rows in `topic_content_cache` (see LIVE-02), the displayed section is whichever stale entry the fuzzy match hits first.
**Fix:** Replace fuzzy title matching with index-based or slug-based lookup:
1. `show_visual()` tool call should pass `section_index` (int) not just `topic_title`
2. `WalkthroughClient.tsx` resolves by `sections[section_index]` directly
3. Training scripts (Step 3) must include the section index in the TEACH segment so Clio knows which index to emit
**Files:** `app/dashboard/walkthrough/WalkthroughClient.tsx` (lines 321–365), `lib/content/script-generator.ts`, ElevenLabs tool definition for `show_visual`
**Dependency:** Coordinate with LIVE-03 (NAV directives) — both touch script generation.

---

### SESS-06 — Session Plan Subtopic Wiring
**Status:** Approved, build ready — BA spec at `docs/specs/SESS-06-session-plan-subtopic-wiring.md`
**What:** Sessions created by `session-designer-auto` have empty or missing `sub_sessions`. When `generate-plan` runs on launch, it falls back to `findSubtopicsFromCatalog()` which returns 3 generic subtopics ("Core concepts", "Real-world application", "Key takeaways") with 0 visual sections. The LLM-designed subtopics exist in `curriculum_plans.visible_sessions[n].subtopics` but are not reliably wired into `sessions.sub_sessions`.
**Why it's P0:** Every session a user launches teaches generic, non-personalised content. The core Clio value proposition (role-specific, designed curriculum) is broken at the live session layer.
**Root cause:** Format and wiring investigation required before touching code — see Implementation Notes in spec (Section 12). The insert at `inngest/session-designer-auto.ts` line 124 already writes `sub_sessions: ds.subtopics`, but the column may be null for sessions where this step failed silently, or where `session-designer-auto` never ran (pre-fix sessions). Confirm actual DB state before writing code.
**Two-part fix:**
1. Verify/fix `inngest/session-designer-auto.ts` `insert-draft-sessions` step writes `sub_sessions` in the canonical `SubtopicObject[]` format.
2. Build `POST /api/admin/backfill-sub-sessions` — repairs existing sessions with empty `sub_sessions` by sourcing subtopics from `curriculum_plans.visible_sessions` (joined by `db_session_id`).
**Known affected user:** `user_3FV2YjHmbMdCS9YnyeFTelDvKUc` — 9 sessions, all showing generic subtopics. Session 1 should show 6 role-specific subtopics (listed in spec Section 7, AC-04).
**Files to change:** `inngest/session-designer-auto.ts` (verify/fix write); new file `app/api/admin/backfill-sub-sessions/route.ts`
**Do NOT change:** `app/api/sessions/[id]/generate-plan/route.ts` — reading logic is correct; only change if type investigation reveals a genuine mismatch.
**Dependencies:** `lib/curriculum/session-designer.ts` (SubtopicSchema, DesignedSession types), admin auth guard, existing `curriculum_plans` and `sessions` schema — no migration required.

---

### SCH-01 — Schedule Setup: Mandatory Gate
**Status:** ✅ BUILT + DEPLOYED 2026-06-09 (commit 0b59b08). Migration 032 still needs applying in Supabase dashboard (3 statements — safe with IF NOT EXISTS guards).
**What:** After plan approval, route the user to a Schedule Setup screen (day-picker + time dialer) before they can access sessions. On save, `scheduleSessions()` writes real `scheduled_at` to all pending sessions. Until done, a blocking banner on `/dashboard/sessions` and amber card on dashboard home nudge completion. Email nudge fires 24h after plan approval if still incomplete.
**Why it's P0:** All 8 scheduled sessions currently have `scheduled_at = null`. No dates = no reminders, no agenda emails, no structured learning cadence. The plan looks broken from the moment the user arrives.
**UI:** Reuse components from deleted `app/dashboard/schedule/ScheduleClient.tsx` (7-pill day selector, clock dialer, duration toggle). `lib/sessions/planner.ts` already works.
**Technical blockers (must be resolved in BA spec before build):**
1. 🔴 **Timezone** — `scheduleSessions()` has no timezone field. Server will store UTC, not user's local time. Fix: add IANA timezone to `SchedulePreferences`, use `date-fns-tz` to convert before storing.
2. 🔴 **Re-run creates duplicate rows** — If user changes prefs after Session 1 is `completed`, delete+reinsert creates two Session 1 rows. Fix: skip re-inserting sessions at indexes already covered by `completed`/`active` rows.
3. 🔴 **No unique constraint on `(user_id, session_index)`** — DB allows duplicates. Fix: add partial unique index excluding `completed`/`cancelled` rows.
**Warnings (design into spec):**
- 🟡 `session-content-cron` Branch B ignores `scheduled_at` entirely — curriculum sessions generate immediately regardless of date. Setting dates does NOT delay content gen.
- 🟡 Re-run fires duplicate `session.content.generate` Inngest events for new Session 1 (wasted LLM calls, possible duplicate KB entries).
- 🟡 `selectedDays: []` + unset `frequencyDays` → all sessions get same timestamp. UI must enforce ≥1 day selected.
**BA open questions (from CEO brief):** Route URL, gate enforcement mechanism, `scheduling_prefs` JSONB schema, `scheduleSessions()` call location (sync API vs Inngest), banner vs hard redirect, email nudge idempotency, settings page integration, duration options (15/30 only?).
**Dependencies:** `lib/sessions/planner.ts` ✅, `scheduling_prefs` column ✅, `app/api/sessions/schedule/route.ts` ✅ (exists, handles DB write).

---

### KB-01 — KB Content Pipeline Fix (enabling-team-ai-s1/s2)
**Status:** ✅ Done — deployed 2026-06-09.
**What:** `enabling-team-ai-s1` and `enabling-team-ai-s2` are stuck in a silent infinite loop — content never appears despite hourly cron firing.
**Root causes:**
1. Upsert to `topic_content_cache` in `inngest/session-content-pipeline.ts` (lines 213–233) never checks the Supabase error — silent failure, 0 rows written.
2. Step 6 (lines 238–243) marks `content_status = 'ready'` unconditionally regardless of rows written.
3. These combine: pipeline fires → upserts fail silently → Step 6 marks ready → stale-ready recovery resets to pending → repeat every hour.
4. `enabling-team-ai-s2` also has generic subtopics ("Core concepts", "Key takeaways") — session-designer never ran for it.
**Fix:**
- Add error check to upsert — throw if Supabase returns error so Inngest retries/alerts
- Guard Step 6 — only mark ready if `subtopicsProcessed > 0`
- After loop, verify actual rows in cache before marking ready
- Run session-designer for `enabling-team-ai-s2` before triggering its pipeline
**File:** `inngest/session-content-pipeline.ts`
**Do NOT trigger enabling-team-ai-s1 or s2 manually until fix is deployed.**

---

### VOICE-01 — Hume Keep-Alive Sends Disconnect-Causing Field
**Status:** Not started — root cause identified, fix not yet built.
**What:** During a live session, `WalkthroughClient.tsx` sends a "keep the connection alive" message every 8 seconds regardless of which voice engine (ElevenLabs or Hume) is active. For Hume specifically, this message includes a field Hume doesn't allow, which causes Hume to immediately close the connection — the session drops.
**Why it matters now:** We are actively testing Hume as the new voice engine (see [[project_voice_provider_toggle]]) — this bug directly breaks that testing.
**Fix direction:** Add a check before sending the keep-alive message — only include the problematic field when ElevenLabs is the active engine, skip it entirely for Hume.
**File:** `app/dashboard/walkthrough/WalkthroughClient.tsx` (the periodic keep-alive/injectContext block)

---

## P1 — Core Features (next sprint)

### PIPE-01 — Two Content-Generation Pipelines Running in Parallel
**Status:** Not started — needs a decision on which pipeline to keep.
**What:** There are two separate background jobs that both generate session content, registered at the same time. The older one still runs every hour against all scheduled sessions, which doesn't match the intended design (content should generate right when a user approves their plan, not on a recurring sweep). Having both running risks duplicate work and conflicting content.
**Decision needed:** Keep the "generate on approval" pipeline as the only one, and retire the old hourly one — or confirm there's still a reason to keep both.
**File:** both pipelines are registered in `app/api/inngest/route.ts`

---

### CONTENT-01 — Content Pipeline Redesign (Content → Script+Viz Atomic)
**Status:** CEO brief done (`docs/specs/CONTENT-01-feature-brief.md`). BA spec in progress — will be at `docs/specs/CONTENT-01-requirement-document.md`. Awaiting Arun approval to build.
**What:** Three interconnected changes to produce elite, aligned session content:
1. **New generation order:** Content article (comprehensive, no word limit) → Script (2-min TEACH + ICE_BREAKER, calibrated to VP/C-suite) + Visualization (generated in the same LLM call as script — atomic, structurally impossible to desync)
2. **VP-level calibration:** Explicit rules in system prompt — skip definitional content, start at competitive landscape and procurement implications. Skip "enterprise grade, not a toy." Begin at: "You're probably evaluating Claude alongside GPT-4 or Gemini…"
3. **User psychology capture:** ICE_BREAKER segment is a genuine open conversational question (not a quiz). User's response is stored and analyzed post-session to update learning profile — influences which subtopics get prioritized in future sessions.
**Why P1:** The current script is a 7-min monologue that starts too basic and never lets the user speak. No connection. No adaptation. Sessions feel like a lecture, not a conversation.
**Quality bar set by Arun in conversation 2026-06-23 (approved sample):**
- TEACH: 2 min, 3 tight differentiators — no setup, VP already knows what an LLM is
- CHECKPOINT: "Which of those three will your risk/compliance team push back on first?"
- ICE BREAKER: "What's the specific context driving this evaluation for you right now?"
- VISUALIZATION: exactly 3 items matching exactly what the 2-min TEACH covered
**CEO brief:** `docs/specs/CONTENT-01-feature-brief.md`
**BA spec:** `docs/specs/CONTENT-01-requirement-document.md` (in progress)
**Files to change:** `lib/content/session-content-generator.ts` (Step 1 — expand to full article), `lib/content/script-generator.ts` (Step 3 — restructure segments, atomic viz), `inngest/session-content-pipeline.ts` (pipeline order)
**Dependencies:** LIVE-01 and LIVE-02 must be fixed first (stale cache causes any new content to still display wrongly).

---

### LIVE-02 — Pipeline Upsert Uses Wrong Conflict Key
**Status:** ✅ Already fixed in code — confirmed 2026-06-26. `session-content-pipeline.ts` uses `{ onConflict: 'topic_id,subtopic_slug,industry,role' }` matching the actual DB unique index.
**What:** `inngest/session-content-pipeline.ts` (line ~232) calls `.upsert(..., { onConflict: 'topic_id,subtopic_slug' })` but the database unique constraint is on `(topic_id, subtopic_slug, industry, role)`. The mismatch means:
- When pipeline runs for a user-specific context (industry='financial-services', role='vp'), a new row is inserted instead of updating the existing one
- Old rows from prior runs persist and are never cleaned up
- Multiple rows exist for the same (topic_id, subtopic_slug) pair — one per generation run
- The live session can pick up ANY of these stale rows
**Fix:** Change conflict key to match the actual DB constraint:
```typescript
{ onConflict: 'topic_id,subtopic_slug,industry,role' }
```
Also clean up existing duplicate rows — delete older rows keeping only the latest per `(topic_id, subtopic_slug, industry, role)`.
**File:** `inngest/session-content-pipeline.ts` line ~232
**Migration needed:** Add cleanup script to remove orphaned duplicate rows.

---

### LIVE-03 — Training Scripts Missing Tab Navigation Directives
**Status:** ✅ Already fixed in code — confirmed 2026-06-26. `script-generator.ts` embeds `[NAV:tab_0/1/2]` inline in TEACH segments. `WalkthroughClient.tsx` parses and fires tab navigation via `parseNavCommand()`.
**What:** The script generator (`lib/content/script-generator.ts`) produces TEACH/CHECKPOINT/PROBE/CONTINUE segments that mention visual items by name but include **no `[NAV:...]` directives**. The tab-switching system in `WalkthroughClient.tsx` (lines 110–145) parses `[NAV:tab_id]` markers from Clio's speech — but these are never emitted. Tab switching doesn't happen automatically during sessions.
**Fix:** Enhance `generateTrainingScript()` to emit `[NAV:tab_id]` at the moment Clio begins discussing each visual item:
```
"Now look at Risk Mitigation [NAV:risk-mitigation] — this is where regulated firms..."
```
The `tab_id` values come from `tab_manifests[section_index].tabs[].tab_id` — these must be passed into the script generator alongside `visual_spec`.
**Files:** `lib/content/script-generator.ts`, `lib/templates/generator.ts` (tab manifest generation), `inngest/session-content-pipeline.ts` (pass tab manifest to Step 3)
**Dependency:** Coordinate with CONTENT-01 (Step 3 restructure) — do this change inside the CONTENT-01 build, not separately.

---

### LIVE-04 — Pipeline Saves Content with Hardcoded industry='' and role=''
**Status:** ✅ Already fixed in code — confirmed 2026-06-26. Pipeline fetches user profile from DB and passes `userContext.industry` and `userContext.role` to the upsert (lines 302–303).
**What:** `inngest/session-content-pipeline.ts` (lines ~215–231) inserts to `topic_content_cache` with `industry: ''` and `role: ''` hardcoded, even though the pipeline receives the actual user context. This means:
- All generated content lands in the generic cache slot (industry='', role='')
- `getCachedSection()` (in `lib/topic-cache.ts`) searches by `(topic_id, subtopic_slug, industry, role)` — with a fallback to the generic row
- So everyone gets the same generic content regardless of their industry or role
- The personalization system is silently bypassed
**Fix:**
```typescript
industry: userContext.industry ?? '',
role: userContext.role ?? '',
```
Pass the actual values. Ensure the conflict key fix (LIVE-02) is applied first so the upsert correctly updates the user-specific row.
**File:** `inngest/session-content-pipeline.ts` lines ~215–231

---

### KB-02 — KB Section Ordering
**Status:** ✅ Done — deployed 2026-06-09.
**What:** KB topic detail page sorts sections by `generated_at DESC` — random order, not the teaching narrative. Should sort by session_index + subtopic position within each session.
**Fix:** `app/api/kb/topics/[topicId]/route.ts` — fetch sessions ordered by `session_index ASC`, read `sessions.subtopics` JSONB (ordered array), match KB sections to that order. No migration needed.
**Correct order example (claude-for-work-s1):**
1. Constitutional AI and Enterprise-Grade Safety (S1, opener)
2. Why Financial Services Firms Are Choosing Claude (S1)
3. Choosing Your Deployment Model (S1)
4. Framing Claude's Value to the C-Suite (S1, closer)
5. The Quick Win Zone (S2, opener) … etc.

---

### KB-03 — KB Overview Slide
**Status:** ✅ Done — deployed 2026-06-09.
**What:** Pinned card at top of each KB topic page showing: arc title, arc focus description (from `curriculum_plans.visible_sessions[].focus`), session list with status (Completed / Next Up / Upcoming), progress summary ("X of Y sessions completed").
**Design (approved):**
```
┌─────────────────────────────────────────────────────┐
│  Claude in Financial Services                       │
│  Safety Architecture, Deployment Models & C-Suite  │
│                                                     │
│  Establish what Claude is, how it differs...        │
│                                                     │
│  What you'll cover                                  │
│  ✅ Session 1 — Claude in Financial Services: Safety│
│     4 subtopics · Completed                         │
│  → Session 2 — From First Use to Strategic Advantage│
│     5 subtopics · Next up                           │
│                                                     │
│  9 subtopics · 2 sessions · 1 of 2 completed       │
└─────────────────────────────────────────────────────┘
```
**Interaction:** Display only — no navigation on session click.
**Data sources:** Focus from `curriculum_plans.visible_sessions[].focus`, sessions from `sessions` table by `curriculum_session_id`, status from `sessions.status`.
**Files:** `app/api/kb/topics/[topicId]/route.ts` (add arc metadata to response) + KB topic page UI.

---

### ONB-01 — Onboarding Bug Fixes (4 critical)
**Status:** ✅ Partial done 2026-06-09 — domainProficiency wired (ProficiencyStep now runs as step 5, total steps = 7). worry and deliveryPreference remain hardcoded — no BA spec, safe defaults. No profile edit page — still pending.
**What:** 8 bugs found in onboarding; 4 are critical:
1. `industry`, `worry`, and `roleLevel` values are captured in UI but never saved to the `users` table
2. Onboarding API is called fire-and-forget — data loss if the call fails
3. No profile edit page — once onboarding is complete, user cannot update their profile
4. `ai_maturity` field mapping inconsistency between onboarding UI values and DB enum
**Why P1:** Scheduling prefs (SCH-01) and content personalisation both depend on an accurate user profile. Building scheduling on top of broken onboarding data is a dead end.
**Note:** These must be fixed before SCH-01 is built (scheduling preferences require accurate user profile data).

---

## P1 — Core Features (continued)

### SES-01 — Session Architecture Redesign: DB Session as Unit of Truth
**Status:** 🟡 Design complete — CEO Feature Brief + BA Requirement Document done. Pending Arun review + Q10 answer. DO NOT BUILD until approved.
**What:** 6 interdependent changes that make the DB session (not curriculum session) the canonical record everywhere:
- **SESS-01**: Re-key `topic_content_cache.topic_id` from curriculum_session_id → DB session UUID
- **SESS-02**: Content pipeline fires on `distill/session.designer.completed` event (not at plan/approve)
- **SESS-03**: Schedule route does UPDATE only — no more delete + re-insert of sessions
- **SESS-04**: Plan screen shows 10 DB sessions grouped under Topic/Arc headers (not 5 curriculum cards)
- **SESS-05**: KB shows 10 entries, one per DB session, scoped to that session's subtopics
- **TITLE-01**: Three-level title hierarchy (Arc → Topic → Session) enforced across all UI
**Why P1:** Every new user who approves a plan hits all 4 failure modes — content collisions, wrong KB entries, content generated before subtopics assigned, metadata destroyed by schedule route.
**Specs:** `docs/specs/SES-01-session-architecture-redesign.md` (design) + `docs/specs/SES-01-feature-brief.md` (CEO brief) + `docs/specs/SES-01-requirement-document.md` (BA spec, 12/12 sections done)
**Open questions:** None — Q10 resolved 2026-06-10. Migration SQL is finalized in section 6F of the requirement doc. Ready to build once Arun approves the spec.
**Deployment sequence:** SESS-03 → SESS-02 → SESS-01 (migration) → SESS-04+SESS-05+TITLE-01 together.

---

## P2 — Enhancements (after P1)

### LIVE-05 — walkthrough_state Sections Can Drift After Content Regeneration
**Status:** ✅ Done — deployed 2026-06-26. Migration 047 applied.
**What:** `walkthrough_state.sections` is populated at session launch from `topic_content_cache`. If content is regenerated (e.g. via "Generate Content" button in KB) AFTER the user has already launched their walkthrough, the in-memory sections array becomes stale. Clio's LLM context may reference the new content while the UI still displays the old sections.
**Fix:** Add `last_regenerated_at` timestamp to `topic_content_cache` metadata. Before rendering the live session visualization, check if any cache rows have been regenerated more recently than `walkthrough_state.last_updated_at`. If so, refresh sections from DB.
**File:** `app/api/walkthrough-state/[userId]/route.ts`, `inngest/session-content-pipeline.ts` (stamp `last_regenerated_at`)
**Priority note:** This is P2 because it only affects users who trigger a regeneration mid-session — rare case. LIVE-01 and LIVE-02 are the primary causes of current desync.

---

### VIZ-01 — Visualization Fallback Fix
**Status:** Root cause investigated, not fixed.
**What:** Live session falls back to `generate-visual` (slow, unreliable) because `topic_content_cache` content is stored under the key `ai-fundamentals` (wrong) instead of the correct `curriculum_session_id`. 5 sessions need `generate-content` re-run after KB-01 fix is deployed.
**Fix options documented in VISUALIZATION_FALLBACK_ANALYSIS.md.**
**Dependency:** KB-01 must be deployed first.

### CURR-01 — Curriculum Redesign
**Status:** Approved 2026-06-06. BA spec needed before code.
**What:** 3-layer narrative curriculum, automated in-session quality evaluation via 7-variant classifier, VP separate roleId, `ai_maturity` value alignment, 7-dimension topic coverage check.
**Note:** Do not build until BA has written and CEO has approved the spec.

---

### CURR-02 — Suggested "Breadth Expansion" Topics Never Shown to Users
**Status:** Not started — needs investigation.
**What:** The curriculum planner generates extra related topics (things adjacent to or building on what a user is learning) as a matter of course, but they're always marked hidden and never actually surface anywhere in the product. Likely just unfinished wiring rather than a bug, but not yet confirmed.
**File:** `lib/curriculum/planner.ts` (the step that generates these extra topics)

---

### CONTENT-02 — Trim Unused/Over-Requested Fields in Generated Articles
**Status:** Not started.
**What:** Generated lesson articles currently ask the AI for a field nobody reads (`source_concepts`) and over-request detail on two other fields (`common_misconceptions`, `decision_questions`) beyond what's actually used. Trimming these would shrink each article by roughly 80–120 words and reduce generation cost slightly, with no loss of visible content.
**File:** the article/content generation prompt (content pipeline)

### SCR-01 — Adaptive Script System
**Status:** Architecture approved 2026-06-04. Not built.
**What:** 7 response variants pre-generated per checkpoint; YES/NO coverage check for deferral; daily cron processes transcripts → extracts action items → reorders plan → reschedules sessions.
**Dependency:** SCH-01 must be complete (rescheduler needs `scheduled_at` to be set).

---

## CONTENT-01: Content Pipeline Redesign + User Psychology Capture

_P0 — Session experience is broken for real users today. BA spec at `docs/specs/CONTENT-01-requirement-document.md`. Awaiting CEO approval before build._

| ID | Task | Priority | Complexity | Status |
|----|------|----------|------------|--------|
| CONTENT-01-A | Migration 038: Delete duplicate `topic_content_cache` rows, keeping most recent per `(topic_id, subtopic_slug, industry, role)` | P0 | S | Not started |
| CONTENT-01-B | Migration 039: Create `session_insights` table with indexes and RLS | P0 | S | Not started |
| CONTENT-01-C | Apply migrations 038 + 039 in Supabase dashboard (must run before code ships) | P0 | S | Not started |
| CONTENT-01-D | `lib/content/session-content-generator.ts`: Add `ContentArticle` type (6-section structured object); rename main export to `generateContentArticles`; update return shape to produce articles instead of coaching_narrative outlines | P0 | M | Not started |
| CONTENT-01-E | `lib/content/script-generator.ts`: Add `ICE_BREAKER` to `ScriptSegmentType`; add `VisualizationSpec` 3-tuple type; add `ScriptAndVisualizationOutput` type; add `generateScriptAndVisualization` function — one atomic LLM call that produces both script segments and exactly 3 visualization items | P0 | L | Not started |
| CONTENT-01-F | `inngest/session-content-pipeline.ts`: Reorder steps to Content → Script+Viz → Template Select → Template Data → Save → Mark Ready; replace `generateTrainingScript` call with `generateScriptAndVisualization`; pass `contentSpec` from script step into `generateTemplateData`; fix `onConflict` to `topic_id,subtopic_slug,industry,role` | P0 | M | Not started |
| CONTENT-01-G | VP/C-Suite negative + positive calibration rules: hardcode into `generateScriptAndVisualization` prompt — explicit DO NOT phrases (definitions, "enterprise-grade", "AI is not a toy") and explicit DO start phrases (competitive positioning, procurement, compliance framing) | P0 | M | Not started |
| CONTENT-01-H | ICE_BREAKER prompt rules: open situational question format, no comprehension-check phrasing, appears after CHECKPOINT on every subtopic; embed in `generateScriptAndVisualization` system prompt | P0 | S | Not started |
| CONTENT-01-I | Runtime guard: if `visualization_spec.items` count is not exactly 3, correct (truncate or pad) and log warning — prevents downstream template failures | P0 | S | Not started |
| CONTENT-01-J | `inngest/ice-breaker-analyzer.ts`: New Inngest function triggered by `distill/session.ice-breaker.response`; writes raw transcript to `session_insights`; calls Claude with structured extraction prompt; upserts `user_learning_profiles` with derived signals | P1 | M | Not started |
| CONTENT-01-K | Register `analyzeIceBreakerResponse` in `app/api/inngest/route.ts` | P1 | S | Not started |
| CONTENT-01-L | Recall.ai / session-end handler: emit `distill/session.ice-breaker.response` event with `{ sessionId, userId, subtopicSlug, rawTranscript }` at session end (coordinate with Recall.ai transcript pipeline owner) | P1 | M | Not started |
| CONTENT-01-M | TypeScript check: `npx tsc --noEmit` passes with zero errors after all changes | P0 | S | Not started |

**Dependencies for CONTENT-01:**
- Migration 035 must already be applied in production (`topic_content_cache_composite_key` unique constraint on `topic_id, subtopic_slug, industry, role`)
- KB-01 fix must be deployed (upsert error-throw + Step H row-count guard already in `inngest/session-content-pipeline.ts`)
- LIVE-02 (upsert conflict key fix) should land in the same PR as CONTENT-01-F, or before it
- For CONTENT-01-L: Recall.ai transcript pipeline must be able to identify and extract the ice breaker response segment from the full session transcript

**Internal build sequence:**
Migrations first (CONTENT-01-A → B → C, safe before code), then CONTENT-01-D + CONTENT-01-E in parallel, then CONTENT-01-F + G + H + I together (one PR), then CONTENT-01-J + K + L independently.

---

## Build Sequence (recommended)

> **Content Library:** Before any content generation job runs, check `docs/content/[topic-id].md`. If the file exists and is approved (listed in `docs/content/INDEX.md` with status APPROVED), load it as context. Never regenerate approved content from scratch. See `docs/content/CONTENT-METHODOLOGY.md` for the full generation methodology.

```
LIVE-02 (upsert conflict key fix)         ← 1-line fix, unblocks all cache correctness
LIVE-04 (pass industry/role to cache)     ← can do same PR as LIVE-02
    ↓
LIVE-01 (section display — index not fuzzy match) ← fixes the visible desync symptom
    ↓
SESS-06 (subtopic wiring)                 ← required for correct subtopic slugs to exist
    ↓
CONTENT-01 (pipeline redesign)            ← new Content→Script+Viz atomic order, ICE_BREAKER
  └─ LIVE-03 (NAV directives in script)   ← build inside CONTENT-01, same PR
    ↓
ONB-01 (onboarding bugs)                  ← unblocks accurate user profile
    ↓
SCH-01 (schedule setup gate)              ← unblocks all session scheduling
    ↓
KB-02 (section ordering) ✅
KB-03 (KB overview slide) ✅
    ↓
LIVE-05 (walkthrough_state drift)         ← P2, do after P1 complete
VIZ-01 (visualization fallback fix)       ← P2, depends on LIVE-02 deployed
    ↓
CURR-01, SCR-01                           ← enhancement layer
```

---

## Feature Briefs & Specs Status

| Feature | CEO Brief | BA Spec | Approved to Build |
|---------|-----------|---------|-------------------|
| LIVE-01 Section display desync (P0) | N/A (bug) | N/A | ❌ Awaiting Arun |
| LIVE-02 Upsert conflict key (P1) | N/A (bug) | N/A | ❌ Awaiting Arun |
| LIVE-03 NAV directives in script (P1) | N/A (bug) | N/A | ❌ Build inside CONTENT-01 |
| LIVE-04 Pipeline hardcoded context (P1) | N/A (bug) | N/A | ❌ Awaiting Arun |
| LIVE-05 walkthrough_state drift (P2) | N/A (bug) | N/A | ❌ Awaiting Arun |
| CONTENT-01 Pipeline Redesign (P0) | ✅ Done | ✅ Done — `docs/specs/CONTENT-01-requirement-document.md` | ❌ Awaiting CEO approval |
| SCH-01 Schedule Setup Gate | ✅ Done | ❌ Needed | ❌ |
| KB-01 Content Pipeline Fix | N/A (bug fix) | N/A | ✅ Done |
| KB-02 Section Ordering | N/A (bug fix) | N/A | ✅ Done |
| KB-03 KB Overview Slide | N/A (small) | N/A | ✅ Done |
| ONB-01 Onboarding Bugs | N/A (bug fix) | N/A | ✅ Partial |
| CURR-01 Curriculum Redesign | ✅ Done | ❌ Needed | ❌ |
| SCR-01 Adaptive Script | ✅ Done | ❌ Needed | ❌ |

---

_BACKLOG.md v3.1 | Updated 2026-06-23 | CONTENT-01 BA spec added_
