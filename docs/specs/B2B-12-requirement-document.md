# B2B-12 — Homepage "Get Started" CTA — Partner Signup
# Requirement Document
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-16

**Source Feature Brief:** `.claude/agents/clio/feature-briefs/B2B-12-homepage-get-started-cta-partner-signup.md`

**Verified directly against the shipped, live code by this document's author, both read in full:**
- `components/marketing/MarketingNav.tsx` — the "Get started" `<Link>` in the persistent top-right nav
  is at **lines 52–58** (the Feature Brief cites 51–59; the off-by-one is immaterial — the exact JSX block
  quoted in the brief matches the live file byte-for-byte). Confirmed `href="/onboarding"` is the only prop
  that needs to change; className, children ("Get started" text + `ArrowRight` icon), and every surrounding
  line are unrelated and untouched.
- `app/(marketing)/page.tsx` — the bottom-of-page final CTA `<Link>` is at **lines 553–558**, exact match to
  the Feature Brief's quoted block. Confirmed `href="/onboarding"` is the only prop that needs to change.
- `app/partner-signup/page.tsx` — confirmed this file exists on disk, so `/partner-signup` is a live,
  resolvable route and not a dead link.

This document does not re-derive scope — the Feature Brief already fully specifies the two files, exact
line numbers, and old/new `href` values. This document turns that into a buildable, testable spec.

---

## 1. Purpose

The homepage's "Get started" button is the entry point to Clio's entire post-pivot B2B business — it is
how a partner (or prospective partner) begins the partner signup flow. Both instances of this button
currently carry `href="/onboarding"`, a leftover pointer at the retired B2C consumer onboarding flow.
Clicking "Get started" today sends a partner into a dead flow instead of `/partner-signup`, the correct
B2B pivot destination.

**What failure looks like without this fix:** the primary conversion path on the homepage is broken.
Arun confirmed this via live testing on hello-clio.com — clicking "Get started" did not take him to
partner signup as expected.

## 2. User Story

As a prospective partner visiting the Clio homepage,
I want clicking "Get started" (in the nav bar or the bottom CTA banner) to take me to partner signup,
So that I can begin onboarding as a Clio partner instead of landing on a dead consumer flow.

## 3. Trigger / Entry Point

