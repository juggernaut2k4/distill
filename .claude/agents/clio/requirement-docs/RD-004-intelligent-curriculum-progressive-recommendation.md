# Intelligent Curriculum Engine + Progressive Recommendation System — Requirement Document

```
Version: 1.0
Status: CEO APPROVED
Author: Business Analyst Agent
Date: 2026-05-31
Approved by: CEO Agent
Approved at: 2026-05-31
Feature Brief: FB-004
```

---

## 1. Purpose

Today a user selects topics, Clio runs `buildCurriculum()` synchronously on the client, and produces a flat topological list of sessions with no arc structure, no sequencing intelligence, and no queue. The user approves the plan, schedules sessions, and when those sessions are done — there is nothing left. The user has no reason to return.

This feature replaces the static curriculum builder with a four-layer intelligent system:

1. **LLM classification** — reads the full topic selection plus user profile and decides which topics deserve their own deep arcs versus which should be woven together into an integrated path.
2. **Visible plan** — a structured, sequenced, approvable learning path of up to 10 sessions shown to the user.
3. **Shadow queue** — up to 50 additional session definitions stored invisibly behind the visible plan; never shown in full.
4. **Progressive recommendation engine** — promotes sessions from queue to visible plan as the user progresses, and surfaces intelligent "add this topic" recommendations that drive re-engagement, additional scheduling, and subscription upgrades.

**Failure without this feature:** Users exhaust the plan after 1–3 sessions, find nothing left, and churn. There is no algorithm keeping them engaged and no business lever to drive upgrades.

---

## 2. User Stories

**Story A — Multi-topic user (primary)**
As a senior executive who has selected 4–8 topics during onboarding,
I want to see a structured, intelligently sequenced learning plan that groups my topics sensibly (not a flat undifferentiated list),
So that I can understand the learning journey ahead of me, commit to it by approving it, and feel the plan is genuinely tailored to my role and level.

**Story B — Single-topic user**
As an executive who selected only one topic (e.g., "AI Governance"),
I want to receive a complete multi-session learning path for that topic at the right depth for my role,
So that I am not left with just one session and no reason to return.

**Story C — Returning user (progression)**
As an executive who has completed some sessions,
I want new sessions to automatically appear in my plan as I progress — without me having to re-onboard or manually pick new topics —
So that my plan always has something ahead of me and I never hit a dead end.

**Story D — Discovery user**
As an executive who has been learning for a few weeks,
I want to see intelligent recommendations of new topics based on what I have already covered,
So that I can expand my learning without having to browse a catalog myself.

---

## 3. Trigger / Entry Point

### Trigger 1: Plan generation (new plan)
- **Where:** `POST /api/curriculum/generate`
- **When triggered:** User navigates to `/dashboard/plan` for the first time after topic selection AND no `curriculum_plans` row exists for this user. The page server component checks for an existing plan; if absent, it calls the generate API before rendering.
- **Also triggered:** User clicks "Regenerate plan" (visible only if they have no approved plan yet).
- **User state required:** Logged in via Clerk. Must have `topic_interests` (non-empty array) in the `users` table. Must NOT have an approved curriculum plan already in `curriculum_plans`.

### Trigger 2: Plan approval
- **Where:** Button click on `/dashboard/plan`
- **When triggered:** User clicks "Approve plan — start learning" on the plan approval screen.
- **API:** `POST /api/plan/approve` (already exists; no change to this endpoint required — it sets `plan_approved = true` on the `users` table).

### Trigger 3: Session completion
- **Where:** Session page (existing `/dashboard/session/[id]` or equivalent)
- **When triggered:** User clicks "Mark complete" OR has been on the session page for ≥ 4 consecutive minutes.
- **API:** `POST /api/curriculum/complete-session`

### Trigger 4: Queue promotion (background)
- **Where:** Inngest job
- **When triggered:** Completion event processed AND visible plan drops below 3 remaining incomplete sessions. Also runs on a daily cron as a safety check.

### Trigger 5: Recommendation accept/dismiss
- **Where:** `/dashboard/plan` — "Recommended for you" section
- **APIs:** `POST /api/curriculum/accept-recommendation` / `POST /api/curriculum/dismiss-recommendation`

---

## 4. Screen / Flow Description

### State 0: No plan yet (loading / generating)

The user arrives at `/dashboard/plan`. The server component checks `curriculum_plans` — no row found. It calls `POST /api/curriculum/generate` (or this call is triggered client-side immediately on mount). While the LLM generates the plan:

- The plan tab area shows a skeleton loading state (see Section 5, Wireframe A).
- Header text: "Building your personalised learning plan…"
- Sub-text: "Analysing your topic selection and role to create an intelligent learning path."
- Three skeleton session cards pulse with opacity animation (Framer Motion `animate={{ opacity: [0.4, 0.8, 0.4] }}`).
- No buttons are shown yet.
- Duration: typically 3–8 seconds. If the call takes longer than 15 seconds, show a "Still working…" message below the skeletons.

If the LLM call fails entirely (all retries exhausted), show the fallback state (see Error States, Section 8).

### State 1: Plan generated — approval required

The LLM has returned and the plan is saved. The page re-renders (or client polls/websocket receives result) showing the approval screen.

- Header: "Your personalised learning plan" (white, 28px bold)
- Sub-header: "Based on your topics and role, here's how Clio will guide you. Review and approve to begin." (secondary text colour, 14px)
- **Plan summary bar** (3 stats in a row):
  - "Sessions" — count of visible sessions (e.g., 8)
  - "Total time" — sum of `estimated_minutes` across visible sessions (e.g., "~3h 20m")
  - "Arcs" — number of distinct arcs (e.g., 3)
- **Arc sections** — the visible sessions are grouped by arc. Each arc is a collapsible section:
  - Arc header: arc name (e.g., "AI Governance Arc") + badge showing "4 sessions" + arc type badge ("Domain" / "Integrated" / "Intro")
  - Under the arc header, each session card in that arc shows:
    - Session number within arc (e.g., "Session 1 of 4")
    - Session title (white, 15px semibold)
    - Focus line (2-line description, secondary colour, 13px)
    - Estimated duration (e.g., "~25 min") with Clock icon
    - Depth level badge (Beginner / Intermediate / Advanced) with colour coding (green / cyan / purple)
    - Status: "Not started" (muted, no icon)
  - All arcs are expanded by default on first view.
