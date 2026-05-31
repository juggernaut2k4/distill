# Flow Fix — Topics Before Sign-Up — Requirement Document

Version: 1.0
Status: AWAITING CEO APPROVAL
Author: Business Analyst Agent
Date: 2026-05-31
Feature Brief: FB-003

---

## 1. Purpose

The user journey currently sends new visitors to `/sign-up` before they have experienced the product's core value proposition (personalised topic recommendations). This breaks the product-led growth model: users are asked to commit to an account before they know Clio is worth signing up for.

This document specifies six targeted corrections to the navigation graph. Two of the six fixes (middleware and dashboard gate) are already correctly implemented in the current codebase. This document specifies all six for completeness and audit trail purposes, clearly marking which require code changes and which are confirmations of existing correct behaviour.

---

## 2. Scope

### In scope
- Fix 1: `app/onboarding/page.tsx` — remove `isSignedIn` conditional; always redirect to `/topics` after Q6
- Fix 2: `middleware.ts` — confirm `/topics` is already a public route (no code change needed)
- Fix 3: `app/topics/page.tsx` — make the "Build my learning plan" button auth-aware; write selected topics to localStorage before redirecting unauthenticated users to `/sign-up`
- Fix 4: `app/(auth)/sign-up/[[...sign-up]]/page.tsx` — change `afterSignUpUrl` from `/onboarding` to `/plan`
- Fix 5: `app/topics/page.tsx` — reduce the topic selection minimum from 3 to 1
- Fix 6: `app/dashboard/layout.tsx` — confirm redirect target is already `/plan` (no code change needed)

### Out of scope
- Topic recommendation logic or Claude API prompts
- Onboarding questions (content, order, validation)
- S5 trial redesign
- Inngest mark-session-ready race condition
- Any visual redesign of the topics or sign-up pages
- `/plan` page behaviour or content

---

## 3. User Stories

**US-003-A (primary):** As a new visitor who has never signed in, I want to see my personalised topic recommendations immediately after answering the onboarding questions — before being asked to create an account — so I know Clio is worth signing up for.

**US-003-B:** As a new visitor, when I click "Build my learning plan" on the topics page with at least 1 topic selected, I want to be taken to sign up and then land directly on the plan selection page (not back to onboarding).

**US-003-C:** As a signed-in user on the topics page with at least 1 topic selected, when I click "Build my learning plan" I want to go directly to `/plan`.

**US-003-D:** As a signed-in user who somehow reaches `/dashboard` without an active subscription, I want to be redirected to `/plan` (not `/pricing`) so I can subscribe.

---

## 4. Detailed Requirements

### FIX 1 — Onboarding always redirects to /topics

**File:** `app/onboarding/page.tsx`
**Current behaviour:** Line 584: `router.push(isSignedIn ? '/topics' : '/sign-up')`
**Required behaviour:** Always `router.push('/topics')`

**Change:**

Remove the import of `useUser` from `@clerk/nextjs` if it is not used for any other purpose after this change.

Replace the conditional redirect:
```
router.push(isSignedIn ? '/topics' : '/sign-up')
```
with:
```
router.push('/topics')
```

**Side effects to check:** `useUser()` is currently called at line 477 to obtain `isSignedIn`. After removing this use, if `isSignedIn` is not referenced anywhere else in the component, remove the `useUser` call entirely. If `useUser` is still imported but unused, remove the import.

**Scope confirmation:** The `submitOnboarding` function already writes the full onboarding payload to `localStorage.setItem('clio_onboarding', ...)` at line 570 before the redirect. This localStorage write does not change.

---

### FIX 2 — /topics is a public route (ALREADY DONE — no code change)

**File:** `middleware.ts`
**Current state:** `/topics(.*)` is already present in the `isPublicRoute` matcher at line 11.
**Required state:** Same as current.

**Action for developer:** Read `middleware.ts` and confirm `/topics(.*)` is in the public route list. No edit needed.

---

### FIX 3 — Topics "Build my learning plan" button is auth-aware

**File:** `app/topics/page.tsx`
**This is the most complex fix. Read all sub-sections carefully.**

#### 3a. Auth detection

