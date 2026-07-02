# SES-01 — Session Architecture Redesign: DB Session as the Unit of Truth
# Requirement Document

Version: 1.1
Status: READY FOR CEO APPROVAL — all open questions resolved 2026-06-10
Author: Business Analyst Agent
Date: 2026-06-10

---

## Scope

This document covers six interdependent feature areas that must ship together as a coordinated release:

| ID | Area |
|---|---|
| SESS-01 | Content cache re-keying: `topic_content_cache.topic_id` → DB session UUID |
| SESS-02 | Content pipeline trigger: fires on `distill/session.designer.completed`, not at `plan/approve` |
| SESS-03 | Schedule route fix: UPDATE `scheduled_at` only — delete + re-insert removed |
| SESS-04 | Plan screen redesign: 10 DB sessions grouped under Topic and Arc headers |
| SESS-05 | KB restructure: 10 entries, one per DB session, scoped to that session's subtopics |
| TITLE-01 | Three-level title hierarchy enforcement: Arc → Topic → Session |

---

## 1. Purpose

Clio currently maintains two conflicting models of a "session": the **curriculum session** (5 planning units, 30 minutes each) and the **DB session** (10 delivery units, 15 minutes each). The session designer correctly splits curriculum sessions into DB sessions, but every downstream system — content cache, Knowledge Base, plan screen, schedule route, and title display — continues to treat the curriculum session as the canonical record.

This produces four concrete failures that users experience today:

1. Sessions 1a and 1b show identical content because they share the same `topic_content_cache` key (`curriculum_session_id`). The user attending Session 1a sees subtopics that belong to Session 1b.
2. The Knowledge Base shows 5 entries instead of 10. A user who completed Session 1a has no dedicated KB article for it — their learning record is blurred with Session 1b's material.
3. Content generates at `plan/approve` before the session designer has written subtopics to the DB session rows, producing content against an empty or incorrect subtopic list. This is the documented root cause of the visualisation fallback bug.
4. The schedule route deletes all scheduled sessions and re-inserts shell rows that carry no `curriculum_session_id`, `curriculum_plan_id`, or `subtopics`. Every downstream pipeline that reads those fields breaks silently.

Without this fix, every new user who approves a plan and schedules sessions will encounter all four of these failures. The product cannot be trusted to deliver personalised learning content correctly.

This redesign makes the DB session — once finalised by the session designer — the single unit of record for all downstream systems. The curriculum session becomes a planning artifact that has no user-visible presence after the DB sessions are created.

---

## 2. User Story

**Story 1 — Learner reviewing their plan**
As a learner who has approved a curriculum plan,
I want to see all 10 of my individual 15-minute sessions listed on my plan screen with their specific titles,
So that I understand exactly what I will learn in each session and can track which ones are completed vs. upcoming.

**Story 2 — Learner reviewing the Knowledge Base**
As a learner who has completed a session,
I want the Knowledge Base to show one entry per session I have attended, containing only the material from that session,
So that I can review exactly what I covered in Session 1a without seeing Session 1b's content mixed in.

**Story 3 — System (content pipeline)**
As the content pipeline,
I want to receive the confirmed subtopic list for a DB session only after the session designer has finalised it,
So that content I generate is scoped to the correct subtopics and will never generate against an empty or incorrect list.

**Story 4 — System (schedule route)**
As the schedule route handler,
I want to update only the `scheduled_at` field of an existing session row,
So that metadata fields (`curriculum_session_id`, `curriculum_plan_id`, `subtopics`) are never destroyed by a reschedule action.

---

## 3. Trigger / Entry Point

### SESS-03 — Schedule route (entry point for the data safety fix)

- **Route:** `POST /api/sessions/schedule`
- **Trigger:** Called by the frontend when a user sets or changes session dates in the schedule setup flow (SCH-01 spec)
- **Current behaviour:** Deletes all rows with `status = 'scheduled'` then re-inserts shell rows
- **New behaviour:** For each session in the request body, executes `UPDATE sessions SET scheduled_at = $1 WHERE user_id = $2 AND session_index = $3`. No rows are deleted. No rows are inserted.
- **User state required:** Authenticated (Clerk session), has an approved curriculum plan

### SESS-02 — Content pipeline trigger (entry point for content generation)

- **Trigger:** Inngest event `distill/session.designer.completed` emitted once per DB session after the session designer writes `session_title` and `subtopics` to that session row
- **Consumer:** Inngest function that runs `distill/session.content.generate` for the given session
- **Replaces:** The `inngest.send({ name: 'distill/session.content.generate' })` call currently in `app/api/plan/approve/route.ts` (lines 132–142) and the equivalent call in `app/api/sessions/schedule/route.ts` (lines 118–135)
- **User state required:** Not user-triggered; fires automatically after session designer completes

### SESS-04 — Plan screen (entry point for the UI change)

- **Route:** `/dashboard/plan`
- **Trigger:** Page load by authenticated user with an approved plan
- **User state required:** Authenticated (Clerk session), `users.plan_approved = true`

### SESS-05 — Knowledge Base (entry point for the KB change)

- **Index route:** `/dashboard/kb` or the current KB index path
- **Detail route:** `/dashboard/kb/[sessionId]` where `sessionId` is the DB session UUID
- **Trigger:** Page load by authenticated user
- **User state required:** Authenticated (Clerk session)

### SESS-01 — Content cache re-keying (entry point for the migration)

- **Trigger:** One-time migration script run against production Supabase immediately before the code deploy (see Section 12 — Dependencies for sequencing)
- **No user-visible trigger:** This is a backend data operation

### TITLE-01 — Title hierarchy (cross-cutting enforcement)

- **Applies to:** All routes and components that read or display session, topic, or arc titles
- **Entry points:** `/dashboard/plan`, `/dashboard/kb`, `/dashboard/sessions`, email templates, calendar invite generation
- **Trigger:** Passive enforcement — no new trigger; this is a constraint on how existing triggers behave

---

## 4. Screen / Flow Description

### 4A. SESS-04 — Plan Screen States

The plan screen at `/dashboard/plan` has four distinct states depending on pipeline progress.

---

**State 1: Plan approved, session designer has not yet run for any topic**

This state exists in the window between `plan/approve` completing and the session designer's first Inngest job completing. Duration is typically under 2 minutes.

