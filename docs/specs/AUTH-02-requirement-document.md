# AUTH-02 — Login vs. Signup Flow Separation & Onboarding Resume/Backtrack — Requirement Document
Version: 1.0
Status: **CEO-APPROVED — 2026-07-03.** Section 11 (Open Questions) confirmed empty — all 7 of the brief's questions resolved with documented, code-verified reasoning, none escalated. The `plan_approved` vs `subscription_status` correction (Section 4.1) independently re-traced by CEO Agent against `app/dashboard/layout.tsx` and `app/api/checkout/route.ts` and confirmed accurate. Cleared for Arun's review.
Author: Business Analyst Agent
Date: 2026-07-03

Supersedes: AUTH-01 Section 9, subsection "User bookmarks `/onboarding` and returns as a signed-in returning user" (the assumption that a saved profile alone is sufficient grounds for `router.replace('/dashboard')` with no confirmation). AUTH-01's Flow A/Flow B separation, sign-in/sign-up redirect props (Section 12, Anti-patterns 1–2), and all other sections remain valid and are not modified by this document.

---

## 1. Purpose

Today, `app/onboarding/page.tsx` treats "a database profile exists" (`users.role IS NOT NULL`) as sufficient grounds to silently call `router.replace('/dashboard')` — with no user-facing confirmation of any kind. Because the public marketing "Get Started" button links directly to `/onboarding`, this means: on any machine where a Clio account is still signed in (shared computer, unlocked laptop, borrowed device), a stranger can click one public button and land inside that person's paying account with zero friction, zero password, zero click of confirmation.

This also collapses three genuinely different account states into one blanket behavior, so a signed-up-but-unpaid user gets sent to a dashboard they can't access (bounced back out by `app/dashboard/layout.tsx`'s own gate) instead of resuming their in-progress signup, and a user resuming onboarding has no way to go back and fix an earlier answer.

Without this fix: Clio has a standing account-takeover-adjacent vulnerability on its own public marketing page, and paying customers who abandon mid-signup have no path back except starting over from question 1 with no memory of previous answers.

---

## 2. User Stories

As a returning, fully paying Clio customer who left a browser session open,
I want "Get Started" to never drop a stranger straight into my dashboard,
So that my account can't be accessed by anyone with physical access to my machine without an explicit, deliberate confirmation step.

As a person who signed up and started my plan but never finished paying,
I want clicking "Get Started" again to pick up exactly where I left off — including the ability to go back and change any earlier answer,
So that I don't have to redo work I already did or get stuck unable to reach my own checkout.

As a first-time visitor who answered some onboarding questions but closed the tab before creating an account,
I want a completely fresh start when I come back,
So that I'm not confused by stale, unconfirmed answers that were never actually mine to begin with (I might not even be the same person on the same browser).

As Arun (product owner),
I want a hard guarantee that no code path lets a signed-in session reach `/dashboard` without an explicit user click confirming identity,
So that Clio does not carry an account-takeover-adjacent UX gap on a public page.

---

## 3. Trigger / Entry Point