- **Approve button** (full-width or prominent right-aligned): "Approve plan — start learning →" (primary purple button, large)
- **Secondary link** below button: "Change topics →" (links to `/topics`)

### State 2: Plan approved — active learning

After approval, the user returns to this page on subsequent visits. This is the ongoing active state.

- Header: "Your learning plan" with a "Plan approved" badge (green, CheckCircle icon)
- **Progress bar** at the top of the sessions list: shows X of Y sessions completed (e.g., "2 of 8 complete") as a thin progress bar (purple fill on dark track)
- **Session list** — same arc-grouped structure as State 1, but with status updates:
  - Completed sessions: green CheckCircle icon, title in muted colour, "Completed [date]" sub-text
  - Current session (first incomplete): white title, "Start here →" CTA button inline on the card (purple, small)
  - Future sessions: dimmed title, "Up next" or arc position label, no CTA
- **"Recommended for you" section** (below session list):
  - Section heading: "Recommended for you" (white, 16px semibold) + sub-text "Topics we think you'll benefit from next" (muted, 13px)
  - Up to 2 recommendation cards (Pro/Executive tier; 1 card for Starter; not shown for Free/Trial)
  - Each recommendation card: topic name (white), 1-line rationale (muted), "Add to plan →" button (secondary outline purple), "Dismiss" link (muted text, far right)
  - If no recommendations are available: section is hidden entirely (not shown as "empty")

### State 3: Queue promotion — new sessions surface

When the background engine promotes sessions from queue to visible plan, the next time the user loads `/dashboard/plan`:

- Newly promoted sessions appear at the bottom of their relevant arc with a "New" badge (cyan, small) for the first 24 hours after promotion.
- No notification toast on the plan page itself (this is a silent update).
- The progress bar total updates to reflect the higher session count.

### State 4: Recommendation accept flow

User clicks "Add to plan →" on a recommendation card:

1. The recommendation card immediately shows a loading spinner and text "Generating sessions…" (the accept API triggers async session generation).
2. The card is replaced by a placeholder session card in the relevant arc area showing "Generating… [Topic Name]" with the same pulsing skeleton animation used in State 0.
3. When generation completes (the async job resolves), the placeholder is replaced by the real session card. This happens on the next page load or via a polling mechanism (poll `GET /api/curriculum/plan` every 5 seconds until `is_generating: false`).
4. If generation fails: placeholder shows "Couldn't generate — try again" with a retry link.

### State 5: Free/Trial plan (gated)

- Visible plan is limited to 3 sessions.
- No shadow queue.
- No "Recommended for you" section.
- Below the 3 session cards, an upgrade CTA banner: "Unlock your full learning path — 10 sessions + AI recommendations" with "Upgrade to Starter →" button (purple, secondary).

---

## 5. Visual Examples

### Wireframe A — Loading / Generating State

```
┌────────────────────────────────────────────────────────────────────┐
│  /dashboard/plan                                                    │
│                                                                     │
│  ✦ Your Learning Plan                                               │
│  Building your personalised learning plan…                          │
│  Analysing your topic selection and role to create an              │
│  intelligent learning path.                                         │
│                                                                     │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← skeleton card 1   │
│                                                                     │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← skeleton card 2   │
│                                                                     │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← skeleton card 3   │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Wireframe B — Plan Approval State

```
┌────────────────────────────────────────────────────────────────────┐
│  /dashboard/plan                                                    │
│                                                                     │
│  ✦ Your personalised learning plan                                  │
│  Based on your topics and role, here's how Clio will guide you.    │
│  Review and approve to begin.                                       │
│                                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐                     │
│  │ Sessions │  │  Total time  │  │   Arcs   │                     │
│  │    8     │  │   ~3h 20m    │  │    3     │                     │
│  └──────────┘  └──────────────┘  └──────────┘                     │
│                                                                     │
│  ▼ AI Governance Arc  [4 sessions]  [Domain]                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Session 1 of 4 · ~25 min · [Beginner]                       │  │
│  │ AI Governance Foundations                                    │  │
│  │ Why governance is now a board-level conversation and the     │  │
│  │ three pillars every executive must understand.               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Session 2 of 4 · ~25 min · [Intermediate]                   │  │
│  │ Risk Frameworks for AI                                       │  │
│  │ ...                                                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  (more sessions...)                                                 │
│                                                                     │
│  ▼ AI Tools Integration Arc  [3 sessions]  [Integrated]             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Session 1 of 3 · ~20 min · [Beginner]                       │  │
│  │ ...                                                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  [  Approve plan — start learning →  ]  (primary purple button)    │
│  Change topics →  (muted text link)                                │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Wireframe C — Active Plan State (in progress)

```
┌────────────────────────────────────────────────────────────────────┐
│  /dashboard/plan                              [Plan approved ✓]     │
│                                                                     │
│  Your learning plan                                                 │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░  2 of 8 sessions complete         │
│                                                                     │
│  ▼ AI Governance Arc  [4 sessions]                                  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ ✓  AI Governance Foundations          Completed 28 May       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ ▶  Risk Frameworks for AI             [Start here →]  ~25min │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │    Regulatory Landscape               Session 3 of 4         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │    Board Communication on AI          Session 4 of 4         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ▼ AI Tools Integration Arc  [3 sessions]                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ ✓  Claude for Work Fundamentals       Completed 29 May       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  (more sessions...)                                                 │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│  Recommended for you                                                │
│  Topics we think you'll benefit from next                          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ AI Ethics & Responsible Use                              │      │
│  │ Builds directly on your governance arc — examines        │      │
│  │ where governance meets accountability in practice.       │      │
│  │ [Add to plan →]                         [Dismiss]        │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ AI Regulation & Compliance                               │      │
│  │ Logical next step after risk frameworks — covers         │      │
│  │ EU AI Act and what it means for your organisation.       │      │
│  │ [Add to plan →]                         [Dismiss]        │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Wireframe D — Recommendation Card (accept in progress)

```
┌──────────────────────────────────────────────────────────┐
│ AI Ethics & Responsible Use                              │
│ Generating sessions…  ◌  (spinner)                       │
│ [                                        ]               │
└──────────────────────────────────────────────────────────┘
```

### Wireframe E — Free/Trial Gated State

```
┌────────────────────────────────────────────────────────────────────┐
│  Your learning plan                                                 │
│                                                                     │
│  ▼ AI Governance Arc  [3 sessions shown]                            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Session 1   ·  AI Governance Foundations   ·  ~25min         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Session 2   ·  Risk Frameworks for AI      ·  ~25min         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Session 3   ·  Regulatory Landscape        ·  ~25min         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  🔒 Unlock your full learning path                           │  │
│  │  10 sessions + AI recommendations + shadow queue             │  │
│  │  [  Upgrade to Starter →  ]                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