Add `useUser` from `@clerk/nextjs` to the imports. Call `const { isSignedIn } = useUser()` inside the `TopicsPage` component. This hook is safe to call on a public page — it returns `false` for unauthenticated users without throwing or redirecting.

#### 3b. Topic minimum: reduce from 3 to 1

Current code at line 319:
```
const canContinue = selectedCount >= 3
```

Change to:
```
const canContinue = selectedCount >= 1
```

#### 3c. Subheading copy update

Current copy at line 375:
```
Select the topics you want to master. Pick at least 3.
```

Change to:
```
Select the topics you want to master.
```

#### 3d. Tooltip copy update

Current tooltip at line 495:
```
Select at least 3 topics to continue
```

Change to:
```
Select at least 1 topic to continue
```

#### 3e. localStorage write before navigation

When the user clicks "Build my learning plan" and is NOT signed in, the component must write selected topics to localStorage before redirecting to `/sign-up`.

**Key:** `clio_onboarding`
**Current shape stored by onboarding page:**
```typescript
{
  role: string,
  industry: string,
  aiMaturity: string,
  worry: string,
  deliveryPreference: string,
  timezone: string,
  domains: string[],
  customDomains: string[],
  primaryDomain: string,
  domainProficiency: Record<string, string>,
  learningGoal: string,
  subDomain: string,
}
```

**Required: merge `selectedTopics` into the existing `clio_onboarding` object.**

Do NOT overwrite the entire `clio_onboarding` key — read the existing value, parse it, add `selectedTopics`, then write back. This preserves all onboarding data. If the existing value is absent or unparseable, write only `{ selectedTopics }`.

`selectedTopics` must be an array of topic title strings (not IDs), so that `/plan` and downstream consumers can display them without needing to resolve IDs.

**Derivation logic:** Iterate over all selected topic IDs (`selectedIds`). For each ID, look up the topic title by searching `sections` (all AI-recommended sections) and `customTopics`. Custom topics have IDs in the format `custom-${timestamp}`.

**The write must happen synchronously before `router.push`.**

#### 3f. Button click handler

Replace the current inline `onClick`:
```
onClick={() => canContinue && router.push('/plan')}
```

With a named handler:
```typescript
function handleContinue() {
  if (!canContinue) return

  // Collect selected topic titles
  const allTopics: RecommendedTopic[] = [
    ...sections.flatMap((s) => s.topics),
    ...customTopics,
  ]
  const selectedTitles = Array.from(selectedIds)
    .map((id) => allTopics.find((t) => t.id === id)?.title)
    .filter((title): title is string => Boolean(title))

  // Merge into existing clio_onboarding localStorage value
  let existing: Record<string, unknown> = {}
  try {
    const raw = localStorage.getItem('clio_onboarding')
    if (raw) existing = JSON.parse(raw) as Record<string, unknown>
  } catch { /* ignore */ }
  localStorage.setItem('clio_onboarding', JSON.stringify({
    ...existing,
    selectedTopics: selectedTitles,
  }))

  if (isSignedIn) {
    router.push('/plan')
  } else {
    router.push('/sign-up')
  }
}
```

Update the button `onClick` to call `handleContinue`.

#### 3g. Button states — all four combinations

| Auth state | Topics selected | Button label | Button appearance | On click |
|---|---|---|---|---|
| Not signed in | 0 | "Build my learning plan" | Disabled (`bg-[#1A1A1A] text-[#475569] cursor-not-allowed`) | Nothing |
| Not signed in | 1+ | "Build my learning plan" | Enabled (`bg-[#7C3AED] hover:bg-[#A855F7] text-white`) | Write localStorage, push `/sign-up` |
| Signed in | 0 | "Build my learning plan" | Disabled (`bg-[#1A1A1A] text-[#475569] cursor-not-allowed`) | Nothing |
| Signed in | 1+ | "Build my learning plan" | Enabled (`bg-[#7C3AED] hover:bg-[#A855F7] text-white`) | Write localStorage, push `/plan` |

The button label does NOT change based on auth state. The label is always "Build my learning plan" with the ArrowRight icon. This keeps the UI simple and avoids flickering while `isSignedIn` resolves.

