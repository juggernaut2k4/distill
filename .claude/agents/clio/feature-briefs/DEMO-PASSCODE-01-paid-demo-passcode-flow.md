# Feature Brief: Paid ($10) Demo-Passcode Flow

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-09-05

## What Arun Said

"Waitlist email is fine but how will they request for the demo. Once they click, it asks for
payment, after payment a email will be send with the passcode. Then using the passcode they can
see the demo twice. Every time they use the passcode I need a log to show who used the passcode
and when."

This is `DEMO-PASSCODE-01` in `BACKLOG.md`, deliberately split out of `WAITLIST-01` (shipped) so
the waitlist could go live first. Full paragraph instruction and constraints are in
`BACKLOG.md`'s `DEMO-PASSCODE-01` entry — read that first.

## The Problem Being Solved

A visitor who is already convinced enough to pay wants proof, not another form. The waitlist
captures low-intent interest; this flow monetizes and gates high-intent interest — a real,
interactive look at Clio, sold for a small fee to filter for seriousness and cover the AI/infra
cost of running it, with hard usage limits so it can't be shared/abused, and full auditability
(who redeemed it, when) so Arun can see actual usage.

## What Success Looks Like

- A visitor can pay $10 without creating an account.
- They receive a passcode by email immediately, usable exactly twice, that never expires.
- They can redeem that passcode to have a real interactive session with Clio (not just read a
  static page — see Known Constraints below on what "the demo" means).
- Every redemption is logged with who and when, visible to Arun in the admin dashboard.
- Nothing about this competes with or degrades the just-shipped waitlist section.

## Known Constraints (binding — CEO-resolved, do not re-litigate in BA spec)

These are product-shape decisions I am making now, using my standing authority to resolve
ambiguity so Section 11 can be empty. Document them in the spec as decisions, with rationale,
per the "implement literally" principle — the BA should turn these into concrete UI/data specs,
not revisit whether they're the right call.

1. **What "see the demo" means.** I read `app/(demo)/demo/[slug]` and its tabs before writing
   this brief. That page's "Course Overview / Transcript / Visuals" tabs are already fully public
   with zero passcode gate — so a passcode that only unlocked those would be worthless. The only
   tabs actually gated today are "Meeting" (dispatches a bot into a Google Meet — not appropriate
   for a random public buyer, requires a Meet URL they'd have to create) and "Widget Demo" (an
   inline interactive AI voice session with Clio, opens full-screen, no Google Meet needed).
   **Decision: the $10 passcode grants access to the Widget Demo flow only**, on any one of the
   existing public demo topics (buyer's choice, same catalog at `/demo`). This is the one thing
   actually worth paying for and is self-contained. Do not build any new "watch a recording"
   page — reuse the existing Widget Demo mechanics.
2. **New passcode model, not the existing one.** `lib/demo/passcode-accounts.ts` /
   `demo_passcodes` (migration 100, B2B-39) is minutes-balance-based and rooted in
   `partner_accounts` — it exists to bill resellers/admin for internal demo-integration testing.
   A random public $10 buyer has no partner account and needs "exactly 2 uses, no expiry," not a
   minutes balance. **Decision: build a wholly separate, lightweight table/model for this flow**
   (own passcode generation/hash/resolve functions, own table) — do not extend or repurpose
   `demo_passcodes`. Reuse only the *shape* of that file's discipline (SHA-256 hash-at-rest,
   plaintext shown once, unambiguous alphabet) — mirror the pattern, not the table.
3. **Redemption UI: extend, don't rebuild.** The Widget Demo tab on `/demo/[slug]` already has a
   full flow: name input → voice select → passcode prompt → dispatch. **Decision: reuse this UI
   as-is for the public buyer** — do not build a separate redemption page. The widget-dispatch
   route (`app/api/demo/[slug]/widget-dispatch/route.ts`) currently resolves a passcode only via
   `resolveDemoPasscodeToAccount()` (the operator model). Extend it to also try the new public
   model when the operator model doesn't match, and branch behavior accordingly (see point 5).
   The name the buyer already types into that tab's existing "Name" field is sufficient identity
   capture for the usage log — do not add a redundant name/email re-entry field. Correlate it
   with the buyer's purchase email (already known server-side from the Stripe checkout) for the
   admin log, without prompting for email again at redemption.
