# Feature Brief: ONBOARD-CLEANUP-01 — Abandoned Onboarding Cleanup
From: CEO Agent (on behalf of Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-06-29

---

## What Arun Said

> "If a user starts onboarding but does not complete payment within 1 hour, automatically:
> 1. Clear their `clio_onboarding` localStorage data (client-side on next visit)
> 2. Delete their Supabase user record
> 3. Sign them out of Clerk (revoke the session)
>
> Example: user starts onboarding at 6pm, exits at the payment screen. If no payment by 7pm → cleanup fires."

---

## The Problem Being Solved

When an anonymous user completes the 7-step onboarding flow and signs up via Clerk (Google or email), the `user.created` Clerk webhook fires immediately and upserts a row into the `users` table in Supabase. At this point the user has a Clerk account, a Supabase `users` row, and `clio_onboarding` data sitting in localStorage — but has not paid.

If that user exits at the payment screen and never completes payment, the system is left with:

1. **A ghost row in `users`** with `subscription_status = 'inactive'` that will never become active. This pollutes the users table indefinitely.
2. **A live Clerk account** that the user is technically still signed into, even though they have no subscription.
3. **Stale `clio_onboarding` localStorage data** on the user's browser that references an onboarding flow they never completed.

The practical consequence: if the same user later tries to onboard again with the same email or Google account, they hit a conflict. Clerk already has their account. The Supabase row already exists. The onboarding flow may behave unpredictably. The intended user experience — "come back and start fresh" — is broken.

This is a data hygiene and re-entry UX problem. It grows in proportion to the number of users who browse to payment and leave.

---

## The Proposed Solution

A three-part cleanup that fires 1 hour after a user row is created in Supabase, conditional on `subscription_status` still being `'inactive'` at that point.

### Part A — Server-side cleanup (Inngest background job)

An Inngest function listens for a `clio/user.created` event (emitted by the Clerk webhook handler when a new user row is upserted). The function sleeps for 60 minutes using `step.sleep`. After waking, it checks whether `subscription_status` is still `'inactive'`. If so:

1. Delete the `users` row from Supabase (cascade deletes all child rows via `ON DELETE CASCADE` foreign keys already in the schema).
2. Delete the user from Clerk via the Clerk Backend API (`clerkClient.users.deleteUser(userId)`).

The Clerk deletion automatically revokes all active sessions for that user, satisfying the "sign them out" requirement without a separate session revocation call.

### Part B — Client-side localStorage clear (Next.js middleware or layout)

The server cannot directly clear a browser's localStorage. The cleanup must be detected on the client's next visit. When the user returns after the cleanup has fired:

- Their Clerk session will be invalid (the Clerk account was deleted).
- The `clio_onboarding` key in localStorage may still exist.

The client-side code must detect this state (Clerk returns an unauthenticated state for a deleted user) and clear `localStorage.removeItem('clio_onboarding')` as part of the auth state transition to unauthenticated.

### Part C — Stripe safety check

The cleanup must NOT fire if payment went through. The safeguard is the `subscription_status` column: the Stripe webhook sets this to `'active'` on `customer.subscription.created`. If `subscription_status = 'active'` at the 60-minute check, the Inngest function exits without taking any action.

---

## What Success Looks Like

1. A user who starts onboarding, reaches the payment screen, and abandons at 6:00 PM has their Clerk account deleted and their Supabase row removed by 7:01 PM (the 1-minute buffer is the Inngest wake-wake latency).
2. A user who completes payment at 6:45 PM is never touched — the 7:00 PM check sees `subscription_status = 'active'` and the job exits cleanly.
3. When the abandoned user returns at any later time, they are in a fully unauthenticated state. Clerk does not recognise them. `clio_onboarding` is cleared from their localStorage on that visit. They can begin a fresh onboarding as a new user with no conflicts.
4. The `users` table contains no rows with `subscription_status = 'inactive'` that are older than 61 minutes, except for users who are actively within their payment window.
5. No active paying user is ever touched by this job.

---

## Out of Scope

- **Users who paid and then cancelled.** A cancelled subscription sets `subscription_status` to a value like `'cancelled'` or `'inactive'` via the Stripe webhook, but those users have already completed onboarding and have a full data history. This cleanup must not touch them. The BA must define the exact guard condition that distinguishes a pre-payment ghost row from a post-cancellation inactive row.
- **Partial onboarding (user created but Clerk webhook failed).** If the Clerk webhook fires but the Supabase upsert fails, there is no `users` row to clean up. That is a separate reliability concern not addressed here.
- **Phone-based sign-ups and Twilio number assignments.** If a user was assigned a Twilio phone number during onboarding, this brief does not specify whether that number must be released back to the pool on cleanup. The BA must investigate whether phone numbers are assigned before or after payment confirmation.
- **Email notifications to the abandoned user.** No "you left before completing payment" recovery email is in scope for this feature.
- **Admin tooling or dashboards.** No UI for viewing or managing abandoned onboarding records is in scope.
- **Re-entry flow UX.** The user experience for a returning abandoned user (e.g. a "welcome back" message) is not in scope. The requirement is only that they can start fresh without conflicts.

---

## Known Constraints

- **`ON DELETE CASCADE` is already in the schema.** Child tables (`sessions`, `curriculum_plans`, `delivery_log`, etc.) reference `users(id)` with `ON DELETE CASCADE`. Deleting the `users` row will cascade. The BA must verify this is safe — specifically, that no child rows will exist for a user who has never paid (curriculum generation is gated behind payment, so there should be no session rows, but the BA must confirm).
- **Clerk deletion is irreversible.** Once `clerkClient.users.deleteUser(userId)` is called, the Clerk account is gone. There is no soft-delete. The 60-minute window and the `subscription_status` check are the only safeguards. The BA must specify what happens if the Inngest job fires during a Stripe webhook that is mid-flight (race condition window).
- **localStorage is client-only.** The server job cannot clear it. The client must detect the deleted/unauthenticated Clerk state and clear localStorage reactively. The BA must specify exactly where in the Next.js app this detection happens (layout, middleware, or a dedicated hook) and what the exact trigger condition is.
- **Inngest `step.sleep` has a maximum duration.** The BA should confirm 60 minutes is well within Inngest's supported sleep range (it is, but it should be stated in the spec).
- **The Clerk webhook currently emits no Inngest event.** The `app/api/webhooks/clerk/route.ts` handler upserts to Supabase and sends a welcome email — it does not emit an Inngest event. Adding the `clio/user.created` event emission to the webhook handler is part of this feature's scope.
- **The welcome email is sent immediately on `user.created`.** If the user is later cleaned up, they will have received a welcome email for an account that no longer exists. The BA must decide whether to suppress the welcome email until payment is confirmed, or accept this as tolerable (the email is sent before cleanup is relevant, so it may be acceptable friction).

---

## Questions for the BA to Resolve

**Q1: Cancelled-subscriber guard**
How does the cleanup job distinguish a pre-payment ghost row from a post-cancellation inactive row? The Stripe webhook presumably sets a different field (e.g. `subscription_status = 'cancelled'`) rather than returning it to `'inactive'`. The BA must confirm the exact column value written by `customer.subscription.deleted` and ensure the cleanup condition checks only for rows that have never had an active subscription (e.g. `subscription_status = 'inactive' AND stripe_customer_id IS NULL`).

**Q2: Race condition between Stripe webhook and Inngest cleanup**
If a user completes payment at T+59 minutes and the Stripe webhook is slow (arrives at T+61 minutes after the Inngest check has already run), the cleanup fires on a paying user. What is the mitigation? Options: (a) extend the window to 90 minutes, (b) re-check `subscription_status` inside a Supabase transaction with a short lock, (c) check Stripe directly via the Stripe API at cleanup time rather than relying solely on the DB column. The BA must specify which approach is used.

**Q3: Twilio number assignment timing**
Are Twilio phone numbers assigned before or after payment confirmation? If before, the cleanup job must release the number back to the pool. If after (i.e. assignment is gated behind subscription activation), no Twilio action is needed. The BA must check `lib/delivery/sms.ts` and the onboarding route to confirm.

**Q4: localStorage clear — exact implementation point**
Where in the Next.js app should the localStorage clear be placed? The BA must specify: is it in `app/layout.tsx` (runs on every page load), a dedicated `useEffect` in the auth wrapper, or handled by the Clerk `useAuth` hook's `signedOut` state? The spec must name the exact file to modify and the exact condition to check.

**Q5: Welcome email — suppress or accept?**
The welcome email fires immediately on `user.created` in the current Clerk webhook handler. If the user is cleaned up 60 minutes later, that email becomes misleading. Should the welcome email be moved to fire on payment confirmation instead (i.e. triggered by the Stripe `customer.subscription.created` webhook)? Or is sending a welcome email to someone who abandons at payment considered acceptable? This is a product decision — the BA must get a decision from the CEO Agent or escalate to Arun.

**Q6: Child row safety check**
The BA must verify that no child rows can exist in `sessions`, `curriculum_plans`, `user_learning_profile`, or `topic_content_cache` for a user who has never paid. If any of these tables can be written to before payment (e.g. during onboarding or curriculum preview), the cascade delete will remove them — which is correct, but the BA must confirm and document it explicitly so the developer is not surprised.

**Q7: Inngest event naming and idempotency**
The Inngest function is triggered by a `clio/user.created` event emitted from the Clerk webhook. If the Clerk webhook fires twice for the same user (retry scenario), the cleanup job could be scheduled twice and could attempt to delete an already-deleted user. The BA must specify the idempotency key for the Inngest event and what the job does when it finds the user row is already gone at the 60-minute mark.

**Q8: Observability**
What logging or monitoring is required so Arun can verify the cleanup is running correctly? At minimum, the spec should call for a log line when the job fires, when it skips (because `subscription_status = 'active'`), and when it successfully deletes. Should these be Inngest run logs only, or also written to a Supabase audit table?

---

## Handoff to Business Analyst Agent

BA Agent — before writing the Requirement Document, read the following files:

1. `/Users/arunprakash/Documents/claudeWS/distill/distill/app/api/webhooks/clerk/route.ts` — the current Clerk webhook handler. This is where the `clio/user.created` Inngest event emission must be added.
2. `/Users/arunprakash/Documents/claudeWS/distill/distill/app/api/webhooks/stripe/route.ts` — confirm what `customer.subscription.created` and `customer.subscription.deleted` write to the `users` table. This is the basis for the safety guard.
3. `/Users/arunprakash/Documents/claudeWS/distill/distill/supabase/migrations/001_initial.sql` — the `users` table schema, `subscription_status` default value, and all foreign key cascade rules.
4. `/Users/arunprakash/Documents/claudeWS/distill/distill/lib/delivery/sms.ts` — check whether Twilio number assignment happens before or after payment (Q3 above).
5. `/Users/arunprakash/Documents/claudeWS/distill/distill/inngest/` — review existing Inngest function patterns (especially `trial-expiry.ts` if it exists) for the `step.sleep` pattern and event naming conventions already in use.

The Requirement Document must answer Q1 through Q8 in Section 11 before any question is moved to the implemented sections. Do not pass the spec to a developer with any of Q1–Q8 unanswered.

The output spec file should be saved to: `docs/specs/ONBOARD-CLEANUP-01-requirement-document.md`

---

*Feature Brief ONBOARD-CLEANUP-01 | CEO Agent | 2026-06-29 | Status: Handed to BA Agent*
