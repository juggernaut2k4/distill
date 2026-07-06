# Clio — Current Product Backlog
_Last updated: 2026-06-23 | Source of truth for active work_

---

## How to read this

- **P0** — Blocker. Nothing downstream works without this.
- **P1** — Core feature. Ships in the next sprint.
- **P2** — Enhancement. Queued after P1.
- **Status**: `Not started` | `In progress` | `CEO brief done` | `BA spec needed` | `Approved, build ready` | `Done`

---

## 🚦 PRE-LAUNCH GATE — do not go live with real clients until this is cleared

These are dev-only shortcuts added deliberately during the build. They must be removed or secured before real customer traffic hits production. Arun: ask Claude to audit this list before flipping the switch to a real audience.

- **Debug/test endpoints to remove entirely:**
  - `/api/admin/test-session` — lets any signed-in user instantly spin up a live coaching session against any meeting link, bypassing the real session-creation flow and the newer security/billing checks built on top of it.
  - `/api/admin/test-voice`, `/api/admin/debug-bot`, `/api/admin/test-email`, `/api/admin/seed-topics` — similar dev-only conveniences.
- **Security gaps to close:**
  - Admin bypass in `/api/auth/session` (a hidden header that skips real login).
  - `/api/walkthrough-state/[userId]` has no authentication — anyone who knows a user ID can read that user's session content.
  - A couple of admin endpoints leak internal details (API key prefixes, user ID lists) in their responses.
- **Copy cleanup:** ~30 places in user-facing text still hardcode the word "AI" instead of adapting to context.

Full detail on each item lives in this session's memory (`project_pre_production_cleanup.md`) — ask Claude to pull the complete list when this gate is reached.

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
**Status:** ✅ Done — shipped (commit `6c732a0` + follow-ons `957a0da`, `91fb948`, `563a864`). Confirmed live 2026-07-03: all of CONTENT-01-A through M verified present in code, `tsc --noEmit` clean. See "CONTENT-01: Content Pipeline Redesign" task table below — every row in that table is now Done, not "Not started" as previously listed.
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
**Status:** ✅ Verified DONE 2026-07-03 (was already built, undocumented) — 1 minor data-hygiene gap found and left as-is (see below). No code changes made this session.
**Verification method:** Direct code + live DB read against Supabase project `nqxlpcshouboplhnuvrh` — not delegated. Full re-check requested because the prior 3 backlog items (CURR-02, CONTENT-01, CURR-01) had also turned out to already be shipped.

**Per-sub-area status:**
- **SESS-01** (re-key `topic_content_cache.topic_id` → DB session UUID) — ✅ **Done in application logic.** New content is written with `topic_id = sessions.id` (confirmed in `lib/topic-cache.ts` write path and live data: most `topic_id` values are session UUIDs). ⚠️ **Data-hygiene gap, not a functional bug:** migration `supabase/migrations/040_session_cache_key.sql` added a typed `session_id uuid` FK column intended as a backfilled convenience column, but it was never actually applied against this project (`list_migrations` shows no `040` entry) — all 157 rows in `topic_content_cache` have `session_id IS NULL`. This is harmless because `app/api/kb/topics/route.ts` and the pipeline both join on `topic_id` directly, never on the unused `session_id` column. Also found 1 legacy row still keyed by an old text slug (`claude-api-messages-and-tool-use`) and ~146 rows whose `topic_id` UUID no longer matches any live `sessions.id` (orphaned from deleted/regenerated sessions) — these are inert rows, not read by any current query path, and pose no correctness risk. **Left untouched** — backfilling `session_id` or cleaning orphaned rows on live data is a separate, low-priority hygiene task, not part of SES-01's functional scope, and changes to live session data require their own spec per the "Spec Before Build" rule.
- **SESS-02** (pipeline fires on `distill/session.designer.completed`, not plan/approve) — ✅ **Done.** Confirmed in `inngest/session-content-pipeline.ts` line 94 — function triggers on `distill/session.designer.completed`.
- **SESS-03** (schedule route UPDATE-only, no delete+reinsert) — ✅ **Done.** Confirmed in `app/api/sessions/schedule/route.ts` — does `UPDATE scheduled_at` per session_index, explicitly skips completed/active sessions, no delete/insert anywhere in the route. Comment in code states this directly.
- **SESS-04** (plan screen groups sessions under Topic/Arc headers) — ✅ **Done.** `app/dashboard/plan/PlanClient.tsx` + `components/plan/ArcSection.tsx` + `components/plan/TopicTree.tsx` group sessions by `arc_name`/`arc_position`/`arc_type`. Same grouping pattern also present in `app/dashboard/sessions/SessionsClient.tsx`.
- **SESS-05** (KB shows one entry per DB session) — ✅ **Done.** `app/api/kb/topics/route.ts` explicitly documents and implements this: queries `sessions` first (ordered by `session_index`), joins `topic_content_cache` by `topic_id IN (session UUIDs)` — one KB card per DB session, not per curriculum topic.
- **TITLE-01** (Arc → Topic → Session title hierarchy) — ✅ **Done**, though shipped bundled into commit `5511169` rather than its own commit. `sessions.session_title` is read as the single source of truth in `SessionsClient.tsx`, `SessionDetailClient.tsx`, and the KB route, with `visible_sessions[].title` as fallback only — matches the "Option B: curriculum plan title is canonical, downstream stores verbatim" decision in `docs/specs/TITLE-01-session-title-consistency.md`.

