# Requirement Document: Schedule Setup Gate
**Feature ID:** SCH-01
**Status:** Draft — awaiting Arun review
**Author:** Business Analyst Agent
**Date:** 2026-06-09
**CEO Brief date:** 2026-06-09

---

## 1. Feature Overview

**Name:** Schedule Setup — Mandatory First-Run Gate
**One-liner:** After approving their learning plan, a user sets their preferred days, time, and session duration in one step so that all sessions are immediately written with real `scheduled_at` timestamps.
**Priority:** P0 — blocks every other scheduling-dependent feature (reminders, agenda emails, session content cron ordering, dashboard "Next Session" card accuracy).

---

## 2. Problem Statement

### What breaks today

When a user approves their learning plan, `/api/plan/approve` flips all draft sessions to `status = 'scheduled'` but leaves `scheduled_at = null` on every row. The user is then redirected to `/dashboard/sessions`, which immediately shows a session list with no dates. Every session card displays "Time TBD" (or a blank date field), which looks broken and erodes confidence in the product.

Downstream consequences of `scheduled_at = null`:
- The dashboard "Your Next Clio Session" card (`DashboardClient.tsx`) queries `scheduled_at > now()` — it returns nothing, so the card shows "No upcoming Clio sessions".
- Session reminder emails and agenda emails (`session-reminder.ts`, `session-agenda-email.ts`) are triggered by `scheduled_at` — they never fire.
- `session-content-cron.ts` Branch B selects sessions by `scheduled_at` — ordering is undefined without real timestamps.

### Who is affected

Every new user who completes the plan approval flow — 100% of activations.

### What the user sees today

1. Approves plan on `/dashboard/plan`
2. Lands on `/dashboard/sessions`
3. Sees a list of sessions, every one showing "Time TBD" or a blank date
4. No clear action to take; no error message explains the gap

---

## 3. User Stories

**US-1 (Happy path — first-run setup)**
As a user who has just approved my learning plan for the first time,
I want to be taken directly to a schedule setup screen where I choose my preferred days, time, and session duration,
so that I exit setup with all sessions showing real dates and immediately feel the product is working.

**US-2 (Returning user — changing preferences)**
As a user who has already set a schedule but wants to change my preferred days or time,
I want to open Settings, edit my schedule preferences in place, and save them,
so that all future unstarted sessions are rescheduled to match my new preferences without losing any completed sessions.

**US-3 (User who ignores the gate)**
As a user who navigates away from the setup screen before completing it (e.g. by typing a different URL directly),
I want to see a clear blocking banner on `/dashboard/sessions` and an amber warning card on the dashboard home that tells me I need to set up my schedule,
so that I can complete setup at any later point without being confused about why my sessions have no dates.

**US-4 (User who has completed all sessions)**
As a user whose every session is either `completed` or `cancelled`,
I want the system to handle a schedule re-run safely — skipping insert for already-completed session indexes — so that my history is never overwritten.

---

## 4. Acceptance Criteria

**Setup screen — routing**
1. Immediately after `POST /api/plan/approve` returns `{ success: true }`, the client redirects to `/dashboard/schedule-setup` instead of `/dashboard/sessions`.
2. If `users.scheduling_prefs IS NOT NULL` when `/dashboard/schedule-setup` is loaded server-side, the server redirects to `/dashboard/sessions` (setup is already done; no reason to show it again to a returning visit).
3. Navigating directly to `/dashboard/schedule-setup` when `scheduling_prefs IS NOT NULL` redirects to `/dashboard/sessions`.

