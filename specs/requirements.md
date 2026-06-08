# Clio — Requirement Documents
All 8 Feature Briefs
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-06

---

# FB-001 — Sessions Created Without topic_id — Requirement Document

ID: FB-001
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-06

## 1. Purpose

Every Clio live session requires a non-null, non-empty `topic_id` to fetch pre-generated visuals, scripts, and KB content from `topic_content_cache`. When `topic_id` is null or empty string, the content pipeline substitutes the hardcoded fallback `'ai-fundamentals'`, causing sessions to show wrong content entirely unrelated to what the user booked. This fix closes the gap between `lib/sessions/planner.ts` (which already computes a topicId) and `app/api/sessions/schedule/route.ts` (which coerces any falsy value to null), ensuring every inserted `sessions` row has a non-null, non-empty `topic_id` and that the Inngest content generation events fire with the correct value.

## 2. User Story

As a Clio user who has approved a curriculum plan,
I want every session in my schedule to be stored with a correct topic identifier,
So that the content Clio delivers during my live session is genuinely about the topic I chose — not a generic fallback.

As a developer debugging the content pipeline,
I want to trace a single `topic_id` value from planner output through the API route to the database row and the Inngest event with no branching fallbacks,
So that I can verify at each layer what content will be served without ambiguity.

## 3. Trigger / Entry Point

- Triggered when: a user clicks "Confirm Schedule" or "Subscribe and Schedule Sessions" in `app/dashboard/schedule/ScheduleClient.tsx`.
- Route: `POST /api/sessions/schedule`
- Auth state required: authenticated Clerk user with a paid plan (or returning from Stripe with `?subscribed=1`).
- The fix is entirely server-side and in `lib/sessions/planner.ts`. No new user-visible screens or prompts are introduced.

## 4. Screen / Flow Description

This fix is invisible to the user. The schedule confirmation flow is unchanged. The changes are entirely in server-side code. The sequence after clicking "Confirm Schedule" is:

1. `ScheduleClient.tsx` calls `scheduleSessions(plan, prefs)` from `lib/sessions/planner.ts`. This returns a `ScheduledSession[]` array where every item has a `topicId` field.
2. **Fix applied here (Layer 1 — planner.ts):** The `topicId` derivation in `scheduleSessions` must guarantee a non-empty string for every session. The current logic is:
   ```
   topicId: primaryTopic?.id || session.title.toLowerCase().replace(...)
   ```
   The slug derivation can produce an empty string if `session.title` is empty or all-punctuation. The fix adds a final fallback so the result is always truthy: if the slug is still empty after derivation, use the string `'session-' + (i + 1)` as a last resort. This guarantee is enforced at the planner layer — not at the API layer.
3. `ScheduleClient.tsx` sends the array to `POST /api/sessions/schedule`.
4. **Fix applied here (Layer 2 — route.ts Zod schema):** Change `topicId: z.string().default('')` to `topicId: z.string().min(1)` in `ScheduledSessionSchema`. The API now rejects any payload where a session's `topicId` is empty string. This enforces the invariant at the API boundary and rejects any future client sending an empty topicId.
5. **Fix applied here (Layer 3 — route.ts insert):** Change `topic_id: s.topicId || null` to `topic_id: s.topicId`. Since the Zod schema already guarantees `topicId` is a non-empty string, the `|| null` fallback is removed entirely.
6. **Fix applied here (Layer 4 — Inngest filter):** The `distill/session.scheduled` filter `s.topicId && s.subtopics.length > 0` is changed to `s.topicId && s.subtopics.length > 0`. The subtopics check is intentional and remains: sessions without subtopics do not pre-generate visual specs because there is nothing to generate. This is confirmed correct behaviour (see Section 9 for edge case handling).
7. The `distill/session.content.generate` event for Session 1 already guards with `if (firstSessionId && firstSession?.topicId)`. With the guarantee from Layer 1, `firstSession.topicId` is always truthy, so content generation fires for every plan approval without exception.

**Data repair step (run once on deployment):**
Before deploying the code fix, a SQL migration runs to repair existing rows. See Section 6 for the exact SQL.

## 5. Visual Examples

This fix has no user-facing screen changes. No wireframes required.

## 6. Data Requirements

### Read
- `sessions` table: `id`, `topic_id`, `session_index`, `user_id` — read to build the index-to-uuid map.
- `users` table: `id`, `email`, `role`, `industry`, `ai_maturity`, `phone`, `twilio_number_assigned` — read for confirmation notifications.

### Written
- `sessions` table: `topic_id` column receives a non-null, non-empty string for every inserted row.

### Schema change
None required to `topic_content_cache`.

### Zod schema change
In `app/api/sessions/schedule/route.ts`, `ScheduledSessionSchema`:
- Change: `topicId: z.string().default('')`
- To: `topicId: z.string().min(1, 'topicId must be a non-empty string')`

This is a narrowing change. Payloads that currently send `topicId: ''` will now be rejected with HTTP 400. Since `lib/sessions/planner.ts` (the only client) will be fixed simultaneously to guarantee non-empty topicId, this narrowing is safe.

### Data repair SQL (migration file: `027_repair_topic_ids.sql`)

Run this BEFORE deploying the code fix so the repair uses the old coercive logic and the code fix takes over for new writes:

```sql
-- Step 1: Identify sessions with null or empty topic_id that have a non-null session_title.
-- Repair by deriving the same slug the planner would have produced.
UPDATE sessions
SET topic_id = lower(regexp_replace(
                 regexp_replace(session_title, '[^a-zA-Z0-9]+', '-', 'g'),
                 '-+$', '', 'g'
               ))
WHERE (topic_id IS NULL OR topic_id = '')
  AND session_title IS NOT NULL
  AND session_title != ''
  AND status = 'scheduled';

-- Step 2: Any remaining rows (no session_title) get a positional fallback.
UPDATE sessions
SET topic_id = 'session-' || session_index::text
WHERE (topic_id IS NULL OR topic_id = '')
  AND status = 'scheduled';

-- Step 3: Verify — should return 0 rows after repair.
SELECT COUNT(*) FROM sessions WHERE topic_id IS NULL OR topic_id = '';
```

Deployment order:
1. Apply `027_repair_topic_ids.sql` to production database.
2. Deploy code fix (planner.ts + route.ts changes).

### Inngest events
- `distill/session.scheduled` — emitted for sessions where `topicId` is truthy AND `subtopics.length > 0`. Sessions with no subtopics are excluded from visual pre-generation. This is intentional.
- `distill/session.content.generate` — emitted for Session 1 whenever `firstSession.topicId` is truthy. With the fix, this fires for every plan approval.

## 7. Success Criteria

Given a curriculum plan with 5 sessions where all sessions have titles but none map to catalog topic IDs,
When the user clicks "Confirm Schedule",
Then every row inserted into `sessions` has a non-null, non-empty `topic_id` equal to the kebab-slug derived from the session title.

Given a curriculum plan where Session 1 maps to a catalog topic with `primaryTopic.id = 'ai-governance'`,
When the user confirms the schedule,
Then the `topic_id` stored for Session 1 in `sessions` is `'ai-governance'` (not a derived slug) and the `distill/session.content.generate` Inngest event fires with `topicId: 'ai-governance'`.

Given the schedule API receives a payload where any session has `topicId: ''`,
When the Zod schema validates the payload,
Then the API returns HTTP 400 with `error: 'Validation failed'` and the sessions table is not modified.

Given the data repair SQL has been run and there are 0 rows with `topic_id IS NULL OR topic_id = ''`,
When the code fix is deployed and a new plan approval is submitted,
Then no new rows with null or empty `topic_id` are inserted.

Given a curriculum plan where Session 1's `topicId` is derived as `'introducing-ai-governance-for-executives'`,
When the plan is approved,
Then the `distill/session.content.generate` Inngest event for Session 1 includes `topicId: 'introducing-ai-governance-for-executives'` and the content pipeline stores content in `topic_content_cache` under that same key.

Given a session with a non-empty `topicId` but an empty `subtopics` array,
When plan approval fires Inngest events,
Then `distill/session.scheduled` is NOT emitted for that session (no visual pre-generation) but `distill/session.content.generate` IS emitted for Session 1 regardless of subtopics length.

Given the repair SQL runs and session_title is NULL for some rows with null topic_id,
When the repair runs,
Then those rows receive `topic_id = 'session-' || session_index` as the positional fallback.

## 8. Error States

### Zod validation failure (empty topicId from client)
- Condition: client sends `topicId: ''` for any session.
- Response: HTTP 400 `{ error: 'Validation failed', details: { ... } }`.
- User impact: none visible — this is a developer-facing error. The UI should never produce an empty topicId after the planner fix.

### Planner slug derivation produces empty string (edge case)
- Condition: session title is empty string or all non-alphanumeric characters.
- Handling: final fallback in planner assigns `'session-' + (i + 1)`. This is logged at `console.warn` level for developer visibility.

### Database insert fails (Supabase error)
- Condition: Supabase returns an error on insert.
- Response: HTTP 500 `{ error: 'Failed to save sessions' }`. Existing behaviour is preserved.

### Inngest emit fails
- Condition: `inngest.send()` rejects.
- Handling: caught with `.catch(console.error)`. Sessions are already inserted. The emit failure is logged but does not block the HTTP response.

## 9. Edge Cases

### Sessions with no subtopics
Sessions where `subtopics.length === 0` (e.g. sessions generated from the fallback planner that does not populate subtopics) are excluded from `distill/session.scheduled` pre-generation. This is correct: without subtopics there is nothing to pre-generate. These sessions will have content generated lazily when the session goes active.

### Session title with only punctuation or numbers
Title `"---"` slugifies to `''` after `replace(/-+$/, '')`. The final fallback `'session-' + (i + 1)` applies.

### Session title that is exactly 60 characters after slugification
The `.slice(0, 60)` cap is applied. The resulting slug is valid and non-empty.

### User re-approves plan (replaces schedule)
The route deletes existing `scheduled` sessions and re-inserts. The repair SQL is idempotent on completed/active sessions (it filters `status = 'scheduled'`). Re-approval produces fresh rows with correct topic_ids.

### Auto-scheduling after Stripe return (subscribedSuccess flow)
`ScheduleClient` reads pending sessions from `sessionStorage` and posts them. These sessions were built by `scheduleSessions()` before the Stripe redirect, so their topicIds were set at that point. After the fix, the planner guarantee applies at build time, so stored sessions are already correct.

## 10. Out of Scope

- Changes to `topic_content_cache` schema — not required for this fix.
- Changing the Inngest content pipeline logic — out of scope. The fix is only at the scheduling layer.
- Adding a UI indicator showing topic_id to users — out of scope.
- Repairing `completed` or `active` sessions with wrong topic_id — out of scope for this fix. Only `scheduled` rows with null/empty topic_id are repaired. Completed sessions have already been served; changing their topic_id retroactively would be a separate data integrity task.
- The subtopics-length filter on `distill/session.scheduled` — this is confirmed correct behaviour, not a bug.

## 11. Open Questions

None.

## 12. Dependencies

- None. This fix is self-contained.
- Deployment order: SQL migration `027_repair_topic_ids.sql` must run BEFORE the code deploy.

---

# FB-002 — Duplicate KB Entries — Requirement Document

ID: FB-002
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-06

## 1. Purpose

The Knowledge Base page (`/dashboard/kb`) currently shows two entries for the same session content: one with `topic_id = ''` (empty string) and one with `topic_id = 'ai-fundamentals'`, both with the same subtopic slugs. This happens because content generation fires twice for Session 1 — once with an empty topicId and once with the fallback value — and the unique constraint on `topic_content_cache` is keyed on `(topic_id, subtopic_slug)`, so both rows are distinct to the database. This feature removes the duplicate rows, adds a database-level idempotency guarantee, and ensures content generation fires exactly once per session per approval.

## 2. User Story

As a Clio user viewing my Knowledge Base,
I want to see exactly one entry per session topic I have studied,
So that my KB accurately represents what I have learned without confusion or inflated counts.

As a developer maintaining the content pipeline,
I want content generation to be idempotent at the database level,
So that an Inngest retry or any double-fire cannot produce a duplicate row regardless of application logic.

## 3. Trigger / Entry Point

- FB-002 is a downstream consequence of FB-001. The duplicate rows are caused by the `topic_id = ''` fire path that FB-001 eliminates.
- The database-level idempotency fix is applied to `topic_content_cache` as a schema change.
- The data cleanup SQL is a one-time migration.
- The code fix (preventing double-fire of `distill/session.content.generate` for Session 1) is in `app/api/sessions/schedule/route.ts`.

## 4. Screen / Flow Description

