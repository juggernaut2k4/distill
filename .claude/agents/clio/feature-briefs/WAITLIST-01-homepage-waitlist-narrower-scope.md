# Feature Brief: Homepage Waitlist (narrowed scope, replaces earlier WAITLIST-01 combined brief)
From: CEO (Arun, via Orchestrator dispatch)
To: Business Analyst Agent
Priority: P0
Date: 2026-09-05

## What Arun Said

Round 1 (verbatim): "remove all unwanted links like login or signup. admin should follow a
different url... instead create the home page so show waitlist and create a form to get the
details of interested candidates who like to purchase. waitlist form has to look good. ensure
when someone joins the waitlist, admin is notified in email, admin has a option in dashboard to
see the details of people who shown interested and registered to waitlist. admin can also delete
waitlist members." Fields confirmed: name + email is sufficient (Arun's direct "yes").

Round 2 (verbatim, narrowing scope after a conflict was surfaced and escalated): "this is for the
same audience but before we decide more on price point and signup feature i want to take a step
back and ensure the waitlist is fully functional so we can go to the market, find potential
buyers. then we will also work on how the seeding and funding and implementation works. then we
will discuss more on the price point what we need to charge the customers."

## The Problem Being Solved

Clio needs a functioning, presentable way to capture interested-buyer leads on the public
homepage *right now*, without committing to pricing or a paid signup/demo-passcode mechanism yet.
The $10 demo-passcode purchase flow that was originally bundled into this same backlog item is
explicitly deferred — Arun wants the waitlist live first, pricing and paid-signup mechanics come
later as separate decisions.

## What Success Looks Like

- A visitor lands on the homepage, sees a genuinely good-looking waitlist form (name + email),
  submits it, and gets a clear confirmation.
- Arun (hello.arunprakash83@gmail.com) gets an email the instant someone joins.
- Arun can open an admin page, see every waitlist entry (name, email, submitted-at), and delete
  any entry.
- The public nav no longer links to "Log in" — admin still reaches `/dashboard/admin` via
  `/sign-in` directly (unlinked, not removed/broken).
- The homepage has one clear, non-competing conversion story: the waitlist is what's advertised
  and pushed; `/partner-inquiry` is not deleted (do not delete without explicit approval — standing
  rule) but is demoted to a secondary, lower-emphasis path for a visitor who wants to talk to a
  human directly rather than join the list.

## Known Constraints

- Must not touch: any $10 Stripe demo-passcode flow, passcode generation/email, pricing/signup-fee
  mechanics. These are explicitly out of scope — log as a new, clearly-marked-not-started backlog
  item (`DEMO-PASSCODE-01`) instead of building any part of it.
- Must not delete `/partner-inquiry` or its route/component — B2B-80 was a real, approved,
  already-live spec; this brief only changes its prominence on the homepage, not its existence.
- Only approved libraries already in this codebase for these exact purposes: Resend (email),
  Supabase (DB), Clerk (existing admin auth — do not build new auth).
- All API inputs Zod-validated. No hardcoded secrets. New env vars (if any) documented in
  `.env.local.example` with `PLACEHOLDER_` values.
- Responsive/mobile-friendly standing rule applies to every screen touched: homepage waitlist
  section + admin waitlist page. Fluid Tailwind + `clamp()`, no hardcoded pixel-width caps.
- Model the admin waitlist list/delete UI directly on the existing, approved
  `/dashboard/admin/sales-partner-leads` page pattern (`app/(with-clerk)/dashboard/admin/sales-partner-leads/`)
  — same visual conventions, same admin auth gating pattern. Reuse `lib/delivery/email.ts` (or
  its existing pattern) for the Resend notification rather than reinventing email sending.
- No end-user PII beyond name + email is collected or stored (standing privacy rule — this is a
  business lead, not an end_user identifier, so it does not fall under the stricter
  no-PII-persistence rule for `end_user`, but keep the field set minimal regardless: name + email
  only, nothing else, no scope creep).

## CEO Decision — `/partner-inquiry` vs. waitlist consolidation (resolved, do not reopen)

**Decision: the waitlist becomes the homepage's primary, only-advertised conversion point.
`/partner-inquiry` is not deleted and remains reachable, but only as a secondary, clearly
lower-emphasis path — not as a second competing top-level CTA.**

Concretely:
- `MarketingNav.tsx`: remove the "Log in" link. The "Get started" button in the nav now scrolls to
  (or links to, if the waitlist lives on its own page — BA to decide the mechanic, see Open
  Questions guidance below) the homepage waitlist section, replacing its current
  `/partner-inquiry` target.
- Homepage hero CTA and bottom CTA (`Hero`, `BottomCTA` — currently both link to
  `/partner-inquiry`): repoint to the waitlist section/form as the primary action.
- `/partner-inquiry` remains linked from exactly one clearly secondary spot — e.g., a small text
  link near or under the waitlist form such as "Want to talk to us directly instead?" — so a
  visitor who wants a real conversation right now still has a path, but it is visually and
  narratively subordinate to the waitlist.
- Rationale: Arun confirmed the audience is identical, and round 2's own framing is "get the
  waitlist fully functional so we can go to market and find potential buyers" — that is a
  volume/lead-capture motion, which the waitlist is purpose-built for; `/partner-inquiry`'s
  higher-touch direct-conversation flow is the right thing to keep for whoever wants it, but not
  what gets primary billing while pricing/signup mechanics are still undecided.

This resolves the ambiguity flagged in `BACKLOG.md`'s WAITLIST-01 entry. BA: do not leave this as
an open question — document the above mechanically (exact copy, exact placement) in your spec.

## Questions for BA

1. Waitlist form placement: a dedicated homepage section (like the existing PILLARS/STEPS/
   TESTIMONIALS sections) is the expected shape given "Get started" now needs an in-page anchor to
   scroll to — confirm and design that section fully (copy, layout, states: idle / submitting /
   success / error / duplicate-email error).
2. Duplicate-email handling: what does the admin/DB/API do if the same email joins twice? Define
   the exact behavior (recommend: unique constraint on email, friendly "you're already on the
   list" response, not a hard 500) — document it as your own decision, not left open.
3. Exact DB schema for the waitlist table, exact API route paths and shapes, exact admin page
   route path, exact Resend email template content (recommend modeling closely on however
   `sales-partner-leads` or another existing Resend notification is already structured in
   `lib/delivery/email.ts`).
4. Confirm nav/CTA mechanics precisely (anchor scroll vs. dedicated route) and write the exact
   before/after for `MarketingNav.tsx`, `Hero`, and `BottomCTA`.

Section 11 (Open Questions) in your Requirement Document must be empty. If something above still
feels ambiguous after your own investigation of the existing codebase patterns, resolve it
yourself and document the decision and rationale — you have the same authority I've delegated to
you that Arun delegated to me for this scope.