**Setup screen — form**
4. The screen shows exactly three controls: day-of-week pill selector (7 pills: Sun–Sat), clock dialer (HH:MM + AM/PM, 15-minute steps), and duration selector (15 min / 30 min cards).
5. Mon–Fri pills are pre-selected on first load; no day is pre-selected on the Settings edit form (it reflects saved prefs).
6. The detected IANA timezone is shown as read-only text below the clock dialer (e.g., "America/New_York"). The timezone value is captured from `Intl.DateTimeFormat().resolvedOptions().timeZone` in the browser and sent with the request.
7. The "Confirm schedule" button is disabled and displays a tooltip "Select at least one day" if zero day pills are selected.
8. Submitting the form calls `POST /api/user/schedule-prefs` with the preferences payload (defined in Section 7).
9. On a successful API response, the client immediately calls `POST /api/sessions/schedule` with the computed `ScheduledSession[]` array (derived by running `scheduleSessions()` in the browser using the saved prefs), then redirects to `/dashboard/sessions`.
10. During submission (between button click and redirect), the button shows a loading spinner and the form controls are disabled.
11. If the API returns an error, an inline error message appears below the form ("Something went wrong — please try again") and the form re-enables.

**Blocking banner — `/dashboard/sessions`**
12. If `users.scheduling_prefs IS NULL`, `/dashboard/sessions` renders a full-width amber banner at the top of the page (above the session list) with the text: "Set your schedule to see session dates" and a button "Set up schedule" that links to `/dashboard/schedule-setup`.
13. The session list still renders below the banner — sessions are visible even without a schedule.
14. If `scheduling_prefs IS NOT NULL`, no banner is shown.

**Dashboard home warning card**
15. If `users.scheduling_prefs IS NULL` AND `users.plan_approved IS TRUE`, the dashboard home (`/dashboard`) renders an amber warning card in the status banner area (above the main grid), between any existing banners and the metric cards, with: icon (CalendarDays, amber), text "Your sessions have no dates yet — set your schedule now", and a button "Set up schedule →" linking to `/dashboard/schedule-setup`.
16. The card is not shown if `scheduling_prefs IS NOT NULL`.

**Settings page — schedule preferences section**
17. `/dashboard/settings` displays a new "Schedule" section (above the "Account" section) showing the saved preferences: selected days as read-only pills, time as formatted string (e.g., "9:00 AM"), duration as a string (e.g., "30 min"), and timezone as a string.
18. An "Edit" button opens an inline edit form identical in layout to the setup screen (same controls, same validation rules), pre-populated with the saved values.
19. Saving from the Settings form calls `POST /api/user/schedule-prefs` then `POST /api/sessions/schedule`, shows a "Schedule updated" success state, and returns to read-only display.
20. If `scheduling_prefs IS NULL`, the section shows "No schedule set yet" with a link to `/dashboard/schedule-setup`.

**Data integrity — re-run guard**
21. When `POST /api/sessions/schedule` is called for a user who has one or more sessions with `status IN ('completed', 'active')`, those session indexes are excluded from deletion and not re-inserted.
22. The `POST /api/sessions/schedule` handler does NOT fire a second `distill/session.content.generate` event for Session 1 if Session 1 already has `status = 'completed'` or `status = 'active'`. It only fires that event for the lowest-index session whose status is `'scheduled'` after the insert.
23. The unique index `idx_sessions_user_session_index` (defined in Section 8) prevents duplicate rows at the database level; any insert that would violate it is rejected with a 409 response.

**Email nudge**
24. Exactly one "Set up your schedule" email is sent to each user who completes plan approval but has not submitted schedule preferences within 24 hours.
25. The nudge is idempotent: sending it a second time for the same user is a no-op (enforced by the mechanism in Section 9).
26. If the user submits schedule preferences before 24 hours elapse, the nudge is not sent.

**Timezone handling**
27. The `SchedulePreferences.timezone` field is stored in `users.scheduling_prefs` as a valid IANA timezone string (e.g., `"America/New_York"`).
28. `scheduleSessions()` is called with a `firstSessionDate` that represents today's date in the user's local timezone (derived from `new Date().toLocaleDateString('en-CA', { timeZone: timezone })` — yields `YYYY-MM-DD`).
29. The `scheduledAt` values stored in the `sessions` table are UTC ISO timestamps. The conversion from local time to UTC is performed in the browser before sending to `POST /api/sessions/schedule` (the `ScheduledSession.scheduledAt` field is already UTC by the time the array is built by `scheduleSessions()` — this works correctly today because `sessionDate.toISOString()` converts to UTC; no server-side conversion needed).
30. If the browser returns a non-IANA-format timezone string (e.g., `"GMT+5:30"`), the API rejects the request with 400 and the error message "Invalid timezone — please reload the page and try again."