This fix is invisible to the user after the cleanup migration runs. The KB page will show one entry per session topic. No new user-visible screens.

### Content generation trigger path analysis

The following are all code paths that can emit `distill/session.content.generate` for Session 1:

**Path A (Primary):** `app/api/sessions/schedule/route.ts` — emits for Session 1 immediately after insert, guarded by `if (firstSessionId && firstSession?.topicId)`. Before the FB-001 fix, `firstSession.topicId` could be `''` (falsy), suppressing this path. After FB-001, this path always fires.

**Path B (Pre-generation):** Also in `route.ts` — the `planEvents` loop emits `distill/session.scheduled` (not `session.content.generate`) for sessions where `s.topicId && s.subtopics.length > 0`. `distill/session.scheduled` triggers visual pre-generation (a different Inngest function), not the full content pipeline. This is a distinct event and does not cause content duplication.

**Path C (Legacy/fallback):** Inspection of `session-content-pipeline.ts` shows that `topicId` is computed as `session.topic_id ?? session.curriculum_session_id ?? 'ai-fundamentals'` inside the pipeline itself. Before FB-001, when `session.topic_id` was `null`, the pipeline used `'ai-fundamentals'` as the effective key. The `distill/session.content.generate` event was being fired with `topicId: ''` from the route (which triggered the pipeline with empty string), and a separate fire with `topicId: 'ai-fundamentals'` came from the pipeline's internal fallback resolving to a different key. **This means Path A was firing with topicId='' AND the pipeline was internally resolving to 'ai-fundamentals', producing two distinct cache keys.**

After FB-001 fixes the route to send a real topicId and the pipeline's internal fallback resolves to that same topicId, Path A fires once with a real topicId, and the pipeline stores content under that key. No second fire occurs.

**Conclusion:** After FB-001, there is exactly one emission path for `distill/session.content.generate` for Session 1, and the topicId is consistent end-to-end. No additional code change is needed to prevent double-firing — FB-001 eliminates the condition that caused it.

The database-level idempotency fix is still required as a defence-in-depth measure against Inngest retries.

### Database-level idempotency

The `topic_content_cache` table already has `UNIQUE (topic_id, subtopic_slug)`. The content pipeline uses `.upsert(..., { onConflict: 'topic_id,subtopic_slug' })`. This means a retry of the same event (same topicId + subtopicSlug combination) will update the existing row rather than insert a duplicate. This is correct and the existing mechanism is sufficient once FB-001 ensures a consistent topicId.

The migration needed here is: verify and document that the unique constraint exists and is the authoritative deduplication key. No schema change to the constraint itself is required — it already exists (migration 009).

## 5. Visual Examples

No new screens. After the cleanup migration, the KB page shows one row per (topic_id, subtopic_slug) pair.

## 6. Data Requirements

### Existing unique constraint (confirmed from migration 009)
```sql
UNIQUE (topic_id, subtopic_slug)
```
This is the deduplication key. It is already present. No change required.

### Upsert behaviour (confirmed from session-content-pipeline.ts)
```typescript
.upsert({ ... }, { onConflict: 'topic_id,subtopic_slug' })
```
On conflict: the existing row is updated (not duplicated). This is correct idempotency behaviour.

### Data cleanup SQL (migration `028_cleanup_duplicate_kb_entries.sql`)

This must run AFTER `027_repair_topic_ids.sql` (FB-001) so that the sessions table already has correct topic_ids before we use them to determine which rows to keep.

```sql
-- Step 1: Identify duplicate subtopic_slug groups where one row has topic_id='' and
-- another has topic_id='ai-fundamentals'. Delete the '' row and the 'ai-fundamentals'
-- row, keeping only rows whose topic_id matches the session's actual topic_id.
--
-- Safe delete rule:
-- Delete any topic_content_cache row where topic_id = '' (these were generated with
-- a corrupt empty-string key and have no correct session to reference).
-- Delete any topic_content_cache row where topic_id = 'ai-fundamentals' AND a row
-- exists for the same subtopic_slug under a different (non-empty, non-'ai-fundamentals')
-- topic_id (these are fallback-keyed duplicates of correctly-keyed content).
-- Never delete rows where topic_id = 'ai-fundamentals' if no other row exists for that
-- subtopic_slug (these may be genuine ai-fundamentals content).

-- Step 1a: Delete rows with empty topic_id.
DELETE FROM topic_content_cache
WHERE topic_id = '';

-- Step 1b: Delete 'ai-fundamentals' fallback rows only where a correctly-keyed row
-- exists for the same subtopic_slug.
DELETE FROM topic_content_cache AS bad
WHERE bad.topic_id = 'ai-fundamentals'
  AND EXISTS (
    SELECT 1 FROM topic_content_cache AS good
    WHERE good.subtopic_slug = bad.subtopic_slug
      AND good.topic_id != 'ai-fundamentals'
      AND good.topic_id != ''
  );

-- Step 2: Verify — document the count before running (for sign-off).
-- Run this SELECT before the DELETE to confirm scope:
-- SELECT topic_id, subtopic_slug, COUNT(*) FROM topic_content_cache
-- GROUP BY topic_id, subtopic_slug HAVING COUNT(*) > 1;

-- Step 3: Confirm zero duplicates remain.
SELECT COUNT(*) FROM (
  SELECT topic_id, subtopic_slug, COUNT(*)
  FROM topic_content_cache
  GROUP BY topic_id, subtopic_slug
  HAVING COUNT(*) > 1
) dup;
-- Expected result: 0
```

**Safety guarantee:** This SQL never deletes a row where `topic_id = 'ai-fundamentals'` is the only row for that subtopic_slug. Genuine ai-fundamentals sessions (where the user actually selected that topic) are preserved.

### Deployment order
1. Apply `027_repair_topic_ids.sql` (FB-001).
2. Deploy FB-001 code fix.
3. Run the SELECT in Step 2 of the cleanup SQL above — capture the row count. Obtain sign-off before proceeding.
4. Apply `028_cleanup_duplicate_kb_entries.sql`.
5. Verify Step 3 returns 0.

## 7. Success Criteria

Given the cleanup migration has run,
When a developer queries `SELECT topic_id, subtopic_slug, COUNT(*) FROM topic_content_cache GROUP BY topic_id, subtopic_slug HAVING COUNT(*) > 1`,
Then the result is 0 rows.

Given a user approves a curriculum plan after FB-001 and FB-002 are deployed,
When `distill/session.content.generate` fires for Session 1,
Then exactly one row per subtopic_slug is inserted into `topic_content_cache` for that session's topicId.

Given the Inngest function for a session retries (e.g. transient Claude API error on attempt 1),
When the retry fires the same `distill/session.content.generate` event with the same topicId and subtopicSlugs,
Then the upsert updates the existing rows rather than inserting new ones, and the final row count is identical to a single successful run.

Given the cleanup migration deletes rows with `topic_id = ''`,
When a developer queries `SELECT COUNT(*) FROM topic_content_cache WHERE topic_id = ''`,
Then the result is 0.

Given a user whose sessions table has `topic_id = 'ai-fundamentals'` for a session that was genuinely about AI Fundamentals (no other subtopic_slug row exists),
When the cleanup migration runs,
Then that row is NOT deleted.

Given a user with a completed session (status = 'completed') whose KB entries are correctly keyed,
When the cleanup migration runs,
Then those rows are not touched.

Given the code fix (FB-001) is deployed and a new plan approval is submitted,
When a developer inspects `topic_content_cache` 5 minutes after approval,
Then all subtopic rows for Session 1 have the same non-empty, non-'ai-fundamentals' topic_id (unless ai-fundamentals is the genuine topic).

## 8. Error States

### Cleanup SQL deletes more rows than expected
- Condition: the SELECT in Step 2 returns more rows than anticipated.
- Handling: do not proceed with the DELETE. Escalate to engineering to review the row set manually before approving the delete.

### Upsert fails (Supabase constraint violation)
- Condition: a race between two parallel Inngest step runs for the same subtopic_slug.
- Handling: the `ON CONFLICT` clause makes the upsert atomic. A race cannot produce a duplicate. Supabase will serialise conflicting upserts on the unique index.

### Session 1 content generation fires before repair SQL runs
- Condition: code is deployed before migration 028 runs.
- Handling: new rows will be written with correct topicId (FB-001 is deployed first). Old duplicate rows remain until migration 028 runs. This is safe — the KB page may still show old duplicates until the migration runs, but no new duplicates are created.

## 9. Edge Cases

### User has no completed sessions
- The cleanup SQL only touches `topic_content_cache` rows — it does not reference session status. All rows with `topic_id = ''` are deleted regardless of whether a session is completed.

### topic_id = 'ai-fundamentals' is the genuine topic
- The cleanup SQL checks for the existence of a competing correctly-keyed row before deleting. If none exists, the 'ai-fundamentals' row is preserved.

### Multiple subtopic_slug values under topic_id = ''
- All are deleted by Step 1a. There is no legitimate use for an empty-string topic_id.

### Inngest retries after FB-001 is deployed but FB-002 migration is not yet run
- A retry inserts or upserts with the correct topicId. The old duplicate rows ('' and 'ai-fundamentals') remain and will be cleaned by migration 028 when it runs. No new duplicates are created.

## 10. Out of Scope

- Modifying the unique constraint on `topic_content_cache` — it already exists and is correct.
- Changing the Inngest function's retry behaviour — the existing retry count (2) is sufficient.
- Adding a user-facing duplicate detection notice on the KB page — not required.
- Repairing `topic_content_cache` rows for topics other than '' and 'ai-fundamentals' — not in scope.

## 11. Open Questions

None.

## 12. Dependencies

- FB-001 must be deployed before FB-002 migration runs.
- Deployment order is strictly: 027 SQL → FB-001 code → 028 SQL preview SELECT → sign-off → 028 SQL DELETE → verify.

---

# FB-003 — Google Meet Manual Link UX — Requirement Document

ID: FB-003
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-06

## 1. Purpose

The session scheduling flow currently attempts to auto-create a Google Meet link via the Google Calendar API but fails silently within an 8-second timeout. The user is left with no meeting link and no explanation. Per Arun's decision (Option B), the auto-creation code is removed entirely and replaced with a clean manual "paste your meeting link" UX. Every session card in the dashboard shows a clear call-to-action when the link is missing.

## 2. User Story

As a Clio user who has just scheduled sessions,
I want a clear prompt to add my own Google Meet link for each session,
So that I can join my Clio coaching session without having to figure out why no link appeared.

As a Clio user viewing my sessions dashboard,
I want to see a prominent "Add meeting link" input whenever a session has no link,
So that I can add or update my meeting link at any time before the session.

## 3. Trigger / Entry Point

- Route: `app/dashboard/sessions` — session cards display the "Add meeting link" CTA when `meeting_url` is null.
- Route: `app/api/sessions/schedule/route.ts` — Google Meet auto-creation code block (lines 78–106) is removed.
- Trigger for CTA: page load of `/dashboard/sessions` when any session row has `meeting_url IS NULL`.
- Auth state: authenticated Clerk user.

## 4. Screen / Flow Description

### State A — Session card: no meeting link

Each session card on `/dashboard/sessions` that has `meeting_url = null` shows:

- Session number badge (purple circle, e.g. "1"), white text, 28px × 28px.
- Session title: 15px, font-weight 600, white, truncated at 1 line.
- Scheduled date and time: 13px, `#475569`, formatted as "Mon 9 Jun · 9:00 am".
- Duration: 13px, `#475569`, e.g. "30 min".
- Status badge: "scheduled" — small pill, `#1A1A1A` background, `#475569` text, `#222222` border.
- Below the session metadata: a text input labelled "Meeting link" with:
  - Label: 12px, `#94A3B8`, font-weight 500, text "Meeting link", displayed above the input.
  - Input: full width of the card content area, `#111111` background, `#222222` border, 1px, `#FFFFFF` text, 13px font, border-radius 10px, height 38px, padding 10px horizontal, placeholder text `https://meet.google.com/...`, `#475569` placeholder colour.
  - On focus: border changes to `#7C3AED`, transition 150ms.
  - To the right of the input: a button labelled "Save" — solid `#7C3AED` background, white text, 13px, font-weight 600, border-radius 10px, height 38px, padding 0 16px.
- No separate "Add meeting link" CTA button separate from the inline input — the input with Save button is the primary affordance.

### State B — Session card: has meeting link

- All session metadata displayed as in State A.
- Below metadata: a row showing:
  - Link icon (Lucide `Link` component, 13px, `#06B6D4`).
  - Meeting URL displayed as a truncated anchor link, `#06B6D4`, 13px, max-width fills remaining space, truncated with ellipsis. Clicking opens the URL in a new tab (`target="_blank"`).
  - An "Edit" text button to the right: 12px, `#475569`, hover `#94A3B8`. Clicking replaces the display row with the input (State A input) pre-populated with the current URL.

