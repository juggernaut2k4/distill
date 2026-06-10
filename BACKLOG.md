# Clio — Current Product Backlog
_Last updated: 2026-06-09 | Source of truth for active work_

---

## How to read this

- **P0** — Blocker. Nothing downstream works without this.
- **P1** — Core feature. Ships in the next sprint.
- **P2** — Enhancement. Queued after P1.
- **Status**: `Not started` | `In progress` | `CEO brief done` | `BA spec needed` | `Approved, build ready` | `Done`

---

## P0 — Blockers (fix first)

### SCH-01 — Schedule Setup: Mandatory Gate
**Status:** BA spec written 2026-06-09 — see `docs/specs/SCH-01-schedule-setup-gate.md`. Ready for Arun review. If approved, build can start immediately.
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

## P1 — Core Features (next sprint)

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

## P2 — Enhancements (after P1)

### VIZ-01 — Visualization Fallback Fix
**Status:** Root cause investigated, not fixed.
**What:** Live session falls back to `generate-visual` (slow, unreliable) because `topic_content_cache` content is stored under the key `ai-fundamentals` (wrong) instead of the correct `curriculum_session_id`. 5 sessions need `generate-content` re-run after KB-01 fix is deployed.
**Fix options documented in VISUALIZATION_FALLBACK_ANALYSIS.md.**
**Dependency:** KB-01 must be deployed first.

### CURR-01 — Curriculum Redesign
**Status:** Approved 2026-06-06. BA spec needed before code.
**What:** 3-layer narrative curriculum, automated in-session quality evaluation via 7-variant classifier, VP separate roleId, `ai_maturity` value alignment, 7-dimension topic coverage check.
**Note:** Do not build until BA has written and CEO has approved the spec.

### SCR-01 — Adaptive Script System
**Status:** Architecture approved 2026-06-04. Not built.
**What:** 7 response variants pre-generated per checkpoint; YES/NO coverage check for deferral; daily cron processes transcripts → extracts action items → reorders plan → reschedules sessions.
**Dependency:** SCH-01 must be complete (rescheduler needs `scheduled_at` to be set).

---

## Build Sequence (recommended)

```
KB-01 (pipeline fix)          ← unblocks enabling-team-ai content
    ↓
ONB-01 (onboarding bugs)      ← unblocks accurate user profile
    ↓
SCH-01 (schedule setup gate)  ← unblocks all session scheduling
    ↓
KB-02 (section ordering)      ← cosmetic but approved and fast
KB-03 (KB overview slide)     ← builds on KB-02 data
    ↓
VIZ-01 (visualization fix)    ← depends on KB-01 deployed
    ↓
CURR-01, SCR-01               ← enhancement layer
```

---

## Feature Briefs & Specs Status

| Feature | CEO Brief | BA Spec | Approved to Build |
|---------|-----------|---------|-------------------|
| SCH-01 Schedule Setup Gate | ✅ Done | ❌ Needed | ❌ |
| KB-01 Content Pipeline Fix | N/A (bug fix) | N/A | ✅ |
| KB-02 Section Ordering | N/A (bug fix) | N/A | ✅ |
| KB-03 KB Overview Slide | N/A (small) | N/A | ✅ |
| ONB-01 Onboarding Bugs | N/A (bug fix) | N/A | ✅ |
| CURR-01 Curriculum Redesign | ✅ Done | ❌ Needed | ❌ |
| SCR-01 Adaptive Script | ✅ Done | ❌ Needed | ❌ |

---

_BACKLOG.md v3.0 | Updated 2026-06-09 | Supersedes May 2026 version_
