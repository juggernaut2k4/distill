# Feature Brief: B2B-28 — Direct-Partner Signup Becomes Invite-Only; Sales-Partner Revenue-Share Tracking & Super-Admin Visibility

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 — reverses the primary partner-acquisition mechanism B2B-25/B2B-26 just shipped; every day
this ships late is a day `/partner-signup` keeps producing direct partners Arun no longer wants it to.
Date: 2026-07-19

---

## Numbering note (RESOLVED by Orchestrator, 2026-07-19)

This brief originally claimed B2B-27, simultaneously with a sibling brief
(`card-on-file-required-for-trial-access.md`, also dispatched today). Per this project's standing
tie-break rule (whichever claims an ID second renumbers, resolved by file mtime), this brief filed
second (mtime 1784480840 vs. the other brief's 1784480839) and renumbers to **B2B-28**.
`B2B-27-card-on-file-required-for-trial-access.md` keeps B2B-27. The per-client-detail screen,
sales-partner billing, and Known-Bugs-aggregation work B2B-26 informally sketched as "B2B-27/28/29" are
unaffected in substance — they simply take whatever the next free number is when someone actually
writes them (B2B-29 remains free at time of this resolution).

---

## What Arun Said

Verbatim, given directly today (2026-07-19), as four numbered instructions, each confirmed already
fully answered — not to be re-litigated:

1. "yes drop the question" — `/partner-signup` ("Get Started") should now **always** create a
   sales-partner account. Drop the "Do you manage multiple clients?" Yes/No branch B2B-26 just shipped
   entirely. There is no more self-serve path to becoming a direct partner.
2. Direct partners become invite-only. Super-admin generates a unique, single-use invite link per
   partner. Arun's exact words: "i will prefer single-use link generated on demand" — confirming this
   is a **new** link generated fresh each time, one per partner, not a reusable static URL.
3. Revenue attribution is tracked, not paid. Arun's correction, verbatim: "we need to get or enter the
   profit sharing %. we will not be paying anything for the sales partner." No Stripe Connect, no
   automated payout — a percentage value stored and displayed for Arun's own reference/reporting only.
   Partners invited directly by super-admin (item 2) are 100% Clio revenue — no percentage
   needed/stored for them. Partners created by a sales-partner (via B2B-26's existing Clients screen)
   have a revenue-share percentage associated with their **owning sales-partner**.
4. Super-admin sales-partner visibility. Once a sales-partner signs up, super-admin needs to see them
   listed in their dashboard, with a unique URL per sales-partner leading to a detail view showing full
   information (clients, revenue-share %, signup date, etc. — CEO to design the exact field list). The
   revenue-share percentage (item 3) is set/edited from this detail view, by super-admin only — a
   sales-partner must never set their own rate.

---

## The Problem Being Solved

B2B-26 (shipped `be6d811`, today) gave `/partner-signup` a Yes/No branch: "No" creates a direct
partner, "Yes" creates a sales-partner — both self-serve, both public, zero gatekeeping. Arun has now
decided direct partners should never be self-serve at all: every direct-partner relationship should be
one Arun (or a future super-admin) deliberately initiates by handing someone a link, not one a random
visitor can create by answering "No" on a public form. Simultaneously, Clio has no way today to track
what cut of a sales-partner's revenue is owed to them informally (no wallet, no Stripe Connect — just a
number Arun wants to see next to each sales-partner for his own bookkeeping), and no way for super-admin
to see the sales-partner roster at all — B2B-26 built the sales-partner's own dashboard, not a
super-admin-facing view of sales-partners as accounts to manage.

**Failure without this:** `/partner-signup` keeps letting anyone become a direct Clio partner with zero
review, which Arun has now explicitly said he doesn't want; sales-partner revenue-sharing arrangements
exist only in Arun's head or an external spreadsheet, disconnected from the product; and super-admin has
no dashboard-native way to see how many sales-partners exist, who they are, or what's owed to them.

---

## What Success Looks Like

- `/partner-signup` has one outcome only: every completed signup produces a
  `partner_accounts` row with `account_kind='channel_partner'` (sales-partner) and lands on
  `/dashboard/channel-partner`. There is no toggle, no branch, no way to reach `account_kind='partner'`
  through this public page anymore.
- A brand-new, token-gated, public-but-unguessable page lets someone become a direct partner **only**
  by following a link super-admin generated specifically for them. Visiting the equivalent URL without
  a valid, unused, unexpired token shows an invalid/expired state — never a working generic signup.
  Each generated link works exactly once; after one company completes signup through it, the same link
  is dead.
- Super-admin can generate a new direct-partner invite link on demand from their dashboard, see the
  list of links they've generated (pending/accepted/expired/revoked), and revoke or re-issue one if
  needed — mirroring the existing B2B-21 super-admin-invite UX pattern already live in
  `app/dashboard/admin/team/TeamClient.tsx`, not a new interaction paradigm.
- `partner_accounts` carries a nullable revenue-share percentage, meaningful **only** on a
  sales-partner's own account row (`account_kind='channel_partner'`), set and edited exclusively by
  super-admin from that sales-partner's detail view. It is never shown anywhere on the sales-partner's
  own dashboard (`/dashboard/channel-partner/*`) — this is Clio-internal margin data, not something a
  sales-partner should ever see about themselves, per the "role of the user matters" principle. Direct
  partners (however created) never carry a value here — they are 100% Clio revenue by definition.
- Super-admin has a new list page showing every sales-partner (name, client count, signup date, status)
  and, per sales-partner, a detail page at a stable, unique URL showing their full picture: client
  roster, team size, signup date, and the editable revenue-share % field.
- Nothing about B2B-26's sales-partner dashboard, Clients screen, Team invite flow, or the
  `requireChannelPartnerAdmin`/`account_kind`/`owning_channel_partner_id` data model changes in shape —
  this brief adds a gate in front of one entry point and a super-admin-facing read/write surface on top
  of data that already exists.

---

## Technical Findings (read directly from the live, just-shipped B2B-26 code — for BA to build on)

**The account_kind security gate is provably orthogonal to creation path — confirmed by direct code
read, not assumed.** `lib/partner/auth.ts`'s `requirePartnerAdmin(partnerAccountId)` (lines 214-263)
runs the caller's Clerk-session membership check first, then — as of B2B-26 §6.14's v1.2 chokepoint fix
— does a **fresh DB lookup** of `partner_accounts.account_kind` keyed on the passed `partnerAccountId`
and rejects if it's `'channel_partner'`. This lookup has no awareness of, and no code path branches on,
*how* that `partner_accounts` row came to exist — a self-serve B2B-25 signup, a B2B-26 Yes-branch
signup, and (once this brief ships) a super-admin-invite-accepted signup all produce
`account_kind='partner'` rows that `requirePartnerAdmin` treats identically. The same is true of
`requireChannelPartnerAdmin()` (lines 282-296, resolves via `getChannelPartnerAccountForClerkUser`,
itself a thin filter over `getPartnerAccountsForClerkUser`'s existing query) and of the Configurator
entry-point gate B2B-26 §6.14 added (`getConfiguratorAccountsForClerkUser`, filters `channel_partner`
rows out of the twelve Configurator entry pages) — both key off `account_kind` read fresh from the row,
never off provenance. The DB-level invariant trigger (`enforce_account_kind_invariants`, B2B-26 §6.15,
`supabase/migrations/086_b2b26_sales_partner_entity.sql`) only checks the *relationship* between
`account_kind` and `owning_channel_partner_id` on insert/update — a new direct-partner row created by
this brief's invite-accept flow will have `account_kind='partner'` and `owning_channel_partner_id=NULL`,
which trivially satisfies the trigger exactly as every existing direct-partner row does. **Conclusion,
stated explicitly per the brief that requested this confirmation: none of `lib/partner/auth.ts`, the
Configurator entry-point gate, or the DB trigger need any modification for this brief.** They are
security-by-property (what the row *is*), not security-by-history (how the row was *made*), and this
brief only ever produces rows whose properties those gates already handle correctly today. The B2B-26
migration's own comment even anticipated this: "today's single write path... makes a violation
unreachable in practice, but B2B-28 (this brief) will add more write paths against this same table, so the
invariant is enforced at the DB layer now" — this brief is exactly that anticipated new write path, and
it was already designed for.

**Invite-token mechanism: reuse `lib/internal-admin/invite-tokens.ts` directly, do not reinvent.**
Read in full: `generateInviteToken()` / `hashInviteToken()` / `inviteExpiresAt()` are a generic,
role-agnostic crypto utility (`crypto.randomBytes(24).toString('hex')` → 48-hex-char plaintext token,
SHA-256 hex digest as the only persisted form, 7-day expiry). B2B-26 already reused this verbatim (not
duplicated) for `lib/partner/team-invites.ts`'s `partner_team_invites` table — the exact same reuse this
brief should make a third time. **This is not the same problem shape as B2B-26's team invites, though,
and needs its own small table, not an extension of `partner_team_invites`:** a team invite (B2B-26)
adds a member to an *existing* `partner_accounts` row; this brief's invite creates a **brand-new**
`partner_accounts` row that does not exist at invite-issuance time. The closer structural precedent is
actually B2B-21's `internal_admin_users` (migration `084_b2b21_internal_admin_identity.sql`,
`invite_token_hash`/`invite_token_expires_at`/`status` embedded directly on the row being invited into
existence) — but that table is B2B-21's own internal-staff identity layer, explicitly out of scope to
touch (per this project's `internal_admin_users` isolation and the pending B2B-21 rename brief). The
correct shape is a new, small, dedicated table recording the invite itself (token hash, expiry, status,
issued-by, optional pre-filled label) that, on acceptance, calls `createOrClaimPartnerAccount` — the
exact same B2B-25/26 helper (`lib/partner/signup.ts`), passing `accountKind: 'partner'` explicitly —
rather than the invite table trying to *be* the partner account. This keeps `createOrClaimPartnerAccount`
as the single place account creation ever happens, a third caller alongside the existing webhook branch
and claim route, exactly matching that function's own doc comment ("Called from two places" becomes
"three places" — additive, not restructured).

**Where NOT to bolt this on: `app/dashboard/admin/clients/PartnerBillingClient.tsx` is the wrong home
for sales-partner visibility.** Read in full (290 lines): this is B2B-04's cross-partner **billing**
table — revenue/balance/payment-method columns, sortable, flat across every `partner_accounts` row
regardless of `account_kind`, gated `requireSuperAdmin`-only per its own B2B-21 §11 Q2 note ("brushes
the frozen commission topic"). Bolting a Clients-roster / revenue-share-%-editor / signup-date view onto
this component would conflate two different super-admin surfaces (billing operations vs. sales-partner
account management) and risk exactly the kind of accidental billing-logic entanglement B2B-26 was
careful to avoid by deferring real billing to its own brief. **Recommendation: a new, separate page
tree**, sibling to the existing `app/dashboard/admin/{clients,team,glitches,templates}` structure, not
an extension of the billing page.

**`app/api/admin/team/sales-partners` and `internal_admin_users.role='sales_partner'` are B2B-21's old,
not-yet-renamed concept — same collision B2B-26 already navigated, applies identically here.** Every
new identifier this brief introduces must avoid the bare token `sales_partner`/`sales-partner` in code,
exactly per the convention B2B-26 §0 already established and verified collision-free
(`channel_partner`/`channel-partner` family). This brief's new work is about the **same** entity B2B-26
named `channel_partner` in code — it should extend that vocabulary, not invent a second one.

---

## Naming Convention (extends B2B-26 §0 — same rule, new identifiers)

Per the already-established, CEO-directed convention: **user-visible copy always says "sales-partner"
and "direct partner"; code-level identifiers use the collision-free `channel_partner` family already in
use, plus new identifiers for the concepts this brief adds.** Verify collision-freedom by grep before
finalizing, matching B2B-26's own discipline. My recommended (not mandated — BA owns final naming)
starting points:

| Concept | Code-level identifier | User-visible copy |
|---|---|---|
| New table: super-admin-issued, single-use, direct-partner-creating invites | `direct_partner_invites` (deliberately not `partner_invites` alone — too close to B2B-26's `partner_team_invites`, and not `partner_signup_invites` — misleadingly implies it's part of the now-gone self-serve path) | "Invite link" |
| New public accept route | `app/partner-invite/accept`, `app/api/partner-invite/accept` (mirrors B2B-26's `app/team-invite/accept` naming exactly, but "partner-invite" not "team-invite" since this creates an account, not a membership) | "You've been invited to set up a Clio partner account" |
| New super-admin invite-management page | `app/dashboard/admin/partner-invites` | "Partner invites" |
| New revenue-share column on `partner_accounts` | `revenue_share_percent` (nullable numeric; meaningful only where `account_kind='channel_partner'`) | "Sales-partner revenue share" (label direction resolved below — BA to confirm phrasing) |
| New super-admin sales-partner list/detail pages | `app/dashboard/admin/sales-partners`, `app/dashboard/admin/sales-partners/[id]` | "Sales-partners" |
| New super-admin API routes | `app/api/admin/sales-partners`, `app/api/admin/sales-partners/[id]`, `app/api/admin/partner-invites*` | n/a |

**Why the sales-partner list/detail route uses the literal word "sales-partners" in its URL, unlike
B2B-26's deliberate avoidance:** B2B-26 avoided the bare token specifically because a sibling route
(`app/dashboard/channel-partner/*`) already existed in the *same* route tree as a *different* concept
that could grep-collide with B2B-21's `sales_partner_assignments`/`/api/admin/team/sales-partners`. This
brief's new page lives under `app/dashboard/admin/*` (super-admin's own tree, already containing
`clients`/`team`/`glitches`/`templates` — all plain English nouns, no collision-avoidance precedent
needed there) and is read-only/management surface, not a second signup or account-resolution mechanism
— the collision risk B2B-26 was guarding against (a *future grep* confusing account-creation code paths)
doesn't apply the same way to a list/detail admin page. BA should still grep-verify
`app/dashboard/admin/sales-partners` doesn't collide with anything before finalizing.

---

## Recommended data-model approach

1. **`/partner-signup` (public self-serve): remove the Yes/No branch, hardcode `channel_partner`.**
   `app/partner-signup/[[...partner-signup]]/page.tsx` loses the "Do you manage multiple clients?"
   toggle UI and the `managesMultipleClients` state entirely — reverting State 1's visual shape to
   B2B-25's original single-field screen. Every call this page makes to `createOrClaimPartnerAccount`
   (via the webhook's `unsafeMetadata` branch or the `/api/partner-signup/claim` route) passes
   `accountKind: 'channel_partner'` unconditionally. `forceRedirectUrl` becomes unconditionally
   `/dashboard/channel-partner` (no ternary). BA to decide the exact cleanest diff (drop
   `manages_multiple_clients` from the metadata/body shape entirely vs. hardcode it `true`) — either
   is correct, pick whichever is the smaller, clearer diff against the current shipped code.
   **Non-regression to explicitly re-verify:** the existing `alreadyMember`-wins-over-request logic in
   `createOrClaimPartnerAccount` (an existing direct partner who is still signed in and revisits
   `/partner-signup`) must keep returning their real `account_kind='partner'` and redirecting to
   `/dashboard/configurator` — this becomes *more* important post-brief, since it is now the **only**
   way a signed-in visitor to `/partner-signup` ever reaches `/dashboard/configurator` at all.

2. **New table `direct_partner_invites`** (illustrative shape, BA to finalize column names/migration
   number — next free is `087`, after `086_b2b26_...`):
   ```sql
   CREATE TABLE IF NOT EXISTS direct_partner_invites (
     id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     label                     TEXT,                    -- optional, super-admin's own note (e.g. "Pluralsight — Jan outreach"), never shown to the invitee
     status                    TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'accepted', 'revoked')),
     invite_token_hash         TEXT NOT NULL,
     invite_token_expires_at   TIMESTAMPTZ NOT NULL,
     created_by_clerk_user_id  TEXT NOT NULL,            -- the super-admin who generated it
     created_partner_account_id UUID REFERENCES partner_accounts(id),  -- set on accept, null until then
     created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     accepted_at                TIMESTAMPTZ
   );
   ```
   Issuance (`POST /api/admin/partner-invites`, `requireSuperAdmin`-gated) generates a token via
   `generateInviteToken()`, inserts a `pending` row, returns the plaintext token embedded in a full
   `/partner-invite/accept?token=...` URL — shown once, exactly like every existing invite flow in this
   codebase, never persisted in plaintext.
   Acceptance (`app/partner-invite/accept`, structurally mirroring `app/team-invite/accept/
   TeamInviteAcceptClient.tsx`'s states, reusing `/partner-signup` State 1's company-name-capture UI
   verbatim as a sibling render path) validates the token (unexpired, `status='pending'`), then — after
   the visitor completes Clerk sign-up or is already signed in — calls
   `createOrClaimPartnerAccount(clerkUserId, companyName, email, 'partner')` exactly as the existing
   two call sites do, then marks the invite row `status='accepted'`, `accepted_at=NOW()`,
   `created_partner_account_id=<new id>`. A `pending` row past `invite_token_expires_at` is treated as
   dead (BA to decide: a lazy status flip to a synthetic "expired" read, matching how B2B-26's
   `partner_team_invites` list excludes expired-but-still-pending rows, per B2B-26 §4's "Pending
   invites" section — same UX precedent, reuse it). Revoke (`PATCH .../[id]` or `DELETE`) sets
   `status='revoked'`, no confirmation dialog, matching this codebase's existing no-confirm-dialog
   convention (B2B-21, B2B-26).

3. **`partner_accounts.revenue_share_percent`** — one new nullable column, same migration:
   ```sql
   ALTER TABLE partner_accounts
     ADD COLUMN IF NOT EXISTS revenue_share_percent NUMERIC(5,2)
       CHECK (revenue_share_percent IS NULL OR (revenue_share_percent >= 0 AND revenue_share_percent <= 100));
   ```
   Meaningful only on a `channel_partner`-kind row (a sales-partner's own account). NULL for every
   direct-partner row (self-serve-era or invite-created — both 100% Clio revenue, no value stored).
   NULL by default on a freshly-signed-up sales-partner too — Arun "gets or enters" it after the fact
   via the detail view (item 4); there is no requirement to capture it at signup time, and doing so
   would need a product-shape screen decision nobody asked for. Not enforced as NOT NULL — a sales-
   partner with no rate set yet is a normal, expected state, not an error.
   **Semantic direction (small, resolvable naming/copy decision, not escalated):** "profit sharing %"
   most naturally reads as **the sales-partner's own share of revenue** (the conventional meaning of
   "revenue share" / "profit split" in a reseller relationship) — recommend the BA lock this reading
   and label the field explicitly in the UI ("Sales-partner share: __%") so there is no ambiguity for
   whoever reads it later, rather than leaving a bare "%" that could be misread either direction.

4. **Super-admin sales-partner list + detail (new pages, `requireSuperAdmin`-gated throughout,
   mirroring `requireSuperAdmin`'s existing use on `app/dashboard/admin/clients/page.tsx`):**
   - `GET /api/admin/sales-partners` — every `partner_accounts` row with `account_kind='channel_partner'`,
     returning at minimum: id, name, client count (`COUNT(*) WHERE owning_channel_partner_id = id`),
     team member count, `created_at` (signup date), `status`, `revenue_share_percent`.
   - `app/dashboard/admin/sales-partners` (list page) — a table, reusing the existing sortable-table
     visual pattern already established by `PartnerBillingClient.tsx` (columns, sort-by-header
     interaction) without importing that component's billing-specific logic — same look, different
     data. Each row links to its detail page by id (`/dashboard/admin/sales-partners/[id]`).
   - `GET /api/admin/sales-partners/[id]` — full detail: the sales-partner's own info (name, signup
     date, status), its client roster (name, company URL, status — reusing `listClientsForChannelPartner`
     from `lib/partner/clients.ts` directly, already built by B2B-26, zero new query logic needed), team
     roster count, `revenue_share_percent`.
   - `app/dashboard/admin/sales-partners/[id]` (detail page) — the fields above, plus an editable
     revenue-share-% input + save button (`PATCH /api/admin/sales-partners/[id]`, `requireSuperAdmin`,
     body `{ revenue_share_percent: number | null }`, same validation range as the column CHECK), plus
     one forward-reference-only card: **"Legal agreement"** with placeholder body text (something like
     "Agreement tracking is coming soon.") — explicitly not functional, not linking anywhere yet, per
     the sibling DocuSign/e-signature brief being written in parallel (out of scope here, not even a
     stub beyond this one honest placeholder card, matching B2B-26's own "Billing — coming soon" card
     precedent for what an honest non-functional placeholder looks like).
   - **This revenue-share value must never appear anywhere under `/dashboard/channel-partner/*`** — the
     sales-partner's own Dashboard "Billing — coming soon" card (B2B-26 §4) is untouched by this brief
     and stays exactly as shipped; there is no new sales-partner-facing surface in this brief at all.

---

## Scope for THIS brief

1. Remove the Yes/No branch from `/partner-signup`; every completed self-serve signup produces
   `account_kind='channel_partner'`, redirects to `/dashboard/channel-partner`, no exceptions.
2. New `direct_partner_invites` table + issuance/accept/list/revoke flow, reusing
   `lib/internal-admin/invite-tokens.ts` and `createOrClaimPartnerAccount` directly. New public route
   `/partner-invite/accept`. This is now the **only** way a new `account_kind='partner'` row is ever
   created going forward.
3. `partner_accounts.revenue_share_percent` column (nullable, 0-100, meaningful only for
   `channel_partner` rows), set/edited exclusively via a super-admin-only API route.
4. New super-admin-only pages: `/dashboard/admin/partner-invites` (generate/list/revoke direct-partner
   invite links) and `/dashboard/admin/sales-partners` + `/dashboard/admin/sales-partners/[id]`
   (sales-partner roster + per-sales-partner detail view with the editable revenue-share field and a
   forward-reference-only "Legal agreement" placeholder card).

## What's explicitly OUT of scope for this brief

- **Legal agreement generation, DocuSign e-signature, document storage/audit trail** — separate,
  parallel brief. This brief's detail view gets exactly one honest, non-functional placeholder card
  referencing it, nothing more.
- **Card-required-for-trial payment enforcement** — separate, parallel brief. Not touched here.
- **Any actual payout mechanism, Stripe Connect, or automated disbursement** — explicitly ruled out by
  Arun's own words ("we will not be paying anything"). `revenue_share_percent` is a stored number for
  Arun's own reference, nothing computes against it, nothing pays out from it, in this brief or planned
  in any named follow-on.
- **A partner-facing "invite a teammate" feature for direct partners** — still doesn't exist (B2B-25's
  own finding, unchanged), still not built here; a direct partner invited in via this brief's new flow
  is single-owner exactly like every direct partner today.
- **B2B-26's own named follow-ons** (per-client Integration/usage-cap/routing-address detail screen,
  sales-partner shared-wallet billing, Known-Bugs aggregation for sales-partners, the B2B-21
  `sales_partner`→`internal-staff` rename) — unaffected, unchanged, still pending, still take the next
  free number whenever they're actually written.

---

## Known Constraints

- No resurrecting anything from B2C git history.
- Standing responsive-UI rule applies to every new/changed screen: Tailwind + `clamp()`, no hardcoded
  pixel-width caps, matching the fluid `max-w-sm` card precedent already established by
  `/partner-signup` and `/team-invite/accept`.
- Reuse aggressively, name each reuse explicitly in the Requirement Document: `createOrClaimPartnerAccount`
  (third caller, not forked), `lib/internal-admin/invite-tokens.ts` (third reuse), `listClientsForChannelPartner`
  (`lib/partner/clients.ts`, already built), `requireSuperAdmin` (`lib/internal-admin/auth.ts`, already
  built, already used by `app/dashboard/admin/clients/page.tsx`), the sortable-table visual pattern from
  `PartnerBillingClient.tsx` (visual reuse only, not its billing logic), the no-confirm-dialog and
  resend/revoke interaction pattern from `TeamClient.tsx`/B2B-26's Team panel.
- Do not touch `requirePartnerAdmin`, `requireChannelPartnerAdmin`, `getConfiguratorAccountsForClerkUser`,
  the `enforce_account_kind_invariants` trigger, `internal_admin_users`, `sales_partner_assignments`, or
  anything in `lib/internal-admin/*` beyond importing the invite-token utility functions — all confirmed
  orthogonal above, all must remain untouched by this brief. If the BA's deeper investigation finds a
  reason any of these *does* need to change, that is a genuine escalation back to me, not a unilateral
  call — the orthogonality claim in this brief is my confirmed reasoning, not Dev's to silently overrule
  either way.
- No new npm dependencies without written justification.
- Never populate any of this brief's screens with speculative AI-generated content — every screen here
  is a structured data read/write (invite list, sales-partner roster, revenue-share field), not a
  generative surface.
- `revenue_share_percent` is Clio-internal data. It must never be exposed on any `/dashboard/channel-partner/*`
  route, any `/api/channel-partner/*` response, or anywhere else a sales-partner's own session could
  read it. BA must confirm this explicitly as an acceptance test, not just a screen-content omission —
  a sales-partner directly hitting a super-admin API route would already 403 via `requireSuperAdmin`,
  but the BA should state that as the enforcement mechanism rather than leave it implicit.

---

## Questions for BA

1. Finalize the exact diff shape for removing `/partner-signup`'s Yes/No toggle (drop
   `manages_multiple_clients` from the metadata/body entirely vs. hardcode `true`) — pick the smaller,
   clearer diff; document the choice.
2. Finalize `direct_partner_invites`' exact column set and the accept-flow's exact state machine
   (loading / invalid-or-expired / signed-out-needs-signup / signed-in-claim / accepted-redirecting),
   mirroring `app/team-invite/accept/TeamInviteAcceptClient.tsx`'s existing states as closely as
   possible per the reuse instruction above.
3. Design the super-admin "Partner invites" page (generate button, list with status badges,
   resend/revoke actions) at the 3+-line detail level this project's "ambiguous UX = STOP" rule
   requires — reuse `TeamClient.tsx`'s visual/interaction pattern, do not invent a new one.
4. Design the super-admin sales-partners list and detail pages at the same detail level — exact field
   layout, exact copy for the revenue-share input and its label/validation-error text, exact copy and
   placement for the "Legal agreement — coming soon" forward-reference card.
5. Confirm the exact enforcement statement for "a sales-partner never sees their own revenue-share %"
   (which gate makes this true, and where it's asserted as an acceptance test).
6. Confirm migration numbering (`087_b2b27_...` or whatever is next-free at Dev time) and finalize
   every code-level identifier in this brief's naming table against a fresh grep, per B2B-26's own
   discipline.

Section 11 must be empty before this reaches Dev, per standing governance. None of the above are
product-shape ambiguities I can't resolve — they are BA-owned finishing decisions within the design this
brief already specifies.

---

## Escalations

None. Every point raised by this dispatch is resolved above with reasoning grounded in a direct read of
the live B2B-25/B2B-26 code (`lib/partner/auth.ts`, `lib/partner/signup.ts`,
`lib/internal-admin/invite-tokens.ts`, `app/dashboard/admin/clients/PartnerBillingClient.tsx`,
`supabase/migrations/084_b2b21_internal_admin_identity.sql` and `086_b2b26_sales_partner_entity.sql`),
not guessed. The one place I made a judgment call rather than taking dictation — the semantic direction
of "profit sharing %" (§ Recommended data-model approach, point 3) — is a small, reversible copy/label
decision, not a number-storage decision, and is flagged to the BA to lock explicitly rather than decided
silently. If the BA's deeper investigation surfaces a genuine product-shape ambiguity beyond what's
covered here — most likely candidate: whether super-admin should be able to pre-fill a company name or
target email on a direct-partner invite link before it's sent, which Arun's own words didn't specify —
that comes back to me, not decided solo.