### State C — Saving meeting link (loading)

- The "Save" button text is replaced with a Lucide `Loader` icon (13px, `animate-spin` Tailwind class), `#FFFFFF`.
- The input is disabled (opacity 60%, cursor not-allowed).
- Duration: until the PATCH API call resolves.

### State D — Save success

- The card immediately transitions from State A/C to State B, showing the newly saved URL as a link.
- No toast or banner. The inline state change is the confirmation.

### State E — Save error

- Below the input, a 12px error message appears: `#EF4444` text, "Couldn't save the link. Please try again."
- The Save button returns to its default state.
- The input retains its current value.

### Confirmation email (no meeting link)

The `sendSessionsConfirmedEmail` function in `lib/delivery/email.ts` currently sends session details. When no `meeting_url` exists for any session (which is now always the case at schedule time), the email body must NOT contain a "Join meeting" link. Instead it must contain the text:

> "Add your meeting link in your Clio dashboard before your first session: [dashboard URL]/dashboard/sessions"

The exact copy is: "Your sessions are confirmed. Add your Google Meet link in your dashboard so you're ready to join."

### Google Calendar integration code removal

- Remove the entire block from `app/api/sessions/schedule/route.ts` lines 78–106 (the `meetTimeout` function and the `Promise.all` that calls `createGoogleMeetEvent`).
- Do NOT delete `lib/google-calendar.ts` — it is preserved for future use (calendar invite feature).
- Remove the import of `createGoogleMeetEvent` from `route.ts`.
- The `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, and `GOOGLE_CALENDAR_ID` environment variables remain in `.env.local.example` with PLACEHOLDER values — they are not removed, as the file is used by the future Calendar invite feature.

### New API endpoint: `PATCH /api/sessions/[sessionId]/meeting-url`

- Auth: Clerk authenticated user.
- Request body: `{ meetingUrl: string }` — Zod validated.
  - `meetingUrl`: `z.string().url('Must be a valid URL').max(500)` — rejects non-URL strings.
- Action: Updates `sessions.meeting_url` where `id = sessionId AND user_id = userId`.
- Response success: `{ success: true }` HTTP 200.
- Response not found: `{ error: 'Session not found' }` HTTP 404.
- Response validation failure: `{ error: 'Validation failed', details: ... }` HTTP 400.
- File location: `app/api/sessions/[sessionId]/meeting-url/route.ts`.

## 5. Visual Examples

### Session card — no meeting link (State A)

```
┌──────────────────────────────────────────────────────────────┐
│  [●1]  Introduction to AI Governance          [scheduled]    │
│        Mon 9 Jun · 9:00 am  ·  30 min                        │
│                                                               │
│  Meeting link                                                 │
│  ┌──────────────────────────────────────┐  ┌────────┐        │
│  │ https://meet.google.com/...          │  │  Save  │        │
│  └──────────────────────────────────────┘  └────────┘        │
└──────────────────────────────────────────────────────────────┘
```

### Session card — has meeting link (State B)

```
┌──────────────────────────────────────────────────────────────┐
│  [●1]  Introduction to AI Governance          [scheduled]    │
│        Mon 9 Jun · 9:00 am  ·  30 min                        │
│                                                               │
│  🔗 meet.google.com/abc-defg-hij                    [Edit]   │
└──────────────────────────────────────────────────────────────┘
```

### Sessions page header — no links present

```
┌──────────────────────────────────────────────────────────────┐
│  Your Sessions                                                │
│  Add your Google Meet links so you're ready to join each     │
│  session. You can do this any time before it starts.         │
└──────────────────────────────────────────────────────────────┘
```

The informational text ("Add your Google Meet links...") appears only when at least one session has `meeting_url = null`. It disappears once all sessions have links.

## 6. Data Requirements

### Read
- `sessions` table: `id`, `session_index`, `session_title`, `scheduled_at`, `duration_mins`, `status`, `meeting_url`, `user_id`.

### Written
- `sessions.meeting_url` — updated by `PATCH /api/sessions/[sessionId]/meeting-url` with the user-supplied URL.

### API routes changed
- `app/api/sessions/schedule/route.ts` — remove Google Meet creation block and its import.
- New: `app/api/sessions/[sessionId]/meeting-url/route.ts` — PATCH handler.

### Environment variables
- No new env vars.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID` remain in `.env.local.example` — not removed.

## 7. Success Criteria

Given a user confirms their schedule,
When the `POST /api/sessions/schedule` handler runs,
Then no call to `createGoogleMeetEvent` is made and the response time is not affected by an 8-second timeout.

Given a newly scheduled session with `meeting_url = null`,
When the user views `/dashboard/sessions`,
Then each session card shows the "Meeting link" label, the text input with placeholder `https://meet.google.com/...`, and the "Save" button.

Given a user types `https://meet.google.com/abc-defg-hij` into the meeting link input and clicks "Save",
When the PATCH request completes successfully,
Then the input is replaced by the truncated link display row (`🔗 meet.google.com/abc-defg-hij`) and the session's `meeting_url` column in Supabase contains `https://meet.google.com/abc-defg-hij`.

Given a user submits `not-a-url` as a meeting link,
When the PATCH request is sent,
Then the API returns HTTP 400 and the card shows the error message "Couldn't save the link. Please try again."

Given a user clicks "Edit" on a session card that already has a meeting link,
When the edit state activates,
Then the meeting link input is shown pre-populated with the current meeting URL, and the "Save" button is visible.

Given a user has just scheduled sessions and receives the confirmation email,
When they read the email,
Then the email contains the text "Add your Google Meet link in your dashboard" with a hyperlink to `/dashboard/sessions` — not a broken or missing meeting link.

Given the schedule API is called and the Google Meet code has been removed,
When the server logs are inspected,
Then there is no log entry containing `[schedule] Meet created` or `[schedule] Meet creation failed` — these log lines no longer exist.

## 8. Error States

### PATCH — invalid URL
- Response: HTTP 400, `{ error: 'Validation failed', details: { meetingUrl: ['Must be a valid URL'] } }`.
- UI: error message below input, `#EF4444`, "Couldn't save the link. Please try again."

### PATCH — session not found or belongs to another user
- Response: HTTP 404, `{ error: 'Session not found' }`.
- UI: same error message as invalid URL.

### PATCH — Supabase error
- Response: HTTP 500, `{ error: 'Failed to save meeting link' }`.
- UI: same error message.

### Network error (client-side fetch fails)
- UI: same error message. Input re-enabled. No data loss.

## 9. Edge Cases

### User pastes a Zoom or Teams link instead of Google Meet
- The Zod validator only checks `z.string().url()` — it does not restrict to Google Meet URLs. Any valid URL is accepted. This is intentional: some users may use Zoom or Teams.

### User clears the meeting link (submits empty string)
- `z.string().url()` rejects an empty string. The user must submit a valid URL or nothing. There is no "remove link" affordance in this spec — that is out of scope.

### Session is 'completed' or 'active'
- The PATCH endpoint updates `meeting_url` for sessions of any status. A completed session can have its link updated (e.g. for reference). No status restriction on the endpoint.

### All sessions already have meeting links on page load
- The informational header text does not appear. All session cards show State B (link display).

### User has no sessions at all
- The page shows an empty state (existing behaviour, not changed by this spec).

## 10. Out of Scope

- Google Calendar API integration — explicitly removed and reserved for a future feature.
- Auto-detecting the meeting platform from the URL.
- Removing a meeting link once set.
- Sending a meeting link in SMS.
- Sending a calendar invite with the meeting link.
- Adding meeting links during the scheduling flow (before plan approval) — the link is added after scheduling, in the sessions dashboard.

## 11. Open Questions

None. Arun has chosen Option B explicitly.

## 12. Dependencies

- No other FB required as a prerequisite.
- `lib/google-calendar.ts` must not be deleted (future use).

---

# FB-004 — localStorage Auto-Submit Verification — Requirement Document

ID: FB-004
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-06

## 1. Purpose

Commit `8a1c42a` implemented a fix so that a user who completes the Clio onboarding flow anonymously, then creates an account, is redirected back to `/onboarding` where their `localStorage` answers auto-submit. This has not been verified end-to-end. This document specifies the QA steps required to verify or diagnose the flow, the acceptance criteria that must all pass, and — where the flow is found to be broken — the targeted fixes required.

## 2. User Story

As an anonymous user who completes all 6 onboarding questions,
I want my answers to be automatically saved when I create my Clio account,
So that I arrive on my dashboard with a personalised curriculum ready without repeating the onboarding flow.

As a QA engineer verifying this fix,
I want a precise step-by-step test procedure with exact observable outcomes at each step,
So that I can confirm the fix works or identify exactly which step is broken.

## 3. Trigger / Entry Point

- URL: `/onboarding` — the onboarding page.
- Trigger condition: page loads when Clerk `isSignedIn = true` AND `localStorage.getItem('clio_onboarding')` returns a non-null value containing a valid JSON object with `role` and `learningGoal` fields present.
- The auto-submit logic is in the `useEffect` hook in `OnboardingContent` (lines 502–529 of `app/onboarding/page.tsx`).
- The `localStorage` key is `'clio_onboarding'`.
- Clerk `afterSignUpUrl` must be `/onboarding` for the redirect to land on this page.

## 4. Screen / Flow Description

### Step-by-step QA procedure

The following steps must be executed by a QA operator on `distill-peach.vercel.app` in a browser session with no active Clio account:

**Step 1 — Start anonymous onboarding**
- Open a fresh browser tab (or clear cookies and localStorage) and navigate to `https://distill-peach.vercel.app/onboarding`.
- Confirm: the onboarding page loads at Step 0 (role level question). No sign-in prompt appears.

**Step 2 — Complete all 6 questions**
- Step 0: Select "Executive / C-Suite".
- Step 1: Select "Finance".
- Step 2: Select "Financial Services".
- Step 3: Select "I'm exploring what AI can do for my business" (observer).
- Step 4: Select at least one domain (e.g. "AI & Machine Learning").
- Step 5: Select a learning goal (e.g. "1 session per week"). This step auto-advances.
- Expected: after Step 5 selection, `setBuilding(true)` is called, the `BuildingScreen` appears ("Got it. / Calibrating your AI learning path...").

**Step 3 — Verify localStorage write**
- At any point after Step 5 selection and before the API call completes, open browser DevTools → Application → Local Storage → `distill-peach.vercel.app`.
- Confirm: key `clio_onboarding` exists with a JSON value containing at least `role`, `roleLevel`, `industry`, `aiMaturity`, `domains`, `learningGoal`.

**Step 4 — Observe authentication prompt**
- Since the user is not signed in, the API call to `POST /api/onboarding` returns HTTP 401 with `{ error: 'session_not_ready' }`.
- The UI should transition to the sign-up prompt screen showing: "Your plan is ready." heading, "Create account — it's free" button linking to `/sign-up?redirect_url=/onboarding`.
- Confirm: the sign-up prompt is displayed. The `localStorage` key `clio_onboarding` is still present (the code reads and removes it only on successful auto-submit, not on 401).

**Step 5 — Create account via sign-up**
- Click "Create account — it's free".
- Complete Clerk sign-up (email or Google OAuth).
- Confirm: after sign-up completes, Clerk redirects the user to `/onboarding` (not `/dashboard`).

**Step 6 — Auto-submit fires**
- On page load at `/onboarding`, Clerk `isSignedIn` becomes `true`.
- The `useEffect` hook reads `localStorage.getItem('clio_onboarding')`.
- Confirm: `localStorage` key is present and contains the answers from Step 2.
- The effect calls `setBuilding(true)` and `submitOnboarding(parsed.learningGoal, snapshot)`.
- The `BuildingScreen` is shown.
- The API call `POST /api/onboarding` fires.
- Confirm: in DevTools Network tab, a POST to `/api/onboarding` appears with status 200.

**Step 7 — Redirect to /topics**
- On API success, `router.push('/topics')` is called.
- Confirm: the browser navigates to `/topics` (not `/onboarding` again, not an error page).

**Step 8 — Verify data saved**
- In Supabase dashboard, query: `SELECT role, role_level, industry, ai_maturity, domains, learning_goal FROM users WHERE id = '[userId]'`.
- Confirm: all 6 fields contain the values selected in Step 2.

### Auto-submit logic (from code — for developer reference)