---

## 5. Wireframes / Screen Descriptions

### 5a. Schedule Setup Screen — `/dashboard/schedule-setup`

**Layout:** Full-page, uses `DashboardShell` with `activeNav="/dashboard/sessions"` (no active nav item for this transient screen). Main content area is centered, max-w-lg, padded.

**Header:**
- H1: "When do you want to learn?" — `text-2xl font-bold text-white`
- Subheading: "Clio will schedule your sessions around these times." — `text-sm text-[#475569]`
- No back button. The only way out is to complete the form or navigate away manually.

**Control 1 — Day picker:**
- Label: "Preferred days" — `text-xs font-semibold uppercase tracking-wider text-[#475569]`
- 7 pill buttons in a row: Sun Mon Tue Wed Thu Fri Sat
- Pill default (unselected): `bg-[#111111] border border-[#222222] text-[#475569] rounded-full px-3 py-1.5 text-sm`
- Pill selected: `bg-purple-950/50 border border-[#7C3AED] text-white rounded-full px-3 py-1.5 text-sm font-semibold`
- On first load: Mon, Tue, Wed, Thu, Fri are selected.
- Clicking a selected pill deselects it. Clicking an unselected pill selects it.
- If the last selected pill is deselected, it snaps back to selected (minimum 1 day must remain selected at all times — do not allow zero selection).

**Control 2 — Time picker:**
- Label: "Preferred time" — same label style
- HH picker: left-right chevrons or tap-to-increment, range 1–12
- MM picker: 00 / 15 / 30 / 45 only
- AM/PM toggle: two-button toggle, same pill style as day picker
- Default: 9:00 AM
- Below the picker, read-only text: "Your timezone: America/New_York" (substituted from detected timezone) — `text-xs text-[#475569]`

**Control 3 — Duration:**
- Label: "Session length" — same label style
- Two cards side by side:
  - Card A: "15 min" headline, "Quick focused sessions" subtext
  - Card B: "30 min" headline, "Deep dives" subtext
- Card default: `bg-[#111111] border border-[#222222] rounded-xl p-4 cursor-pointer`
- Card selected: `bg-purple-950/30 border border-[#7C3AED] rounded-xl p-4`
- Default: 30 min selected.

**Submit button:**
- Full-width, primary purple: "Confirm schedule →"
- Disabled state (zero days selected — not reachable given the snap-back rule above, but guard defensively): button disabled + tooltip "Select at least one day"
- Loading state: spinner icon + "Saving…"

**No skip link.** The only escape is browser navigation or clicking a sidebar link. The blocking banner (5b) catches users who do escape.

---

### 5b. Blocking Banner — `/dashboard/sessions`

Rendered as the first child of `SessionsClient` when `schedulingPrefsNull === true` (prop passed from server component).

```
┌─────────────────────────────────────────────────────────────────────┐
│  🗓  Set your schedule to see session dates          [Set up schedule]│
└─────────────────────────────────────────────────────────────────────┘
```

- Full-width, `bg-amber-950/20 border border-amber-800/30 rounded-xl px-4 py-3`
- Left: `CalendarDays` icon (amber, 16px) + text "Set your schedule to see session dates" (`text-sm text-[#FCD34D] font-medium`)
- Right: Button variant="secondary" size="sm" "Set up schedule →" — navigates to `/dashboard/schedule-setup`
- The session list renders normally below this banner.

---

### 5c. Dashboard Home Warning Card — `/dashboard`

Rendered inside `DashboardClient` in the status banners section (after the existing `needsRecalibration`, `isTrialing`, and `planPending` banners), shown only when `schedulingPrefsNull === true` AND `planApproved === true`.

```
┌─────────────────────────────────────────────────────────────────────┐
│  📅  Your sessions have no dates yet — set your schedule now        │
│      [Set up schedule →]                                            │
└─────────────────────────────────────────────────────────────────────┘
```

