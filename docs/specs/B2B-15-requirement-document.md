# B2B-15 — Hero CTA Routing Fix + Removal of Dead B2C Pricing Section
# Requirement Document
Version: 1.0
Status: APPROVED — routed to Dev
Author: Business Analyst Agent
Date: 2026-07-16

**CEO approval note (2026-07-16):** Independently re-verified against the live source (`git diff`,
`Pricing()` line span, every `useState`/`useRef`/`CheckCircle`/`Badge`/`/onboarding` occurrence, and the
`#pricing` anchor/`MarketingNav` check) — zero discrepancies with this document or the source Feature
Brief. Section 11 is genuinely empty. Acceptance criteria in Section 7 are all mechanically verifiable
(grep/tsc/build/render-order/diff checks), none are vague. The `Smartphone` dead-import finding is
correctly excluded from this spec's scope and routed as a separate item, per the "implement literally,
don't scope-creep" principle. Approved as-is, no revisions requested. Route to Dev; QA Gate 1 should
confirm the final diff matches Section 7 exactly.

**Source Feature Brief:** `.claude/agents/clio/feature-briefs/B2B-15-hero-cta-fix-and-pricing-section-removal.md`

**Verified directly against the live source by this document's author, both read in full:**
- `git diff -- "app/(marketing)/page.tsx"` run directly — confirmed the working tree has exactly one
  uncommitted change: line 62, `href="/onboarding"` → `href="/partner-signup"` inside `Hero()`. No other
  lines are touched. Matches the Feature Brief's description of Part 1 exactly.
- `app/(marketing)/page.tsx` read in full (580 lines). Confirmed:
  - The `Pricing()` function spans **lines 359–527** (from the `// ─── Pricing ───` section-header
    comment through the closing `}` of the function) — matches the brief exactly.
  - The local `plans` array is at **lines 366–415** — matches the brief exactly.
  - The `useState` toggle declaration is at **line 362**; the toggle's JSX is at **lines 433–454** —
    matches the brief exactly.
  - The single call site `<Pricing />` is at **line 575**, inside `LandingPage()`'s render tree between
    `<Testimonials />` and `<BottomCTA />` — matches the brief exactly.
- Ran `grep -n "useState\|useRef\|CheckCircle\|Badge"` across the full file to independently verify every
  occurrence of the four identifiers in question (not just the ones the brief cited):
  - `useState`: **one occurrence**, line 362, inside `Pricing()`. Confirmed safe to remove from the
    import statement once `Pricing()` is deleted.
  - `useRef`: **four occurrences** — line 159 (`ProblemSection`), line 223 (`HowItWorks`), line 293
    (`Testimonials`), line 363 (`Pricing`). Three of the four are outside `Pricing()` and must survive.
    Confirmed the import must be **kept**.
  - `CheckCircle`: **one occurrence**, line 506, inside `Pricing()`. Confirmed safe to remove from the
    `lucide-react` import statement once `Pricing()` is deleted.
  - `Badge`: **two occurrences** — line 47 (`Hero`), line 473 (`Pricing`). One of the two is outside
    `Pricing()` and must survive. Confirmed the import must be **kept**.
- Searched the rest of the repo (`grep -rn` for `import.*Pricing` and any reference to this page module)
  — confirmed no other file imports or references `Pricing` or `app/(marketing)/page.tsx`'s contents.
  `Pricing` is a local, non-exported function; only `LandingPage` is `export default`. Deletion is fully
  contained to this one file.

This document does not re-derive scope — the Feature Brief already fully specifies the file, exact line
ranges, call site, and the two imports needing cleanup, and this author's independent verification found
no discrepancies with any of it. This document turns that into a buildable, testable spec.

**One out-of-scope observation, not part of this spec:** `Smartphone` (imported from `lucide-react` at
line 8) appears to be unused anywhere in the file, both before and after this change — a pre-existing
dead import unrelated to the Pricing removal. `tsconfig.json` does not set `noUnusedLocals` or
`noUnusedParameters`, so this will not fail `tsc --noEmit` or `npm run build`. Per the Feature Brief's
explicit scope ("Only remove `CheckCircle` and `useState` from the import statements"), this is not
touched by B2B-15. Flagged for a separate backlog item, not as an open question here.

