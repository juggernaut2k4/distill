# AUTH-01 — Authentication Flow: New User Onboarding vs Returning User Login
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-07-01

---

## 1. Purpose

Clio has two distinct authentication paths that must never be confused. A new user must complete onboarding — collecting their profile, topic preferences, and plan selection — before they reach the dashboard. A returning user must arrive directly at the dashboard with zero friction. Mixing these paths is a critical product failure: a new user who bypasses onboarding arrives in a dashboard with no profile, no learning plan, and no sessions, producing a broken first experience. A returning user forced through onboarding again is an equally severe regression.

This document is the permanent reference for how these flows are wired. Any developer touching authentication redirects, middleware, or the onboarding page must read it before making changes.

---

## 2. The Two Flows

### Flow A — New User Onboarding

A person who has never created a Clio account follows this path in full, in this order:

```
1. What is your role?
   (CEO / VP / Director / Manager / Engineer / Other)

2. What is your domain?
   (Finance / Healthcare / Retail / Technology / Consulting / Other)

3. How well do you know AI?
   (Observer / Emerging / Practitioner / Leader)

4. What is your biggest worry?
   (Falling behind / Evaluating vendors / Enabling my team / Other)

5. Create your account
   (Google sign-up or email/password sign-up via Clerk)

6. Pick your topics
   (AI Strategy / LLM Basics / Vendor Evaluation / etc.)

7. Choose a plan
   (Starter / Pro / Executive — with 3-day free trial)

8. Payment
   (Stripe checkout — skipped if free/trial path)

9. Personalised learning plan generated
   (from role + domain + AI maturity + worry + selected topics)

10. Dashboard
```

Steps 1–4 happen before the user creates an account. The profile answers are held in client-side state. Step 5 triggers Clerk sign-up; on completion, Clerk redirects to `/onboarding`, which saves the profile to the database and then redirects to `/topics`. Steps 6 onwards happen after account creation.

### Flow B — Returning User Login

A person who already has a Clio account follows this path:

```
1. Sign in
   (Google or email/password via Clerk, at /sign-in)

2. Dashboard
   (/dashboard)
```

No profile collection. No topic selection. No plan selection. Direct to dashboard.

---

## 3. Trigger / Entry Points

| Scenario | Entry URL | Outcome |
|---|---|---|
| New user arrives organically | `/` (marketing landing page) | CTA links to `/sign-up` or `/onboarding` |
| New user clicks "Create account" after answering profile questions | `/sign-up?redirect_url=/onboarding` | Clerk sign-up; on success → `/onboarding` |
| New user lands on `/sign-up` directly | `/sign-up` | Clerk sign-up; on success → `/onboarding` (forced) |
| Returning user arrives | `/sign-in` | Clerk sign-in; on success → `/dashboard` (fallback) |
| Unauthenticated user tries to access `/dashboard` | middleware intercepts | Redirected to `/sign-in` |

---

## 4. Screen / Flow Description

### Flow A — Step-by-step

**Steps 1–4 (Profile questions, pre-auth):**
The user is on `/onboarding`. Four questions are shown one at a time (tap-to-select UI). The user's answers are stored in React component state only — nothing is saved to the database yet, because the user has no account.

**Step 5 (Account creation):**
After question 4, the onboarding page shows a "Your plan is ready — create an account to save it" screen. This contains a link to `/sign-up?redirect_url=/onboarding`. The user completes Clerk sign-up (Google or email). Clerk, using `forceRedirectUrl="/onboarding"`, sends the newly authenticated user back to `/onboarding`.

**Back on `/onboarding` (now authenticated):**
The profile answers previously entered are no longer in state (the page has reloaded after the Clerk redirect). The user re-sees the questions and re-answers them (the onboarding page handles this case). On final submission, the API call to `/api/onboarding` saves the profile to the `users` table. On success, the page redirects to `/topics`.

**Step 6 (Topic selection at `/topics`):**
User selects learning topics. This page is public (no auth gate in middleware) because a user may arrive here directly from Clerk's redirect before the session cookie has fully propagated.