- Same amber banner style as other status banners: `border border-amber-800/30 bg-amber-950/20 rounded-xl px-4 py-3`
- Icon: `CalendarDays` size=16, color `#F59E0B`
- Text: "Your sessions have no dates yet — set your schedule now" — `text-sm text-[#FCD34D] font-medium`
- Button: `Button size="sm"` "Set up schedule →" — links to `/dashboard/schedule-setup`

---

### 5d. Settings Page — Schedule Section — `/dashboard/settings`

New section inserted above the existing "Account" section in `SettingsClient`.

**Read-only state (prefs saved):**
- Section heading: "Schedule" — same style as other section headings (`text-xs font-semibold text-[#475569] uppercase tracking-wider mb-3`)
- Card with rows:
  - Row 1: CalendarDays icon, label "Days", value: abbreviated day names joined by spaces (e.g., "Mon Tue Wed Thu Fri")
  - Row 2: Clock icon, label "Time", value: e.g., "9:00 AM"
  - Row 3: Clock icon, label "Duration", value: e.g., "30 min"
  - Row 4: Globe icon, label "Timezone", value: e.g., "America/New_York"
  - Row 5 (action): right-aligned "Edit" button (`Button variant="secondary" size="sm"`)

**Edit state:**
- Inline expansion of the same card — the read-only rows are replaced by the three controls (day picker, time picker, duration cards) matching the setup screen layout exactly.
- Pre-populated with values from `scheduling_prefs`.
- "Save" primary button + "Cancel" ghost button.
- Save calls `POST /api/user/schedule-prefs` then `POST /api/sessions/schedule`, shows inline "Schedule updated ✓" for 2 seconds, then returns to read-only state.
- Cancel returns to read-only state with no changes.

**No prefs state:**
- Section shows: "No schedule set yet." + a text link "Set up your schedule →" to `/dashboard/schedule-setup`.

---

## 6. Data Model

### `users.scheduling_prefs` JSONB column

This column already exists in the database. Currently nothing writes to it. The schema to write and read is:

```typescript
interface SchedulingPrefs {
  selectedDays: number[]       // Required. Array of integers 0–6 (0=Sun, 6=Sat). Min length: 1.
  preferredHour: number        // Required. Integer 1–12 (12-hour clock display value).
  preferredMinute: number      // Required. One of: 0, 15, 30, 45.
  ampm: 'AM' | 'PM'            // Required. Meridiem indicator.
  maxDurationMins: number      // Required. One of: 15, 30.
  timezone: string             // Required. IANA timezone string e.g. "America/New_York".
}
```

**Conversion note for `scheduleSessions()`:** `SchedulePreferences` (in `lib/sessions/planner.ts`) uses `preferredHour` as a 0–23 value. When calling `scheduleSessions()`, convert from the stored 12-hour format:

```typescript
function toHour24(hour12: number, ampm: 'AM' | 'PM'): number {
  if (ampm === 'AM') return hour12 === 12 ? 0 : hour12
  return hour12 === 12 ? 12 : hour12 + 12
}
```

**`frequencyDays` in `SchedulePreferences`:** When calling `scheduleSessions()`, always pass `frequencyDays: 7` as a safe fallback. The `selectedDays` array will override it when non-empty (as it always will be, given the ≥1 day validation rule).

**`firstSessionDate`:** Computed in the browser as:
```typescript
new Date().toLocaleDateString('en-CA', { timeZone: timezone })
// yields YYYY-MM-DD for today in the user's local timezone
```

### `users` table — no new columns needed

`scheduling_prefs` JSONB column already exists. No migration required for this column.

### `sessions` table — no new columns needed

`scheduled_at`, `status`, `session_index`, `user_id` all already exist.

### New: `inngest_nudge_sent` tracking

To enforce nudge idempotency, add a `schedule_nudge_sent_at TIMESTAMPTZ` column to the `users` table (migration in Section 8). The Inngest function checks this column before sending; writes to it after sending.

---

## 7. API Contracts

### 7a. `POST /api/user/schedule-prefs` — NEW endpoint

**Purpose:** Persist scheduling preferences for the authenticated user.

**Auth:** Required (Clerk session via `requireSessionAuth`).