The `useEffect` in `OnboardingContent` runs when `clerkLoaded` and `isSignedIn` both become true. It reads `localStorage.getItem('clio_onboarding')`, parses the JSON, guards on `parsed.role && parsed.learningGoal`, calls `localStorage.removeItem('clio_onboarding')`, sets `building = true`, and calls `submitOnboarding(parsed.learningGoal, snapshot)`.

The `submitOnboarding` function posts to `/api/onboarding`. On success it calls `router.push('/topics')`. On 401 with `error: session_not_ready` it retries up to 3 times with 1-second delays. On final 401 it sets `submitError: '__needs_auth__'` (which shows the sign-up prompt again — this is the edge case where the user signs in but Clerk is still propagating).

## 5. Visual Examples

### BuildingScreen (shown during auto-submit)

```
┌────────────────────────────────────────┐
│                                        │
│           [●●● purple ring ●●●]        │
│               [  C  ]                  │
│                                        │
│              Got it.                   │
│   Calibrating your AI learning path... │
│                                        │
│          [● ● ●] (animated dots)       │
│                                        │
└────────────────────────────────────────┘
```

Background: `#080808`. Pulsing purple ring animation on the "C" logo. Text: "Got it." 30px bold white. "Calibrating your AI learning path..." 16px `#94A3B8`, fades in after 0.5s delay.

### Sign-up prompt (shown when API returns 401)

```
┌────────────────────────────────────────┐
│                                        │
│              [  C  ]                   │
│                                        │
│         Your plan is ready.            │
│  Create your account to save your      │
│  personalised AI learning plan and     │
│  start your 3-day free trial.          │
│                                        │
│  ┌────────────────────────────────┐    │
│  │   Create account — it's free  │    │
│  └────────────────────────────────┘    │
│                                        │
│  Already have an account? Sign in      │
└────────────────────────────────────────┘
```

Background: `#080808`. "C" in a 64px purple circle. "Your plan is ready." 24px bold white. Description: 14px `#94A3B8`. Button: full width, `#7C3AED` bg, white text, 48px height, 14px font-weight 600. "Sign in" is a purple link.

### Error screen (shown on non-401 API failure)

```
┌────────────────────────────────────────┐
│                                        │
│         Something went wrong.          │
│  We couldn't save your profile.        │
│  Please try again — your answers       │
│  are still here.                       │
│                                        │
│  ┌────────────────────────────────┐    │
│  │          Try Again             │    │
│  └────────────────────────────────┘    │
└────────────────────────────────────────┘
```

"Try Again" button re-calls `submitOnboarding(learningGoal)`. The answers are still in React state (not lost).

## 6. Data Requirements

### localStorage
- Key: `'clio_onboarding'`
- Written: by `submitOnboarding()` before the API call — the payload is written to localStorage so it survives a page reload or browser navigation.
- Read: by the `useEffect` auto-submit hook on page load when signed in.
- Removed: immediately before calling `submitOnboarding()` in the auto-submit hook, so it is not re-read on a page re-visit after successful submission.

### API
- `POST /api/onboarding` — receives all 6 fields mapped as:

| onboarding field | API payload key | users table column |
|---|---|---|
| roleLevel (step 0) | `roleLevel` | `role_level` |
| role (step 1 resolved roleId) | `role` | `role` |
| industry (step 2) | `industry` | `industry` |
| aiEngagement (step 3) | `aiMaturity` | `ai_maturity` |
| selectedDomains (step 4) | `domains` | `domains` |
| learningGoal (step 5) | `learningGoal` | `learning_goal` |

All 6 fields must be present and non-empty in the `users` table row after successful submission.

### Clerk configuration
- `afterSignUpUrl` must be set to `/onboarding` in the Clerk dashboard (or via `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding` env var).
- Verify this is configured correctly as part of QA Step 5.

## 7. Success Criteria

Given a user completes all 6 onboarding questions anonymously,
When they create a Clio account via the sign-up prompt,
Then Clerk redirects them to `/onboarding` (not `/dashboard` or any other route).

Given the user lands on `/onboarding` after sign-up with `clio_onboarding` in localStorage,
When the page loads and `isSignedIn` becomes true,
Then the `BuildingScreen` appears within 500ms (not the onboarding question form).

Given the auto-submit fires,
When `POST /api/onboarding` is called,
Then the request includes all 6 fields: `role`, `roleLevel`, `industry`, `aiMaturity`, `domains`, `learningGoal`.

Given the API call succeeds (HTTP 200),
When the Supabase users table is queried for the user's row,
Then `role`, `role_level`, `industry`, `ai_maturity`, `domains`, and `learning_goal` all contain the values the user selected in Steps 0–5.

Given the API call succeeds,
When the response is processed,
Then the user is redirected to `/topics` and the `clio_onboarding` localStorage key is absent.

Given localStorage is empty when the user arrives at `/onboarding` post-sign-up (e.g. they cleared storage),
When the `useEffect` runs,
Then the onboarding question form is shown at Step 0 (not a blank screen, not an error, not an infinite spinner).

Given the auto-submit API call returns a non-401 error (e.g. 500),
When the error is received,
Then the error screen is shown with the "Try Again" button, and the user's answers are still in React state (clicking "Try Again" re-submits without re-entering answers).

## 8. Error States

### API returns 401 on auto-submit (Clerk session not yet propagated)
- The code retries up to 3 times with 1-second delays using the Bearer token path.
- If all retries exhaust and 401 persists: the sign-up prompt screen is shown again. The user can try signing in.

### localStorage contains malformed JSON
- The `try/catch` in the `useEffect` catches the parse error, calls `localStorage.removeItem('clio_onboarding')`, and falls through to show the onboarding form at Step 0.

### localStorage contains valid JSON but missing `role` or `learningGoal`
- The guard `if (!parsed.role || !parsed.learningGoal) return` means the auto-submit does not fire. The onboarding form is shown at Step 0.

### API returns 500
- The error screen is shown: "Something went wrong. We couldn't save your profile. Please try again — your answers are still here."

### User closes browser between completing onboarding and signing up
- `localStorage` persists across browser sessions (it is not `sessionStorage`). On re-opening the browser and signing in, `/onboarding` will auto-submit the saved answers.
- This scenario is in scope and is handled by the existing implementation.

## 9. Edge Cases

### User signs in (not signs up) after completing onboarding anonymously
- Clerk `afterSignInUrl` should also be `/onboarding`. Confirm this is configured. If set to `/dashboard`, the auto-submit will not fire (the user lands on dashboard, not onboarding). This is a potential gap that must be verified as part of QA Step 5.

### User completes onboarding on mobile, signs up on desktop
- `localStorage` is browser/device-scoped. Cross-device continuity is not supported. This is acceptable and out of scope.

### User has already completed onboarding (has a `users` row)
- The onboarding API uses `upsert` on conflict. Re-submitting overwrites the existing row with the new answers. This is acceptable behaviour.

### Google OAuth sign-up (Clerk OAuth flow)
- The OAuth flow redirects to Clerk's callback, then to `afterSignUpUrl = /onboarding`. The `__client_uat=0` case is handled by the Bearer token fallback already in the code. The auto-submit should fire correctly after the OAuth redirect.

## 10. Out of Scope

- Changing the onboarding question set.
- Cross-device localStorage sync.
- Modifying Clerk's sign-up UI.
- Changes to the 6-question flow for users who are already signed in from the start.

## 11. Open Questions

None. The fix is already deployed. The QA procedure is the output of this spec. If QA finds a broken step, a targeted fix spec will be written for that specific break.

## 12. Dependencies

- No other FB as prerequisite.
- Requires access to `distill-peach.vercel.app` with a fresh browser session.
- Requires Supabase access to verify the saved row after QA Step 8.
- Requires Clerk dashboard access to confirm `afterSignUpUrl` and `afterSignInUrl` configuration.

---

# FB-005 — VP Separate RoleIds and role_level Pipeline Pass-Through — Requirement Document

ID: FB-005
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-06

## 1. Purpose

VP/Director users currently receive C-Suite-framed content because their department selections in onboarding resolve to the same `roleId` values as C-Suite (e.g. VP of Technology gets `roleId: 'cto'`). Additionally, the `role_level` seniority field (c-suite / vp-dir / manager / specialist) is captured and saved to the database but is never passed to the curriculum planner, specialist, or content generator — so Claude cannot apply seniority-appropriate depth or framing. This fix introduces distinct `roleId` values for every VP/Director department and threads `role_level` through the entire content pipeline.

## 2. User Story

As a VP of Finance using Clio,
I want my coaching content framed for a senior function leader managing a team — not for a CFO with board reporting authority,
So that the examples, depth, and "so what" moments are immediately applicable to my actual day-to-day responsibilities.

As a developer maintaining the content pipeline,
I want `role_level` to be visible in every function signature and system prompt that touches user content,
So that I can trace exactly how seniority affects the output at each stage.

## 3. Trigger / Entry Point

- `app/onboarding/page.tsx` — the `DEPARTMENTS` map for `'vp-dir'` entries.
- `app/api/onboarding/route.ts` — saves `role` and `role_level` to the `users` table.
- `lib/curriculum/planner.ts` — `buildSystemPrompt` and `buildProfileHash` functions.
- `lib/curriculum/specialist.ts` — `buildUserMessage` function and `SYSTEM_PROMPT`.
- `lib/content/session-content-generator.ts` — `generateSessionContentOutline` function signature and prompt.
- `inngest/session-content-pipeline.ts` — the step that fetches user profile and constructs `userContext`.

## 4. Screen / Flow Description

### Layer 1 — Onboarding UI: DEPARTMENTS map fix

In `app/onboarding/page.tsx`, the `DEPARTMENTS` constant for `'vp-dir'` currently maps every department to a C-Suite `roleId`. Replace with the following exact mapping:

| Department label | Old roleId | New roleId |
|---|---|---|
| Technology & Engineering | `'cto'` | `'vp-technology'` |
| Operations | `'coo'` | `'vp-operations'` |
| Finance | `'cfo'` | `'vp-finance'` |
| Product | `'product-manager'` | `'vp-product'` |
| Data & Analytics | `'data-analyst'` | `'vp-data'` |
| Design & UX | `'designer'` | `'vp-design'` |
| Marketing & Growth | `'marketing'` | `'vp-marketing'` |
| People & HR | `'hr'` | `'vp-hr'` |

No change to the department labels (what the user sees). No change to the C-Suite `DEPARTMENTS` map. No change to `'manager'` or `'specialist'` maps.

### Layer 2 — Onboarding API: role_level already saved

`app/api/onboarding/route.ts` already saves `role_level: data.roleLevel` to the `users` table via the `userRecord` object. Migration 026 (`ADD COLUMN IF NOT EXISTS role_level TEXT`) already exists. No change required to the API or schema for this layer.

### Layer 3 — Curriculum planner: role_level pass-through

In `lib/curriculum/planner.ts`:

**3a. `PlannerInput` interface — add `roleLevel` field:**
```typescript
export interface PlannerInput {
  userId: string
  role: string
  industry: string
  maturity: string
  worry: string
  topics: string[]
  planTier: string | null
  roleLevel: string   // ADD: 'c-suite' | 'vp-dir' | 'manager' | 'specialist'
}
```

**3b. `buildSystemPrompt` — add `roleLevel` parameter and inject into prompt:**
Add parameter `roleLevel: string` to the function signature.

Add the following block immediately after the `USER PROFILE:` section in the prompt string:

```
- Seniority level: ${roleLevelLabel}
${roleLevelInstruction}
```

Where `roleLevelLabel` and `roleLevelInstruction` are computed as:

```typescript
const roleLevelLabel = {
  'c-suite': 'Executive / C-Suite (owns P&L, accountable to board)',
  'vp-dir': 'VP / Director (leads a function, reports to C-Suite, accountable for team outcomes)',
  'manager': 'Manager / Team Lead (manages a team, executes strategy set above them)',
  'specialist': 'Specialist / Individual Contributor (expert practitioner)',
}[roleLevel] ?? roleLevel

const roleLevelInstruction = {
  'c-suite': 'Frame all content for a leader who approves budgets, sponsors AI initiatives, and answers to the board. Examples must involve strategic decisions, not implementation choices.',
  'vp-dir': 'Frame all content for a function leader who owns team adoption and reports outcomes to the C-Suite. Examples must involve managing upward (presenting to executives) and downward (enabling their team). Do NOT use board-level or P&L-authority framing.',
  'manager': 'Frame all content for a team lead implementing AI tools day-to-day. Examples should be hands-on and practical. Avoid board-level or C-Suite strategic framing.',
  'specialist': 'Frame all content for a practitioner who uses AI tools directly. Examples should be technical and applied.',
}[roleLevel] ?? ''
```

