# Feature Brief: B2B-80 — Sales-Partner Acquisition: Retire Self-Serve, Add Contact-Us Lead Capture

From: CEO Agent (on behalf of Arun)
To: Business Analyst Agent
Priority: P1 — a real acquisition-flow change, but not blocking B2B-78/79's own build
Date: 2026-08-11
Status: **SPEC-WRITING ONLY.** This brief inherits the same "don't build it" instruction governing
the rest of this batch (B2B-77/78/79) unless Arun says otherwise. The BA's deliverable is a complete
Requirement Document. Nothing proceeds to a developer agent until Arun has approved it.

**Numbering note:** highest ID in use is B2B-79. This is B2B-80.

**Origin:** this brief exists because B2B-77's Section 11 Q3 asked whether "admin invites
sales-partners" (D10) meant reversing today's self-serve `/partner-signup` model. Arun's verbatim
answer, relayed via the Orchestrator: *"Yes change to invite only. if someone likes to enquire or
join, let them submit a contact us form and we will reach them through email or phone or
whatsapp."* That answer contains a real, new piece of product scope beyond a yes/no — a lead-capture
flow — which is why this is a separate brief rather than a paragraph inside B2B-77's Requirement
Document. B2B-77 v1.2 should close its own Q3 by stating the policy decision and pointing here, not
by trying to spec this flow inline.

---

## 1. What Arun Said

Verbatim, in full: *"Yes change to invite only. if someone likes to enquire or join, let them submit
a contact us form and we will reach them through email or phone or whatsapp."*

Read precisely, this is three coupled decisions, not one:
1. Self-serve sales-partner signup (`/partner-signup`, unconditional since B2B-28) is retired.
2. In its place: a public "contact us" form for anyone wanting to inquire about or become a
   sales-partner.
3. A submission does **not** create an account or send an automated invite. It generates a lead
   Clio's own team follows up on manually — by email, phone, or WhatsApp, at Arun's/his team's
   discretion, using whatever contact info the form captured.

## 2. The Problem Being Solved

B2B-28 already retired self-serve signup for **direct partners** in favor of an admin-invite model.
It never touched sales-partner signup, which has remained fully self-serve and unconditional since
B2B-26. Arun now wants the same posture applied to sales-partners — but, unlike direct-partner
invites (which assume Clio already knows who it's inviting), sales-partner acquisition today has no
front door for someone Clio doesn't already know to say "we're interested." This brief builds that
front door as a lead-capture mechanism, explicitly decoupled from account creation.

## 3. What Success Looks Like

- `/partner-signup`'s current behavior (anyone completing it becomes a `channel_partner`-kind
  account immediately) no longer exists.
- A public page exists where a prospective sales-partner can submit interest — enough information
  for a human to follow up, nothing more.
- Every submission is visible to Clio's internal team somewhere they'll actually see it (admin
  dashboard list at minimum; a notification mechanism is the BA's to specify — see Section 6).
- No code path anywhere turns a contact-us submission directly into a live sales-partner account.
  The only way a sales-partner account gets created is a real admin choosing to invite that person,
  same in spirit as B2B-28's existing direct-partner invite flow.

## 4. Known Constraints (binding — do not relax)

- **C1 — No automated account creation from a contact-us submission, ever.** This is the single
  most important constraint in this brief. A submission is a lead, not a signup.
- **C2 — "Email or phone or WhatsApp" describes Arun's own team's manual outreach channel choice,
  not a product integration.** My reading, stated as a resolved technical decision rather than an
  open question, since it's low-risk and easily reversible: the form captures a name, email, and
  phone number; Clio's team then reaches out however they choose, using their own email client,
  phone, or WhatsApp app — **this brief does not add a WhatsApp API/SDK or any new outbound-messaging
  vendor.** No such vendor is on this project's approved list (CLAUDE.md), and nothing in Arun's
  wording asks for automated WhatsApp messaging — only that phone number capture make manual
  WhatsApp outreach possible, which a plain phone number field already does. **The BA should confirm
  this reading explicitly in the Requirement Document rather than silently build to it** — if a
  developer read "reach them through WhatsApp" as a build requirement, that would mean adding an
  unapproved vendor for no stated reason, which is exactly the kind of scope-creep this project's
  library-approval gate exists to prevent.
- **C3 — This is an acquisition/lead-generation flow, not the invite mechanism itself.** Whatever
  happens after an admin decides to actually invite someone is a separate concern from the form
  itself — see Section 6 for what the BA must investigate about the invite side.
- **C4 — Existing sales-partner accounts and B2B-77's other resolutions are untouched.** This brief
  only affects how a *new* sales-partner account comes into existence going forward.

## 5. Prior Art the BA Must Read Before Designing

- `.claude/agents/clio/feature-briefs/B2B-28-direct-partner-invite-only-and-sales-partner-revenue-visibility.md`
  — the direct precedent for retiring self-serve signup in favor of invite-only, including whatever
  `direct_partner_invites` table/mechanism it built. B2B-77 v1.1 §6.5 already found that this
  existing invite table creates a **direct partner** (`account_kind = 'partner'`), not a
  sales-partner — confirm this directly and determine whether it's a generalizable mechanism (e.g.,
  parameterize the resulting `account_kind`) or whether a new, parallel `sales_partner_invites`-style
  table/flow is cleaner. This is a technical decision within BA/CEO discretion; make a call and state
  the reasoning, don't leave it to Dev to guess.