- **Route:** `/onboarding` (unchanged URL). Also indirectly: `/` (marketing homepage) "Get Started" button, which links to `/onboarding`, and `/sign-in`.
- **Trigger:** Page load of `/onboarding`, specifically the `useEffect` that runs once Clerk has loaded (`clerkLoaded === true`).
- **State required:** None to view the page (per Section 4 below, `/onboarding` remains public / no new middleware gate — see Section 4's "Middleware" subsection for the reasoning). The behavior branches entirely on Clerk's client-side `isSignedIn` state plus a server-side account-state lookup.

---

## 4. Account-State Decision Table (the core of this spec)

### 4.1 Correction to the brief's assumption — read this first

The Feature Brief (Section "Known Constraints") assumes the "fully active/paying" boolean should be built from `subscription_status` AND `plan_approved`. Having read the actual schema and code, this is incorrect and must be corrected, not followed literally:

- `plan_approved` (added in migration `003_topics_and_plan.sql`, denormalized timestamp added in `032_schedule_setup_gate.sql`) is **not a payment field**. It tracks whether the user has approved their generated curriculum plan — a step in the SCH-01 schedule-setup-gate flow, unrelated to Stripe/billing.
- The field the entire rest of the codebase already uses as the single source of truth for "is this a paying customer" is `subscription_status` alone, checked as `subscription_status IN ('active', 'trialing')`. This exact check is live today in `app/dashboard/layout.tsx` (the dashboard's own access gate) and `app/api/checkout/route.ts` (`alreadyActive` / cross-account dedup logic).

Using `plan_approved` in this decision table would create a real bug: a paying customer who has not yet clicked through the curriculum-approval step (a separate, later feature) would be misclassified as "signed-up-not-paid" and incorrectly sent back into onboarding/checkout despite already having an active subscription. This document uses the codebase's existing, proven definition instead.

### 4.2 The four states

All four states are evaluated server-side via a single new endpoint, `GET /api/onboarding/account-state` (see Section 6), using the Clerk session (if any) plus the `users` table.

| State | Precise definition (boolean logic) | Governing fields |
|---|---|---|
| **(a) No account at all** | No active Clerk session on this browser (`isSignedIn === false` per `useUser()`), AND no `clio_onboarding` localStorage data present, or that data is empty/malformed. | Clerk session absence; localStorage |
| **(b) Started onboarding, never completed Clerk signup** | No active Clerk session (`isSignedIn === false`), AND `clio_onboarding` localStorage contains a non-empty partial or complete answer set (this is the exact existing "Case 3/4" logic already in `app/onboarding/page.tsx` lines ~532–582 — untouched by this spec). | Clerk session absence; localStorage presence |
| **(c) Signed up, never completed payment** | Active Clerk session (`isSignedIn === true`) AND `users.role IS NOT NULL` (profile exists) AND NOT (`subscription_status IN ('active', 'trialing')`) — i.e. `subscription_status` is `'inactive'`, null, or the row doesn't exist yet. | Clerk session; `users.role`; `users.subscription_status` |
| **(d) Fully active, paying customer** | Active Clerk session (`isSignedIn === true`) AND `users.role IS NOT NULL` AND `subscription_status IN ('active', 'trialing')`. | Clerk session; `users.role`; `users.subscription_status` |

Note: a fifth theoretical combination — signed in, active session, but `users.role IS NULL` (no profile row / profile never saved) — is treated identically to state (c) for routing purposes (resume onboarding from question 1, since there is nothing to resume from; this is functionally a "just signed up, restart the question flow" case, not a new state). This is not a new state requiring separate handling; it naturally falls out of "resume where they left off" with nothing saved yet.

### 4.3 Behavior per state when "Get Started" is clicked

| State | Landing behavior |
|---|---|
| (a) No account | Normal fresh `/onboarding` flow, starting at question 1 (Step 0). No change from today. |
| (b) Started, never signed up | Fresh, blank `/onboarding` start at question 1. The existing `clio_onboarding` localStorage entry (if any) is discarded/ignored for this fresh start — consistent with commit `4d96fbf` (no server-side retention; client-side stale data for a possibly-different person is also not trustworthy). No change from today's actual behavior; this state was never broken. |
| (c) Signed up, unpaid | Resume mid-flow at the exact step they left off on (see Section 4.4 for how "where they left off" is computed), with full backward navigation to question 1 and edit capability on any answer (see Section 9). Never dashboard. Never a forced restart. |
| (d) Fully active, paying | Interstitial page/panel shown FIRST (Section 5). Never proceeds to `/dashboard` directly. Never re-shows onboarding questions. |

### 4.4 Defining "where they left off" for state (c)

Per Question 7 in the brief: this is driven entirely by existing fields, no new progress-tracking field is needed.

- If `users.role IS NULL` (profile never saved) → resume at onboarding Step 0 (question 1), fully blank, as if state (a)/(b). There is nothing to restore.
- If `users.role IS NOT NULL` (profile saved) but `subscription_status` is `inactive`/null → the onboarding question flow (Steps 0–8) is already complete for this user; "where they left off" is the **plan/checkout step**, i.e. redirect to `/checkout` (or `/plan` if plan/topic selection itself is incomplete — see below), NOT back into the 9-step question flow. Rule 4 in the brief ("resumes them where they left off... full backward navigation... back to question 1") is satisfied by making the checkout/plan screen itself capable of navigating backward into the saved question flow for edits (Section 9), not by re-rendering the question flow as the landing screen.
  - If `users.topic_interests` is empty/null → land on `/topics`.
  - If `users.topic_interests` is set but `users.curriculum_plan` is null → land on `/plan`.
  - Otherwise → land on `/checkout`.
- This logic requires reading the already-saved `users` row (role, topic_interests, curriculum_plan, subscription_status) — all fields that already exist and are already populated by the current onboarding/topics/plan flow. No schema change.

---

## 5. Screen / Flow Description

### 5.1 State (d) — "You're already signed in" interstitial

**Route:** Rendered at `/onboarding` itself (no new URL) as a distinct render branch — see Section 12 for exact file placement. It replaces the current silent `router.replace('/dashboard')` call.

**What is on screen:**
- Full-screen, black background (`#080808`), centered content, consistent with the rest of the onboarding page's visual treatment.
- A small icon (Lucide `Lock` or `UserCheck`, 56px circle, amber-tinted background `bg-amber-900/30` with `border-amber-700/40`, matching the existing "Account already exists" pattern already shipped in `app/checkout/page.tsx` lines 477–496 — this spec reuses that exact visual pattern for consistency).
- Heading: "You're already signed in" — white, bold, ~24px (matches `app/checkout/page.tsx`'s `text-xl font-bold` interstitial heading).
- Body line 1: "You're signed in as" — `#94A3B8`, small.
- Body line 2: the user's email address, bold white, e.g. `arun@example.com`. Sourced from Clerk's `useUser().user.primaryEmailAddress.emailAddress`.
- Body line 3 (muted, `#475569`, smaller): "Log in to continue to your dashboard."
- One button only: **"Login"** — solid purple (`#7C3AED`, hover `#6D28D9`), same button style as the existing checkout interstitial's "Sign in to your account" button.
- No secondary link, no "not you?" link, no close button, no way to reach `/dashboard` from this screen directly. This screen has exactly one exit: the Login button.

**What the user does next:** Clicks "Login."

**What happens after:** See Section 5.2 — the click (a) signs out the current Clerk session client-side via `useClerk().signOut()`, then (b) navigates to `/sign-in`. This guarantees Clerk's `<SignIn>` component renders fresh (no active session to silently bypass it — see Section 8's research finding) and requires the user to actually re-authenticate, after which Clerk's own account-confirmation/session flow completes normally and `fallbackRedirectUrl="/dashboard"` (already correctly configured per AUTH-01) sends them to the dashboard.

This satisfies rule 2 and rule 3 in the brief: Get Started itself never produces dashboard access; the only path to the dashboard from this screen is through the real Login flow, which requires an explicit credential-confirming action (re-entering credentials or clicking a Clerk social button) — a stronger guarantee than a "Continue as X" click alone, and necessary because Clerk's own components do not offer a lighter-weight confirmation click in Clio's single-session configuration (see Section 8).

### 5.2 State (c) — Resume mid-flow

**What is on screen:** The user is redirected (via `router.replace`) to whichever of `/topics`, `/plan`, or `/checkout` matches their saved progress (Section 4.4). This is not a new screen — these pages already exist and already render correctly for an authenticated user with a saved profile. The only change is that `/onboarding` now correctly routes here instead of `/dashboard`.

**Backward navigation and edit:** Handled entirely within the existing `/topics` → `/plan` → `/checkout` flow, each of which must provide a "back" affordance that leads to `/onboarding?edit=1` (or equivalent), which reloads the question flow pre-filled with the saved `users` row values and allows the user to step backward through all 9 questions and resubmit. See Section 9 for the precise edit/cascade behavior.

### 5.3 State (b) — Fresh start (no change)

No new screen. This is the current, correct behavior already in `app/onboarding/page.tsx` (the "Case 1: not signed in" branch, `setSessionChecked(true)` at line 511, falling through to normal question rendering). Explicitly confirmed as out of scope for changes.

### 5.4 State (a) — Fresh start (no change)

Same as 5.3.

---

## 6. Visual Examples

### State (d) interstitial

```
┌─────────────────────────────────────────┐
│                                         │
│              ( 🔒 )                     │
│                                         │
│         You're already signed in        │
│                                         │
│        You're signed in as               │
│        arun@example.com                  │
│                                         │
│   Log in to continue to your dashboard.  │
│                                         │
│         [PRIMARY BUTTON: "Login"]        │
│                                         │
└─────────────────────────────────────────┘
```

### State (c) — no new screen; silent redirect to correct resume point

```
/onboarding (profile exists, subscription_status = 'inactive')
        │
        ▼  router.replace, no visible interstitial (matches today's
        │  redirect-without-flash pattern already used for state (a)/(b))
        ▼
   /topics  OR  /plan  OR  /checkout   (whichever matches saved progress)
```

### State (c) → edit an earlier answer, from `/checkout` (example)

```
┌─────────────────────────────────────────┐
│  [Checkout page — existing UI]          │
│                                         │
│  ← Edit my answers                      │  ← new link/button, routes to
│                                         │     /onboarding?edit=1
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  [Progress bar, restored to full 9 steps]│
│                                         │
│  What is your role?                     │
│  (pre-filled: previously-saved answer    │
│   shown as selected)                     │
│                                         │
│  [← Back]                    [Continue →]│
└─────────────────────────────────────────┘
```

---

## 7. Data Requirements

**Read:**
- `users` table: `id`, `role`, `subscription_status`, `topic_interests`, `curriculum_plan` — read by the new `GET /api/onboarding/account-state` endpoint (Section 4, 12).
- Clerk session state: `isSignedIn`, `user.primaryEmailAddress.emailAddress` — read client-side via `useUser()`.

**Written:**
- No new writes introduced by this spec. The existing `POST /api/onboarding` save contract is unchanged (see Section 9 for the one nuance on edits).

**API calls:**
- New: `GET /api/onboarding/account-state` — returns `{ state: 'no_account' | 'started_no_signup' | 'signed_up_unpaid' | 'active_paying', resumeUrl?: string, email?: string }`. Requires no request body. Auth is optional (unauthenticated callers get `no_account` or the client determines `started_no_signup` from localStorage alone, no server call needed for that branch — see Section 12 for the exact split of client- vs server-determined state).
- Existing `GET /api/onboarding` (`hasProfile` boolean) is superseded by the richer endpoint above for the specific redirect decision, but is not deleted — it may still be used elsewhere (verify at build time; not otherwise touched by this spec).

**localStorage:**
- `clio_onboarding` — unchanged in shape and lifecycle. Used only for the pre-signup (state a/b) case, exactly as today.

---

## 8. Clerk Native Behavior — Research Finding (Question 4 in the brief)

**Conclusion: Clerk's `<SignIn>`/`<SignUp>` components do NOT provide a "Continue as X" confirmation when an active session exists, under Clio's current single-session configuration. Custom UI is required.**

Per Clerk's official documentation (`docs/nextjs/reference/components/authentication/sign-in`): "The `<SignUp/>` and `<SignIn/>` components cannot render when a user is already signed in, unless the application allows multiple sessions. If a user is already signed in and the application only allows a single session, Clerk will redirect the user to the Home URL instead." This means the current behavior of these components, if simply re-invoked with an active session, is a **silent automatic redirect with zero confirmation** — the precise opposite of what rule 2 requires, and no better than today's bug. Clerk's multi-session "account switcher" / `/choose` route behavior (a genuine "pick which signed-in account to continue as" UI) only activates for apps configured to allow multiple simultaneous sessions, which Clio is not, and re-configuring session model is out of scope for this spec (a much larger change with its own security surface).

**Implication for design:** The confirmation step this spec relies on cannot be "let Clerk show its own confirmation screen." Instead, the interstitial in Section 5.1 IS Clio's custom confirmation UI, and the guaranteed re-authentication happens by explicitly signing the user out (`useClerk().signOut()`) before navigating to `/sign-in`, so Clerk's `<SignIn>` component is guaranteed to render (no active session left to bypass it) and require a genuine re-authentication action. This is a stronger and simpler guarantee than trying to coax a "Continue as X" click out of Clerk's own components, and it reuses an already-proven pattern in the codebase (`useClerk` + `signOut` is already used in `app/dashboard/settings/SettingsClient.tsx`).

This also directly answers part of Question 1/rule 3: the "Login" button's actual behavior is sign-out-then-navigate-to-sign-in, not a bare `<Link href="/sign-in">`. This distinction matters for the acceptance criteria in Section 10 (a bare link would leave the old session active in another tab/window; explicit `signOut()` fully terminates it).

---

## 9. Backward Navigation & Edit Behavior (Question 2 in the brief)

**Decision: editing one answer patches only that field. No cascade re-confirmation of subsequent answers is required, with one exception below.**

Investigated `app/onboarding/page.tsx`'s dependency logic:
- `DEPARTMENTS` (line 84) is keyed by `roleLevel` (Step 0) and produces a `roleId` (Step 1). This is a real dependency: changing Step 0 (e.g. "Executive/C-Suite" → "Manager/Team Lead") invalidates the previously-selected Step 1 department, because the `DEPARTMENTS[roleLevel]` option list is different for each level and the old `roleId` may not exist in the new list.
- `getDomainsForRole(roleId)` (line 244) filters which domains are available at Step 4 based on the resolved `roleId`. Changing `role` (Step 1) could, in principle, make a previously-selected domain unavailable — but in practice `getDomainsForRole` is confirmed (per `lib/learning/taxonomy.ts`) to be an additive filter/reordering, not a hard exclusion list that removes previously-valid selections from the taxonomy entirely, so existing domain selections remain valid data even if the role changes; they simply may not have been the ideal filtered suggestion.
- Steps 2 (industry), 3 (AI engagement), 5 (proficiency), 6 (goal), 7 (worry), 8 (delivery preference) have no dependency on any earlier step's value.

**The one required cascade rule:** If the user edits **Step 0 (role level)** and the new level's department list (`DEPARTMENTS[newRoleLevel]`) does not contain the previously-selected `roleId`, Step 1 (department) must be cleared and the user must be forced to re-select it before continuing past Step 1 — otherwise the flow would submit a `role` value that Step 0's own dependency table considers invalid for the newly-selected level (e.g. `roleId: 'cfo'` — a C-suite-only option — paired with `roleLevel: 'manager'`). This is the same validation the fresh-flow already performs implicitly (Step 1 options are always derived live from the current `roleLevel`); the edit flow must not bypass it.

All other edits (Steps 2, 3, 4, 5, 6, 7, 8) are simple patches: changing one answer does not clear, invalidate, or require re-confirmation of any other step's answer. The user can jump directly from any step back to any other step, change one field, and land back wherever they choose (e.g. back at `/checkout`) without re-walking the entire sequence.

**Save contract:** The edit flow reuses the existing `POST /api/onboarding` endpoint and its existing `OnboardingSchema` (full-payload save) — it does not need a new PATCH-style partial-update endpoint. The onboarding page, when entered in edit mode, pre-fills all fields from the existing `users` row, lets the user change any subset, and on final "Continue"/"Save" re-submits the complete payload exactly as a fresh submission would. This is simpler and lower-risk than building field-level PATCH semantics, and matches Section 9's finding that no field genuinely needs isolated partial-update handling beyond the Step 0→1 cascade (which is a client-side selection-clearing rule, not a server contract change).

---

## 10. Success Criteria (Acceptance Tests)

**Core security invariant:**

✓ Given any account state (a/b/c/d), when the user's browser has no active Clerk session at the moment `/dashboard` is requested, then the request is redirected to `/sign-in` by `app/dashboard/layout.tsx`'s existing auth check — never rendered.

✓ Given state (d) (fully active, paying, signed in), when the user clicks "Get Started" on the homepage, then the user sees the "You're already signed in" interstitial (Section 5.1) and does NOT land on `/dashboard`.

✓ Given the state (d) interstitial is showing, when the user clicks "Login," then the current Clerk session is terminated (`signOut()` resolves) before navigation to `/sign-in` occurs, and the user must complete a genuine Clerk sign-in action (credential entry or social auth flow) before `/dashboard` renders.

✓ Given state (d), when the user clicks "Get Started" repeatedly or reloads `/onboarding` mid-interstitial, then no code path results in `/dashboard` being reached without the explicit Login-button click occurring first.

**Resume flow:**

✓ Given state (c) (signed up, `subscription_status = 'inactive'`, profile saved, topics and plan already selected), when the user clicks "Get Started," then they land on `/checkout`, not `/dashboard` and not a blank `/onboarding` question flow.

✓ Given state (c) with `topic_interests` empty, when the user clicks "Get Started," then they land on `/topics`.

✓ Given a user on `/checkout` in a resumed session, when they click "Edit my answers" and change only their industry (Step 2) and save, then their previously-saved role, AI engagement, domains, proficiency, goal, worry, and delivery preference are all preserved unchanged, and only `industry` differs in the resulting `users` row.

✓ Given a user editing their answers who changes Step 0 (role level) such that their previously-selected Step 1 department is no longer a valid option under the new level, then Step 1 is cleared and the user cannot proceed past Step 1 until they re-select a department from the new level's list.

**Fresh-start flows (regression guards — confirm no change):**

✓ Given state (a) (no Clerk session, no localStorage data), when the user clicks "Get Started," then they see a blank onboarding flow starting at Step 0. (Unchanged from today.)

✓ Given state (b) (no Clerk session, localStorage contains prior partial/complete answers), when the user clicks "Get Started" fresh (new browser tab/session, i.e. not the auto-resume-from-signup case already covered by AUTH-01), then they see a blank onboarding flow — no partial data is silently surfaced without the user having just come from Clerk sign-up. (This preserves existing state (b) behavior; verify no regression.)

---

## 11. Error States

| Trigger | What the user sees |
|---|---|
| `GET /api/onboarding/account-state` returns a network error or non-200 | Onboarding page falls back to showing a blank Step 0 question flow (fail open to the safest, least-surprising state — never fail open toward `/dashboard`). This mirrors the existing fallback pattern for `GET /api/onboarding`'s error handling (line 527–530 today). |
| `useClerk().signOut()` throws/rejects when the user clicks "Login" on the state (d) interstitial | Navigate to `/sign-in` regardless (best-effort sign-out); Clerk's own sign-in page will still require credential entry if the session truly could not be cleared client-side, because Clerk's server-side session validation is the actual source of truth, not the client call succeeding. Log the error client-side only (no PII) for debugging. |
| Resume-state lookup (Section 4.4) finds an inconsistent `users` row (e.g. `curriculum_plan` set but `topic_interests` empty) | Default to the earliest incomplete step in the sequence (`/topics` takes precedence over `/plan` takes precedence over `/checkout`) — never guess forward. |

---

## 12. Edge Cases

- **User has two browser tabs open, one showing the state (d) interstitial, one already on `/dashboard`:** Clicking "Login" in the interstitial tab calls `signOut()`, which (per Clerk's standard behavior) invalidates the session across tabs. The `/dashboard` tab will be caught by its own existing auth check on next navigation/refresh and redirected to `/sign-in`. No new handling required — this is Clerk's standard cross-tab session behavior.
- **User in state (c) has a stale `clio_onboarding` localStorage entry from a previous incomplete anonymous attempt, then signs in as a different, already-partially-onboarded account on the same browser:** The server-side account-state check (Section 4, based on the authenticated `users` row) takes precedence over any localStorage data once `isSignedIn === true`. LocalStorage is only consulted in the unauthenticated branch (states a/b). This is already how the existing code is structured (Case 2 checks the DB first; localStorage is Case 3/4, gated behind "no DB profile found").
- **User in state (d) has an expired trial (`subscription_status` reverted to `'inactive'` by Stripe webhook) between page loads:** They are correctly reclassified as state (c) on the next `/onboarding` visit (server-side check is always live, not cached) and resumed toward `/checkout` for renewal — this is correct and desired, not a bug.
- **Mobile vs desktop:** No layout differences required; the interstitial (Section 5.1) uses the same responsive centered-card pattern already used by the existing checkout interstitial.
- **Slow network on the account-state check:** Show the existing onboarding page's current loading/blank state (the page already gates rendering behind `sessionChecked`; the new account-state check is added to that same gate, not a separate spinner).

---

## 13. Out of Scope

- Any change to Clerk's session model (single-session vs multi-session configuration). This spec works within the existing single-session setup.
- Any change to `middleware.ts`'s `isPublicRoute` list — see Section 14 for the explicit decision and reasoning.
- Any new database columns or migrations. This spec uses only fields that already exist.
- Editing onboarding answers after a plan has already been approved/curriculum generated (i.e., post state-(d) profile editing) — this remains a separate, not-yet-specced feature per AUTH-01 Section 10.
- Changes to the `/api/checkout` "already active" / cross-account-dedup interstitial (Section 5.1's visual pattern is reused, but that code path itself is untouched).
- Multi-device/multi-session "choose which account" UX. Out of scope; not needed given the single-session model.

---

## 14. Open Questions

None.

Rationale for why each of the brief's 7 questions was resolved without escalation:

1. **Interstitial copy** — decided in Section 5.1, directly reusing the existing, already-shipped, CEO-approved visual/copy pattern from `app/checkout/page.tsx`'s "Account already exists" interstitial. This is not a novel product decision; it's applying an established pattern to a parallel situation.
2. **Edit/cascade UX** — resolved in Section 9 via direct code investigation of `DEPARTMENTS`/`getDomainsForRole`. The one genuine dependency (Step 0 → Step 1) is handled; everything else is confirmed independent by reading the actual taxonomy logic, not assumed.
3. **Middleware change** — resolved in Section 4/12: remains page-level/client+API logic, no middleware change (see Section 12 note below for the one-line justification, mirrored from Section 4's trigger definition — `/onboarding` stays public because the new account-state check is itself a normal authenticated API call made from the client, exactly like the existing `GET /api/onboarding` call today; there is no scenario where gating `/onboarding` itself at the middleware layer adds security, since the actual dashboard access gate already lives correctly in `app/dashboard/layout.tsx` and is not being weakened by this spec).
4. **Clerk native "Continue as X" behavior** — resolved definitively in Section 8 via Clerk's own documentation: no such confirmation exists in Clio's single-session config; custom UI is mandatory and specified.
5. **Account-state decision table** — resolved in Section 4, using the codebase's own already-proven `subscription_status` check rather than the brief's proposed (and incorrect) `plan_approved` inclusion.
6. **File-level placement** — resolved in Section 15 below (mirrors AUTH-01's Section 13 style).
7. **"Where they left off" definition** — resolved in Section 4.4, using only existing fields (`role`, `topic_interests`, `curriculum_plan`, `subscription_status`), no new progress field.

---

## 15. Dependencies & Files a Developer Must Check

Any change under this spec must review and touch the following:

| File | What to verify / change |
|---|---|
| `app/onboarding/page.tsx` | Replace the silent `router.replace('/dashboard')` at line ~521 with a branch on the new account-state result: state (d) → render interstitial component; state (c) → `router.replace` to the correct resume URL per Section 4.4; states (a)/(b) → unchanged existing behavior. Add `?edit=1` support to pre-fill all fields from the existing `users` row and allow full backward navigation (Section 9). |
| `app/api/onboarding/route.ts` | Add new `GET` logic (or a new sibling route `app/api/onboarding/account-state/route.ts` — preferred, to avoid overloading the existing `hasProfile`-shaped `GET`) returning the 4-state classification per Section 4.2, reading `role`, `subscription_status`, `topic_interests`, `curriculum_plan`. |
| New: `app/api/onboarding/account-state/route.ts` | New endpoint per Section 7. Must not require the caller to be authenticated (unauthenticated → `no_account`/`started_no_signup`, determined without a DB call). |
| New: component for the state (d) interstitial (e.g. `components/onboarding/AlreadySignedInInterstitial.tsx`) | Implements Section 5.1 exactly: icon, heading, email display via `useUser()`, single "Login" button wired to `useClerk().signOut()` then `router.push('/sign-in')`. |
| `app/(auth)/sign-in/[[...sign-in]]/page.tsx` | No change required — already correctly configured per AUTH-01 (`fallbackRedirectUrl="/dashboard"`, `signUpForceRedirectUrl="/onboarding"`, no `forceRedirectUrl`). Verify this remains true; do not regress AUTH-01's Anti-pattern 1. |
| `app/(auth)/sign-up/[[...sign-up]]/page.tsx` | No change required — verify `forceRedirectUrl="/onboarding"` remains unmodified (AUTH-01 Anti-pattern 2). |
| `middleware.ts` | No change. `/onboarding(.*)` remains in `isPublicRoute`. Confirm `app/dashboard/layout.tsx`'s own auth+subscription check (unchanged, already correct) remains the actual dashboard gate. |
| `app/dashboard/layout.tsx` | No change required — this file's existing `hasAccess` check (`subscription_status IN ('active','trialing')`) is the reference implementation this spec's Section 4 decision table is built from. Do not duplicate or diverge from this logic; import/reuse if practical. |
| `app/topics/page.tsx`, `app/plan/page.tsx` (or equivalent), `app/checkout/page.tsx` | Each needs a small "Edit my answers" affordance linking to `/onboarding?edit=1` (Section 9). Verify each of these pages already correctly redirects an unauthenticated visitor and correctly renders for an authenticated, profile-having, unpaid user (per AUTH-01 Anti-pattern 3/4) — do not regress those guarantees while adding the edit link. |
| `lib/learning/taxonomy.ts` | Verify `getDomainsForRole` behavior assumption in Section 9 (additive filter, not exclusionary) holds before shipping the "no cascade needed beyond Step 0→1" decision — if this function is later changed to hard-exclude previously valid domains, Section 9 must be revisited. |

---

## 16. Reconciliation With AUTH-01 (explicit, per brief's requirement)

- **Superseded:** AUTH-01 Section 9's statement "The onboarding page should detect that a profile already exists... and redirect to `/dashboard`. This guard must be implemented" is superseded for the case of an active session. The guard is still implemented, but its destination is no longer unconditionally `/dashboard` — it now branches per the 4-state table in Section 4 of this document. AUTH-01's underlying concern (a returning user should not have their profile silently overwritten by re-answering onboarding questions) is still fully honored: states (c) and (d) both avoid re-running the question flow as the default landing.
- **Not modified, still valid:** AUTH-01 Section 2 (Flow A/Flow B definitions), Section 3 (entry point table), Section 12 Anti-patterns 1–5 (redirect prop correctness, `/plan` public-route status, save-before-redirect ordering), and Section 14 (incident record) all remain fully in force. No file or redirect prop covered by those sections is changed by this spec except as explicitly listed in Section 15 above.