### New database tables

#### `curriculum_plans`
```sql
CREATE TABLE curriculum_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_llm_output      jsonb NOT NULL,
  visible_sessions    jsonb NOT NULL DEFAULT '[]',
  queue_sessions      jsonb NOT NULL DEFAULT '[]',
  dismissed_recs      jsonb NOT NULL DEFAULT '[]',   -- array of session_id strings
  generated_at        timestamptz NOT NULL DEFAULT now(),
  user_profile_hash   text NOT NULL,
  is_approved         boolean NOT NULL DEFAULT false,
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX curriculum_plans_user_id_idx ON curriculum_plans(user_id);
CREATE INDEX curriculum_plans_user_profile_hash_idx ON curriculum_plans(user_profile_hash);
```

**Column notes:**
- `raw_llm_output` — full JSON returned by the LLM, stored for debugging and audit
- `visible_sessions` — JSONB array of session objects currently visible to the user (ordered, first entry = current session)
- `queue_sessions` — JSONB array of session objects in the shadow queue (ordered by ranking score)
- `dismissed_recs` — array of `session_id` values the user has permanently dismissed from recommendations
- `user_profile_hash` — SHA-256 of `role + ai_maturity + sorted(topic_interests)`. Used for cache invalidation: if user changes topics, hash changes, triggering plan regeneration.
- One user can only have one active curriculum plan at a time. A new plan generation inserts a new row and marks old rows as superseded (add `superseded_at timestamptz` column, set to `now()` when a new plan is generated for the same user).

#### `session_completions`
```sql
CREATE TABLE session_completions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  plan_id             uuid NOT NULL REFERENCES curriculum_plans(id) ON DELETE CASCADE,
  session_id          text NOT NULL,
  completed_at        timestamptz NOT NULL DEFAULT now(),
  time_spent_seconds  integer NOT NULL DEFAULT 0,
  completion_method   text NOT NULL CHECK (completion_method IN ('explicit', 'time_threshold')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_completions_user_id_idx ON session_completions(user_id);
CREATE INDEX session_completions_plan_id_idx ON session_completions(plan_id);
CREATE UNIQUE INDEX session_completions_unique_per_plan
  ON session_completions(user_id, plan_id, session_id);
```

**Column notes:**
- `session_id` — the `session_id` slug from the session object (not a FK to a sessions table; sessions live in JSONB on `curriculum_plans`)
- The unique index prevents double-counting a session completion

### Modified tables

#### `users` table — add column
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_plan_id uuid REFERENCES curriculum_plans(id);
```
This is the FK to the user's current active plan. Updated when a plan is approved.

### Data read by each screen/API

| Screen/API | Reads | Writes |
|---|---|---|
| `GET /api/curriculum/plan` | `curriculum_plans` (visible_sessions, queue_sessions, dismissed_recs), `session_completions` (for completion status per session) | — |
| `POST /api/curriculum/generate` | `users` (role, ai_maturity, topic_interests) | `curriculum_plans` (insert) |
| `POST /api/curriculum/complete-session` | `curriculum_plans` (queue_sessions, visible_sessions), `session_completions` | `session_completions` (insert), `curriculum_plans` (update visible_sessions if promotion triggered) |
| `POST /api/curriculum/dismiss-recommendation` | `curriculum_plans` (dismissed_recs) | `curriculum_plans` (update dismissed_recs) |
| `POST /api/curriculum/accept-recommendation` | `curriculum_plans`, `users` | `curriculum_plans` (update visible_sessions / queue_sessions), Inngest event emitted |
| Plan page (server component) | `users.active_plan_id`, `curriculum_plans`, `session_completions` | — |

### LLM output schema (full definition)

The LLM is called via `@anthropic-ai/sdk` with `claude-sonnet-4-6`. The system prompt instructs it to return ONLY valid JSON matching the following schema. The application validates the response using Zod before saving.

```typescript
// Zod schema for validation
const SessionSchema = z.object({
  session_id: z.string().min(1).max(128),        // url-safe slug, e.g. "ai-governance-arc-s1"
  title: z.string().min(3).max(100),
  focus: z.string().min(10).max(300),             // 1-2 sentence learning focus
  arc_position: z.number().int().min(1),          // position within arc (1-indexed)
  arc_length: z.number().int().min(1),            // total sessions in this arc
  depth_level: z.enum(['beginner', 'intermediate', 'advanced']),
  role_hint: z.string().min(5).max(300),          // instruction to content generator: how to frame for this user's role
  estimated_minutes: z.number().int().refine(v => [15, 20, 25, 30].includes(v)),
  is_visible: z.boolean(),                         // true = goes into visible plan, false = shadow queue
  queue_rationale: z.string().max(300).nullable(), // required when is_visible = false, null when is_visible = true
})

const ArcSchema = z.object({
  arc_name: z.string().min(1).max(100),
  arc_type: z.enum(['domain', 'integrated', 'singleton']),
  sessions: z.array(SessionSchema).min(1).max(30),
})