**Steps 7–8 (Plan and payment):**
User is redirected to `/plan` (or Stripe checkout) from the topics page.

**Step 9–10 (Plan generation and dashboard):**
After payment or plan confirmation, the personalised learning plan is generated and the user lands on `/dashboard`.

### Flow B — Step-by-step

**Sign-in:**
User arrives at `/sign-in`. Clerk presents the sign-in widget. On success, Clerk uses `fallbackRedirectUrl="/dashboard"` — the user lands on the dashboard.

The sign-in page also carries `signUpForceRedirectUrl="/onboarding"`. This handles the case where a user starts on the sign-in page but creates a new account using the "Sign up" link within the Clerk widget — they are correctly routed to onboarding, not the dashboard.

---

## 5. Visual Examples

### New User — Profile Question Screen (Steps 1–4)
```
┌─────────────────────────────────────────┐
│  [Progress bar: 25% filled, purple]     │
│                                         │
│  What is your role?                     │
│                                         │
│  [Option: CEO]                          │
│  [Option: VP / Director]                │
│  [Option: Manager]                      │
│  [Option: Engineer]                     │
│  [Option: Other]                        │
│                                         │
│  (Tap to select — no Next button)       │
└─────────────────────────────────────────┘
```

### New User — Account Creation Prompt (after Step 4)
```
┌─────────────────────────────────────────┐
│  [Clio logo]                            │
│                                         │
│  Your plan is ready.                    │
│                                         │
│  Create your account to save your       │
│  personalised AI learning plan and      │
│  start your 3-day free trial.           │
│                                         │
│  [PRIMARY BUTTON: "Create account"]     │
│  → links to /sign-up?redirect_url=      │
│    /onboarding                          │
└─────────────────────────────────────────┘
```

### Returning User — Sign-In Screen
```
┌─────────────────────────────────────────┐
│                                         │
│  [Clerk SignIn widget]                  │
│  fallbackRedirectUrl = /dashboard       │
│  signUpForceRedirectUrl = /onboarding   │
│                                         │
└─────────────────────────────────────────┘
```

---

## 6. Data Requirements

**During Steps 1–4 (pre-auth):**
- Profile answers held in React state on the client. Nothing written to any database.

**At Step 5 completion (Clerk sign-up):**
- Clerk creates a user record in its own system. A Clerk webhook fires to Clio's `/api/webhooks/clerk` (if wired), which may create a stub record in the `users` table.

**At onboarding API call (back on `/onboarding`, authenticated):**
- Written to `users` table: `role`, `domain`, `ai_maturity`, `worry`, and associated metadata.
- This call requires a valid Clerk session. If the session cookie is not yet present (race condition after redirect), the API returns 401.

**At topic selection (`/topics`):**
- Written to `user_topics` or equivalent table.

**At plan selection and payment:**
- Stripe customer and subscription records created. `users` table updated with `plan`, `stripe_customer_id`, `subscription_status`.

---

## 7. Success Criteria (Acceptance Tests)

**Flow A — New user:**

✓ Given a user with no Clio account, when they complete all four profile questions and create an account via `/sign-up`, then they land on `/onboarding` (not `/dashboard` or `/plan`).

✓ Given a new user who has completed sign-up, when they submit their profile answers on `/onboarding`, then the `users` table contains their `role`, `domain`, `ai_maturity`, and `worry`.

✓ Given a new user who has submitted their profile, when the API call to `/api/onboarding` returns 200, then they are redirected to `/topics`.

✓ Given a new user who lands on `/sign-up` without any query parameters, when they complete sign-up, then they are still routed to `/onboarding` (because `forceRedirectUrl` overrides all query params on the sign-up page).

✓ Given a new user who clicks the "Sign up" link inside the Clerk widget on the `/sign-in` page, when they complete sign-up, then they are routed to `/onboarding` (because `signUpForceRedirectUrl="/onboarding"` is set on the sign-in page).

