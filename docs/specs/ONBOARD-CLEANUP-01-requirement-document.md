# Abandoned Onboarding Cleanup — Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-06-29

---

## 1. Purpose

When a user completes the 7-step onboarding flow and creates a Clerk account — but exits before completing payment — the system is left with a permanent ghost row in the `users` table, an active Clerk account the user no longer returns to, and stale `clio_onboarding` data in their browser's localStorage. These orphaned records accumulate indefinitely, pollute the users table, and — critically — block re-entry: if the same user tries to restart onboarding later with the same email or Google account, Clerk already holds their account and Supabase already holds their row, causing unpredictable behaviour in the onboarding flow.

This feature implements a three-part automated cleanup: a server-side Inngest job that deletes the Supabase user row and the Clerk account 75 minutes after creation (if payment has not arrived), a Stripe-payment cancellation signal that aborts the cleanup job the moment payment succeeds, and a client-side hook that detects the now-invalid Clerk session on the user's next visit and clears the orphaned localStorage key.

Without this feature the proportion of ghost rows grows linearly with the number of users who reach the payment screen and leave. The resulting data noise affects analytics, and the re-entry breakage is a direct conversion loss.

---

## 2. User Story

**Abandoned user (primary)**
As a user who started onboarding but left before paying,
I want to be able to return later and start fresh with the same email address,
So that I am not stuck in a broken state where Clio thinks I already have an account.

**Paying user (safety)**
As a user who completed payment within the hour,
I want the cleanup job to never touch my account,
So that my subscription, sessions, and profile are never deleted.

**Arun (operator)**
As the product owner,
I want ghost rows older than 75 minutes with no payment to be automatically removed,
So that the users table reflects only real, paying or recently-started accounts.

---

## 3. Trigger / Entry Point

**Server-side job (Part A)**
- Triggered by: a `clio/user.created` Inngest event emitted from `app/api/webhooks/clerk/route.ts` immediately after the Supabase upsert succeeds for a `user.created` Clerk webhook event.
- The Inngest function wakes automatically 75 minutes after the event is received.
- No user-facing URL. No manual trigger. Fully automated.

**Payment cancellation signal (Part A — abort)**
- Triggered by: a `clio/onboarding.completed` Inngest event emitted from `app/api/webhooks/stripe/route.ts` immediately after a `customer.subscription.created` event is processed successfully.
- This event is used as the `cancelOn` signal to abort the sleeping cleanup function before it executes deletion.

**Client-side localStorage clear (Part B)**
- Triggered by: the Clerk `useAuth()` hook returning `isSignedIn === false` on any page load after the server-side cleanup has deleted the user's Clerk account.
- Entry points: any page in the app that the returning user may land on — `/`, `/topics`, `/plan`, `/dashboard`, or any other route. The detection logic lives in `app/layout.tsx` via a dedicated `useCleanupOrphanedProfile` hook so it runs universally.
- The user does not need to be on any specific page for this to fire.

**Preconditions for deletion to execute:**
- `users.subscription_status = 'inactive'` at the moment of the 75-minute check
- `users.stripe_customer_id IS NULL` at the moment of the 75-minute check
- `users.created_at` is within the last 2 hours (belt-and-suspenders guard against operating on old rows)
- The `clio/onboarding.completed` cancel event has NOT been received for this user's Inngest run

---

## 4. Screen / Flow Description

This feature has no new user-facing screens. The flows below describe the system behaviour from the moment a user creates an account through to either cleanup or safe continuation.

### Flow A — User abandons at payment (cleanup fires)

**Step 1 — Account creation (T+0)**
The user completes onboarding questions and signs up via Clerk (Google OAuth or email). The Clerk `user.created` webhook fires and hits `app/api/webhooks/clerk/route.ts`. The handler:
1. Verifies the svix signature.
2. Upserts a row into `users` with `id` (Clerk user ID), `email`, `phone` (if present). The row is created with `subscription_status = 'inactive'` (the column default) and `stripe_customer_id = NULL`.
3. Sends the signup welcome email via `sendSignupWelcomeEmail`.
4. Emits `clio/user.created` event to Inngest with payload `{ userId, email, createdAt }`.

