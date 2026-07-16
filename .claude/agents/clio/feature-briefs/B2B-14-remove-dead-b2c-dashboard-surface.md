# Feature Brief: Remove Confirmed-Dead B2C Dashboard Surface

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-16

## What Arun Said

Live-testing hello-clio.com directly, Arun said: **"you need to change and remove to align with
our new goals. plan, session etc are not needed anymore. modify the dashboard."**

This is logged verbatim in `docs/b2b-pivot-status.md`'s Live QA Findings section (item 4,
2026-07-16), which records it as a direct, confirmed decision — **delete, not gate or redirect
around** — closing task #44 ("Discuss untouched B2C surface + stray files after B2B pivot
complete"). This is not a discussion item; Arun has already decided the "what." This brief scopes
the "exactly what, and what not yet."

## The Problem Being Solved

`app/dashboard/page.tsx` — the old B2C individual-consumer dashboard (AI Readiness Score, day
streak, message feed, plan-tier billing) — was supposed to be retired when the B2B pivot happened.
This project's own `CLAUDE.md` says so explicitly: *"the old B2C file tree... was removed as
stale — do not rebuild it."* It wasn't actually deleted. It's still fully live, still queries B2C
tables directly by Clerk `userId`, still renders B2C copy ("Your AI learning command center"), and
— per the same QA finding — is very likely still the default post-sign-in landing page for anyone
who signs in today. For a product now selling to partners, not individual executives, this is
actively confusing and off-brand: a partner-admin who signs in sees a dead consumer product instead
of the Configurator.

## What Success Looks Like

- Signing in no longer lands anyone on the old B2C gamification dashboard.
- The individual-subscription/nurture surface (plan-tier picker, pricing page, checkout, delivery
  message feed, billing-by-Stripe-subscription) is deleted from the codebase, not just hidden.
- `middleware.ts` no longer advertises now-deleted routes as public.
- Post-sign-in and post-sign-up redirect targets point at the real B2B Configurator flow.
- Nothing in the confirmed-live B2B surfaces (Configurator, admin pages, partner-render,
  partner-questionnaire, partner-signup) breaks as a side effect.

## Known Constraints

- **Do not touch**: `app/dashboard/configurator/*`, `app/dashboard/admin/*`,
  `app/partner-render/*`, `app/partner-questionnaire/*`, `app/partner-signup/*` — all confirmed
  live B2B surfaces.
- **`components/dashboard/DashboardShell.tsx` must survive.** It is imported by 4 confirmed-live
  admin pages (`app/dashboard/admin/clients/page.tsx`, `app/dashboard/admin/glitches/page.tsx`,
  `app/dashboard/admin/templates/page.tsx`, `app/dashboard/admin/templates/[templateName]/progress/page.tsx`)
  in addition to the dead dashboard page. Only the dead page's *usage* of it is removed; the
  component itself stays.
- **`app/(marketing)/page.tsx` (the hello-clio.com homepage) is NOT in scope for deletion.** Arun
  is actively testing it right now as the live B2B marketing homepage (that's literally what
  generated this QA-findings log). Its broken "Get Started" CTA is a separate, already-tracked
  finding (`docs/b2b-pivot-status.md` Live QA Findings item 1 — should route to `/partner-signup`)
  with its own likely-already-in-flight fix (`B2B-12-homepage-get-started-cta-partner-signup.md`).
  Do not fold that fix into this brief; do not delete the homepage.
- A sibling brief in this same batch (`B2B-13-recurring-plan-tiers-and-configurable-topups.md`) is
  redesigning the wizard payment step and has independently confirmed `app/plan/`,
  `app/dashboard/plan/` (the tier-picker one, see below), `app/(marketing)/pricing/page.tsx`, and
  `app/checkout/page.tsx` are **not** being reused for the new billing UI — safe to delete from
  that angle too.
- No user-visible copy or screen decisions are needed here — this is subtraction, not addition. No
  new AI-generated content, no new screens.

## Scope — Confirmed Dead, Safe to Delete

Verified via full dependency-tree trace and repo-wide grep (no live B2B code imports or links to
any of these):

**Pages/routes:**
- `app/dashboard/page.tsx` (the B2C gamification dashboard itself)
- `app/dashboard/DashboardClient.tsx`
- `app/plan/` (`PlanClient.tsx` + `page.tsx` — Starter/Pro/Executive tier picker)
- `app/(marketing)/pricing/page.tsx`
- `app/checkout/page.tsx` (Stripe Elements individual-subscription checkout)
- `app/dashboard/upgrade/page.tsx`
- `app/dashboard/welcome/page.tsx`
- `app/dashboard/billing/` (queries individual `users.plan_tier`/`subscription_status`/
  `stripe_customer_id`; hardcodes Starter/Pro/Executive `PLAN_FEATURES`) — B2B-04's shipped commit
  (`34f7e92`) already removed the B2C-era Stripe webhook branches this page's data depends on, per
  `docs/b2b-pivot-status.md`'s B2B-04 row, so this page's billing data path is already orphaned
  upstream. BA should have the dev confirm no other webhook branch still writes those columns
  before deleting, per the original investigation's caution — a one-line check, not a blocker.