- `.claude/agents/clio/feature-briefs/B2B-26-sales-partner-entity-signup-clients-team.md` — the
  current, being-retired self-serve `/partner-signup` flow this brief replaces.
- `docs/specs/B2B-77-requirement-document.md` §6.5 and §11 Q3 — the exact research and reasoning that
  led to this brief existing; read it before re-deriving the same ground.
- Whatever existing admin-facing "list of leads/inquiries" pattern (if any) already exists in this
  codebase — check before assuming a new table/screen is needed from zero (e.g., is there anything
  resembling this in the demo/showcase or glitch-tracking admin surfaces already built?).

## 6. Questions for the BA to Resolve (Section 11 must be empty on delivery)

1. **Contact-us form: exact fields, page location, and public accessibility.** Full wireframe-level
   detail per this project's standing "ambiguous UX = STOP" rule — not a one-line bullet. At minimum
   specify: where it lives (a new public marketing-site page, or a variant of today's
   `/partner-signup` route repurposed for lead capture instead of account creation?), what fields it
   collects (name, company, email, phone — company size/use-case? optional message field?), and its
   post-submit confirmation state.
2. **Where a submission goes and how staff sees it.** Specify concretely: a new admin-dashboard list
   page (mirroring an existing admin list pattern if one exists), an email notification to admin
   addresses (reusing the existing Resend integration), or both. State the mechanism, not just "staff
   is notified."
3. **The invite-mechanism question from Section 5** — generalize `direct_partner_invites`, or build a
   parallel `sales_partner_invites`. Give a concrete schema and reasoning either way.
4. **What happens to `/partner-signup` itself.** Deleted outright, or redirected/repurposed into the
   new contact-us form? State which, and if repurposed, whether the URL changes.
5. **Confirm C2's WhatsApp reading explicitly** — state in the document that no WhatsApp vendor
   integration is in scope, and why, so this doesn't get silently reinterpreted as a build
   requirement later.
6. **Retention/spam handling for the leads table**, if a genuinely public, unauthenticated form is
   being built — at minimum note whether basic abuse protection (rate limiting, a honeypot field,
   etc.) is in scope for this brief or deliberately deferred, rather than leaving it unaddressed.

## 7. Explicitly Out of Scope

- Any WhatsApp Business API or other new outbound-messaging vendor integration (C2).
- Automated onboarding/account-creation triggered by a contact-us submission (C1).
- Changes to any already-existing sales-partner account or to B2B-77/78/79's other resolutions.

## 8. Sequencing Note for the Orchestrator

Independent of B2B-78/79's build — this only touches sales-partner *acquisition*, not the session
pipeline or domain infrastructure. Can be spec'd and built on its own timeline. B2B-77 v1.2 should
reference this brief by number when it closes its own Q3, rather than duplicating this content.
