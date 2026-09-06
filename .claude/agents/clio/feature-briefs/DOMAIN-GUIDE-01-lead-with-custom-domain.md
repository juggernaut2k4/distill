# Feature Brief: Re-expose Domain setup, lead with custom domain, simplify DNS instructions
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-09-06

## What Arun Said
Arun wants a newly-invited partner's first real activity to be setting up their OWN domain, so
nothing ever renders under `hello-clio.com` for their end users. He explicitly prefers the
custom-domain path over the shared subdomain, and confirmed the direction in conversation: "i
understand the gap so lets fix it and make it easier for them to do this."

Two concrete asks, both already scoped and content-directed with Arun in the originating
conversation (Orchestrator drafted, Arun confirmed):

1. Re-expose the `domain` section in the Configurator (`lib/partner/configurator-sections.ts`'s
   `VISIBLE_SECTIONS`, currently `['integration', 'payment']` only), after confirming nothing else
   in the codebase assumes it stays hidden.
2. Rewrite `DomainConfigClient.tsx` so the custom-domain path is presented first and as the
   recommended path, with the shared subdomain repositioned as a secondary "get started instantly"
   fallback — and rewrite the custom-domain instructions to be genuinely beginner-friendly rather
   than a bare Type/Name/Value table with no explanation.

Content direction Arun already agreed to: explain what a CNAME record is in plain language and why
they're adding one; tell them to log into wherever they manage DNS, naming a few common examples
(GoDaddy, Namecheap, Cloudflare, Google Domains) without assuming which one they use; keep showing
the exact record (read live from `settings.custom_domain_verification`, never hardcoded) but wrap
it in explanation; reframe the "up to 48 hours" line as calm expectation-setting ("usually resolves
within a few minutes to a few hours — occasionally up to 48") and make clear "Recheck verification"
is how you check, not something that happens automatically on its own.

## The Problem Being Solved
Today, a partner has no visible way to set up any domain at all (the whole `domain` Configurator
section is hidden), and even when it's made visible, the underlying UI is written like an
engineer's DNS reference card, not guidance for someone who may have never touched a DNS panel.
The result: partners either don't set up a domain, or default to the shared `hello-clio.com`
subdomain, which puts our brand in front of their end users and defeats the white-label pitch. The
underlying data model, verification flow, and Vercel Domains integration are already correct and
live — this is a visibility + comprehension problem, not a missing-capability problem.

## What Success Looks Like
- A partner opening the Configurator sees "Domain" as a nav item and can reach the domain screen.
- On that screen, the custom-domain card appears first, visually framed as the recommended choice;
  the shared subdomain appears second, framed as an optional instant-start fallback.
- A partner with no DNS background can read the custom-domain card, understand in plain language
  what a CNAME record is and why they're adding one, find guidance pointing them to "wherever you
  manage DNS for your domain" (with GoDaddy/Namecheap/Cloudflare/Google Domains named as examples,
  not an assumed default), see the exact record to add (still pulled live from
  `settings.custom_domain_verification`), and understand that propagation is normally fast and that
  clicking "Recheck verification" is how they confirm it worked.
- All existing functional behavior (add/remove/recheck/try-a-different-domain, subdomain claim
  flow, the `none | pending_verification | verified | failed` state machine) continues to work
  exactly as before — this is copy/layout/ordering, not a logic rewrite.
- Screen remains responsive/mobile-friendly per the project's standing rule, matching the existing
  inline-`style` pattern used throughout this component (no Tailwind introduced here).
- `npx tsc --noEmit` clean.

## Known Constraints
- No backend/API route changes anticipated. `lib/partner/domain-settings.ts` and
  `lib/partner/vercel-domains.ts` must not change — if the BA spec concludes an API change is
  needed, that must be flagged explicitly with reasoning, not silently done.
- Do not touch the underlying `none | pending_verification | verified | failed` state machine —
  copy/layout/emphasis only around the existing `pending_verification` branch and its siblings.
- Must not silently decide whether `domain` joins `GO_LIVE_REQUIRED_STEPS` (currently
  `['integration', 'payment']`) — the BA spec must make an explicit, documented call either way.
  My steer: Arun's stated intent is that setting up a real domain is a genuine expected step for a
  partner going live, not a cosmetic nice-to-have — the BA should weigh this seriously against the
  risk of blocking Go-Live for partners happy on the shared subdomain, and document the reasoning
  either way (a partner can go live on the shared subdomain today with no domain at all; forcing
  domain into the required set would newly block that path for anyone who hasn't yet claimed a
  subdomain or added a custom domain).
- Component uses inline `style={{}}` objects, not Tailwind classes — match the existing pattern.
- Standing responsive/mobile rule applies since this screen is being touched regardless of reason.

## Questions for BA
1. Should `domain` be added to `GO_LIVE_REQUIRED_STEPS`, given the re-emphasis on custom domain as
   the recommended real step? Make an explicit call and document the reasoning (see steer above).
2. Confirm exact card ordering and visual treatment for "recommended" vs. "fallback" framing,
   consistent with the existing shared design primitives in `../_shared` (`Card`, `PrimaryButton`,
   `SecondaryButton`, `COLORS`) — do not invent new visual primitives.
3. Confirm final copy for: the CNAME explainer, the DNS-provider examples list, the propagation
   reassurance line, and the "Recheck verification is manual" clarification — write it out in full
   in the spec, not just described, so the Dev agent implements literally.
4. Confirm whether the "muted" (subdomain-not-set-yet) treatment of the custom-domain card needs to
   change now that custom domain leads — today `CustomDomainCard` is muted/disabled until a
   subdomain slug exists. Since custom domain is becoming the primary path, does a partner still
   need to claim a subdomain first before being able to add a custom domain, or should custom
   domain be addable independently? Decide and document — this affects both card ordering logic and
   whether the reordering is purely visual or also touches gating logic (constraint above still
   applies: no changes to `domain-settings.ts`/`vercel-domains.ts` server logic, but client-side
   gating logic in this component is fair game if the BA spec calls for and documents it explicitly).

All open questions above must be resolved and documented in the Requirement Document with no open
items left in Section 11 before development starts.