**Step 2 — Inngest job begins sleeping (T+0)**
The `abandonedOnboardingCleanup` Inngest function receives the `clio/user.created` event and immediately calls `step.sleep('wait-for-payment', '75m')`. The function is now dormant. Inngest holds the run and will resume it at T+75 minutes unless the `cancelOn` signal arrives first.

**Step 3 — User exits at payment screen (T+0 to T+75)**
The user sees the payment page but does not complete payment. They close the tab or navigate away. Nothing happens in the system during this window.

**Step 4 — Cleanup check fires (T+75)**
Inngest wakes the function. The function executes `step.run('check-and-delete', ...)`:

4a. Fetch the user row from Supabase using the `userId` from the event payload.
4b. If the row does not exist: the user was already deleted (duplicate event scenario). Log `[onboarding-cleanup] User {userId} already deleted — skipping` and exit.
4c. If `subscription_status` is NOT `'inactive'`, OR `stripe_customer_id` is NOT NULL, OR `created_at` is more than 2 hours ago: log `[onboarding-cleanup] User {userId} has active or converted subscription — skipping` and exit. No deletions occur.
4d. If all guards pass: proceed with deletion in this order:
  - Delete the `users` row from Supabase via the admin client: `supabase.from('users').delete().eq('id', userId)`. The `ON DELETE CASCADE` foreign keys on `sessions`, `user_learning_plans`, `delivery_log`, `sms_conversations`, `feedback_weights`, `user_learning_profiles` cascade the delete automatically. (See Section 9 for the confirmed list of tables with cascade.)
  - Delete the Clerk account: `clerkClient.users.deleteUser(userId)`. Clerk revokes all active sessions for this user as part of the deletion. No separate session revocation call is needed.
4e. Log `[onboarding-cleanup] Deleted ghost user {userId} ({email}) at T+75m`.

**Step 5 — User returns (any time after T+75)**
The user navigates back to any Clio URL. Their Clerk session cookie is now invalid (the Clerk account was deleted). Clerk's `useAuth()` hook detects this and sets `isSignedIn = false`.

The `useCleanupOrphanedProfile` hook (mounted in `app/layout.tsx`) detects `isSignedIn === false` and the presence of the `clio_onboarding` key in `localStorage`. It calls `localStorage.removeItem('clio_onboarding')`. This fires once; the key is gone. The user sees the unauthenticated state of whatever page they landed on (for protected routes, `middleware.ts` redirects them to `/sign-in`).

**Step 6 — User re-onboards**
The user clicks "Get started" or navigates to `/sign-in`. Because the Clerk account was deleted, Clerk treats their email address as new. They complete onboarding as a brand-new user. A new Clerk user ID is issued. A new Supabase row is created. No conflicts.

---

### Flow B — User completes payment before T+75 (cleanup is cancelled)

**Step 1 — Account creation (T+0)**
Identical to Flow A Step 1. The `clio/user.created` event is emitted and the Inngest function begins sleeping.

**Step 2 — User completes payment (T+0 to T+75)**
The user submits payment. The Stripe `customer.subscription.created` webhook fires and hits `app/api/webhooks/stripe/route.ts`. The existing handler updates the `users` row (`subscription_status = 'trialing'` or `'active'`, `stripe_customer_id` set). After the Supabase update succeeds, the handler emits `clio/onboarding.completed` with payload `{ userId }`.

**Step 3 — Inngest cancels the sleeping function**
Inngest receives `clio/onboarding.completed` and matches it against the `cancelOn` rule configured on the `abandonedOnboardingCleanup` function. The sleeping run for this `userId` is cancelled. The cleanup function never executes the check-and-delete step. The user's data is untouched.

---

## 5. Visual Examples

This feature has no new user-facing screens. The only observable client-side effect (localStorage clear) is invisible to the user. The flows are entirely server-side or transparent browser state transitions.