What the user sees:
- Page heading: "Your Learning Plan" in white, 24px semibold
- Arc header (Level 1): Arc name from `curriculum_plans.visible_sessions[].arc_name`, displayed as a section label in `#94A3B8`, 12px uppercase tracking-widest
- Below the arc header: 5 Topic group blocks, one per curriculum topic
- Each Topic group block contains:
  - Topic title (Level 2) from `curriculum_plans.visible_sessions[].title` in white, 16px semibold, left-aligned
  - Below the topic title: 2 skeleton session rows. Each skeleton row is:
    - A 240px wide grey animated shimmer bar (`#1A1A1A` background, pulse animation) representing a session title placeholder
    - A 80px wide grey shimmer bar representing a status badge placeholder
    - Row height: 48px, `#111111` background, `#222222` border-bottom
    - No text, no buttons, no click targets
  - A grey chip label "Preparing sessions..." in `#475569`, 12px, below the two skeleton rows

The user takes no action on this screen. It auto-refreshes every 15 seconds (polling `GET /api/sessions` which returns sessions for the user). When the session designer completes for a topic, that topic's skeleton rows are replaced with real session rows (State 2 or State 3 applies per-topic from that point forward).

---

**State 2: Session designer has completed for some topics, not all (partial)**

For topics where the session designer has completed:
- The 2 skeleton rows are replaced with 2 real session rows (see State 3 format)

For topics where the session designer has not yet completed:
- The skeleton rows remain as described in State 1

The "Preparing sessions..." chip remains only on topic blocks still in skeleton state.

---

**State 3: Session designer has completed for all topics — all 10 sessions fully formed**

This is the steady-state view. The user sees all 10 sessions.

Layout hierarchy (top to bottom):

```
Arc header: "Anthropic Claude for Work"   [grey label, uppercase, 12px]
│
├── Topic: "Introducing Claude for Work — Why It Matters for a Technology Leader"
│   [white, 16px semibold — NOT a clickable item, it is a grouping label]
│   │
│   ├── Session row: "Claude in Financial Services: Safety Architecture, Deployment Models..."
│   │   [48px tall row, white session title 14px, status badge right-aligned]
│   │
│   └── Session row: "From First Use to Strategic Advantage: Building an AI-Forward Practice"
│       [48px tall row, white session title 14px, status badge right-aligned]
│
├── Topic: "How Claude Works — Core Mechanisms..."
│   │
│   ├── Session row: [session title from sessions.session_title]
│   └── Session row: [session title from sessions.session_title]
│
(repeats for all 5 topics)
```

Each session row contains:
- Left: Session title text from `sessions.session_title`. Font: white, 14px, regular weight. Truncated with ellipsis if longer than the available width (approximately 400px on desktop). The full title is visible on hover via a native `title` attribute (browser tooltip). No custom tooltip component.
- Right: A status badge. Badge text and colour by `sessions.status`:
  - `completed` → badge text "Completed", background `#10B981` (green), text white, 10px, rounded-full, px-2 py-0.5
  - `scheduled` → badge text showing the scheduled date formatted as "Jun 11", background `#1A1A1A`, text `#94A3B8`, 10px, rounded-full, px-2 py-0.5
  - `active` → badge text "In Progress", background `#7C3AED` (purple), text white, 10px, rounded-full, px-2 py-0.5

The Topic grouping header (Level 2) is NOT collapsible. It is always expanded. Topic groups are separated from one another by 24px vertical spacing. Sessions within a topic are separated by a 1px `#222222` border-bottom between rows.

The Arc header (Level 1) is NOT collapsible. It is always visible as a section label above the first topic in that arc. If there is only one arc (current state), only one arc header appears.

There is no "remove the 5-card layout" transition. The plan screen has always shown data from the `sessions` table (State 3 is the only non-loading state). The old curriculum-topic card layout is removed entirely as part of this spec. State 3 is the fully built view; States 1 and 2 are loading states.

---

**State 4: Content not yet ready for a session row (content_status != 'ready')**

Sessions in the fully formed plan (State 3) may have `content_status = 'pending'` or `'generating'` while the content pipeline runs. This does NOT change the session row appearance. The session row always shows the title and status badge regardless of `content_status`. The plan screen is not responsible for showing content readiness — that is the KB's concern.

---

### 4B. SESS-05 — Knowledge Base States

**KB Index — State 1: No sessions have content ready yet**

The KB index page shows:
- Page heading: "Knowledge Base" in white, 24px semibold
- Below the heading: grey body text "Your Knowledge Base will populate as you complete sessions." in `#94A3B8`, 16px
- No cards, no list items, no placeholders for individual sessions
- This state applies when zero sessions have `content_status = 'ready'`

---

**KB Index — State 2: Some sessions have content ready (mixed state)**

The KB index shows:
- Page heading: "Knowledge Base" in white, 24px semibold
- A list of session entries, one per DB session that has `content_status = 'ready'`
- Sessions with `content_status != 'ready'` are NOT shown on the KB index (they are hidden, not shown as "coming soon")
- Sessions appear in ascending `session_index` order

Each KB index entry is a clickable card with:
- Background: `#111111`, border: 1px `#222222`, border-radius: 8px, padding: 16px, full width
- Top-left: Session title from `sessions.session_title` in white, 14px semibold
- Below the title: A short subtitle line showing the count of subtopics: "3 topics covered" in `#94A3B8`, 12px (count = number of entries in `sessions.subtopics` array)
- Top-right: A "Completed" badge in green (`#10B981`) if `sessions.status = 'completed'`, or a date badge in grey if the session has not been attended yet but content is already ready (this can occur if content pipeline ran ahead of the session date)
- The entire card is a link to `/dashboard/kb/[sessions.id]`

Cards are vertically stacked with 12px gap between them.

---

**KB Detail — State 1: Valid session, content ready**

Route: `/dashboard/kb/[sessionId]`

The page shows:
- Back link: "← Knowledge Base" in `#94A3B8`, 13px, links back to KB index
- Page heading: The full `sessions.session_title` value in white, 24px semibold, no truncation
- Below the heading: Topic grouping label from the parent curriculum topic (`curriculum_plans.visible_sessions[].title` where `curriculum_session_id` matches). Display format: "Part of: [Topic title]" in `#475569`, 13px italic
- Below that: Arc label from `curriculum_plans.visible_sessions[].arc_name`. Display format: "Arc: [Arc name]" in `#475569`, 13px italic
- Content sections: One section per entry in `sessions.subtopics`. For each subtopic slug, fetch the corresponding `topic_content_cache` row WHERE `topic_id = sessions.id AND subtopic = [slug]`. Render the content from that cache row using the existing KB content rendering component.
- If a subtopic has no cache row (content for that individual subtopic is missing): show the subtopic slug as a heading with body text "Content for this subtopic is still being prepared." in `#475569`, 13px. Do not show an error.