**3c. `buildProfileHash` — add roleLevel to hash input:**
Change:
```typescript
export function buildProfileHash(role: string, maturity: string, topics: string[]): string {
  const sorted = [...topics].sort().join(',')
  return createHash('sha256').update(`${role}::${maturity}::${sorted}`).digest('hex').slice(0, 16)
}
```
To:
```typescript
export function buildProfileHash(role: string, maturity: string, topics: string[], roleLevel: string): string {
  const sorted = [...topics].sort().join(',')
  return createHash('sha256').update(`${role}::${roleLevel}::${maturity}::${sorted}`).digest('hex').slice(0, 16)
}
```

Rationale: `role_level` affects the curriculum output (framing, depth, examples). A change from `c-suite` to `vp-dir` for the same `role` and topics must generate a distinct plan.

**3d. Update all callers of `buildProfileHash`** — there are two calls in `planner.ts`. Both must pass `roleLevel` as the fourth argument.

**3e. `generateCurriculumPlan` — pass `roleLevel` to `buildSystemPrompt` and `buildProfileHash`:**
```typescript
const profileHash = buildProfileHash(role, maturity, topics, roleLevel)
const systemPrompt = buildSystemPrompt(role, industry, maturity, worry, topics, visibleLimit, queueLimit, roleLevel)
```

### Layer 4 — Specialist: role_level pass-through

In `lib/curriculum/specialist.ts`:

**4a. `CurriculumSpec` type — add `roleLevel` field:**
```typescript
// In lib/curriculum/types.ts (or wherever CurriculumSpec is defined):
roleLevel: string
```

**4b. `buildUserMessage` — inject roleLevel into the user message:**
Add to the top of the generated message string:
```
Role Level: ${spec.roleLevel}
```
Immediately after `Role: ${spec.role}`.

**4c. `SYSTEM_PROMPT` — add seniority framing instruction:**
Add after rule 5 ("Each session has a 1-sentence justification"):
```
6. Seniority framing: when role_level is 'vp-dir', sessions must be framed for a function leader, not a C-Suite executive. The justification must reference managing upward to C-Suite and enabling their team — not board accountability or P&L ownership. When role_level is 'c-suite', use board and strategy framing. When role_level is 'manager', use team implementation framing.
```

### Layer 5 — Session content generator: role_level pass-through

In `lib/content/session-content-generator.ts`:

**5a. `userContext` parameter — add `roleLevel` field:**
Change:
```typescript
userContext: { role: string; industry: string; maturity: string }
```
To:
```typescript
userContext: { role: string; industry: string; maturity: string; roleLevel: string }
```

**5b. Inject `roleLevel` into the prompt:**
In the `TASK` prompt string, add immediately after `AI Maturity: ${userContext.maturity}`:
```
Seniority: ${userContext.roleLevel} — ${roleLevelInstruction}
```
Use the same `roleLevelInstruction` lookup defined in Layer 3b.

**5c. In `inngest/session-content-pipeline.ts`:**

The `userProfile` fetch currently selects `role, industry, ai_maturity`. Add `role_level` to the select:
```typescript
supabase.from('users').select('role, industry, ai_maturity, role_level')
```

The `userContext` object currently is:
```typescript
const userContext = {
  role: userProfile?.role ?? 'executive',
  industry: userProfile?.industry ?? 'business',
  maturity: userProfile?.ai_maturity ?? 'beginner',
}
```
Change to:
```typescript
const userContext = {
  role: userProfile?.role ?? 'executive',
  industry: userProfile?.industry ?? 'business',
  maturity: userProfile?.ai_maturity ?? 'beginner',
  roleLevel: userProfile?.role_level ?? 'c-suite',
}
```

### Data migration for existing users

Existing users with `role = 'cto'` who are actually VPs will retain their saved data. Their `role_level` column already records their actual seniority (`'vp-dir'`). The content pipeline will now use `role_level` for framing, so even users with a `role = 'cto'` and `role_level = 'vp-dir'` will receive VP-framed content. No data change to the `role` column is required for existing users.

New users completing onboarding after this fix will receive the correct `vp-technology` (etc.) roleId from the start.

No SQL migration is required beyond what already exists (migration 026 added `role_level`).

## 5. Visual Examples

No UI changes beyond the resolved `roleId` (which users never see directly). The department selection screen is unchanged in appearance.

## 6. Data Requirements

### users table
- `role` column: will now contain `'vp-technology'`, `'vp-finance'`, etc. for new VP-level users.
- `role_level` column: already exists (migration 026). Already being populated by the onboarding API. No change.

### Files changed
1. `app/onboarding/page.tsx` — `DEPARTMENTS['vp-dir']` roleId values.
2. `lib/curriculum/planner.ts` — `PlannerInput`, `buildSystemPrompt`, `buildProfileHash`, `generateCurriculumPlan`.
3. `lib/curriculum/specialist.ts` — `SYSTEM_PROMPT`, `buildUserMessage`, `CurriculumSpec` type (or `lib/curriculum/types.ts`).
4. `lib/content/session-content-generator.ts` — `userContext` parameter type and prompt.
5. `inngest/session-content-pipeline.ts` — user profile fetch and `userContext` construction.

### No new Zod schema changes required
The `OnboardingSchema` in `app/api/onboarding/route.ts` already accepts any `z.string().min(1)` for `role` — new VP roleIds pass through without schema changes.

## 7. Success Criteria

Given a user selects "VP / Director" and "Finance" in onboarding,
When the department selection resolves a roleId,
Then `role = 'vp-finance'` is stored in the `users` table (not `'cfo'`).

Given a user has `role = 'vp-technology'` and `role_level = 'vp-dir'` in the users table,
When `generateCurriculumPlan` is called for this user,
Then the system prompt sent to Claude contains "VP / Director (leads a function, reports to C-Suite..." and does NOT contain "approves budgets" or "board" framing.

Given a user's role_level changes from 'c-suite' to 'vp-dir' (hypothetically),
When `buildProfileHash` is called,
Then the resulting hash is different from the hash produced with 'c-suite' (confirming roleLevel is part of the hash).

Given `generateSessionContentOutline` is called with `userContext.roleLevel = 'vp-dir'`,
When the prompt is constructed,
Then the prompt contains the VP-level framing instruction: "managing upward to C-Suite and enabling their team."

Given the Inngest content pipeline fetches the user profile for a VP user,
When `userContext` is constructed,
Then `userContext.roleLevel = 'vp-dir'` (not null, not 'c-suite').

Given an existing user with `role = 'cto'` and `role_level = 'vp-dir'`,
When a new curriculum plan is generated after this fix is deployed,
Then the system prompt uses VP framing (role_level takes precedence for framing instructions).

Given all 8 VP department options are rendered in the onboarding UI at step 1 when 'vp-dir' is selected at step 0,
When a developer inspects the `DEPARTMENTS['vp-dir']` array,
Then all 8 entries have roleIds matching the approved list: `vp-technology`, `vp-finance`, `vp-operations`, `vp-product`, `vp-data`, `vp-design`, `vp-marketing`, `vp-hr`.

## 8. Error States

### roleLevel is null/undefined in userProfile (legacy user with no role_level)
- Fallback: `userProfile?.role_level ?? 'c-suite'`. Existing users without a `role_level` value default to C-Suite framing — the most conservative assumption.

### Unknown roleLevel value in prompt lookup
- The lookup returns `roleLevel` (raw value) for the label and `''` for the instruction. Content is generated without seniority-specific framing but does not error.

### buildProfileHash called without roleLevel (callers not yet updated)
- TypeScript strict mode will surface a compile error — the function signature change to require 4 arguments catches any missed caller at build time.

## 9. Edge Cases

### VP user who already has a curriculum plan (plan generated before this fix)
- The profile hash now includes `role_level`. When the curriculum engine next generates a plan for this user (e.g. on next login or manual regeneration), the new hash differs from the old hash and a fresh plan is generated with VP framing.

### Manager and specialist roleIds (unchanged)
- The fix does not touch the `'manager'` or `'specialist'` DEPARTMENTS maps. Their roleIds are unchanged.

### Custom domain input (step 4) for VP users
- Custom domains are unaffected by roleId. They are stored as free-text strings.

### C-Suite user selecting "Finance" — still gets 'cfo'
- The `'c-suite'` DEPARTMENTS map is unchanged. `roleId: 'cfo'` remains for C-Suite Finance.

## 10. Out of Scope

- Adding new department options (only fixing existing ones).
- Changing the framing for `'manager'` or `'specialist'` level users in the specialist or session-content-generator (those levels currently have no explicit framing divergence from C-Suite; that is a future enhancement).
- Migrating existing users' `role` column values from 'cto' to 'vp-technology' etc. — not required because `role_level` provides the seniority signal independently.

## 11. Open Questions

None.

## 12. Dependencies

- No other FB required as prerequisite.
- Migration 026 (`ADD COLUMN role_level`) is already applied. No new migrations needed.

---

# FB-006 — ai_maturity 8-Value Mapping in Curriculum Planner — Requirement Document

ID: FB-006
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-06

## 1. Purpose

The curriculum planner's `depthCap` switch in `lib/curriculum/planner.ts` handles the old `ai_maturity` vocabulary (`beginner`, `intermediate`, `advanced`, `expert`) but not the new vocabulary introduced in the latest onboarding update (`observer`, `emerging`, `practitioner`, `leader`). All four new values fall through to the `default` branch and receive `depthCap = 'advanced'` — the highest depth level — regardless of actual maturity. An `observer` (no AI experience) receives the same content depth as a `leader` (deep AI practitioner). This fix adds a normalisation step that maps both vocabularies to canonical depth caps before the switch runs.

## 2. User Story

As a Clio user who selected "I'm exploring what AI can do for my business" (observer) in onboarding,
I want my curriculum sessions to start at a foundational depth with clear analogies and no jargon,
So that I can build genuine understanding rather than feeling lost in content pitched above my level.

As a developer maintaining the curriculum planner,
I want the depth-cap logic to be documented with a clear comment explaining both vocabulary sets and their mapping,
So that future onboarding vocabulary changes do not silently break depth assignment.

## 3. Trigger / Entry Point

- `lib/curriculum/planner.ts` — `buildSystemPrompt` function.
- Trigger: any call to `generateCurriculumPlan` where `input.maturity` contains a new-vocabulary value.
- No user-visible screen changes.

## 4. Screen / Flow Description

This fix is entirely in `lib/curriculum/planner.ts`. No screens change.

### The fix: maturity normalisation before the depthCap switch

In `buildSystemPrompt`, replace the current `depthCap` derivation:

```typescript
const depthCap = (() => {
  switch (maturity.toLowerCase()) {
    case 'beginner':
    case 'no experience': return 'intermediate'
    case 'intermediate':
    case 'some experience':
    case 'somewhat experience': return 'advanced'
    default: return 'advanced'
  }
})()
```

With:

```typescript
/**
 * Normalise ai_maturity to a canonical depth level.
 * Two vocabularies are in use:
 *   New (onboarding 2026-06): observer | emerging | practitioner | leader
 *   Old (legacy):             beginner | intermediate | advanced | expert
 *                             + legacy free-text: 'no experience', 'some experience', 'somewhat experience'
 * Both vocabularies map to the same three depth caps: intermediate | advanced | advanced+framing.
 *
 * Note: 'practitioner' and 'leader' both map to depthCap 'advanced' (the schema's max).
 * The difference between them is expressed as a PROMPT INSTRUCTION, not a schema value.
 */
const normalisedMaturity = (() => {
  switch (maturity.toLowerCase()) {
    case 'observer':
    case 'beginner':
    case 'no experience':
      return 'beginner'
    case 'emerging':
    case 'intermediate':
    case 'some experience':
    case 'somewhat experience':
      return 'intermediate'
    case 'practitioner':
    case 'advanced':
      return 'advanced'
    case 'leader':
    case 'expert':
      return 'expert'
    default:
      return 'intermediate'  // safe default for unknown values
  }
})()

const depthCap = (() => {
  switch (normalisedMaturity) {
    case 'beginner':    return 'intermediate'
    case 'intermediate': return 'advanced'
    case 'advanced':    return 'advanced'
    case 'expert':      return 'advanced'
    default:            return 'advanced'
  }
})()
```

### The prompt framing difference between 'practitioner'/'advanced' and 'leader'/'expert'

Both map to `depthCap = 'advanced'` because the `SessionSchema.depth_level` enum only has three values: `'beginner' | 'intermediate' | 'advanced'`. The difference between practitioner and leader is expressed as a PROMPT INSTRUCTION within `buildSystemPrompt`:

Add the following block to the `DEPTH RULES` section of the system prompt, immediately after the existing depth constraint line:

```
- Maturity framing: this user's AI maturity normalises to "${normalisedMaturity}".
${normalisedMaturity === 'expert'
  ? '- Frame content as peer-level: Claude is speaking to someone who already understands AI mechanisms. Skip introductory analogies. Focus on edge cases, failure modes, nuanced tradeoffs, and decisions at the frontier of AI deployment. Use first-person plural: "When we\'re evaluating model risk at this scale..."'
  : normalisedMaturity === 'advanced'
  ? '- Frame content for a practitioner who has hands-on AI experience: strategic depth, real tradeoffs, and implementation decisions are appropriate. Minimal introductory context needed.'
  : normalisedMaturity === 'intermediate'
  ? '- Frame content with practical focus: explain mechanisms briefly, then move quickly to application and decisions. Some analogies are helpful; avoid deep technical theory.'
  : '- Frame content with maximum accessibility: generous analogies, concrete examples before abstract concepts, explicit "why this matters" for each idea. Never assume prior AI knowledge.'
}
```

### buildProfileHash normalisation

The `buildProfileHash` function must use the `normalisedMaturity` value (not the raw `maturity` string) so that `'observer'` and `'beginner'` produce the same cache key (they represent identical depth caps and content framing). This is correct because: two users with `observer` and `beginner` respectively would receive the same curriculum output; caching them separately wastes compute.

Change the call in `generateCurriculumPlan`:
```typescript
const profileHash = buildProfileHash(role, normalisedMaturity, topics, roleLevel)
```

Note: `normalisedMaturity` is computed inside `buildSystemPrompt`. Extract the normalisation logic to a standalone exported function so both `buildSystemPrompt` and `generateCurriculumPlan` can call it:

```typescript
// Exported for use in buildProfileHash and tests
export function normaliseMaturity(maturity: string): 'beginner' | 'intermediate' | 'advanced' | 'expert' {
  switch (maturity.toLowerCase()) {
    case 'observer': case 'beginner': case 'no experience': return 'beginner'
    case 'emerging': case 'intermediate': case 'some experience': case 'somewhat experience': return 'intermediate'
    case 'practitioner': case 'advanced': return 'advanced'
    case 'leader': case 'expert': return 'expert'
    default: return 'intermediate'
  }
}
```

### Audit of other files using ai_maturity in a switch/conditional

The following files were inspected for switch/conditional logic on `ai_maturity`:

- `lib/sessions/planner.ts` — no switch on ai_maturity. Not affected.
- `lib/content/session-content-generator.ts` — uses `maturity` as a string in the prompt but no switch. Not affected.
- `lib/curriculum/specialist.ts` — uses `maturity` as a string in the user message but no switch. Not affected.
- `lib/content/curriculum.ts` (the `buildCurriculum` function used by `ScheduleClient`) — this is the older content engine. It likely has its own maturity handling. **This file must be inspected separately.** If it contains a switch on maturity, the same normalisation must be applied there. This is flagged as a verification step for the developer implementing this fix.
- `inngest/session-content-pipeline.ts` — passes `ai_maturity` as a string to `userContext.maturity`. No switch. Not affected.

## 5. Visual Examples

No screen changes.

## 6. Data Requirements

### users table
- `ai_maturity` column: stores raw user-input values. No change. The normalisation happens at read time in the planner.

### Files changed
1. `lib/curriculum/planner.ts` — `buildSystemPrompt`, `buildProfileHash` call, new exported `normaliseMaturity` function.

### No schema changes required.

## 7. Success Criteria

Given a user with `ai_maturity = 'observer'`,
When `generateCurriculumPlan` is called,
Then the system prompt sent to Claude contains `depthCap = 'intermediate'` and all generated sessions have `depth_level` of `'beginner'` or `'intermediate'` only — never `'advanced'`.

Given a user with `ai_maturity = 'leader'`,
When `generateCurriculumPlan` is called,
Then the system prompt contains the peer-level framing instruction ("Frame content as peer-level: Claude is speaking to someone who already understands AI mechanisms...").

Given a user with `ai_maturity = 'beginner'` (old vocabulary),
When `generateCurriculumPlan` is called,
Then the behaviour is identical to a user with `ai_maturity = 'observer'` (same depthCap, same framing instruction, same profile hash).

Given `normaliseMaturity('observer')` is called,
When the function runs,
Then it returns `'beginner'`.

Given `normaliseMaturity('practitioner')` and `normaliseMaturity('advanced')` are both called,
When the results are compared,
Then both return `'advanced'`.

Given `buildProfileHash` is called with `maturity = 'observer'` and again with `maturity = 'beginner'`,
When `normaliseMaturity` is applied to both before hashing,
Then the resulting hashes are identical.

Given a user with `ai_maturity = 'unknown_future_value'` (an unrecognised string),
When `normaliseMaturity` is called,
Then it returns `'intermediate'` (the safe default) and does not throw.

## 8. Error States

### Unknown maturity value
- `normaliseMaturity` returns `'intermediate'` — the safe default. Content is generated at standard depth. No error thrown.

### maturity is null or undefined (legacy user)
- The planner already receives `maturity` as a string from `PlannerInput`. If the caller passes `''`, `normaliseMaturity(''.toLowerCase())` hits the default case and returns `'intermediate'`. Safe.

## 9. Edge Cases

### 'somewhat experience' (legacy free-text value)
- Already handled in the existing switch. The new normalisation preserves this mapping to `'intermediate'`.

### User updates their ai_maturity from 'observer' to 'leader' after their first plan
- `buildProfileHash` uses `normalisedMaturity` (which changes from 'beginner' to 'expert'). The new hash differs from the old hash, triggering a plan regeneration on next access.

### lib/content/curriculum.ts maturity switch
- If this file contains its own maturity conditional, the developer must apply the same normalisation or call `normaliseMaturity` before the switch. This is a verification step — not blocking this spec, but must be confirmed during implementation.

## 10. Out of Scope

- Changing the `depth_level` enum to add a fourth level ('expert') — not in scope.
- Applying maturity normalisation to the specialist (`lib/curriculum/specialist.ts`) switch — the specialist uses `maturity` as a string in the prompt, not in a switch. No normalisation needed there.
- Adding new maturity values beyond the 8 specified.

## 11. Open Questions

None.

## 12. Dependencies

- No other FB required as prerequisite.
- FB-005 adds `roleLevel` to `buildProfileHash`. The final signature after both fixes is: `buildProfileHash(role, normalisedMaturity, topics, roleLevel)`. Both FBs touch this function — coordinate to avoid merge conflicts.

---

# FB-007 — 3-Layer Narrative Curriculum Generation — Requirement Document

ID: FB-007
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-06

## 1. Purpose

The current curriculum planner generates a flat list of sessions with subtopics chosen by Claude without a structural framework, producing inconsistent quality — some sessions are strategically rich, others are shallow or redundant. This feature replaces the flat generation with a 3-layer narrative structure: L1 (Foundation), L2 (Core — 7 mandatory dimensions), and L3 (Strategic). A 5-step algorithm (steps 1–4 in this spec; step 5 is FB-008) enforces structural completeness before a plan is surfaced to the user.

## 2. User Story

As a VP of Finance who selects "AI in Finance" as a topic,
I want my curriculum to take me from foundational concepts through all critical dimensions (how it works, limitations, risks, what not to do) to strategic connections with my other chosen topics,
So that I emerge genuinely equipped to evaluate AI vendors, lead internal discussions, and make investment decisions — not just knowing that AI exists in finance.

As a developer inspecting a generated curriculum plan,
I want to see each session tagged with its layer (L1/L2/L3), its quality score on 4 axes, and for L2 sessions a map of which of the 7 mandatory dimensions are covered,
So that I can audit the curriculum's completeness without reading every subtopic manually.

## 3. Trigger / Entry Point

- `lib/curriculum/planner.ts` — `generateCurriculumPlan` function.
- Triggered when: a user's curriculum plan is generated (first login, profile change, or manual regeneration).
- No change to the plan approval UX in `ScheduleClient.tsx` — layers and quality scores are backend metadata only.

## 4. Screen / Flow Description

This feature is entirely backend. No user-facing screens change. The plan approval UI continues to show the session list to the user — the layer tags, quality scores, and dimension maps are stored in `raw_llm_output` and in the enriched session JSONB but are not shown to the user in this release.

### Step 1 — Topic Decomposition (Claude API call 1)

Input: user profile (`role`, `roleLevel`, `industry`, `maturity`, `topics[]`).

Prompt type: single structured JSON call.

System prompt instruction: "For each selected topic, decompose it into three layers of learning: L1 prerequisites the user must understand first, L2 core dimensions every executive must master, and L3 strategic bridges to the user's other selected topics and role-specific applications."

Output schema:
```typescript
interface TopicDecomposition {
  topic: string
  l1_prerequisites: string[]      // 1–3 prerequisite concepts
  l2_dimensions: {
    how_it_works: string
    capabilities: string
    limitations: string
    role_specific_benefits: string
    tradeoffs: string
    industry_examples: string
    what_not_to_do: string
  }
  l3_bridges: string[]            // 3–5 connection points to other selected topics or role applications
}
```

Estimated token count: ~800 tokens input, ~600 tokens output per topic. For 3 topics: ~4,200 tokens total. Cost at claude-sonnet-4-6 pricing: approximately $0.007. Well under the $0.10 per-plan threshold.

L1 skipping rule: if `normalisedMaturity` (see FB-006) is `'advanced'` or `'expert'`, L1 prerequisites are generated but marked `skip: true` in the plan. They are not shown to the user and not scheduled. L1 is generated but skipped — this preserves the structural record without inflicting foundational sessions on experienced users.

### Step 2 — Narrative Arc Building (Claude API call 2)

Input: topic decompositions from Step 1 + user profile.

Prompt type: single structured JSON call producing the full plan.

System prompt instruction: "Build a complete curriculum plan using the 3-layer structure. For each session, assign a layer tag (L1_foundation, L2_core, L3_strategic), order sessions so L1 comes before L2 within each topic, and L3 sessions connect explicitly to adjacent selected topics."

This call replaces the current single-call `generateCurriculumPlan`. The existing `CurriculumOutputSchema` is extended (see Section 6 for TypeScript types) but its existing fields remain unchanged so downstream consumers do not break.

Estimated token count: ~1,200 tokens input (includes decomposition output), ~1,500 tokens output. Cost: approximately $0.005.

### Step 3 — L2 Completeness Check (local — no Claude call)

After Step 2, run a local check on every L2 session in the plan:

```typescript
const L2_DIMENSIONS = [
  'how_it_works',
  'capabilities',
  'limitations',
  'role_specific_benefits',
  'tradeoffs',
  'industry_examples',
  'what_not_to_do',
] as const

function checkL2Completeness(session: EnrichedSession): DimensionCoverageMap {
  // Each dimension is 'covered' if the session's subtopics contain a subtopic
  // whose title contains a keyword associated with that dimension.
  // Keyword associations:
  // how_it_works: ['how', 'mechanism', 'works', 'process', 'architecture']
  // capabilities: ['can', 'capability', 'able', 'enable', 'support']
  // limitations: ['limitation', 'cannot', 'limit', 'constraint', 'fail']
  // role_specific_benefits: ['benefit', 'value', 'advantage', 'roi', 'impact']
  // tradeoffs: ['tradeoff', 'trade-off', 'risk', 'cost', 'versus', 'vs']
  // industry_examples: ['example', 'case', 'industry', 'use case', 'application']
  // what_not_to_do: ['avoid', 'not to', 'mistake', 'pitfall', 'don\'t', 'caution']
  // Returns: { dimension: 'covered' | 'missing' }
}
```

If any L2 session is missing more than 2 dimensions: regenerate Steps 1 and 2 (up to 1 retry). If still failing after retry: proceed with the plan as-is and set `completeness_warning: true` on the session. Do NOT block plan delivery.

### Step 4 — Quality Scoring (local — no Claude call)

For each subtopic across all sessions, compute a quality score on 4 axes. Each axis is scored 0–10. The composite score is the average of all 4 axes.

| Axis | Scoring rule | Threshold |
|---|---|---|
| Role relevance | Subtopic title contains the user's `role` or a role keyword (e.g. 'CFO', 'Finance', 'VP') → 10. Contains a generic exec term ('executive', 'leader', 'business') → 6. No match → 3. | Min: 4 |
| Industry specificity | Subtopic title or focus contains the user's industry name or an industry keyword → 10. Contains a general business term → 5. No match → 2. | Min: 4 |
| Narrative cohesion | Subtopic is part of a contiguous L1→L2→L3 sequence for its topic (no gaps) → 10. Has one gap → 6. Multiple gaps or out of order → 3. | Min: 5 |
| Dimension coverage | For L2 sessions: number of covered L2 dimensions / 7 × 10. For L1/L3: always 8 (not applicable). | Min: 5 (L2 only) |

