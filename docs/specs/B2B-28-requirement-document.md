# B2B-28 — Direct-Partner Signup Becomes Invite-Only; Sales-Partner Revenue-Share Tracking & Super-Admin Visibility — Requirement Document
Version: 1.1
Status: APPROVED — cleared for Dev
Author: Business Analyst Agent
Date: 2026-07-19
Source brief: `.claude/agents/clio/feature-briefs/B2B-28-direct-partner-invite-only-and-sales-partner-revenue-visibility.md`

**Approval note:** CEO review of v1.1 independently re-verified §6.14's rename table by grepping the live
`TeamClient.tsx` (all six strings matched the "Before" column byte-for-byte) and confirmed the "After"
column is a correctly-scoped copy-only diff — no touch to `salesPartners*`/`handleSendInvite` state, the
`/api/admin/team/sales-partners*` route paths, or `internal_admin_users`/`sales_partner_assignments`/the
`role='sales_partner'` DB value. Every other point from the CEO's first-pass review (security
orthogonality, the `/partner-signup` diff, invite-token reuse, `revenue_share_percent` isolation and its
never-leaks-to-`/dashboard/channel-partner` guarantee, the Legal-agreement placeholder) was reconfirmed
unchanged and sound. Section 11 is empty, all 12 sections filled. Status set to APPROVED — this document
is cleared for Dev per this project's CEO→BA→Dev governance chain.

**Revision note (v1.1):** CEO review of v1.0 approved every section except §0's resolution of the
"Sales-partners" naming collision (B2B-21's internal-staff `TeamClient.tsx` panel vs. this brief's new
reseller-facing pages). v1.0 resolved it with a one-line disambiguating subtitle on the *new* page only.
CEO review found that insufficient: one-directional (no reciprocal pointer on `TeamClient.tsx` itself),
absent from the sidebar nav entirely (§6.12's nav label is a bare "Sales-partners" with no subtitle), and
moving the wrong direction on a problem Arun has already implicitly flagged by greenlighting the pending
B2B-21 `sales_partner`→`internal-staff` rename as a backlog item. Directed fix, accepted and applied in
this revision: rename `TeamClient.tsx`'s own user-visible copy (UI strings only — no schema, route, or
code-identifier change; `internal_admin_users`/`sales_partner_assignments` remain untouched per Known
Constraints) from "Sales-partners" to **"Internal sales staff"**, removing the collision at its source
instead of only disambiguating one side of it. §0, §4, §5, §6.14 (new), §7 (one new AT), and §12 updated
accordingly. No other section changed — the CEO's own review confirmed every other section sound
(security orthogonality, the `/partner-signup` diff, invite-token reuse, `revenue_share_percent`
isolation, the Legal-agreement placeholder) and none of that is re-litigated here.

**Numbering note:** this brief originally claimed B2B-27 simultaneously with a sibling brief
(`card-on-file-required-for-trial-access.md`). Per the Orchestrator's tie-break resolution (mtime order),
this brief renumbered to **B2B-28**; `docs/specs/B2B-27-requirement-document.md` belongs to the sibling
brief and is untouched by this document.

> Scope in one line: `/partner-signup` drops its Yes/No branch and always produces a sales-partner
> (`account_kind='channel_partner'`) account; a new `direct_partner_invites` table + `/partner-invite/accept`
> flow becomes the **only** way a new direct-partner (`account_kind='partner'`, `owning_channel_partner_id=NULL`)
> row is ever created; `partner_accounts.revenue_share_percent` is added (nullable, super-admin-only,
> meaningful only on `channel_partner`-kind rows); two new super-admin-only page trees
> (`/dashboard/admin/partner-invites`, `/dashboard/admin/sales-partners[/[id]]`) give Arun visibility and
> the editable revenue-share field. `lib/partner/auth.ts`, `getConfiguratorAccountsForClerkUser`, the
> `enforce_account_kind_invariants` trigger, and every `lib/internal-admin/*` file beyond importing the
> invite-token utility are untouched — confirmed by direct code read, not assumed.

Every code-level identifier this brief introduces was grepped against the live codebase before being
finalized (§0 below) — collision-free with one accepted, reasoned exception (`sales-partners` as a URL
segment, already used by B2B-21's unrelated internal-staff concept; see §0's own note).

---

## 0. Naming Convention (read first — governs every section below)

Per the CEO brief's naming table (recommended, not mandated — BA owns final naming) and its own
instruction to extend, not duplicate, B2B-26's `channel_partner` vocabulary:

| Concept | Code-level identifier (this brief) | User-visible copy |
|---|---|---|
| New table: super-admin-issued, single-use, direct-partner-creating invites | `direct_partner_invites` | "Invite link" |
| New public accept route | `app/partner-invite/accept`, `app/api/partner-invite/accept` | "You've been invited to set up a Clio partner account." |
| New Clerk `unsafe_metadata.signup_intent` value for this flow | `'direct_partner_invite'` (sibling to the existing `'partner'` value, never reused for it — see §6.4) | n/a |
| New super-admin invite-management page | `app/dashboard/admin/partner-invites` | "Partner invites" |
| New revenue-share column on `partner_accounts` | `revenue_share_percent` (nullable `NUMERIC(5,2)`, meaningful only where `account_kind='channel_partner'`) | "Sales-partner share" (input label: "Sales-partner share: __%" — locks the CEO brief's own recommended reading, §6.3) |
| New super-admin sales-partner list/detail pages | `app/dashboard/admin/sales-partners`, `app/dashboard/admin/sales-partners/[id]` | "Sales-partners" |
| New super-admin API routes | `app/api/admin/partner-invites`, `app/api/admin/partner-invites/[id]/revoke`, `app/api/admin/sales-partners`, `app/api/admin/sales-partners/[id]` | n/a |
| New lib file (super-admin side, invite lifecycle) | `lib/internal-admin/direct-partner-invites.ts` | n/a |

**Grep verification performed for this spec (not re-asserting the brief's own grep, doing my own):**

```
grep -rn "direct_partner_invites\|direct-partner-invite" --include="*.ts" --include="*.tsx" --include="*.sql" .
grep -rn "revenue_share_percent\|revenue-share" --include="*.ts" --include="*.tsx" --include="*.sql" .
grep -rn "partner-invites\|partner_invite" --include="*.ts" --include="*.tsx" --include="*.sql" .
```

All three return zero hits outside this brief's own new files — confirmed unclaimed.

**One real collision, found and resolved at its source (v1.1, per CEO direction — not escalated):**
`sales-partners` as a bare literal already exists in **both** code identifiers and user-visible copy for
a *different* concept — `app/api/admin/team/sales-partners/*` (B2B-21's routes, code-level, untouched —
see below) and `TeamClient.tsx`'s own "Sales-partners" panel heading, which lists Clio's **internal
staff** who are tagged to specific partner accounts — a completely different entity from this brief's
sales-partner (a reseller/channel company with its own `partner_accounts` row,
`account_kind='channel_partner'`). This is not a new collision this brief introduces — B2B-26 already
committed to the user-visible word "sales-partner" for the `channel_partner` concept (its own §0), so the
copy collision with B2B-21's "Sales-partners" panel already existed the moment B2B-26 shipped; this
brief's new pages just make it visible in more places (a second screen, and the shared sidebar nav).

**v1.0 resolution (superseded):** a one-line disambiguating subtitle on the new `/dashboard/admin/sales-partners`
page only. CEO review correctly identified this as insufficient — it's one-directional (nothing on
`TeamClient.tsx` itself points back), it doesn't reach the sidebar nav at all (§6.12's nav label is a bare
"Sales-partners" with no room for a subtitle), and it papers over a collision Arun has already implicitly
flagged as wrong by greenlighting the pending B2B-21 `sales_partner`→`internal-staff` rename as a backlog
item — adding a second, more prominent, nav-level surface using the same bare word for a different entity
moves the wrong direction on that.

**v1.1 resolution (current — removes the collision at its source):** rename `TeamClient.tsx`'s own
user-visible copy from "Sales-partners" to **"Internal sales staff"** — every rendered string in that
panel (heading, subtitle, form heading, loading/error/empty states), enumerated in full in §6.14. This is
a **UI-copy-only** change: zero impact to `internal_admin_users`, `sales_partner_assignments`,
`/api/admin/team/sales-partners/*`'s route path, or any TypeScript identifier/variable name in
`TeamClient.tsx` — all remain exactly as B2B-21 shipped them, matching Known Constraints' "do not touch
... `internal_admin_users` ... `sales_partner_assignments`" (schema/route/identifier-level, not
rendered-string-level). Once `TeamClient.tsx` no longer says "Sales-partners" anywhere, the new
`/dashboard/admin/sales-partners` page's own "Sales-partners" heading and sidebar nav entry (§6.12) are
genuinely unambiguous, not just locally disambiguated — the fix reaches both screens and the nav simultaneously
because it removes the second meaning of the word rather than annotating around it. The new page's own
subtitle (§4) is kept as a light, non-load-bearing reinforcement (still true and still useful context for
a first-time reader), but it is no longer the sole mechanism doing the disambiguation work.

---

## 1. Purpose

Today, `/partner-signup` (B2B-25, extended by B2B-26) lets any visitor answer "No" and become a
`account_kind='partner'` (direct partner) row with zero review — a fully self-serve, ungated path. Arun
has explicitly decided this is no longer acceptable: every direct-partner relationship should be one he
(or a future super-admin) deliberately initiates. Simultaneously, Clio has no mechanism today to record
what percentage of a sales-partner's revenue is informally owed to them (no wallet, no Stripe Connect —
just a number for Arun's own bookkeeping, per his own words: "we will not be paying anything for the
sales partner"), and no super-admin-facing page lists sales-partners as accounts to manage — B2B-26 built
the sales-partner's **own** dashboard, not a super-admin's view **of** sales-partners.

**Failure without this:** `/partner-signup` keeps producing direct partners with zero gatekeeping, which
Arun has now explicitly said he doesn't want; sales-partner revenue-sharing arrangements exist only in
Arun's head or an external spreadsheet; and super-admin has no dashboard-native way to see how many
sales-partners exist, who they are, or what's owed to them.

---

## 2. User Story

As Arun (super-admin),
I want `/partner-signup` to always create a sales-partner account, with direct partners onboarded only
through a link I generate and hand to them myself,
So that I never again get an unreviewed direct-partner relationship from a public form.

As Arun (super-admin),
I want to record a revenue-share percentage against each sales-partner, purely for my own reference,
So that I can track what I informally owe them without building a payments system I don't need yet.

As Arun (super-admin),
I want a list of every sales-partner with a detail page per one, showing their clients, team, and the
editable revenue-share field,
So that I have one place to see and manage the sales-partner roster instead of scattered records.

As a prospective direct partner who received an invite link from Arun,
I want to click the link, set up my company name, and sign up,
So that I can start using Clio without needing to answer a Yes/No question that no longer applies to me.

As a sales-partner (existing or new, self-serve via `/partner-signup`),
I want my own revenue-share percentage to never be visible anywhere in my own dashboard,
So that Clio's internal margin data about my own account stays Clio-internal, not shown back to me.