---

**KB Detail — State 2: Session exists with a title, but content_status != 'ready'**

A user may reach this URL if:
- They navigate directly to a URL they bookmarked
- They click a link from an email or another page that pointed to this session before content was ready

The page shows:
- Back link: "← Knowledge Base" in `#94A3B8`, 13px
- Page heading: The full `sessions.session_title` value in white, 24px semibold (title is available from the session row even if content is not ready)
- Below the heading: A single informational block with background `#111111`, border `#222222`, border-radius 8px, padding 24px:
  - Icon: a clock or hourglass icon (Lucide `Clock` component) in `#475569`, 24px
  - Heading below icon: "Content is being prepared" in white, 16px semibold
  - Body text: "This session's Knowledge Base content will be available shortly after your content is generated. Check back in a few minutes." in `#94A3B8`, 14px
- No error state, no 404. The page is fully reachable and shows a graceful loading message.

---

**KB Detail — State 3: sessionId does not exist in the sessions table**

Returns a 404 page (using Next.js `notFound()`). The existing 404 page handling applies. No custom messaging required.

---

### 4C. SESS-02 — Content Pipeline Flow (no user-visible screen)

This is a backend flow. No user screen is involved. The sequence is:

1. Session designer completes for a DB session (writes `session_title` and `subtopics` to the `sessions` table row)
2. Session designer emits Inngest event: `distill/session.designer.completed` (payload defined in Section 6)
3. Inngest function consumer receives the event
4. Consumer checks: does `topic_content_cache` already have rows WHERE `topic_id = sessions.id`?
   - If yes AND `sessions.content_status = 'ready'`: skip (do not regenerate). Log: `[content-pipeline] Session [id] already complete — skipping.`
   - If yes AND `sessions.content_status != 'ready'`: this is a partial/failed prior run. Proceed with generation (overwrite).
   - If no rows exist: proceed with generation.
5. Consumer calls content generation for each subtopic in `sessions.subtopics`, writing each result to `topic_content_cache` with `topic_id = sessions.id`
6. On completion: update `sessions.content_status = 'ready'`

The `distill/session.content.generate` Inngest send in `app/api/plan/approve/route.ts` (lines 120–145) is removed entirely. The equivalent send in `app/api/sessions/schedule/route.ts` (lines 118–134) is also removed entirely.

---

### 4D. SESS-03 — Schedule Route Change (no user-visible screen change)

The `POST /api/sessions/schedule` handler currently:
1. Deletes all rows with `status = 'scheduled'`
2. Re-inserts shell rows without `curriculum_session_id`, `curriculum_plan_id`, or `subtopics`

The new handler:
1. Receives the same request body shape (no change to the Zod schema or request contract)
2. For each session in `parsed.data.sessions`: executes an UPDATE on the `sessions` table setting only `scheduled_at` where `user_id = userId AND session_index = s.sessionIndex`
3. Does NOT insert any rows
4. Does NOT delete any rows
5. The confirmation email and SMS logic remains — it still reads `sessions` table data after the update and sends the same notifications

The `indexToId` map currently built from inserted rows must be rebuilt from a SELECT after the updates:

```
SELECT id, session_index FROM sessions
WHERE user_id = $userId AND session_index IN ($sessionIndexes)
```

This replaces the current `insertedRows` map construction. The email/SMS sending logic downstream is otherwise unchanged.

The `distill/session.scheduled` Inngest events (lines 98–113) that are currently fired after insert are also removed. Under the new model, visual spec pre-generation is triggered by `session.designer.completed`, not by scheduling.

**Validation guard:** Before updating, the handler must verify that the target session row exists and has `status = 'scheduled'`. If a session with the given `session_index` does not exist for this user, or has `status` other than `'scheduled'`, that session is skipped (not an error — log a warning and continue). This prevents the route from silently updating a `completed` or `active` session's `scheduled_at`.

---

### 4E. SESS-01 — Content Cache Re-keying Migration

This is a one-time data migration with no user-visible screen. It runs against production Supabase before code deploy. Details in Section 6 (Data Requirements) and Section 12 (Dependencies).

---

### 4F. TITLE-01 — Title Hierarchy Enforcement

No new screen. This is a constraint applied across all existing screens and templates.

The three-level hierarchy is:

| Level | Field | Source | Owner | Immutable after set? |
|---|---|---|---|---|
| Arc (Level 1) | `curriculum_plans.visible_sessions[].arc_name` | Curriculum engine | Curriculum engine | Yes |
| Topic (Level 2) | `curriculum_plans.visible_sessions[].title` | Curriculum engine | Curriculum engine | Yes |
| Session (Level 3) | `sessions.session_title` | Session designer | Session designer | Yes (with one exception — see below) |

**Session title write-once rule:** Once the session designer writes `session_title` to a `sessions` row (i.e. the row transitions from having a null/empty `session_title` to having a value), no application code may overwrite it. The only permitted re-write of `session_title` is by the session designer itself re-running for a session where `content_status != 'ready'` (a failed prior design run). If `content_status = 'ready'`, the session designer must not re-run for that session.

**Enforcement mechanism:** Application-level guard only (no DB trigger in this release). The session designer function checks `sessions.session_title IS NOT NULL AND sessions.content_status = 'ready'` before writing. If both conditions are true, it skips that session without error. A DB-level write constraint (e.g. a trigger preventing updates to `session_title` when `content_status = 'ready'`) is explicitly out of scope for this release (see Section 10).

**What "TITLE-01 compliant" means for each consumer:**

- `app/api/plan/approve/route.ts`: Reads session titles from `sessions.session_title` when displaying plan data. Must not pass a `title` field from `curriculum_plans.visible_sessions[].title` as the session title anywhere that renders individual sessions.
- `app/api/sessions/schedule/route.ts`: The request body currently accepts a `title` field per session (line 12 of schedule route Zod schema). Under TITLE-01, this field MUST NOT be used to overwrite `sessions.session_title`. The field may remain in the schema for downstream reads (e.g. email) but the UPDATE statement must not include `session_title`.
- Email templates: All email references to "session name" must read `sessions.session_title`. They must not use the topic title as a session name.
- Calendar invite title (if applicable): Must use `sessions.session_title`.
- KB entry title: Must use `sessions.session_title` (enforced by SESS-05).
- Plan screen session rows: Must read `sessions.session_title` (enforced by SESS-04).

