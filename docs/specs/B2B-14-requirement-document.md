# B2B-14 — Remove Confirmed-Dead B2C Dashboard Surface
# Requirement Document
Version: 1.1
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-16

**Revision note (v1.1):** Addresses the two mechanical gaps the CEO flagged in v1.0 review — (1)
`DashboardShell.tsx`'s `NAV_ITEMS` diff now removes both the `/dashboard/messages` and
`/dashboard/billing` entries (not just Messages), with the resulting mobile-nav reshuffle documented in
Section 9; (2) `app/api/messages/[id]/feedback/route.ts` and `app/api/portal/route.ts` added to Files
Changed → Delete as two more zero-caller orphaned routes, with the resulting `createPortalSession`
dead-code note added to Adjacent Items. No other section changed — the CEO's approval of the
confirmed-safe subset, sign-in redirect fix, middleware diff, `app/dashboard/page.tsx` redirect stub, and
Section 11 escalation stands as-is from v1.0.

**Source Feature Brief:** `.claude/agents/clio/feature-briefs/B2B-14-remove-dead-b2c-dashboard-surface.md`
(read in full). Arun's underlying instruction ("plan, session etc are not needed anymore. modify the
dashboard") is treated as already-decided per that brief — this document does not revisit *whether* to
delete the B2C dashboard surface, only *exactly what* is safe to delete right now.

## Critical Finding — Read Before Files Changed

Per the brief's Question 1 ("run a fresh, independent grep pass yourself — do not trust this brief's list
as exhaustive"), I re-traced every file in the "Confirmed Dead, Safe to Delete" list against the live and
excluded-cluster code myself, rather than accepting the brief's dependency trace. **Most of the list is
confirmed clean.** But three items — `app/plan/`, `app/checkout/page.tsx`, and
`app/(marketing)/pricing/page.tsx` — have live and excluded-cluster runtime dependents the brief's trace
did not surface. Per the brief's Question 5 ("if BA independently reaches a different read on any file in
the Confirmed Dead list, stop and flag it explicitly rather than including it speculatively"), **these
three are pulled out of this version's deletion scope** and moved to Section 11 as a single open question.
Everything else in the brief's list is confirmed safe and specified below as buildable now.

I recommend CEO treat this as two units of work: **B2B-14 (this document, ready to approve and build
now)** covering the confirmed-safe subset, and a **follow-up brief** for the `/plan` + `/checkout` +
`/pricing` cluster once Arun answers the Section 11 question. This mirrors the pattern the original brief
already used for the excluded "session" cluster — a second area needing Arun's direct answer before any
deletion happens there, discovered during investigation rather than anticipated up front.

## 1. Purpose

`app/dashboard/page.tsx` is the retired B2C consumer dashboard (AI Readiness Score, streak, message feed,
plan-tier billing). It is still the default post-sign-in landing page today. A partner-admin signing in to
manage their organization's Clio deployment currently lands on a dead consumer gamification product
instead of the Configurator — the actual product. This is confirmed live and confusing per Arun's own
direct QA finding on hello-clio.com (`docs/b2b-pivot-status.md`, Live QA Findings item 4, 2026-07-16).

Without this fix: every new partner-admin's first experience of the product is a broken, off-brand,
consumer-era screen, undermining confidence in the platform before they ever reach the Configurator.

## 2. User Story

As a partner-admin signing in to Clio,
I want to land directly on the Configurator,
So that I'm not confused by a dead consumer product that has nothing to do with why I'm here.

As Arun (product owner),
I want the codebase to no longer contain a fully-built, still-reachable B2C dashboard,
So that the live surface area of the product matches the B2B pivot, and no engineer or investor
live-testing hello-clio.com hits dead product.

## 3. Trigger / Entry Point

This is a subtraction/redirect change, not a new feature — there is no new screen a user opens
deliberately. The change activates in these ways:

- **Sign-in.** Any user completing Clerk sign-in via `app/(auth)/sign-in/[[...sign-in]]/page.tsx` is
  redirected by `fallbackRedirectUrl`. Today: `/dashboard`. After this change: `/dashboard/configurator`.
