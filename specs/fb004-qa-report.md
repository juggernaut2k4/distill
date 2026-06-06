# FB-004 QA Report — localStorage Auto-Submit Verification

Status: PASS (no code changes required)
Date: 2026-06-06
Reviewed by: Backend Agent

---

## Files inspected

- `app/onboarding/page.tsx`
- `middleware.ts`
- `app/api/onboarding/route.ts`

---

## Step-by-step findings

### localStorage key name
- Key written: `'clio_onboarding'` (line 630 of `page.tsx`, inside `submitOnboarding`)
- Key read: `localStorage.getItem('clio_onboarding')` (line 504, `useEffect`)
- Key removed: `localStorage.removeItem('clio_onboarding')` (line 514, before auto-submit fires)
- **MATCH** — no key mismatch.

### Auto-submit logic (`useEffect`, lines 502–529)
- Guard: `if (!clerkLoaded || !isSignedIn) return` — fires only when Clerk is ready and user is signed in.
- Reads `clio_onboarding` from localStorage.
- Parses JSON with try/catch; malformed JSON is caught, key removed, falls through to show form.
- Guard: `if (!parsed.role || !parsed.learningGoal) return` — matches spec exactly.
- Calls `localStorage.removeItem('clio_onboarding')` before calling `submitOnboarding` — prevents re-submission on page re-visit.
- Calls `setBuilding(true)` and `submitOnboarding(parsed.learningGoal, snapshot)`.
- **CORRECT** — auto-submit fires correctly.

### Redirect after successful submit
- `submitOnboarding` calls `router.push('/topics')` on HTTP 200.
- **CORRECT** — matches spec (Step 7: browser navigates to `/topics`).

### 401 retry logic
- On `401` with `error === 'session_not_ready'`, retries up to 3 times with 1-second delays.
- After exhausting retries on 401: `setSubmitError('__needs_auth__')` — shows sign-up prompt.
- **CORRECT**.

### Sign-up prompt link
- Button href: `/sign-up?redirect_url=/onboarding` — after sign-up, Clerk redirects back to `/onboarding`.
- Sign-in link: `/sign-in?redirect_url=/onboarding` — also returns to `/onboarding`.
- **CORRECT** — Clerk must be configured with `afterSignUpUrl=/onboarding` (env var `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding`).

### Middleware — `/onboarding` public access
- `isPublicRoute` matcher includes `'/onboarding(.*)'` (line 8 of `middleware.ts`).
- API routes bypass the page-level `auth().protect()` gate entirely (line 27: `if (!isApiRoute && !isPublicRoute(request))`).
- **CORRECT** — anonymous users can reach `/onboarding` without auth.

### API route — all 6 fields accepted
`app/api/onboarding/route.ts` Zod schema accepts:

| Onboarding field | API key | users column | Status |
|---|---|---|---|
| roleLevel (step 0) | `roleLevel` | `role_level` | ACCEPTED |
| role (step 1 roleId) | `role` | `role` | ACCEPTED |
| industry (step 2) | `industry` | `industry` | ACCEPTED |
| aiEngagement (step 3) | `aiMaturity` | `ai_maturity` | ACCEPTED |
| selectedDomains (step 4) | `domains` | `domains` | ACCEPTED |
| learningGoal (step 5) | `learningGoal` | `learning_goal` | ACCEPTED |

All 6 fields are saved in the `userRecord` upsert object. **CORRECT**.

### localStorage payload written before API call
`submitOnboarding` writes the full payload to `clio_onboarding` before calling `fetch('/api/onboarding')` (line 630). This ensures the payload survives a browser close or network failure before the API call completes. **CORRECT**.

---

## Potential gap (not a bug — operational check required)

The Clerk dashboard must have:
- `afterSignUpUrl` = `/onboarding` (or `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding` env var set)
- `afterSignInUrl` = `/onboarding` (or `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/onboarding` env var set)

If `afterSignInUrl` is set to `/dashboard`, a returning user who signed in (rather than signed up) after completing anonymous onboarding would land on the dashboard and the auto-submit would not fire. This is an operational configuration item, not a code bug.

---

## Verdict

**PASS** — no code changes required. The localStorage key name, auto-submit logic, 401 retry, redirect destination, public middleware route, and all 6 API fields are correctly implemented per the FB-004 spec.
