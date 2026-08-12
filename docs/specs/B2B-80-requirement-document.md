# B2B-80 — Sales-Partner Acquisition: Retire Self-Serve, Add Contact-Us Lead Capture
# Requirement Document
Version: 1.0
Status: SPEC APPROVED (CEO, 2026-08-11) — Section 11 is empty, so this document has cleared the
CEO→BA→Dev gate on content. **Build is explicitly deferred, not scheduled**: Arun has said "we will
work on sales-partner onboarding later." Do not assign this to a developer agent until Arun says to
proceed. One thing for whoever eventually picks this up to re-confirm first, not just trust this
document's word for it: §6.2 has this brief editing two columns onto, and one hardcoded literal
inside, the already-shipped B2B-28 `direct_partner_invites` flow. The CEO independently verified the
cited line (`app/api/webhooks/clerk/route.ts`, the `direct_partner_invite` branch) and the
`createOrClaimPartnerAccount` signature directly against the live code on 2026-08-11 and confirmed
the change is additive and default-preserving as described — but re-verify against whatever state
that code is in by the time this is actually built, since B2B-78/79 dev work is landing in the
meantime and could touch adjacent files.
Author: Business Analyst Agent
Date: 2026-08-11

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-80-sales-partner-invite-only-contact-us-lead-capture.md`
Origin: `docs/specs/B2B-77-requirement-document.md` §6.5/§11 Q3 (superseded by this document — B2B-77 v1.2
closes its own Q3 by pointing here rather than respecifying this flow).
Prior art read in full: `.claude/agents/clio/feature-briefs/B2B-28-direct-partner-invite-only-and-sales-partner-revenue-visibility.md`,
`supabase/migrations/088_b2b28_direct_partner_invites_and_revenue_share.sql`,
`lib/internal-admin/direct-partner-invites.ts`, `app/api/webhooks/clerk/route.ts` (the
`signup_intent === 'direct_partner_invite'` branch, lines ~137–169), `app/api/admin/partner-invites/route.ts`,
`app/(with-clerk)/dashboard/admin/partner-invites/PartnerInvitesClient.tsx`, `lib/partner/signup.ts`
(`createOrClaimPartnerAccount`), `lib/partner/webhooks.ts` (`getPartnerAdminEmails` — the email-notification
pattern this document's admin alert mirrors).

---

## 0. Headline finding — the invite mechanism this brief needs already exists for the wrong account kind, one hardcoded line away from working for both

`direct_partner_invites` (B2B-28) is not just structurally similar to what a sales-partner invite needs —
it is **the identical mechanism**, with exactly one hardcoded value standing between it and working for
both account kinds. Confirmed by reading `app/api/webhooks/clerk/route.ts` line 157 directly:
```ts
const result = await createOrClaimPartnerAccount(id, UNNAMED_PARTNER_PLACEHOLDER, primaryEmail, 'partner')
```
The 4th argument — `accountKind` — is the *only* place `'partner'` is hardcoded in this entire accept
flow. `createOrClaimPartnerAccount` itself already accepts either `'partner'` or `'channel_partner'`
(confirmed, `lib/partner/signup.ts`'s own `ClaimResult` type); the accept route's response already returns
`result.accountKind` generically, not a hardcoded value (`app/api/partner-invite/accept/route.ts`); the
webhook branch's own lookup/accept bookkeeping (`lookupDirectPartnerInviteByToken`,
`markDirectPartnerInviteAccepted`) has no `account_kind` awareness anywhere. This resolves Brief §6 Q3
decisively: **generalize `direct_partner_invites` in place, do not build a parallel
`sales_partner_invites` table.** The alternative — a second table, a second accept route, a second admin
management page — would duplicate a mechanism that is already, structurally, one column away from serving
both purposes, for no benefit beyond avoiding a single additive migration.

---

## 1. Purpose

B2B-28 retired self-serve signup for direct partners. It never touched sales-partner signup, which has
been fully self-serve and unconditional since B2B-26 — anyone completing `/partner-signup` today becomes
a live sales-partner account immediately, with no review of any kind. Arun has now decided the same
posture should apply to sales-partners, with one addition: unlike a direct-partner invite (which assumes
Clio already knows who it's inviting), sales-partner acquisition needs a front door for someone Clio
*doesn't* already know to say "we're interested" — without that submission itself creating an account.

**What failure looks like without this document:** either sales-partner signup stays open indefinitely
(the thing Arun explicitly asked to stop), or it's closed with no replacement, meaning Clio loses its only
inbound channel for new sales-partner interest and depends entirely on outbound effort to find them.

## 2. User Story

**Story 1 — A prospective sales-partner who hears about Clio and wants in**
As someone interested in reselling Clio,
I want to submit my interest with minimal friction — no account creation, no company vetting form,
So that I can express interest and let Clio's team decide whether and how to follow up.

**Story 2 — Admin (Arun / a future super-admin) reviewing inbound interest**
As the person deciding who becomes a sales-partner,
I want to see every submitted lead in one place, contact them however I choose, and — once I've decided
to proceed — generate a single-use invite link for them,
So that every new sales-partner account traces back to a deliberate decision, not a public form filling
itself in.

**Story 3 — That same admin, generating the invite**
As admin, once I've decided to invite someone,
I want the exact same single-use-link mechanism B2B-28 already gave me for direct partners, just producing
a sales-partner account instead,
So that I don't have to learn or maintain a second, parallel invite tool for a nearly identical job.

## 3. Trigger / Entry Point

- **`GET /partner-inquiry`** — new, fully public page (no Clerk, no auth of any kind — this is the
  brief's C1 in its most literal form: a submission must not even require an account to *submit*, let
  alone create one). Replaces `/partner-signup` as the only public sales-partner-acquisition entry point.
- **`POST /api/partner-inquiry`** — form submission, public, unauthenticated, rate/abuse-guarded (§6.5).
- **`GET /dashboard/admin/sales-partner-leads`** — new, `requireSuperAdmin()`-gated admin list page.
- **`POST /api/admin/partner-invites`** — existing route (B2B-28), extended (not forked) to accept an
  optional `target_account_kind` and `source_lead_id` (§6.3).
- **`GET /partner-invite/accept?token=...`** — existing, unchanged route/page; its behavior now correctly
  branches on the invite row's own stored kind instead of always assuming `'partner'`.

## 4. Screen / Flow Description

### 4.A `/partner-inquiry` — the public form (replaces `/partner-signup`)

**Layout:** a single-screen public page, no Clerk `<SignUp/>` component anywhere on it (a deliberate,
structural difference from `/partner-signup`, not a copy change — this form must never touch Clerk, since
submitting it must never create any kind of account). Reuses the same dark-void card styling
`/partner-signup`'s own State 1 screen already established (per this codebase's "match existing precedent,
don't invent a new one" convention) — same `max-w-sm`, same card/input/button visual language — but is a
genuinely different component tree underneath (a plain form POSTing to a new API route, not a multi-step
Clerk-backed flow).

**Screen state 1 — form**
```
┌─────────────────────────────────────────────────┐
│  Clio                                            │
│                                                   │
│  Become a sales-partner                          │
│  Tell us a bit about you — we'll reach out.      │
│                                                   │
│  [ Your name                                 ]   │
│  [ Company name                              ]   │
│  [ Work email                                ]   │
│  [ Phone number (optional)                   ]   │
│  [ Anything else we should know? (optional)  ]   │
│                                                   │
│  [ PRIMARY BUTTON: "Submit" ]                    │
└─────────────────────────────────────────────────┘
```
Fields, exact: `name` (text, required), `company_name` (text, required), `email` (email, required,
format-validated), `phone` (text, optional — no format enforcement beyond a loose length cap, since
international phone formats vary too much to validate strictly and this is a manual-outreach aid, not a
delivery mechanism anything automated depends on), `message` (textarea, optional, max 1000 chars).
**Deliberately no `company_size`/`use_case` field** — nothing in Arun's own wording asked for it, and every
additional required field on a public lead-capture form measurably lowers completion rates for no stated
benefit here; if admin needs that context, it's a question for the manual follow-up call, not a form
field. This is a small, reversible scope-minimization judgment call, not a product-shape decision requiring
escalation.

**Screen state 2 — submitting**
Button shows a spinner, label changes to "Submitting…", disabled — standard loading-state discipline,
no new pattern.

**Screen state 3 — success**
```
┌─────────────────────────────────────────────────┐
│  Thanks — we'll be in touch.                     │
│                                                   │
│  We received your details and will reach out by  │
│  email, phone, or WhatsApp soon.                  │
└─────────────────────────────────────────────────┘
```
Form is replaced entirely by this confirmation (not shown alongside it) — matches this codebase's existing
post-submit convention on comparable one-shot forms.

**Screen state 4 — error** (network/server failure, not validation)
Inline banner above the form: *"Something went wrong submitting this. Please try again."* Form values are
preserved (not cleared) so the visitor doesn't have to retype everything.

**Screen state 5 — inline validation** (missing required field, malformed email)
Standard per-field inline error text below the offending input, submit disabled until resolved — no new
pattern beyond what `/partner-signup`'s own form already does today.

### 4.B `/dashboard/admin/sales-partner-leads` — new admin list, mirrors `PartnerInvitesClient.tsx`'s pattern

```
┌──────────────────────────────────────────────────────────────────┐
│  Clio                                    Sales-partner leads     │
│  ────────────────────────────────────────────────────────────── │
│  Name          Company       Email              Status  Actions │
│  ────────────────────────────────────────────────────────────── │
│  Priya Shah    ai-learn.com  priya@ailearn.com   New     [Mark contacted] [Invite] [Decline] │
│  Raj Mehta     eduwidgets.io raj@eduwidgets.io    Contacted  [Invite] [Decline]  │
│  Old Lead Co   —             old@lead.co          Declined  —          │
└──────────────────────────────────────────────────────────────────┘
```
Clicking a row expands (or navigates to a small detail view — BA's call, low-stakes UI-mechanics choice:
**recommend inline expansion, not a separate detail page**, since every field fits comfortably in an
expanded row and a lead has no sub-resources worth a dedicated URL, unlike a sales-partner account itself)
to show the optional `message` field and `phone`, since those don't fit the table's column width. "Mark
contacted" is a plain status update (`PATCH`), no confirmation. **"Invite"** opens a small inline form:
```
┌──────────────────────────────────────────────┐
│  Invite Priya Shah (ai-learn.com) as a        │
│  sales-partner                                │
│                                                │
│  [ Generate invite link ]                     │
└──────────────────────────────────────────────┘
```
Clicking "Generate invite link" calls the extended `POST /api/admin/partner-invites` with
`target_account_kind: 'channel_partner'`, `source_lead_id: <lead id>`, `label: "ai-learn.com (Priya Shah)"`
— then shows the plaintext accept URL exactly once, in the identical one-time-reveal pattern
`PartnerInvitesClient.tsx` already uses for direct-partner invites (visual reuse, not a new component).
The lead's own row status flips to `'invited'` automatically. "Decline" sets `status = 'declined'`, no
confirmation dialog (existing convention), and is reversible only by re-contacting the lead through the
same "Invite" action later (declining is a soft status, not a delete).

**`/dashboard/admin/partner-invites` (existing page, B2B-28) gets one small addition:** its existing
"Generate new invite" action gains a required selector — **Direct partner** or **Sales-partner** — since
an admin may also want to invite someone directly, without a prior lead row (e.g., a phone conversation
that never went through the form). This is the only visible change to that existing screen.

## 5. Visual Examples

All wireframes given inline in §4.A/§4.B above, per this project's standard.

## 6. Data Requirements

### 6.1 New table: `sales_partner_leads`

```sql
CREATE TABLE sales_partner_leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  company_name    TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'invited', 'declined')),
  submitted_ip    TEXT,   -- best-effort abuse-review signal only, never displayed in the admin UI (§6.5)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contacted_at    TIMESTAMPTZ,
  invite_id       UUID REFERENCES direct_partner_invites(id)  -- set when "Invite" is clicked (§6.3)
);
CREATE INDEX idx_sales_partner_leads_status ON sales_partner_leads(status, created_at DESC);
```
No RLS end-user-facing policy — same convention as every other internal-only table in this codebase
(service-role-only access; the public submission route uses the admin client server-side, never a
browser-authenticated Supabase client, since the submitter has no Supabase/Clerk session at all).

### 6.2 `direct_partner_invites` — generalized in place (Brief §6 Q3, resolved per §0)

**Two additive columns, no rename, no breaking change:**
```sql
ALTER TABLE direct_partner_invites
  ADD COLUMN target_account_kind TEXT NOT NULL DEFAULT 'partner'
    CHECK (target_account_kind IN ('partner', 'channel_partner'));