---

## 5. Visual Examples

### State 1: Plan screen — session designer not yet run (skeleton state)

```
┌──────────────────────────────────────────────────────────────────┐
│  Your Learning Plan                                              │
│                                                                  │
│  ANTHROPIC CLAUDE FOR WORK                              [grey]   │
│                                                                  │
│  Introducing Claude for Work — Why It Matters...        [white]  │
│  ├── [████████████████████████████]  [████████]   [shimmer]      │
│  └── [████████████████████████████]  [████████]   [shimmer]      │
│      Preparing sessions...                              [grey]   │
│                                                                  │
│  How Claude Works — Core Mechanisms...                  [white]  │
│  ├── [████████████████████████████]  [████████]   [shimmer]      │
│  └── [████████████████████████████]  [████████]   [shimmer]      │
│      Preparing sessions...                              [grey]   │
│                                                                  │
│  (3 more topic blocks with skeleton rows)                        │
└──────────────────────────────────────────────────────────────────┘
```

---

### State 2: Plan screen — all sessions ready (steady state)

```
┌──────────────────────────────────────────────────────────────────┐
│  Your Learning Plan                                              │
│                                                                  │
│  ANTHROPIC CLAUDE FOR WORK                              [grey]   │
│                                                                  │
│  Introducing Claude for Work — Why It Matters for a             │
│  Technology Leader                                      [white]  │
│  ├── Claude in Financial Services: Safety Architecture...        │
│  │                                              [Completed] [green]│
│  └── From First Use to Strategic Advantage...                    │
│                                              [Jun 11]    [grey]  │
│                                                                  │
│  How Claude Works — Core Mechanisms...                  [white]  │
│  ├── How Claude Works — Core Mechanisms: Part 1                  │
│  │                                              [Completed] [green]│
│  └── Claude in Your Enterprise: Data Boundaries...               │
│                                              [Jun 12]    [grey]  │
│                                                                  │
│  (3 more topic groups with their 2 sessions each)                │
└──────────────────────────────────────────────────────────────────┘
```

---

### State 3: KB Index — sessions with content ready

```
┌──────────────────────────────────────────────────────────────────┐
│  Knowledge Base                                                  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Claude in Financial Services: Safety Architecture...       │  │
│  │ 4 topics covered                          [Completed] [green] │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ How Claude Works — Core Mechanisms: Part 1                 │  │
│  │ 5 topics covered                          [Completed] [green] │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  (additional entries for sessions with content_status = 'ready') │
└──────────────────────────────────────────────────────────────────┘
```

---

### State 4: KB Index — no content ready yet

```
┌──────────────────────────────────────────────────────────────────┐
│  Knowledge Base                                                  │
│                                                                  │
│  Your Knowledge Base will populate as you complete sessions.     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

### State 5: KB Detail — content ready

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Knowledge Base                                      [grey]    │
│                                                                  │
│  Claude in Financial Services: Safety Architecture,              │
│  Deployment Models and Use Case Prioritisation         [white]   │
│                                                                  │
│  Part of: Introducing Claude for Work — Why It Matters [muted]   │
│  Arc: Anthropic Claude for Work                        [muted]   │
│                                                                  │
│  ─────────────────────────────────────────────────────────────   │
│  [Subtopic 1 heading]                                            │
│  [Subtopic 1 content rendered by existing KB component]          │
│                                                                  │
│  [Subtopic 2 heading]                                            │
│  [Subtopic 2 content]                                            │
│                                                                  │
│  (repeats for each subtopic in sessions.subtopics)               │
└──────────────────────────────────────────────────────────────────┘
```

---