**Request body (Zod schema):**
```typescript
const SchedulingPrefsSchema = z.object({
  selectedDays:    z.array(z.number().int().min(0).max(6)).min(1, 'At least one day required'),
  preferredHour:   z.number().int().min(1).max(12),
  preferredMinute: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]),
  ampm:            z.enum(['AM', 'PM']),
  maxDurationMins: z.union([z.literal(15), z.literal(30)]),
  timezone:        z.string().min(1).max(100),
})
```

**Timezone validation:** After Zod parsing, validate that `timezone` is a valid IANA timezone by attempting `new Intl.DateTimeFormat(undefined, { timeZone: timezone })`. If it throws, return 400:
```json
{ "error": "Invalid timezone — please reload the page and try again." }
```

**What it does:**
1. Validates body with Zod (returns 400 with `{ error, details }` on failure).
2. Validates `timezone` as IANA-valid (returns 400 on failure).
3. Writes `scheduling_prefs` JSONB to `users` table for `userId`.
4. Returns 200.

**Success response:**
```json
{ "success": true }
```

**Error responses:**
| Status | Condition | Body |
|--------|-----------|------|
| 400 | Zod validation failure | `{ "error": "Validation failed", "details": <ZodFlatError> }` |
| 400 | Invalid IANA timezone | `{ "error": "Invalid timezone — please reload the page and try again." }` |
| 401 | Not authenticated | `{ "error": "Unauthorized" }` |
| 500 | Supabase write failure | `{ "error": "Failed to save preferences" }` |

---

### 7b. `POST /api/sessions/schedule` — EXISTING endpoint, modified

**Current behaviour:** Deletes all rows where `status = 'scheduled'`, then inserts the new set.

**Required changes:**

**Change 1 — Skip completed/active indexes on delete:**
```typescript
// BEFORE (current):
await supabase.from('sessions').delete()
  .eq('user_id', userId).eq('status', 'scheduled')

// AFTER: same — only deletes 'scheduled' rows, leaves 'completed' and 'active' untouched.
// This is already correct. No change needed to the delete clause.
```

**Change 2 — Skip insert for indexes already covered by completed/active rows:**
Before inserting, fetch the set of `session_index` values that are already `completed` or `active`:
```typescript
const { data: protectedRows } = await supabase
  .from('sessions')
  .select('session_index')
  .eq('user_id', userId)
  .in('status', ['completed', 'active'])

const protectedIndexes = new Set((protectedRows ?? []).map(r => r.session_index))

const rows = parsed.data.sessions
  .filter(s => !protectedIndexes.has(s.sessionIndex))
  .map(s => ({ ... }))
```

**Change 3 — Guard duplicate `distill/session.content.generate` for Session 1:**

The current code fires `distill/session.content.generate` unconditionally for the session at `session_index = 1`. Change this to only fire if Session 1 is NOT already in `completed` or `active` status:

```typescript
if (firstSessionId && firstSession?.topicId && !protectedIndexes.has(1)) {
  // fire the event
}
```

**No other changes to this endpoint.** The Zod schema, auth, confirmation email/SMS, and `distill/session.scheduled` events remain unchanged.

**Error responses (new):**
| Status | Condition | Body |
|--------|-----------|------|
| 409 | Unique index violation on insert | `{ "error": "Schedule conflict — some sessions already exist at those indexes." }` |

---

### 7c. `GET /api/user/schedule-prefs` — NEW endpoint (for Settings page)

**Purpose:** Return the current `scheduling_prefs` for the authenticated user.

**Auth:** Required.

**Success response:**
```json
{
  "schedulingPrefs": {
    "selectedDays": [1, 2, 3, 4, 5],
    "preferredHour": 9,
    "preferredMinute": 0,
    "ampm": "AM",
    "maxDurationMins": 30,
    "timezone": "America/New_York"
  }
}
```

If `scheduling_prefs IS NULL`:
```json
{ "schedulingPrefs": null }
```

**Error responses:**
| Status | Condition |
|--------|-----------|
| 401 | Not authenticated |
| 500 | Supabase read failure |

---

## 8. Migration

### Migration file: `032_schedule_setup_gate.sql`