✓ Given a new user on `/onboarding` whose Clerk session is not yet ready (401 from `/api/onboarding`), when the 401 is received, then the page shows the "Create account" prompt rather than a generic error.

**Flow B — Returning user:**

✓ Given a user with an existing Clio account, when they sign in at `/sign-in`, then they land on `/dashboard`.

✓ Given a returning user who has no bookmarked redirect URL, when they sign in, then `fallbackRedirectUrl="/dashboard"` applies and they reach the dashboard.

✓ Given a returning user who navigates to `/onboarding` while already signed in, then the onboarding flow does not overwrite their existing profile.

---

## 8. Error States

| Trigger | What the user sees |
|---|---|
| `/api/onboarding` returns 401 (session not propagated) | "Your plan is ready — create your account" prompt appears. The user can click to sign up / sign in. Profile answers are lost and must be re-entered. |
| `/api/onboarding` returns 500 | Error message: "Something went wrong. We couldn't save your profile. Please try again — your answers are still here." Answers remain in state; user can retry without re-answering. |
| Stripe checkout fails or is abandoned | User lands on `/pricing`. No account damage; they can attempt payment again. |
| Clerk sign-up fails (duplicate email, network error) | Clerk's own widget displays the error. Clio does not handle this. |

---

## 9. Edge Cases

**User starts on `/sign-in` and clicks "Sign up" within the Clerk widget:**
The `signUpForceRedirectUrl="/onboarding"` prop on the sign-in page handles this correctly. The user goes to onboarding, not the dashboard.

**User completes sign-up and is redirected to `/onboarding`, but their Clerk session cookie has not yet propagated:**
The onboarding API returns 401. The page shows the account creation prompt. This is the intended fallback — the user can re-initiate the flow.

**User navigates directly to `/plan` without completing onboarding:**
`/plan` is not a public route in `middleware.ts`. If the user is unauthenticated, middleware redirects them to `/sign-in`. If authenticated but without a profile, the `/plan` page may render with incomplete data — this is a P1 risk documented in Section 12.

**User bookmarks `/onboarding` and returns as a signed-in returning user:**
The onboarding page should detect that a profile already exists (by checking the `users` table on load) and redirect to `/dashboard`. This guard must be implemented; absence of it allows a returning user to accidentally overwrite their profile.

**User uses a social login (Google) and the account already exists in Clerk:**
Clerk treats this as a sign-in, not a sign-up. `fallbackRedirectUrl="/dashboard"` applies. The user correctly lands on the dashboard.

**Mobile or slow connection:**
Profile answers in Steps 1–4 are held only in client state. If the browser tab is closed or refreshed before account creation, all answers are lost. Users must re-answer on return.

---

## 10. Out of Scope

- Password reset flows (handled entirely by Clerk).
- Email verification flows (handled entirely by Clerk).
- Social account linking (e.g. connecting Google after email sign-up).
- Admin or team-member authentication — this spec covers end-user flows only.
- Onboarding profile edit after initial completion — this is a separate feature (not yet specced or built as of 2026-07-01).
- SSO / enterprise login.

---

## 11. Open Questions

None. This spec reflects confirmed flows from Arun (2026-07-01) and is approved for development reference.

---

## 12. Known Risks and Anti-Patterns

This section is a hard reference for code review. Any PR touching the files listed in Section 13 must be checked against each item below.

### Anti-pattern 1 — Using `forceRedirectUrl` on the sign-in page
`forceRedirectUrl` on the sign-in page sends ALL sign-ins — including returning users — to a fixed destination, bypassing `fallbackRedirectUrl`. A returning user who signs in would be sent to `/onboarding` or `/plan`, not `/dashboard`. This was the root cause of the 2026-07-01 incident.

**Rule:** The sign-in page must use `fallbackRedirectUrl="/dashboard"` for returning users and `signUpForceRedirectUrl="/onboarding"` for new accounts created inside the sign-in widget. `forceRedirectUrl` must never appear on the sign-in page.