For completeness, the state the returning-abandoned-user sees on their next visit is identical to an unauthenticated user:

```
┌─────────────────────────────────────────────────────┐
│  (User lands on / after cleanup)                    │
│                                                     │
│  [Clio marketing landing page — unauthenticated]    │
│                                                     │
│  "AI, distilled."                                   │
│  "15 seconds a day. Zero jargon. Total confidence." │
│                                                     │
│  [PRIMARY BUTTON: "Start free — no card needed"]    │
│  [Link: "Sign in"]                                  │
│                                                     │
│  (localStorage 'clio_onboarding' has been cleared) │
└─────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────┐
│  (User lands on /dashboard after cleanup)           │
│                                                     │
│  [Clerk middleware detects isSignedIn = false]      │
│  [Redirect → /sign-in]                              │
│                                                     │
│  Sign in to Clio                                    │
│                                                     │
│  [Google OAuth button]                              │
│  [Email input]                                      │
│  [Continue button]                                  │
└─────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

### Reads

| Source | Table / Key | Columns read | When |
|---|---|---|---|
| Supabase | `users` | `id`, `subscription_status`, `stripe_customer_id`, `created_at`, `email` | At T+75 before deciding whether to delete |
| Inngest event payload | `clio/user.created` | `userId`, `email`, `createdAt` | On function wake |
| localStorage | `clio_onboarding` | presence check only | On client mount in layout |

### Writes

| Destination | Operation | When |
|---|---|---|
| Supabase `users` | `DELETE WHERE id = userId` | T+75, only if guards pass |
| Supabase child tables | Cascade delete (automatic) | Same transaction as users delete |
| Clerk | `deleteUser(userId)` | After Supabase delete succeeds |
| localStorage | `removeItem('clio_onboarding')` | On client mount, when `isSignedIn === false` and key exists |

### Events emitted

| Event name | Emitted from | Payload | Purpose |
|---|---|---|---|
| `clio/user.created` | `app/api/webhooks/clerk/route.ts` | `{ userId: string, email: string, createdAt: string }` | Triggers the cleanup function |
| `clio/onboarding.completed` | `app/api/webhooks/stripe/route.ts` | `{ userId: string }` | Cancels the sleeping cleanup function |

### Inngest function configuration

- **Function ID:** `abandoned-onboarding-cleanup`
- **Function name:** `Abandoned Onboarding Cleanup`
- **Trigger:** event `clio/user.created`
- **Idempotency / concurrency key:** `event.data.userId` — Inngest deduplicates on this key so a retried Clerk webhook delivery does not schedule a second cleanup run for the same user
- **cancelOn:** `{ event: 'clio/onboarding.completed', match: 'data.userId' }` — cancels the run when payment succeeds for this specific user
- **Retries:** 2 (the check-and-delete step; not the sleep)
- **Sleep duration:** `'75m'` — well within Inngest's supported maximum sleep duration of 1 year

### Cascade-confirmed child tables (all carry `ON DELETE CASCADE`)

The following tables reference `users(id)` with `ON DELETE CASCADE` and will be automatically cleaned when the `users` row is deleted. All of them are confirmed empty for a user who has never paid, because every write to these tables is gated behind subscription activation or session scheduling — neither of which can occur without payment:

| Table | Migration | Notes |
|---|---|---|
| `sessions` | 002 | Created only after plan approval, which requires payment |
| `user_learning_plans` | 001 | Created only after onboarding completion with active plan |
| `delivery_log` | 001 | Created only when content is delivered (requires active subscription) |
| `sms_conversations` | 001 | Created only on Twilio inbound/outbound (requires subscription) |
| `feedback_weights` | 001 | Created only after feedback on delivered content |
| `user_learning_profiles` | 017 | Created only after session completion |

The following tables do NOT reference `users(id)` and are NOT affected by the cascade:

| Table | Reason unaffected |
|---|---|
| `topic_content_cache` | Keyed by `topic_id` + `subtopic_slug`, no `user_id` foreign key |
| `content_profile_cache` | Keyed by `profile_key` (role+domain+proficiency hash), no `user_id` FK |
| `content_items` | Global shared table, no `user_id` foreign key |
| `role_topic_cache` | Keyed by role+industry+maturity, no `user_id` foreign key |

### Twilio phone number assignment — confirmed pre-payment behaviour

`lib/delivery/sms.ts` → `assignPhoneNumber()` is a pure in-process function that returns a number from the pool using a hash of the user ID. It does NOT persist anything to the database and does NOT call the Twilio API. The actual assignment is stored in `users.twilio_number_assigned` only when the onboarding API route writes it. Reviewing the onboarding flow: the `/api/onboarding` route assigns a Twilio number only for Pro/Executive plans, and plan tier is not set until `customer.subscription.created` updates the row. Therefore, no Twilio number is persisted to `users.twilio_number_assigned` before payment, and no Twilio release action is needed during cleanup.

---

## 7. Success Criteria (Acceptance Tests)

**AC-1 — Happy path: cleanup fires for unpaid user**
Given a user created a Clerk account at T+0 and did not complete payment,
When 75 minutes have elapsed,
Then the `users` row with that `id` does not exist in Supabase, the Clerk account for that `id` does not exist, and all cascade-linked child rows (if any existed) are gone.

**AC-2 — Paying user is never touched**
Given a user created a Clerk account at T+0 and completed payment at T+30 (Stripe `customer.subscription.created` fires, `stripe_customer_id` is set, `subscription_status = 'trialing'`),
When 75 minutes have elapsed,
Then the `users` row still exists with `subscription_status = 'trialing'` and the Clerk account is active and unrevoked.

**AC-3 — cancelOn fires before sleep completes**
Given the `clio/onboarding.completed` event is emitted with a matching `userId` at T+30,
When the Inngest function's 75-minute sleep would have ended,
Then the Inngest run shows status `cancelled` and no deletion was attempted.

**AC-4 — Guard: cancelled subscriber is never deleted**
Given a user has `subscription_status = 'inactive'` but `stripe_customer_id IS NOT NULL` (they once paid, then cancelled),
When the cleanup job evaluates this user,
Then it logs `skipping` and exits without deleting the Supabase row or the Clerk account.

**AC-5 — Guard: old inactive rows are never deleted**
Given a user row has `subscription_status = 'inactive'`, `stripe_customer_id IS NULL`, but `created_at` is more than 2 hours ago (a pre-existing ghost row from before this feature was deployed),
When the cleanup job evaluates this user,
Then it logs `skipping` and exits without deleting.

**AC-6 — Idempotency: duplicate Clerk webhook does not double-schedule**
Given the Clerk webhook fires twice for the same `user.created` event (Clerk retry scenario),
When both events reach the Inngest function,
Then only one cleanup run is active for that `userId` (Inngest deduplicates on the concurrency key); the second event is a no-op.

**AC-7 — Idempotency: user already deleted at check time**
Given the `users` row no longer exists at T+75 (e.g. deleted by an admin tool),
When the cleanup function executes the check-and-delete step,
Then the function logs `already deleted — skipping` and exits without error; no Clerk API call is made.

**AC-8 — localStorage cleared on return visit**
Given a user's Clerk account was deleted by the cleanup job,
When that user navigates to any Clio page,
Then `localStorage.getItem('clio_onboarding')` returns `null` after the page loads.

**AC-9 — Re-onboarding works cleanly**
Given a user whose Clerk account and Supabase row were cleaned up,
When that user signs up again with the same email address,
Then Clerk issues a new user ID, a new Supabase row is created with that new ID, and the onboarding flow completes without conflict.

**AC-10 — Protected routes redirect unauthenticated returning user**
Given a user's Clerk account was deleted,
When that user navigates directly to `/dashboard`,
Then `middleware.ts` detects `isSignedIn = false` and redirects to `/sign-in` with no 500 error.

**AC-11 — Inngest event emission does not block webhook response**
Given the Clerk webhook handler completes the Supabase upsert,
When it emits `clio/user.created` to Inngest,
Then the webhook handler still returns `200 { received: true }` within normal response time even if the Inngest emit call is slow (emit should be fire-and-forget with `.catch(console.error)`).

**AC-12 — Stripe webhook emits cancel event after subscription created**
Given the Stripe `customer.subscription.created` webhook fires for a user,
When the `users` row is updated successfully,
Then `clio/onboarding.completed` is emitted to Inngest with the correct `userId` in the payload.

---

## 8. Error States

### Inngest event emission fails (Clerk webhook)
If `inngest.send({ name: 'clio/user.created', ... })` throws or rejects, the error must be caught and logged with `console.error('[clerk-webhook] Failed to emit clio/user.created:', err)`. The webhook handler must still return `200 { received: true }`. The consequence is that the cleanup job is not scheduled for this user — accepted as a rare edge case. Do not throw; do not return a non-200 status to Clerk.

### Supabase delete fails at T+75
If `supabase.from('users').delete().eq('id', userId)` returns an error, the function must log `[onboarding-cleanup] Supabase delete failed for {userId}: {error.message}` and NOT proceed to call `clerkClient.users.deleteUser`. The Inngest retry mechanism (2 retries, default exponential backoff) will re-attempt the entire `step.run` block. If all retries fail, the run is marked failed in Inngest's dashboard — Arun can inspect from there.

### Clerk delete fails at T+75
If `clerkClient.users.deleteUser(userId)` throws (e.g. user already deleted on Clerk's side, or API error), the function must catch the error, log `[onboarding-cleanup] Clerk delete failed for {userId}: {error.message}`, and allow the Inngest retry to re-attempt. The Supabase row has already been deleted at this point; on retry, Step 4b (row not found) will catch this and exit gracefully without re-attempting the Clerk call. This is safe because the user data is already gone from Supabase.

### cancelOn event arrives after deletion has already started
If `clio/onboarding.completed` arrives after the `step.sleep` resolves but before the `step.run` check-and-delete completes, Inngest's `cancelOn` only cancels between steps — not mid-step. The check-and-delete step will complete. However, at this point the user has paid (that is what triggered `onboarding.completed`), so `subscription_status` will be `'trialing'` or `'active'` and `stripe_customer_id` will be set. The guard in step 4c will fire and the function will exit without deleting. The paying user is safe.

### Stripe webhook is slow (arrives after T+75 check but before function deletes)
The cleanup function re-checks the database inside `step.run` at the moment of execution, not at the moment of scheduling. If the Stripe webhook updates `subscription_status` to `'trialing'` or sets `stripe_customer_id` in the milliseconds between the Inngest function waking and the Supabase `SELECT` being evaluated, the guard sees the updated value and exits. The 75-minute window (15 minutes beyond the originally specified 60 minutes) provides additional buffer. The double-check on both `subscription_status` and `stripe_customer_id IS NULL` ensures that even if one column update races, the other catches it.

### User returns before cleanup fires (T+0 to T+75) — session still valid
During the 75-minute window, the user's Clerk session is still valid. If they return and navigate to `/dashboard`, they will see the dashboard normally (they are authenticated, just unpaid). The dashboard's existing plan-gate logic handles the unpaid state. This is expected behaviour and is not an error.

### localStorage clear runs when no key exists
`localStorage.removeItem('clio_onboarding')` is a no-op if the key does not exist. No error handling needed.

### Inngest `cancelOn` event emitted for a user who never had a cleanup scheduled
If `clio/onboarding.completed` is emitted for a user whose cleanup function was never started (e.g. the `clio/user.created` event was never emitted due to the emission failure case above), Inngest finds no matching run to cancel and silently ignores the event. No error.

---

## 9. Edge Cases

**Clerk webhook retry — duplicate `clio/user.created` events**
Clerk retries webhooks on non-200 responses. If a transient error causes a retry, two `clio/user.created` events with the same `userId` will reach Inngest. The function uses `{ concurrencyKey: event.data.userId }` to ensure only one active run per user. The second event triggers a new run that immediately finds the first run already active and is queued or deduplicated per Inngest's concurrency rules. The developer must set `concurrency: { key: 'event.data.userId', limit: 1 }` in the function configuration.

**User who signed up before this feature was deployed (pre-existing ghost rows)**
Ghost rows that existed before this feature was deployed will have `created_at` timestamps older than 2 hours. The `created_at < NOW() - INTERVAL '2 hours'` guard prevents the cleanup job from ever operating on them. Pre-existing ghost rows are out of scope for automated cleanup; a one-time manual SQL cleanup can be run separately if needed.

**User who signs up on mobile and desktop simultaneously**
Two Clerk sessions are created for the same user. When the Clerk account is deleted, both sessions are revoked. Both browser instances will detect `isSignedIn = false` on next interaction. Both will clear `localStorage.clio_onboarding` (or one instance may not have the key if onboarding was only done on one device). Both outcomes are safe.

**User who completes payment exactly at T+75 (true race)**
The `step.run` check-and-delete is a database read followed by conditional deletes. If the Stripe webhook arrives and writes to the `users` row between the Inngest function waking and the database SELECT completing (a sub-second window), the guard will still see the updated row because the Supabase SELECT runs after the sleep resolves. In practice this window is extremely narrow. The `stripe_customer_id IS NULL` guard provides an additional layer: Stripe always sets `stripe_customer_id` on `customer.subscription.created`, so any payment will populate this column before our SELECT.

**User who signs in with Google OAuth and has no `clio_onboarding` localStorage data**
Some users may create a Clerk account by clicking "Sign in with Google" on the landing page without going through the onboarding flow (e.g. if a direct `/sign-in` link is shared). These users will have a `users` row with `subscription_status = 'inactive'` and `stripe_customer_id = NULL`. The cleanup job will delete them at T+75 if they do not pay. This is the correct and intended behaviour — an account with no onboarding data and no payment has no value to preserve.

**User who is in the middle of the 7-step onboarding at T+75**
The Clerk account is created after the user completes step 7 and clicks "Sign up". If the user is still actively filling out earlier steps at T+75, they have not created a Clerk account yet (no `user.created` event was fired), so no cleanup is scheduled. This edge case cannot occur.

**`useCleanupOrphanedProfile` hook fires on every page load**
The hook checks `isSignedIn` (from Clerk's `useAuth`) and whether `localStorage.getItem('clio_onboarding')` is non-null on every mount. This is a fast, synchronous check. When `isSignedIn === true` (normal authenticated user), the hook does nothing. The only write (`removeItem`) happens when both conditions are true simultaneously. There is no risk of accidentally clearing localStorage for authenticated users.

**Twilio number assignment — confirmed no action needed**
As confirmed in Section 6: `assignPhoneNumber()` does not write to Supabase or call the Twilio API. No phone numbers are persisted to `users.twilio_number_assigned` before payment confirmation. No Twilio release action is required during cleanup.

**Child rows written before payment (theoretical)**
Curriculum plan generation is triggered by `clio/topics.selected` or `customer.subscription.created` — both require payment. Session rows are created only after plan approval, which requires an active subscription. Delivery log, SMS conversations, and feedback weights require an active subscription for any content to be sent. As of the current codebase, no child rows can exist for a user who has never paid. The cascade delete is safe and expected to delete zero child rows.

---

## 10. Out of Scope

- **Users who paid and then cancelled.** A user with `stripe_customer_id IS NOT NULL` is never touched by this feature, regardless of their `subscription_status`. The Stripe webhook sets `stripe_customer_id` during `customer.subscription.created` and that value is never cleared. Cancelled subscribers retain their Clerk account, their Supabase row, and all their session history.

- **Pre-existing ghost rows.** Rows with `created_at` older than 2 hours that existed before this feature was deployed are not cleaned up by the automated job. A separate manual migration or one-time SQL script would be required to clean those rows and is not part of this feature.

- **Recovery email to abandoned user.** No "you left before completing payment — come back" email is sent. The cleanup is silent from the user's perspective.

- **Admin dashboard or reporting.** No UI for viewing cleaned-up users, cleanup run history, or ghost row counts is in scope.

- **Re-entry UX enhancements.** When the returning user signs up again, they see the standard onboarding flow. There is no "welcome back" message, no pre-filled fields from their previous attempt, and no indication that they had a previous account. That would require a separate feature.

- **Partial Clerk webhook failure.** If the Clerk webhook fires but the Supabase upsert fails (no `users` row is created), there is nothing for this cleanup to act on. That is a separate reliability concern.

- **Phone-based Twilio number release.** As confirmed in Section 6, no phone numbers are assigned before payment. This is explicitly out of scope.

- **Admin auth bypass and debug routes.** Pre-production cleanup of hardcoded admin bypass routes is tracked separately in the Pre-Production Cleanup Checklist and is not part of this feature.

- **Modification of the welcome email content or timing.** The welcome email (`sendSignupWelcomeEmail`) continues to fire immediately on `user.created` as it does today. Per the decision in the prompt context: the "plan ready" email fires after curriculum generation (post-payment), and the signup welcome email (which fires on account creation) is accepted as tolerable friction even if the user is later cleaned up. No change to email behaviour is in scope.

---

## 11. Open Questions

None. All questions from the Feature Brief have been answered and incorporated into this document.

---

## 12. Dependencies

**Must exist before this can be built:**

1. **`app/api/webhooks/clerk/route.ts`** — exists. Requires modification to emit `clio/user.created` after the Supabase upsert succeeds.

2. **`app/api/webhooks/stripe/route.ts`** — exists. Requires modification to emit `clio/onboarding.completed` after `customer.subscription.created` updates the `users` row successfully.

3. **`inngest/client.ts`** — exists. The `inngest` client instance is already initialised with `id: 'clio'` and is used by all existing functions. The new function imports this same client.

4. **`app/api/inngest/route.ts`** — exists. The new `abandonedOnboardingCleanup` function must be imported and added to the `functions` array in the `serve()` call. Without this, Inngest cannot discover or execute the function.

5. **`@clerk/nextjs` Clerk Backend API** — the `clerkClient` from `@clerk/nextjs/server` must be available and `CLERK_SECRET_KEY` must be set in the environment. This is already in use in the codebase for other Clerk server-side calls.

6. **`createSupabaseAdminClient()`** — exists in `lib/supabase.ts`. The cleanup function uses the admin client (service role) to perform the delete, bypassing RLS. This pattern is already used in all webhook handlers.

7. **`useAuth` from `@clerk/nextjs`** — already imported in client components throughout the app. The `useCleanupOrphanedProfile` hook depends on it.

8. **No database migration required.** All columns read by the guard (`subscription_status`, `stripe_customer_id`, `created_at`) exist in the `users` table from migration 001. No new columns or tables are needed.

9. **Inngest `cancelOn` feature** — available in the version of the `inngest` package already installed. The developer must confirm the installed version supports `cancelOn` in `createFunction` options (supported since Inngest SDK v3+).

**Files to be created:**

- `inngest/abandoned-onboarding-cleanup.ts` — the new Inngest function

**Files to be modified:**

- `app/api/webhooks/clerk/route.ts` — add `clio/user.created` event emission after successful upsert
- `app/api/webhooks/stripe/route.ts` — add `clio/onboarding.completed` event emission inside `customer.subscription.created` case, after the Supabase update succeeds
- `app/api/inngest/route.ts` — import and register `abandonedOnboardingCleanup` in the `serve()` functions array
- `app/layout.tsx` — mount the `useCleanupOrphanedProfile` hook (or import and use it in the root client layout)

**New file to be created (client-side):**

- `hooks/useCleanupOrphanedProfile.ts` — a React hook that calls `useAuth()`, checks `isSignedIn`, and removes `localStorage.clio_onboarding` when the session is invalid

---

*ONBOARD-CLEANUP-01 Requirement Document | Business Analyst Agent | 2026-06-29 | Status: APPROVED*
