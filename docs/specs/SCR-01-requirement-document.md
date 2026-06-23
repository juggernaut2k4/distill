# Adaptive Script System — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-23

---

## 1. Purpose

Clio currently treats every user the same after onboarding. A VP of Financial Services who says "my biggest concern is regulatory compliance" during Session 1 receives Session 2 content in the same order it was generated, regardless of what they said. The learning path does not adapt. Clio listens but does not remember.

This feature closes the loop. After each live session, the signals captured in `session_insights` (by CONTENT-01's ice breaker analyzer) are read, interpreted, and used to reorder the remaining sessions in the user's plan so the most relevant content comes first. If the user reveals urgency around compliance, compliance-tagged sessions advance in the queue. If they reveal a competitive evaluation context, vendor comparison sessions advance. The plan reflects what the user actually told Clio, not just what they answered at onboarding.

Without this feature, the ice breaker data captured by CONTENT-01 is stored but never acted on. Users get a more conversational session experience but the learning path stays static — which makes the ice breaker feel like a survey with no consequence. This feature makes the consequence visible: your plan changes because Clio heard you.

---

## 2. User Story

**Story 1 — Executive with an urgent specific concern:**
As a VP of Technology who told Clio "we're in a vendor evaluation that wraps up in 6 weeks and my compliance team is the main blocker,"
I want my remaining sessions to front-load vendor evaluation and compliance content,
So that I learn what I most urgently need before my evaluation deadline, not in the original arbitrary order.

**Story 2 — Executive with a different driver than their onboarding answers:**
As a CEO who answered "competitive landscape" at onboarding but then told Clio in Session 1 "actually I need to get my team moving on AI — they're waiting for me to set direction,"
I want Clio to update my plan to prioritise team enablement and AI strategy sessions over competitive analysis,
So that my plan reflects my actual situation rather than my original guess at onboarding.

**Story 3 — Executive reviewing their plan:**
As any Clio user,
I want to see a notification on my sessions page that my plan was updated after a session,
So that I understand why the order has changed and trust that Clio is actively working for me.

---

## 3. Trigger / Entry Point

**What triggers adaptation:**
The `analyzeIceBreakerResponse` Inngest function (from CONTENT-01, file `inngest/ice-breaker-analyzer.ts`) writes `analysis_status = 'complete'` to a `session_insights` row and upserts `user_learning_profiles`. At that point, a new event is emitted to trigger the plan adaptation job.

**Trigger event name:** `distill/session.plan.adapt`

**Event data:**
```typescript
{
  userId: string,
  sessionId: string,        // the just-completed session
  insightId: string,        // the session_insights row that triggered this
  primaryDriver: string,    // extracted_signals.primary_driver from the insight
  urgency: 'low' | 'medium' | 'high'  // extracted_signals.urgency
}
```

**Who emits the event:** The final step of `analyzeIceBreakerResponse` (Step 4, `upsert-learning-profile`) emits this event after successfully upserting the learning profile. Emission is conditional: only if `urgency` is `'medium'` or `'high'`, OR if `primary_driver` differs from the driver recorded in the most recent prior adaptation (see Section 7 AC-02 for the no-change guard).

**What state the user must be in:**
- Authenticated (Clerk user ID exists)
- Has an active `curriculum_plans` row with `status = 'active'`
- Has at least 2 remaining sessions with `status = 'pending'` (if only 1 session remains, there is nothing to reorder — no adaptation runs)

**Route / URL:** No user-visible entry point. The adaptation is a background Inngest job. The result is visible on the existing `/dashboard/sessions` page, which displays sessions in `session_index` order.

---

## 4. Screen / Flow Description

### 4A. Background Adaptation Job (No User Interaction)

The job runs entirely in the background. The user is in the middle of their learning journey — they have just completed a session, and the Recall.ai transcript has been processed. The user does not need to be online.

**Step 1 — Load signals and remaining sessions**

Read:
- `session_insights` row for `insightId`: `extracted_signals`, `session_id`
- All sessions for `userId` with `status = 'pending'`, ordered by `session_index ASC`
- `users` table: `role`, `industry`
- `user_learning_profiles`: `learning_motivation`, `business_focus_lens`, `profile_confidence`
- `curriculum_plans` for this user: `visible_sessions` JSONB (to read arc membership and queue_rationale for each session)

If `profile_confidence = 'low'` (fewer than 3 sessions with ice breaker responses), the job exits without making any changes. No reorder below the confidence threshold.

**Step 2 — Score remaining sessions against signals**

For each pending session, compute a signal alignment score (integer, 0–100). See Section 6C for the exact scoring algorithm.

Sessions already completed (`status = 'completed'` or `status = 'active'`) are never touched. Session 1 is already complete by definition when this job runs (the ice breaker fires post-session). Completed sessions keep their `session_index` permanently.

**Step 3 — Check if reordering is meaningful**

Compare the new score-ordered sequence to the current `session_index` sequence. If the top 3 pending sessions are already in the correct order (i.e., the score-sorted order matches the current index order for the first 3 pending sessions), no reorder is performed. The job exits cleanly, logs `[adapt-plan] no reorder needed — plan already optimal`, and does NOT emit any user-visible notification.

This is the no-op guard. It prevents churning the plan when the signals confirm what was already planned.

**Step 4 — Reassign session_index for pending sessions**

For all sessions with `status = 'pending'`, reassign `session_index` values in score-descending order (highest aligned score = lowest index number = appears first). The index values used are the integers immediately following the last completed session's index.

Example: if Session 1 is completed with `session_index = 1`, and there are 4 pending sessions currently at indexes 2, 3, 4, 5 — after reordering they still occupy indexes 2, 3, 4, 5 but in the new score-determined sequence.

The update is a bulk UPDATE on the `sessions` table — one row per pending session, setting the new `session_index`. All writes happen inside a single Inngest `step.run` so they are atomic within Inngest's retry semantics. If any individual update fails, Inngest retries the whole step.

**Step 5 — Write adaptation record**

Insert one row into `plan_adaptations` (new table, see Section 6D). This records what changed, why, and when. It is the source of truth for the notification shown to the user.

**Step 6 — Mark sessions page for notification**

Upsert the `users` table column `plan_adapted_at` (new column, `timestamptz`) with `NOW()`. The sessions page reads this column on load. If `plan_adapted_at` is set and newer than the user's last-acknowledged adaptation, the notification banner is shown.

### 4B. User-Visible Notification (Sessions Page)

The user navigates to `/dashboard/sessions` (existing route). If `plan_adapted_at` is set and newer than `plan_adaptation_acknowledged_at` (new column on `users`), a notification banner appears at the top of the sessions list, above the first session card.

**Banner appearance:**
A full-width banner, `bg-surface` (#111111) background, `border-subtle` (#222222) border, 1px, rounded-lg. Left side: a `Sparkles` Lucide icon in `accent-purple` (#7C3AED). Right side: a close button (X icon, muted).

**Banner text — headline (one line, white, font-semibold):**
"Clio updated your learning path"

**Banner text — body (text-secondary, #94A3B8, font-normal):**
"Based on what you shared in your last session, [N] sessions have been reordered to match what matters most to you right now."

Where [N] is `plan_adaptations.sessions_reordered` from the most recent adaptation row for this user.

**Banner action:**
No "undo" button. No "view changes" link in V1. Just the close (X) button in the top-right corner.

**Dismissing the banner:**
When the user clicks X: call `POST /api/sessions/acknowledge-adaptation` (new route, see Section 6E). This sets `users.plan_adaptation_acknowledged_at = NOW()`. The banner does not reappear on subsequent page loads unless a new adaptation runs.

**Sessions list below the banner:**
The sessions appear in their new `session_index` order. No other visual treatment — the sessions look exactly as they always do. There is no "moved" label or reorder indicator on individual session cards. The order simply reflects what is most relevant now.

---

## 5. Visual Examples

### 5A. Background Job Flow (Developer Reference)

```
INNGEST: adapt-plan
────────────────────────────────────────────────────────────
Event: distill/session.plan.adapt
  data: { userId, sessionId, insightId, primaryDriver, urgency }

Step 1 │ load-signals-and-sessions
       │   → reads session_insights (insightId)
       │   → reads sessions WHERE user_id=userId AND status='pending' ORDER BY session_index
       │   → reads users, user_learning_profiles, curriculum_plans
       │   → EXIT if profile_confidence = 'low'
       │   → EXIT if pending sessions < 2
       │
Step 2 │ score-sessions
       │   → for each pending session: compute alignment score (0–100)
       │   → input: extracted_signals, session.topic_id, session.session_title
       │   →        visible_sessions JSONB (arc membership, queue_rationale)
       │   → output: [{ sessionId, currentIndex, newScore }, ...]
       │
Step 3 │ check-reorder-needed
       │   → sort sessions by newScore DESC
       │   → compare first 3 to current index order
       │   → EXIT (no-op) if top 3 are already in correct order
       │
Step 4 │ reassign-session-indexes
       │   → bulk UPDATE sessions SET session_index = <new_value>
       │   → only pending sessions are touched
       │   → completed/active sessions are never updated
       │
Step 5 │ write-adaptation-record
       │   → INSERT INTO plan_adaptations (userId, sessionId, insightId,
       │                                   sessionsReordered, primaryDriver,
       │                                   signalSummary, previousOrder, newOrder)
       │
Step 6 │ mark-notification
       │   → UPDATE users SET plan_adapted_at = NOW()
       │
[Done] → user sees updated session order on next /dashboard/sessions load
────────────────────────────────────────────────────────────
```

### 5B. Sessions Page — With Notification Banner

```
┌─────────────────────────────────────────────────────────────────┐
│  /dashboard/sessions                                            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ✦ Clio updated your learning path               [X]   │    │
│  │    Based on what you shared in your last session,       │    │
│  │    3 sessions have been reordered to match what         │    │
│  │    matters most to you right now.                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Session 1                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ✅  Claude in Financial Services: Safety Architecture  │    │
│  │      Completed · 4 subtopics                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Session 2  (was Session 4)                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  →   AI Governance and Regulatory Compliance            │    │
│  │      Up next · 5 subtopics · Scheduled Thu 9am          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Session 3  (was Session 2)                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ○   From First Use to Strategic Advantage              │    │
│  │      Upcoming · 6 subtopics                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

Note: The "(was Session N)" label shown in the wireframe is for BA illustration only. It is NOT rendered in the actual UI — individual session cards do not display prior position.

### 5C. Sessions Page — No Banner (Already Dismissed or No Adaptation Yet)

```
┌─────────────────────────────────────────────────────────────────┐
│  /dashboard/sessions                                            │
│                                                                 │
│  Session 1                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ✅  Claude in Financial Services: Safety Architecture  │    │
│  │      Completed · 4 subtopics                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Session 2                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  →   AI Governance and Regulatory Compliance            │    │
│  │      Up next · 5 subtopics                              │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

### 6A. Reads

**From `session_insights`:**
- `extracted_signals.primary_driver` — dominant motivation
- `extracted_signals.urgency` — how time-pressured
- `extracted_signals.learning_intent` — what the user wants to achieve (used in signal summary stored in `plan_adaptations`)
- `extracted_signals.organizational_context` — team/company situation

**From `sessions` (for this user):**
- All rows: `id`, `session_title`, `topic_id`, `session_index`, `status`, `scheduled_at`
- Filter: `user_id = userId`
- Used to separate completed sessions (locked) from pending sessions (eligible for reorder)

**From `curriculum_plans`:**
- `visible_sessions` JSONB array — each element has `session_id` (curriculum session ID), `arc_name`, `arc_type`, `role_hint`
- Used to look up arc membership and derive topic tags for each DB session via `curriculum_session_id`

**From `users`:**
- `plan_adapted_at` — read by sessions page to decide whether to show banner
- `plan_adaptation_acknowledged_at` — read by sessions page; banner shown only if `plan_adapted_at > plan_adaptation_acknowledged_at`

**From `user_learning_profiles`:**
- `profile_confidence` — must be `'medium'` or `'high'` to allow reordering
- `learning_motivation` — used as a supplementary reordering signal
- `business_focus_lens` — used as a supplementary reordering signal

### 6B. Writes

**`sessions` table (bulk UPDATE):**
- Column updated: `session_index` (integer)
- Rows affected: all rows for this user with `status = 'pending'`
- Rows never touched: `status = 'completed'`, `status = 'active'`, `status = 'cancelled'`
- Trigger: Step 4 of `adaptPlan` Inngest function

**`plan_adaptations` table (INSERT — new table, see 6D):**
- One row per adaptation run that results in a reorder
- Not inserted when the no-op guard fires (Step 3 exits early)

**`users` table (UPDATE — two columns, new):**
- `plan_adapted_at timestamptz` — set to NOW() in Step 6 when a reorder happens
- `plan_adaptation_acknowledged_at timestamptz` — set to NOW() when user clicks X on banner (via `POST /api/sessions/acknowledge-adaptation`)

### 6C. Scoring Algorithm

Each pending session receives an alignment score from 0 to 100. The score is computed in TypeScript in the `score-sessions` Inngest step — there is no LLM call in the scoring step.

**Inputs available per session:**
- `session.session_title` — string
- `session.topic_id` — the curriculum session ID (e.g. `ai-governance-arc-s2`)
- `curriculumSession.arc_name` — from `visible_sessions` JSONB (matched by `curriculum_session_id`)
- `curriculumSession.arc_type` — `'domain'` | `'integrated'` | `'singleton'`
- `curriculumSession.role_hint` — the private instruction string from the planner

**Signal inputs from `session_insights.extracted_signals`:**
- `primary_driver`: `'compliance'` | `'competitive'` | `'cost'` | `'curiosity'` | `'other'`
- `urgency`: `'low'` | `'medium'` | `'high'`

**Score components (summed, capped at 100):**

**Component 1 — Driver keyword match (0, 30, or 50 points):**
Each `primary_driver` value maps to a set of match keywords. The algorithm checks whether any keyword appears (case-insensitive) in the concatenation of `session_title + ' ' + arc_name + ' ' + role_hint`.

| primary_driver | Match keywords | Points if any keyword found |
|---|---|---|
| `compliance` | compliance, regulatory, governance, regulation, legal, audit, risk, policy, GDPR, HIPAA | 50 |
| `competitive` | competitive, vendor, evaluation, procurement, comparison, benchmark, market, differentiat | 50 |
| `cost` | cost, ROI, budget, efficiency, spend, savings, investment | 30 |
| `curiosity` | strategy, overview, fundamentals, landscape, introduction | 30 |
| `other` | (no keyword match — 0 points from this component) | 0 |

If `primary_driver = 'other'`, Component 1 scores 0.

**Component 2 — Urgency multiplier applied to Component 1:**
After computing Component 1 points:
- `urgency = 'high'`: multiply Component 1 × 1.0 (no change — the score is already full weight)
- `urgency = 'medium'`: multiply Component 1 × 0.7
- `urgency = 'low'`: multiply Component 1 × 0.4

Round to nearest integer after multiplication.

**Component 3 — Current position bonus (0–30 points):**
Sessions that are already near the front of the queue receive a small bonus to prevent unnecessary churn. This rewards plans that are already mostly correct.

Formula: `30 × (1 - (pending_rank / total_pending))`

Where `pending_rank` is the session's current position among pending sessions only (1 = first pending session, i.e. the one immediately after the last completed session). `total_pending` is the count of all pending sessions.

Example: if there are 5 pending sessions and a session is currently at pending_rank 1 (next up), it receives `30 × (1 - 1/5) = 24` bonus points. A session at pending_rank 5 (last) receives `30 × (1 - 5/5) = 0` bonus points.

**Component 4 — Learning motivation alignment (0 or 10 points):**
Read from `user_learning_profiles.learning_motivation`. Apply 10 bonus points if:
- `learning_motivation = 'compliance_driven'` AND `primary_driver = 'compliance'`
- `learning_motivation = 'opportunity_driven'` AND `primary_driver IN ('competitive', 'curiosity')`
- `learning_motivation = 'fear_driven'` AND `primary_driver IN ('compliance', 'cost')`

Otherwise 0.

**Final score:** `min(100, Component1_adjusted + Component3 + Component4)`

**Tie-breaking:** If two sessions have identical final scores, the one with the lower current `session_index` (i.e. already earlier in the plan) stays earlier. This prevents random shuffling of tied sessions on each adaptation run.

**Minimum score threshold:** Any session scoring below 5 in Components 1+4 combined (i.e. the signals have essentially no opinion on this session) is ranked by its current position. Sessions the signals cannot speak to are left where they are relative to each other.

### 6D. New Table: `plan_adaptations`

Migration 041.

```sql
CREATE TABLE IF NOT EXISTS plan_adaptations (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             text        NOT NULL,
  trigger_session_id  uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  insight_id          uuid        NOT NULL REFERENCES session_insights(id) ON DELETE CASCADE,
  primary_driver      text        NOT NULL,
  urgency             text        NOT NULL,
  signal_summary      text        NOT NULL,  -- human-readable: "User described compliance evaluation context"
  sessions_reordered  integer     NOT NULL,  -- count of sessions whose session_index changed
  previous_order      jsonb       NOT NULL,  -- [{ sessionId, oldIndex }] — snapshot before reorder
  new_order           jsonb       NOT NULL,  -- [{ sessionId, newIndex }] — snapshot after reorder
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_adaptations_user
  ON plan_adaptations (user_id, created_at DESC);

ALTER TABLE plan_adaptations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_pa" ON plan_adaptations
  USING (auth.role() = 'service_role');
```

### 6E. New Columns on `users` Table

Migration 042.

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_adapted_at               timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan_adaptation_acknowledged_at timestamptz DEFAULT NULL;
```

No index needed. Both columns are read on the sessions page load for a single user — a point lookup on the existing `users` primary key.

### 6F. New API Route: `POST /api/sessions/acknowledge-adaptation`

No request body required. Auth required (Clerk). The route reads the authenticated user ID and sets `users.plan_adaptation_acknowledged_at = NOW()`.

Response: `{ success: true }`

Error: `401` if not authenticated. `500` if Supabase update fails.

### 6G. Sessions Page Read Change

The existing `GET /api/sessions` (or equivalent sessions page data fetch) must additionally return `plan_adapted_at` and `plan_adaptation_acknowledged_at` from the `users` table for the authenticated user.

The sessions page client component evaluates:
```typescript
const showBanner = plan_adapted_at != null &&
  (plan_adaptation_acknowledged_at == null ||
   new Date(plan_adapted_at) > new Date(plan_adaptation_acknowledged_at))
```

If `showBanner` is true, render the notification banner. Otherwise, render nothing above the sessions list.

### 6H. New Inngest Function

**File:** `inngest/adapt-plan.ts`
**Function ID:** `adapt-plan`
**Trigger event:** `distill/session.plan.adapt`
**Retries:** 2
**Failure handling:** Non-fatal to the user's session experience (the session is already completed). On exhaustion of retries, log the error with `[adapt-plan][ERROR]` prefix and the userId and insightId. Do not email admin — adaptation failure is not a critical pipeline failure. The user simply sees no reorder.

**Registration:** Add `adaptPlan` to the existing function array in `app/api/inngest/route.ts`.

### 6H. No localStorage / sessionStorage Changes

The banner dismissed state is stored server-side (`users.plan_adaptation_acknowledged_at`), not in client storage. This ensures the banner is not re-shown if the user clears their browser cache.

---

## 7. Success Criteria (Acceptance Tests)

**AC-01 — Adaptation fires after ice breaker analysis completes**
Given a user who has completed a session and the `analyzeIceBreakerResponse` job has finished with `analysis_status = 'complete'` and `urgency = 'medium'` or `'high'`, when Step 4 of `analyzeIceBreakerResponse` completes, then a `distill/session.plan.adapt` event is emitted with the correct `userId`, `sessionId`, `insightId`, `primaryDriver`, and `urgency`.

**AC-02 — Adaptation does not fire for low urgency with no driver change**
Given a user whose ice breaker response produces `urgency = 'low'` and whose `primary_driver` matches the driver from the most recent prior adaptation (or there is no prior adaptation and `primary_driver = 'other'`), when `analyzeIceBreakerResponse` Step 4 completes, then NO `distill/session.plan.adapt` event is emitted. Verified by asserting `plan_adapted_at` on the `users` row is null or unchanged.

**AC-03 — Adaptation does not run when profile confidence is low**
Given a user with `profile_confidence = 'low'` (fewer than 3 sessions with completed ice breaker analysis), when `distill/session.plan.adapt` fires, then the `adapt-plan` job exits at Step 1 without updating any `session_index` values and without inserting a `plan_adaptations` row.

**AC-04 — Completed sessions are never reordered**
Given a user with 2 completed sessions and 5 pending sessions, when a reorder runs, then the `session_index` values of the 2 completed sessions are identical before and after the adaptation. Only the 5 pending sessions' indexes change.

**AC-05 — No-op guard prevents churn**
Given a user whose pending sessions are already ordered such that the top 3 highest-scoring sessions match the top 3 by current `session_index`, when `distill/session.plan.adapt` fires, then no `session_index` values are updated, no `plan_adaptations` row is inserted, and `users.plan_adapted_at` is not updated.

**AC-06 — Compliance driver pushes compliance-tagged sessions to the front**
Given a user with `primary_driver = 'compliance'` and `urgency = 'high'`, and a pending session whose `session_title` contains the word "Governance" and whose `arc_name` contains the word "Compliance", when the adaptation runs, then that session receives the highest alignment score and is assigned `session_index = (last_completed_index + 1)` — i.e., it becomes the next scheduled session.

**AC-07 — Notification banner appears on sessions page after adaptation**
Given a completed adaptation run (i.e., `plan_adaptations` row inserted and `users.plan_adapted_at` updated), when the user loads `/dashboard/sessions`, then the notification banner is visible with the headline "Clio updated your learning path" and body text containing the correct count of reordered sessions.

**AC-08 — Banner is dismissed permanently until next adaptation**
Given a banner is visible on `/dashboard/sessions`, when the user clicks the X button, then `POST /api/sessions/acknowledge-adaptation` is called, `users.plan_adaptation_acknowledged_at` is set to a timestamp equal to or after `users.plan_adapted_at`, and on subsequent page loads the banner is not shown (until another adaptation runs).

**AC-09 — Adaptation record captures correct before/after state**
Given a completed adaptation that reordered 3 sessions, when the `plan_adaptations` row is inspected, then `previous_order` contains a JSONB array of 3 objects with `{ sessionId, oldIndex }` matching what the indexes were before the job ran, and `new_order` contains a JSONB array of 3 objects with `{ sessionId, newIndex }` matching the post-adaptation state in the `sessions` table.

**AC-10 — Acknowledge route is auth-protected**
Given a request to `POST /api/sessions/acknowledge-adaptation` with no Clerk session, then the route returns `401`.

**AC-11 — Adaptation is idempotent on retry**
Given the `adapt-plan` job fails after Step 4 (sessions reordered) but before Step 5 (plan_adaptations insert), when Inngest retries the job, then the second run of Step 4 produces the same `session_index` assignments (because the scores are deterministic from the same inputs) and does not produce duplicate `plan_adaptations` rows.

**AC-12 — Only pending sessions with count >= 2 trigger reorder**
Given a user who has only 1 pending session remaining (all others completed), when `distill/session.plan.adapt` fires, then the job exits at Step 1 without any DB writes.

---

## 8. Error States

### 8A. `distill/session.plan.adapt` event emitted but user has no active plan
If `curriculum_plans` returns no active row for the user, the job exits at Step 1 with a console log: `[adapt-plan] no active plan found for userId — skipping`. No error is thrown, no retry.

### 8B. `session_insights` row not found for `insightId`
If the insight row does not exist (e.g., deleted between emission and job execution), the job exits at Step 1 with a console log: `[adapt-plan] insightId not found — skipping`. No retry, non-fatal.

### 8C. Scoring step produces all-zero scores
If every pending session scores 0 (signals have no opinion on any of them — e.g., `primary_driver = 'other'` and no keyword matches), the no-op guard at Step 3 fires. The plan is unchanged. No notification. Logged as: `[adapt-plan] all sessions scored 0 — plan unchanged`.

### 8D. Bulk UPDATE of session_index partially fails
If the Supabase UPDATE for one or more sessions fails (network error, constraint violation), the entire Step 4 `step.run` throws. Inngest retries Step 4 from scratch. Because scoring is deterministic, the retry produces identical `session_index` assignments. The retry is safe.

### 8E. `plan_adaptations` INSERT fails
Step 5 throws. Inngest retries from Step 5. Step 4 is already committed to Supabase — Inngest step outputs are memoised, so Step 4 does not re-execute on retry. Step 5 retries the INSERT only. Because the `plan_adaptations` table has no unique constraint preventing duplicate inserts on retry (an acceptable V1 tradeoff), the retry may produce two `plan_adaptations` rows for the same adaptation event. This is acceptable — the notification shown to the user uses the most recent row only (ordered by `created_at DESC LIMIT 1`).

### 8F. `users.plan_adapted_at` UPDATE fails (Step 6)
Step 6 throws. Inngest retries Step 6. The user does not see the notification until Step 6 succeeds. The plan reorder from Step 4 is already applied — the sessions are in the correct order even if the notification never appears. On total failure (all retries exhausted), the user's plan is correctly ordered but no banner shows. This is acceptable — the ordering is the critical outcome, the banner is informational.

### 8G. Acknowledge route Supabase update fails
`POST /api/sessions/acknowledge-adaptation` returns `500` with body `{ error: 'Failed to acknowledge' }`. The banner remains visible on next page load. The user can click X again to retry.

### 8H. Slow adaptation job
Adaptation is asynchronous. The user's sessions page loads immediately after a session without waiting for adaptation. If adaptation has not yet run, the banner does not appear yet. When it does complete (typically within 30 seconds of session end, given CONTENT-01's ice breaker analyzer also runs async), the banner will appear on the user's next page load. There is no real-time push to update an already-loaded page — the user must navigate away and back, or refresh.

---

## 9. Edge Cases

**Edge case 1 — Multiple ice breaker responses in the same session (one per subtopic)**
CONTENT-01 fires one `distill/session.ice-breaker.response` event per subtopic. The `analyzeIceBreakerResponse` job runs once per subtopic. This means `distill/session.plan.adapt` could fire multiple times for the same session (once per subtopic's ice breaker analysis completion).

Resolution: the `adapt-plan` job checks whether a `plan_adaptations` row already exists for `trigger_session_id = sessionId` within the last 60 minutes. If yes, it skips and exits. Only the first adaptation per session is applied. The 60-minute window prevents duplicate reorders from the same session while allowing new adaptations from future sessions.

**Edge case 2 — User completes multiple sessions before adaptation runs**
If Inngest is backlogged and adaptation events queue up, multiple `distill/session.plan.adapt` events for different sessions may process in sequence. Each runs the full algorithm against the current state of `sessions`. Later runs automatically work from the already-adapted ordering. This is correct behaviour — each run refines the plan further.

**Edge case 3 — User's plan has only 2 sessions total (1 completed, 1 pending)**
The minimum threshold check (pending sessions < 2) exits the job. With only 1 remaining session, there is nothing to reorder. No notification appears.

**Edge case 4 — All pending sessions have the same title keywords as the signal driver**
If every pending session matches the driver keywords equally, scores are equal across all sessions. The tie-breaking rule applies: sessions remain in their current order. The no-op guard at Step 3 fires (current order equals score-sorted order). No reorder. No notification. This is correct — the plan was already well-matched.

**Edge case 5 — Adaptation runs, then user completes another session, then adaptation runs again**
Second adaptation uses the current `sessions` table state (which now has one more completed session). The second adaptation only touches the remaining pending sessions. Completed sessions from both Session 1 and Session 2 are locked. This is handled correctly by the status filter in Step 1.

**Edge case 6 — User's `primary_driver` changes between sessions**
Session 1 ice breaker: `primary_driver = 'compliance'`. Session 2 ice breaker: `primary_driver = 'competitive'`. Because `primary_driver` differs from the prior adaptation's driver, the emission guard in `analyzeIceBreakerResponse` allows the second event to fire. The second adaptation re-scores all remaining pending sessions with the competitive driver. The plan re-orders again. The user sees a second banner on next page load (the new `plan_adapted_at` is later than `plan_adaptation_acknowledged_at` set after the first banner was dismissed).

**Edge case 7 — User has not dismissed the first banner when a second adaptation fires**
`plan_adapted_at` is overwritten with the new timestamp. `plan_adaptation_acknowledged_at` remains at its old value (or null). The banner remains visible. The banner body text reads the count from the most recent `plan_adaptations` row (`created_at DESC LIMIT 1`). The user sees accurate information about the most recent reorder.

**Edge case 8 — Scheduled sessions (`scheduled_at` is set) are reordered**
When `session_index` changes, `scheduled_at` values are NOT automatically updated. The schedule assignment (which maps specific dates to sessions) becomes misaligned — a session originally scheduled for Thursday at 9am may now be at a different position in the sequence, but the `scheduled_at` date does not change.

Resolution: this is accepted in V1. The `scheduled_at` column is used for reminders and agenda emails. After a reorder, the scheduled dates no longer match the sequence. The `scheduled_at` for the newly-first pending session (which may have been previously scheduled for a later date) still holds its original date. The user will receive reminders on the originally-scheduled date. This is a known limitation to be addressed in a future spec (POST-SCR-01 scheduling reconciliation). It is documented in Section 10 (Out of Scope).

**Edge case 9 — `role_hint` field is very long (up to 1000 chars per planner schema)**
The keyword matching in Component 1 is applied to the concatenated string of `session_title + ' ' + arc_name + ' ' + role_hint`. Long `role_hint` values increase the likelihood of keyword hits. This is intentional — `role_hint` is written by the curriculum planner specifically to describe the framing angle for this session, and compliance/competitive framing is often embedded in `role_hint` text. No truncation is applied.

**Edge case 10 — `ANTHROPIC_API_KEY` is a placeholder**
The `adapt-plan` function contains no Anthropic calls. It is unaffected by placeholder API keys. Scoring is pure TypeScript. The function runs fully in placeholder/mock mode with no degradation.

---

## 10. Out of Scope

The following are explicitly NOT part of this feature:

1. **Rescheduling `scheduled_at` after reorder.** When sessions are reordered, their `scheduled_at` timestamps are not moved to match the new sequence. Scheduling reconciliation after a reorder is a separate future feature.

2. **Action item extraction from session transcripts.** The CEO brief mentions "extracts action items the user mentioned." This is not implemented in SCR-01. The `session_insights` table already captures the raw transcript and extracted signals via CONTENT-01. Action items (commitments the user made during the session) would require a separate extraction pass. Deferred to a future spec.

3. **User-initiated reordering.** The user cannot manually drag sessions to reorder them. The only mechanism that changes order is the background adaptation job. Manual reordering is a separate future feature.

4. **Undo / restore prior order.** The user cannot undo an adaptation. The `plan_adaptations` table records `previous_order` for future use, but V1 exposes no UI to restore it. The user can see the `plan_adaptations` record exists (for future admin tooling) but cannot act on it.

5. **7 response variants per checkpoint.** The CEO brief mentions pre-generating 7 response variants and a YES/NO coverage check for deferral. These belong in the CURR-01 spec (curriculum redesign and quality evaluation). They are not in scope for SCR-01. SCR-01 only handles post-session plan reordering.

6. **Queue sessions (non-visible sessions) reordering.** Only sessions with `status = 'pending'` that are currently in the user's visible plan are reordered. The shadow queue (`is_visible = false` sessions in `curriculum_plans.visible_sessions`) is not affected. If a queue session is promoted to visible in the future, it receives a new `session_index` at that point.

7. **Cross-user learning signal aggregation.** The reordering algorithm is per-user only, based solely on that user's `session_insights` and `user_learning_profiles`. There is no aggregation of signals across users to improve ordering.

8. **Notification email or push notification.** The adaptation notification is banner-only on the sessions page. No email, no SMS, no push notification is sent to inform the user that their plan was updated.

9. **Admin view of adaptation history.** The `plan_adaptations` table is write-only from the user journey perspective. No admin screen, no internal dashboard, no Supabase UI template is built to display it. It is available for future tooling.

10. **Subtopic-level reordering within a session.** This feature reorders sessions (rows in the `sessions` table). It does not change the order of subtopics within a session (the `sub_sessions` JSONB array). Subtopic ordering within a session is set at content generation time and is not changed by adaptation signals.

---

## 11. Open Questions

None.

All design decisions are resolved in this document. The key decisions made by the BA without CEO escalation (within the BA's authority to resolve) are:

**D-01 — Confidence threshold:** The BA resolved `profile_confidence = 'low'` (fewer than 3 sessions) as the no-adaptation threshold. Rationale: 1-2 ice breaker responses are insufficient to distinguish a genuine driver from a passing comment. The minimum of 3 sessions provides enough signal to act with confidence.

**D-02 — Reorder only pending sessions, not re-insert:** Rather than delete and reinsert sessions (which would break foreign keys in `delivery_log`, `session_insights`, `plan_adaptations`), the reorder uses bulk UPDATE of `session_index`. This is safe, reversible, and preserves all relationships.

**D-03 — No-op guard uses top-3 comparison, not full sequence:** Comparing only the first 3 pending sessions is sufficient to catch the most common "plan already correct" scenario while being simple to implement. Full sequence comparison would be over-engineered for V1.

**D-04 — Notification stored server-side, not in localStorage:** Chosen because the dismissed state must survive browser cache clears and be consistent across devices.

**D-05 — `scheduled_at` not updated on reorder:** Accepted as a V1 limitation. Scheduling reconciliation would require understanding the user's scheduling preferences, available time slots, and calendar state — a complex separate feature. The learning path correctness takes priority over schedule accuracy.

**D-06 — Deduplication of multiple adaptation events per session:** The 60-minute window check (same `trigger_session_id`) prevents multiple reorders from the same session's multiple ice breaker subtopics. The first subtopic's adaptation wins.

**D-07 — Emission guard uses `urgency` threshold:** Only `'medium'` or `'high'` urgency (or a changed `primary_driver`) triggers the emission of `distill/session.plan.adapt`. This prevents low-urgency sessions where the user said very little from triggering plan churn.

**D-08 — Scoring algorithm is pure TypeScript, no LLM:** LLM calls would add latency, cost, and potential failure modes to what should be a fast, reliable background job. The keyword-matching scoring is deterministic, debuggable, and can be tested with unit tests. The signals (already extracted by the ice breaker analyzer) contain enough structured data that a keyword-matching approach produces correct results.

---

## 12. Dependencies

### What must exist before this can be built:

1. **CONTENT-01 must be fully deployed.** SCR-01 depends on:
   - The `session_insights` table (CONTENT-01 migration 039) with populated `extracted_signals` rows
   - The `analyzeIceBreakerResponse` Inngest function (`inngest/ice-breaker-analyzer.ts`) — SCR-01 requires a new emission at the end of Step 4 of that function
   - The `ExtractedSignals` type exported from `inngest/ice-breaker-analyzer.ts` — the scoring algorithm reads `primary_driver` and `urgency` from this shape

2. **SCH-01 must be deployed.** Sessions must have `session_index` populated (SCH-01 ensures `scheduleSessions()` writes real indexes for all pending sessions). Without `session_index` values, the reordering algorithm has no base ordering to work from and no values to update.

3. **SESS-06 must be deployed.** Sessions must have `sub_sessions` properly wired from the curriculum planner subtopics. While SESS-06 does not directly affect the reordering logic, without it sessions have generic subtopic content — the `session_title` and `topic_id` fields that the scoring algorithm depends on may be generic fallbacks ("Core concepts", "Real-world application") that will not match driver keywords correctly.

4. **Migration 040 (CURR-01)** — if CURR-01 uses migration 040, confirm the number before running SCR-01 migrations. SCR-01 uses 041 (`plan_adaptations`) and 042 (new `users` columns). If CURR-01 is not yet built, SCR-01 migrations start at 040 and 041 respectively. The developer must check the current highest applied migration number and use the next two sequential numbers.

5. **`app/api/sessions` route** (or equivalent sessions page data fetch) must be modified to also return `plan_adapted_at` and `plan_adaptation_acknowledged_at` from the `users` table. The developer must identify the exact file that serves session data to the sessions page client component.

### Build sequence within this feature:

1. Write migrations 041 and 042 (or renumbered as needed)
2. Apply both migrations in Supabase dashboard
3. Add `plan_adapted_at` and `plan_adaptation_acknowledged_at` to the `users` TypeScript type in `lib/supabase.ts` or equivalent type definition file
4. Modify `inngest/ice-breaker-analyzer.ts` Step 4: add `step.sendEvent` at the end to emit `distill/session.plan.adapt` (conditional on urgency/driver guard)
5. Create `inngest/adapt-plan.ts` with the full `adaptPlan` function (Steps 1-6)
6. Register `adaptPlan` in `app/api/inngest/route.ts`
7. Create `app/api/sessions/acknowledge-adaptation/route.ts`
8. Modify sessions page data fetch to include `plan_adapted_at` and `plan_adaptation_acknowledged_at`
9. Add banner component to sessions page client component
10. TypeScript check: `npx tsc --noEmit` must pass with zero errors

### Deployment order:
- Migrations first (safe before code — no code depends on the new columns or table yet)
- `ice-breaker-analyzer.ts` modification second (starts emitting adaptation events; adaptation job must be registered before or simultaneously)
- `adapt-plan.ts` + Inngest registration third (must be live before or at the same time as the ice-breaker-analyzer change, or events will queue without a handler)
- API route and UI changes last (can deploy in same release as the Inngest changes)