### Anti-pattern 2 — Using `forceRedirectUrl` on the sign-up page pointing to any destination other than `/onboarding`
`forceRedirectUrl` on the sign-up page overrides the `?redirect_url` query parameter. This is intentional — it prevents any deep-link manipulation from sending a new user somewhere unexpected. The destination must always be `/onboarding`.

**Rule:** The sign-up page `forceRedirectUrl` must always be `/onboarding`. No other value is permitted.

### Anti-pattern 3 — A new user landing on `/plan` without a profile
If a new user reaches `/plan` without having submitted the onboarding form, their profile is empty. The plan generation step will produce either an error or a generic, unpersonalised plan, which is a broken first experience.

**Rule:** `/plan` must verify that a user profile exists before rendering. If none exists, redirect to `/onboarding`.

### Anti-pattern 4 — `/plan` missing from the public routes list in middleware
`/plan` requires the user to be authenticated (they must have just signed up). If `/plan` is protected by middleware but the Clerk session cookie has not yet propagated after sign-up, the middleware will redirect the user to `/sign-in` — interrupting their onboarding flow mid-journey.

**Rule:** `/plan` must be in the `isPublicRoute` list in `middleware.ts`, or the route handler must perform its own auth check rather than relying on middleware. As of 2026-07-01 this is a latent P1 risk — `/plan` is not in the public routes list. If onboarding drop-off on this step is observed, this is the first place to investigate.

### Anti-pattern 5 — Redirecting from onboarding to dashboard without saving the profile
If the onboarding page redirects to `/dashboard` (or any post-onboarding destination) before the `/api/onboarding` call returns a 200, the profile is not saved. The user appears onboarded but has no data.

**Rule:** The redirect to `/topics` must only fire inside the success branch of the `/api/onboarding` response handler, never on optimistic assumption.

---

## 13. Files a Developer Must Check When Touching Auth Redirects

Any change to authentication redirects, the onboarding flow, or middleware routing must review all of the following files before the PR is submitted:

| File | What to verify |
|---|---|
| `app/(auth)/sign-in/[[...sign-in]]/page.tsx` | `fallbackRedirectUrl="/dashboard"` is present. `signUpForceRedirectUrl="/onboarding"` is present. `forceRedirectUrl` does NOT appear on this page. |
| `app/(auth)/sign-up/[[...sign-up]]/page.tsx` | `forceRedirectUrl="/onboarding"` is present. No other value. |
| `app/onboarding/page.tsx` | Redirect after successful API save goes to `/topics`, not `/dashboard` or `/plan`. The 401 fallback shows the account creation prompt, not a generic error. |
| `middleware.ts` | The `isPublicRoute` list contains `/onboarding(.*)` and `/topics(.*)`. Verify whether `/plan(.*)` should be added (P1 risk — see Section 12, Anti-pattern 4). |

---

## 14. Incident Record — 2026-07-01

**What happened:**
New users who created accounts were bypassing onboarding and arriving directly on `/plan` with no profile data.

**Root cause:**
Two separate redirect props were set incorrectly:

1. The sign-in page (`app/(auth)/sign-in/[[...sign-in]]/page.tsx`) had `signUpForceRedirectUrl="/plan"` set. This sent any new account created via the sign-in widget to `/plan`, skipping onboarding entirely.

2. The sign-up page (`app/(auth)/sign-up/[[...sign-up]]/page.tsx`) had `forceRedirectUrl="/plan"`. Because `forceRedirectUrl` overrides all query parameters, the `?redirect_url=/onboarding` parameter passed by the onboarding page's account creation link was silently ignored.

**Fix applied (commit `e55f7bb`):**
- Sign-in page: `signUpForceRedirectUrl` changed from `/plan` to `/onboarding`.
- Sign-up page: `forceRedirectUrl` changed from `/plan` to `/onboarding`.

**How to detect a recurrence:**
A new user who signs up and arrives at any destination other than `/onboarding` is a regression of this incident. Monitor Vercel logs for new Clerk user creation events followed immediately by non-`/onboarding` page views.