ALTER TABLE direct_partner_invites
  ADD COLUMN source_lead_id UUID REFERENCES sales_partner_leads(id);
```
`DEFAULT 'partner'` means every existing row and every existing call site that doesn't yet know about this
column keeps working byte-identically — this is the reasoning for not renaming the table (a rename would
touch every existing query in `lib/internal-admin/direct-partner-invites.ts` and both API routes for zero
functional gain over an additive column). **Table name stays `direct_partner_invites`** despite now
serving both kinds — a naming compromise flagged explicitly, not silently made: renaming to something
generic like `admin_partner_invites` would be more accurate but is real, avoidable diff on already-shipped,
working code; this document judges the accuracy cost of a slightly-stale name acceptable against the size
of an unforced rename, consistent with this project's general bias (seen repeatedly across B2B-26/28/34)
toward additive columns over renames when a rename buys no new behavior.

**Exactly one line of existing code changes**, per §0's finding — `app/api/webhooks/clerk/route.ts`'s
`direct_partner_invite` branch:
```ts
// Before:
const result = await createOrClaimPartnerAccount(id, UNNAMED_PARTNER_PLACEHOLDER, primaryEmail, 'partner')
// After:
const invite = await getDirectPartnerInviteTargetKind(inviteId) // new, small helper — one SELECT
const result = await createOrClaimPartnerAccount(id, UNNAMED_PARTNER_PLACEHOLDER, primaryEmail, invite.targetAccountKind)
```
Everything downstream (`markDirectPartnerInviteAccepted`, the accept route's response, the middleware
redirect target) is already generic — confirmed by direct read, not assumed (§0). `issueDirectPartnerInvite()`
(`lib/internal-admin/direct-partner-invites.ts`) gains one new optional parameter,
`targetAccountKind: 'partner' | 'channel_partner' = 'partner'` (default preserves the existing direct-partner
call site's behavior with zero change to its own call), plus `sourceLeadId?: string` to set the new column
and, on success, update `sales_partner_leads.status = 'invited'`/`invite_id` for that lead in the same
call.

### 6.3 `/partner-signup` retirement (Brief §6 Q4)

**Deleted outright, not repurposed.** Reasoning: `/partner-signup` is structurally a multi-step
Clerk-account-creation flow (`app/partner-signup/[[...partner-signup]]/page.tsx`, the `user.created`
webhook's `signup_intent === 'partner'` branch, `/api/partner-signup/claim`) — repurposing it into a
lead-capture form would mean either stripping out its Clerk integration entirely (at which point it isn't
"the same route repurposed," it's a full rewrite wearing the old route's clothes) or, worse, leaving Clerk
signup intact and hoping nothing downstream still creates an account from it — a real risk of exactly the
regression C1 forbids. A genuinely new, simple, Clerk-free route (`/partner-inquiry`, §4.A) is both safer
and less code than surgically gutting a Clerk-integrated flow down to a plain form.
**Concretely removed:** `app/partner-signup/[[...partner-signup]]/page.tsx` and its client component;
`app/api/partner-signup/claim/route.ts`; the `signup_intent === 'partner'` branch in
`app/api/webhooks/clerk/route.ts` (the *only* remaining self-serve creation path — B2B-28 already removed
the "No" branch that used to create direct partners here; this removes the sales-partner branch that was
B2B-28's leftover); `/partner-signup` from `middleware.ts`'s public-route matcher. **Kept, unaffected:**
the `direct_partner_invite` `signup_intent` branch (§6.2) and everything else in that webhook.

### 6.4 Admin notification on new submission (Brief §6 Q2)

**Both a list page and an email**, not one or the other. The list page (§4.B) is the system of record;
the email is what makes a new lead actually get seen promptly rather than discovered on the next
incidental dashboard visit. New function `sendNewSalesPartnerLeadEmail()` (Resend, mirroring
`sendLowBalanceAlertEmail()`'s existing shape and call pattern in `lib/partner/webhooks.ts`), sent to every
active super-admin email (`SELECT email FROM internal_admin_users WHERE role = 'super_admin' AND status =
'active'` — a new, small helper; no existing function returns exactly this set, `getPartnerAdminEmails()`
resolves *partner*-side admins, a different table entirely). Fired once per submission, from the
`POST /api/partner-inquiry` handler itself (no Inngest job needed — this is a single, synchronous,
low-volume send, not a batch or scheduled operation).

### 6.5 Abuse/spam handling (Brief §6 Q6) — in scope, lightweight, no new infra dependency

**In scope, deliberately minimal:** (a) a honeypot field (a visually-hidden input real visitors never
fill; any submission with it non-empty is silently dropped — 200 response, no row inserted — a
well-established, zero-infra-dependency spam mitigation), and (b) a simple duplicate-submission guard: `if
a row with the same email exists with created_at within the last 24 hours, reject with a friendly "we
already have your submission" message instead of inserting a duplicate`. **Deliberately not in scope: a
general-purpose rate limiter.** This is a low-volume, B2B lead form, not a high-traffic public endpoint —
introducing `@upstash/redis`-backed rate limiting here would mean making the "reusing it for rate limiting
is a separate, not-yet-made decision" call `lib/partner/rate-limit.ts`'s own standing comment (B2B-63)
explicitly deferred, and this brief is the wrong place to make that broader infra decision for an
unrelated, low-stakes form. If abuse becomes a real problem in practice, that is its own, separate,
evidence-driven follow-up, not something to over-build against here speculatively.