#### 3h. Tooltip (disabled state)

The tooltip shown on hover when `!canContinue` changes from "Select at least 3 topics to continue" to "Select at least 1 topic to continue" (see section 3d). The tooltip only shows when the button is disabled. No change to tooltip positioning or styling.

---

### FIX 4 — afterSignUpUrl changes to /plan

**File:** `app/(auth)/sign-up/[[...sign-up]]/page.tsx`
**Current value:** `afterSignUpUrl="/onboarding"`
**Required value:** `afterSignUpUrl="/plan"`

**Rationale:** After sign-up, the user's onboarding data and selected topics are already in `localStorage.clio_onboarding.selectedTopics`. There is no reason to send them back through the 6-question onboarding. They should land on `/plan` to choose their subscription tier.

**Change:**
```tsx
// Before
<SignUp afterSignUpUrl="/onboarding" ... />

// After
<SignUp afterSignUpUrl="/plan" ... />
```

No other changes to this file.

**Note on social auth (Google, GitHub):** Clerk's `afterSignUpUrl` applies to all sign-up methods including OAuth. A user who signs up with Google will therefore also land on `/plan`. This is correct behaviour because their onboarding data is in localStorage and will be read by `/plan`.

---

### FIX 5 — Topic minimum: 1 (incorporated into Fix 3)

This fix is fully specified in Fix 3 sections 3b, 3c, and 3d. All changes are in `app/topics/page.tsx`.

---

### FIX 6 — Dashboard gate redirects to /plan (ALREADY DONE — no code change)

**File:** `app/dashboard/layout.tsx`
**Current state:** Lines 28–30 already read:
```typescript
if (!hasAccess) {
  redirect('/plan')
}
```
**Required state:** Same as current. The dashboard already redirects unsubscribed users to `/plan`.

**Action for developer:** Read `app/dashboard/layout.tsx` and confirm the redirect target on line 29 is `/plan`. No edit needed.

---

## 5. Data Contract — localStorage

### Key: `clio_onboarding`

This key is written in two phases:

**Phase 1 — written by `app/onboarding/page.tsx` after Q6:**
```typescript
{
  role: string,                            // resolved roleId e.g. "ceo"
  industry: string,                        // empty string (legacy field, kept for compat)
  aiMaturity: string,                      // proficiency of primaryDomain e.g. "intermediate"
  worry: string,                           // empty string (legacy field, kept for compat)
  deliveryPreference: string,              // "email"
  timezone: string,                        // IANA timezone e.g. "Europe/London"
  domains: string[],                       // selected domain IDs e.g. ["ai-ml", "finance"]
  customDomains: string[],                 // user-typed custom domains
  primaryDomain: string,                   // first selected domain ID
  domainProficiency: Record<string, string>, // e.g. { "ai-ml": "intermediate" }
  learningGoal: string,                    // e.g. "deep-dive"
  subDomain: string,                       // e.g. "Banking"
}
```

**Phase 2 — merged by `app/topics/page.tsx` when user clicks "Build my learning plan":**
Adds one field to the existing object:
```typescript
{
  ...existingPhase1Fields,
  selectedTopics: string[],   // topic TITLES (not IDs), e.g. ["AI Strategy for Executives", "LLM Evaluation Frameworks"]
}
```

**Reading by `/plan` page:** The `/plan` page (`PlanClient.tsx`) currently reads only `clio_selected_plan` from localStorage. It does NOT currently read `clio_onboarding.selectedTopics`. No change to `PlanClient.tsx` is required for this feature — the `selectedTopics` field is written for future use by the plan page or API.

**Reading by `/api/onboarding`:** The onboarding API is called fire-and-forget from `submitOnboarding()` in the onboarding page. It does not need to be updated for this feature.

---

## 6. Acceptance Criteria

All criteria must pass before this feature is considered complete.

### AC-001: Unauthenticated user completes onboarding → lands on /topics
- **Given** a user who has never signed in
- **When** they complete all 6 onboarding questions and the 2-second building animation plays
- **Then** they are redirected to `/topics` (not `/sign-up`)