---

## 1. Purpose

This feature closes two problems on the live Clio marketing homepage, both discovered during Arun's
continued live testing on hello-clio.com after B2B-12 shipped:

1. **Hero CTA fix**: the homepage's most prominent call-to-action button — "Start free — 3-day trial",
   at the top of the page — was routing to `/onboarding`, the retired B2C consumer onboarding flow.
   B2B-12 fixed the same class of bug for the two literal "Get started" buttons (nav bar and bottom CTA
   banner) but explicitly scoped this hero button out because it didn't share their exact button text.
   Arun applied this specific fix himself directly in the working tree and asked that it be formalized
   through the normal CEO→BA→Dev governance chain retroactively, rather than remain an ungoverned direct
   edit.

2. **Pricing section removal**: the homepage's pricing section displays three fabricated B2C consumer
   subscription tiers (Starter $12/mo, Pro $25/mo, Executive $49/mo) with B2C-only features ("Email + SMS
   daily insights," "AI Readiness Score," "Ask Anything SMS," "Dedicated phone number") and CTA buttons
   that all route to `/onboarding`. None of this reflects the real B2B product — B2B-13 already shipped
   the actual Starter/Growth plan-tier pricing with wallet top-ups and partner-account billing. Arun was
   given three options (relink the buttons and leave the B2C copy; remove the section entirely; replace
   it with real B2B-13 pricing) and chose to remove the section entirely, explicitly to avoid pulling
   forward into the full homepage redesign that remains frozen pending a separate go-ahead.

**What failure looks like without this feature:**
- Prospects clicking the most visible CTA on the homepage land on a dead, non-functional flow instead of
  the correct partner signup — actively costing partner conversions.
- The homepage continues showing fabricated consumer pricing and features to a B2B/partner audience,
  actively misrepresenting what a prospect would be signing up for if the buttons worked at all.

## 2. User Story

As a prospective partner visiting the Clio homepage,
I want the hero "Start free — 3-day trial" button to take me to partner signup,
So that I can begin the correct B2B onboarding flow instead of landing on a dead consumer flow.

As a prospective partner visiting the Clio homepage,
I want to see only accurate information about Clio,
So that I am not shown fabricated consumer pricing/features that have no relationship to the real B2B
product, and am not misled about what I'd be signing up for.

## 3. Trigger / Entry Point

- **Where this lives:** `app/(marketing)/page.tsx`, the homepage rendered at the root marketing route
  (`/`). Part 1 (hero CTA) is inside the `Hero()` component; Part 2 (pricing removal) is the `Pricing()`
  component and its render call inside `LandingPage()`.
- **What triggers each change's effect:**
  - Part 1: a user clicking the hero "Start free — 3-day trial" button.
  - Part 2: no user action triggers this — it is a static content removal. The effect is simply that the
    pricing section no longer renders when any user loads the homepage.
- **User state required:** none — the homepage is a public, unauthenticated marketing page. No sign-in,
  onboarding, or subscription state is required to view it or click the hero CTA.

## 4. Screen / Flow Description

### Part 1 — Hero CTA (already implemented, verify only)

**State 1 — Homepage hero, before interaction (unchanged visually)**
- Top of page: a purple, large ("lg" size) button reading "Start free — 3-day trial" with a right-arrow
  (`ArrowRight`) icon, positioned in the hero's left column below the subheadline "15 seconds a day. Zero
  jargon. Total confidence." No visual, copy, or layout change from what exists today.

**State 2 — User clicks the hero CTA button**
- Before this fix: browser navigates to `/onboarding` (dead B2C flow).
- After this fix: browser navigates to `/partner-signup` (live route, confirmed to exist at
  `app/partner-signup/page.tsx`).
- No loading state, confirmation, or intermediate screen — this is a plain Next.js `<Link>` client-side
  navigation, identical mechanism to today, only the destination path changes.

**Developer action required:** none — this change is already applied and uncommitted in the working
tree. The developer's job is to confirm the diff matches this document's description exactly (see
Section 7, Acceptance Test 1) and include it as part of the same commit/PR as Part 2, not to re-implement
it.

### Part 2 — Pricing section removal

**State 1 — Homepage, before this change (current production behavior)**
- Scrolling down the homepage past Testimonials, a visitor sees:
  - Heading: "Simple, transparent pricing"
  - Subheading: "Start free. Upgrade when you see the value."
  - A Monthly/Annual pill toggle (purple background on the active option, "Save 30%" label on Annual)
  - Three pricing cards side by side: Starter ($12/mo or $99/yr), Pro ($25/mo or $199/yr, highlighted
    with a purple border and "Most popular" badge), Executive ($49/mo or $399/yr)
  - Each card has a feature-checkmark list and a CTA button ("Get Starter" / "Get Pro" / "Get Executive")
    that routes to `/onboarding`

**State 2 — Homepage, after this change**
- The entire pricing section described above no longer renders.
- Scrolling down the homepage, a visitor goes directly from the end of the Testimonials section
  ("Trusted by leaders who move fast" + 3 testimonial cards) straight into the Bottom CTA banner
  ("Your competitors are already learning. Are you?").
- No spacer, placeholder, "coming soon" message, or any other replacement content appears in the gap.
  This is an intentional, accepted visual consequence of removing the section — not a defect.
- No other section of the homepage (`MarketingNav`, `Hero`, `ProblemSection`, `HowItWorks`,
  `Testimonials`, `BottomCTA`) changes in content, layout, or behavior.

## 5. Visual Examples

**Hero CTA — unchanged appearance, corrected destination:**

```
┌─────────────────────────────────────────────────┐
│  [Badge: "AI Readiness Platform"]                │
│                                                   │
│  Meet Clio.                                      │
│  15 seconds a day. Zero jargon. Total confidence.│
│                                                   │
│  [PRIMARY BUTTON: "Start free — 3-day trial" →]  │  ← now links to /partner-signup
│  See how it works ↓                              │
└─────────────────────────────────────────────────┘
```

**Homepage section order — before this change:**

```
┌─────────────────────────────────────────────────┐
│  MarketingNav                                    │
├─────────────────────────────────────────────────┤
│  Hero                                            │
├─────────────────────────────────────────────────┤
│  ProblemSection ("Sound familiar?")              │
├─────────────────────────────────────────────────┤
│  HowItWorks ("Three steps to AI confidence")     │
├─────────────────────────────────────────────────┤
│  Testimonials ("Trusted by leaders...")          │
├─────────────────────────────────────────────────┤
│  Pricing ("Simple, transparent pricing")         │  ← REMOVED by this change
├─────────────────────────────────────────────────┤
│  BottomCTA ("Your competitors are already        │
│              learning.")                         │
└─────────────────────────────────────────────────┘
```

**Homepage section order — after this change:**

```
┌─────────────────────────────────────────────────┐
│  MarketingNav                                    │
├─────────────────────────────────────────────────┤
│  Hero                                            │
├─────────────────────────────────────────────────┤
│  ProblemSection ("Sound familiar?")              │
├─────────────────────────────────────────────────┤
│  HowItWorks ("Three steps to AI confidence")     │
├─────────────────────────────────────────────────┤
│  Testimonials ("Trusted by leaders...")          │
├─────────────────────────────────────────────────┤
│  BottomCTA ("Your competitors are already        │
│              learning.")                         │
│  ← Testimonials flows directly into BottomCTA,   │
│    no section, spacer, or placeholder between    │
│    them.                                         │
└─────────────────────────────────────────────────┘
```

## 6. Data Requirements

No database reads, writes, API calls, or client-side storage are involved in this feature.

- **Read from database:** none.
- **Written to database:** none.
- **APIs called:** none. (Part 1 changes a static `href` string; Part 2 deletes static JSX and its local
  `useState` toggle, which held only ephemeral, non-persisted UI state — never read from or written to
  any storage.)
- **localStorage / sessionStorage:** none used before or after this change.

## 7. Success Criteria (Acceptance Tests)

✓ Given the working tree's current uncommitted diff on `app/(marketing)/page.tsx`, when a developer
  inspects `git diff -- "app/(marketing)/page.tsx"` (or the equivalent staged/committed diff after this
  lands), then the only change touching `Hero()` is line 62's `href="/onboarding"` →
  `href="/partner-signup"` — no other prop, copy, styling, or line inside `Hero()` differs from the
  pre-B2B-15 version.

✓ Given a user on the homepage (`/`), when they click the "Start free — 3-day trial" button in the hero
  section, then the browser navigates to `/partner-signup` (not `/onboarding`).

✓ Given `app/(marketing)/page.tsx` after this change, when a developer runs
  `grep -n "function Pricing" "app/(marketing)/page.tsx"`, then it returns zero matches.

✓ Given `app/(marketing)/page.tsx` after this change, when a developer runs
  `grep -n "<Pricing" "app/(marketing)/page.tsx"`, then it returns zero matches.

✓ Given `app/(marketing)/page.tsx` after this change, when a developer runs
  `grep -n "/onboarding" "app/(marketing)/page.tsx"`, then it returns zero matches (the hero CTA was the
  last remaining `/onboarding` reference on this page — B2B-12 already fixed the nav bar and bottom CTA
  banner instances, and the three pricing-tier CTAs that also pointed to `/onboarding` are deleted along
  with the rest of `Pricing()`).

✓ Given `app/(marketing)/page.tsx`'s import statements after this change, when a developer inspects the
  `react` import (originally `import { useRef, useState } from 'react'`), then it reads
  `import { useRef } from 'react'` — `useState` removed, `useRef` retained.

✓ Given `app/(marketing)/page.tsx`'s import statements after this change, when a developer inspects the
  `lucide-react` import, then `CheckCircle` is absent from the import list and every other icon
  (`ArrowRight`, `BrainCircuit`, `TrendingUp`, `Search`, `Zap`, `MessageSquare`, `Mail`, `Smartphone`,
  `XCircle`) is still present and unchanged.

✓ Given `app/(marketing)/page.tsx`'s import statements after this change, when a developer inspects the
  `@/components/ui/Badge` import, then `Badge` is still imported (it remains used in `Hero()` at line 47
  after `Pricing()`'s usage at line 473 is deleted).

✓ Given the full project, when a developer runs `npx tsc --noEmit`, then it completes with zero errors.

✓ Given the full project, when a developer runs `npm run build`, then it completes with zero errors.

✓ Given `LandingPage()`'s rendered output after this change, when a developer inspects the JSX return
  block, then it renders, in order: `<MarketingNav />`, `<Hero />`, `<ProblemSection />`,
  `<HowItWorks />`, `<Testimonials />`, `<BottomCTA />` — with no component between `<Testimonials />` and
  `<BottomCTA />`.

✓ Given the homepage loaded in a browser after this change, when a user scrolls from the Testimonials
  section to the end of the page, then the next visible content is the Bottom CTA banner ("Your
  competitors are already learning.") with no pricing cards, toggle, heading, spacer element, or
  placeholder message rendered in between.

✓ Given `ProblemSection()`, `HowItWorks()`, and `Testimonials()` after this change, when a developer
  diffs each function against its pre-B2B-15 version, then none of the three has any change — confirming
  the `useRef` import removal did not occur and these three components are untouched.

## 8. Error States

Not applicable. This feature involves no forms, no API calls, no async data fetching, and no user input
beyond a single link click. There is no failure mode to design for:
- The hero CTA is a static `<Link href="/partner-signup">` — if `/partner-signup` itself fails to load,
  that is `/partner-signup`'s own concern (already covered by B2B-12's spec and out of scope here), not
  a new error state introduced by this change.
- The pricing section removal has no runtime behavior at all — it is the absence of a section, not a
  process that can fail, time out, or need a loading state.

## 9. Edge Cases

- **First-time visitor vs. returning visitor:** no difference — this is a static marketing page with no
  user-specific state. Both see the same hero CTA destination and the same absence of a pricing section.
- **Mobile vs. desktop:** no layout differences are introduced by this change. The hero section's
  responsive behavior (`sm:`, `lg:` breakpoints) is untouched — only the `href` value changed, not any
  className or layout prop. The removed `Pricing()` section's own responsive grid (`md:grid-cols-3`) is
  deleted wholesale along with the rest of the function, so there is no partial/broken responsive state
  to worry about.
- **Direct navigation to `#pricing`:** the removed `Pricing()` section's wrapper had `id="pricing"`. Any
  existing link or bookmark pointing to `/#pricing` (e.g., from `MarketingNav`'s own internal anchor
  links, if any exist) will, after this change, simply scroll to the bottom of the page or do nothing
  visible, since the anchor target no longer exists. This document does not require auditing
  `MarketingNav` or other files for `#pricing` anchor links — that is outside this brief's stated
  single-file scope (`app/(marketing)/page.tsx` only). If a developer discovers a dangling `#pricing`
  anchor reference elsewhere while implementing this change, they should stop and flag it per the
  escalation chain rather than silently fixing or ignoring it, since fixing it would touch a file outside
  this spec's scope.
- **Slow network / API timeout:** not applicable — no network calls are part of this feature.
- **User who skips optional steps:** not applicable — there are no steps or forms in this feature.

## 10. Out of Scope

Explicitly excluded from this feature, per the CEO brief:

- **The homepage redesign.** This work remains frozen pending Arun's separate go-ahead. This feature does
  not design, stub, reserve space for, or hint at a replacement pricing section.
- **Any change to `Hero()` beyond the already-applied `href` fix** — no copy, layout, or other prop
  changes. Specifically, the "AI Readiness Platform" badge in the hero (separately flagged elsewhere as
  leftover B2C copy) is not touched by this feature.
- **`ProblemSection()`, `HowItWorks()`, `Testimonials()`, `BottomCTA()`** — none of these are touched in
  any way.
- **`app/(marketing)/pricing/page.tsx`** — the standalone `/pricing` route is a separate file and is not
  in scope. (Tracked separately per B2B-14's pulled-out-of-scope items.)
- **`app/plan/` and `app/checkout/`** — separately tracked under B2B-14's finding #4 B2C-dashboard
  cleanup scope. Not touched here.
- **Any replacement pricing content, B2B-13 real pricing integration, or "coming soon" messaging** — Arun
  explicitly chose Option B (remove entirely), not Option A (relink) or Option C (replace with real
  B2B-13 pricing). No form of replacement content is in scope.
- **The pre-existing unused `Smartphone` import** — noted in this document's verification preamble as an
  unrelated pre-existing issue; not part of this feature's scope.
- **`MarketingNav.tsx` or any file other than `app/(marketing)/page.tsx`** — this is strictly a
  single-file change.

## 11. Open Questions

None. The Feature Brief specified the exact file, line ranges, call site, and import cleanup, and this
document's independent verification against the live source (full file read, targeted grep for every
identifier in question, and a repo-wide search for other references to `Pricing`) found no discrepancies
with any part of it. This spec is ready to route to Dev with Section 11 empty, as the Feature Brief
anticipated.

## 12. Dependencies

- **`app/partner-signup/page.tsx` must exist and be a working route** — confirmed already true (verified
  by this document and previously by B2B-12's spec). No new dependency introduced.
- **B2B-12 must already be merged/live** (fixes to `MarketingNav.tsx` and `BottomCTA()`'s `/onboarding`
  links) — confirmed already the case; this feature only touches the one remaining `/onboarding`
  reference on this page (the hero CTA) and the unrelated Pricing section.
- **No new packages, environment variables, database migrations, or API routes are required.** This is a
  pure deletion + one-line `href` change within a single existing file.