**Commits:** `5511169` / `010a871` "feat(sessions): DB session UUID as content cache key, schedule fix + KB routes (SESS-01–05)" — both sub-areas and TITLE-01 landed together, undocumented as complete in this backlog until now.
**Build performed this session:** None — everything was already shipped. `npx tsc --noEmit` re-run clean.
**Follow-up (optional, not blocking):** low-priority hygiene task — either drop the unused `topic_content_cache.session_id` column or run its backfill + clean orphaned rows. Not scheduled; flag only if it starts causing confusion.

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

### CURR-01 — Curriculum Redesign / Content-First Session Architecture
**Status:** ✅ Done — shipped 2026-06-26 (commit `734c50d`, spec `docs/specs/CURR-01-requirement-document.md`). Confirmed live 2026-07-03.
**What:** Planner LLM now emits a flat `comprehensive_subtopics[]` per arc with no session boundaries or artificial cap (`ArcSchema` v2 in `lib/curriculum/planner.ts`). A new pure-code `organizeSubtopicsIntoSessions()` (`lib/curriculum/session-organizer.ts`) divides that list into sessions based on the user's preferred duration — wired live into `app/api/plan/approve/route.ts`. All 3 pre-existing bugs fixed: duration now derives from user preference not subtopic count, `DesignedSessionSchema` subtopics cap raised `max(6)→max(30)`, and `roleLevel` is injected into the session-designer framing prompt (`lib/curriculum/session-designer.ts`).
**Known tradeoff (intentional, not a gap):** `lib/curriculum/enrichment.ts` — the older CURR-01 idea's 3-layer/quality-classifier/7-dimension-coverage engine — still references the retired v1 `arc.sessions[]` shape and is fully disabled on the v2 path (`enrichedPlan` hardcoded to `null` in `planner.ts` with an explicit comment). This is dead code left in place, not a live bug; nothing calls `enrichCurriculumPlan()`. Candidate for cleanup (delete or archive `enrichment.ts`) but not a functional regression.
**Note:** The pre-2026-06-26 version of this backlog entry (3-layer narrative + 7-variant classifier + VP roleId + dimension coverage) was superseded by the content-first architecture above and never built as originally scoped — the newer approach solved the same underlying problem (silent content loss / generic framing) differently.

---