## 7. Success Criteria (Acceptance Tests)

✓ Given a visitor with no Clerk session, when they submit a complete `/partner-inquiry` form, then a
`sales_partner_leads` row is created with `status = 'new'`, and no `partner_accounts` or Clerk user is
created anywhere as a side effect.

✓ Given a new lead submission, when it completes successfully, then every active super-admin receives an
email, and the lead appears in `/dashboard/admin/sales-partner-leads` with status "New."

✓ Given a lead in `/dashboard/admin/sales-partner-leads`, when admin clicks "Invite," then a
`direct_partner_invites` row is created with `target_account_kind = 'channel_partner'` and
`source_lead_id` set to that lead, the lead's own `status` becomes `'invited'`, and the returned accept URL
— when visited and completed — produces a `partner_accounts` row with `account_kind = 'channel_partner'`,
not `'partner'`.

✓ Given an existing, already-shipped direct-partner invite generated before this brief ships, when it is
accepted after this brief ships, then it still produces `account_kind = 'partner'` (the `DEFAULT 'partner'`
column value applies retroactively to every pre-existing row) — zero regression to B2B-28's shipped flow.

✓ Given a visitor navigating to `/partner-signup` after this brief ships, when the page loads, then it
404s or redirects cleanly (BA recommends a clean 404, matching this codebase's `neutralNotFoundResponse()`
convention for retired routes, over a redirect to `/partner-inquiry` that might imply the two flows are
interchangeable when they are deliberately not — a 404 is honest about the fact the old flow no longer
exists at all).