### State 6: KB Detail — content not yet ready

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Knowledge Base                                      [grey]    │
│                                                                  │
│  From First Use to Strategic Advantage: Building an              │
│  AI-Forward Practice                                   [white]   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │                                                         │     │
│  │            [Clock icon]  24px, #475569                  │     │
│  │                                                         │     │
│  │  Content is being prepared                   [white]    │     │
│  │                                                         │     │
│  │  This session's Knowledge Base content will be          │     │
│  │  available shortly after your content is generated.     │     │
│  │  Check back in a few minutes.                [#94A3B8]  │     │
│  │                                                         │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

### 6A. Tables read

**`sessions` table — fields read by this spec:**
- `id` (UUID) — the new content cache key; the KB URL segment
- `user_id`
- `session_index` (integer) — determines sort order in plan screen and KB index
- `session_title` (text) — the Level 3 title, owned by session designer
- `subtopics` (text[] or jsonb array of slug strings) — the content boundary for this session
- `curriculum_session_id` (text) — used only to look up the parent topic/arc from `curriculum_plans`
- `curriculum_plan_id` (UUID) — used to scope queries to the active plan
- `status` (text: `draft` | `scheduled` | `active` | `completed`)
- `content_status` (text: `pending` | `generating` | `ready` | `error`) — drives plan screen and KB visibility logic
- `scheduled_at` (timestamptz) — the only field the schedule route may update

**`curriculum_plans` table — fields read:**
- `id` (UUID)
- `visible_sessions` (jsonb array) — each element contains `arc_name`, `title` (topic title), `session_id` (curriculum session ID)

**`topic_content_cache` table — fields read:**
- `topic_id` (text) — after migration, this is the DB session UUID for new rows, and must match `sessions.id`
- `subtopic` (text) — slug of the individual subtopic
- Content fields (whatever columns the current KB rendering component reads — developer to confirm column names from existing implementation)

### 6B. Tables written

**SESS-03 — Schedule route update:**
- Table: `sessions`
- Fields written: `scheduled_at` only
- Condition: `user_id = $userId AND session_index = $sessionIndex AND status = 'scheduled'`
- Trigger: `POST /api/sessions/schedule` request

**SESS-02 — Content pipeline writes:**
- Table: `topic_content_cache`
- Fields written: `topic_id` (set to `sessions.id` UUID), `subtopic`, and all content fields
- Trigger: `distill/session.designer.completed` Inngest event
- Table: `sessions`
- Fields written: `content_status` → `'ready'` on completion, `'generating'` at start, `'error'` on failure
- Trigger: same Inngest event consumer

**SESS-01 — Migration writes:**
- Table: `topic_content_cache`
- Fields written: `topic_id` (updated from curriculum_session_id string to DB session UUID)
- Trigger: one-time migration script
- Specific rows: the 2 completed sessions (UUIDs confirmed in Section 11 — Open Questions Q10)

### 6C. Event contract — `distill/session.designer.completed`

**Emitter:** Session designer Inngest function, after writing `session_title` and `subtopics` to a DB session row

**Frequency:** One event per DB session. When the session designer processes one curriculum topic (which produces 2 DB sessions), it emits 2 separate events — one per DB session. The two events are emitted sequentially after each session row is written, not batched. This means content for Session 1a and Session 1b generates in parallel (two independent Inngest function invocations run concurrently).

**Payload shape:**
```typescript
{
  name: 'distill/session.designer.completed',
  data: {
    sessionId: string,       // sessions.id (UUID)
    userId: string,          // sessions.user_id
    sessionIndex: number,    // sessions.session_index
    subtopics: string[],     // sessions.subtopics (array of slug strings)
    sessionTitle: string,    // sessions.session_title (for logging/tracing)
    curriculumSessionId: string, // sessions.curriculum_session_id (for audit)
  }
}
```

**Consumer:** A new Inngest function registered as `distill/session.content.generate.v2` (or the existing `distill/session.content.generate` handler updated to read from the payload's `subtopics` array rather than looking up the curriculum session). Developer to confirm the function name used in existing code and update accordingly.

**What the consumer does with the payload:**
- Uses `sessionId` as the `topic_id` key when writing to `topic_content_cache`
- Uses `subtopics` as the list of subtopics to generate content for
- Does NOT query `curriculum_plans` or use `curriculumSessionId` for content generation (only for audit logging)

### 6D. Idempotency rule (SESS-02)

If the `distill/session.designer.completed` event is received for a session that already has `content_status = 'ready'`:
- The content pipeline function logs: `[content-pipeline] Session [sessionId] already complete — skipping duplicate event.`
- Returns immediately without calling the content generation LLM
- Does NOT overwrite existing `topic_content_cache` rows

If the event is received for a session with `content_status = 'generating'` (a prior run is still in progress):
- The content pipeline function logs a warning and returns without starting a second concurrent generation
- The in-flight generation will complete and mark the session ready

If the event is received for a session with `content_status = 'pending'` or `'error'`:
- Proceed with generation normally

### 6E. Cron retry definition (SESS-02)

The existing hourly cron that currently fires content generation for sessions 2–N is repurposed as a retry-only mechanism.

**Definition of a "stale" session:** A session is stale if ALL of the following are true:
- `sessions.content_status != 'ready'`
- The session designer has completed for it: `sessions.session_title IS NOT NULL AND sessions.subtopics IS NOT NULL AND array_length(sessions.subtopics, 1) > 0`
- More than 2 hours have elapsed since the session row was last updated (`sessions.updated_at < NOW() - INTERVAL '2 hours'`)

**What cron does when it finds a stale session:**
- Emits `distill/session.content.generate` event for that session (same payload shape as the event consumer expects)
- Logs: `[cron] Stale session found: [sessionId] — re-triggering content generation.`

**What cron does NOT do:**
- Does NOT fire for sessions that have no subtopics (session designer has not run yet)
- Does NOT fire for sessions with `content_status = 'ready'`
- Does NOT fire for sessions where the session designer has not yet written a title (first-fire is the session designer's job only)

### 6F. SESS-01 Migration — finalized script

**Q10 RESOLVED 2026-06-10.** Production data confirmed. The migration covers 4 cases, not 2.

**Confirmed DB session UUIDs (from production Supabase):**

| session_index | sessions.id | curriculum_session_id | status |
|---|---|---|---|
| 1 | `ead3a7ce-d4c4-4039-957e-7c6654dcc2b1` | `claude-for-work-s1` | completed |
| 3 | `58ab5cec-9915-47e3-a789-40282d9d660e` | `claude-for-work-s2` | completed |

**Additional finding from production audit:** The cache contains content under 4 more non-UUID keys that were not anticipated by the design document:

| topic_id in cache | Root cause | Action |
|---|---|---|
| `claude-for-work-s3` | Pre-generated by old cron before session designer ran; DB session has `curriculum_session_id = NULL` (wiped by schedule route bug) | DELETE — new pipeline regenerates under DB UUID |
| `enabling-team-ai-s1` | Same root cause | DELETE |
| `enabling-team-ai-s2` | Same root cause | DELETE |
| `` (empty string) | 3 rows: `core-concepts`, `key-takeaways`, `real-world-application` — generic fallback subtopics generated today with no topic context | DELETE — orphaned garbage |

**Finalized migration SQL (ready to run):**

```sql
-- SESS-01 Migration: Re-key topic_content_cache to DB session UUIDs
-- Run BEFORE the SESS-01 code deploy. Confirm 0 errors before deploying code.
-- 2026-06-10

BEGIN;

-- Step 1: Re-key completed session index 1 (preserves user's learning content)
UPDATE topic_content_cache
SET topic_id = 'ead3a7ce-d4c4-4039-957e-7c6654dcc2b1'
WHERE topic_id = 'claude-for-work-s1';

-- Step 2: Re-key completed session index 3 (preserves user's learning content)
UPDATE topic_content_cache
SET topic_id = '58ab5cec-9915-47e3-a789-40282d9d660e'
WHERE topic_id = 'claude-for-work-s2';

-- Step 3: Delete pre-generated content for scheduled sessions whose curriculum_session_id
-- was wiped by the schedule route bug. DB sessions have no curriculum_session_id to map from.
-- The new architecture will regenerate this content under DB session UUIDs.
DELETE FROM topic_content_cache
WHERE topic_id IN ('claude-for-work-s3', 'enabling-team-ai-s1', 'enabling-team-ai-s2');

-- Step 4: Delete orphaned rows with empty topic_id (generic fallback content, no user value)
DELETE FROM topic_content_cache
WHERE topic_id = '';

COMMIT;
```

**Verification queries (run after migration, before code deploy):**

```sql
-- Should return 0 rows — no old curriculum keys remain
SELECT COUNT(*), topic_id
FROM topic_content_cache
WHERE topic_id IN (
  'claude-for-work-s1', 'claude-for-work-s2', 'claude-for-work-s3',
  'enabling-team-ai-s1', 'enabling-team-ai-s2', ''
)
GROUP BY topic_id;

-- Should show rows for the 2 re-keyed completed sessions
SELECT topic_id, COUNT(*) as row_count
FROM topic_content_cache
WHERE topic_id IN (
  'ead3a7ce-d4c4-4039-957e-7c6654dcc2b1',
  '58ab5cec-9915-47e3-a789-40282d9d660e'
)
GROUP BY topic_id;
```

**Migration type:** One-time script run manually against production Supabase by the developer via the Supabase SQL editor or `psql`. Wrapped in a transaction so it rolls back fully on any error.

**Timing:** Run BEFORE the SESS-01 code deploy. The deploy must not land before the script completes and both verification queries pass.

---

## 7. Success Criteria (Acceptance Tests)

### SESS-03 — Schedule route fix

✓ Given a user with 10 sessions (2 completed, 8 scheduled), when `POST /api/sessions/schedule` is called with 8 session entries, then the 8 scheduled sessions have their `scheduled_at` fields updated and no rows are deleted from the `sessions` table.

✓ Given a user with 10 sessions, when `POST /api/sessions/schedule` is called, then the `curriculum_session_id`, `curriculum_plan_id`, and `subtopics` fields on every `sessions` row are identical before and after the call.

✓ Given a user with a completed session at `session_index = 1`, when `POST /api/sessions/schedule` is called with a payload that includes `sessionIndex = 1`, then the `sessions` row at index 1 is NOT modified (its `scheduled_at` remains unchanged and its status remains `completed`).

✓ Given a `POST /api/sessions/schedule` request for a `session_index` that does not exist in the `sessions` table for this user, then that session index is skipped with a warning log and the response still returns `{ success: true }` for the sessions that did update.

✓ Given a valid `POST /api/sessions/schedule` request, then the sessions confirmation email is sent to the user with the updated session dates.

### SESS-02 — Content pipeline trigger

✓ Given a session where the session designer has written `session_title` and `subtopics` and emitted `distill/session.designer.completed`, when the Inngest consumer processes the event, then `topic_content_cache` rows are written with `topic_id = sessions.id` (UUID) for each subtopic in `sessions.subtopics`.

✓ Given `plan/approve` is called, then NO `distill/session.content.generate` event is emitted from `plan/approve` and NO content generation begins at that moment.

✓ Given a session with `content_status = 'ready'`, when `distill/session.designer.completed` is received again for the same session, then no content generation LLM call is made and the existing cache rows are not overwritten.

✓ Given the hourly cron runs and finds a session where `session_title IS NOT NULL` and `subtopics` is non-empty and `content_status != 'ready'` and `updated_at < NOW() - INTERVAL '2 hours'`, then the cron emits a content generation retry event for that session.

✓ Given the hourly cron runs and finds a session where `subtopics` is null or empty (session designer has not run), then the cron does NOT emit a content generation event for that session.

### SESS-01 — Content cache re-keying

✓ Given the migration script has run, when the KB detail page for the completed session at index 1 is loaded, then the page shows content from `topic_content_cache` rows where `topic_id = sessions.id` (UUID) for that session.

✓ Given the migration script has run, then no `topic_content_cache` rows exist with `topic_id` equal to the old curriculum session ID strings for the 2 migrated sessions.

✓ Given a new session completes content generation after the code deploy, then its `topic_content_cache` rows have `topic_id` equal to the DB session UUID, not a curriculum session ID string.

### SESS-04 — Plan screen

✓ Given a user whose plan is approved but session designer has not run, when the plan screen loads, then the plan screen shows Topic grouping labels with 2 skeleton shimmer rows per topic and the text "Preparing sessions..." below each topic group.

✓ Given a user whose session designer has completed for all 10 sessions, when the plan screen loads, then the plan screen shows exactly 10 session rows with titles from `sessions.session_title` and status badges from `sessions.status`.

✓ Given a completed session at index 1 with `sessions.status = 'completed'`, when the plan screen loads, then that session row shows a green "Completed" badge.

✓ Given a scheduled session with `scheduled_at = '2026-06-11T09:00:00Z'`, when the plan screen loads, then that session row shows a grey "Jun 11" badge.

✓ Given the plan screen is polling every 15 seconds and the session designer completes for 2 sessions during that window, when the next poll fires, then those 2 sessions' skeleton rows are replaced with real session rows without a full page reload.

✓ Given a plan with 5 curriculum topics each producing 2 DB sessions, when the plan screen renders in steady state, then Topic grouping labels (Level 2) appear above each pair of sessions and the Arc header (Level 1) appears above all topics for that arc. No collapsible toggle exists.

### SESS-05 — KB restructure

✓ Given a user with 2 sessions at `content_status = 'ready'` and 8 at `content_status = 'pending'`, when the KB index loads, then exactly 2 KB cards are shown.

✓ Given a KB card is clicked for a session at index 1, when the KB detail page loads at `/dashboard/kb/[sessions.id]`, then the page heading shows the value of `sessions.session_title` for that session (not the curriculum topic title).

✓ Given the KB detail page for session at index 1, when the content sections render, then each section corresponds to one subtopic from `sessions.subtopics` for that session only, and no subtopics from the sibling session (index 2) appear.

✓ Given a user navigates directly to `/dashboard/kb/[uuid]` where the session exists but `content_status != 'ready'`, then the page renders the "Content is being prepared" state with the session title in the heading and no 404 error.

✓ Given a user navigates to `/dashboard/kb/[invalid-uuid]`, then the page returns a 404.

✓ Given 0 sessions with `content_status = 'ready'`, when the KB index loads, then the page shows only the "Your Knowledge Base will populate as you complete sessions." message and no session cards.

### TITLE-01 — Title hierarchy

✓ Given any plan screen session row, when inspected, then the title text equals `sessions.session_title` from the DB (not the `title` field from the schedule request body or the curriculum plan topic title).

✓ Given any KB entry, when the entry title is inspected, then it equals `sessions.session_title` from the DB.

✓ Given the session designer re-runs for a session where `content_status = 'ready'`, then `sessions.session_title` is NOT overwritten.

✓ Given the schedule route updates `scheduled_at` for a session, then `sessions.session_title` is identical before and after the update (the schedule route does not write to `session_title`).

---

## 8. Error States

### SESS-03 — Schedule route

**UPDATE fails (database error):** Return `{ error: 'Failed to update session schedule' }` with HTTP 500. Log the error with the session indexes that failed. Do not partially apply — if any UPDATE fails, return an error. The client (schedule setup UI) should show a generic "Something went wrong. Please try again." message.

**No sessions were updated (all indexes not found):** Return `{ success: true, count: 0 }` with HTTP 200. Log a warning: `[schedule] No sessions updated — session indexes not found for user [userId]`. This is not an error; it can occur if a user retries a stale request.

**Request body validation fails:** Return `{ error: 'Validation failed', details: ... }` with HTTP 400. The Zod schema is unchanged from the current implementation.

**Auth fails:** Return 401. Unchanged from current implementation.

### SESS-02 — Content pipeline

**LLM call fails for a subtopic:** Mark `sessions.content_status = 'error'`. Log the error. Do NOT mark other subtopics as failed. The cron will retry the session after 2 hours.

**Session not found when event is received:** Log error: `[content-pipeline] Session [sessionId] not found — event may be stale.` Return without error (Inngest should not retry a not-found session indefinitely). Do not throw.

**`subtopics` array is empty in the event payload:** Log warning: `[content-pipeline] Session [sessionId] has empty subtopics — skipping.` Return without error. This should not happen under the new model (session designer never emits the event with empty subtopics), but must be guarded.

### SESS-04 — Plan screen

**API call to fetch sessions fails on load:** Show an inline error message below the page heading: "Unable to load sessions. Please refresh the page." in `#EF4444`, 13px. Do not show skeleton rows or partial data.

**Polling fails (15-second interval):** Continue polling silently. If 3 consecutive polls fail, stop polling and show: "Session data may be out of date. Refresh to see the latest." in `#94A3B8`, 12px, below the page heading.

### SESS-05 — KB index

**API call to fetch sessions fails on load:** Show inline error: "Unable to load Knowledge Base. Please refresh the page." in `#EF4444`, 13px, below the heading. No cards are shown.

### SESS-05 — KB detail

**Fetch for session row fails:** Show an error state with heading "Something went wrong" and body "Unable to load this Knowledge Base entry. Please refresh or go back." in standard error styling (`#EF4444` heading). Include the "← Knowledge Base" back link.

**Individual subtopic content missing from cache:** Do not show an error for the page. Show per-subtopic: the subtopic slug as a heading, and body text "Content for this subtopic is still being prepared." in `#475569`, 13px. The rest of the subtopics with content render normally.

---

## 9. Edge Cases

### SESS-03 — Schedule route

**User reschedules before session designer has run:** The schedule route updates `scheduled_at` only. Session rows exist (created by `plan/approve`) but have no `subtopics` yet. The UPDATE succeeds — only `scheduled_at` changes. No content generation is triggered by the schedule route under the new model. This is safe.

**User reschedules a session that is currently `active` (in progress):** The validation guard (Section 4D) skips sessions with `status != 'scheduled'`. An active session's `scheduled_at` is not updated. The response still returns `{ success: true }` for the sessions that did update.

**User calls the schedule route twice rapidly (duplicate request):** The second call's UPDATEs will simply set the same `scheduled_at` values again. Idempotent by nature of UPDATE. No harm.

### SESS-02 — Content pipeline

**Session designer runs twice for the same session (e.g. due to Inngest retry):** Two `distill/session.designer.completed` events are emitted. The second event hits the idempotency check: if `content_status = 'ready'`, skip. If `content_status = 'generating'` (first run still in flight), skip with a warning log.

**Session designer runs for Topic 1 (producing Session 1a and Session 1b) and emits two events simultaneously:** Both events are consumed in parallel by two independent Inngest function invocations. Content for Session 1a and Session 1b generates concurrently. There is no shared mutable state between the two invocations at the DB level (each writes to different `sessions.id` and different `topic_content_cache` rows). This is safe.

**Session date is in the past when content generates:** Content generation does not check session date. It generates regardless. This is intentional — the user may be catching up on a past session.

### SESS-04 — Plan screen

**Session designer completes for some topics but not others during the 15-second poll window:** The plan screen shows a mixed state (State 2 in Section 4A). Some topic groups show real session rows; others show skeletons. This is expected and the UI handles it per-topic-group.

**User has only 1 DB session per curriculum topic (e.g. 15-minute topics not split):** The plan screen renders 1 session row per topic group instead of 2. The layout handles variable session count within a topic group — it is not hardcoded to exactly 2.

**Arc header is empty or null:** The Arc header line is omitted if `arc_name` is null or empty string. Topics render without the arc label above them. This should not occur for well-formed plans but must not crash.

**All 10 sessions are completed:** All session rows show green "Completed" badges. No other change to the plan screen layout.

### SESS-05 — KB

**User bookmarks a KB detail URL and returns after a new plan replaces the session:** The old session UUID may no longer exist in `sessions`. The page returns 404 via `notFound()`. This is correct behaviour — the old KB entry is no longer valid.

**A session has a very long `session_title` (over 100 characters):** The KB detail page heading renders the full title with word-wrap (no truncation on the detail page). The KB index card truncates with ellipsis and uses a native `title` attribute for the full string.

**The `subtopics` array on a session has zero entries when the KB detail page loads:** The page renders in State 1 layout (content ready) but with no content sections. Show a single line: "No subtopics are recorded for this session." in `#475569`, 13px. This should not occur in steady state but must not crash.

### SESS-01 — Migration

**Migration script runs but one of the curriculum_session_id values is wrong:** The UPDATE affects 0 rows (no match). The script logs the count of affected rows. The developer validates the count before concluding the migration is complete. If 0 rows are affected for a session, the old cache rows remain at the old key and the new KB code (which queries by `sessions.id`) will find no content, showing the "Content is being prepared" state. This is recoverable by re-running the script with the correct UUID.

**Migration runs while the old code is still live (race condition):** The old code queries `topic_content_cache` by `curriculum_session_id`. The migration changes those rows' `topic_id` to a UUID. After migration but before new code deploy, old code queries will find 0 rows and show empty KB entries. This is why migration must be followed immediately by code deploy (see Section 12 — deployment sequence). The window of exposure is the time between migration completion and code deploy going live (minutes at most with a coordinated deploy).

### TITLE-01

**Session designer is re-triggered for a session where `content_status = 'ready'` due to a bug or manual trigger:** The guard check (`session_title IS NOT NULL AND content_status = 'ready'` → skip) prevents overwrite. The existing title is preserved. A log entry is written: `[session-designer] Session [id] already complete — skipping title overwrite.`

---

## 10. Out of Scope

The following are explicitly NOT part of this spec. Developers must not implement these.

1. **DB-level write trigger on `session_title`** — enforcing title immutability via a Postgres trigger or column constraint is not in scope for this release. Application-level guard only.
2. **User-editable session titles** — users cannot rename sessions. There is no "edit session title" UI.
3. **Curriculum session display** — the curriculum session is never shown as a user-visible entity in any screen. There is no "curriculum session detail page" or "curriculum session card." If any such UI exists in the current codebase, it is not addressed here and remains unchanged (unless it conflicts with TITLE-01 — developer to flag if so).
4. **Collapsible arc or topic groups** — arc headers and topic group headers on the plan screen are always expanded. Collapsible behaviour is not in scope.
5. **Session reordering** — the plan screen is read-only. Users cannot drag to reorder sessions.
6. **KB search** — no search or filter functionality is added to the KB in this spec.
7. **KB pagination** — if there are 10+ KB entries, they are displayed as a flat scrollable list. No pagination.
8. **Email subject line changes** — email templates that reference session titles should be updated to read from `sessions.session_title` (TITLE-01) but the structure, design, or copy of existing email templates is not otherwise changed.
9. **Calendar invite changes** — calendar invite titles should read from `sessions.session_title` (TITLE-01) if calendar invites are currently being sent. No other changes to calendar integration.
10. **New `content_status` values** — the set of values (`pending`, `generating`, `ready`, `error`) is used as documented. No new status values are introduced.
11. **Session-level progress tracking or scoring** — AI Readiness Score calculation, streak counters, and feedback processing are unchanged.
12. **Multiple arc support** — the current user (Arun) has 1 arc. The plan screen handles the arc header as documented. Multi-arc edge cases (multiple arc headers) are handled by the layout rules in Section 4A but are not a primary test target for this release.

---

## 11. Open Questions

**None.**

All 16 questions from the CEO Feature Brief have been resolved. Q10 (production UUIDs) was answered by Arun on 2026-06-10 — see Section 6F for the finalized migration SQL. The document is ready for CEO approval and development can begin immediately.

---

## 12. Dependencies

### What must be true before development begins

1. **SESS-01 migration script is finalized** (Q10 resolved 2026-06-10 — see Section 6F). All work can begin immediately.
2. **Session designer code** must emit `distill/session.designer.completed` events (SESS-02 consumer is useless without the emitter). If the session designer does not currently emit this event, adding the emit is part of SESS-02's implementation scope.
3. **`sessions` table** must have the `content_status` column. If this column does not yet exist, a Supabase migration adding `content_status TEXT NOT NULL DEFAULT 'pending'` must run before SESS-04 and SESS-05 can be built.
4. **`sessions` table** must have the `curriculum_session_id` column. This is confirmed in the existing `plan/approve` code (line 97).

### Safe deployment sequence (mandatory — SESS-03 is a data-destruction risk)

Deploy in this exact order. Each step must be validated before the next begins.

**Step 1 — SESS-03 (deploy first, independently)**
Why: SESS-03 eliminates the data-destruction behaviour in the schedule route. Every day this ships later is a day a user can destroy session metadata by rescheduling. Ship this as a standalone PR. No other changes in this PR.

Rollback: Revert to the previous delete + re-insert logic. Risk is low provided no users have rescheduled between the new deploy and the rollback. If users have rescheduled after SESS-03 deploys, rollback will NOT delete those rows — it will just restore the old code path for future calls.

Validation: After deploy, trigger `POST /api/sessions/schedule` with a test payload and confirm via Supabase that no rows are deleted and `curriculum_session_id`, `curriculum_plan_id`, and `subtopics` are preserved on all existing session rows.

**Step 2 — SESS-02 (deploy second, independently)**
Why: Once SESS-02 is live, new content generation requests come from the `session.designer.completed` event, not from `plan/approve`. The plan/approve content generation call must be removed in this step. The cron is updated to retry-only logic.

Dependency: Requires the session designer to emit `distill/session.designer.completed` events. If the emitter is not in the session designer code yet, add it in this same PR.

Rollback: Re-add the `distill/session.content.generate` emit to `plan/approve` and restore the cron to its full fire-first behaviour.

Validation: Approve a test plan and confirm that no content generation Inngest event fires from `plan/approve`. Confirm that triggering the session designer manually emits `distill/session.designer.completed` and content begins generating.

**Step 3 — SESS-01 migration script (run against production before Step 4)**
Why: SESS-01 re-keys cache rows so the new KB code (which queries by `sessions.id` UUID) finds content for the 2 completed sessions. If migration runs after the new KB code deploys, there is a window where the KB shows empty content for completed sessions. Running migration first eliminates this window.

Requires: Q10 answered (UUIDs confirmed).

Validation: After script runs, query `topic_content_cache` and confirm `topic_id` values for the affected rows are UUIDs matching `sessions.id`, not curriculum session ID strings.

**Step 4 — SESS-01 + SESS-04 + SESS-05 + TITLE-01 (deploy together)**
Why: These four areas are visually and functionally interdependent. SESS-04 (plan screen) reads from `sessions` table data. SESS-05 (KB) queries `topic_content_cache` by `sessions.id`. TITLE-01 changes how titles are read across all screens. Deploying them together means the user sees a consistent state: plan screen shows DB sessions, KB shows per-session entries, all titles are consistent.

Rollback: Revert the frontend components and KB routes to their pre-spec state. The SESS-01 migration cannot be automatically rolled back (UPDATEs have already run). If rollback is necessary after Step 4, the KB will temporarily show empty entries for completed sessions (because old code queries by curriculum_session_id but rows now have UUID keys). Recovery: re-run the migration in reverse (UPDATE topic_content_cache SET topic_id = '[OLD_CURRICULUM_SESSION_ID]' WHERE topic_id = '[UUID]') and redeploy old code.

Validation: Load `/dashboard/plan` and confirm 10 session rows in correct grouping. Load `/dashboard/kb` and confirm 2 entries (for the 2 completed sessions). Click each KB entry and confirm content is scoped to that session's subtopics only.

---

*SES-01 Requirement Document v1.0 | Business Analyst Agent | 2026-06-10*
*Status: CEO REVIEW — pending Q10 answer from Arun before migration script can be finalised*
