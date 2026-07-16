# Feature Brief: B2B-12 — Homepage "Get Started" CTA Should Route to Partner Signup
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-16

## What Arun Said
From live testing on hello-clio.com: "getstarted button should take me to partner signup." Confirmed:
the homepage's "Get Started" CTA currently routes somewhere wrong — a pre-pivot B2C leftover pointing
at the old consumer onboarding flow. It needs to route to `/partner-signup` instead.

## Direct Verification (not a guess — read against current source)
`app/partner-signup/page.tsx` exists and is the correct B2B pivot destination.

Two buttons on the homepage carry the literal text "Get started" and both point at `/onboarding` (the
retired B2C consumer onboarding flow):

1. **`components/marketing/MarketingNav.tsx`, lines 51–59** — the persistent top-right nav CTA, present
   on every marketing page including the homepage (`MarketingNav` is imported and rendered by
   `app/(marketing)/page.tsx`):
   ```tsx
   <Link
     href="/onboarding"
     className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors"
   >
     Get started
     <ArrowRight size={14} />
   </Link>
   ```
   This is almost certainly the exact button Arun clicked — it is the only always-visible "Get started"
   control on the page. `components/onboarding/AlreadySignedInInterstitial.tsx` (line 10) independently
   confirms this is "the public 'Get Started' button" that lands users on `/onboarding` today.

2. **`app/(marketing)/page.tsx`, lines 553–558** — the bottom-of-page final CTA banner:
   ```tsx
   <Link href="/onboarding">
     <Button size="lg" className="gap-2">
       Get started — 15 seconds to set up
       <ArrowRight size={20} />
     </Button>
   </Link>
   ```

Both must change `href="/onboarding"` → `href="/partner-signup"`. No other prop, class, or copy on
either button changes.

## Checked thoroughly — other `/onboarding`-linked buttons on the same page (OUT OF SCOPE, flagged not silently dropped)
The rest of `app/(marketing)/page.tsx` still reads as retired B2C content end-to-end (consumer "AI
Readiness Score," Starter/Pro/Executive personal pricing tiers, SMS daily-insight copy, individual
executive testimonials) — which `CLAUDE.md` explicitly says should not exist post-pivot without an
explicit instruction to resurrect it. Two more buttons point at `/onboarding` but do **not** carry the
text "Get started," so they are not part of Arun's literal instruction and are NOT touched by this
brief:
- Hero primary CTA (line 62–67): "Start free — 3-day trial"
- Three pricing-tier CTAs (lines 378–411): "Get Starter" / "Get Pro" / "Get Executive"

Logging this in `BACKLOG.md` as a separate item: the entire homepage content (hero, pricing, testimonials)
appears to be un-migrated B2C copy and may need a full pivot rewrite — that is a product decision for
Arun, not something to fold into this one-line CTA fix.

## The Problem Being Solved
A partner (or prospective partner) clicking the homepage's "Get Started" button lands on the dead
consumer onboarding flow instead of the B2B partner signup flow — the entry point to the entire
post-pivot business is currently broken.

## What Success Looks Like
Clicking either "Get started" button on the homepage (nav bar, bottom CTA banner) navigates to
`/partner-signup`. No other homepage content, layout, or copy changes.

## Known Constraints
- Change `href` only, on exactly the two buttons identified above. Do not touch button styling, copy,
  or any other link on the page.
- Do not touch the hero CTA or the three pricing-tier CTAs — out of scope per above, logged separately.
- Do not resurrect or rewrite any other B2C surface as part of this fix.

## Questions for BA
None. Scope, files, exact line numbers, and old/new href are fully specified above. Section 11 (Open
Questions) should be empty — write the Requirement Document straight through and route to Dev.