### AC-002: /topics is accessible without authentication
- **Given** a user who has never signed in
- **When** they navigate to `/topics` directly or arrive from onboarding
- **Then** the page renders without a Clerk redirect to `/sign-in`
- **And** all 4 recommendation sections load (or the loading skeleton displays while fetching)

### AC-003: Button disabled with 0 topics
- **Given** a user on `/topics` (signed in or not) with 0 topics selected
- **When** they view the sticky bottom bar
- **Then** the "Build my learning plan" button is visually disabled (`bg-[#1A1A1A] text-[#475569] cursor-not-allowed`)
- **And** clicking the button does nothing

### AC-004: Button enabled with 1 topic
- **Given** a user on `/topics` (signed in or not) with exactly 1 topic selected
- **When** they view the sticky bottom bar
- **Then** the "Build my learning plan" button is enabled (`bg-[#7C3AED] text-white`)

### AC-005: Unauthenticated user with 1+ topics → /sign-up with localStorage write
- **Given** a user who has never signed in
- **And** they have selected at least 1 topic on `/topics`
- **When** they click "Build my learning plan"
- **Then** `localStorage.getItem('clio_onboarding')` contains a `selectedTopics` array with the titles of all selected topics
- **And** they are redirected to `/sign-up`

### AC-006: Signed-in user with 1+ topics → /plan
- **Given** a user who is signed in
- **And** they have selected at least 1 topic on `/topics`
- **When** they click "Build my learning plan"
- **Then** `localStorage.getItem('clio_onboarding')` contains a `selectedTopics` array with the titles of all selected topics
- **And** they are redirected to `/plan`

### AC-007: After sign-up → /plan (not /onboarding)
- **Given** a new user who arrived at `/sign-up` (via the topics page flow or directly)
- **When** they complete sign-up (email/password or Google/GitHub OAuth)
- **Then** they are redirected to `/plan`
- **And** NOT to `/onboarding`

### AC-008: selectedTopics preserves onboarding data
- **Given** a user has completed onboarding (Phase 1 localStorage write is present)
- **When** topics are merged into localStorage (Phase 2)
- **Then** all Phase 1 fields (`role`, `domains`, `primaryDomain`, `subDomain`, etc.) are still present in `clio_onboarding`
- **And** only `selectedTopics` is added

### AC-009: Signed-in user without subscription → /plan
- **Given** a signed-in user whose `subscription_status` is neither `active` nor `trialing`
- **When** they navigate to `/dashboard` or any `/dashboard/*` route (except `/dashboard/welcome`)
- **Then** they are redirected to `/plan`
- **And** NOT to `/pricing`

### AC-010: Signed-in user with active subscription is not affected
- **Given** a signed-in user with `subscription_status` of `active` or `trialing`
- **When** they navigate to `/topics`
- **Then** the page renders normally
- **And** clicking "Build my learning plan" with 1+ topics redirects to `/plan` (not `/sign-up`)

### AC-011: Custom topics are included in selectedTopics
- **Given** a user has added at least 1 custom topic on `/topics` and it remains selected
- **When** they click "Build my learning plan"
- **Then** the custom topic's title is included in `selectedTopics` in localStorage

### AC-012: Tooltip copy is updated
- **Given** a user on `/topics` with 0 topics selected
- **When** they hover over the disabled "Build my learning plan" button
- **Then** the tooltip reads "Select at least 1 topic to continue" (not "at least 3")

---

## 7. Edge Cases

### EC-001: User navigates to /topics without completing onboarding
The topics page reads `localStorage.clio_onboarding` for the profile used to fetch AI recommendations. If this key is absent (user navigated directly to `/topics`), the page already handles this gracefully — it passes empty strings to the API and renders whatever recommendations come back, or shows the empty state. No change to this behaviour.

When such a user clicks "Build my learning plan":
- Phase 1 localStorage data is absent
- The merge step reads an empty existing object: `existing = {}`
- The write produces: `{ selectedTopics: ["Topic Title", ...] }`
- Navigation proceeds as normal (to `/sign-up` or `/plan`)
This is acceptable. The `/plan` page does not depend on the full Phase 1 payload.