- **Direct navigation to `/dashboard`.** Anyone with `/dashboard` bookmarked, or who types it, or who is
  redirected there by other still-live code, hits `app/dashboard/page.tsx`, which becomes a server-side
  redirect to `/dashboard/configurator`.
- **Direct navigation to any of the other deleted routes** (`/dashboard/upgrade`, `/dashboard/welcome`,
  `/dashboard/messages`, `/dashboard/billing`, `/pricing` — the last one held, see Critical Finding).
  These have no confirmed live inbound links (verified below) and are deep, flow-internal pages a user
  would not type directly. They are hard-deleted with no redirect stub (see Section 8 for why).
- **Auth state:** none of this requires the user to be in any particular state — the sign-in redirect and
  the `/dashboard` redirect stub both fire unconditionally for anyone who reaches them.

## 4. Screen / Flow Description

This brief adds no new screens and no new copy (per the brief's own "subtraction, not addition"
constraint). The only user-visible behavior changes are:

**State A — Sign-in redirect (changed):**
- Before: user completes Clerk `<SignIn>` → lands on `/dashboard` → sees the B2C gamification dashboard
  (AI Readiness Score ring, streak counter, message feed, upgrade banner).
- After: user completes Clerk `<SignIn>` → lands on `/dashboard/configurator` directly. No intermediate
  screen. This is a Clerk redirect prop change, not a new page.

**State B — Legacy `/dashboard` visit (changed):**
- Before: renders the full B2C dashboard.
- After: `app/dashboard/page.tsx` performs a server-side `redirect('/dashboard/configurator')` before
  rendering anything. The user briefly sees nothing (standard Next.js server redirect) and lands on the
  Configurator. No "Sorry, this page moved" interstitial — the CEO brief is explicit this should be a
  silent redirect, not a dead end, given real inbound traffic and possibly-bookmarked links.

**State C — Legacy `/dashboard/upgrade`, `/dashboard/welcome`, `/dashboard/messages`,
`/dashboard/billing` visits (changed):**
- Before: renders the respective B2C page.
- After: standard Next.js "This page could not be found" 404. No redirect stub for these four. See
  Section 8 for the reasoning (in short: these are deep flow-internal pages with zero confirmed live
  inbound links, unlike `/dashboard` itself which is the plausible bookmarked/typed landing URL the CEO
  brief specifically called out).

**State D — Admin sidebar (changed):**
- Before: the 4 live admin pages (`app/dashboard/admin/clients`, `/glitches`, `/templates`,
  `/templates/[templateName]/progress`), all wrapped in `components/dashboard/DashboardShell.tsx`, show a
  "Messages" nav item linking to `/dashboard/messages`.
- After: that nav item is removed. The other DashboardShell nav items and the shell itself are unchanged
  — DashboardShell continues to render exactly as it does today for these 4 pages, minus the one dead
  link.

No wireframes are included per Section 5 below — there is no new visual content to specify; every visible
change is either "this page no longer exists" or "this redirect target changed."

## 5. Visual Examples

Not applicable in the traditional sense — no new screen states exist. For completeness, the one visible
diff a real user could notice:

```
┌─────────────────────────────────────────┐
│  DashboardShell sidebar (admin pages)   │
│                                         │
│  Dashboard                              │
│  Clients                                │
│  Templates                              │
│  Glitches                               │
│  [Messages]  ← REMOVED, was here        │
│  Settings                               │
└─────────────────────────────────────────┘
```

## 6. Data Requirements

**No database schema changes.** No migration. This is a code/file deletion, not a data change.

- `delivery_log` table: still written by `inngest/daily-delivery.ts`, `inngest/weekly-digest.ts`,
  `inngest/feedback-processor.ts` (all still registered live in `app/api/inngest/route.ts`). This brief
  removes its only remaining UI reader (`app/dashboard/messages/`) but does not touch the table or the
  crons that write to it — see Section 8, Adjacent Items.