Subtopics with composite score below 5.5 are removed from the visible plan and moved to the queue with `queue_rationale: 'Quality score below threshold (composite: X.X/10)'`.

The quality threshold is 5.5 out of 10 (composite average). This is not configurable — it is hardcoded in the spec.

### Step 5 — Adaptive Feedback Loop

Step 5 (post-session reclassification using knowledge profile data) is implemented in FB-008. This spec covers Steps 1–4 only.

### Total API call count and cost estimate

| Step | Claude calls | Estimated tokens | Estimated cost (3 topics) |
|---|---|---|---|
| Step 1 (decomposition) | 1 | ~4,200 | ~$0.007 |
| Step 2 (arc building) | 1 | ~2,700 | ~$0.005 |
| Step 3 (retry, if needed) | 0–2 | ~6,900 | ~$0.012 max |
| Step 4 (local scoring) | 0 | — | $0.00 |
| **Total** | **2–4** | **~7,000–14,000** | **~$0.012–$0.024** |

Well under the $0.10 per-plan threshold. No escalation required.

### Timing constraint

The existing `generateCurriculumPlan` makes 1 Claude call (~5–15 seconds). The new 2-call sequence adds approximately 5–15 seconds (one additional call). Total expected time: 10–30 seconds. This is within the 30-second limit specified in the brief. The plan generation runs in the background (Inngest) after onboarding — the user sees a "Building your plan..." screen during this time. No synchronous response time is affected.

## 5. Visual Examples

No user-facing screen changes. Layer tags, quality scores, and dimension maps are stored in the plan JSONB and visible in Supabase — not shown to users.

## 6. Data Requirements

### TypeScript type definitions (enriched plan format)

```typescript
export type L2Dimension =
  | 'how_it_works'
  | 'capabilities'
  | 'limitations'
  | 'role_specific_benefits'
  | 'tradeoffs'
  | 'industry_examples'
  | 'what_not_to_do'

export type LayerTag = 'L1_foundation' | 'L2_core' | 'L3_strategic'

export interface DimensionCoverageMap {
  how_it_works: 'covered' | 'missing'
  capabilities: 'covered' | 'missing'
  limitations: 'covered' | 'missing'
  role_specific_benefits: 'covered' | 'missing'
  tradeoffs: 'covered' | 'missing'
  industry_examples: 'covered' | 'missing'
  what_not_to_do: 'covered' | 'missing'
}

export interface QualityScore {
  role_relevance: number         // 0–10
  industry_specificity: number   // 0–10
  narrative_cohesion: number     // 0–10
  dimension_coverage: number     // 0–10 (L2 only; 8 for L1/L3)
  composite: number              // average of all 4 axes
}

export interface EnrichedSession extends Session {
  layer: LayerTag
  skip: boolean                  // true for L1 sessions skipped due to high maturity
  quality_score: QualityScore
  dimension_coverage: DimensionCoverageMap | null  // null for L1/L3
  dependency_ref: string | null  // session_id of the L1 this L2 builds on
  bridge_ref: string | null      // session_id of the L3 or other topic this connects to
  completeness_warning: boolean  // true if L2 completeness check found >2 missing dimensions after retry
}
```

### curriculum_plans table

The `raw_llm_output` JSONB column already stores the full plan output. The enriched plan (with layer tags, quality scores, dimension maps) is stored in `raw_llm_output.enriched_plan`. No new columns are required. The existing `visible_sessions` and `queue_sessions` JSONB columns store session objects — these session objects will now include the `EnrichedSession` fields above.

No new database migration is required for FB-007.

### API call structure summary

- Call 1 to Claude: topic decomposition. Input: user profile + topic list. Output: `TopicDecomposition[]`.
- Call 2 to Claude: arc building. Input: decompositions + user profile + tier limits. Output: `CurriculumOutputSchema` (existing format extended with `EnrichedSession` fields).
- Steps 3 and 4: local computation. No additional API calls.

## 7. Success Criteria

Given a user selects "AI in Finance" as a topic with `ai_maturity = 'observer'`,
When the curriculum plan is generated,
Then the plan contains at least one session tagged `L1_foundation`, at least one tagged `L2_core`, and at least one tagged `L3_strategic`.

Given a user with `ai_maturity = 'practitioner'` (maps to `normalisedMaturity = 'advanced'`),
When the curriculum plan is generated,
Then all L1 sessions have `skip: true` and do not appear in `visible_sessions`.

Given an L2 session for "AI in Finance",
When the dimension coverage map is inspected,
Then all 7 dimensions are present with status `'covered'` or `'missing'` — none are absent from the map.

Given an L2 session that fails the completeness check (more than 2 dimensions missing) after 1 retry,
When the plan is finalised,
Then the session is included in `visible_sessions` with `completeness_warning: true` — the plan is not blocked.

Given a subtopic with composite quality score of 4.8 (below 5.5 threshold),
When Step 4 runs,
Then that subtopic is moved to `queue_sessions` with `queue_rationale` containing "Quality score below threshold".

Given the curriculum plan generation makes its two Claude API calls,
When total elapsed time is measured,
Then it completes in under 30 additional seconds compared to the current single-call generation.

Given a developer queries `curriculum_plans.raw_llm_output` for any plan generated after this fix,
When they inspect `raw_llm_output.enriched_plan.arcs[*].sessions[*]`,
Then each session object contains: `layer`, `skip`, `quality_score`, `dimension_coverage` (null for L1/L3), `dependency_ref`, `bridge_ref`.

## 8. Error States

### Step 1 Claude call fails
- Retry up to 3 times (existing retry logic in `generateCurriculumPlan`). If all retries fail: fall back to the existing single-call plan generation (current behaviour). Log `[planner] 3-layer decomposition failed — using legacy plan generation`.

### Step 2 Claude call fails
- Same retry + fallback behaviour.

### Step 3 completeness check fails after retry
- Plan is generated with `completeness_warning: true` on affected sessions. User sees the plan. An internal log entry is written: `[planner] L2 completeness check failed for session ${session_id} after retry`.

### Step 4 quality score computation errors (malformed subtopic title)
- Score defaults to composite 5.0 (just above threshold) so the subtopic is not incorrectly removed. Log the subtopic for review.

## 9. Edge Cases

### User selects only 1 topic
- Step 1 produces one `TopicDecomposition`. No L3 bridges to other topics. L3 sessions bridge to role-specific applications instead (e.g. "How AI Governance Connects to Your Board Reporting Responsibilities").

### User selects 5+ topics
- Step 1 produces 5+ decompositions. Step 2 must weave L3 bridges across all of them. The existing tier limits apply (visible_sessions cap).

### All L1 sessions are skipped (expert user, all topics)
- `visible_sessions` begins with L2 sessions. The plan is valid. L1 sessions are in `queue_sessions` with `skip: true`.

### Topic with no clear L1 prerequisites (e.g. "AI Governance" for a practitioner)
- Step 1 may return `l1_prerequisites: []`. The plan has no L1 sessions for that topic. Acceptable.

## 10. Out of Scope

- FB-007 Step 5 (post-session reclassification) — implemented in FB-008.
- User-facing display of layer tags, quality scores, or dimension maps.
- Changing the arc classification rules (domain / integrated / singleton) — the L1/L2/L3 layers operate within the existing arc structure, not replacing it.
- Changing the `SessionSchema.depth_level` enum.

## 11. Open Questions

None.

## 12. Dependencies

- FB-006 (`normaliseMaturity`) — the L1-skipping rule uses `normalisedMaturity`. FB-007 must be deployed after or together with FB-006.
- FB-008 depends on FB-007's `EnrichedSession` type and the `layer` tag stored in the plan.

---

# FB-008 — Automated Quality Evaluation and Knowledge Profile Tracking — Requirement Document

ID: FB-008
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-06

## 1. Purpose

Clio currently has no mechanism to verify whether a user understood a session's content. Every user progresses through the curriculum at the same pace regardless of comprehension. This feature implements a post-session cron job (running 2 hours after session end) that reads the Recall.ai transcript, extracts checkpoint question / user response pairs, classifies each response using a keyword-scoring classifier (Option A, no AI call), updates the user's knowledge profile, and reshapes the curriculum queue — adding reinforcement for gaps and accelerating past prerequisites when comprehension is high.

## 2. User Story

As a Clio user who struggled to answer a checkpoint question during a session,
I want Clio to automatically add a reinforcement session to my curriculum before the next topic,
So that I consolidate understanding before moving on — without having to tell Clio I was confused.

As the Clio admin reviewing session quality,
I want to see a per-session pass/fail record for 6 automated quality criteria,
So that I can identify which session topics or formats are consistently under-performing.

## 3. Trigger / Entry Point

- Scheduler: Inngest cron function, running every 15 minutes.
- Trigger condition: the cron queries the `sessions` table for rows where `status = 'completed'` AND `ended_at` is between `NOW() - INTERVAL '2 hours 15 minutes'` AND `NOW() - INTERVAL '2 hours'`. This 15-minute window catches sessions that ended approximately 2 hours ago without re-processing old sessions.
- Auth: the Inngest function runs as service role. No user auth required.
- File location: `inngest/session-quality-evaluator.ts` (new file).
- Registration: added to `app/api/inngest/route.ts` serve call.

## 4. Screen / Flow Description

This feature is entirely backend and asynchronous. No user-facing screens are introduced. The admin visibility is via Supabase dashboard only.

### Full processing sequence per completed session

**Step A — Query sessions due for evaluation**

```sql
SELECT s.id, s.user_id, s.session_title, s.topic_id, s.recall_bot_id,
       s.ended_at, u.role, u.industry, u.ai_maturity, u.active_plan_id
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.status = 'completed'
  AND s.ended_at >= NOW() - INTERVAL '2 hours 15 minutes'
  AND s.ended_at < NOW() - INTERVAL '2 hours'
  AND s.quality_evaluated = false   -- guard column (see Section 6)
```

**Step B — Fetch Recall.ai transcript**

API call: `GET https://api.recall.ai/api/v1/bot/{recall_bot_id}/transcript`

Headers: `Authorization: Token ${RECALL_API_KEY}`

The transcript is returned as an array of utterances:
```typescript
interface Utterance {
  speaker: string        // 'host' | 'participant' | speaker name
  words: {
    text: string
    start_time: number   // seconds from recording start
    end_time: number
  }[]
}
```

The full spoken text for each utterance is reconstructed by joining `words[*].text` with spaces.

Clio's speech utterances are identified by `speaker` matching the bot's name or the host speaker label. The exact speaker label must be confirmed during implementation by inspecting a live transcript. As a working assumption: Clio's speech is speaker `'host'` or the first speaker in the transcript.

If transcript is not yet available (HTTP 404 or empty array): retry after 15 minutes (Inngest retry mechanism). Maximum 3 retries. If unavailable after 3 retries: log `[quality-evaluator] Transcript unavailable for session ${id} after 3 retries` and mark `quality_evaluated = true, quality_error = 'transcript_unavailable'` — do not block.

**Step C — Extract checkpoint question / user response pairs**

Checkpoint questions are identifiable in the transcript because Clio speaks them verbatim from the `checkpoint_question` field in `topic_content_cache.content_outline.subtopics[*].checkpoint_question`.

Extraction algorithm:
1. Fetch `topic_content_cache` rows for this session's `topic_id` and retrieve all `content_outline.subtopics[*].checkpoint_question` values.
2. For each checkpoint question, search the transcript for a Clio utterance whose text has a normalised string similarity ≥ 70% to the checkpoint question text (Levenshtein distance-based, or simple word overlap: `intersection(qWords, uWords) / union(qWords, uWords) ≥ 0.7`).
3. The user response is the first participant utterance that begins within 30 seconds after the matched checkpoint question utterance's `end_time`.
4. Pair: `{ question: string, response: string, subtopic_slug: string }`.

If no checkpoint questions can be matched (e.g. Clio deviated from script): log the gap and proceed with `pairs = []`. Quality evaluation still runs on the transcript text for the 6 session quality criteria.

**Step D — Classify each user response (Option A: keyword scoring)**

The 7 variant classifier is applied to each `response` string:

```typescript
type Variant = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7'

const VARIANT_KEYWORDS: Record<Variant, string[]> = {
  V1: ['exactly', 'precisely', 'correct', 'right', 'yes and', 'agree', 'confirm', 'absolutely', 'spot on', 'that\'s it'],
  V2: ['mostly', 'partly', 'sort of', 'kind of', 'i think', 'maybe', 'not sure about', 'partially'],
  V3: ['i understand the basics', 'i get the general idea', 'roughly', 'broadly speaking', 'more or less'],
  V4: ['actually', 'wait', 'that\'s not', 'i thought', 'different from what i', 'i was thinking'],
  V5: ['hmm', 'interesting', 'never thought', 'adjacent', 'related to', 'similar to', 'close to'],
  V6: ['i don\'t know', 'not sure', 'no idea', 'can\'t say', 'don\'t understand', 'lost me', 'confused'],
  V7: ['can you explain', 'could you repeat', 'say that again', 'rephrase', 'what do you mean', 'didn\'t follow'],
}

function classifyResponse(responseText: string): Variant {
  const lower = responseText.toLowerCase()
  // Score each variant by counting matching keywords
  const scores: Record<Variant, number> = {
    V1: 0, V2: 0, V3: 0, V4: 0, V5: 0, V6: 0, V7: 0,
  }
  for (const [variant, keywords] of Object.entries(VARIANT_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) scores[variant as Variant]++
    }
  }
  // Return the highest-scoring variant. Tie-break: prefer higher-numbered variant
  // (more conservative — when in doubt, assume less comprehension).
  const best = (Object.entries(scores) as [Variant, number][])
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]
  // If no keywords match (score = 0): default to V2 (partial understanding assumed).
  return best[1] === 0 ? 'V2' : best[0]
}
```

Accuracy requirement: in a set of 20 hand-reviewed test cases, the classifier must not mis-classify any V1 response as V6 or any V6 response as V1. These are the most consequential errors (perfect vs. total confusion). V2/V3 confusion with V4/V5 is tolerable. The developer must create a test fixture of 20 hand-reviewed examples covering all 7 variants and run the classifier against them before shipping.

**Step E — Evaluate 6 session quality criteria**

Each criterion is evaluated against the full Clio transcript text (all Clio utterances concatenated):

| # | Criterion | Evaluation rule (Option A) |
|---|---|---|
| 1 | Teaches the selected topic directly | Full transcript contains the topic_title or 3+ words from it | keyword match |
| 2 | Correct seniority framing | Transcript contains at least one of these role-level markers: for c-suite: ['board', 'strategy', 'invest', 'approve']; for vp-dir: ['team', 'function', 'report', 'manage']; for manager: ['implement', 'deploy', 'execute', 'team']; for specialist: ['code', 'build', 'configure', 'analyse'] | keyword match by role_level |
| 3 | At least one industry-specific example | Transcript contains the user's industry name OR 2+ industry keywords (e.g. for Financial Services: ['bank', 'financial', 'loan', 'insurance', 'fund', 'trading', 'fintech']) | keyword match |
| 4 | Depth matches maturity | Transcript does NOT contain more than 3 of the "too technical" markers for the user's maturity: for beginner/observer: ['neural network', 'backpropagation', 'tokenizer', 'embedding dimension', 'attention head', 'gradient', 'hyperparameter'] — if transcript contains >3 of these for a beginner user, criterion fails | keyword exclusion |
| 5 | Ends with something actionable | The last 200 words of Clio's transcript contain at least one of: ['next step', 'action', 'decide', 'consider', 'ask', 'evaluate', 'start', 'try', 'question to', 'before your next'] | keyword match in tail |
| 6 | Connects to adjacent subtopics | Transcript contains a transition phrase linking to another subtopic or session: ['now that we', 'this connects to', 'in our next', 'which leads us to', 'building on this', 'this will help when we'] | keyword match |

Result per criterion: `'pass'` or `'fail'` with the matched/unmatched keyword listed.

**Step F — Update knowledge profile**

Upsert into `knowledge_profiles` table (see Section 6 for schema):

```typescript
// For each checkpoint pair classified:
const variantScore: Record<Variant, number> = {
  V1: 10, V2: 7, V3: 6, V4: 3, V5: 4, V6: 0, V7: 5,
}
const avgVariantScore = pairs.reduce((sum, p) => sum + variantScore[p.variant], 0) / Math.max(pairs.length, 1)

// Determine comprehension status:
const comprehensionStatus =
  avgVariantScore >= 8   ? 'understood'    :
  avgVariantScore >= 5   ? 'in-progress'  :
  avgVariantScore >= 3   ? 'gap'           :
                           'gap'

// Identify gaps: subtopics where variant is V4, V5, or V6
const gaps = pairs.filter(p => ['V4', 'V5', 'V6'].includes(p.variant)).map(p => p.subtopic_slug)
```

**Step G — Update curriculum queue for gaps**

For each gap subtopic slug:
1. Find the corresponding session in `curriculum_plans.queue_sessions` for the user's `active_plan_id`.
2. If a reinforcement session for that subtopic does not already exist in `visible_sessions` or `queue_sessions`: create a new session object and insert it at position 1 of `queue_sessions` (next to be unlocked).

The reinforcement session object:
```typescript
{
  session_id: `reinforcement-${subtopicSlug}-${Date.now()}`,
  title: `Reinforcing: ${subtopicTitle}`,
  focus: `Revisiting the concepts from ${subtopicTitle} with a different framing and examples.`,
  layer: 'L2_core',
  depth_level: normalisedMaturity === 'beginner' ? 'beginner' : 'intermediate',
  is_visible: false,
  queue_rationale: `Gap identified from session quality evaluation — user response classified as ${variant} on this subtopic.`,
  // Other fields inherited from the original session
}
```

**Step H — Update AI Readiness Score**

```typescript
// Only recalculate if ≥7 days since user onboarding AND ≥5 sessions completed
const daysSinceOnboarding = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
const totalSessionsCompleted = await countCompletedSessions(userId)

if (daysSinceOnboarding >= 7 && totalSessionsCompleted >= 5) {
  const allProfiles = await getKnowledgeProfilesForUser(userId)
  const avgComprehension = computeAvgComprehension(allProfiles)  // 0–100
  const streakContribution = Math.min(user.streak_days / 30, 1) * 40
  const comprehensionContribution = avgComprehension * 0.6
  const newScore = Math.min(100, Math.round(comprehensionContribution + streakContribution))

  await supabase.from('users').update({ ai_readiness_score: newScore }).eq('id', userId)
}
```

**Step I — Mark session as quality-evaluated**

```sql
UPDATE sessions
SET quality_evaluated = true,
    quality_criteria_results = '[{criterion, result, evidence}]'  -- JSONB
WHERE id = session_id
```

## 5. Visual Examples

No user-facing screens. Admin visibility via Supabase dashboard only.

## 6. Data Requirements

### New column on sessions table (migration `029_quality_evaluation.sql`)

```sql
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS quality_evaluated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_error TEXT,
  ADD COLUMN IF NOT EXISTS quality_criteria_results JSONB;

CREATE INDEX IF NOT EXISTS idx_sessions_quality_evaluated
  ON sessions (quality_evaluated, ended_at)
  WHERE status = 'completed';
```

### New table: knowledge_profiles (migration `029_quality_evaluation.sql` continued)

```sql
CREATE TABLE IF NOT EXISTS knowledge_profiles (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text        NOT NULL,
  topic_id        text        NOT NULL,
  sessions_count  integer     NOT NULL DEFAULT 0,
  avg_variant_score numeric(4,2) NOT NULL DEFAULT 0,
  comprehension_status text   NOT NULL DEFAULT 'queued'
                    CHECK (comprehension_status IN ('queued', 'in-progress', 'understood', 'gap')),
  gaps            text[]      NOT NULL DEFAULT '{}',  -- subtopic slugs with identified gaps
  maturity_signal text,       -- 'promoted' if comprehension_status = 'understood' twice
  last_evaluated_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_profiles_user_id
  ON knowledge_profiles (user_id);

ALTER TABLE knowledge_profiles ENABLE ROW LEVEL SECURITY;

-- Users cannot read their own profile directly (internal data only in this release)
CREATE POLICY "service_role_all_knowledge_profiles"
  ON knowledge_profiles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_knowledge_profiles_updated_at
  BEFORE UPDATE ON knowledge_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Environment variables

- `RECALL_API_KEY` — added to `.env.local.example` as `PLACEHOLDER_RECALL_API_KEY`.
- Existing `RECALL_API_KEY` may already be present in Vercel environment (the Recall.ai integration already exists for live sessions). Confirm before adding.

### Inngest function registration

New function `sessionQualityEvaluator` added to the `serve` call in `app/api/inngest/route.ts`.

## 7. Success Criteria

Given a session completes and `ended_at` is 2 hours ago,
When the cron runs,
Then the session is included in the evaluation batch and `quality_evaluated` is set to `true` after processing.

Given the Recall.ai transcript is not yet available when the cron runs,
When the function attempts to fetch the transcript and receives HTTP 404,
Then the function is retried up to 3 times by Inngest and `quality_evaluated` remains `false` until a retry succeeds or all retries are exhausted.

Given a user response to a checkpoint question contains the phrase "I don't know",
When the classifier runs,
Then the response is classified as V6 and the subtopic_slug is added to the user's `gaps` array in `knowledge_profiles`.

Given a user response contains "exactly, that's it" and no V6 keywords,
When the classifier runs,
Then the response is classified as V1 and is NOT added to the `gaps` array.

Given a V6 gap is identified for a subtopic in session N,
When the curriculum queue is updated,
Then a reinforcement session titled "Reinforcing: [subtopic title]" appears at position 1 of `queue_sessions` for the user's active plan.

Given a session transcript that does not contain the user's industry name or industry keywords,
When quality criterion 3 is evaluated,
Then criterion 3 is marked `'fail'` and the `quality_criteria_results` JSONB records `{ criterion: 3, result: 'fail', evidence: 'no industry keywords matched' }`.

Given a user has completed ≥5 sessions over ≥7 days,
When the quality evaluation cron runs after a new session,
Then `users.ai_readiness_score` is updated using the knowledge-profile-based formula — not the old feedback Y/N formula.

## 8. Error States

### Transcript unavailable after 3 retries
- `quality_evaluated = true`, `quality_error = 'transcript_unavailable'`. The session is not re-evaluated.

### `recall_bot_id` is null (session did not use Recall.ai)
- Skip transcript fetch. Run quality criteria evaluation on an empty transcript (all 6 criteria will fail or be skipped with `evidence: 'no transcript available'`). Mark `quality_evaluated = true`.

### Knowledge profile upsert conflict
- The `UNIQUE (user_id, topic_id)` constraint means the upsert updates the existing row. No error.

### Reinforcement session already exists in queue
- Before inserting, check `queue_sessions` for an existing session with `session_id` starting with `reinforcement-${subtopicSlug}`. If found: skip insertion. Idempotent.

### active_plan_id is null (user has no approved plan)
- Skip queue update. Log `[quality-evaluator] No active plan for user ${userId} — skipping queue update`. Continue with knowledge profile and score updates.

## 9. Edge Cases

### Session with no checkpoint questions in content_outline
- `pairs = []`. Quality criteria still evaluated. Knowledge profile updated with `sessions_count + 1`, `avg_variant_score` unchanged.

### User's transcript has no Clio speech (bot failed to speak)
- All quality criteria fail. `gaps = []` (no pairs to classify). `quality_evaluated = true`, `quality_error = 'no_clio_speech_detected'`.

### Multiple sessions complete within the same 15-minute window
- Each session is evaluated independently. The cron uses a `quality_evaluated = false` guard to prevent double-processing.

### Reinforcement session itself is then completed
- On next evaluation, the reinforcement session is processed the same as any session. If the user still shows a gap, another reinforcement is inserted.

### User has `maturity_signal = 'promoted'` (two consecutive 'understood' statuses)
- This flag is set in `knowledge_profiles.maturity_signal`. It is stored for future use (e.g. accelerating the user's plan). No action is taken on this field in this release beyond storing it.

## 10. Out of Scope

- User-facing knowledge profile page — future feature.
- Real-time classification during the live session — the cron runs 2 hours post-session.
- Option B classifier (AI call) — future upgrade if Option A accuracy is insufficient.
- Sending a notification to the user when a gap is identified — future feature.
- The 6 quality criteria evaluation changing the visible_sessions list — only the queue is modified in this release.

## 11. Open Questions

None.

## 12. Dependencies

- FB-007 must be deployed first — the `layer` tag in `EnrichedSession` is used to determine reinforcement session layer assignment.
- Recall.ai API key must be confirmed present in Vercel environment variables before deployment.
- The Recall.ai speaker label for Clio's speech must be confirmed from a live transcript before the extraction algorithm is finalised. This is a technical verification step, not a product decision.
- Migration `029_quality_evaluation.sql` must be applied before code deploy.