### EC-002: User completes onboarding while already signed in
- The onboarding page no longer checks `isSignedIn` — it always redirects to `/topics`
- The signed-in user lands on `/topics`, sees recommendations, clicks the button
- The button's `isSignedIn` check (via `useUser()`) returns `true`
- localStorage is written, user is sent to `/plan`
- This is the correct path

### EC-003: User returns to /topics after signing up
- After sign-up, Clerk redirects to `/plan` (Fix 4)
- The user does NOT return to `/topics` automatically
- If the user manually navigates back to `/topics` after sign-up, the page renders normally — it is a public page, and signed-in users can use it. Clicking "Build my learning plan" will overwrite `selectedTopics` in localStorage and redirect to `/plan`.

### EC-004: isSignedIn is undefined during hydration
`useUser()` from `@clerk/nextjs` returns `{ isSignedIn: undefined }` briefly during SSR hydration. The button click handler must treat `undefined` as "not signed in" and redirect to `/sign-up`. This is safe: the worst case is a signed-in user briefly redirected to `/sign-up` on an extremely slow connection, which they will not encounter in practice.

Implement as: `if (isSignedIn === true)` (strict equality), not `if (isSignedIn)`. Wait — on reflection, `if (isSignedIn)` is equivalent here since `undefined` and `false` both fail the truthiness check. Either form is correct. Developer may use either.

### EC-005: localStorage write fails (private browsing, quota exceeded)
The localStorage write is wrapped in a try/catch. If it fails, navigation still proceeds. The selectedTopics will not be available to downstream consumers, but the user's journey is not blocked. This matches the existing pattern in the codebase (onboarding page already uses this approach for the /api/onboarding fire-and-forget).

### EC-006: User deselects a topic after adding it to localStorage
`selectedTopics` is only written at the moment the user clicks the CTA button. There is no real-time sync of `selectedTopics` to localStorage as topics are toggled. This is intentional — writing on every toggle is unnecessary. The final state at click time is what matters.

### EC-007: Topics page reached from /plan back navigation
Users on `/plan` can click back in the browser and return to `/topics`. Their selections will not be pre-populated (localStorage `selectedTopics` is not read back into the component state on mount). This is acceptable — the user can re-select. Restoring previous selections from localStorage on mount is out of scope for this feature.

---

## 8. Non-Functional Requirements

**NFR-001: No flicker on button CTA text.** The button label "Build my learning plan" must not change based on `isSignedIn`. Auth-aware behaviour is in the destination, not the label. This prevents a visible CTA label swap during hydration.

**NFR-002: No loading state on the button.** The button does not show a spinner while `isSignedIn` resolves. The `useUser()` hook resolves within one render cycle after hydration. The 0-topic disabled state provides a natural moment for hydration to complete before users are likely to click.

**NFR-003: localStorage write is synchronous.** `localStorage.setItem` is synchronous by nature. The write completes before `router.push` executes. No async handling needed.

**NFR-004: TypeScript strict mode.** All changes must compile under `strict: true`. The `filter((title): title is string => Boolean(title))` type guard in the handler ensures the `selectedTitles` array is `string[]`, not `(string | undefined)[]`.

---

## 9. Files Changed