✓ Given a submission with the honeypot field filled in, when it is submitted, then no
`sales_partner_leads` row is created and the visitor still sees the normal success confirmation (never
reveal the spam check to whoever's probing for it).

## 8. Error States

| Failure | Response |
|---|---|
| Missing/malformed required field | Inline per-field validation, submit disabled (§4.A state 5) |
| Duplicate submission within 24h (same email) | Friendly message: "We already have your submission and will be in touch." — not treated as an error the visitor needs to fix |
| Server/DB error on insert | Generic retry banner (§4.A state 4), form values preserved |
| Admin clicks "Invite" on an already-invited or declined lead | Button disabled once `status` is `'invited'` or `'declined'` — no duplicate invite issuance from the same lead row |
| Honeypot triggered | Silent success response, no row written (never signal the check exists) |

## 9. Edge Cases

- **The same person submits twice, more than 24 hours apart, before ever being contacted.** Both rows are
  kept (the duplicate guard is a 24-hour window, not a permanent one) — admin sees two "New" entries for
  the same email; this is treated as acceptable noise rather than something to auto-merge, since
  auto-merging risks silently dropping a genuinely renewed inquiry.
- **Admin declines a lead, then that same person re-submits the form later.** A brand-new row is created
  (no cross-reference to the declined one) — this document does not build lead-history linking across
  submissions; if that becomes valuable, it's a future, evidence-driven enhancement, not default-built here.
- **An in-flight direct-partner invite link (issued before this brief ships) is accepted after this brief
  ships.** Covered explicitly in §7's acceptance tests — the `DEFAULT 'partner'` column value guarantees no
  regression.
- **Someone tries to hit `POST /api/admin/partner-invites` with `target_account_kind: 'channel_partner'`
  but no `source_lead_id`** (admin generating a sales-partner invite for someone who never went through the
  form — e.g., a phone conversation). **Supported deliberately** — `source_lead_id` is optional precisely
  for this case; the "Direct partner / Sales-partner" selector on the existing `/dashboard/admin/partner-invites`
  page (§4.B) is the intended entry point for this scenario, not a workaround.

## 10. Out of Scope

- Any WhatsApp Business API, SMS gateway, or other new outbound-messaging vendor (Brief C2). Confirmed,
  restated explicitly here per the Feature Brief's own instruction: "reach them through email or phone or
  WhatsApp" describes Clio's own team using their own personal/business email client, phone, and WhatsApp
  app to manually follow up — it does not describe a product feature Clio builds. The `phone` field on the
  lead form exists so that manual outreach is *possible* (a human dialing or messaging a number by hand),
  not so Clio can send anything programmatically. No vendor from outside the approved list (`CLAUDE.md`) is
  introduced by this document, and none should be inferred from this brief by a future reader.
- Automated account creation of any kind from a lead submission (C1) — the only path from a lead to a
  live account is an admin's own deliberate "Invite" click.
- A general-purpose rate-limiting infrastructure decision (§6.5) — deliberately deferred as out of scope
  for this specific, low-volume form.
- Lead-history linking across multiple submissions from the same person (§9) — not built.
- Any change to already-existing sales-partner accounts, or to B2B-77/78/79's other resolutions (Brief C4).

## 11. Open Questions

None. Every question in the Feature Brief's §6 is resolved above with reasoning: Q1 (§4.A — full
wireframe-level form spec, exact field list with reasoning for what's excluded), Q2 (§6.4 — both a list
page and an email, specified concretely), Q3 (§0/§6.2 — generalize `direct_partner_invites` in place, not a
parallel table, with the exact one-line code change identified), Q4 (§6.3 — delete `/partner-signup`
outright, reasoning stated), Q5 (§10 — WhatsApp/phone vendor scope confirmed explicitly in this document's
own words, not just cited from the brief), Q6 (§6.5 — honeypot + duplicate-window guard in scope, general
rate limiting explicitly deferred with reasoning).

## 12. Dependencies

- B2B-28 (shipped) — this document extends its `direct_partner_invites` mechanism in place; does not fork
  or replace it.
- B2B-77 v1.2 §11 Q3 — this document is the full resolution that question points to; B2B-77 does not
  respecify any of this flow.
- The Resend integration (`lib/delivery/email.ts` / `lib/partner/webhooks.ts`'s existing email-send
  pattern) — reused unchanged for the new admin-notification email.