- **Where these buttons live:** both are on `app/(marketing)/page.tsx`'s rendered output — the nav bar
  instance (`MarketingNav`, rendered at the top of every marketing page including the homepage) and the
  bottom CTA banner instance (rendered only within the homepage's `BottomCTA` section).
- **What triggers the fix's effect:** a user clicking either button.
- **User state required:** none — both buttons are on public, unauthenticated marketing pages. No sign-in,
  onboarding, or subscription state is required to see or click either button.

## 4. Screen / Flow Description

This is a routing-only fix. No screen's visible content, layout, copy, or styling changes. The only
observable behavior change is the destination URL after a click.

**State 1 — Homepage, before interaction (unchanged visually)**
- Nav bar, top-right: a purple button reading "Get started" with a right-arrow icon, exactly as it
  renders today.
- Bottom of page: inside a purple/cyan gradient banner, a button reading "Get started — 15 seconds to set
  up" with a right-arrow icon, exactly as it renders today.

**State 2 — User clicks the nav bar "Get started" button**
- Before this fix: browser navigates to `/onboarding`.
- After this fix: browser navigates to `/partner-signup`.
- No loading state, confirmation, or intermediate screen — this is a plain Next.js `<Link>` client-side
  navigation, identical mechanism to today, only the destination path changes.

**State 3 — User clicks the bottom CTA banner "Get started — 15 seconds to set up" button**
- Before this fix: browser navigates to `/onboarding`.
- After this fix: browser navigates to `/partner-signup`.
- Same navigation mechanism as State 2 — no new loading state or intermediate screen.

## 5. Visual Examples

No visual change on either source screen — wireframes below show the buttons exactly as they render
today (unchanged appearance), annotated with the corrected destination.

**Nav bar CTA (`components/marketing/MarketingNav.tsx`, appears on every marketing page):**
```
┌──────────────────────────────────────────────────────────────────┐
│  Clio AI      How it works   Pricing        Log in  [Get started →]│
└──────────────────────────────────────────────────────────────────┘
                                                        ↑
                                    now navigates to /partner-signup
                                    (was: /onboarding)
```

**Bottom CTA banner (`app/(marketing)/page.tsx`, homepage only):**
```
┌─────────────────────────────────────────────────────┐
│         Your competitors are already learning.       │
│                     Are you?                          │
│                                                        │
│         [Get started — 15 seconds to set up →]       │
└─────────────────────────────────────────────────────┘
                          ↑
          now navigates to /partner-signup
          (was: /onboarding)
```

## 6. Data Requirements

- **Database:** none read or written. This is a static `href` change on two JSX elements.
- **APIs called:** none. `/partner-signup` is a rendered page route (`app/partner-signup/page.tsx`,
  confirmed to exist), not an API call.
- **localStorage / sessionStorage:** none.
- **Code change, precisely:**
  - `components/marketing/MarketingNav.tsx`, line 53: `href="/onboarding"` → `href="/partner-signup"`.
  - `app/(marketing)/page.tsx`, line 553: `href="/onboarding"` → `href="/partner-signup"`.
  - No other line in either file changes.

## 7. Success Criteria (Acceptance Tests)

✓ Given the homepage is loaded, when a user clicks the "Get started" button in the top-right nav bar,
then the browser navigates to `/partner-signup`. (Nav CTA — happy path.)

✓ Given the homepage is loaded and scrolled to the bottom CTA banner, when a user clicks "Get started —
15 seconds to set up", then the browser navigates to `/partner-signup`. (Bottom CTA — happy path.)

✓ Given any other marketing page that renders `MarketingNav` (e.g. `/pricing`), when a user clicks the
nav bar "Get started" button, then the browser navigates to `/partner-signup`. (Nav CTA fix applies
site-wide, not just on the homepage, since `MarketingNav` is a shared component.)

✓ Given the nav bar "Get started" button after this fix, when inspected, then its visible text ("Get
started"), icon (`ArrowRight`), and CSS classes are byte-for-byte identical to before the fix — only the
`href` attribute differs. (No unintended visual change — nav CTA.)

✓ Given the bottom CTA banner button after this fix, when inspected, then its visible text ("Get started
— 15 seconds to set up"), icon, and styling are byte-for-byte identical to before the fix — only the
`href` attribute differs. (No unintended visual change — bottom CTA.)

✓ Given the homepage after this fix, when the hero primary CTA ("Start free — 3-day trial") and the three
pricing-tier CTAs ("Get Starter" / "Get Pro" / "Get Executive") are inspected, then all four still point
at `/onboarding`, unchanged. (Confirms the fix's scope boundary was respected — see Section 10.)

## 8. Error States

Not applicable in the traditional sense — there is no form submission, API call, or async operation in
this fix. The only "failure" this fix could introduce is navigating to a broken or non-existent route.
This is mitigated by the pre-build verification already performed: `app/partner-signup/page.tsx` is
confirmed to exist on disk (see verification note above), so `/partner-signup` is a resolvable route and
will not 404.

If, at build or QA time, `/partner-signup` were found to not render correctly, that is a defect in the
`/partner-signup` page itself — out of scope for this document, which only concerns the two `href` values
that point to it.

## 9. Edge Cases

- **User is already signed in when clicking either button.** No special handling required by this fix —
  whatever `/partner-signup` does for an already-authenticated user (e.g. redirect logic, if any) is that
  page's own existing behavior, unmodified by this change.
- **User clicks the nav bar button from a non-homepage marketing page** (e.g. `/pricing`). Covered
  explicitly in Section 7 — `MarketingNav` is a shared component, so the fix applies identically wherever
  it's rendered.
- **Mobile vs. desktop.** No layout difference introduced or affected — this fix changes only the `href`
  attribute value, not any responsive class, breakpoint, or markup structure. Both buttons render and
  behave identically pre- and post-fix on any viewport size.
- **The two out-of-scope `/onboarding`-linked buttons on the same page** (hero CTA, three pricing-tier
  CTAs) are not touched and must continue pointing at `/onboarding` exactly as they do today — verified as
  its own acceptance test in Section 7 to guard against scope creep during implementation.

## 10. Out of Scope

- **The hero primary CTA** ("Start free — 3-day trial", `app/(marketing)/page.tsx` lines 62–67 per the
  Feature Brief) — still points at `/onboarding`. Not touched by this fix. Does not carry the literal text
  "Get started," so it falls outside Arun's instruction as scoped by the Feature Brief.
- **The three pricing-tier CTAs** ("Get Starter" / "Get Pro" / "Get Executive", `app/(marketing)/page.tsx`
  lines 378–411 per the Feature Brief) — still point at `/onboarding`. Not touched by this fix, for the
  same reason as above.
- Both of the above are logged separately by the CEO Agent under `BACKLOG.md` as part of a broader
  observation that the entire homepage (hero, pricing tiers, testimonials) still reads as un-migrated B2C
  content — a full homepage-redesign decision for Arun, tracked as its own backlog item, not folded into
  this fix.
- **No other link, button, page, or copy on the homepage or anywhere else in the site changes.** This
  document's scope is exactly two `href` attribute values.
- **No change to `/partner-signup` itself** — its content, form fields, or behavior are outside this
  document's scope entirely.
- **No change to `/onboarding`** — it remains live and unmodified; this fix only stops two specific
  buttons from pointing at it.

## 11. Open Questions

None.

## 12. Dependencies

- **`app/partner-signup/page.tsx`** must exist and be a resolvable route before this fix ships — confirmed
  already true by direct file read (see verification note above). No new page needs to be built.
- No other dependency. No schema change, no new environment variable, no new vendor approval, no new API
  route.