- `app/dashboard/messages/` (`MessagesClient.tsx` + `page.tsx` — individual SMS/email delivery
  feed, reads `delivery_log`) — matches the pivot brainstorm doc's own "genuinely cut" list
  (consumer SMS/email nurture cadence).

**Components (confirmed sole importers are the pages above):**
- `components/dashboard/ScoreRing.tsx`
- `components/dashboard/StreakCounter.tsx`
- `components/dashboard/DeliveryToggle.tsx`
- `components/dashboard/MessageCard.tsx` (importers are `DashboardClient.tsx` and
  `MessagesClient.tsx` — both dead, both in this scope)

**Do NOT delete `components/plan/RecommendationCard.tsx` or `components/dashboard/ScheduleCard.tsx`**
as part of this — both are also imported by `app/dashboard/plan/PlanClient.tsx` (note: a
**different, distinctly-named file** from `app/plan/PlanClient.tsx` above — see the excluded
cluster below), which is out of scope for this brief.

**Middleware cleanup (required, or deleted routes 404 instead of redirecting cleanly):**
Remove from `isPublicRoute` in `middleware.ts`: `/pricing(.*)`, `/plan(.*)`, `/checkout(.*)`. Leave
`/onboarding(.*)`, `/topics(.*)`, `/dashboard/welcome(.*)` alone for now — see excluded cluster
below on why `/onboarding`/`/topics` aren't in this brief's deletion scope, and note
`/dashboard/welcome` itself IS being deleted above (its public-route entry should still be removed
even though the route it names isn't ambiguous — it's dead, just listed here for completeness of
the middleware diff).

**Post-sign-in/sign-up redirect fix (code-level, confirmed — not a Vercel env var issue):**
`app/(auth)/sign-in/[[...sign-in]]/page.tsx:9` hardcodes `fallbackRedirectUrl="/dashboard"` and
`signUpForceRedirectUrl="/onboarding"`. `app/(auth)/sign-up/[[...sign-up]]/page.tsx:9` hardcodes
`forceRedirectUrl="/onboarding"`. These are literal JSX props in this repo's own files —
`NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`/`AFTER_SIGN_UP_URL` are not read anywhere in code (confirmed
by repo-wide grep), so there is no separate Vercel env var for Arun to change; this is entirely a
code fix. `fallbackRedirectUrl` must change to `/dashboard/configurator` (the real B2B landing
surface). The sign-up target is more open — see redirect-stub decision below and the CEO decision
on it.

**CEO decision — leave a redirect stub, not a 404:** `app/dashboard/page.tsx` should become a
one-line `redirect('/dashboard/configurator')` rather than being removed outright. Reasoning: this
is a mid-pivot product on a live domain with real inbound traffic and possibly-bookmarked links
from before the pivot; the executive-UX standard this product holds itself to treats a dead-end
404 as a worse experience than a silent redirect to the correct place, and the cost of a one-line
redirect file is negligible. BA should confirm this in the spec, not leave it to developer
discretion.

## Scope — Explicitly Excluded, Flagged for a Separate Decision (do not build without it)

The investigation this brief is based on surfaced something Arun's instruction didn't anticipate:
**a second, much larger cluster of files also lives under `app/dashboard/` and is also literally
named "session"-adjacent, but it does not match the profile of dead B2C nurture code — it appears
to be live, currently-developed voice-coaching session infrastructure that the B2B partner flow may
itself depend on or share code with.**

Specifically, **excluded from this brief's deletion scope**:
- `app/dashboard/sessions/`, `app/dashboard/sessions/[id]/`
- `app/dashboard/knowledge-base/`, `app/dashboard/knowledge-base/[topicId]/`
- `app/dashboard/walkthrough/`
- `app/dashboard/plan/` (the *review-your-curriculum* page — distinct file from `app/plan/` above)
- `app/dashboard/phone/`, `app/dashboard/settings/`, `app/dashboard/schedule-setup/`
- `app/onboarding/` (the individual 9-step wizard) and `app/topics/`

Why these are held back rather than folded in:

1. `app/dashboard/sessions/`, `knowledge-base/`, and `walkthrough/` pull in `HumeAdapter`,
   `LiveConductorVisual`, `checkRtv03Transition`, `VisualizationTabPanel`, `SessionStack`,
   `lib/session-plan`, and `lib/content/script-generator` — the same voice-coaching machinery
   behind `app/api/webhooks/hume/route.ts`, `app/api/recall/webhook/route.ts`,
   `app/api/attendee/webhook/route.ts`, `lib/session-billing.ts`, and 15+ `inngest/session-*` /
   `curriculum-*` / `rtv03-*` jobs — all of which are under active, current development (several
   show as modified/uncommitted in the working tree right now, and B2B-09/10/11 in
   `docs/b2b-pivot-status.md` show this exact machinery being extended for partner sessions as
   recently as today).
