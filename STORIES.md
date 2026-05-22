# Clio — Story Backlog

> Work order: S1 → S2 → S3 → S4 → S5 → S6 → S7 (QA last, after all above complete)
> Each story is self-contained. Do not start the next until current story passes acceptance criteria.

---

## S1 — Welcome Email on Signup
**Status:** Done (needs Vercel env var to activate)
**Priority:** P0

### Business objective
Every new user who signs up via Google or email+password receives a welcome email immediately — before they select a plan.

### What's built
- Clerk webhook at `app/api/webhooks/clerk/route.ts`
- Fires on `user.created` event
- Calls `sendSignupWelcomeEmail(email, firstName)` via Resend
- Email: "Welcome to Clio — you're in", dark themed, CTA to `/plan`

### Remaining action (Arun)
1. Clerk Dashboard → Webhooks → Add Endpoint
2. URL: `https://distill-peach.vercel.app/api/webhooks/clerk`
3. Event: `user.created`
4. Copy signing secret → `! echo "whsec_xxx" | npx vercel env add CLERK_WEBHOOK_SECRET production`
5. Redeploy

### Acceptance criteria
- [ ] Sign up via Google → welcome email arrives within 30 seconds
- [ ] Sign up via email+password → welcome email arrives within 30 seconds
- [ ] Email shows first name if available
- [ ] CTA link goes to `/plan`

---

## S2 — Plan URL Reflects Actual User Selection
**Status:** Done (verify in testing)
**Priority:** P1

### Business objective
The URL should only show `?plan=starter` (or pro/executive) after the user explicitly selects a plan on the `/plan` page. No plan is ever pre-set in the URL without user action.

### What's built
- Landing page / nav CTAs → `/onboarding` (no `?plan=` in URL)
- `/plan` page: on "Continue" → `router.push('/checkout?plan=<selected>')`
- `/checkout` reads `?plan` from URL first, localStorage fallback

### Acceptance criteria
- [ ] Clicking "Get Started" on landing page → URL shows `/onboarding` (no plan param)
- [ ] Completing Q5 → goes to `/sign-up` (no plan param)
- [ ] Selecting Starter on /plan → URL becomes `/checkout?plan=starter`
- [ ] Selecting Pro on /plan → URL becomes `/checkout?plan=pro`
- [ ] Selecting Executive on /plan → URL becomes `/checkout?plan=executive`
- [ ] Refreshing `/checkout?plan=pro` shows Pro plan pre-selected

---

## S3 — Dashboard Gate Redirects to /plan (not /pricing)
**Status:** Todo
**Priority:** P1

### Business objective
`/pricing` is a marketing page, not part of the onboarding flow. Authenticated users without an active subscription who try to access `/dashboard` should be sent to `/plan` to complete their setup — not to a marketing page.

### What to change
`app/dashboard/layout.tsx` — change `redirect('/pricing')` to `redirect('/plan')`

### Acceptance criteria
- [ ] Signed-in user with no subscription visits `/dashboard` → redirected to `/plan`
- [ ] Signed-in user with `subscription_status = null` visits `/dashboard` → redirected to `/plan`
- [ ] Unauthenticated user visits `/dashboard` → Clerk sends to `/sign-in` (unchanged)
- [ ] Active subscriber visits `/dashboard` → passes through normally
- [ ] `/dashboard/welcome` still exempt from gating (no redirect)

---

## S4 — Remove Free Tier (3 Plans Only: Starter, Pro, Executive)
**Status:** Todo
**Priority:** P1

### Business objective
Simplify the plan structure to 3 paid tiers only. The free tier concept is replaced by the opt-in 3-day trial (S5). Removing free reduces complexity, dead code paths, and confusion in the UI.

### What to change
- `app/plan/page.tsx` — remove Free card
- `app/checkout/page.tsx` — remove free plan handling (`isFreeActivating`, `activateFreePlan`)
- `app/api/checkout/route.ts` — remove `plan === 'free'` branch
- `app/(marketing)/pricing/page.tsx` — remove Free tier card
- `app/(marketing)/page.tsx` — remove Free tier from pricing section
- All `PLAN_DATA` constants — remove `free` key
- Zod schemas — remove `'free'` from plan enum

### Acceptance criteria
- [ ] `/plan` shows exactly 3 cards: Starter, Pro, Executive
- [ ] No "Free" option anywhere in the flow
- [ ] `/api/checkout` with `plan='free'` returns 400
- [ ] `npm run build` passes with no TypeScript errors
- [ ] Pricing section on landing page shows 3 plans only

---

## S5 — Opt-in 3-Day Trial with 5-Minute Usage Limit
**Status:** Todo
**Priority:** P0

### Business objective
Replace the automatic 3-day trial with an explicit opt-in checkbox on the checkout page. Trial users get 5 minutes of AI coaching to experience the product. They can upgrade to a full plan anytime within 3 days. If they don't, their account suspends automatically.

### Detailed flow
1. `/checkout` shows a checkbox: **"Start with a 3-day free trial — 5 minutes included, no charge today"**
2. **Trial checked (default):**
   - Card is saved (SetupIntent) but $0 charged today
   - `subscription_status = 'trialing'`, `minutes_balance = 5`, `trial_ends_at = now + 3 days`
   - Access to dashboard is granted
   - User can upgrade (pay) anytime during the 3 days → full plan minutes added
   - Inngest job checks daily: if `trial_ends_at < now AND subscription_status = 'trialing'` → suspend account
3. **Trial unchecked:**
   - Normal payment flow — full charge today
   - Full plan minutes allocated immediately

