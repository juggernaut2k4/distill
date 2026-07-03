# Feature Brief: AUTH-02 — Login vs. Signup Flow Separation & Onboarding Resume/Backtrack
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 — security-adjacent, touches every user's entry point
Date: 2026-07-03

---

## What Arun Said

Arun caught a real gap while reviewing the homepage flow: "Get Started" is supposed to be the new-user signup path only, and "Login" is a separate, distinct path for existing users. These are two separate doors, not one — and they must never blur into each other.

Today, if a browser already has an active signed-in Clerk session and the person clicks "Get Started," the app silently redirects them straight into `/dashboard` — no re-confirmation, no explicit click confirming identity. Arun flagged this as a real security/UX risk: anyone with physical or browser access to a machine where a session is still open (shared computer, unlocked laptop) can click one public marketing button and land inside that person's account with zero friction.

Arun gave five governing rules for the fix:

1. **Get Started and Login are two separate doors.** Get Started = new signup only. Login = existing user only. Get Started must never itself be the mechanism that lands someone in a dashboard, under any account state.

2. **An active signed-in session never auto-lands in the dashboard.** Regardless of entry point, the user must see and actively click Clerk's own "Continue as [this account]" confirmation before reaching the dashboard. No silent, automatic redirect — ever.

3. **Get Started always begins a real, fresh flow.** If the current browser session already belongs to a fully onboarded AND paying customer, Get Started must show an intermediate interstitial: "You're already signed in as [email/account identifier]," with a single "Login" button. Clicking that button sends the user into the actual Login flow, which then shows Clerk's "Continue as [you]" confirmation (per rule 2) before reaching the dashboard. Get Started itself must never be capable of producing dashboard access.

4. **Resume-in-progress accounts get resumed mid-flow, with full backward navigation.** If someone signed up but never completed payment, clicking Get Started again resumes them where they left off (not dashboard access, not a forced restart). At any point in the resumed flow, the user must be able to navigate backward through the entire onboarding question sequence — all the way back to question 1 — and freely change any previously-given answer. This must work seamlessly even when resuming from a later step.

5. **No data retention for incomplete-onboarding, never-signed-up visitors.** If someone started answering onboarding questions but never completed Clerk signup, none of that partial data is worth keeping. Always show a fresh, blank onboarding start for this case. This is consistent with the already-shipped decision in commit `4d96fbf` ("attach answers to Clerk sign-up via unsafeMetadata") that no server-side retention exists for pre-signup answers — AUTH-02 reinforces this, it does not change it.

---

## The Problem Being Solved

The current returning-user redirect in `app/onboarding/page.tsx` (added in commit `ced908c`, "returning users go to dashboard, not onboarding") treats "has a saved profile" (`users.role IS NOT NULL`, exposed via `GET /api/onboarding` as `hasProfile`) as sufficient grounds to silently call `router.replace('/dashboard')` with zero user-facing confirmation. This conflates three genuinely different account states into one blanket behavior:

- (a) fully active, paying customer — should require explicit confirmation before dashboard access, never auto-redirect
- (b) signed-up but never paid — should resume onboarding/checkout, not dashboard, and definitely not silently
- (c) no profile at all — the only case where a fresh onboarding start is actually correct

The result today is a genuine account-takeover-adjacent UX gap on a public marketing button, plus (separately, per rule 4) no ability for a resuming user to correct earlier answers.

---

## What Success Looks Like