- `users.plan_tier` / `users.subscription_status` / `users.stripe_customer_id`: **not dead columns.**
  Confirmed still actively written by `app/api/subscription/cancel/route.ts` (called from
  `app/dashboard/settings/SettingsClient.tsx` — live, excluded cluster) and by `app/api/checkout/confirm/
  route.ts` and `app/api/checkout/activate/route.ts`. The Stripe webhook (`app/api/webhooks/stripe/
  route.ts`) itself no longer writes them (confirmed by its own code comment: "B2C-era subscription/
  topup/trial branches... were removed 2026-07-13") — but other, non-webhook routes still do. This brief
  deletes `app/dashboard/billing/page.tsx`, the one VIEW of these columns with zero remaining importers —
  it does not touch the columns themselves or the routes that still write them. See Section 11 for why
  `app/api/checkout/confirm/route.ts` specifically is not touched here.
- No new API routes. One existing API route is deleted as a mechanical consequence (see Files Changed):
  `app/api/messages/route.ts`, which becomes a zero-caller GET endpoint once `app/dashboard/messages/` is
  removed.

## 7. Success Criteria (Acceptance Tests)

✓ Given a user completes Clerk sign-in, when the redirect fires, then they land on
  `/dashboard/configurator`, not `/dashboard`.

✓ Given a user navigates directly to `/dashboard` (fresh session, no query params), when the page loads,
  then they are server-side redirected to `/dashboard/configurator` with no B2C dashboard content ever
  rendered or flashed.

✓ Given a user navigates directly to `/dashboard/upgrade`, `/dashboard/welcome`, `/dashboard/messages`, or
  `/dashboard/billing`, when the page loads, then they receive a standard Next.js 404, and the app does
  not crash or 500.

✓ Given a partner-admin on `/dashboard/admin/clients`, `/dashboard/admin/glitches`,
  `/dashboard/admin/templates`, or `/dashboard/admin/templates/[templateName]/progress`, when the page
  renders, then `DashboardShell` renders identically to today except the "Messages" and "Billing" nav
  items are both gone (both point at pages deleted in this brief), and no console error or broken layout
  results.

✓ Given the full deletion list is removed, when `npm run build` and `npx tsc --noEmit` run, then both
  complete with zero errors (no dangling imports of any deleted file).

✓ Given `middleware.ts`'s `isPublicRoute` list after this change, when an unauthenticated request hits
  `/dashboard/welcome`, then it 404s cleanly rather than looping through a stale public-route matcher for
  a route that no longer exists.

✓ Given the excluded cluster (`app/dashboard/sessions/`, `knowledge-base/`, `walkthrough/`,
  `dashboard/plan/`, `dashboard/phone/`, `dashboard/settings/`, `dashboard/schedule-setup/`,
  `app/onboarding/`, `app/topics/`) and the confirmed-live B2B surfaces (`dashboard/configurator/*`,
  `dashboard/admin/*`, `partner-render/*`, `partner-questionnaire/*`, `partner-signup/*`), when this
  brief's changes ship, then none of them have a new broken import, dead link, or behavior change — all
  pre-existing behavior in these areas is untouched.

✓ Given `app/api/checkout/activate/route.ts` (called only by the now-deleted `DashboardClient.tsx`) and
  `app/api/messages/route.ts` (called only by the now-deleted `messages/` dir), when this brief ships,
  then both are also deleted (zero remaining callers) rather than left as silently-orphaned dead code.

## 8. Error States

- **Deleted-route visits (`/dashboard/upgrade`, `/dashboard/welcome`, `/dashboard/messages`,
  `/dashboard/billing`):** standard Next.js not-found page. No custom error UI is built — that would be
  "addition," which the brief explicitly rules out, and none of these four have a confirmed live inbound
  link (verified: no `Link`/`router.push`/`redirect` anywhere in live or excluded-cluster code points at
  any of them, apart from each other, which are also being deleted together). Only `app/dashboard/page.tsx`
  gets the CEO-mandated redirect-stub treatment, because it is the one plausible bookmarked/typed landing
  URL — the other four are click-through-only pages within the now-deleted flow, so a stub for them would
  be unreachable except by someone manually typing a deep internal URL, which the CEO brief's "real
  inbound traffic and possibly-bookmarked links" concern does not extend to.
- **`/dashboard` redirect failing to fire (e.g. a future regression removes the redirect):** out of scope
  to defend against here beyond the acceptance test above; this is a one-line file, low regression risk.
- **Build/type errors from a missed dangling import:** caught by the `npm run build` / `npx tsc --noEmit`
  acceptance test above before merge — not a runtime error state for end users.

## 9. Edge Cases

- **User with `/dashboard/billing` or `/dashboard/upgrade` bookmarked from before the pivot:** gets a 404
  instead of the page they remember. Accepted per Section 8 — no live inbound link exists today, so this
  is a cold, unlikely path, and building a redirect stub for it would be scope creep the brief rules out.
- **Admin user on one of the 4 DashboardShell-wrapped live pages who previously used the "Messages" or
  "Billing" nav link as a workflow habit:** both links disappear; no replacement is offered (there is
  nothing to redirect either to — the underlying data/UI is deleted, not moved). This is a deliberate
  product regression Arun accepted by instructing deletion, not an oversight.
- **Mobile bottom nav reshuffle:** `MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5)` shows whatever the first 5
  `NAV_ITEMS` entries are. Today's first 5 (before this brief) are Dashboard, My Plan, Sessions, Knowledge
  Base, Messages — Billing (position 6) is not visible on mobile today. Removing both Messages and Billing
  from `NAV_ITEMS` shifts the array so the new first 5 are: Dashboard, My Plan, Sessions, Knowledge Base,
  **Phone Setup**. Phone Setup was not in the mobile bar before; after this change it is, replacing the
  slot Messages held. Confirmed this is a live, intentional link — `/dashboard/phone` is part of the
  excluded "session" cluster (Section 10), explicitly kept and live, not a dead or placeholder route — so
  this reshuffle surfaces a real, working page rather than a broken one. No further action needed; noted
  here so the mobile nav's post-change composition isn't a silent surprise for the developer or QA.
- **`app/dashboard/layout.tsx`'s `/dashboard/welcome` pathname-exemption check:** this file is not touched
  by this brief (it's in the live surface, wraps all of `/dashboard/*`). After `/dashboard/welcome` is
  deleted, this check (`if (pathname.startsWith('/dashboard/welcome')) return children`) becomes dead code
  — it can never match a real request again, since nothing ever navigates there anymore. It is harmless
  (a conditional that never fires) and is called out here rather than silently left as an unexplained
  no-op for a future reader. Not touched in this brief; safe to leave as-is or clean up in a later pass.
- **Concurrent in-flight requests to deleted API routes** (`app/api/messages/route.ts`,
  `app/api/checkout/activate/route.ts`) at deploy time: both are GET/POST endpoints with no other live
  callers; a request in flight at the moment of deploy would 404, same as any route deletion. No special
  handling needed.
- **Mobile vs. desktop:** no layout differences to account for — nothing new is rendered.

## 10. Out of Scope

- **The excluded "session" cluster**, per the brief: `app/dashboard/sessions/`,
  `app/dashboard/sessions/[id]/`, `app/dashboard/knowledge-base/`, `app/dashboard/knowledge-base/
  [topicId]/`, `app/dashboard/walkthrough/`, `app/dashboard/plan/` (the review-your-curriculum page, a
  distinctly-named file from `app/plan/`), `app/dashboard/phone/`, `app/dashboard/settings/`,
  `app/dashboard/schedule-setup/`, `app/onboarding/`, `app/topics/`. Reasoning (from the brief, not
  re-litigated here): this cluster pulls in the Hume adapter, curriculum generation, and inngest
  machinery that live B2B partner sessions (`partner_sessions` table) may share; several of these files
  are under active, currently-uncommitted development; `app/onboarding/` was last committed 2026-07-03
  with active AUTH-02/ONBOARD-DATA-01 work. This is a deliberate, escalated exclusion requiring Arun's
  direct one-line confirmation before any deletion — not an oversight, and not this BA's or this brief's
  call to make.
- **`app/(marketing)/page.tsx`** (the hello-clio.com homepage) — explicitly not in scope per the brief;
  Arun is actively testing it as the live marketing homepage. Its broken "Get Started" CTA is tracked
  separately under B2B-12.
- **`app/plan/`, `app/checkout/page.tsx`, `app/(marketing)/pricing/page.tsx`, and their `middleware.ts`
  entries** — held pending Arun's answer to the Section 11 question below. Not deleted in this version.
- **`components/plan/RecommendationCard.tsx`, `components/dashboard/ScheduleCard.tsx`** — explicitly not
  touched; both are imported by the excluded-cluster `app/dashboard/plan/PlanClient.tsx`.
- **Deregistering `inngest/daily-delivery.ts`, `weekly-digest.ts`, `feedback-processor.ts`, or
  `trial-expiry.ts`** — flagged as adjacent items (Section 8/edge cases and the Adjacent Items note below)
  for a one-line developer check, but deregistering background jobs is explicitly not this brief's
  decision to make (per the original brief for the first three; the BA extends the same reasoning to the
  fourth, discovered during this investigation).
- **`app/api/feedback/route.ts`** — appears to be dead, Twilio-dependent B2C code itself (Twilio is a
  removed/unapproved package per this project's `CLAUDE.md`), and it redirects to the now-deleted
  `/dashboard/messages`. Not touched here; flagged for a separate check, same pattern as the crons.
- **No new copy, no new screens, no new redirect-stub UI** beyond the single `app/dashboard/page.tsx`
  replacement the CEO brief explicitly mandated.

## 11. Open Questions

**Q1: What should happen to `/plan`, `/checkout`, and `/pricing` given they have live and
excluded-cluster runtime dependents the original brief's dependency trace did not find? — NEEDS ANSWER
FROM: Arun (via CEO)**

The brief lists `app/plan/`, `app/checkout/page.tsx`, and `app/(marketing)/pricing/page.tsx` as
"Confirmed Dead, Safe to Delete." My independent grep pass (Question 1) found four live/excluded-cluster
call sites that depend on these exact URLs still resolving to something real:

1. **`app/api/onboarding/account-state/route.ts`** (feeds `app/onboarding/page.tsx`, which is in the
   *excluded* cluster, explicitly kept per the brief) — for a `signed_up_unpaid` user, its `resumeUrl`
   logic returns `/plan` or `/checkout` as the next step, and `app/onboarding/page.tsx:588-589` does
   `router.replace(data.resumeUrl)`. Deleting `/plan`/`/checkout` without updating this would send a real,
   currently-active signup flow's users to a 404 mid-flow.
2. **`app/dashboard/layout.tsx`** (live, wraps *all* of `/dashboard/*` — including the confirmed-live
   Configurator and admin pages) — line 29: `if (!hasAccess) redirect('/plan')`, where `hasAccess` checks
   `users.subscription_status IN ('active', 'trialing')`. This is the access gate for the Configurator
   itself. If `/plan` is deleted, any dashboard visitor this check currently sends to `/plan` gets a 404
   instead — and this gate sits directly in front of the pages this whole brief exists to make reachable.
3. **`app/topics/page.tsx:621`** (excluded cluster, explicitly kept) — `router.push('/plan')`.
4. **`app/dashboard/plan/PlanClient.tsx:564`** (excluded cluster, explicitly protected — the brief says
   not to touch its imports) — `router.push('/pricing')`.

Additionally, `inngest/trial-expiry.ts` — a fourth live, currently-registered daily cron (9AM UTC,
`app/api/inngest/route.ts` line 48) not named in the original brief's three-cron "Adjacent Item" — sends
real "Activate your plan" / "Reactivate my plan" emails (`lib/delivery/email.ts`) linking to
`${appUrl}/checkout` to users whose `subscription_status = 'trialing'`.

I cannot resolve this myself: repointing these four call sites and the cron's email copy requires knowing
where they *should* go instead, and that depends on where B2B-13's new billing UI (still in progress,
per the brief's own "Known Constraints") will live. Guessing wrong breaks either a currently-active signup
flow or the Configurator's own access gate — not a cosmetic regression. Per the brief's Question 5
instruction, I'm flagging this rather than including the three files as safe deletions or silently
patching their dependents' redirect targets myself.

**Recommended framing for Arun:** "Now that `/plan` and `/checkout` are marked dead, four live code paths
still route users there by name — the onboarding resume flow, the topics page, the dashboard access gate
itself, and a daily trial-reminder email. Where should each of those send users instead, now vs. once
B2B-13's new billing UI ships?" This does not need to block this document (B2B-14) — it should become its
own follow-up brief once answered, per the recommendation in the Critical Finding section above.

No other open questions. All five of the brief's assigned BA questions are otherwise resolved in this
document: Q1 (fresh grep — done, findings above and in Files Changed); Q2 (exact middleware/redirect diffs
— Section 12 / Files Changed); Q3 (sign-up redirect staying as `/onboarding` — resolved below); Q4
(billing data-path orphan check — resolved in Section 6); Q5 (excluded cluster not resolved here, per
instruction — confirmed untouched throughout).

**Q3 resolution (not open, documented per the brief's instruction):** `signUpForceRedirectUrl="/onboarding"`
(sign-up page) and the `/onboarding` fallback inside `signUpForceRedirectUrl`/`forceRedirectUrl` stay
exactly as they are. `/onboarding` is explicitly part of the excluded, still-live cluster (Section 10) —
it is not being deleted or redirected elsewhere by this brief, so there is nothing to change here. This is
confirmed intentional, not an oversight a future reader should "fix."

## 12. Dependencies

- No new packages, no new environment variables, no new database migrations.
- Depends on nothing outside this repo's current state — all files referenced below were read directly
  from the working tree on 2026-07-16 to write this document.
- The Section 11 follow-up brief (once written) will depend on B2B-13's new billing UI routes existing, or
  on Arun deciding an interim destination.
- This document's confirmed-safe subset has no dependency on B2B-13 or on the Section 11 answer — it can
  be built and shipped independently and immediately.

---

## Files Changed (verified by independent grep pass, not copied from the brief)

### Delete
- `app/dashboard/DashboardClient.tsx` — sole importer was `app/dashboard/page.tsx` (being replaced, see
  below). Confirmed zero other importers repo-wide.
- `app/dashboard/upgrade/page.tsx` — confirmed zero inbound links from any live or excluded-cluster file
  except `DashboardClient.tsx` and `app/dashboard/billing/page.tsx` (both also deleted in this brief).
- `app/dashboard/welcome/page.tsx` — confirmed zero inbound links except `app/checkout/page.tsx`'s
  `router.push` (not touched here, but that page is held per Section 11 either way, and this is currently
  dead-lettered regardless) and `app/dashboard/layout.tsx`'s pathname exemption (see Section 9 edge case
  — becomes harmless dead code, not touched).
- `app/dashboard/billing/` (dir: `page.tsx`, `ManageBillingButton.tsx`, `TopUpButton.tsx`) — confirmed
  zero live importers of the page. Confirmed via `app/api/webhooks/stripe/route.ts`'s own code comment
  ("B2C-era subscription/topup/trial branches... were removed 2026-07-13") that no webhook branch writes
  the `users.plan_tier`/`subscription_status`/`stripe_customer_id` columns this page reads — resolving
  the brief's Question 4. `TopUpButton.tsx` wraps the shared, live `components/ui/TopUpModal.tsx`, which
  is NOT deleted (it has other live callers) — only this thin dashboard/billing-local wrapper goes.
- `app/dashboard/messages/` (dir: `page.tsx`, `MessagesClient.tsx`) — confirmed zero live importers beyond
  `DashboardClient.tsx` (also deleted) and `app/api/feedback/route.ts`'s redirect target (that route is
  itself flagged as likely-dead, see Section 10 — not touched, its redirect just becomes a dead link on an
  already-likely-broken Twilio-era route).
- `app/api/messages/route.ts` — **BA-added, not in the original brief's list.** Confirmed its only two
  importers repo-wide are `app/dashboard/messages/MessagesClient.tsx` and `app/dashboard/messages/page.tsx`
  — both deleted above. Zero remaining callers once those are gone; leaving it in place would be silently
  orphaned dead code of exactly the kind this brief exists to remove.
- `components/dashboard/ScoreRing.tsx` — sole importer `DashboardClient.tsx` (deleted).
- `components/dashboard/StreakCounter.tsx` — sole importer `DashboardClient.tsx` (deleted).
- `components/dashboard/DeliveryToggle.tsx` — sole importer `DashboardClient.tsx` (deleted).
- `components/dashboard/MessageCard.tsx` — importers `DashboardClient.tsx` and `MessagesClient.tsx`, both
  deleted.
- `app/api/checkout/activate/route.ts` — **BA-added.** Confirmed sole caller is `DashboardClient.tsx`
  (deleted). Zero remaining callers.
- `app/api/messages/[id]/feedback/route.ts` — **BA-added (CEO-flagged), not in the original brief's
  list.** Confirmed its only two callers repo-wide are `app/dashboard/DashboardClient.tsx:128` and
  `app/dashboard/messages/MessagesClient.tsx:38` — both already deleted above. Zero remaining callers once
  those are gone.
- `app/api/portal/route.ts` — **BA-added (CEO-flagged), not in the original brief's list.** Confirmed its
  sole caller is `app/dashboard/billing/ManageBillingButton.tsx`, itself inside `app/dashboard/billing/`
  (already deleted above). Zero remaining callers. See Adjacent Items below for the resulting
  `createPortalSession` dead-code note.

### Replace
- `app/dashboard/page.tsx` → single-purpose redirect:
  ```tsx
  import { redirect } from 'next/navigation'

  export default function DashboardPage() {
    redirect('/dashboard/configurator')
  }
  ```
  (Per the CEO's explicit decision: a redirect stub, not a 404 or outright removal — this is the one
  plausibly-bookmarked/typed URL in this whole deletion set.)

### Modify

**`middleware.ts`** — remove exactly one entry from `isPublicRoute` (verbatim diff):
```diff
 const isPublicRoute = createRouteMatcher([
   '/',
   '/pricing(.*)',
   '/onboarding(.*)',
   '/sign-in(.*)',
   '/sign-up(.*)',
   '/partner-signup(.*)',
   '/plan(.*)',
   '/checkout(.*)',
   '/topics(.*)',
   '/questionnaire',
-  '/dashboard/welcome(.*)',
   '/api/webhooks/(.*)',
   ...
 ])
```
`/pricing(.*)`, `/plan(.*)`, and `/checkout(.*)` are **NOT** removed in this version — those routes' page
files are held (Section 11), and removing their public-route entries while the pages still exist would
newly gate them behind Clerk auth, a functional regression for whatever currently reaches them
unauthenticated (e.g. `/onboarding`'s resume flow). These three must move as one atomic unit with their
page deletions in the follow-up brief, not split across two changes.

**`app/(auth)/sign-in/[[...sign-in]]/page.tsx`** — verbatim diff:
```diff
       <SignIn
-        fallbackRedirectUrl="/dashboard"
+        fallbackRedirectUrl="/dashboard/configurator"
         signUpForceRedirectUrl="/onboarding"
```
`signUpForceRedirectUrl` is unchanged — see Q3 resolution in Section 11.

**`app/(auth)/sign-up/[[...sign-up]]/page.tsx`** — no change. `forceRedirectUrl="/onboarding"` stays
as-is (Q3 resolution, Section 11).

**`components/dashboard/DashboardShell.tsx`** — **BA-added, not in the original brief's file list.**
Confirmed this file (which the brief requires to "survive" for 4 live admin pages) hardcodes nav items
pointing at both `/dashboard/messages` and `/dashboard/billing`, both deleted in this brief. Verbatim diff
against the live file (`NAV_ITEMS`, lines 19-28):
```diff
 const NAV_ITEMS = [
   { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
   { href: '/dashboard/plan', icon: BookOpen, label: 'My Plan' },
   { href: '/dashboard/sessions', icon: CalendarDays, label: 'Sessions' },
   { href: '/dashboard/knowledge-base', icon: Library, label: 'Knowledge Base' },
-  { href: '/dashboard/messages', icon: MessageSquare, label: 'Messages' },
-  { href: '/dashboard/billing', icon: CreditCard, label: 'Billing' },
   { href: '/dashboard/phone', icon: Phone, label: 'Phone Setup' },
   { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
 ]
```
Remove both array entries — leaving Billing in place while its page is deleted would create a second dead
nav link identical in kind to the Messages one, and `MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5)` (line 31)
would newly pull Billing into the mobile bottom bar's visible top-5 for the first time (it isn't there
today) once Messages is removed alone. See Section 9 for the resulting mobile-nav composition (Phone
Setup becomes the new 5th mobile item — confirmed a live, intentional link).

Once both entries are removed, `CreditCard` (the Billing icon import, line 4) becomes an unused import and
must be dropped from the `lucide-react` import line; `MessageSquare` was already being dropped per the
original diff. No other part of `DashboardShell.tsx` changes — it continues to render for the 4 live admin
pages exactly as today, minus these two dead links. (Exact line numbers confirmed against the live file
as of this document's writing; developer should re-verify against the working tree at build time in case
of drift.)

### Explicitly NOT Modified (confirmed via grep, listed for developer clarity)
- `components/dashboard/DashboardShell.tsx` survives — only the one nav entry above changes.
- `components/plan/RecommendationCard.tsx`, `components/dashboard/ScheduleCard.tsx` — not touched.
- `app/dashboard/configurator/*`, `app/dashboard/admin/*`, `app/partner-render/*`,
  `app/partner-questionnaire/*`, `app/partner-signup/*` — not touched.
- `app/(marketing)/page.tsx` — not touched (its `components/marketing/MarketingNav.tsx` "Pricing" nav link
  is only at risk if/when `/pricing` is deleted in the Section 11 follow-up; not this brief's concern).
- The excluded "session" cluster (Section 10) — not touched.
- `inngest/daily-delivery.ts`, `weekly-digest.ts`, `feedback-processor.ts`, `trial-expiry.ts` — not
  deregistered; flagged only (see Adjacent Items below).
- `app/api/feedback/route.ts`, `app/api/checkout/route.ts`, `app/api/checkout/confirm/route.ts` — not
  touched; flagged only (see Adjacent Items below).

---

## Adjacent, Named-Not-Silently-Dropped Items (for developer awareness, not this brief's scope to fix)

1. **`inngest/daily-delivery.ts`, `inngest/weekly-digest.ts`, `inngest/feedback-processor.ts`** — per the
   original brief: still registered live in `app/api/inngest/route.ts`, still write to `delivery_log`
   (whose only UI reader this brief removes). One-line developer check requested: are these still actually
   firing and doing anything meaningful (e.g. attempting sends against a since-removed dependency)? Not
   this brief's decision to deregister them.
2. **`inngest/trial-expiry.ts`** — BA-discovered fourth live daily cron in the same family (not named in
   the original brief). Runs 9AM UTC, queries `users` by `subscription_status = 'trialing'`, sends real
   "Activate your plan" / "Reactivate my plan" emails linking to `${appUrl}/checkout` (held per Section
   11), and suspends expired trials. Same one-line-check treatment requested: is this still meaningfully
   firing, and does it need its email copy/links updated once the Section 11 follow-up resolves
   `/checkout`'s fate? Not this brief's decision to deregister or rewrite.
3. **`app/api/feedback/route.ts`** — reads Twilio inbound SMS webhooks (Twilio is a removed/unapproved
   package per this project's `CLAUDE.md`) and redirects to the now-deleted `/dashboard/messages` on
   completion. Very likely already-dead itself, independent of this brief. Flagged for a separate check,
   not touched here.
4. **`app/api/checkout/route.ts`, `app/api/checkout/confirm/route.ts`** — `app/api/checkout/route.ts` is
   called only by the held (not deleted) `app/checkout/page.tsx`; `confirm/route.ts` likewise. Both remain
   wired exactly as today since `app/checkout/page.tsx` is not touched in this version. Revisit together
   with the Section 11 follow-up.
5. **`createPortalSession` in `lib/stripe.ts`** — **BA-added (CEO-flagged).** Once `app/api/portal/
   route.ts` is deleted (its sole caller), `createPortalSession` has zero remaining callers repo-wide and
   becomes dead code. `lib/stripe.ts` itself is NOT deleted — it has other live exports (e.g.
   `createCheckoutSession`) — only this one function is orphaned. Its `return_url` parameter points at
   `/dashboard/billing`, a route being deleted in this same brief, which is a second, independent reason
   it can no longer do anything useful even if called. Same treatment as items 1-2 above: flagged for a
   future cleanup pass to actually remove the function, not this brief's scope to act on.