2. `app/onboarding/` was last committed 2026-07-03 with active `AUTH-02`/`ONBOARD-DATA-01` work —
   it does not read as abandoned B2C code; it reads as a currently-maintained flow. It feeds
   `/topics`, which feeds the same curriculum/session-generation engine referenced above.
3. The individual `sessions` DB table (distinct from the B2B `partner_sessions` table) is
   referenced by roughly 40 files, overwhelmingly by code that is clearly part of the still-active
   voice-session product, not the retired consumer-nurture product.

Arun named "plan" and "session" as examples of what's not needed. "Plan" maps cleanly onto
`app/plan/` (the Starter/Pro/Executive tier picker) — that's unambiguous and is in this brief's
scope. But "session" could mean either (a) the individual-consumer dashboard's session-viewing UI
specifically, which may genuinely be obsolete now that partners' end users go through
`/partner-render/[clio_session_ref]` instead — or (b) something narrower that doesn't extend to the
underlying engine this cluster shares with currently-live webhook handlers and cron jobs. Given the
downside of guessing wrong here is breaking currently-billed, actively-developed production
infrastructure — not a cosmetic regression — this needs Arun's direct one-line confirmation before
the BA scopes any deletion in this cluster, not an inference from a two-word instruction given
while looking at a different screen (the old gamification dashboard).

**Recommendation, not yet an instruction to build**: most likely reading is that Arun means the
individual end-user path through this cluster (sign in → `/onboarding` → `/topics` →
`/dashboard/sessions/[id]`) is dead as a *product surface* now that end users only ever reach a
session via a partner's `/partner-render/` link — but the *engine* underneath (Hume adapter,
webhook handlers, curriculum generation, inngest jobs) likely needs to stay because
`partner_sessions` reuses it. If that's correct, the right follow-up brief is narrower than "delete
the cluster" — it's "confirm the individual entry point is unreachable/unused, delete only the
individual-facing pages, verify the underlying engine has no remaining callers besides the partner
path." That confirmation has to come from Arun, not be assumed here.

## Adjacent, Named-Not-Silently-Dropped Item

Deleting `app/dashboard/messages/` removes the UI that reads `delivery_log`, but the three cron
jobs that write to it — `inngest/daily-delivery.ts`, `inngest/weekly-digest.ts`,
`inngest/feedback-processor.ts` — are still registered live in `app/api/inngest/route.ts` today,
despite the pivot brainstorm doc listing this exact cron-nurture model under "genuinely cut." BA
should flag this to the developer as a one-line check (are these crons still actually firing and
doing anything, e.g. attempting Twilio calls against a since-removed dependency?) but it is not
this brief's scope to deregister them — that's a decision about background jobs, not the dashboard
UI Arun was looking at, and deserves its own one-line confirmation rather than silent inclusion.

## Questions for BA

1. Confirm via a fresh grep pass (don't trust this brief's list as exhaustive) that nothing else in
   the live B2B surfaces imports any file in the "Confirmed Dead" list above before writing the
   deletion into the spec's Files Changed section.
2. Write the exact middleware.ts diff (which `isPublicRoute` entries to remove) and the exact
   sign-in/sign-up redirect prop changes, verbatim, into the spec.
3. Decide and document the sign-up redirect target: today it's `signUpForceRedirectUrl="/onboarding"` /
   `forceRedirectUrl="/onboarding"`. Since `/onboarding` is explicitly NOT being deleted in this
   brief (see excluded cluster), this can stay as-is for now — confirm this reasoning explicitly in
   the spec so a future reader doesn't assume it was overlooked.
4. Confirm `app/dashboard/billing/`'s data path is fully orphaned (no remaining webhook branch
   writes `users.plan_tier`/`subscription_status`/`stripe_customer_id`) before listing it as safe
   to delete outright.
5. Section 11 must NOT attempt to resolve the excluded cluster above — that requires Arun's direct
   answer, not a BA judgment call. If BA independently reaches a different read on any file in the
   "Confirmed Dead" list during spec-writing, stop and flag it back to CEO rather than including it
   speculatively.

## Files Likely Changed (for BA to verify and finalize)

- Delete: `app/dashboard/DashboardClient.tsx`, `app/plan/` (dir), `app/(marketing)/pricing/page.tsx`,
  `app/checkout/page.tsx`, `app/dashboard/upgrade/page.tsx`, `app/dashboard/welcome/page.tsx`,
  `app/dashboard/billing/` (dir), `app/dashboard/messages/` (dir), `components/dashboard/ScoreRing.tsx`,
  `components/dashboard/StreakCounter.tsx`, `components/dashboard/DeliveryToggle.tsx`,
  `components/dashboard/MessageCard.tsx`
- Replace: `app/dashboard/page.tsx` → single `redirect('/dashboard/configurator')`
- Modify: `middleware.ts` (`isPublicRoute` list), `app/(auth)/sign-in/[[...sign-in]]/page.tsx`
  (`fallbackRedirectUrl`)