- No code path exists where a signed-in session reaches `/dashboard` without an explicit, user-initiated confirmation click (Clerk's native "Continue as X" or equivalent).
- Clicking "Get Started" can never, under any account state, result in landing on `/dashboard`.
- A fully active/paying user who is already signed in and clicks "Get Started" sees an interstitial ("You're already signed in as [x]") with a single "Login" button, which routes into the real Login flow (which itself requires the Clerk confirmation click before dashboard).
- A signed-up-but-unpaid user who clicks "Get Started" resumes exactly where they left off (e.g., near checkout), and can navigate backward through all prior onboarding questions and edit any answer, from any point in the resumed flow.
- A visitor who answered onboarding questions but never completed Clerk signup always gets a completely fresh, blank onboarding start — no partial data surfaced or retained.
- The existing Login flow (`/sign-in`) is verified (and hardened if needed) to guarantee it always surfaces Clerk's account-confirmation step and can never be bypassed by a custom redirect.

---

## Known Constraints

- Must not contradict or duplicate `docs/specs/AUTH-01-onboarding-vs-login-flow.md` (approved 2026-07-01) — AUTH-02 builds on it and explicitly supersedes the assumption in AUTH-01 Section 9 ("the onboarding page should detect a profile exists and redirect to `/dashboard`... this guard must be implemented") for the case of an active session with unresolved payment/confirmation state. BA must reconcile the two documents explicitly, not silently override.
- Must be consistent with the existing product decision in commit `4d96fbf` (no server-side retention of pre-signup onboarding answers) — rule 5 reinforces, does not change, this.
- No new payment/credentials work — this is a routing/UX/confirmation-flow change layered on existing Clerk session state and existing `users` table fields (`role`, `subscription_status`, `plan_approved`, `plan_approved_at`).
- `middleware.ts` currently treats `/onboarding(.*)` as fully public (no Clerk auth gate at that layer) — any change to gating behavior must be called out explicitly as an open question, not assumed.
- Existing account-state fields confirmed in code: `users.role` (non-null = has profile), `users.subscription_status` (`'active' | 'trialing' | 'inactive'`), `users.plan_approved` (boolean), `users.plan_approved_at` (timestamp). BA must define the exact account-state decision table using these fields — do not invent new fields without flagging it.
- This is P0 and security-adjacent — acceptance criteria must be precise and testable, not vague.

---

## Questions for BA

1. Exact copy/wording for the "You're already signed in as [x]" interstitial page (title, body text, button label — is it literally "Login" or something else like "Continue to Login"?).
2. Exact UX for backward-navigation-and-edit within the resumed onboarding flow: when a user goes back and changes an earlier answer (e.g., Q2), does that require re-confirming/re-saving all subsequent answers (Q3 onward), or does it just patch the one changed field and leave downstream answers untouched? This affects both UX and the `/api/onboarding` save contract.
3. Does this require any change to `middleware.ts`'s auth gating (e.g., is `/onboarding(.*)` still fully public, or does resume-detection now require a server-side check that implies auth is needed earlier)? Or does this remain purely page-level/client-side logic exactly as AUTH-01 established?
4. Does Clerk's own sign-in/sign-up component already provide the "Continue as X" confirmation natively when an active session exists (this is standard Clerk behavior for `<SignIn>` re-invocation), or does guaranteeing "never silently bypassed" require custom UI Clio controls directly, independent of Clerk's default widget behavior?
5. Precise definition of "fully onboarded AND paying" vs. "signed-up-not-paid" using the confirmed fields: is it `subscription_status IN ('active','trialing')` AND `plan_approved = true`, or some other combination? Please write this as an explicit decision table covering all 4 states: no account / started-onboarding-no-signup / signed-up-not-paid / fully-active-paying-customer.
6. Where exactly does the interstitial and the resume logic live — is this new logic added to the existing `app/onboarding/page.tsx` `useEffect` (replacing the current silent `router.replace('/dashboard')`), or a new dedicated route/component? BA should specify file-level placement given this touches a security-sensitive path.
7. For the resumed-onboarding case (rule 4), what exactly counts as "where they left off" — is this driven by existing fields (`role` set but `plan_approved` false → resume at plan/checkout step), or does it require a new explicit progress-tracking field?

---

*This brief supersedes the relevant assumption in AUTH-01 Section 9 regarding automatic profile-based redirect to `/dashboard`. AUTH-01's core Flow A/Flow B separation, sign-in/sign-up redirect props, and known anti-patterns (Section 12) remain valid and must not be contradicted.*