---

## 3. Trigger / Entry Point

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| E-1 | Visitor reaches `/partner-signup` | `GET /partner-signup` | None (public, unchanged route) | None |
| E-2 | Visitor completes State 1 (company name only, no toggle) | Client-side, unchanged mechanism minus the toggle | None | Company name entered |
| E-3 | Visitor completes Clerk `<SignUp>` | Existing State 2, `unsafeMetadata.signup_intent === 'partner'`, `forceRedirectUrl` now unconditionally `/dashboard/channel-partner` | Clerk-managed | Unchanged from B2B-26 |
| E-4 | Clerk fires `user.created` for a `/partner-signup` signup | `POST /api/webhooks/clerk` (existing branch, simplified) | svix signature (unchanged) | `unsafe_metadata.signup_intent === 'partner'` |
| E-5 | Already-signed-in visitor completes State 2b | `POST /api/partner-signup/claim` (existing route, simplified body) | Clerk session | Company name entered |
| E-6 | Super-admin generates a direct-partner invite link | `POST /api/admin/partner-invites` | Clerk session + `requireSuperAdmin` | On `/dashboard/admin/partner-invites`, "Generate" clicked |
| E-7 | Super-admin views/revokes invite links | `GET /api/admin/partner-invites`, `POST /api/admin/partner-invites/[id]/revoke` | Clerk session + `requireSuperAdmin` | On `/dashboard/admin/partner-invites` |
| E-8 | Invitee opens the invite link | `GET /partner-invite/accept?token=...` (new, public) | None (token-gated lookup) | Valid, unexpired, unused (`status='pending'`) token |
| E-9 | Invitee (signed out) submits company name and completes Clerk `<SignUp>` | Same page, new Clerk mount, `unsafeMetadata.signup_intent === 'direct_partner_invite'` | Clerk-managed | Valid token + company name |
| E-10 | Invitee (already signed in) submits company name | `POST /api/partner-invite/accept` | Clerk session | Valid token + company name |
| E-11 | Clerk fires `user.created` for a `/partner-invite/accept` signup | `POST /api/webhooks/clerk` (new branch) | svix signature | `unsafe_metadata.signup_intent === 'direct_partner_invite'` |
| E-12 | Super-admin views the sales-partner roster | `GET /dashboard/admin/sales-partners` → `GET /api/admin/sales-partners` | Clerk session + `requireSuperAdmin` | None |
| E-13 | Super-admin views/edits one sales-partner's detail | `GET /dashboard/admin/sales-partners/[id]` → `GET`/`PATCH /api/admin/sales-partners/[id]` | Clerk session + `requireSuperAdmin` | `id` refers to a `partner_accounts` row with `account_kind='channel_partner'` |

---

## 4. Screen / Flow Description

### `/partner-signup` — State 1 (MODIFIED — Yes/No toggle removed, reverts to B2B-25's single-field shape)

Identical to B2B-25's original State 1, i.e. B2B-26's State 1 **minus** the entire "Do you manage
multiple clients?" block (both toggle buttons, their label, and the `mt-5` wrapper `div`):

- Heading: `"Let's set up your Clio partner account"` (unchanged).
- Label `"Company name"`, text input, `placeholder="Acme Corp"`, `maxLength={200}` (unchanged).
- Inline validation error `"Company name is required."` on empty submit (unchanged).
- `"Continue"` button, same position/styling/disabled-state gating (unchanged).
- **Removed entirely:** the `managesMultipleClients` state variable, its default-`false` initialization,
  and the two-button toggle UI. Nothing replaces it — the screen is visually and behaviorally identical
  to B2B-25's original shipped State 1.