```sql
-- 1. Unique index to prevent duplicate (user_id, session_index) rows
--    among sessions that are not completed or cancelled.
--    A completed session at index 3 can coexist with a scheduled session at index 3
--    only if one is completed/cancelled and one is scheduled (edge case: shouldn't
--    happen in practice, but we allow it to avoid blocking re-runs after completion).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_session_index
  ON sessions (user_id, session_index)
  WHERE status NOT IN ('completed', 'cancelled');

-- 2. Column to track whether the 24h schedule nudge email has been sent.
--    NULL = not sent. Non-null = timestamp when it was sent.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS schedule_nudge_sent_at TIMESTAMPTZ;
```

**Apply order:** This migration must be applied before deploying any code that references `schedule_nudge_sent_at` or relies on the unique index. The unique index is `IF NOT EXISTS` and the column is `ADD COLUMN IF NOT EXISTS` — both are safe to apply on a live database with minimal locking.

**Risk:** If existing data already has duplicate `(user_id, session_index)` pairs with non-completed/cancelled status, the index creation will fail. Run this query first to check:
```sql
SELECT user_id, session_index, COUNT(*)
FROM sessions
WHERE status NOT IN ('completed', 'cancelled')
GROUP BY user_id, session_index
HAVING COUNT(*) > 1;
```
If rows are returned, clean them up before applying the migration (keep the most recent `created_at` per pair, delete the others).

---

## 9. Email Nudge Spec

### Trigger

Fires from an Inngest cron function named `schedule-setup-nudge`, scheduled at `"0 * * * *"` (runs every hour).

**Idempotency mechanism:** The function queries for users who match ALL of the following:
```sql
SELECT id, email
FROM users
WHERE plan_approved = true
  AND scheduling_prefs IS NULL
  AND schedule_nudge_sent_at IS NULL
  AND plan_approved_at < NOW() - INTERVAL '24 hours'
```

(`plan_approved_at` must be queryable — this column was set in `/api/plan/approve`: `approved_at` on `curriculum_plans`. Add a denormalized `plan_approved_at TIMESTAMPTZ` column to `users` in the same migration, written by `POST /api/plan/approve` alongside `plan_approved = true`. Alternatively, join to `curriculum_plans` — either approach is acceptable; denormalized column is simpler.)

After sending the email for a user, immediately write `schedule_nudge_sent_at = NOW()` to `users`. The cron will never select that user again because `schedule_nudge_sent_at IS NULL` will be false.

**Timing:** The cron runs hourly. A user who approves their plan at 10:03 AM will be picked up by the 11:00 AM cron if it's been ≥24h, i.e., the 11:00 AM cron on the following day. Maximum delay beyond 24h is 59 minutes — acceptable.

**Inngest function ID:** `schedule-setup-nudge`
**Event name (not triggered by event — cron only):** N/A
**Retry config:** `{ retries: 2 }` — nudges are best-effort; don't retry aggressively.

### Email content outline

**Subject:** "Your Clio sessions are waiting — set your schedule"
**From:** `hello@getdistill.ai` / "Clio"
**Template:** New React Email template `ScheduleNudgeEmail`

Body structure:
1. Opening: "Your learning plan is approved and your sessions are ready to go."
2. Problem statement: "One thing is missing — we need your preferred days and time so we can give each session a real date."
3. Single CTA button: "Set up my schedule" → `${NEXT_PUBLIC_APP_URL}/dashboard/schedule-setup`
4. Reassurance: "It takes about 15 seconds."
5. Footer: standard Clio footer with unsubscribe link.

**No SMS nudge** — out of scope per CEO brief.

---

## 10. Edge Cases

**EC-1: User has no sessions (plan approved but session design failed)**
- `POST /api/sessions/schedule` receives an empty `sessions` array — Zod rejects it with `.min(1)` — returns 400.
- The setup screen should not show if `sessions` table has zero rows for this user. The server component for `/dashboard/schedule-setup` should check: if `sessions` count = 0, redirect to `/dashboard/plan` with a query param `?error=no-sessions`.
- This is an anomaly state; the user needs to re-approve their plan.