4. **CTA placement.** Small, secondary presence near the just-shipped waitlist section on the
   homepage (`app/(with-clerk)/(marketing)/page.tsx`) — framed as "Already convinced? See the
   demo for $10" so it doesn't compete with the waitlist for primary attention. Explicit, visible
   "usable twice" callout must appear before the buyer pays — inline on this same
   section/component, not buried on a separate page or only in the post-payment email.
5. **No partner billing/minutes-consumption side effects.** The buyer already paid a flat $10
   regardless of session length — do not wire this into `demo_dispatches` /
   `consume_demo_minutes()` / any partner-account billing. When the widget-dispatch route
   resolves a passcode via the new public model, skip the existing duplicate-dispatch guard's
   partner-account-scoped lookup and any minutes billing entirely; only decrement the new
   passcode's own `uses_remaining` and log the redemption. Confirm/document the exact mechanics
   in the spec — this is a technical wiring decision the BA/dev should nail down precisely, but
   the "no minutes billing for this path" rule itself is fixed.
6. **Stripe:** new one-time $10 price/product (`mode: 'payment'`), separate from every existing
   wallet/subscription/test-block/demo-topup price. Test mode now; Arun flips to live mode
   himself later — do not hardcode anything that would block that switch (i.e. price ID must
   come from an env var, never inlined). Extend the existing
   `app/api/webhooks/stripe/route.ts` `checkout.session.completed` switch with a new
   `session.metadata?.purpose === 'public_demo_passcode'` branch, following that file's existing
   idempotency pattern (a ledger/record check before acting) — model it after the
   `test_block_purchase` branch's structure, but it does NOT write to `wallet_ledger` (that table
   is partner-account scoped; this buyer has none). Capture buyer email at the checkout step
   (Stripe Checkout's own email collection is sufficient — don't build a custom pre-payment
   email form) since it's needed to send the passcode email and for admin log correlation.
7. **Admin visibility:** a new section (your call on exact page — an existing admin index page
   addition or a small new page under `/dashboard/admin/` is fine either way) listing: each
   passcode issued (buyer email, purchase date, uses remaining/total), and the flat redemption
   log (who — the name typed at redemption, correlated to buyer email — and when, per
   redemption). Model the page pattern on the just-shipped `/dashboard/admin/waitlist` page
   (flat list, no bells and whistles) rather than inventing new visual language.

## Questions for BA

None — see Known Constraints above, all product-shape ambiguity is resolved. Your job is to turn
these into a complete, section-complete Requirement Document (schema, exact routes, exact zod
schemas, exact copy for the "usable twice" callout, exact email template content, exact admin
page layout in ≥3 lines of description per screen with a concrete wireframe/example, error
states, edge cases — e.g. buyer tries redeeming a 3rd time, webhook redelivery, buyer closes tab
mid-checkout, Stripe test-mode vs eventual live-mode price ID swap). Follow the existing spec
format used in `docs/specs/B2B-39-requirement-document.md` (12 numbered sections). Write it to
`docs/specs/DEMO-PASSCODE-01-requirement-document.md`. Section 11 (Open Questions) must be empty
when you're done — if you hit a genuine new ambiguity not covered above, resolve it yourself
using the "minimum viable, mirror existing patterns" principle and document the decision rather
than leaving it open, consistent with the CEO's delegated authority on this feature.

Standing constraints that apply regardless (from `CLAUDE.md`): approved libraries only (Stripe,
Resend, Supabase — all already in this codebase for exactly these purposes), all API inputs
Zod-validated, all webhook handlers signature-verified, no hardcoded secrets, responsive/
mobile-friendly standing rule applies to every screen touched or created (fluid Tailwind +
`clamp()`, no hardcoded pixel-width caps).