const CurriculumOutputSchema = z.object({
  arcs: z.array(ArcSchema).min(1).max(10),
  total_visible: z.number().int().min(1).max(10),
  total_queued: z.number().int().min(0).max(50),
  generated_at: z.string(),   // ISO timestamp, set by LLM (verified client-side)
  user_profile_hash: z.string().min(8),
})
```

**Field definitions:**

- `session_id` — unique URL-safe slug. Format: `{arc-slug}-s{n}`, e.g. `ai-governance-arc-s1`, `tools-integration-s3`. Must be unique within the entire output object.
- `title` — human-readable session title (15 words max), e.g. "AI Governance Foundations: The Board Perspective"
- `focus` — 1–2 sentences describing what the user will learn in this session. Written as an outcome: "You will understand…" or "Covers…"
- `arc_position` — this session's sequence number within its arc (1 = first, arc_length = last)
- `arc_length` — total number of sessions in this arc (both visible and queued combined)
- `depth_level` — calibrated to the user's AI maturity. Beginner users get beginner depth even for advanced topics. Advanced users can receive advanced depth by session 3+.
- `role_hint` — plain-English instruction to the content generation LLM. Example: "Frame governance risk in terms of board liability and investor confidence, not IT compliance checklists. This user is a CFO." This is NOT shown to the user.
- `estimated_minutes` — must be one of: 15, 20, 25, 30. Introductory sessions lean 15–20. Deep-dive sessions lean 25–30.
- `is_visible` — the LLM marks sessions true/false based on the visible/queue split rules (see Q3). The system validates that `total_visible` sessions have `is_visible: true` and `total_queued` sessions have `is_visible: false`.
- `queue_rationale` — for queued sessions only: why was this included in the queue? Used by the recommendation engine for ranking and for the recommendation card copy. Example: "Logical deep-dive after AI Governance Foundations; addresses regulatory compliance which matches user's stated worry."

### API calls

| API | Method | Auth | Request body | Response |
|---|---|---|---|---|
| `/api/curriculum/generate` | POST | Clerk required | `{}` (no body; user context from session) | `{ plan_id: string, visible_sessions: Session[], arc_count: number, total_visible: number }` |
| `/api/curriculum/plan` | GET | Clerk required | — | `{ plan: CurriculumPlan \| null, completions: string[], is_generating: boolean }` |
| `/api/curriculum/complete-session` | POST | Clerk required | `{ session_id: string, time_spent_seconds: number, method: 'explicit' \| 'time_threshold' }` | `{ success: boolean, promoted_sessions: Session[] }` |
| `/api/curriculum/dismiss-recommendation` | POST | Clerk required | `{ session_id: string }` | `{ success: boolean }` |
| `/api/curriculum/accept-recommendation` | POST | Clerk required | `{ session_id: string }` | `{ success: boolean, generating: boolean }` |

All request bodies validated with Zod. All responses typed. All errors return `{ error: string, code: string }`.

### localStorage

No new localStorage usage. Existing `clio_onboarding` key is read by the plan page server component (already implemented) — no change.

---

## 7. Success Criteria (Acceptance Tests)

**AC-001 — Plan generation: multi-topic user**
Given a logged-in user with 4 topics selected and AI maturity "intermediate",
When they navigate to `/dashboard/plan` for the first time,
Then the loading skeleton is shown within 100ms of page load, and within 15 seconds the approval screen displays a plan with at least 5 visible sessions organised into at least 2 named arcs.

**AC-002 — Plan generation: arc classification**
Given a user who has selected "AI Governance" and "Claude for Work" as topics,
When the LLM generates the plan,
Then "AI Governance" sessions appear in a separate arc labelled with arc_type "domain", and "Claude for Work" sessions appear in a separate arc labelled with arc_type "integrated" or "singleton".
(These two topics must NOT be merged into a single arc.)

**AC-003 — Visible plan limit: Pro tier**
Given a Pro-tier user with 8 selected topics,
When the plan is generated,
Then the visible plan contains exactly 10 sessions (or fewer if total generated < 10), and the shadow queue contains at least 1 session.

**AC-004 — Visible plan limit: Free/Trial tier**
Given a Free/Trial-tier user,
When they view their plan,
Then they see exactly 3 sessions and no "Recommended for you" section, and a visible upgrade CTA banner is present below the session cards.

**AC-005 — Single-topic plan**
Given a user who selected exactly one topic ("AI Regulation & Compliance") with AI maturity "beginner",
When the plan is generated,
Then the visible plan has at least 5 sessions all within a single arc, and no session exceeds "intermediate" depth level.

**AC-006 — Plan approval flow**
Given a user viewing the approval screen,
When they click "Approve plan — start learning →",
Then `plan_approved` is set to true on the `users` table, `is_approved` is set to true on the `curriculum_plans` row, `users.active_plan_id` is updated, and the page transitions to the active plan state (State 2).

**AC-007 — Session completion: explicit**
Given a user on a session page,
When they click "Mark complete",
Then a POST to `/api/curriculum/complete-session` is made with `method: 'explicit'`, a row is inserted into `session_completions`, the session card on the plan page shows a green CheckCircle, and the progress bar count increments by 1.

**AC-008 — Session completion: time threshold**
Given a user who has been on the session page for exactly 4 minutes without clicking "Mark complete",
When the 4-minute threshold triggers,
Then a POST to `/api/curriculum/complete-session` is made automatically with `method: 'time_threshold'`, and the same completion side-effects as AC-007 occur.

**AC-009 — Queue promotion trigger**
Given a user whose visible plan has 2 remaining incomplete sessions (dropped below threshold of 3),
When a session completion event is processed,
Then the `complete-session` API promotes enough sessions from the queue to bring the visible plan to 5 incomplete sessions (or all remaining queue sessions if fewer than 5 remain).

**AC-010 — Recommendation dismiss**
Given a recommendation card for "AI Ethics & Responsible Use" shown to the user,
When the user clicks "Dismiss",
Then the `session_id` is added to `curriculum_plans.dismissed_recs`, the card disappears immediately, and if there is another recommendation in the queue it surfaces to replace it.
On page reload, the dismissed recommendation does not reappear.

**AC-011 — Recommendation accept**
Given a recommendation card for "AI Regulation & Compliance",
When the user clicks "Add to plan →",
Then the card shows "Generating sessions…" immediately, an Inngest event `clio/recommendation.accepted` is emitted, and within 30 seconds new session cards appear in the relevant arc.

**AC-012 — Failure fallback**
Given the LLM call fails on all 3 retry attempts,
When the user is on `/dashboard/plan`,
Then the system falls back to `buildCurriculum()`, the page shows the fallback plan (without arc grouping), and a toast message reads "We're still building your personalised plan — it'll be ready shortly."

**AC-013 — Session deduplication**
Given a user who has already completed a session,
When the system attempts to record the same completion,
Then the unique index on `session_completions(user_id, plan_id, session_id)` prevents a duplicate row, and the API returns `{ success: true }` without error (idempotent).

**AC-014 — Role hint in content generation**
Given a session with `role_hint: "Frame governance risk in terms of board liability and investor confidence"`,
When the content generator produces the session script,
Then the `role_hint` is included in the content generation system prompt and does NOT appear verbatim in the user-facing session content.

**AC-015 — Starter tier: recommendation limit**
Given a Starter-tier user,
When they view the "Recommended for you" section,
Then at most 1 recommendation card is shown (not 2).

---

## 8. Error States

### E1 — LLM call fails (< 3 retries exhausted)
- **What user sees:** Loading skeleton remains. No error message shown prematurely.
- **Background:** Inngest retries with exponential backoff: attempt 2 after 5s, attempt 3 after 20s.
- **User experience:** Appears as normal loading. Most users will not notice.

### E2 — LLM call fails (all 3 retries exhausted)
- **What user sees:** A plan IS shown — the fallback plan generated by the existing `buildCurriculum()` function from `lib/content/curriculum.ts`. Sessions are shown without arc grouping (flat list, single default arc named "Your Learning Path").
- **Toast notification:** Shown for 6 seconds: "We're still building your personalised plan — it'll be ready shortly." (amber background, no error icon — this reads as informational, not alarming)
- **Background:** Inngest schedules a final retry attempt 10 minutes later. If that succeeds, the next page load shows the real plan.
- **Log:** Error logged to server console with full LLM response (or network error details). Never surfaced to user.

### E3 — LLM returns malformed JSON
- **Same as E2.** The Zod validation parse failure is treated identically to a network failure. Fallback plan shown, toast shown, retry scheduled.

### E4 — Plan API is slow (>5 seconds)
- **What user sees:** Loading skeleton with additional message appearing after 5s: "Still working — complex topic selections take a moment…"
- **No timeout on the client.** The request runs until resolution or failure.

### E5 — `complete-session` API fails
- **What user sees:** The "Mark complete" button shows a brief error state ("Couldn't save — tap to retry") for 3 seconds, then resets to its normal state. The session is NOT marked complete in the UI until the API confirms success.
- **No auto-retry on the client.** User must click again.

### E6 — `accept-recommendation` generation job fails
- **What user sees:** The placeholder "Generating…" card transitions to an error state: "Couldn't generate — try again" with a small "Retry" link.
- **Background:** The failed Inngest job is logged. No automatic retry (user controls retry).

### E7 — User navigates to `/dashboard/plan` with no topic interests
- **Redirect:** Server component checks `users.topic_interests`. If empty array or null, redirect to `/topics`.
- **User sees:** Instant redirect, no error page.

### E8 — `complete-session` called with already-completed session_id
- **API response:** `{ success: true }` (idempotent). The unique DB index prevents a duplicate row. No error surfaced.

---

## 9. Edge Cases

### EC-1 — User changes topics after plan approval
- The plan page server component computes `user_profile_hash` on every load and compares it to `curriculum_plans.user_profile_hash`.
- If hashes differ: mark the existing plan as `superseded_at = now()`, set `users.active_plan_id = null`, and trigger plan regeneration from scratch.
- **User experience:** They see the loading state again and receive a new plan. A toast: "Your topics changed — we're building a new plan."
- **Completed sessions are preserved** in `session_completions` (historical record). They are not retroactively credited to the new plan.

### EC-2 — User with only Free/Trial plan upgrades mid-journey
- On upgrade, the server detects `plan_tier` has changed.
- Existing approved plan (3 sessions) is retained.
- The shadow queue is generated asynchronously as a new Inngest job: `clio/queue.generate`.
- Next load of `/dashboard/plan` shows the full plan (up to 10 sessions) with newly generated queue sessions promoted into the visible plan.
- Recommendation section appears for the first time.

### EC-3 — Single topic, advanced maturity user
- The LLM generates a singleton arc. 5 sessions minimum. Sessions can reach `advanced` depth by session 3.
- The `role_hint` for each session escalates in sophistication: session 1 is framing/context, sessions 4–5 are practitioner-level challenges.

### EC-4 — Single topic, beginner maturity user
- Same singleton arc, 5 sessions minimum. Depth capped at `intermediate` for sessions 1–5.
- If the user's `ai_maturity` is `'no experience'` or `'beginner'`, all sessions are capped at `intermediate`. The LLM prompt enforces this via a constraint in the system prompt.

### EC-5 — Very large topic selection (7+ topics)
- The LLM must still produce a visible plan of at most 10 sessions. This means some topics will only appear in the shadow queue, not the visible plan.
- Rule: at least 1 session per selected topic must appear in the visible plan. If 7 topics are selected and the max is 10 visible, the LLM front-loads one session per topic (arc_position: 1) and queues the depth sessions.
- If topic count > 10, the LLM prioritises by relevance to the user's stated `worry` tag and `role`. Topics that don't make the visible plan still appear in the queue.

### EC-6 — Queue drops to 0 (fully promoted)
- System triggers async LLM call via Inngest to generate 20 additional queue sessions.
- The call uses the original user profile plus `session_completions` history as context.
- System prompt addition: "The user has already completed [list of session titles]. Do not repeat these. Generate the next logical 20 sessions in their learning journey."
- While regenerating: recommendation section shows "Loading more recommendations…" (if visible plan is also low).

### EC-7 — User completes all visible plan sessions with empty queue
- If queue is empty and all visible sessions are complete:
  - If EC-6 regeneration is in progress: show "Your plan is up to date — loading your next sessions…"
  - If regeneration fails: show a CTA to browse the catalog: "Explore more topics →" (links to `/topics`).

### EC-8 — Two completion events arrive simultaneously (race condition)
- The unique index on `session_completions` handles this. The second insert will fail with a unique constraint error. The API catches this and returns `{ success: true }` (treated as idempotent).
- Queue promotion is triggered only once per session completion (idempotency check: if `session_id` already exists in `session_completions`, skip promotion logic).

### EC-9 — Mobile viewport
- The session cards stack vertically. The arc header collapses to show arc name + session count.
- The "Recommended for you" section is below the session list (same on mobile; no horizontal scroll).
- No layout differences that require separate code paths.

### EC-10 — Executive tier: Clio voice mention
- When an Executive-tier user has a new recommendation ready, the Clio voice agent is instructed (via `role_hint` injection into the session system prompt) to proactively mention the recommended topic at the end of the current session.
- Example voice line: "Before we close — based on your governance work, I think you'd find 'AI Ethics & Responsible Use' really valuable next. Want me to add it to your plan?"
- This is implemented by passing `pending_recommendation_title` to the session system prompt builder. The voice agent script includes a conditional final statement if this value is non-null.
- **This is a minimal addition to the session prompt builder — not a separate UI feature.**

---

## 10. Out of Scope

The following are explicitly NOT part of this feature. Do not build them.

1. **Topic catalog changes** — the existing `topic_catalog` table and seeded topics are used as-is. No new topics, no topic editing, no re-categorisation.
2. **Topic selection UI changes** — the `/topics` page is unchanged. Users select topics exactly as they do today.
3. **Onboarding question changes** — the onboarding flow (`/onboarding`) is unchanged.
4. **Session content generation** — this feature defines the curriculum structure (titles, arcs, sequences, role_hints). The actual session content (script, slides, voice) is generated by the existing session content pipeline. The `role_hint` field in the curriculum output is the integration point: it is passed to the content generator as additional context.
5. **Email/SMS delivery of recommendations** — recommendations appear only on the `/dashboard/plan` page in this feature. Email/SMS surfacing is a future feature.
6. **Social or collaborative features** — no sharing, no peer comparison, no cohorts.
7. **Manual session re-ordering by the user** — the visible plan order is fixed (set by the LLM and the progression engine). Users cannot drag-and-drop sessions.
8. **Editing a session's title or focus** — users cannot modify session metadata.
9. **Arc merging/splitting UI** — users cannot reorganise arcs.
10. **Analytics/reporting dashboard** — session completion metrics, recommendation acceptance rates, and queue depth are logged but not exposed in a UI in this feature.
11. **Push notifications for queue promotions** — no browser push or mobile push.
12. **Offline support** — requires network connection throughout.

---

## 11. Open Questions

None — all questions answered below.

**Q1 — LLM output schema**
Answered in full in Section 6 (Data Requirements). The exact Zod schema is defined. All fields, types, required/optional status, and validation rules are specified. The schema covers both visible session definitions and queue entries. The `queue_rationale` field is required for `is_visible: false` entries and must be null for `is_visible: true` entries.

**Q2 — Arc vs. integrated path decision criteria**
The LLM system prompt must include the following explicit classification rules:

*Rule 1 — Domain/strategy topics → separate arc, arc_type: "domain"*
Topics that are primarily about governance, ethics, policy, risk, or regulatory frameworks get their own arc. They are standalone knowledge domains that cannot be understood by reference to tool usage. They require sequential depth.
Examples:
- "AI Governance" → separate domain arc (4 sessions: foundations → risk frameworks → regulatory landscape → board communication)
- "AI Ethics & Responsible Use" → separate domain arc (3 sessions: ethical frameworks → bias identification → practitioner decision-making)
- "AI Regulation & Compliance" → separate domain arc (3–4 sessions: EU AI Act → US regulations → compliance operationalisation → board reporting)
- "AI Strategy for Executives" → separate domain arc (5 sessions: strategic posture → ambition setting → roadmap → board alignment → competitive positioning)
- "AI Competitive Intelligence" → separate domain arc (4 sessions: landscape scan → intelligence systems → strategic interpretation → decision frameworks)

*Rule 2 — Tool/product topics → integrated arc, arc_type: "integrated"*
Topics about specific tools, platforms, or workflows are woven together because they share context and complement each other. A user learning Claude for Work and Microsoft Copilot is learning about the same meta-skill (AI tool adoption in the workplace) expressed through two products. Siloing them creates redundancy.
Examples:
- "Claude for Work" + "ChatGPT for Executives" → integrated arc called "AI Tools for Executive Work" (sessions cover: choosing the right tool → prompting for strategic output → use cases by function → governance of tool use → building team habits around AI tools)
- "AI in Operations" + "AI in Supply Chain" → integrated arc called "Operational AI in Practice" (sessions weave both domains together with shared frameworks)
- "AI in HR" + "Workforce AI" → integrated arc called "People and AI" (HR applications + workforce transition covered jointly)
- "Prompt Engineering" + "Getting Value from AI Tools" → integrated arc called "Working Effectively with AI" (practical skills integrated throughout)
- "Agentic AI Basics" + "AI Automation" → integrated arc called "Autonomous AI at Work" (concepts introduced together because they describe the same emerging paradigm)

*Rule 3 — Process/workflow topics → conditional*
If 2+ process topics are selected that overlap the same functional area (e.g., two operational AI topics), integrate them. If only 1 process topic is selected and it is standalone, it gets its own arc (which may have only 2–3 sessions if depth is limited).
Example: "AI in Finance" selected alone by a CFO → standalone arc. "AI in Finance" + "AI in Operations" selected → integrated arc called "AI Across the Business" with finance-specific and operations-specific sessions interwoven.

*Rule 4 — Foundational topics → integrated, front-loaded*
Topics like "Generative AI Fundamentals", "How LLMs Work", "ML Basics" are injected as the opening sessions of an integrated "Foundations" arc only if the user's AI maturity is "beginner" or "no experience". For intermediate+ users, these are not included unless explicitly selected.
Example: A beginner user who selects "AI Governance" → plan begins with a 2-session "Foundations" intro before the governance arc starts.

*Rule 5 — Singleton handling*
When the user selects only one topic, the LLM generates a full arc for that topic regardless of arc type. The arc_type is set to "singleton". Session count: minimum 5, maximum 8. Structure: intro → core concepts → role application → challenge/advanced → capstone (what's next).

**Q3 — Visible plan vs. shadow queue split**
The visible plan is populated using the following algorithm (executed by the LLM, not application code):

1. **Guarantee at least 1 session per topic** in the visible plan. For each selected topic, arc_position 1 is always `is_visible: true`.
2. **Fill the visible plan to N sessions**, where N = tier limit (3 for Free/Trial, 5 for Starter, 10 for Pro/Executive), using topological arc order: arc_position 1 sessions first, then arc_position 2 sessions, etc. Earlier arcs (higher priority given the user's profile) fill first.
3. **All remaining sessions** (`arc_position > 1` sessions that did not fit within N) are `is_visible: false` and enter the shadow queue.
4. **Breadth expansion sessions** (sessions for topics NOT explicitly selected by the user, added by the LLM for adjacent learning) are always `is_visible: false` in the initial plan. They enter the queue first and can be promoted or surfaced as recommendations.

Edge case: if the user selected 7 topics and N=10, the LLM puts session 1 of each arc into the visible plan (7 sessions), then fills the remaining 3 visible slots from arc_position 2 of the 3 highest-priority arcs.

**Q4 — Progression trigger rules**
Two triggers, both must be handled:

*Trigger A — Event-based (preferred, immediate)*
When `POST /api/curriculum/complete-session` is called: after recording the completion, count the number of sessions in `visible_sessions` where `session_id` is NOT in `session_completions`. If this count is < 3, promote sessions from `queue_sessions` until the count reaches 5 (or until the queue is empty). Promoted sessions are moved from `queue_sessions` to `visible_sessions` in the `curriculum_plans` row.

*Trigger B — Cron-based (safety net)*
Daily Inngest job at 08:00 UTC: query all `curriculum_plans` rows where `is_approved = true` and `superseded_at IS NULL`. For each, compute incomplete visible sessions. If < 3, trigger promotion. This catches cases where Trigger A failed silently (e.g., network error on client-side completion call).

*Promotion selection algorithm:* Sessions are promoted from the queue in order of their existing position in `queue_sessions`. The queue is pre-sorted by the LLM (arc-coherent order) and maintained in that order unless the recommendation engine reranks.

**Q5 — Recommendation surface UX**
- **Position:** Below the session list on `/dashboard/plan`, in a clearly bordered section titled "Recommended for you".
- **Maximum visible:** 2 cards simultaneously (Pro/Executive); 1 card (Starter); 0 cards / section hidden (Free/Trial).
- **Recommendation source:** Sessions in `queue_sessions` where `queue_rationale` is non-null AND `session_id` is not in `dismissed_recs` AND arc_position is 1 (first session of that arc only — we recommend starting an arc, not jumping to session 3). Ranked by `queue_rationale` relevance to current completion history (LLM pre-ranks; no additional ranking algorithm required in V1).
- **Dismiss behaviour:** Permanent. The `session_id` is added to `curriculum_plans.dismissed_recs`. The dismissed session is never surfaced as a recommendation again for this user and this plan. If the dismissed session is later promoted by the engine, it appears in the plan list without the "New" badge but does not cause a re-display in the recommendation section.
- **Accept flow:** (1) API call. (2) Immediate placeholder shown. (3) Inngest job generates full session content (or at minimum, validates the session definition is complete enough for scheduling). (4) Placeholder replaced when job completes. Polling interval: 5s via `GET /api/curriculum/plan` with `?check_generating=true`.

**Q6 — Subscription tier gating**
Exact differences by tier:

| Feature | Free / Trial | Starter | Pro | Executive |
|---|---|---|---|---|
| Visible plan sessions | 3 | 5 | 10 | 10 |
| Shadow queue sessions | 0 | 10 | 50 | 50 |
| Recommendations shown | 0 | 1 | 2 | 2 |
| Upgrade CTA banner | Yes | No | No | No |
| Queue regeneration | No | Yes (when queue < 5) | Yes (when queue < 5) | Yes (when queue < 5) |
| Voice recommendation mention | No | No | No | Yes |

*Implementation note:* Tier gating is enforced server-side in `POST /api/curriculum/generate`. The LLM is instructed with the correct N for visible and queue in the prompt based on `users.plan_tier`. The client reads the plan as-is; there is no client-side gating logic.

**Q7 — Single-topic edge case**
A singleton arc always has a minimum of 5 sessions and a maximum of 8 sessions total (visible + queued). The structure is fixed as follows:

- Session 1 (visible): "Introducing [Topic] — Why It Matters for Executives" — depth: beginner, 15–20 min
- Session 2 (visible): "Core Concepts in [Topic]" — depth: beginner/intermediate, 20–25 min
- Session 3 (visible, if tier allows): "[Topic] in Practice — [Role-specific application]" — depth: intermediate, 20–25 min
- Session 4 (visible for Pro+, queued for Starter): "Advanced [Topic]: [Role-specific challenge]" — depth: intermediate/advanced, 25–30 min
- Session 5 (queued for all tiers initially): "What's Next: Beyond [Topic]" — capstone + adjacent topics, 20–25 min
- Sessions 6–8 (queued): breadth expansions into adjacent topics

**Depth cap by maturity:**
- `beginner` / `no experience`: depth capped at `intermediate` for all sessions in the plan.
- `intermediate` / `some experience`: depth capped at `advanced` from session 3 onwards.
- `advanced` / `expert`: no depth cap; can reach `advanced` from session 2.

The maturity depth cap is enforced in the LLM system prompt as a hard constraint: "Never assign depth_level 'advanced' to any session for a user with ai_maturity 'beginner' or 'no experience'."

**Q8 — Session completion definition**
A session is "completed" when either of the following occurs:

1. **Explicit completion:** User clicks a "Mark complete" button displayed at the bottom of the session page (after the session content is fully rendered). This sends `method: 'explicit'`.
2. **Time threshold completion:** The session page tracks time-on-page in a `useEffect` using `setInterval` (1-second tick). When the accumulated time reaches 240 seconds (4 minutes), a completion is automatically fired with `method: 'time_threshold'`. The timer pauses when the browser tab loses focus (`document.visibilityState === 'hidden'`) and resumes when focus returns. This prevents background-tab completions.

Both methods are equally valid for the purposes of the progression engine. There is no UX difference in how a time-threshold completion is displayed (it is shown as "Completed" with a green CheckCircle, same as explicit).

The 4-minute threshold is chosen because:
- Shortest sessions are 15 minutes of listening/reading. 4 minutes represents ~25% engagement — enough to signal genuine intent.
- It prevents completions from accidental page visits or page refreshes.
- It is shorter than the full session to allow users who understand the material quickly to progress without being forced to click a button.

**Q9 — Shadow queue regeneration**
Queue regeneration triggers when `queue_sessions` count drops below 5 (from promotions). The trigger is checked:
- After each successful `complete-session` call (server-side count check).
- In the daily cron job (Trigger B above).

When triggered, an Inngest event `clio/queue.regenerate` is emitted with `{ user_id, plan_id }`. The corresponding Inngest function:
1. Fetches the user profile and completion history (last 30 `session_completions`).
2. Calls the LLM with a modified prompt: "The user has completed [list]. Generate 20 new queue sessions that logically follow their journey. Do not repeat completed topics. Return the same JSON schema as before but only queue sessions (all is_visible: false)."
3. Appends the new sessions to `curriculum_plans.queue_sessions` (does not replace existing queue, appends to end).
4. Retry: 3 attempts, exponential backoff. On total failure: log error, no user-facing impact (they simply see no new recommendations until the next daily cron retry).

This always requires an LLM call — there is no rule-based extrapolation that would be sufficiently intelligent for this product.

**Q10 — Failure mode handling**
Three failure modes, each handled differently:

*Mode A — LLM call fails or times out (all retries exhausted):*
System falls back to `buildCurriculum(topic_interests, ai_maturity)` from `lib/content/curriculum.ts`. The fallback plan is wrapped in a single default arc named "Your Learning Path" (arc_type: "singleton"). All sessions are marked `is_visible: true`. No shadow queue is generated. The plan is saved to `curriculum_plans` with a `fallback: true` flag on `raw_llm_output` (`{ fallback: true, reason: string }`). The user sees the plan normally — they are not shown an error state. A toast is shown for 6 seconds: "We're still building your personalised plan — it'll be ready shortly."

The Inngest job schedules one additional retry 10 minutes later. If that succeeds: the fallback plan is superseded (new row in `curriculum_plans`, `users.active_plan_id` updated), and the next time the user loads the page they see the real plan. If it fails again: no further automatic retries. The fallback plan remains active.

*Mode B — LLM returns malformed JSON (Zod parse failure):*
Identical treatment to Mode A. The raw malformed response is logged to server console with a truncated preview (first 500 chars). Never logged to a user-facing location. The fallback plan is generated.

*Mode C — LLM returns valid JSON but fails business rules (e.g., total_visible > tier limit, duplicate session_ids):*
The API catches Zod validation failure and treats as Mode B. It does NOT attempt to "repair" the LLM output (this would introduce unpredictable behaviour). Falls back to `buildCurriculum()`.

---

## 12. Dependencies

The following must be true before development begins:

### Must exist (already built)
- `users` table in Supabase with columns: `id`, `plan_tier`, `ai_maturity`, `topic_interests`, `plan_approved`
- `lib/content/curriculum.ts` — `buildCurriculum()` function (fallback, already implemented)
- `POST /api/plan/approve` route (already implemented; no changes required)
- `/dashboard/plan` page with `PlanClient.tsx` (already exists; will be heavily modified)
- Clerk auth middleware (already implemented)
- `@anthropic-ai/sdk` installed and `ANTHROPIC_API_KEY` in environment
- Inngest client and function registration (`app/api/inngest/route.ts`) already configured
- Session page (`/dashboard/session/[id]` or equivalent) — the "Mark complete" button must be added to this page as part of this feature

### Must be created as part of this feature (new)
- `curriculum_plans` table (migration)
- `session_completions` table (migration)
- `users.active_plan_id` column (migration)
- `POST /api/curriculum/generate` route
- `GET /api/curriculum/plan` route
- `POST /api/curriculum/complete-session` route
- `POST /api/curriculum/dismiss-recommendation` route
- `POST /api/curriculum/accept-recommendation` route
- Inngest function: `clio/queue.regenerate`
- Inngest function: `clio/recommendation.accepted` (handles async session generation on accept)
- Inngest daily cron: queue promotion safety net (08:00 UTC)
- Updated `PlanClient.tsx` with all 5 states and the "Recommended for you" section
- New component: `ArcSection.tsx` — arc grouping container with collapsible header
- New component: `SessionCard.tsx` — individual session card with status, start CTA, depth badge
- New component: `RecommendationCard.tsx` — recommendation with accept/dismiss actions
- New component: `PlanSkeleton.tsx` — loading state with animated skeleton cards
- Updated `app/dashboard/plan/page.tsx` — server component must check for existing plan, call generate if absent, pass plan data as server-side prop

### Data that must be seeded
- None. The curriculum uses `users.topic_interests` (already set during onboarding) and calls the LLM dynamically. No new seed data required.

### Environment variables required
- `ANTHROPIC_API_KEY` — must be set (already required by existing content pipeline)
- `INNGEST_EVENT_KEY` — already required by existing Inngest setup

---

*RD-004 | Author: Business Analyst Agent | Date: 2026-05-31 | Status: CEO APPROVED — ready for developer build*
*Based on Feature Brief: FB-004 | All 10 CEO questions answered in Section 11*