| File | Change type | Description |
|---|---|---|
| `app/onboarding/page.tsx` | Edit | Remove `isSignedIn` conditional; always redirect to `/topics`; remove `useUser` import if unused |
| `app/topics/page.tsx` | Edit | Add `useUser` import; change minimum from 3 to 1; replace inline `onClick` with `handleContinue`; update subheading and tooltip copy |
| `app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Edit | Change `afterSignUpUrl` from `/onboarding` to `/plan` |
| `middleware.ts` | No change | `/topics` already public — confirm only |
| `app/dashboard/layout.tsx` | No change | Already redirects to `/plan` — confirm only |

---

## 10. Testing

### Manual test script

**Preconditions:** Clear all localStorage and cookies. Not signed in.

1. Navigate to `/onboarding`
2. Complete all 6 questions
3. Wait for building animation (2 seconds)
4. **Assert:** Browser URL is `/topics` (not `/sign-up`) — verifies Fix 1
5. **Assert:** Topic recommendations load (or skeleton shows while loading) — verifies Fix 2
6. **Assert:** "Build my learning plan" button is disabled with 0 topics selected — verifies Fix 5 (0 state)
7. Select 1 topic
8. **Assert:** "Build my learning plan" button becomes enabled — verifies Fix 5 (1 topic threshold)
9. **Assert:** Tooltip on hover of disabled button (before step 7) says "Select at least 1 topic to continue" — verifies Fix 5 copy
10. Click "Build my learning plan"
11. **Assert:** `JSON.parse(localStorage.getItem('clio_onboarding')).selectedTopics` is an array containing the title of the topic selected in step 7 — verifies Fix 3 localStorage write
12. **Assert:** Browser URL is `/sign-up` — verifies Fix 3 unauthenticated path
13. Complete sign-up
14. **Assert:** Browser URL is `/plan` (not `/onboarding`) — verifies Fix 4

**Test for signed-in path:**

1. Sign in as an existing user without an active subscription
2. Navigate to `/topics`
3. Select 1 topic
4. Click "Build my learning plan"
5. **Assert:** Browser URL is `/plan` (not `/sign-up`) — verifies Fix 3 signed-in path

**Test for Fix 6 (dashboard gate):**

1. Sign in as a user without an active subscription
2. Navigate to `/dashboard`
3. **Assert:** Browser URL is `/plan` (not `/pricing`)

### Regression checks

- Signed-in user with active subscription: navigate to `/topics`, select topics, click CTA — must go to `/plan`
- Signed-in user with active subscription: navigate to `/dashboard` — must NOT be redirected
- Direct navigation to `/topics` without onboarding data: page must render without error (empty state or recommendations based on empty profile)

---

## 11. Open Questions

None. All questions resolved. Assumptions stated below.

---

## 12. Assumptions

**A-001: `/plan` route is accessible without authentication.**
The `/plan` page (`app/plan/page.tsx`) is not in the protected route list in `middleware.ts` and is not wrapped by a layout that requires auth. Confirmed by reading `app/plan/page.tsx` — it calls `auth()` from Clerk but handles `userId === null` gracefully by rendering `PlanClient` without redirect. This means unauthenticated users who reach `/sign-up` and then land on `/plan` post-sign-up will see the plan page. Correct.

**A-002: `useUser()` is safe to call on a public page.**
Clerk's `useUser()` hook does not throw or redirect when called on a public page by an unauthenticated user. It returns `{ isSignedIn: false }`. This is documented Clerk behaviour and has been observed in the existing codebase (the onboarding page already uses `useUser()`).

**A-003: selectedTopics titles are sufficient for /plan.**
The `/plan` page (`PlanClient.tsx`) currently reads only `clio_selected_plan` from localStorage and does not display selected topics. The `selectedTopics` field written to localStorage by Fix 3 is for forward-compatibility (e.g. the API call that creates the user's learning plan). No changes to `/plan` are needed for this feature.

**A-004: The sign-up page does not use environment variable NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL.**
The `afterSignUpUrl` prop is hardcoded in the `<SignUp>` component. If `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` exists as an environment variable, Clerk's SDK may override the prop. The developer must check whether this env var is set in Vercel (or `.env.local`) and update it to `/plan` if present, to ensure consistent behaviour across SDK prop and env var.

**A-005: Social auth (Google) respects afterSignUpUrl.**
Clerk's `afterSignUpUrl` applies to all sign-up methods including OAuth. This is documented Clerk behaviour. After a Google sign-up, the user lands on `/plan`. If Clerk's behaviour differs between OAuth and email/password in the deployed environment, this must be raised as a blocker.

**A-006: Two "no code change needed" fixes are confirmed correct.**
Fix 2 (middleware) and Fix 6 (dashboard gate) have been verified by reading the source files. `/topics(.*)` is present in the `isPublicRoute` matcher in `middleware.ts`. The dashboard layout redirects to `/plan` not `/pricing`. The developer must confirm these during implementation — do not assume they remain correct if other branches have touched these files since this document was written.