**Why removal, not a hidden/hardcoded field (BA Q1, resolved):** the CEO brief left the exact diff shape
open ("drop `manages_multiple_clients` from the metadata/body shape entirely vs. hardcode it `true` —
pick the smaller, clearer diff"). Resolved in favor of full removal, not hardcoding, for three concrete
reasons grounded in this codebase's own conventions:
1. A field permanently pinned to `true` forever after this brief ships is a landmine for the next
   engineer reading `unsafe_metadata` or the claim-route body and wondering whether some future caller
   might legitimately pass `false` — it never will, by design, and the field's own name
   (`manages_multiple_clients`) stops meaning anything once the question it represents no longer exists.
2. Removing it deletes strictly more code than hardcoding it (one fewer `useState`, one fewer schema
   field, two fewer ternaries, one fewer webhook read) — it is *also* the smaller diff once the whole
   call chain is counted, not just the page component.
3. Arun's own instruction #1 was "drop the question" — the more literal reading of "drop" is "the
   concept no longer exists," not "the concept always resolves to the same value forever."

Net effect: `/partner-signup`'s only path is now `signup_intent: 'partner'` → `account_kind='channel_partner'`,
unconditionally, at every one of the three write paths (webhook branch, claim route, `<SignUp>` props).

### `/partner-signup` — State 2 (MODIFIED — unconditional destination, no ternary)

```tsx
<SignUp
  forceRedirectUrl="/dashboard/channel-partner"
  unsafeMetadata={{
    signup_intent: 'partner',
    company_name: companyName.trim(),
  }}
  appearance={clerkAppearance}
/>
```

`manages_multiple_clients` is gone from `unsafeMetadata` entirely. Same accepted webhook-race behavior
as B2B-26 (§9 Edge Case 1 there, unchanged) — if the webhook hasn't landed by the time
`/dashboard/channel-partner` first renders, `<NoChannelPartnerAccount />` shows, resolved by a manual
refresh.

### `/partner-signup` — State 2b (MODIFIED — unconditional accountKind, simplified body)

```tsx
async function submitClaim() {
  setStep('claiming')
  try {
    const res = await fetch('/api/partner-signup/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: companyName.trim() }),
    })
    const data = await res.json()
    if (!res.ok) {
      setStep('claim-error')
      return
    }
    router.push(data.accountKind === 'channel_partner' ? '/dashboard/channel-partner' : '/dashboard/configurator')
  } catch {
    setStep('claim-error')
  }
}
```

**Non-regression, explicitly re-verified (per the brief's own flag, now more load-bearing than
before):** the redirect ternary is **kept**, even though a fresh claim on this route can now only ever
produce `accountKind: 'channel_partner'`. This is deliberate, not leftover dead code — it is the exact
mechanism that makes B2B-26 §9 Edge Case 2 continue to hold: an existing direct partner
(`account_kind='partner'`, created via a past self-serve signup or, going forward, via this brief's own
invite flow) who is still signed in and revisits `/partner-signup` must keep landing on
`/dashboard/configurator`, driven by `alreadyMember: true` returning their *real* `account_kind`, never
by what this page's now-toggle-less flow would otherwise imply. Per the brief's own words, this is now
**the only way** a signed-in visitor to `/partner-signup` ever reaches `/dashboard/configurator` at all
— removing the ternary here (leaving only `/dashboard/channel-partner`) would break that path outright.
This is the single line of B2B-26-era conditional logic that survives this brief's simplification pass,
and it survives because it protects a different codepath than the Yes/No toggle did.

### `/dashboard/channel-partner/*` — UNCHANGED

Zero changes to `/dashboard/channel-partner`, `/clients`, `/team`, or `/team-invite/accept` — all of
B2B-26's shipped sales-partner-facing dashboard is untouched by this brief. `revenue_share_percent` is
never fetched, rendered, or referenced anywhere in this route tree (§6.9, §7 AT-24/25).

### `/partner-invite/accept` — direct-partner invite acceptance (NEW, public)

New client component (`PartnerInviteAcceptClient.tsx`), structurally mirroring
`app/team-invite/accept/TeamInviteAcceptClient.tsx`'s state machine as closely as the different problem
shape allows — this flow creates a **brand-new account**, not a membership on an existing one, so it
needs a company-name-capture step `/team-invite/accept` never had. It reuses `/partner-signup` State 1's
capture UI verbatim as a sibling render branch (per the brief's own instruction), not a new design.

**State machine (BA Q2, resolved):**

1. **`loading`** — on mount, `GET /api/partner-invite/accept?token=...` validates the token
   (`status='pending'` AND unexpired). Same `Loader2` spinner / `"Loading invite…"` copy as
   `TeamInviteAcceptClient.tsx`.
2. **`invalid`** — token not found, already `accepted`, `revoked`, or expired. Copy:
   `"This invite link is no longer valid."` / `"Ask your Clio contact for a new link."` (parallels
   `TeamInviteAcceptClient.tsx`'s `"Ask the sales-partner to resend it."` line, adapted since there is no
   single obvious re-issuer to name here beyond "your Clio contact").
3. **`capture`** — token is valid. Renders `/partner-signup` State 1's exact company-name-capture card
   (heading `"Let's set up your Clio partner account"`, the same `"Company name"` input, same validation,
   same `"Continue"` button) — **no Yes/No toggle** (this flow only ever produces
   `account_kind='partner'`; the question doesn't apply here any more than it does on the now-simplified
   `/partner-signup`). Above the card, a one-line intro specific to this flow, matching the naming
   table's copy: `"You've been invited to set up a Clio partner account."` (`text-white text-lg font-semibold mb-4`,
   positioned above the card exactly where `/team-invite/accept`'s A1 heading sits).
4. **`signup`** (only if the visitor is signed out) — Clerk `<SignUp>` mounts:
   ```tsx
   <SignUp
     forceRedirectUrl="/dashboard/configurator"
     unsafeMetadata={{
       signup_intent: 'direct_partner_invite',
       company_name: companyName.trim(),
       direct_partner_invite_token: token,
     }}
     appearance={clerkAppearance}
   />
   ```
5. **`claiming` / `claim-error`** (only if the visitor is already signed in) — `POST /api/partner-invite/accept`
   with `{ token, companyName }` (§6.6). Same `"Setting up your account..."` / `"Something went wrong..."`
   + `"Try again"` UI as `/partner-signup` State 2b, verbatim.
6. **`already-member`** — a distinct terminal state (not `claim-error`): the signed-in visitor already
   administers a `partner_accounts` row (of either kind). See §6.6/§9 Edge Case 2 for why this must not
   silently redirect as if the invite worked. Copy: `"You already have a Clio account."` with a button
   `"Go to your dashboard →"` linking to `/dashboard` (the smart router, §6.9 of B2B-26, unchanged —
   resolves to the visitor's real destination).
7. Post-signup landing — unchanged Clerk mechanism, lands on `/dashboard/configurator` (State 4's
   `forceRedirectUrl`) or State 5's `router.push('/dashboard/configurator')` on success.

**Why no company-name/email pre-fill by super-admin (BA Q6-adjacent, resolved — the CEO's own flagged
escalation candidate, closed without needing to go back to him):** the brief's own recommended
`direct_partner_invites` schema carries only `label` (an internal note, "never shown to the invitee") —
no `company_name` or `target_email` column. This is not an oversight to escalate; it is the schema
itself already answering the question. The invitee always types their own company name at accept time,
exactly as every existing `/partner-signup` visitor does today. `label` exists solely so Arun can tell
his own generated links apart on the management page (e.g. "Pluralsight — Jan outreach"), never rendered
to the invitee.

### `/dashboard/admin/partner-invites` — super-admin invite management (NEW)

Super-admin-only (`requireSuperAdmin`, notFound() on failure — identical gating pattern to
`app/dashboard/admin/team/page.tsx`). Mirrors `TeamClient.tsx`'s "Sales-partners panel" interaction
pattern (generate/list/revoke, no confirm dialogs) but is its own component
(`PartnerInvitesClient.tsx`) — a different data shape (no partner-account tagging, no email recipient at
all) makes reusing `TeamClient.tsx` verbatim impossible; the *pattern*, not the code, is reused.

- Heading `"Partner invites"` (`text-white text-2xl font-bold`), subtitle
  `"Single-use links for onboarding a new direct partner. Each link works once."`
  (`text-[#94A3B8] text-sm`).
- `"+ Generate invite"` button, top-right (`bg-[#7C3AED]` primary button style, matches
  `TeamClient.tsx`'s `"+ Add"` / `"Invite"` buttons).
- Clicking it reveals an inline form (same reveal pattern as `TeamClient.tsx`'s invite form):
  - Label `"Label (optional, for your own reference — never shown to the invitee)"`, text input,
    `placeholder="Pluralsight — Jan outreach"`, optional, `maxLength={200}`.
  - `"Generate"` button (disabled while in-flight, inline spinner), `"Cancel"` closes without submitting.
- **On successful generation**, the form is replaced (not dismissed) by a one-time reveal panel — the
  exact "shown once, never persisted in plaintext" moment every other invite flow in this codebase
  has, adapted for the fact that there is no email recipient to send to:
  - Label `"Invite link (copy and share this yourself — it will not be shown again)"`.
  - A read-only text input containing the full `https://.../partner-invite/accept?token=...` URL,
    `bg-[#0A0A0A] border-[#333333]`, monospace (`font-mono text-xs`), full width.
  - A `"Copy"` button beside it (`navigator.clipboard.writeText`, no new dependency — this codebase's
    `clipboard`-adjacent behavior does not exist elsewhere yet, so this is a small, first, self-contained
    use of a browser-native API, not a new npm package). On click, button label flips to `"Copied!"` for
    1.5s (a plain `setTimeout`, no toast system exists to reuse, matching `TeamClient.tsx`'s own
    no-toast-system precedent).
  - A `"Done"` button closes the panel and reloads the list.
- Below: a table/list of every generated invite, most recent first, one row per `Card`:
  - Label (or `"—"` if none was set).
  - **Status badge — four states, not three** (per the CEO brief's own "What Success Looks Like" list:
    "pending/accepted/expired/revoked"): `pending` (amber), `accepted` (green), `expired` (muted gray,
    **computed at read time** from `status='pending' AND invite_token_expires_at < now()`, never a
    separate stored value — see §6.2's "BA Q on lazy-flip vs synthetic read" resolution below), `revoked`
    (muted gray, same tone as expired but distinguishable by the word itself — no confirm dialog on the
    action that produces it, matching this codebase's convention).
  - `"Generated {relative date}"` and, if accepted, `"Accepted {relative date}"`.
  - Generated-by: the super-admin's own email (resolved via the FK to `internal_admin_users`, §6.2 — no
    live Clerk lookup needed, unlike B2B-26's team-member email resolution, since this table stores the
    creator as an internal FK, not a bare Clerk id).
  - **One action, only on a truly-`pending` (not expired) row: `"Revoke"`** — no `"Resend"` action exists
    on this page (§ resolved below). No confirmation dialog (matches this codebase's convention).
- Empty state: `"No invite links generated yet."` (`COLORS.textMuted`), no illustration.

**Why "Revoke" only, no "Resend" (BA Q3, resolved — a real difference from the `TeamClient.tsx`/
team-invite precedent, not an oversight):** every other invite flow in this codebase (`TeamClient.tsx`'s
sales-partner invites, B2B-26's own team invites) has a known recipient email at issuance time, so
"Resend" means "mint a fresh token and re-send the same email." This flow has **no recipient at all** —
Arun's own words ("single-use link generated on demand") describe a link he shares himself, not an
automated email send. There is nothing to "resend" to. To get a fresh link for the same prospective
partner, the super-admin simply clicks `"Generate invite"` again — a new row, a new link, the same
minimal action either way. Building a "Resend" action here would mean either (a) silently reusing the
old row's `label` on a fresh token (a confusing implicit merge) or (b) inventing a recipient-email field
this brief's own data model deliberately doesn't have. Neither is worth the complexity for what
`"Generate"` already does in one click.

### `/dashboard/admin/sales-partners` — sales-partner roster (NEW)

Super-admin-only (`requireSuperAdmin`, `notFound()` on failure). New component (`SalesPartnersClient.tsx`)
reusing `PartnerBillingClient.tsx`'s sortable-table **visual pattern only** (column headers with
`ArrowUpDown` sort icons, `bg-[#111111] border-[#222222] rounded-xl overflow-hidden`,
`overflow-x-auto` table wrapper) — none of its billing-specific data or logic.

- Heading `"Sales-partners"` (`text-white text-2xl font-bold`).
- Subtitle (§0, light reinforcement — `TeamClient.tsx`'s own rename in §6.14 does the primary
  disambiguation work as of v1.1): `"Companies reselling Clio to their own clients — not Clio's internal
  sales staff (see Team & Access)."` (`text-[#94A3B8] text-sm`).
- Table columns: **Name**, **Clients** (count), **Team** (count), **Revenue share** (`"{N}%"` or `"—"`
  if unset), **Status** (Active/Suspended pill, same styling as `PartnerBillingClient.tsx`'s), **Signed
  up** (formatted `created_at`). Sortable on every column except Revenue share is sortable too (numeric,
  `null` sorts last regardless of direction — matches `PartnerBillingClient.tsx`'s own `balance_usd`-style
  numeric-sort precedent).
- Each row is a link (`<Link>`, not a raw `<tr>` click handler — keeps the row keyboard/screen-reader
  navigable for free) to `/dashboard/admin/sales-partners/[id]`.
- Loading / error / empty states mirror `PartnerBillingClient.tsx`'s exactly: `"Loading sales-partners…"`,
  `"Couldn't load sales-partner data. Try refreshing the page."`, `"No sales-partners yet."`.

### `/dashboard/admin/sales-partners/[id]` — sales-partner detail (NEW)

Super-admin-only. New component (`SalesPartnerDetailClient.tsx`). Server component
(`page.tsx`) resolves `id` server-side and 404s (`notFound()`) if no `partner_accounts` row with that id
and `account_kind='channel_partner'` exists — same defense-in-depth the API route also applies (§6.8).

- Back link `"← All sales-partners"` to `/dashboard/admin/sales-partners` (mirrors
  `PartnerBillingClient.tsx`'s `"← Back to Dashboard"` link styling).
- Heading: the sales-partner's name (`text-white text-2xl font-bold`), status pill beside it.
- Sub-line: `"Signed up {formatted created_at}"`.
- **Revenue-share card** (`Card`):
  - Heading `"Sales-partner share"`.
  - If unset: `"No revenue share set."` (`COLORS.textMuted`) plus an input.
  - Editable field: label `"Sales-partner share: __%"` (locks the CEO brief's own recommended reading —
    the sales-partner's own cut of revenue, §0/§6.3), a numeric input (`type="number"`, `min={0}`,
    `max={100}`, `step={0.01}`) pre-filled with the current value or empty, a `"Save"` button beside it
    (disabled while unchanged or in-flight, inline spinner on submit).
  - Inline validation error `"Enter a value between 0 and 100."` on out-of-range input (client-side
    `min`/`max` plus a server-side Zod re-check, §6.8).
  - Inline success flash `"Saved."` for 1.5s on success (matches the "Copied!" pattern above — no toast
    system).
  - Inline error `"Couldn't save. Try again."` on failure.
- **Clients card** (`Card`): heading `"Clients"`, a plain list reusing `listClientsForChannelPartner`'s
  exact return shape (name, company URL, status pill) — **zero new query logic**, this is a direct,
  unmodified reuse of the function B2B-26 already built. If empty: `"No clients yet."`.
- **Team card** (`Card`): heading `"Team"`, a count line `"{N} people ({activeCount} active, {pendingCount}
  pending)"` — reuses `listTeamAndInvites`'s exact return shape (B2B-26, `lib/partner/team-invites.ts`),
  no new query logic. No per-member breakdown here (that detail already lives on the sales-partner's own
  `/dashboard/channel-partner/team` page — this card is a glimpse, matching the Dashboard "Team glimpse"
  pattern's own precedent of showing a count, not a full roster, at this altitude).
- **Legal agreement card** (`Card`, forward-reference-only, non-functional): heading `"Legal agreement"`,
  body `"Agreement tracking is coming soon."` (`COLORS.textMuted, text-sm`) — no CTA, no link, matching
  the Dashboard's own `"Billing — coming soon"` card precedent for what an honest, non-misleading
  placeholder looks like (§10's explicit out-of-scope boundary — the sibling legal-agreement brief owns
  building this for real).

---

## 5. Visual Examples

### `/partner-signup` — State 1 (reverted to B2B-25's original shape)

```
┌─────────────────────────────────────────┐
│     ┌─────────────────────────────┐     │
│     │  Let's set up your Clio      │     │
│     │  partner account             │     │
│     │                               │     │
│     │  Company name                │     │
│     │  ┌─────────────────────────┐ │     │
│     │  │ Acme Corp                │ │     │
│     │  └─────────────────────────┘ │     │
│     │                               │     │
│     │  [       Continue       ]    │     │
│     └─────────────────────────────┘     │
└─────────────────────────────────────────┘
  No Yes/No toggle — byte-identical to B2B-25 State 1.
```

### `/partner-invite/accept` — capture state (signed out)

```
┌─────────────────────────────────────────┐
│     You've been invited to set up       │
│     a Clio partner account.              │
│                                           │
│     ┌─────────────────────────────┐     │
│     │  Let's set up your Clio      │     │
│     │  partner account             │     │
│     │                               │     │
│     │  Company name                │     │
│     │  ┌─────────────────────────┐ │     │
│     │  │ Contoso Learning          │ │     │
│     │  └─────────────────────────┘ │     │
│     │                               │     │
│     │  [       Continue       ]    │     │
│     └─────────────────────────────┘     │
└─────────────────────────────────────────┘
```

### `/partner-invite/accept` — invalid state

```
┌─────────────────────────────┐
│            CLIO              │
│                               │
│  This invite link is no      │
│  longer valid.                │
│  Ask your Clio contact for   │
│  a new link.                  │
└─────────────────────────────┘
```

### `/partner-invite/accept` — already-member state

```
┌─────────────────────────────┐
│            CLIO              │
│                               │
│  You already have a Clio     │
│  account.                     │
│                               │
│  [  Go to your dashboard →  ]│
└─────────────────────────────┘
```

### `/dashboard/admin/partner-invites` — link generated (one-time reveal)

```
┌───────────────────────────────────────────────────────────┐
│ Partner invites                        [ + Generate invite ]│
│ Single-use links for onboarding a new direct partner.       │
│ Each link works once.                                        │
├───────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────┐ │
│ │ Invite link (copy and share this yourself — it will     │ │
│ │ not be shown again)                                       │ │
│ │ ┌─────────────────────────────────────────────┐ [Copy] │ │
│ │ │ https://hello-clio.com/partner-invite/accept?  │       │ │
│ │ │ token=4f9a...                                   │       │ │
│ │ └─────────────────────────────────────────────┘         │ │
│ │                                            [ Done ]      │ │
│ └───────────────────────────────────────────────────────┘ │
│                                                               │
│ Pluralsight — Jan outreach          [pending]  Generated today │
│                                              by hello.arun@... [Revoke] │
│                                                               │
│ Contoso Learning                    [accepted] Generated 3d ago│
│                                              Accepted 1d ago     │
└───────────────────────────────────────────────────────────┘
```

### `/dashboard/admin/sales-partners` — roster list

```
┌───────────────────────────────────────────────────────────┐
│ Sales-partners                                                │
│ Companies reselling Clio to their own clients — not Clio's   │
│ internal sales staff (see Team & Access).                      │
├───────────────────────────────────────────────────────────┤
│ Name ↕  Clients ↕  Team ↕  Revenue share ↕  Status ↕  Signed up ↕│
│ Acme Reseller   3      4        15%          Active    Jul 19  │
│ ai-learn.com    1      1         —            Active    Jul 12  │
└───────────────────────────────────────────────────────────┘
```

### `/dashboard/admin/sales-partners/[id]` — detail

```
┌───────────────────────────────────────────────────────────┐
│ ← All sales-partners                                          │
│                                                               │
│ Acme Reseller                                       [Active] │
│ Signed up Jul 19, 2026                                        │
│                                                               │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Sales-partner share                                     │   │
│ │ Sales-partner share:  [ 15   ] %      [ Save ]          │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Clients                                                  │   │
│ │  Pluralsight — pluralsight.com                [active]  │   │
│ │  Acme University — acme-university.edu        [active]  │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Team                                                     │   │
│ │  4 people (3 active, 1 pending)                          │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Legal agreement                                          │   │
│ │  Agreement tracking is coming soon.                      │   │
│ └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

### 6.1 Schema — new migration `supabase/migrations/087_b2b28_direct_partner_invites_and_revenue_share.sql`

Migration number confirmed: `086_b2b26_sales_partner_entity.sql` is the highest existing file (verified
by directory listing for this spec); `087` is next-free (BA Q6, resolved). File name uses `b2b28` (the
brief's corrected number) rather than `b2b27`, matching every prior migration's own convention of tagging
the file with the brief ID that actually produced it.

```sql
-- B2B-28 — Direct-partner invite-only signup + sales-partner revenue-share
-- tracking. See docs/specs/B2B-28-requirement-document.md §6.1 for rationale.

-- ─── direct_partner_invites ─────────────────────────────────────────────────
-- Super-admin-issued, single-use links that create a BRAND-NEW partner_accounts
-- row (account_kind='partner', owning_channel_partner_id=NULL) on acceptance —
-- unlike partner_team_invites (B2B-26), which adds a member to an EXISTING
-- account. Structurally closer to internal_admin_users' own embedded
-- invite_token_hash/expires_at/status shape (migration 084) than to
-- partner_team_invites, but deliberately its own table, not a reuse of
-- internal_admin_users (that table is B2B-21's own internal-staff identity
-- layer, explicitly out of scope to touch).
CREATE TABLE IF NOT EXISTS direct_partner_invites (
  id                                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label                             TEXT,  -- super-admin's own note; never shown to the invitee
  status                            TEXT NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending', 'accepted', 'revoked')),
  invite_token_hash                 TEXT NOT NULL,
  invite_token_expires_at           TIMESTAMPTZ NOT NULL,
  created_by_internal_admin_user_id UUID NOT NULL REFERENCES internal_admin_users(id),
  created_partner_account_id        UUID REFERENCES partner_accounts(id),  -- set on accept, NULL until then
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at                       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_partner_invites_token_hash
  ON direct_partner_invites(invite_token_hash);

CREATE INDEX IF NOT EXISTS idx_direct_partner_invites_status
  ON direct_partner_invites(status);

ALTER TABLE direct_partner_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on direct_partner_invites"
  ON direct_partner_invites FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE direct_partner_invites IS
  'B2B-28: super-admin-issued single-use links that create a new account_kind=partner partner_accounts row on acceptance. The ONLY write path for a new direct-partner row as of this migration — /partner-signup now always produces account_kind=channel_partner. See docs/specs/B2B-28-requirement-document.md.';

-- ─── partner_accounts.revenue_share_percent ─────────────────────────────────
-- Purely a stored reference number for Arun's own bookkeeping (Arun's own
-- words: "we will not be paying anything for the sales partner" — no payout
-- mechanism computes against this, in this brief or any named follow-on).
-- Meaningful only on a channel_partner-kind row (a sales-partner's own
-- account); NULL for every direct-partner row regardless of how it was
-- created (self-serve-era or invite-created — both 100% Clio revenue).
ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS revenue_share_percent NUMERIC(5,2)
    CHECK (revenue_share_percent IS NULL OR (revenue_share_percent >= 0 AND revenue_share_percent <= 100));

COMMENT ON COLUMN partner_accounts.revenue_share_percent IS
  'B2B-28: the sales-partner''s own share of revenue, 0-100, set/edited by super-admin only via /dashboard/admin/sales-partners/[id]. Meaningful only where account_kind=channel_partner (enforced by check_account_kind_invariants, extended below). Never a computed payout — reference data only.';

-- ─── extend the existing account_kind invariant trigger (B2B-26 §6.15) ─────
-- Defense-in-depth, same rationale as B2B-26's own trigger comment: this
-- brief adds a THIRD write path against partner_accounts (the invite-accept
-- flow) and a new column (revenue_share_percent) whose own semantic
-- constraint ("only meaningful on a channel_partner row") is enforced here
-- at the DB layer rather than left to every future write path to remember.
CREATE OR REPLACE FUNCTION check_account_kind_invariants()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_kind = 'channel_partner' AND NEW.owning_channel_partner_id IS NOT NULL THEN
    RAISE EXCEPTION 'A channel_partner-kind partner_accounts row cannot itself have an owning_channel_partner_id (no nested sales-partner chains)';
  END IF;

  IF NEW.owning_channel_partner_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM partner_accounts
      WHERE id = NEW.owning_channel_partner_id AND account_kind = 'channel_partner'
    ) THEN
      RAISE EXCEPTION 'owning_channel_partner_id must reference a partner_accounts row with account_kind = channel_partner';
    END IF;
  END IF;

  -- NEW (B2B-28) — revenue_share_percent is Clio-internal reference data
  -- about a sales-partner's OWN account; it must never be set on a
  -- direct-partner (account_kind='partner') row, regardless of write path.
  IF NEW.revenue_share_percent IS NOT NULL AND NEW.account_kind <> 'channel_partner' THEN
    RAISE EXCEPTION 'revenue_share_percent may only be set on a channel_partner-kind partner_accounts row';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-created (CREATE OR REPLACE on the function above already updates the
-- trigger's behavior; the trigger definition itself gains revenue_share_percent
-- to its watched-columns list so an UPDATE that only touches that column
-- still fires the check).
DROP TRIGGER IF EXISTS enforce_account_kind_invariants ON partner_accounts;
CREATE TRIGGER enforce_account_kind_invariants
  BEFORE INSERT OR UPDATE OF account_kind, owning_channel_partner_id, revenue_share_percent ON partner_accounts
  FOR EACH ROW EXECUTE PROCEDURE check_account_kind_invariants();
```

**Reused, not migrated:** every existing `partner_accounts` column, `partner_admin_users`,
`internal_admin_users`, `sales_partner_assignments`, `partner_team_invites` — no existing column,
policy, or constraint is dropped, renamed, or altered beyond the one additive column and the extended
trigger above.

**Deviation from the brief's illustrative schema, with reasoning:** the brief's own illustrative
`direct_partner_invites` shape used `created_by_clerk_user_id TEXT NOT NULL`. This spec instead uses
`created_by_internal_admin_user_id UUID NOT NULL REFERENCES internal_admin_users(id)` — a foreign key,
not a bare Clerk id string. This is a small, grounded finishing decision (BA Q6's "finalize the exact
column set"), not a deviation from any instruction: `sales_partner_assignments.assigned_by` (migration
084) already establishes this exact FK-to-`internal_admin_users` pattern for "which internal admin did
this," and using it here means listing an invite's creator (§4's "Generated by" line) is a plain SQL join
to `internal_admin_users.email`, not a live `clerkClient.users.getUser()` call on every list-page load —
strictly better, zero added complexity, fully consistent with an existing precedent in the same
migration family.

### 6.2 `lib/internal-admin/direct-partner-invites.ts` (NEW)

```ts
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateInviteToken, hashInviteToken, inviteExpiresAt } from '@/lib/internal-admin/invite-tokens'
// Reused verbatim — the third reuse of this generic, role-agnostic crypto
// utility (B2B-21's own team invites, B2B-26's partner_team_invites, now
// this). Zero role-specific logic to duplicate.

export interface DirectPartnerInviteRow {
  id: string
  label: string | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired'  // 'expired' is a computed read-time value, never stored (see below)
  invite_token_expires_at: string
  created_at: string
  accepted_at: string | null
  created_by_email: string
}

function computedStatus(row: { status: string; invite_token_expires_at: string }): DirectPartnerInviteRow['status'] {
  if (row.status === 'pending' && new Date(row.invite_token_expires_at) < new Date()) return 'expired'
  return row.status as DirectPartnerInviteRow['status']
}

/**
 * Lists every invite, most recent first, joined to the issuing super-admin's
 * email. 'expired' is computed at read time from status='pending' AND a
 * past invite_token_expires_at — the DB row itself keeps status='pending'
 * (a lazy read-time flip, not a stored one), matching the CEO brief's own
 * "What Success Looks Like" list of four visible states
 * (pending/accepted/expired/revoked) explicitly, unlike B2B-26's
 * partner_team_invites list (which hides expired rows entirely) — this page
 * is an audit/management surface, not a "what's actionable right now" list,
 * so expired rows stay visible with their own distinct status.
 */
export async function listDirectPartnerInvites(): Promise<DirectPartnerInviteRow[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('direct_partner_invites')
    .select('id, label, status, invite_token_expires_at, created_at, accepted_at, internal_admin_users(email)')
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => {
    const creator = Array.isArray(row.internal_admin_users) ? row.internal_admin_users[0] : row.internal_admin_users
    return {
      id: row.id as string,
      label: (row.label as string | null) ?? null,
      status: computedStatus(row as { status: string; invite_token_expires_at: string }),
      invite_token_expires_at: row.invite_token_expires_at as string,
      created_at: row.created_at as string,
      accepted_at: (row.accepted_at as string | null) ?? null,
      created_by_email: (creator as { email?: string } | null)?.email ?? '',
    }
  })
}

export async function issueDirectPartnerInvite(
  label: string | null,
  createdByInternalAdminUserId: string
): Promise<{ success: boolean; acceptUrl: string | null; error: string | null }> {
  const supabase = createSupabaseAdminClient()
  const { token, tokenHash } = generateInviteToken()
  const expiresAt = inviteExpiresAt()

  const { error } = await supabase.from('direct_partner_invites').insert({
    label,
    status: 'pending',
    invite_token_hash: tokenHash,
    invite_token_expires_at: expiresAt,
    created_by_internal_admin_user_id: createdByInternalAdminUserId,
  })

  if (error) {
    return { success: false, acceptUrl: null, error: error.message }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  return { success: true, acceptUrl: `${appUrl}/partner-invite/accept?token=${token}`, error: null }
}

/** Revoke — only a genuinely pending (not expired) row may be revoked. */
export async function revokeDirectPartnerInvite(inviteId: string): Promise<{ success: boolean; error: 'not_pending' | null }> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('direct_partner_invites')
    .select('status, invite_token_expires_at')
    .eq('id', inviteId)
    .maybeSingle()

  if (error || !data || computedStatus(data as { status: string; invite_token_expires_at: string }) !== 'pending') {
    return { success: false, error: 'not_pending' }
  }

  await supabase.from('direct_partner_invites').update({ status: 'revoked' }).eq('id', inviteId).eq('status', 'pending')
  return { success: true, error: null }
}

export interface InviteLookupResult {
  valid: boolean
  inviteId: string | null
}

/** Used by both the public GET lookup and the accept-time re-validation. */
export async function lookupDirectPartnerInviteByToken(token: string): Promise<InviteLookupResult> {
  const supabase = createSupabaseAdminClient()
  const tokenHash = hashInviteToken(token)
  const { data } = await supabase
    .from('direct_partner_invites')
    .select('id, status, invite_token_expires_at')
    .eq('invite_token_hash', tokenHash)
    .maybeSingle()

  if (!data || data.status !== 'pending' || new Date(data.invite_token_expires_at as string) < new Date()) {
    return { valid: false, inviteId: null }
  }
  return { valid: true, inviteId: data.id as string }
}

/**
 * Marks an invite accepted, guarded by a conditional UPDATE (WHERE
 * status='pending') so a rare concurrent-accept race can't double-consume
 * the same row. Called only AFTER createOrClaimPartnerAccount has already
 * succeeded (§6.6) — if this update affects zero rows (the race lost), the
 * partner account was still created successfully; only this table's own
 * bookkeeping fails to record which invite produced it. Logged, not
 * rolled back — matches this codebase's existing no-transactional-rollback
 * discipline (e.g. lib/partner/signup.ts's own orphaned-row handling).
 */
export async function markDirectPartnerInviteAccepted(inviteId: string, createdPartnerAccountId: string): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('direct_partner_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString(), created_partner_account_id: createdPartnerAccountId })
    .eq('id', inviteId)
    .eq('status', 'pending')
    .select('id')

  if (!data || data.length === 0) {
    console.error(`[direct-partner-invites] Invite ${inviteId} was already consumed by a concurrent request; account ${createdPartnerAccountId} was still created successfully.`)
  }
}
```

### 6.3 `app/api/admin/partner-invites/route.ts` (NEW) — GET list, POST issue

```ts
const IssueSchema = z.object({ label: z.string().trim().max(200).optional().nullable() })

export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const invites = await listDirectPartnerInvites()
  return NextResponse.json({ invites })
}

export async function POST(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  // ...Zod-validate body, call issueDirectPartnerInvite(label, admin.internalAdminUserId)
  // On success: 201 { acceptUrl }. On failure: 500 "Couldn't generate this invite. Try again."
}
```

### 6.4 `app/api/admin/partner-invites/[id]/revoke/route.ts` (NEW)

```ts
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const result = await revokeDirectPartnerInvite(params.id)
  if (!result.success) {
    return NextResponse.json({ error: 'This invite is no longer pending.' }, { status: 409 })
  }
  return NextResponse.json({ revoked: true })
}
```

### 6.5 `app/api/partner-invite/accept/route.ts` (NEW) — GET lookup, POST accept

```ts
const AcceptSchema = z.object({
  token: z.string().min(1),
  companyName: z.string().trim().min(1).max(200),
})

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  const { valid } = await lookupDirectPartnerInviteByToken(token)
  return NextResponse.json({ valid })
  // No companyName/email in the response — unlike /api/team-invite/accept's
  // GET, there is nothing pre-known about the invitee to show them (§4).
}

export async function POST(request: NextRequest) {
  const { userId } = clerkAuth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = AcceptSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const { valid, inviteId } = await lookupDirectPartnerInviteByToken(parsed.data.token)
  if (!valid || !inviteId) {
    return NextResponse.json({ error: 'This invite link is no longer valid.' }, { status: 422 })
  }

  const user = await currentUser()
  const primaryEmail = user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
  if (!primaryEmail) {
    return NextResponse.json({ success: false, error: 'Failed to set up your account.' }, { status: 500 })
  }

  const result = await createOrClaimPartnerAccount(userId, parsed.data.companyName, primaryEmail, 'partner')
  if (!result.success) {
    return NextResponse.json({ success: false, error: 'Failed to set up your account.' }, { status: 500 })
  }

  // §9 Edge Case — an already-member visitor: the invite must NOT be marked
  // accepted (no new account was created through it — it stays pending for
  // someone else to use), and the client must show the distinct
  // 'already-member' state, not a false "success."
  if (result.alreadyMember) {
    return NextResponse.json({ success: true, alreadyMember: true, accountKind: result.accountKind })
  }

  await markDirectPartnerInviteAccepted(inviteId, result.partnerAccountId as string)
  return NextResponse.json({ success: true, alreadyMember: false, accountKind: result.accountKind })
}
```

### 6.6 `lib/partner/signup.ts` — zero signature changes, third caller documented

`createOrClaimPartnerAccount(clerkUserId, companyName, email, accountKind)` already accepts an
`accountKind` parameter (added by B2B-26) — **no code change to this file is required.** Only its doc
comment is updated to reflect the third caller:

```ts
/**
 * ...
 * Called from three places (B2B-28 adds the third): the unsafeMetadata
 * branch in the `user.created` webhook (both the /partner-signup
 * signup_intent='partner' branch, always accountKind='channel_partner' as
 * of B2B-28, and the new signup_intent='direct_partner_invite' branch,
 * always accountKind='partner'), and the two authenticated claim routes
 * (/api/partner-signup/claim and, new in B2B-28, /api/partner-invite/accept).
 * ...
 */
```

**Non-regression, explicitly re-verified:** the `alreadyMember`-wins idempotency check (§4 above) is
untouched — this is the exact mechanism §6.5's `already-member` branch and B2B-26's own Edge Case 2 both
depend on.

### 6.7 `app/api/partner-signup/claim/route.ts` — simplified body (MODIFIED)

```ts
const ClaimSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  // managesMultipleClients REMOVED — see §4's diff-shape reasoning.
})

export async function POST(request: NextRequest) {
  // ...unchanged auth/email resolution...
  const result = await createOrClaimPartnerAccount(userId, parsed.data.companyName, primaryEmail, 'channel_partner')
  // accountKind is now a literal, not a ternary on a removed field.
  // ...unchanged error handling and response shape...
}
```

### 6.8 `app/api/webhooks/clerk/route.ts` — simplified existing branch + new branch (MODIFIED)

```ts
if (event.data.unsafe_metadata?.signup_intent === 'partner') {
  const companyName = /* unchanged trim/empty-check */
  if (!companyName) {
    /* unchanged hard-stop */
  } else {
    // accountKind is now a literal — manages_multiple_clients is no longer read at all.
    const result = await createOrClaimPartnerAccount(id, companyName, primaryEmail, 'channel_partner')
    /* unchanged error logging */
  }
  return NextResponse.json({ received: true })
}

// NEW (B2B-28) — sibling branch, mutually exclusive by signup_intent, exactly
// matching the existing 'partner' branch's own precedent for how a new
// signup_intent value gets its own branch (B2B-25's own comment: "Replaces
// the retired ... default (direct partner), never silently creates a
// sales-partner account from ambiguous input" — same discipline applied here).
if (event.data.unsafe_metadata?.signup_intent === 'direct_partner_invite') {
  const companyName = /* same trim/empty-check as the 'partner' branch */
  const token = typeof event.data.unsafe_metadata.direct_partner_invite_token === 'string'
    ? event.data.unsafe_metadata.direct_partner_invite_token
    : null

  if (!companyName || !token) {
    console.error('[clerk-webhook] direct_partner_invite signup_intent with missing company_name or token for', id)
    return NextResponse.json({ received: true })
  }

  const { valid, inviteId } = await lookupDirectPartnerInviteByToken(token)
  if (!valid || !inviteId) {
    // Extremely unlikely in practice (token was validated by the GET lookup
    // moments before signup began, 7-day expiry) — logged for manual
    // investigation, not surfaced to the user (the webhook has no user-facing
    // channel). The visitor sees the accepted, precedented NoPartnerAccounts-
    // style race placeholder on /dashboard/configurator, resolved the same
    // way every other webhook race in this codebase is (manual refresh).
    console.error(`[clerk-webhook] direct_partner_invite token no longer valid at webhook time for Clerk user ${id}`)
    return NextResponse.json({ received: true })
  }

  const result = await createOrClaimPartnerAccount(id, companyName, primaryEmail, 'partner')
  if (result.success && !result.alreadyMember) {
    await markDirectPartnerInviteAccepted(inviteId, result.partnerAccountId as string)
  }
  // alreadyMember here would mean the same Clerk user's OWN prior signup
  // already exists (re-triggering user.created is not a realistic Clerk
  // scenario, but the guard costs nothing and matches the POST route's own
  // handling for symmetry).
  if (!result.success) {
    console.error('[clerk-webhook] direct_partner_invite createOrClaimPartnerAccount failed:', result.error)
  }
  return NextResponse.json({ received: true })
}
```

### 6.9 `revenue_share_percent` — read/write surface (NEW, super-admin only)

```ts
// app/api/admin/sales-partners/route.ts — GET
export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  // SELECT id, name, status, created_at, revenue_share_percent FROM
  // partner_accounts WHERE account_kind = 'channel_partner', plus a
  // per-row client count (COUNT(*) FROM partner_accounts WHERE
  // owning_channel_partner_id = id) and team count (COUNT(*) FROM
  // partner_admin_users WHERE partner_account_id = id).
}

// app/api/admin/sales-partners/[id]/route.ts — GET, PATCH
const UpdateRevenueShareSchema = z.object({
  revenue_share_percent: z.number().min(0).max(100).nullable(),
})

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  // Load the partner_accounts row; 404 if not found OR account_kind !== 'channel_partner'
  // (defense-in-depth — this route only ever targets a sales-partner's own
  // account, never a direct-partner/client row, even though the DB trigger
  // would also reject a revenue_share_percent write on the wrong kind).
  // Then: listClientsForChannelPartner(id) [reused, zero new query logic],
  // listTeamAndInvites(id) [reused, zero new query logic].
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const parsed = UpdateRevenueShareSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

  // Re-verify account_kind === 'channel_partner' before the UPDATE (same
  // defense-in-depth as GET) — then UPDATE partner_accounts SET
  // revenue_share_percent = ... WHERE id = params.id. The DB trigger (§6.1)
  // is the final backstop if this check is ever bypassed.
}
```

**Enforcement statement for "a sales-partner never sees their own revenue-share %" (BA Q5, resolved —
the exact assertion the brief asked for):** `revenue_share_percent` is readable only through
`GET /api/admin/sales-partners` and `GET /api/admin/sales-partners/[id]`, both gated by
`requireSuperAdmin()` (`lib/internal-admin/auth.ts`). `requireSuperAdmin` resolves against
`internal_admin_users` — a table entirely disjoint from `partner_admin_users`/`partner_accounts`. A
sales-partner's own Clerk user has **zero rows** in `internal_admin_users` (that table is Clio's own
internal-staff identity layer, per migration 084's header comment) — `resolveInternalAdmin()` therefore
returns 403 `"You do not have internal admin access."` for that Clerk user regardless of which
`partner_accounts` row they administer. This is not a new check written for this field specifically; it
is the same chokepoint every other `/api/admin/*` super-admin route in this codebase already relies on
(`PartnerBillingClient.tsx`'s own route, `TeamClient.tsx`'s routes). The secondary, structural
enforcement is that no file under `/dashboard/channel-partner/*` or `/api/channel-partner/*` ever
references the column at all (source-grep-verifiable, §7 AT-24/25) — so even if the super-admin gate were
somehow bypassed, there is no code path that would render the value into a sales-partner-facing screen.

### 6.10 Reads (summary, no new reads beyond what's listed above)

- `listClientsForChannelPartner` (`lib/partner/clients.ts`) — reused unmodified, zero new query logic
  (§4 detail page, §6.9).
- `listTeamAndInvites` (`lib/partner/team-invites.ts`) — reused unmodified, zero new query logic (§4
  detail page, §6.9).
- `generateInviteToken`/`hashInviteToken`/`inviteExpiresAt` (`lib/internal-admin/invite-tokens.ts`) —
  reused verbatim, the third reuse in this codebase (§6.2).
- `requireSuperAdmin` (`lib/internal-admin/auth.ts`) — reused unmodified, gates every new
  `/api/admin/partner-invites*` and `/api/admin/sales-partners*` route, and both new page components
  (mirrors `app/dashboard/admin/clients/page.tsx` and `app/dashboard/admin/team/page.tsx`'s own
  `currentUser()` → `requireSuperAdmin()` → `notFound()` pattern exactly).
- `createOrClaimPartnerAccount` (`lib/partner/signup.ts`) — reused unmodified, third caller (§6.6).
- **Confirmed completely untouched, verified by direct read for this spec** (per Known Constraints):
  `lib/partner/auth.ts` (`requirePartnerAdmin`, `requireChannelPartnerAdmin`, `requirePartnerApiKey`),
  `lib/partner/admin-accounts.ts`'s `getConfiguratorAccountsForClerkUser` and
  `getChannelPartnerAccountForClerkUser`, the `enforce_account_kind_invariants` trigger's own two
  pre-existing `RAISE EXCEPTION` clauses (only the new third clause and the trigger's watched-column list
  are added, §6.1), `internal_admin_users`, `sales_partner_assignments`, every file under
  `app/dashboard/channel-partner/*` and `app/api/channel-partner/*`.

### 6.11 localStorage / sessionStorage

None. `companyName` on `/partner-invite/accept` travels the same way it already does on
`/partner-signup` — plain client-component state, never persisted (matches B2B-25 §6.7's rule exactly).

### 6.12 `components/dashboard/DashboardShell.tsx` — two new nav entries (MODIFIED)

```ts
const NAV_ITEMS = [
  { href: '/dashboard/admin/clients', icon: Building2, label: 'Clients' },
  { href: '/dashboard/admin/templates', icon: LayoutTemplate, label: 'Templates' },
  { href: '/dashboard/admin/glitches', icon: Bug, label: 'Glitches' },
  { href: '/dashboard/admin/team', icon: Shield, label: 'Team' },
  { href: '/dashboard/admin/partner-invites', icon: Link2, label: 'Partner invites' },   // NEW
  { href: '/dashboard/admin/sales-partners', icon: Users, label: 'Sales-partners' },      // NEW
]
```

Both new items follow the exact "visible-but-404-on-click to a non-super-admin" pattern the file's own
comment already documents for `"Team"` — no per-item auth check exists in this client component; each
new page's own `requireSuperAdmin()` server-side gate is what actually enforces access. `Link2` and
`Users` are both existing `lucide-react` exports (no new icon dependency).

### 6.13 `middleware.ts` — one new public route (MODIFIED)

```ts
const isPublicRoute = createRouteMatcher([
  // ...unchanged entries...
  '/partner-invite/accept(.*)', // B2B-28: direct-partner invite acceptance — same pattern as /invite/accept and /team-invite/accept
])
```

### 6.14 `app/dashboard/admin/team/TeamClient.tsx` — UI-copy-only rename (MODIFIED, v1.1 — CEO-directed, §0)

Every user-visible string in the existing "Sales-partners" panel is renamed to **"Internal sales
staff"** (and grammatical variants). **String-literal diff only** — no change to the component's state
variable names (`salesPartners`, `salesPartnersLoading`, `salesPartnersError`, `loadSalesPartners`,
`handleSendInvite`, etc.), no change to any fetched route path
(`/api/admin/team/sales-partners`, `/api/admin/team/sales-partners/[id]`, `.../resend-invite` all stay
byte-identical), and no change to `internal_admin_users`/`sales_partner_assignments` schema or the
`role='sales_partner'` DB value itself — all explicitly frozen per Known Constraints. This is the same
class of change as a copy-only design-review fix, not a refactor.

| Line (approx., current file) | Before | After |
|---|---|---|
| Panel heading | `"Sales-partners"` | `"Internal sales staff"` |
| Page subtitle | `"Manage Clio super-admins and invite sales-partners scoped to specific partner accounts."` | `"Manage Clio super-admins and invite internal sales staff scoped to specific partner accounts."` |
| Invite form heading | `"Invite sales-partner"` | `"Invite internal sales staff"` |
| Loading state | `"Loading sales-partners…"` | `"Loading internal sales staff…"` |
| Error state | `"Couldn't load sales-partners. Try refreshing."` | `"Couldn't load internal sales staff. Try refreshing."` |
| Empty state | `"No sales-partners yet."` | `"No internal sales staff yet."` |

The panel's `"Invite"` button (icon + short label, no "sales-partner" text in it today) is unchanged —
listed for completeness, not because it needs to change. JSDoc/code comments referencing "sales-partner"
internally (e.g. this file's own header comment, `app/dashboard/admin/team/page.tsx`'s comment) are left
as-is — they are developer-facing, not user-visible, and renaming every internal comment across B2B-21's
codebase is out of scope for a copy-only UX fix; only rendered strings are in scope here.

**Why this, and not leaving `TeamClient.tsx` alone with only the new page's subtitle (§0):** a subtitle
on one screen cannot disambiguate a term a reader encounters on a *different* screen or in the shared
sidebar nav (§6.12) first. Renaming the source removes the second meaning of "Sales-partners" everywhere
at once — the nav item, the new list page, and the new detail page are all unambiguous the moment
`TeamClient.tsx` stops using the word for a different entity, with no reliance on the reader having seen
the disambiguating subtitle first.

---

## 7. Success Criteria (Acceptance Tests)

**`/partner-signup` simplification**

1. ✓ Given a visitor at `/partner-signup`, when the page loads, then no "Do you manage multiple clients?"
   question renders — the screen is visually identical to B2B-25's original State 1.
2. ✓ Given State 1 with a valid company name, when "Continue" is clicked and the visitor is signed out,
   then State 2's `<SignUp>` renders with `unsafeMetadata={{ signup_intent: 'partner', company_name: <name> }}`
   (no `manages_multiple_clients` key at all) and `forceRedirectUrl="/dashboard/channel-partner"`
   unconditionally.
3. ✓ Given that signup completes and Clerk fires `user.created`, when the webhook processes it, then a
   `partner_accounts` row is created with `account_kind='channel_partner'` — every completed
   `/partner-signup` signup produces a sales-partner account, no exceptions.
4. ✓ Given an already-signed-in visitor at `/partner-signup` submits a company name, when
   `POST /api/partner-signup/claim` succeeds, then the request body sent contains only `{ companyName }`
   and the response's `accountKind` is `'channel_partner'`.
5. ✓ Given a visitor who already administers a `partner_accounts` row (of either `account_kind`, still
   signed in) revisits `/partner-signup`, when State 2b's claim call resolves, then `alreadyMember: true`
   and the account's real, pre-existing `accountKind` are returned, and the browser navigates to
   `/dashboard/configurator` if that real kind is `'partner'` — non-regression, explicitly re-verified
   per §4's reasoning that this is now the *only* way a signed-in `/partner-signup` visitor ever reaches
   `/dashboard/configurator`.

**Direct-partner invite issuance & management**

6. ✓ Given a signed-in super-admin on `/dashboard/admin/partner-invites` clicks "Generate invite" with an
   optional label, when `POST /api/admin/partner-invites` succeeds, then a `direct_partner_invites` row
   is created (`status='pending'`, a fresh token hash, 7-day expiry, `created_by_internal_admin_user_id`
   set to the caller) and the response includes the full plaintext accept URL, shown exactly once in the
   UI.
7. ✓ Given a signed-in non-super-admin (a sales-partner, a direct partner, or a plain authenticated user
   with no `internal_admin_users` row) calls `POST /api/admin/partner-invites` directly, when the request
   resolves, then `requireSuperAdmin()` returns 403 and no row is created.
8. ✓ Given the super-admin reloads `/dashboard/admin/partner-invites`, when
   `GET /api/admin/partner-invites` resolves, then the list shows the new invite with status `pending`
   and no plaintext token anywhere in the response.
9. ✓ Given a `pending` invite's `invite_token_expires_at` has passed, when the list is loaded, then that
   row's computed status is `expired` (not `pending`) — confirming the lazy read-time flip, and that the
   underlying DB row's stored `status` column is unchanged (still `'pending'`).
10. ✓ Given a super-admin clicks "Revoke" on a genuinely-`pending` (not expired) invite, when
    `POST /api/admin/partner-invites/[id]/revoke` succeeds, then the row's `status` becomes `'revoked'`
    and it no longer shows a "Revoke" action on next load.
11. ✓ Given a super-admin attempts to revoke an already-`accepted`, already-`revoked`, or computed-`expired`
    invite, when the revoke route resolves, then it returns 409 and the row is unchanged.

**Direct-partner invite acceptance**

12. ✓ Given a valid, unexpired, `pending` invite token, when a visitor opens
    `GET /partner-invite/accept?token=...`, then the lookup returns `{ valid: true }` and the page renders
    the company-name-capture state with the copy "You've been invited to set up a Clio partner account."
13. ✓ Given an invalid, expired, already-accepted, or revoked token, when the same lookup runs, then it
    returns `{ valid: false }` and the page renders "This invite link is no longer valid."
14. ✓ Given a signed-out visitor with a valid token submits a company name, when Clerk's `<SignUp>`
    completes and `user.created` fires, then the webhook's new `direct_partner_invite` branch creates a
    `partner_accounts` row with `account_kind='partner'`, `owning_channel_partner_id=NULL`, and marks the
    `direct_partner_invites` row `status='accepted'`, `accepted_at` set, `created_partner_account_id`
    pointing at the new row.
15. ✓ Given an already-signed-in visitor (with zero existing `partner_accounts` memberships) submits a
    company name against a valid token, when `POST /api/partner-invite/accept` succeeds, then a new
    `account_kind='partner'` row is created, the invite is marked accepted, and the response's
    `alreadyMember` is `false`.
16. ✓ Given an already-signed-in visitor who **already administers** a `partner_accounts` row (of either
    kind) submits a company name against a valid, still-`pending` token, when the route resolves, then
    `alreadyMember: true` is returned, **no new account is created**, and the `direct_partner_invites`
    row is **left `pending`** (not consumed) — confirming the invite remains usable by its intended
    recipient. The client renders the distinct `already-member` state, not a false success.
17. ✓ Given the exact same invite token is presented a second time after a successful acceptance (E-14 or
    E-15 above), when the lookup runs, then it returns `{ valid: false }` — the link is dead after one
    successful use, confirming single-use semantics end-to-end.

**Revenue-share tracking**

18. ✓ Given a super-admin on a sales-partner's detail page enters `15` and clicks "Save," when
    `PATCH /api/admin/sales-partners/[id]` succeeds, then `partner_accounts.revenue_share_percent` for
    that row is `15.00` and the UI shows "Saved."
19. ✓ Given a super-admin enters a value outside 0–100, when "Save" is clicked, then a client-side
    validation error is shown and no request is sent; given the same out-of-range value is sent directly
    to the API (bypassing the client), then the server returns 422.
20. ✓ Given any write attempts to set `revenue_share_percent` to a non-null value on a `partner_accounts`
    row where `account_kind <> 'channel_partner'` (via any path — direct SQL, a hypothetical future API
    bug), when the statement executes, then `enforce_account_kind_invariants` raises an exception and the
    write is rejected (§6.1's extended trigger).
21. ✓ Given a fresh sales-partner signs up with no revenue-share value ever set, when their detail page
    loads, then `revenue_share_percent` is `null` and the UI shows "No revenue share set." — not an
    error, a normal expected state.

**Security orthogonality (explicit non-regression, per the brief's own instruction — not re-derived from
scratch, but asserted as concrete, testable statements)**

22. ✓ Given a `partner_accounts` row created via this brief's `/partner-invite/accept` flow
    (`account_kind='partner'`, `owning_channel_partner_id=NULL`), when its real admin calls
    `requirePartnerAdmin(partnerAccountId)` (`lib/partner/auth.ts`, unmodified by this brief), then it
    succeeds identically to a row created via B2B-25's original self-serve flow or B2B-26's "No" branch —
    confirmed by asserting the function's behavior is a pure function of `account_kind` and membership,
    never of which write path produced the row (source-level: this brief adds zero new callers or
    branches inside `requirePartnerAdmin` itself, §6.10).
23. ✓ Given the same new invite-created row, when its admin's account list is resolved via
    `getConfiguratorAccountsForClerkUser()` (`lib/partner/admin-accounts.ts`, unmodified by this brief),
    then the row is included (not filtered out) — confirming a `channel_partner`-only filter, unaffected
    by this brief, still correctly treats every `account_kind='partner'` row as Configurator-eligible
    regardless of provenance.
24. ✓ Given a signed-in sales-partner (`account_kind='channel_partner'`) navigates to any of
    `/dashboard/channel-partner`, `/dashboard/channel-partner/clients`, `/dashboard/channel-partner/team`,
    when each page renders, then `revenue_share_percent` does not appear anywhere in the rendered
    output or any network response those pages trigger (source-grep confirms zero references to
    `revenue_share_percent` in `app/dashboard/channel-partner/**` or `app/api/channel-partner/**`).
25. ✓ Given a sales-partner's own Clerk session calls `GET /api/admin/sales-partners/[id]` directly for
    their own account id, when the route resolves, then `requireSuperAdmin()` returns 403 — confirmed as
    the exact enforcement mechanism (§6.9's "Enforcement statement"), not merely a screen-content
    omission.
26. ✓ Given the `enforce_account_kind_invariants` trigger's two pre-existing clauses (nested-chain
    prevention, `owning_channel_partner_id` kind-matching, both from B2B-26), when a write exercises
    either one, then both continue to raise exactly as they did before this migration — confirmed by
    re-running B2B-26's own AT-9c against the post-B2B-28 trigger definition.

**Build / non-regression**

27. ✓ `npx tsc --noEmit` clean; `npm run build` passes; no unapproved packages introduced (`navigator.clipboard`
    is a browser-native API, not an npm dependency).
28. ✓ Given `lib/partner/auth.ts`, `lib/partner/admin-accounts.ts`'s `getConfiguratorAccountsForClerkUser`/
    `getChannelPartnerAccountForClerkUser`, the two pre-existing trigger clauses, `internal_admin_users`,
    `sales_partner_assignments`, and every file under `app/dashboard/channel-partner/*` and
    `app/api/channel-partner/*`, when this brief ships, then a diff check confirms none of them changed
    beyond the trigger's own additive third clause and watched-column list (§6.1) — matching this
    project's existing non-regression-check convention (B2B-21/25/26's own AT-22-equivalent).

**Naming collision resolution (v1.1, §0/§6.14)**

29. ✓ Given `app/dashboard/admin/team` renders, when the panel that previously read "Sales-partners"
    loads, then its heading reads "Internal sales staff" and every other string listed in §6.14's table
    (subtitle, invite-form heading, loading/error/empty states) matches the "After" column exactly —
    confirming the naming collision is resolved at its source, not merely annotated around on a single
    other screen.
30. ✓ Given `TeamClient.tsx`'s post-rename source, when diffed against its pre-B2B-28 shipped version,
    then the only changes are the string literals enumerated in §6.14 — every state variable name,
    `fetch()` URL (`/api/admin/team/sales-partners*`), and prop/type name is byte-identical, and
    `internal_admin_users`/`sales_partner_assignments` (schema and RLS) show zero diff — confirming this
    is a UI-copy-only change, not a refactor, per Known Constraints.

---

## 8. Error States

| Surface | Failure | Behavior |
|---|---|---|
| `/partner-signup` State 1 | Empty company name (unchanged from B2B-25) | Inline error, no advance |
| `POST /api/webhooks/clerk`, `signup_intent==='partner'` branch | `company_name` missing/empty | Unchanged from B2B-25/26 — logged, no account created, no user-facing surface (webhook has none) |
| `POST /api/partner-signup/claim` | `companyName` missing/empty | 422 Zod validation error |
| `POST /api/admin/partner-invites` | Non-super-admin caller | 401/403 via `requireSuperAdmin()` |
| `POST /api/admin/partner-invites` | Supabase insert fails | 500, inline error `"Couldn't generate this invite. Try again."` |
| `POST /api/admin/partner-invites/[id]/revoke` | Row not genuinely pending (accepted/revoked/expired) | 409, inline `"This invite is no longer pending."` |
| `GET /api/partner-invite/accept` (lookup) | Token not found, expired, accepted, or revoked | `{ valid: false }`, 200 (no-info-leak discipline, matches `/api/team-invite/accept`) — page shows "This invite link is no longer valid." |
| `POST /api/partner-invite/accept` | Token invalid at accept time (race with expiry/revoke between lookup and submit) | 422, page shows the invalid-link state |
| `POST /api/partner-invite/accept` | `companyName` missing/empty | 422 Zod validation error, inline error on the capture form |
| `POST /api/partner-invite/accept` | Signed-in visitor already administers a `partner_accounts` row | 200, `{ alreadyMember: true }` — **not an error**, a distinct terminal UI state (§4, §9) |
| `POST /api/partner-invite/accept` | No primary verified email on the Clerk user | 500, `"Failed to set up your account."` (matches `/api/partner-signup/claim`'s own copy) |
| `POST /api/webhooks/clerk`, `signup_intent==='direct_partner_invite'` branch | Token invalid at webhook time (extremely rare — see §6.8) | Logged server-side, no account created, `{ received: true }` returned to Clerk (200, no retry storm) |
| `PATCH /api/admin/sales-partners/[id]` | `revenue_share_percent` outside 0–100 | 422 Zod validation error, inline error `"Enter a value between 0 and 100."` |
| `PATCH /api/admin/sales-partners/[id]` | Target row is not `account_kind='channel_partner'` | 404 (defense-in-depth — this route only ever targets a sales-partner's own account) |
| `GET /api/admin/sales-partners`, `.../[id]` | Non-super-admin caller | 401/403 via `requireSuperAdmin()` |
| `GET /api/admin/sales-partners`, `.../[id]` | Network/server error | Inline `"Couldn't load sales-partner data. Try refreshing the page."` (matches `PartnerBillingClient.tsx`'s own copy convention) |

---

## 9. Edge Cases

1. **An already-member visitor uses a valid direct-partner invite link.** Resolved in-brief (§4, §6.5,
   §7 AT-16): the invite is left `pending` (not consumed), no duplicate/incorrect account is created, and
   the visitor sees a distinct `"You already have a Clio account."` state with a link to their real
   dashboard via the existing `/dashboard` smart router (B2B-26 §6.9, unchanged).
2. **Two different people race to accept the same invite link near-simultaneously.** Extremely unlikely
   given this is a single-use link Arun shares with one specific company, but handled: the DB-level
   conditional `UPDATE ... WHERE status='pending'` in `markDirectPartnerInviteAccepted` (§6.2) guards
   against double-consumption bookkeeping; the "losing" request's own account creation still succeeds
   (each is a distinct Clerk user, so `createOrClaimPartnerAccount`'s idempotency check doesn't dedupe
   them against each other) — the accepted, logged outcome is two real `partner_accounts` rows and one
   invite row correctly pointing at whichever request's `markDirectPartnerInviteAccepted` call won the
   race, with a server log for the loser. Matches this codebase's existing no-transactional-rollback
   discipline (`lib/partner/signup.ts`'s own orphaned-row precedent) — not a new risk class.
3. **A `direct_partner_invites` row's `invite_token_expires_at` passes between the GET lookup (page load)
   and the POST accept (form submit).** The POST route re-validates the token independently (§6.5) — a
   token that goes stale in the few seconds a visitor spends typing a company name is correctly rejected
   at submit time with the same invalid-link state, not silently accepted on stale information.
4. **A super-admin generates an invite, never shares it, and it simply expires 7 days later.** No action
   needed — the list shows it as `expired` (computed, §6.2) with no available action, a normal, expected,
   harmless outcome (an unused link that quietly dies), not an error state requiring cleanup.
5. **A super-admin sets `revenue_share_percent` to `0`.** Valid and distinct from `null` — `0` means "an
   explicit, deliberate zero," `null` means "not yet decided" (§4's "No revenue share set." vs. showing
   `0%`). The UI must render these differently (already specified in §4) — a real, intentional
   distinction, not an oversight.
6. **A sales-partner's account is later suspended (`status='suspended'`) while it still has a
   `revenue_share_percent` set.** No special handling — the value is purely reference data with no
   computed behavior attached to it in this brief or any planned follow-on (§ Out of Scope), so
   suspension has zero interaction with this column.
7. **Mobile vs. desktop.** Every new screen uses `SHELL_CONTENT_STYLE`'s existing `clamp()`-based fluid
   container (matches B2B-26 precedent) — no hardcoded pixel-width caps anywhere in this brief's new UI,
   per the standing responsive rule. The invite-link reveal panel's read-only URL input uses
   `overflow-x-auto`/`text-overflow` handling so a long URL doesn't blow out the layout on narrow
   viewports.
8. **A super-admin navigates directly to `/dashboard/admin/sales-partners/[id]` for an id that is a
   direct-partner (`account_kind='partner'`) row, not a sales-partner's own account.** The server
   component's own `notFound()` guard (§4) rejects this before any client rendering — a direct-partner
   row was never eligible to appear in this route tree, matching the API route's own defense-in-depth
   check (§6.9).
9. **The "Copy" button's `navigator.clipboard.writeText` call fails (e.g., a browser without clipboard
   permission, or an unusual embedded context).** The read-only input containing the URL remains
   fully selectable/copyable by hand regardless — the button is a convenience, not the only way to get
   the link, so a clipboard-API failure degrades gracefully with no broken flow.

---

## 10. Out of Scope

Everything the CEO brief itself named as deferred, unchanged:
- **Legal agreement generation, DocuSign e-signature, document storage/audit trail** — separate, parallel
  brief. This brief's detail view gets exactly one honest, non-functional placeholder card.
- **Card-required-for-trial payment enforcement** — separate, parallel brief (B2B-27). Not touched here.
- **Any actual payout mechanism, Stripe Connect, or automated disbursement** — explicitly ruled out by
  Arun's own words. `revenue_share_percent` is stored reference data only.
- **A partner-facing "invite a teammate" feature for a direct partner created via this brief's invite
  flow** — still doesn't exist; a direct partner invited in via `/partner-invite/accept` is single-owner
  exactly like every direct partner today (B2B-25's own unchanged finding).
- **B2B-26's own named follow-ons** (per-client Integration/usage-cap/routing-address detail screen,
  sales-partner shared-wallet billing, Known-Bugs aggregation for sales-partners, the B2B-21
  `sales_partner`→`internal-staff` rename) — unaffected, unchanged, still pending.

Additional items this BA spec itself is scoping out, within BA authority (technical/UI minimality, not
product-shape changes):
- **Editing or deleting a direct-partner invite's `label` after generation.** Only set-at-creation is in
  scope — matches this codebase's existing "no edit, only add + list" minimalism precedent (B2B-26's own
  Clients screen has no edit either).
- **Pre-filling a company name or target email on an invite link.** Resolved in §4 as a non-issue, not a
  deferred feature — the data model deliberately has no such field (§4's escalation-candidate closure).
- **A super-admin "resend" action on a direct-partner invite.** Resolved in §4 as inapplicable to this
  flow's shape (no known recipient) — "Generate" a new one instead.
- **Sortable/filterable status filtering on the Partner invites list** (e.g. "show only pending").
  Out of scope for this brief's minimal management surface — the full list with visible status badges is
  sufficient at this brief's expected volume (Arun generating a handful of links, not hundreds).
- **Any computed rollup of "how much is owed" across all sales-partners.** `revenue_share_percent` is a
  flat percentage with no revenue-amount data attached to compute against in this brief's own scope —
  genuinely nothing to roll up yet (that would require B2B-26's own named sales-partner-billing follow-on).

---

## 11. Open Questions

None.

Every item the CEO brief posed under "Questions for BA" is resolved directly in the section noted:
1. Diff shape for the Yes/No removal — §4 (full removal, not hardcoding, with reasoning).
2. `direct_partner_invites`' column set and the accept-flow state machine — §6.1 (schema, with one
   reasoned deviation from the brief's illustrative shape) and §4 (7-state machine).
3. The "Partner invites" page design — §4 (full field/action/copy-level detail), including the
   "Revoke-only, no Resend" resolution.
4. The sales-partners list/detail pages — §4 (full field layout, revenue-share input copy/validation,
   Legal-agreement placeholder copy/placement).
5. The "never sees their own revenue-share %" enforcement statement — §6.9.
6. Migration numbering and identifier grep — §0/§6.1 (`087`, file-tagged `b2b28` per the brief's
   corrected number, confirmed collision-free except one accepted, resolved exception).

The one product-shape question the CEO's own Escalations section flagged as a *candidate* for
escalation ("whether super-admin should be able to pre-fill a company name or target email") did not
turn out to be a genuine ambiguity on closer read — the brief's own recommended schema already answers
it by omission (no such column), and §4 documents that reasoning explicitly rather than treating it as
still open. Per this project's governance, Section 11 is empty and this spec is ready for CEO review.

---

## 12. Dependencies

**Must be true before build (all confirmed present, read directly for this spec):**
- `app/partner-signup/[[...partner-signup]]/page.tsx`, `lib/partner/signup.ts`,
  `app/api/partner-signup/claim/route.ts`, `app/api/webhooks/clerk/route.ts` — B2B-26's shipped State
  1/2/2b flow and `createOrClaimPartnerAccount()`'s existing `accountKind` parameter, simplified not
  forked.
- `partner_accounts` (migration 086, `account_kind`/`owning_channel_partner_id` columns and the
  `enforce_account_kind_invariants` trigger) — extended, not replaced.
- `internal_admin_users` (migration 084) — read-only FK target for `created_by_internal_admin_user_id`;
  the table itself is untouched.
- `lib/internal-admin/invite-tokens.ts` — reused verbatim, third reuse.
- `lib/internal-admin/auth.ts`'s `requireSuperAdmin` — reused unmodified, gates every new admin route
  and page.
- `lib/partner/clients.ts`'s `listClientsForChannelPartner`, `lib/partner/team-invites.ts`'s
  `listTeamAndInvites` — reused unmodified on the sales-partner detail page.
- `app/team-invite/accept/TeamInviteAcceptClient.tsx` — accept-flow UI/state-machine pattern reused (not
  its literal code) for `/partner-invite/accept`.
- `app/dashboard/configurator/_shared.tsx` — `COLORS`, `Card`, `SHELL_CONTENT_STYLE` design tokens.
- `components/dashboard/DashboardShell.tsx` — extended with two new nav entries.
- `middleware.ts` — `/partner-signup(.*)`, `/team-invite/accept(.*)` public-route precedent, extended by
  one new entry.

**New files:**
- `supabase/migrations/087_b2b28_direct_partner_invites_and_revenue_share.sql` (§6.1)
- `lib/internal-admin/direct-partner-invites.ts` (§6.2)
- `app/api/admin/partner-invites/route.ts` (GET, POST, §6.3)
- `app/api/admin/partner-invites/[id]/revoke/route.ts` (POST, §6.4)
- `app/api/partner-invite/accept/route.ts` (GET, POST, §6.5)
- `app/api/admin/sales-partners/route.ts` (GET, §6.9)
- `app/api/admin/sales-partners/[id]/route.ts` (GET, PATCH, §6.9)
- `app/dashboard/admin/partner-invites/page.tsx` + `PartnerInvitesClient.tsx` (§4)
- `app/dashboard/admin/sales-partners/page.tsx` + `SalesPartnersClient.tsx` (§4)
- `app/dashboard/admin/sales-partners/[id]/page.tsx` + `SalesPartnerDetailClient.tsx` (§4)
- `app/partner-invite/accept/page.tsx` + `PartnerInviteAcceptClient.tsx` (§4)

**Modified files:**
- `app/partner-signup/[[...partner-signup]]/page.tsx` — toggle UI and `managesMultipleClients` state
  removed; unconditional `forceRedirectUrl`/`unsafeMetadata` in State 2; `managesMultipleClients` dropped
  from State 2b's request body, redirect ternary kept (§4).
- `lib/partner/signup.ts` — doc comment only, third caller documented (§6.6); no functional change.
- `app/api/partner-signup/claim/route.ts` — `managesMultipleClients` removed from schema/body;
  `accountKind` hardcoded `'channel_partner'` (§6.7).
- `app/api/webhooks/clerk/route.ts` — existing `signup_intent==='partner'` branch simplified
  (`manages_multiple_clients` no longer read); new `signup_intent==='direct_partner_invite'` branch
  added (§6.8).
- `components/dashboard/DashboardShell.tsx` — two new `NAV_ITEMS` entries (§6.12).
- `middleware.ts` — add `/partner-invite/accept(.*)` to `isPublicRoute` (§6.13).
- `app/dashboard/admin/team/TeamClient.tsx` — **(added v1.1, §6.14, CEO-directed)** UI-copy-only rename,
  "Sales-partners" → "Internal sales staff" across six rendered strings; zero change to state variable
  names, fetched route paths, or any other logic.
- `docs/b2b-pivot-status.md` — Live Status table entry for B2B-28 updated on merge (Orchestrator's
  standing responsibility, not a file this spec hands to Dev).

**Explicitly not touched (verified by direct read for this spec, per Known Constraints):**
`lib/partner/auth.ts` in full (`requirePartnerAdmin`, `requireChannelPartnerAdmin`, `requirePartnerApiKey`
— zero changes, confirmed by direct read for this spec, not assumed from the brief); `lib/partner/admin-accounts.ts`'s
`getConfiguratorAccountsForClerkUser` and `getChannelPartnerAccountForClerkUser` (zero changes);
`enforce_account_kind_invariants`'s two pre-existing `RAISE EXCEPTION` clauses (only a third clause and
the trigger's watched-column list are added, both additive, §6.1); `internal_admin_users`,
`sales_partner_assignments` — schema, RLS, and the `role='sales_partner'` DB value itself, all read from,
never written to or renamed, by this brief, **including by the v1.1 `TeamClient.tsx` rename** (§6.14 is a
rendered-string diff only; the underlying `role` value and every DB identifier stay `sales_partner`,
matching this project's own established distinction between code-level identifiers and user-visible copy
— see §0); `app/api/admin/team/sales-partners/*` (route paths unchanged by the v1.1 rename); every file
under `app/dashboard/channel-partner/*` and `app/api/channel-partner/*` (zero changes — this brief's new
super-admin-facing surfaces are entirely separate route trees); `partner_admin_users`; `lib/partner/clients.ts`,
`lib/partner/team-invites.ts` (imported from, not modified); `docs/specs/B2B-27-requirement-document.md`
(the sibling card-on-file brief's own spec — a different BA agent's output, untouched by this document
or its author at any point during this brief's drafting).

---

*End of Requirement Document B2B-28 v1.0 — DRAFT, pending CEO review. All 12 sections filled, Section 11
empty.*