### CURR-02 — Suggested "Breadth Expansion" Topics Never Shown to Users
**Status:** ✅ Done — shipped 2026-05-31 (commit `7986a22`, FB-004), patched 2026-07-02 (commit `0900180`). Confirmed live 2026-07-03.
**What:** The curriculum planner generates extra related topics as a matter of course. These already surface via a "Recommended for you" panel on `/dashboard/plan` (`components/plan/RecommendationCard.tsx`), backed by `app/api/curriculum/plan/route.ts` (GET, computes recommendations), `app/api/curriculum/accept-recommendation/route.ts`, and `app/api/curriculum/dismiss-recommendation/route.ts` — fully interactive (Accept/Dismiss), not just read-only. Gated by `RECOMMENDATION_LIMIT` per tier (executive/pro: 2, starter: 1, free/trial: 0).
**Note:** This entry was stale — the underlying reason a specific test user saw zero recommendations was that the planner's STEP 6 breadth-expansion instruction had no minimum count (fixed 2026-07-03, see planner.ts commit `a35f672`), not a missing surfacing UI.
**File:** `lib/curriculum/planner.ts`, `app/api/curriculum/plan/route.ts`, `components/plan/RecommendationCard.tsx`

---

### CONTENT-02 — Trim Unused/Over-Requested Fields in Generated Articles
**Status:** Not started.
**What:** Generated lesson articles currently ask the AI for a field nobody reads (`source_concepts`) and over-request detail on two other fields (`common_misconceptions`, `decision_questions`) beyond what's actually used. Trimming these would shrink each article by roughly 80–120 words and reduce generation cost slightly, with no loss of visible content.
**File:** the article/content generation prompt (content pipeline)

### SCR-01 — Adaptive Script System
**Status:** ✅ Done — confirmed 2026-07-03. The approved spec (`docs/specs/SCR-01-requirement-document.md`) explicitly descopes the 7-variant system and action-item extraction (Section 10, "Out of Scope") — those live elsewhere:
- **7 response variants per checkpoint:** built in `lib/content/script-generator.ts` (CONTENT-01's `CheckpointVariants`, 7 named fields v1-v7) as part of CONTENT-01, not this spec.
- **YES/NO coverage check:** superseded by a 7-dimension coverage model under CURR-01 (`inngest/session-quality-evaluator.ts`), not a binary check — deliberate redesign, not a gap.
- **Plan-reorder engine (SCR-01's actual scope):** fully shipped — event-triggered (not a literal daily cron) via `distill/session.plan.adapt`, handled by `inngest/adapt-plan.ts` (6-step scoring/reorder/audit job), migrations 043/044 applied, acknowledge route live.
- Action-item extraction and `scheduled_at` rescheduling were explicitly deferred by the spec itself to a future item — not part of SCR-01.

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
CURR-01 ✅ (done)
SCR-01                                     ← enhancement layer, not yet built
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
| CURR-01 Content-First Session Architecture | ✅ Done | ✅ Done — `docs/specs/CURR-01-requirement-document.md` | ✅ Shipped 2026-06-26 |
| SCR-01 Adaptive Script | ✅ Done | ❌ Needed | ❌ |
| HUME-NATIVE-01 (Attendee+Hume-native-LLM voice pipeline) | ✅ Done | ✅ Done | ✅ Shipped 2026-07-05 |
| HUME-NATIVE-01 Phase C (nightly config archive + cleanup) | ✅ Done | ✅ Done | ✅ Shipped 2026-07-05 |
| CONTENT-POP-01 (live-conductor content population fix + self-heal) | ✅ Done | ✅ Done | ✅ Shipped 2026-07-05 |
| HUME-NATIVE-01 config-lifecycle consolidation (permanent read/archive function, `web_search` fix, retire debug endpoint) | ✅ Done | ✅ Done — approved, not yet built | ❌ Paused (was about to build on top of `config-provisioner.ts` while it was mid-edit for other fixes — re-verify file state before building) |
| **HUME-WEBHOOK-01** (Hume server-side "call ended + why" signal — safety net for silent client failures) | ✅ Done | ✅ Done — both narrow and broad scope drafted | ⏸️ **Deferred by Arun 2026-07-05** — low priority. Reasoning: existing safety nets (gap watchdog, session timer) already catch most disconnect scenarios; this only helps in the rare case where a user's browser dies so completely nothing else notices. Small effort but narrow real-world impact — revisit later, not urgent. |

---

_BACKLOG.md v3.2 | Updated 2026-07-05 | HUME-NATIVE-01 pipeline + Phase C + CONTENT-POP-01 shipped; config-lifecycle consolidation approved but paused; HUME-WEBHOOK-01 deferred_
