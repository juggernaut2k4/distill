# Feature Brief: B2B-15 — Hero CTA Routing Fix + Removal of Dead B2C Pricing Section

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-16

## What Arun Said

From continued live testing on hello-clio.com, after B2B-12 shipped: Arun clicked the homepage hero
CTA ("Start free — 3-day trial") and it routed to `/onboarding` — the same retired B2C consumer flow
that B2B-12 fixed for the two literal "Get started" buttons. B2B-12's brief explicitly scoped the hero
CTA and the three pricing-tier CTAs out, tracking them as a separate backlog item (see
`.claude/agents/clio/feature-briefs/B2B-12-homepage-get-started-cta-partner-signup.md`, "Checked
thoroughly" section, and `docs/b2b-pivot-status.md`'s Live QA Findings §1/finding-3 discussion).

Arun then directly fixed the hero CTA himself in the working tree (`href="/onboarding"` →
`href="/partner-signup"` in `app/(marketing)/page.tsx`) and asked that this be formalized through the
proper CEO→BA→Dev governance chain retroactively — spec and everything — rather than staying as an
ungoverned direct edit outside the review chain this project runs on.

Separately, Arun was given three options for the three pricing-tier CTAs and the B2C pricing section
they live in:
- **A**: relink the 3 tier buttons to `/partner-signup` and leave the rest of the B2C pricing copy as-is
- **B**: remove the pricing section from the homepage entirely
- **C**: replace it with B2B-13's real Starter/Growth plan-tier pricing

Arun chose **B — remove the section entirely for now**, explicitly to avoid pulling forward into the
full homepage redesign that is still frozen pending his separate go-ahead (see
`docs/b2b-pivot-status.md`'s "Homepage redesign + competitor research" backlog entry, dated
2026-07-16, "Explicitly NOT started yet... wait for a separate 'go' signal").

## Direct Verification (not a guess — read against current source)

### Part 1 — Hero CTA fix (already applied, uncommitted)

`app/(marketing)/page.tsx`, inside `function Hero()`, line 62:

```tsx
<Link href="/partner-signup">
  <Button size="lg" className="gap-2">
    Start free — 3-day trial
    <ArrowRight size={20} /></...>
```

Confirmed via `git diff -- "app/(marketing)/page.tsx"`: this is the only change in the working tree
against the last commit, a single-line `href` swap from `/onboarding` to `/partner-signup`, matching
exactly the pattern B2B-12 used for the other two buttons (`href` only, no styling/copy/other-prop
changes). This is the correct destination — `app/partner-signup/page.tsx` exists and is the
established B2B pivot signup entry point (same verification B2B-12 already did).

**This part of the brief is a retroactive formalization of a fix Arun already applied**, not new work
for a developer to build. BA should document it in the Requirement Document as "already implemented,
verify against spec" rather than a fresh implementation task, and QA's Gate 1 (code review) should
confirm the live diff matches this brief exactly — no more, no less.

### Part 2 — Pricing section removal

`app/(marketing)/page.tsx` contains a self-contained `Pricing()` component:

- **Lines 359–527** (from the `// ─── Pricing ───...` section-header comment through the closing `}`
  of `function Pricing()`), including:
  - A local `plans` array (lines 366–415) hardcoding three B2C tiers — "Starter" ($12/mo, $99/yr),
    "Pro" ($25/mo, $199/yr), "Executive" ($49/mo, $399/yr) — with B2C-only feature lists ("Email + SMS
    daily insights," "AI Readiness Score," "Ask Anything SMS," "Dedicated phone number") and
    `href: '/onboarding'` on every tier's CTA (the "Get Starter" / "Get Pro" / "Get Executive" buttons
    B2B-12 explicitly excluded from its scope).
  - A local monthly/annual toggle (`const [annual, setAnnual] = useState(false)`, lines 362 and
    433–454) — this is **inline JSX within `Pricing()`, not a separate shared component**. It is not
    imported from `components/ui/` or anywhere else, and nothing else on the page or in the codebase
    references it. Safe to delete along with the rest of `Pricing()` — there is no shared toggle
    component to preserve.
  - The section wrapper (`<section id="pricing" ...>`) and all card-rendering JSX.
- **Line 575**: `<Pricing />` — the single call site, inside `LandingPage()`'s render tree:
  ```tsx
  <MarketingNav />
  <Hero />
  <ProblemSection />
  <HowItWorks />
  <Testimonials />
  <Pricing />       {/* ← delete this line */}
  <BottomCTA />
  ```

**Confirmed no other file references `Pricing`**: it is a local, non-exported function
(only `LandingPage` at the bottom of the same file is `export default`), so deletion is fully
contained to this one file.

**Import cleanup required after deletion** (checked against the rest of the file, not assumed):
- `CheckCircle` (imported line 8 from `lucide-react`) is used **only** inside `Pricing()` (line 506,
  the feature-list checkmarks). Once `Pricing()` is deleted, this import becomes unused and must be
  removed from the import statement.
- `useState` (imported line 4 from `react`) is used **only** inside `Pricing()` (line 362, the
  `annual` toggle state). Confirmed by checking every `useState(` call site in the file — the only one.
  Once `Pricing()` is deleted, this import becomes unused and must be removed.
- `useRef` (also imported line 4) is **NOT** safe to remove — it's independently used in
  `ProblemSection()` (line 159), `HowItWorks()` (line 223), and `Testimonials()` (line 293). Keep it.
- `Badge` (imported line 12 from `@/components/ui/Badge`) is **NOT** safe to remove — independently
  used in `Hero()` (line 47, "AI Readiness Platform" badge — itself flagged elsewhere as leftover B2C
  copy, but out of scope for this brief; do not touch `Hero()` beyond the already-applied CTA fix).
- `Card`, `Button`, `Link` — all used extensively elsewhere on the page. Keep.

Net result of Part 2: `app/(marketing)/page.tsx` shrinks by the `Pricing()` function block, the
`<Pricing />` render call, and the two now-unused imports (`CheckCircle`, `useState`). Nothing else on
the page changes.

## The Problem Being Solved

1. **Hero CTA (Part 1)**: the primary, most prominent CTA on the homepage ("Start free — 3-day trial")
   was sending prospective partners to a dead consumer signup flow — the same class of bug B2B-12
   fixed for the two "Get started" buttons, just missed because it didn't share the literal button text
   B2B-12's brief matched on.
2. **Pricing section (Part 2)**: the homepage was showing fabricated, actively-wrong B2C
   subscription pricing (individual $12–49/month consumer tiers with SMS/AI-Readiness-Score features)
   to what should be a B2B/partner audience. This isn't just mis-linked buttons — the entire section's
   content (tier names, prices, features) has no relationship to the real B2B product B2B-13 shipped
   (Starter/Growth plan tiers, wallet top-ups, partner-account billing). Leaving it live actively
   misleads visitors about what they're signing up for.

## What Success Looks Like

- The homepage hero CTA ("Start free — 3-day trial") navigates to `/partner-signup`. (Already true in
  the working tree — this brief formalizes and verifies it.)
- The pricing section (tier cards, monthly/annual toggle, "Simple, transparent pricing" heading) no
  longer renders anywhere on the homepage.
- The page flows directly from Testimonials to the Bottom CTA banner with no pricing section between
  them. This leaves a visual gap where pricing used to sit — **this is an expected, accepted
  consequence of Arun's Option B choice, not a defect to silently patch with placeholder content or a
  stub pricing block.** Do not add any replacement content, spacer copy, or "coming soon" messaging in
  its place.
- No other homepage section (Hero copy/layout beyond the CTA href, Problem section, How It Works,
  Testimonials, Bottom CTA banner) changes in any way.
- `tsc --noEmit` and `npm run build` remain clean after the import cleanup.

## Known Constraints

- This is explicitly **not** the homepage redesign. That work is frozen, awaiting Arun's separate
  go-ahead per `docs/b2b-pivot-status.md`'s standing "Homepage redesign + competitor research" backlog
  item. This brief does not design, stub, or reserve space for a replacement pricing section — it only
  removes clearly-wrong B2C content and fixes one routing bug.
- Do not touch `Hero()` beyond confirming the already-applied `href` fix — no copy, layout, or other
  prop changes, including the "AI Readiness Platform" badge (separately flagged B2C leftover copy, out
  of scope here).
- Do not touch `ProblemSection`, `HowItWorks`, `Testimonials`, or `BottomCTA`.
- Do not touch `app/(marketing)/pricing/page.tsx`, `app/plan/`, or `app/checkout/` — those are
  already tracked separately under B2B-14's "pulled out of scope" items and finding #4's B2C-dashboard
  cleanup scope in `docs/b2b-pivot-status.md`. This brief is strictly the homepage (`app/(marketing)/page.tsx`)
  pricing section and the one hero `href`.
- Preserve `useRef` and `Badge` imports (still used elsewhere in the file, verified above). Only remove
  `CheckCircle` and `useState` from the import statements.

## Questions for BA

None. File, exact line ranges, call site, and the two imports needing cleanup are fully specified
above, verified directly against the live source (not inferred). Section 11 (Open Questions) should be
empty — write the Requirement Document straight through and route to Dev. QA's Gate 1 should confirm
the hero CTA diff matches Part 1 exactly and that the Pricing section, its call site, and the two
now-dead imports are fully removed with no residual references.