**EC-2: User with all sessions completed**
- `protectedIndexes` contains all session indexes.
- The filtered `rows` array is empty after removing protected indexes.
- `POST /api/sessions/schedule` inserts zero rows — this is valid. The unique index is not violated.
- No `distill/session.content.generate` event is fired (index 1 is protected).
- Response: `{ success: true, count: 0 }`.
- The client should show the dashboard normally. The sessions page will show only completed sessions.

**EC-3: User changes preferences multiple times in rapid succession**
- Each call to `POST /api/user/schedule-prefs` overwrites `scheduling_prefs` — last write wins. No race condition risk because it's a simple column update.
- Each call to `POST /api/sessions/schedule` deletes all `status = 'scheduled'` rows and re-inserts. If two calls execute concurrently, the unique index prevents duplicate inserts — one call gets a 409. The client should treat a 409 as a transient error and prompt the user to try again.
- Nudge: `schedule_nudge_sent_at` is written on first send. Subsequent changes to prefs do not reset this column — the nudge is sent at most once per user lifetime.

**EC-4: Browser returns a non-IANA timezone string**
- Some older browsers return `"GMT+5:30"` or `"UTC"` from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `"UTC"` is a valid IANA timezone string — accepted.
- `"GMT+5:30"` is not a valid IANA timezone — the `new Intl.DateTimeFormat(undefined, { timeZone: value })` constructor throws — the API returns 400 with the message "Invalid timezone — please reload the page and try again."
- The client displays the inline error. No automatic fallback to UTC on the client — the user must reload. (Auto-fallback to UTC would silently schedule sessions at the wrong time, which is worse than an explicit error.)

**EC-5: User navigates away from `/dashboard/schedule-setup` mid-flow**
- `scheduling_prefs` remains null.
- On next visit to `/dashboard/sessions` or `/dashboard`, the blocking banner / warning card appears.
- The user can return to `/dashboard/schedule-setup` at any time to complete setup.

**EC-6: Plan approved but user closes the browser before redirect completes**
- The plan approval API has already run; `plan_approved = true`. Sessions exist with `scheduled_at = null`.
- On next login, the server component for `/dashboard/sessions` detects `scheduling_prefs IS NULL` and shows the blocking banner.
- `/dashboard/schedule-setup` is accessible directly at any time.

**EC-7: `scheduleSessions()` returns fewer sessions than exist in DB (e.g. plan was expanded)**
- Sessions at higher indexes that were not included in the `scheduledSession[]` array are not touched (they are not deleted because the delete clause only removes `status = 'scheduled'` rows — and if any at those indexes existed, they'd be deleted; the new call just doesn't re-insert them).
- This is acceptable. The user can re-run setup again via Settings if needed.

**EC-8: `maxDurationMins` shorter than session's designed `duration_mins`**
- `scheduleSessions()` already handles this: `cappedMinutes = Math.min(session.estimatedMinutes, prefs.maxDurationMins)`. Sessions are capped. Correct behaviour, no edge case handling needed.

---

## 11. Open Questions

_None. All questions resolved from the CEO brief and technical audit._

---

## 12. Out of Scope

The following are explicitly NOT part of this feature:

- **Calendar integrations** — no Google Calendar sync, no iCal export, no meeting auto-creation as part of setup (the existing `session-meeting-setup` Inngest job is separate and unchanged).
- **Per-session date/time override** — every session gets a date derived from the recurring weekly pattern. Individual session rescheduling is a future feature.
- **SMS nudges** — the 24h nudge is email-only.
- **Admin tooling** — no admin dashboard view of which users have/haven't completed setup.
- **Onboarding capture of scheduling prefs** — scheduling prefs are captured post-approval only, not during the onboarding questionnaire (per CEO brief).
- **Frequency mode (`frequencyDays`)** — the legacy "every N days" mode in `SchedulePreferences` is not exposed in the UI. The day-of-week picker is the only mode. `frequencyDays` is passed as `7` as a safe fallback internal value only.
- **Timezone editing** — the timezone is auto-detected from the browser and shown read-only. Users cannot manually override it in this version.
- **Multiple schedule profiles** — one schedule preference set per user. No per-arc or per-topic variation.

---

_End of Requirement Document — SCH-01_