### Supabase fields needed
- `trial_ends_at` (timestamptz, nullable)
- `trial_used` (boolean, default false)

### What to build
- [ ] Checkbox UI on `/checkout` page
- [ ] `POST /api/checkout` — if trial: create SetupIntent + set `trial_ends_at`, if no trial: charge immediately
- [ ] `POST /api/checkout/confirm` — handle trial vs immediate payment paths
- [ ] Inngest job: `inngest/trial-expiry.ts` — daily cron, suspends expired trial accounts
- [ ] Supabase migration: add `trial_ends_at`, `trial_used` columns
- [ ] Dashboard banner: "X days left in your trial — upgrade now" (if trialing)
- [ ] Email: send trial-ending-soon email 24h before expiry

### Acceptance criteria
- [ ] Checkbox visible on checkout, checked by default
- [ ] Trial path: card saved, $0 charged, 5 mins allocated, dashboard accessible
- [ ] Upgrade during trial: card charged, full minutes added, `trial_used = true`
- [ ] Trial expires: account status = `'suspended'`, dashboard redirects to `/plan`
- [ ] No-trial path: card charged immediately, full minutes allocated
- [ ] Trial can only be used once per account (`trial_used` flag)

---

## S6 — Real-Time AI Session Timer and Graceful Wrap-Up
**Status:** Todo
**Priority:** P0

### Business objective
Users must not exceed their allocated minutes. The AI coaching session must track time in real-time, warn the user when nearing the limit, and gracefully wrap up (stop taking new questions, summarise, end the call) when the limit is reached.

### Detailed behaviour
- **T-2 minutes remaining:** AI says "We have about 2 minutes left — let's make sure we cover what matters most."
- **T-0 (limit reached):**
  - AI stops accepting new questions
  - AI delivers a closing summary: key points, action items
  - AI says "That's your session time. I've captured your action items in your dashboard."
  - Recall.ai bot leaves the Google Meet
- **After session:**
  - `minutes_balance` decremented by actual session duration (rounded up to nearest minute)
  - Session summary saved to dashboard

### What to build
- [ ] Session timer: track `session_start_time` in Supabase when bot joins Meet
- [ ] Real-time check: every 30s poll or WebSocket — compare `(now - session_start_time)` vs `minutes_balance`
- [ ] At T-2min: inject warning message into ElevenLabs agent system prompt context
- [ ] At T-0: trigger `recall.ai` bot to send wrap-up message then leave
- [ ] `POST /api/sessions/[id]/end` — decrements `minutes_balance`, saves duration
- [ ] Inngest event: `clio/session.time_limit_reached` — triggers wrap-up sequence

### Acceptance criteria
- [ ] Session timer starts when Recall.ai bot joins
- [ ] At 2 min remaining: AI delivers time warning naturally in conversation
- [ ] At limit: AI wraps up, stops new Q&A, bot leaves Meet
- [ ] `minutes_balance` correctly decremented after session
- [ ] User with 0 minutes cannot start a new session (dashboard shows upgrade prompt)
- [ ] Session duration logged in `sessions` table

---

## S7 — QA Test Scenarios + Playwright Automation
**Status:** Blocked (start after S1–S6 complete)
**Priority:** P1

### Business objective
A repeatable, automated test suite that validates the full onboarding and payment flow on every code change — preventing regressions before they reach users.

### Scope
**Happy path:**
- New user → onboarding → sign-up → plan select → checkout → dashboard

**Navigation & persistence:**
- Back/forward through onboarding questions — answers persist
- Refresh on /checkout — plan and billing period pre-selected from URL
- Switch plans on /checkout — PaymentElement reloads correctly

**Billing & payment:**
- Successful payment with Stripe test card (4242...)
- Card declined (4000 0000 0000 0002) — error shown, not redirected
- Trial checkbox checked → $0 charge, dashboard accessible
- Trial checkbox unchecked → immediate charge, full minutes

**Cancel & re-login:**
- Close tab mid-checkout → log back in → land on /plan
- Complete checkout → log out → log back in → land on /dashboard

**Bypass attempts:**
- Direct URL to /dashboard without auth → /sign-in
- Direct URL to /dashboard while signed in but unpaid → /plan
- Direct URL to /dashboard after trial expires → /plan or suspended screen
- Manipulate localStorage `clio_selected_plan` to inject invalid plan → graceful 400
- POST to /api/checkout without auth header → 401
- POST to /api/checkout/confirm with foreign paymentMethodId → error

### Deliverables
- `tests/e2e/onboarding-flow.spec.ts` — happy path
- `tests/e2e/navigation-persistence.spec.ts` — back/forward, refresh
- `tests/e2e/payment.spec.ts` — billing scenarios
- `tests/e2e/security.spec.ts` — bypass attempts
- `tests/e2e/cancel-relogin.spec.ts` — cancel + return scenarios
- CI config (GitHub Actions) to run on every push

---

## Story Status Summary

| ID | Title | Status | Priority | Blocked by |
|----|-------|--------|----------|------------|
| S1 | Welcome email on signup | Done (env var pending) | P0 | — |
| S2 | Plan URL reflects selection | Done (verify) | P1 | — |
| S3 | Dashboard gate → /plan | **Todo** | P1 | — |
| S4 | Remove free tier | **Todo** | P1 | — |
| S5 | Opt-in 3-day trial + 5-min limit | **Todo** | P0 | S4 |
| S6 | Real-time AI session timer | **Todo** | P0 | S5 |
| S7 | QA test scenarios + Playwright | **Blocked** | P1 | S1–S6 |
