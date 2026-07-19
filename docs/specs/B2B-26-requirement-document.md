# B2B-26 — Sales-Partner Entity: Signup Branch, Client Roster, Own Team — Requirement Document
Version: 1.3
Status: APPROVED — cleared for Dev
Author: Business Analyst Agent
Date: 2026-07-19
Source brief: `.claude/agents/clio/feature-briefs/B2B-26-sales-partner-entity-signup-clients-team.md`

**Revision note (v1.3):** CEO approved v1.2's substance outright ("the chokepoint fix is exactly
right... this is the correct fix") but held approval for one copy-consistency pass: the top "Scope in
one line" summary (former lines 34-35) and §6.12's "Reads" summary both still asserted
`requirePartnerAdmin` was "untouched," directly contradicting the v1.2 revision note immediately above
them. A third instance, missed by both the CEO's spot-check and my own v1.2 pass, was independently
found during this sweep: AT-22 (§7) asserted "none has been modified" for a list including
`requirePartnerAdmin` — a stale non-regression test that would now fail against the v1.2 code as
written. All three fixed in this revision to consistently reflect the v1.2 chokepoint guard clause;
grepped the full document for every remaining `requirePartnerAdmin` mention to confirm no other
"untouched"-type claim survived. No substance changed — Section 11 remains empty, no question is
reopened. Per the CEO's explicit instruction, this is a copy-only pass and does not require a further
review cycle; status is set directly to APPROVED.

**Revision note (v1.2):** CEO review of v1.1 approved §6.15 (DB trigger) outright and found §6.14 (the
Configurator UI-level gate) well-built but its own disclosed "residual gap" undersized: v1.1 named the
residual as two routes (`/api/admin/partner-keys`, `/api/admin/partner-accounts/*`). The CEO
independently grepped and found `requirePartnerAdmin(` is the sole gate on 42 route files (confirmed
independently for this revision — `grep -rl "requirePartnerAdmin(" app | grep -v lib/partner/auth.ts`
returns 42, and three CEO-named examples — `app/api/admin/billing/checkout/route.ts`,
`app/api/admin/configurator/wizard/go-live/route.ts`,
`app/api/admin/configurator/integration/test-outbound/route.ts` — were each independently re-read and
confirmed to call it as their sole gate), not 2 — meaning a channel-partner admin who knows their own
account id (trivially true, it's their own account) could operate their account as a fully live direct
partner across real billing checkout, go-live, content generation, and OAuth-client issuance, directly
contradicting this document's own §11 judgment call. The CEO directed overriding the source brief's
own "do not touch `requirePartnerAdmin`" constraint for this narrow purpose — a technical/security
scoping call within the CEO's authority, not a change to Arun's product decision (Q6 is unchanged; only
where the enforcement lives changes) — and required the fix live inside `requirePartnerAdmin` itself as
the single chokepoint. Fixed in this revision: §6.14 is rewritten to describe this as the actual fix
(not a residual); §6.6, §7, §10, §11, and §12 updated accordingly. §6.15 (DB trigger) is unchanged,
already approved. Everything else in v1.1 was reviewed and approved unchanged.

> Scope in one line: add a "Do you manage multiple clients?" branch to `/partner-signup`'s existing
> State 1; on Yes, create a `partner_accounts` row with a new `account_kind='channel_partner'`
> discriminator instead of the default `'partner'`; give that account a minimal Clients roster
> (name + company URL only, each client itself a normal `account_kind='partner'` row with
> `owning_channel_partner_id` set and zero `partner_admin_users`), a Team invite panel (new
> `partner_team_invites` table, reusing B2B-21's token-generation utility), and a minimal 4-area
> Dashboard. Everything B2B-25 built (`createOrClaimPartnerAccount`, the claim route, the webhook
> branch) is extended, not forked. `partner_admin_users`' existing shape and every B2B-21
> `internal_admin_users`/`sales_partner_assignments` file are untouched. `requirePartnerAdmin` gains
> one additive guard clause as of v1.2 (§6.14) — a CEO-directed override of this brief's original
> "do not touch" constraint, provably a no-op for every pre-existing `account_kind='partner'` row.

Every code-level identifier introduced by this brief avoids the bare token `sales_partner`/
`sales-partner` (already owned by B2B-21's internal-staff concept) — see §0 below, read this before
anything else in the document.

---

## 0. Naming Convention (read first — governs every section below)

Per the CEO brief's explicit direction (not re-litigated, only finalized): **user-visible copy always
says "sales-partner"; every code-level identifier — DB column/table names, DB enum values, TypeScript
symbols, file/folder names, API route paths — uses the collision-free word "channel-partner" /
"channel_partner" instead.**

Verified directly against the current codebase (grep, zero hits) that these are unclaimed:
`channel_partner`, `channel-partner`, `owning_channel_partner_id`, `account_kind` — none appear
anywhere in the repo today.

| Concept | Code-level identifier (this brief) | User-visible copy |
|---|---|---|
| Discriminator value on `partner_accounts` | `account_kind = 'channel_partner'` | "sales-partner" |
| Ownership FK column | `partner_accounts.owning_channel_partner_id` | (not shown raw to users) |
| New invite table | `partner_team_invites` | "Invite a team member" |
| New auth helper | `requireChannelPartnerAdmin()` (`lib/partner/auth.ts`) | n/a |
| New account lookup | `getChannelPartnerAccountForClerkUser()` (`lib/partner/admin-accounts.ts`) | n/a |
| New lib files | `lib/partner/team-invites.ts`, `lib/partner/clients.ts` | n/a |
| New page routes | `app/dashboard/channel-partner/*` | Page copy/nav says "Sales-partner dashboard" / "Clients" / "Team" |
| New API routes | `app/api/channel-partner/*` | n/a |
| New public accept route | `app/team-invite/accept`, `app/api/team-invite/accept` | "You've been invited to join {companyName}'s team on Clio" |

**Why the route/folder path also avoids the bare token, even though URLs are semi-user-facing:** in
Next.js's App Router the folder name *is* the URL segment — there is no way to make the file-tree
identifier collision-free while keeping the URL slug literally "sales-partner" without a rewrite rule
(added complexity for no functional benefit). The CEO's stated concern was specifically about "a
future grep" confusing this brief's code with B2B-21's `sales_partner_assignments` /
`/api/admin/team/sales-partners` — a route folder named `app/dashboard/sales-partner/` would still
visually and grep-fuzzy-match against `app/api/admin/team/sales-partners/`. Treating the URL slug as a
code-level identifier (not "copy") and keeping it collision-free is the more literal, defensible
reading of the directive. This is a low-stakes, easily-reversible naming choice (a route rename, not a
data-model decision) — if Arun wants the URL itself to read "sales-partner," that is a one-line change
to two folder names, not a spec revision. Every *string a human reads on screen* — headings, nav
labels, button text, email subject/body — says "sales-partner," with zero exceptions.

---

## 1. Purpose

Today, `/partner-signup` (B2B-25) produces exactly one outcome for every signup: a `partner_accounts`
row + a `partner_admin_users` row (`role='owner'`) for the signing-up company itself. There is no way
for a reseller/channel company (the brainstorm doc's worked example: "ai-learn.com" reselling Clio to
"Pluralsight") to sign up once and manage several downstream client accounts under one login, one
shared bill (billing itself is a later brief, B2B-28), and one team. Today, such a company would have
to create N separate direct-partner accounts with N separate logins — it has no way to represent the
sales-partner ↔ client relationship at all, and no shared team access across those clients.

**Failure without it:** Clio cannot onboard any reseller-style channel partner (the B2B2C half of the
pivot's own name) — every prospective sales-partner either can't be modeled at all, or gets
mis-modeled as N unrelated direct partners with no shared roster, team, or (eventually) billing. This
brief is also the load-bearing prerequisite for three already-named follow-on briefs (B2B-27 per-client
detail, B2B-28 sales-partner billing, B2B-29 Known Bugs aggregation) — none of them can be meaningfully
spec'd until this entity and its ownership model exist.

---

## 2. User Story

As a reseller/channel company evaluating Clio (a prospective sales-partner),
I want to sign up once, answer one question about whether I manage multiple clients, and — if yes —
land in a dashboard where I can add my clients and invite my own team,
So that I don't have to create a separate disconnected Clio account for every client I resell to.

As an existing direct partner signing up normally,
I want the new question to change nothing about my own signup flow when I answer "No,"
So that this brief introduces zero risk to the flow B2B-25 just shipped.

As a sales-partner's invited team member,
I want to receive an invite email, accept it, and land with full access to my sales-partner's
dashboard except billing,
So that I can help manage the account without a separate onboarding process.

---

## 3. Trigger / Entry Point

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| E-1 | Visitor reaches `/partner-signup` | `GET /partner-signup` | None (public, unchanged) | Same as B2B-25 |
| E-2 | Visitor answers the new Yes/No question | Client-side only — no new route; the boolean joins `companyName` in the same client-component state that already carries State 1 → State 2/2b | None | Company name already entered (§4) |
| E-3a | "No" answer, visitor completes Clerk `<SignUp>` | Existing State 2, `forceRedirectUrl` now computed (§4) | Clerk-managed | Unchanged from B2B-25 |
| E-3b | "Yes" answer, visitor completes Clerk `<SignUp>` | Existing State 2, `unsafeMetadata` now carries `manages_multiple_clients: true` | Clerk-managed | Same screen, new metadata field |
| E-4 | Clerk fires `user.created` | `POST /api/webhooks/clerk` (existing route, extended branch) | svix signature (unchanged) | `unsafe_metadata.signup_intent === 'partner'` |
| E-5 | Already-signed-in visitor answers Yes/No and clicks Continue | `POST /api/partner-signup/claim` (existing route, extended body) | Clerk session (existing gate) | Same as B2B-25 State 2b |
| E-6 | New sales-partner (or returning one) reaches their dashboard | `GET /dashboard/channel-partner`, `.../clients`, `.../team` | Clerk session + `requireChannelPartnerAdmin` (new) | Must administer a `partner_accounts` row with `account_kind='channel_partner'` |
| E-7 | Sales-partner adds a client | `POST /api/channel-partner/clients` | Clerk session + `requireChannelPartnerAdmin` | On the Clients page, form submitted |
| E-8 | Sales-partner invites a team member | `POST /api/channel-partner/team/invite` | Clerk session + `requireChannelPartnerAdmin` | On the Team page, invite form submitted |
| E-9 | Invitee opens their invite email link | `GET /team-invite/accept?token=...` (new, public) | None (token-gated lookup) | Valid, unexpired, unused token |
| E-10 | Invitee accepts | `POST /api/team-invite/accept` | Clerk session (must sign in/up first, mirrors B2B-21) | Signed-in email matches invited email |
| E-11 (existing, unaffected) | A returning user signs in | `GET /sign-in` → Clerk auth → `fallbackRedirectUrl` | None | `fallbackRedirectUrl` changes from `/dashboard/configurator` to `/dashboard` (§6.9) — a smart router, not a product-facing change for any existing direct partner |

---

## 4. Screen / Flow Description

### State 1 — `/partner-signup`, company-name capture (MODIFIED — new question added)

Identical to B2B-25's shipped State 1 (`app/partner-signup/[[...partner-signup]]/page.tsx`) with one
addition, inserted directly below the existing company-name input and above the "Continue" button:

- A second field, always visible (not conditionally revealed) directly under the company-name input,
  separated by `mt-5` (slightly more than the existing `mt-4` field-to-field spacing, since this is a
  visually distinct question, not a second line of the same field group):
  - Label text, same styling as "Company name": `"Do you manage multiple clients?"` —
    `text-[#94A3B8] text-sm font-medium mb-1.5`.
  - Two toggle buttons, side by side (`flex gap-2`), each `flex-1`, `h-11` (44px, comfortable tap
    target), `rounded-lg`, `text-sm font-semibold`, `border`:
    - `"No"` — default-selected on first render (unselected state:
      `bg-[#0A0A0A] border-[#333333] text-[#94A3B8]`; selected state:
      `border-[#7C3AED] bg-[#7C3AED]/10 text-white`, 2px border matching the onboarding
      selected-option precedent already defined in this project's design-system history for
      selected states).
    - `"Yes"` — same sizing/styling, unselected/selected states identical to "No"'s.
  - No helper/explanatory text beneath the toggle — the question is self-explanatory and this
    project's "ambiguous UX = STOP, minimal version" rule argues for the smallest correct addition,
    not extra copy nobody asked for.
- **Why default to "No", not requiring an explicit choice:** the CEO brief's own framing is that "No"
  is the common case (existing B2B-25 traffic is 100% direct partners today) and this project's
  standing rule is to keep every existing flow's blast radius at zero — a visitor who doesn't notice
  the new question at all still gets today's exact behavior. This is a technical/UX-default judgment
  call within BA authority (not a product-shape decision), consistent with "choose the option that
  best serves" the common, low-risk case.
- "Continue" button: unchanged position, styling, and disabled/empty-company-name gating from B2B-25.
  No new validation is added for the Yes/No toggle — it always has a value (defaults to "No"), so
  there is nothing to validate.
- The boolean (`managesMultipleClients: boolean`, initialized `false`) lives in the same page's
  client-component state as `companyName`, alongside the existing `step`/`showValidationError`
  state — no new persistence mechanism, matching B2B-25 §6.7's "never persisted client-side" rule
  exactly.

### State 2 — `/partner-signup`, Clerk `<SignUp>` (MODIFIED — one new metadata field, redirect now conditional)

Unchanged Clerk mechanics. Two changes to the existing `<SignUp>` call:

```tsx
<SignUp
  forceRedirectUrl={managesMultipleClients ? '/dashboard/channel-partner' : '/dashboard/configurator'}
  unsafeMetadata={{
    signup_intent: 'partner',
    company_name: companyName.trim(),
    manages_multiple_clients: managesMultipleClients,
  }}
  appearance={clerkAppearance}
/>
```

- `forceRedirectUrl` is now computed from the local `managesMultipleClients` state at render time —
  this is a best-effort immediate destination only; per B2B-25 §4 State 3, Clerk's own client-side
  redirect fires before the webhook is guaranteed to have completed. If the webhook hasn't landed by
  the time `/dashboard/channel-partner` first renders, it shows the equivalent of B2B-25's existing
  `<NoPartnerAccounts />` placeholder for this destination (§6.4, new component
  `<NoChannelPartnerAccount />`) — same accepted race, same resolution (manual refresh), not a new
  risk class (§9 Edge Case 1).
- `unsafe_metadata.manages_multiple_clients` is a plain boolean, read by the webhook branch (§6.2).

### State 2b — `/partner-signup`, already-signed-in visitor claim (MODIFIED — redirect now driven by the server's answer, not the local toggle)

Unchanged trigger and loading/error UI from B2B-25 (`"Setting up your account..."` spinner,
`"Something went wrong..."` + "Try again" on failure). One behavioral change:

- The `POST /api/partner-signup/claim` body now also carries `managesMultipleClients` (§6.3).
- **The redirect destination is taken from the API response's `accountKind` field, never from the
  local `managesMultipleClients` toggle.** This is a deliberate correctness fix over a naive
  "redirect based on what I just clicked" approach: if a visitor already administers an account
  (the `alreadyMember: true` idempotency case, §6.1) — for example, a partner who signed up months
  ago as a direct partner, is still signed in, and revisits `/partner-signup` today and happens to
  click "Yes" out of curiosity — their *existing* account's real `account_kind` must win, or they
  would be routed to a sales-partner dashboard for an account that was never created as one. See §9
  Edge Case 2 for the full reasoning; this is resolved in-brief, not deferred.

```tsx
async function submitClaim() {
  setStep('claiming')
  try {
    const res = await fetch('/api/partner-signup/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: companyName.trim(), managesMultipleClients }),
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

### State 3 — post-signup landing (unchanged mechanism, two possible destinations now)

Same as B2B-25 §4 State 3 — Clerk's client-side redirect or State 2b's `router.push`, now landing on
either `/dashboard/configurator` (unchanged) or `/dashboard/channel-partner` (new, §4 below).

---

### `/dashboard/channel-partner` — Dashboard (NEW)

Reached after signup, or via the smart router at `/dashboard` (§6.9) on a later sign-in. Reuses the
`_shared.tsx` design tokens (`COLORS`, `Card`, `PrimaryButton`, `SecondaryButton`,
`SHELL_CONTENT_STYLE`) verbatim — same dark-void/`#111111`-panel/`#7C3AED`-accent visual system
already established, no new colors or components invented. Reuses B2B-24's four-content-area
*structural pattern* (not its literal code, per the CEO brief's own instruction — the underlying data
here, client/team counts, is unrelated to B2B-24's setup-completion/wallet data).

Top bar (mirrors `ConfiguratorNavShell`'s chrome, not its literal Configurator-specific nav items):
- Left: `"Clio — Sales-partner dashboard"` — `font-weight:700, font-size:14px`, `COLORS.textPrimary`.
- Right: the signed-in user's company name (the sales-partner's own `partner_accounts.name`),
  `COLORS.textSecondary, font-size:13px`.

Below the top bar, a 3-item nav row (mirrors `ConfiguratorNavShell`'s `<nav>` styling exactly — same
`borderBottom`, same active-tab underline in `COLORS.purple`): **Dashboard** (active by default) /
**Clients** / **Team**. No Configurator, API, Docs, or Known Bugs tabs — those concepts do not exist
for a sales-partner's own account under this brief's scope (§ Judgment Call below).

Four content areas, each a `Card`, stacked vertically with `gap: 16px`, inside `SHELL_CONTENT_STYLE`'s
fluid `clamp()`-based container (no hardcoded pixel width, per the standing responsive rule):

1. **Clients glimpse.** Heading `"Clients"` (`text-lg font-semibold text-white`). Below it: the total
   client count in large text (`text-3xl font-bold`, `COLORS.cyan`) with the label `"clients"`
   beside it, then up to 3 most-recently-created client names as a plain list (name only — no status
   badges here, that's the full Clients page's job). If zero clients: text
   `"No clients yet."` (`COLORS.textMuted`) in place of the list. A `SecondaryButton` labeled
   `"View all clients →"` links to `/dashboard/channel-partner/clients`.
2. **Team glimpse.** Heading `"Team"`. Total count = active `partner_admin_users` rows +
   pending `partner_team_invites` rows, shown as `"{N} people"` (`text-3xl font-bold`,
   `COLORS.purple`). Sub-line: `"{activeCount} active, {pendingCount} pending"`
   (`COLORS.textSecondary, text-sm`). A `SecondaryButton` labeled `"Manage team →"` links to
   `/dashboard/channel-partner/team`.
3. **Billing — coming soon.** Heading `"Billing"`. Body text: `"Shared wallet billing for your
   clients is coming soon."` (`COLORS.textMuted, text-sm`). No numbers, no CTA — a real,
   honest placeholder, not a disabled-looking fake button (matching this project's "no AI-slop /
   no misleading UI" standard already applied by the CEO brief to the deferred routing-address
   field).
4. **Quick links.** Heading `"Quick links"`. Two `SecondaryButton`s side by side: `"Add a client"`
   (→ `/dashboard/channel-partner/clients?action=add`) and `"Invite a team member"`
   (→ `/dashboard/channel-partner/team?action=invite`) — both deep-link query params that
   pre-open the respective inline form on arrival (mirrors B2B-24's own `?section=` deep-link
   pattern for quick-nav tiles).

No Known-Bugs data anywhere on this dashboard — matches B2B-24's own explicit exclusion, and this
brief's own explicit scope-out (Known Bugs aggregation is B2B-29).

### `/dashboard/channel-partner/clients` — Clients (NEW)

Client component (`ClientsClient.tsx`), fetching from `GET /api/channel-partner/clients` on mount
(mirrors `TeamClient.tsx`'s `loadX()` pattern exactly — `useState` + `useEffect` + try/catch/finally).

- Heading: `"Clients"` (`text-2xl font-bold text-white`).
- A `PrimaryButton` labeled `"Add client"`, top-right of the heading row. Clicking it (or arriving
  via `?action=add`) reveals an inline form directly below the heading (mirrors `TeamClient.tsx`'s
  `inviteFormOpen` toggle pattern):
  - Label `"Client name"`, text input, same styling as `/partner-signup`'s company-name input
    (`bg-[#0A0A0A] border-[#333333] ...`), `placeholder="Pluralsight"`, required.
  - Label `"Company URL"`, text input, identical styling, `placeholder="pluralsight.com"`,
    optional, freetext (no format enforcement beyond trim — matches this codebase's existing
    discipline of not over-validating free-text fields, e.g. `partner_accounts.name` itself, per
    B2B-25 §9 Edge Case 6's own precedent).
  - `PrimaryButton` `"Add"` (disabled while name is empty/whitespace, or while the request is
    in-flight — inline `Loader2` spinner inside the button during submit, mirroring
    `TeamClient.tsx`'s `addingSuperAdmin` spinner pattern), `SecondaryButton` `"Cancel"` closing the
    form without submitting.
  - Inline error text (`text-[#EF4444] text-xs`) on failure, same position/styling as the
    company-name validation error in `/partner-signup`.
- Below the heading/form: a plain list of existing clients, one row per client, each a `Card`:
  client name (`font-semibold text-white`), company URL directly beneath in smaller muted text
  (`COLORS.textSecondary, text-sm`) — plain text, not a clickable link (deliberately, to avoid
  scope creep into URL-validation/link-rendering polish this brief doesn't need — see §10), and a
  status badge reusing `TeamClient.tsx`'s exact `StatusBadge` styling pattern (green pill for
  `active`, since `partner_accounts.status` only has `active`/`suspended` — a suspended client shows
  the same red/muted styling this codebase already uses elsewhere for a non-active state).
- Empty state (zero clients, no form open): centered text `"No clients yet. Add your first client to
  get started."` (`COLORS.textMuted`), no illustration (matches this project's "no clip art" design
  principle carried over from the retired B2C system, still the closest applicable precedent for "no
  decorative filler").
- No edit, no delete, no per-client detail link on this screen — clicking a client row does nothing
  (not even a disabled-looking affordance); the per-client detail screen is explicitly B2B-27's job
  (§10).

### `/dashboard/channel-partner/team` — Team (NEW)

Client component (`TeamClient.tsx` — new file, distinct from and not importing
`app/dashboard/admin/team/TeamClient.tsx`, different directory, zero shared code beyond the
`_shared.tsx` design tokens both already import). Fetches `GET /api/channel-partner/team` on mount.

- Heading: `"Team"`.
- A `PrimaryButton` `"Invite a team member"`, top-right (or auto-opened via `?action=invite`).
  Inline form (same reveal pattern as Clients' "Add client"):
  - Label `"Email address"`, text input, `placeholder="you@company.com"`, required, basic email
    format check client-side (`type="email"`) — server-side Zod `.email()` is the authoritative
    check (§6.6).
  - `PrimaryButton` `"Send invite"` (disabled while empty/in-flight, spinner), `SecondaryButton`
    `"Cancel"`.
  - Inline error text on failure — including the specific case of inviting an email that already
    has a `partner_admin_users` row or a pending `partner_team_invites` row on this account:
    `"This person already has access or a pending invite."` (§8).
- Two sections below, each with its own heading:
  1. **"Team members"** — one row per `partner_admin_users` row on this sales-partner's own
     account. Each row: email (resolved via `clerkClient.users.getUser`, mirroring
     `inngest/partner-signup-reminder.ts`'s existing email-lookup pattern — see §6.7 for exactly
     where this lookup happens and why it's server-side, not stored redundantly), a role badge
     (`"Owner"` for `role='owner'`, `"Member"` for `role='member'` — reusing `StatusBadge`'s pill
     styling with `COLORS.purple`/`COLORS.textSecondary` respectively, not the pending/active/
     deactivated green/amber palette since this isn't a status field). No remove/deactivate action
     on this screen — out of scope (§10), matching the literal minimum the CEO brief asked for
     ("invites their own team members," not "manages their own team members").
  2. **"Pending invites"** — one row per `partner_team_invites` row with `status='pending'` and
     `invite_token_expires_at` in the future. Each row: invited email, `"Invited {relative date}"`
     (reuses whatever relative-date formatting convention `TeamClient.tsx` already uses for
     `invited_at`, if any exists — otherwise a plain `toLocaleDateString()`, matching the least
     invention necessary), two inline actions: `"Resend"` (re-issues a fresh token + email,
     mirrors `sales-partners/[id]/resend-invite`'s pattern) and `"Revoke"` (sets
     `status='revoked'`, mirrors the row disappearing from this list on next load — no
     confirmation dialog, matching this codebase's existing no-confirm-dialog convention for
     equivalent B2B-21 actions). Expired-but-still-`pending` rows (past `invite_token_expires_at`)
     are excluded from this list entirely (§8) — indistinguishable from never having been invited,
     except the email address remains re-inviteable.
  - Empty state for pending invites: no heading suppression — the "Pending invites" heading always
    renders; if empty, the text `"No pending invites."` (`COLORS.textMuted`) appears in place of
    rows.

### `/team-invite/accept` — Invite acceptance (NEW, public)

New page, structurally identical to `app/invite/accept/InviteAcceptClient.tsx` (B2B-21) — same
states (loading / invalid-or-expired / "sign in to accept" / accepted-redirecting / email-mismatch),
same dark-void centered-text layout, same `Loader2` spinner, same `signOut()`-and-retry flow for a
mismatched email. Two differences from the B2B-21 component:
- Copy: `"You've been invited to join {companyName}'s team on Clio."` in place of B2B-21's
  role-branded copy (there is only one role here — a plain team-member invite, no super-admin/
  sales-partner distinction to display).
- On accept, redirects to `/dashboard/channel-partner` (not `/dashboard/admin/team` or
  `/dashboard/admin/glitches`).

---

## 5. Visual Examples

### `/partner-signup` — State 1, with the new question (Desktop + Mobile, same fluid layout)

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
│     │  Do you manage multiple      │     │
│     │  clients?                    │     │
│     │  ┌───────────┐ ┌───────────┐ │     │
│     │  │    No*    │ │    Yes    │ │     │
│     │  └───────────┘ └───────────┘ │     │
│     │  * default-selected           │     │
│     │                               │     │
│     │  [       Continue       ]    │     │
│     └─────────────────────────────┘     │
└─────────────────────────────────────────┘
  Card: bg-[#111111], border-[#222222], rounded-xl, p-6, max-w-sm (fluid)
  Selected toggle: border-[#7C3AED] (2px), bg-[#7C3AED]/10, text-white
  Unselected toggle: border-[#333333], bg-[#0A0A0A], text-[#94A3B8]
```

### `/dashboard/channel-partner` — Dashboard

```
┌───────────────────────────────────────────────────────────┐
│ Clio — Sales-partner dashboard              Acme Reseller  │
├───────────────────────────────────────────────────────────┤
│ [Dashboard]  Clients  Team                                 │
├───────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Clients                                                │  │
│  │   3  clients                                           │  │
│  │   Pluralsight, Acme University, Contoso Learning       │  │
│  │                              [ View all clients → ]    │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Team                                                    │  │
│  │   4  people                                             │  │
│  │   3 active, 1 pending                                  │  │
│  │                              [ Manage team → ]         │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Billing                                                 │  │
│  │   Shared wallet billing for your clients is coming     │  │
│  │   soon.                                                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Quick links                                             │  │
│  │   [ Add a client ]   [ Invite a team member ]           │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                               │
└───────────────────────────────────────────────────────────┘
  bg-[#080808] page, Card bg-[#111111] border-[#222222], fluid clamp() container
```

### `/dashboard/channel-partner/clients` — Add-client form open

```
┌───────────────────────────────────────────────────────────┐
│ Clients                                      [ Add client ]│
├───────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────┐ │
│ │ Client name                                              │ │
│ │ ┌───────────────────────────────────────────────────┐  │ │
│ │ │ Pluralsight                                          │  │ │
│ │ └───────────────────────────────────────────────────┘  │ │
│ │ Company URL                                              │ │
│ │ ┌───────────────────────────────────────────────────┐  │ │
│ │ │ pluralsight.com                                      │  │ │
│ │ └───────────────────────────────────────────────────┘  │ │
│ │                              [ Add ]     [ Cancel ]     │ │
│ └───────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌───────────────────────────────────────────────────────┐ │
│ │ Acme University                                 [active]│ │
│ │ acme-university.edu                                      │ │
│ └───────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

### `/dashboard/channel-partner/team` — Team, invite form open + pending invite

```
┌───────────────────────────────────────────────────────────┐
│ Team                                  [ Invite a team member ]│
├───────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────┐ │
│ │ Email address                                            │ │
│ │ ┌───────────────────────────────────────────────────┐  │ │
│ │ │ jane@acmereseller.com                                │  │ │
│ │ └───────────────────────────────────────────────────┘  │ │
│ │                       [ Send invite ]     [ Cancel ]    │ │
│ └───────────────────────────────────────────────────────┘ │
│                                                               │
│ Team members                                                 │
│  owner@acmereseller.com                            [Owner]  │
│                                                               │
│ Pending invites                                               │
│  jane@acmereseller.com   Invited 2 days ago  [Resend][Revoke]│
└───────────────────────────────────────────────────────────┘
```

### `/team-invite/accept` — invited state (mirrors B2B-21's `/invite/accept` A1 state exactly)

```
┌─────────────────────────────┐
│            CLIO              │
│                               │
│  You've been invited to      │
│  join Acme Reseller's team   │
│  on Clio.                    │
│  Invited: jane@acme...com    │
│                               │
│  [   Sign in to accept   ]   │
└─────────────────────────────┘
```

---

## 6. Data Requirements

### 6.1 Schema — new migration `supabase/migrations/086_b2b26_sales_partner_entity.sql`

```sql
-- ─── partner_accounts: two new columns ─────────────────────────────────────
ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS account_kind TEXT NOT NULL DEFAULT 'partner'
    CHECK (account_kind IN ('partner', 'channel_partner'));

ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS owning_channel_partner_id UUID
    REFERENCES partner_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partner_accounts_owning_channel_partner
  ON partner_accounts(owning_channel_partner_id) WHERE owning_channel_partner_id IS NOT NULL;

-- Purely informational, distinct from outbound_base_url (the Integration
-- webhook target, B2B-27 scope). company_url is a client-identification label
-- only, shown in the sales-partner's own Clients list — never called by Clio,
-- never validated as a real reachable URL. See §6.6 "Resolved technical
-- finding" below for why this must not be conflated with outbound_base_url.
ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS company_url TEXT;

-- ─── partner_team_invites ───────────────────────────────────────────────────
-- A sales-partner's own team invites. Deliberately NOT internal_admin_users
-- (that table is B2B-21's own internal-staff concept, untouched) and
-- deliberately NOT columns bolted onto partner_admin_users (that table has no
-- pending/status concept today and every existing consumer — createOrClaim-
-- PartnerAccount's idempotency check, requirePartnerAdmin, getPartnerAccounts-
-- ForClerkUser — assumes every row it reads is already a real member; adding
-- a pending state there would force every one of those call sites to filter
-- by a new status column just to keep working, a much larger blast radius
-- than one new small table).
CREATE TABLE IF NOT EXISTS partner_team_invites (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id        UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  email                     TEXT NOT NULL,
  role                      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by_clerk_user_id  TEXT NOT NULL,
  invite_token_hash         TEXT NOT NULL,
  invite_token_expires_at   TIMESTAMPTZ NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_team_invites_account
  ON partner_team_invites(partner_account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_team_invites_token_hash
  ON partner_team_invites(invite_token_hash);

-- Case-insensitive: an email can only have one *pending* invite per account
-- at a time (§8's "already has access or a pending invite" check reads this
-- shape directly rather than needing a DB constraint to enforce it, since a
-- revoked/accepted row for the same email must remain queryable historically
-- — matching internal_admin_users' own no-hard-uniqueness-on-repeat-invites
-- precedent).
CREATE INDEX IF NOT EXISTS idx_partner_team_invites_email_pending
  ON partner_team_invites (partner_account_id, lower(email)) WHERE status = 'pending';

ALTER TABLE partner_team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on partner_team_invites"
  ON partner_team_invites FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON COLUMN partner_accounts.account_kind IS
  'B2B-26: partner = direct partner or a sales-partner-owned client (same shape). channel_partner = a sales-partner''s own account. Code-level token only — user-visible copy always says "sales-partner", never "channel_partner". See docs/specs/B2B-26-requirement-document.md §0.';
COMMENT ON COLUMN partner_accounts.owning_channel_partner_id IS
  'B2B-26: set only on a client row created by a sales-partner (account_kind=channel_partner). NULL for a direct partner or a sales-partner''s own account row.';
COMMENT ON TABLE partner_team_invites IS
  'B2B-26: pending/accepted/revoked invites for a sales-partner''s own team. Accepting creates a partner_admin_users row (role=member) on the inviting account — this table itself is never the membership record.';
```

**Resolved technical finding — `company_url` is a new column, distinct from `outbound_base_url`.**
The CEO brief's data-model section states the existing `outbound_base_url`/
`outbound_auth_token_ciphertext`/`outbound_signing_secret` columns (migration 071) are "exactly the
mechanism a client's 'webhook_url' concept needs, no new column required" — this is correct, but it
refers to a *different* URL than this brief's "company URL" field. `outbound_base_url` is the
Integration screen's webhook target (where Clio pushes content/results) — explicitly out of scope for
this brief's minimal Clients screen (§10, "no Integration fields on this screen"). This brief's
"company URL" (scope item 4's literal "name + company URL") is a purely informational label — the
client's own public website, shown so the sales-partner can visually identify which client is which in
their roster — with no functional role and no relationship to webhook routing. Conflating the two
into one field would be a real bug (a sales-partner typing "pluralsight.com" into what they think is a
harmless label field would not expect it silently interpreted as a webhook endpoint). A new, separate,
nullable `company_url TEXT` column is required and included above.

**Reused, not migrated:** `partner_accounts.name`, `.status`, `.archetype` (default `'unspecified'`,
unchanged), and every existing column and RLS policy — no existing column, policy, or constraint on
`partner_accounts` is dropped, renamed, or altered beyond the two additive columns above.

### 6.2 `lib/partner/signup.ts` — `createOrClaimPartnerAccount()` extended (not forked)

```ts
export interface ClaimResult {
  success: boolean
  alreadyMember: boolean
  partnerAccountId: string | null
  accountKind: 'partner' | 'channel_partner' | null   // NEW
  error: string | null
}

export async function createOrClaimPartnerAccount(
  clerkUserId: string,
  companyName: string,
  email: string,
  accountKind: 'partner' | 'channel_partner' = 'partner'   // NEW, defaults preserve today's behavior
): Promise<ClaimResult> {
  const existing = await getPartnerAccountsForClerkUser(clerkUserId)   // UNCHANGED call — see §6.4
  if (existing.length > 0) {
    // The account's ACTUAL kind wins, never the kind requested at this call
    // (§4 State 2b's redirect-correctness reasoning, §9 Edge Case 2).
    return { success: true, alreadyMember: true, partnerAccountId: existing[0].id, accountKind: existing[0].account_kind, error: null }
  }

  const supabase = createSupabaseAdminClient()
  const { data: account, error: acctError } = await supabase
    .from('partner_accounts')
    .insert({ name: companyName, archetype: 'unspecified', status: 'active', account_kind: accountKind })
    .select('id, account_kind')
    .single()

  if (acctError || !account) {
    return { success: false, alreadyMember: false, partnerAccountId: null, accountKind: null, error: acctError?.message ?? 'partner_accounts insert failed' }
  }

  const { error: adminError } = await supabase
    .from('partner_admin_users')
    .insert({ clerk_user_id: clerkUserId, partner_account_id: account.id, role: 'owner' })

  if (adminError) {
    return { success: false, alreadyMember: false, partnerAccountId: account.id, accountKind: account.account_kind, error: adminError.message }
  }

  // Unchanged — fires identically regardless of accountKind.
  inngest.send({ name: 'clio/partner-account.created', data: { partnerAccountId: account.id, companyName, accountKind, createdAt: new Date().toISOString() } })
    .catch((err: unknown) => console.error('[partner-signup] Failed to emit clio/partner-account.created:', err))
  await sendPartnerSignupWelcomeEmail(email, companyName).catch(
    (err: unknown) => console.error('[partner-signup] sendPartnerSignupWelcomeEmail failed:', err)
  )

  return { success: true, alreadyMember: false, partnerAccountId: account.id, accountKind: account.account_kind, error: null }
}
```

`accountKind` is emitted on `clio/partner-account.created`'s payload (new field, additive) so
`inngest/partner-signup-reminder.ts` can skip sales-partner accounts (§6.8).

### 6.3 `app/api/partner-signup/claim/route.ts` — extended body + response

```ts
const ClaimSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  managesMultipleClients: z.boolean(),   // NEW
})
// ...
const accountKind = parsed.data.managesMultipleClients ? 'channel_partner' : 'partner'
const result = await createOrClaimPartnerAccount(userId, parsed.data.companyName, primaryEmail, accountKind)
if (!result.success) {
  return NextResponse.json({ success: false, error: 'Failed to set up your account.' }, { status: 500 })
}
return NextResponse.json({ success: true, alreadyMember: result.alreadyMember, accountKind: result.accountKind })  // accountKind NEW
```

### 6.4 `app/api/webhooks/clerk/route.ts` — extended branch

```ts
if (event.data.unsafe_metadata?.signup_intent === 'partner') {
  const companyName = /* unchanged trim/empty-check */
  const managesMultipleClients = event.data.unsafe_metadata.manages_multiple_clients === true   // NEW
  const accountKind = managesMultipleClients ? 'channel_partner' : 'partner'
  if (!companyName) {
    /* unchanged hard-stop */
  } else {
    const result = await createOrClaimPartnerAccount(id, companyName, primaryEmail, accountKind)
    /* unchanged error logging */
  }
  return NextResponse.json({ received: true })
}
```

### 6.5 `lib/partner/admin-accounts.ts` — additive extension, `getPartnerAccountsForClerkUser` body UNCHANGED

**`getPartnerAccountsForClerkUser`'s query and filtering logic are not modified** — it must continue
returning every `partner_accounts` row a Clerk user administers regardless of `account_kind`, because
`createOrClaimPartnerAccount`'s idempotency check (§6.2) depends on it recognizing an existing
membership of *either* kind. Filtering it to `account_kind='partner'` only (which would otherwise be
the intuitive fix to keep sales-partner accounts out of the Configurator's account switcher) would
break that idempotency check and risk creating a second account for a sales-partner admin who
re-visits `/partner-signup` — this was identified and rejected during this spec's own drafting; see
§9 Edge Case 3 for the full reasoning and the alternative fix actually used (redirect routing, not
data filtering).

The only change is additive: the returned shape gains one field, and one new sibling function is
added.

```ts
export interface AdminPartnerAccount {
  id: string
  name: string
  account_kind: 'partner' | 'channel_partner'   // NEW — additive field, no existing consumer reads or is broken by it
}

export async function getPartnerAccountsForClerkUser(clerkUserId: string): Promise<AdminPartnerAccount[]> {
  // ... unchanged query, `.select('id, name, account_kind')` instead of `.select('id, name')` — the only line that changes
}

// NEW — used by requireChannelPartnerAdmin, the /dashboard router, and every
// app/dashboard/channel-partner/* page's own server-side account resolution.
// A Clerk user administers at most one channel_partner-kind account in
// practice (createOrClaimPartnerAccount's idempotency check guarantees a
// given Clerk user only ever gets ONE partner_accounts membership total,
// of either kind, never both) — this returns that single account or null,
// rather than an array, since every consumer needs exactly one.
export async function getChannelPartnerAccountForClerkUser(clerkUserId: string): Promise<AdminPartnerAccount | null> {
  const accounts = await getPartnerAccountsForClerkUser(clerkUserId)
  return accounts.find((a) => a.account_kind === 'channel_partner') ?? null
}
```

### 6.6 `lib/partner/auth.ts` — additive new export (`requirePartnerAdmin` gains one additive guard clause in §6.14 v1.2 — see there; this section's own `requireChannelPartnerAdmin` export is unaffected either way)

```ts
type ChannelPartnerAdminResult =
  | { clerkUserId: string; partnerAccountId: string; error: null }
  | { clerkUserId: null; partnerAccountId: null; error: NextResponse }

/**
 * B2B-26. Parallel to requirePartnerAdmin, not a variant of it — requires the
 * caller to administer a partner_accounts row that is SPECIFICALLY
 * account_kind='channel_partner'. 401 no session, 403 no membership OR the
 * membership exists but the account is account_kind='partner' (a direct
 * partner's own admin can never reach a channel-partner-only route, even for
 * their own account — these are disjoint route trees).
 */
export async function requireChannelPartnerAdmin(): Promise<ChannelPartnerAdminResult> {
  const { userId } = clerkAuth()
  if (!userId) {
    return { clerkUserId: null, partnerAccountId: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) {
    return {
      clerkUserId: null,
      partnerAccountId: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'You do not administer a sales-partner account.'), { status: 403 }),
    }
  }
  return { clerkUserId: userId, partnerAccountId: account.id, error: null }
}
```

Note this takes no `partnerAccountId` parameter, unlike `requirePartnerAdmin` — every
`/api/channel-partner/*` route acts on "the caller's own channel-partner account," resolved from the
session, never from a client-supplied id (there is exactly one such account per user, §6.5). This is a
deliberately narrower, simpler contract than `requirePartnerAdmin`'s (which must support a partner
administering multiple accounts) — correct for this brief's scope, not a regression.

### 6.7 `lib/partner/clients.ts` (NEW)

```ts
export interface ChannelPartnerClient {
  id: string
  name: string
  company_url: string | null
  status: 'active' | 'suspended'
  created_at: string
}

export async function listClientsForChannelPartner(channelPartnerAccountId: string): Promise<ChannelPartnerClient[]> {
  // SELECT id, name, company_url, status, created_at FROM partner_accounts
  // WHERE owning_channel_partner_id = channelPartnerAccountId ORDER BY created_at DESC
}

export async function createClientForChannelPartner(
  channelPartnerAccountId: string,
  name: string,
  companyUrl: string | null
): Promise<{ success: boolean; client: ChannelPartnerClient | null; error: string | null }> {
  // INSERT INTO partner_accounts (name, company_url, archetype, status, account_kind, owning_channel_partner_id)
  // VALUES (name, companyUrl, 'unspecified', 'active', 'partner', channelPartnerAccountId)
  // Zero partner_admin_users rows created — matches the brief's explicit "the
  // client never logs in" confirmation, brainstorm doc §1.
}
```

### 6.8 `lib/partner/team-invites.ts` (NEW) — reuses B2B-21's token utility directly

```ts
import { generateInviteToken, hashInviteToken, inviteExpiresAt } from '@/lib/internal-admin/invite-tokens'
// Reused verbatim, not duplicated — a generic crypto utility with zero
// role-specific logic (SHA-256 hash of a 48-hex-char token, 7-day expiry),
// exactly per the CEO brief's "do not reinvent token generation" instruction.

export async function issueTeamInvite(partnerAccountId: string, email: string, invitedByClerkUserId: string):
  Promise<{ success: boolean; error: 'already_has_access' | null }> {
  // 1. Check for an existing active partner_admin_users row for this email
  //    (via Clerk email lookup against existing admin rows' clerk_user_id —
  //    see note below) OR an existing partner_team_invites row with
  //    status='pending' for (partnerAccountId, lower(email)). If either
  //    exists, return { success: false, error: 'already_has_access' } (§8).
  // 2. generateInviteToken(); INSERT partner_team_invites (role='member',
  //    status='pending', invite_token_hash, invite_token_expires_at:
  //    inviteExpiresAt(), invited_by_clerk_user_id).
  // 3. sendPartnerTeamInviteEmail(email, inviterEmail, companyName, acceptUrl) — new email fn, §6.9.
}

export async function acceptTeamInvite(token: string, clerkUserId: string, verifiedEmail: string):
  Promise<{ success: boolean; error: 'invalid_or_used_token' | 'email_mismatch' | null; partnerAccountId: string | null }> {
  // Mirrors app/api/admin/team/invites/accept POST exactly: hash token, look
  // up by invite_token_hash + status='pending' + unexpired; verify
  // verifiedEmail matches row.email case-insensitively; on match, in one
  // transaction-equivalent (two sequential writes, matching this codebase's
  // existing no-DB-transaction discipline): UPDATE partner_team_invites SET
  // status='accepted', accepted_at=NOW(); INSERT partner_admin_users
  // (clerk_user_id, partner_account_id, role='member').
}

export async function resendTeamInvite(inviteId: string, partnerAccountId: string): Promise<{ success: boolean }> {
  // Ownership check: the invite's partner_account_id must equal the caller's
  // own (enforced by the route handler via requireChannelPartnerAdmin,
  // §6.6, before this is called — this function itself also re-checks by
  // filtering the UPDATE ... WHERE id = inviteId AND partner_account_id =
  // partnerAccountId, defense in depth). Generates a fresh token/expiry,
  // re-sends the email. Mirrors sales-partners/[id]/resend-invite's pattern.
}

export async function revokeTeamInvite(inviteId: string, partnerAccountId: string): Promise<{ success: boolean }> {
  // UPDATE partner_team_invites SET status='revoked' WHERE id = inviteId AND
  // partner_account_id = partnerAccountId AND status = 'pending'.
}

export async function listTeamAndInvites(partnerAccountId: string) {
  // Reads partner_admin_users WHERE partner_account_id = partnerAccountId
  // (role owner/member), resolves each row's email via
  // clerkClient.users.getUser(clerk_user_id) — same lookup pattern already
  // used by inngest/partner-signup-reminder.ts, not a new mechanism — plus
  // partner_team_invites WHERE partner_account_id = partnerAccountId AND
  // status = 'pending' AND invite_token_expires_at > NOW().
}
```

**Note on email resolution:** `partner_admin_users` stores only `clerk_user_id`, never an email — so
listing team members always requires a live Clerk lookup per row, exactly as
`inngest/partner-signup-reminder.ts` already does for the account owner. This is an accepted,
precedented cost (no caching layer exists for this anywhere in the codebase today), not a new
pattern.

### 6.9 `app/dashboard/page.tsx` — MODIFIED, smart router (small, additive change)

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'

export default async function DashboardPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')
  const accounts = await getPartnerAccountsForClerkUser(userId)
  if (accounts.some((a) => a.account_kind === 'channel_partner')) {
    redirect('/dashboard/channel-partner')
  }
  redirect('/dashboard/configurator')   // unchanged default — covers direct partners AND zero-membership users identically to today
}
```

`app/(auth)/sign-in/[[...sign-in]]/page.tsx`'s `fallbackRedirectUrl` changes from
`"/dashboard/configurator"` to `"/dashboard"` — the only change to that file. **Non-regression proof:**
for every existing user population (direct partners, zero-membership users, B2C-era leftover
accounts, internal-admin super-admins who happen to sign in via `/sign-in`), the router above still
resolves to `/dashboard/configurator` — byte-identical end destination to today. Only a
`channel_partner`-kind admin gets a new, correct destination. `signUpForceRedirectUrl` (→
`/partner-signup`, for a brand-new Clerk sign-up via `/sign-in`'s own "Sign up" link) is unchanged —
that visitor still lands on `/partner-signup` State 1 and answers the Yes/No question there, same as
any other new signup entry point.

### 6.10 `inngest/partner-signup-reminder.ts` — one new guard clause

```ts
const { data: account } = await supabase
  .from('partner_accounts')
  .select('onboarding_completed_at, account_kind')   // account_kind added to the existing select
  .eq('id', partnerAccountId)
  .maybeSingle()

if (!account) { /* unchanged */ }

// NEW — this brief's minimal scope defines no "onboarding completion"
// milestone for a sales-partner (no Integration/Payment steps exist for a
// channel_partner-kind account under this brief). Sending the existing
// reminder email — whose copy says "finish setting up the Configurator
// wizard" and links to /dashboard/configurator — would be actively wrong for
// this population, not just unnecessary. Skipped entirely, not deferred.
if (account.account_kind === 'channel_partner') {
  console.log(`[partner-signup-reminder] Account ${partnerAccountId} is a sales-partner account — no onboarding-completion concept in this brief, skipping.`)
  return
}

if (account.onboarding_completed_at) { /* unchanged */ }
```

### 6.11 `lib/delivery/email.ts` — one new function, `sendPartnerTeamInviteEmail` (NEW)

Same HTML skeleton/colors as `sendSalesPartnerInviteEmail` (dark-void, `#7C3AED` CTA button),
different copy and no partner-account-tagging list (this invite is scoped to one account only):

```ts
export async function sendPartnerTeamInviteEmail(
  email: string,
  inviterEmail: string,
  companyName: string,
  acceptUrl: string
): Promise<EmailResult> {
  // Subject: `You've been invited to join ${companyName}'s team on Clio`
  // Body: `${inviterEmail} has invited you to join ${companyName}'s team on
  // Clio. This invite expires in 7 days.` + the same styled CTA button
  // pointing at acceptUrl, mirroring sendSalesPartnerInviteEmail's markup
  // exactly minus the partner-accounts-list line.
}
```

### 6.12 Reads (summary, no new reads beyond what's listed above)

- `getPartnerAccountsForClerkUser` — UNCHANGED body, gains `account_kind` in its `SELECT`/return
  shape (§6.5).
- `partner_admin_users`' shape, `internal_admin_users`, `sales_partner_assignments`,
  `resolveInternalAdmin`, `requireSuperAdmin`, `requireInternalAdmin` — all completely untouched,
  verified by direct read for this spec (§1 files above). `requirePartnerAdmin` gains one additive
  guard clause as of v1.2 (§6.14) — its pre-existing Clerk-session check and `partner_admin_users`
  membership lookup are byte-identical to their pre-B2B-26 form; only a new check appended after that
  logic succeeds.

### 6.13 localStorage / sessionStorage

None. `managesMultipleClients` travels exactly like `companyName` already does (B2B-25 §6.7) — React
client-component state only, for the few seconds between State 1 and State 2/2b, never persisted.

### 6.14 Configurator entry-point gate + `requirePartnerAdmin` chokepoint guard (UI layer in v1.1, API-layer chokepoint fix added in v1.2)

**The gap, confirmed by direct grep before writing this fix:** `getPartnerAccountsForClerkUser`
(§6.5) is correctly left unfiltered by `account_kind`, because `createOrClaimPartnerAccount`'s
idempotency check depends on it. But every one of the twelve existing Configurator entry pages calls
that same unfiltered function for its own account resolution, with zero `account_kind` awareness:

```
app/dashboard/configurator/page.tsx
app/dashboard/configurator/wizard/page.tsx
app/dashboard/configurator/visualization/page.tsx
app/dashboard/configurator/integration/page.tsx
app/dashboard/configurator/content/page.tsx
app/dashboard/configurator/topics/page.tsx
app/dashboard/configurator/questionnaire/page.tsx
app/dashboard/configurator/domain/page.tsx
app/dashboard/configurator/docs/page.tsx
app/dashboard/configurator/known-bugs/page.tsx
app/dashboard/configurator/api/page.tsx
app/dashboard/configurator/api/playground/page.tsx
```

Confirmed by direct read of `app/dashboard/configurator/page.tsx` and `.../api/page.tsx`: the common
shape is either `const accounts = await getPartnerAccountsForClerkUser(userId)` (eleven pages) or
`page.tsx`'s own slightly richer version with a webhook-race retry —

```ts
let accounts = await getPartnerAccountsForClerkUser(userId)
if (accounts.length === 0) {
  // ...B2B-06 §9 retry-once-if-session-is-new logic, unchanged...
  accounts = await getPartnerAccountsForClerkUser(userId)
}
if (accounts.length === 0) return <NoPartnerAccounts />
```

— in both shapes, a `channel_partner`-kind admin's own account is a real, non-empty entry in
`accounts`, so `accounts.length === 0` is false, `<NoPartnerAccounts />` never renders, and the full
Configurator (including the Integration step and, via `/dashboard/configurator/api`, real
`partner_api_keys` issuance through `/api/admin/partner-keys`) renders live for that account.

**Fix — new filtered helper, additive, `getPartnerAccountsForClerkUser` itself untouched:**

```ts
// lib/partner/admin-accounts.ts — NEW export, v1.1
//
// Used ONLY by the twelve Configurator entry pages listed above, for their
// own accounts/<NoPartnerAccounts/> resolution. Deliberately NOT used by
// createOrClaimPartnerAccount's idempotency check (§6.2) or the /dashboard
// smart router (§6.9) — both of those must keep treating a channel_partner
// membership as a real membership. This is the one and only place
// account_kind is filtered OUT of getPartnerAccountsForClerkUser's result;
// every other caller keeps using the unfiltered function directly.
export async function getConfiguratorAccountsForClerkUser(clerkUserId: string): Promise<AdminPartnerAccount[]> {
  const accounts = await getPartnerAccountsForClerkUser(clerkUserId)
  return accounts.filter((a) => a.account_kind !== 'channel_partner')
}
```

**Applied identically at all twelve call sites** — replace `getPartnerAccountsForClerkUser(userId)`
with `getConfiguratorAccountsForClerkUser(userId)` at every `accounts = await ...` /
`let accounts = await ...` line in the twelve files above (including both occurrences inside
`page.tsx`'s retry block). No other line in any of the twelve files changes — the existing
`if (accounts.length === 0) return <NoPartnerAccounts />` check, the account-switcher rendering, and
every downstream `accounts[0].id` / `accounts.some(...)` reference all keep working unmodified,
because the filtered array is still a plain `AdminPartnerAccount[]` of the identical shape. A
`channel_partner`-kind admin who directly navigates to any of these twelve routes now sees
`<NoPartnerAccounts />` — same dead-end a zero-membership user already sees today, not a special new
message (matches this project's "no new UI for a rare, structurally-prevented path" discipline).

**Why the UI-level fix above was not sufficient on its own — confirmed by an independent count for this
revision.** v1.1 named the residual as two API routes (`/api/admin/partner-keys`,
`/api/admin/partner-accounts/*`). CEO review re-counted directly:
`grep -rl "requirePartnerAdmin(" app | grep -v lib/partner/auth.ts` returns **42 route files**, not 2
— independently reconfirmed for this revision, plus a direct read of three of them
(`app/api/admin/billing/checkout/route.ts`, `app/api/admin/configurator/wizard/go-live/route.ts`,
`app/api/admin/configurator/integration/test-outbound/route.ts`), each calling
`requirePartnerAdmin(partnerAccountId)` as their sole gate. `requirePartnerAdmin` is the single shared
chokepoint underneath essentially the entire authenticated partner-admin API surface — billing
checkout, go-live, content generation, outbound-webhook testing, OAuth-client issuance, and more.
Patching individual route handlers one at a time does not scale to this — v1.1 itself is proof: it
found and closed 2 of the 42. The correct fix lives at the chokepoint all 42 already share.

**Fix (v1.2) — one additive guard clause inside `requirePartnerAdmin` itself, `lib/partner/auth.ts`.**
The source brief's own "do not touch `requirePartnerAdmin`" constraint was written before this gap was
known to exist, on the assumption nothing in this brief would need to touch it — the CEO explicitly
directed overriding that constraint for this narrow purpose once the actual blast radius (42 routes,
not 2) was established. This is a technical/security scoping call, not a change to the underlying
product decision (§11's Q6 resolution — "management shell, never a direct-partner target" — is
unchanged; only *where* it is enforced changes, from "nowhere, reliably" to "one function every
caller already goes through"):

```ts
// lib/partner/auth.ts — requirePartnerAdmin, v1.2 addition. Runs only after
// the existing membership check succeeds (adds exactly one query on the
// already-authorized path, none on the unauthorized path). Provably a no-op
// for every account_kind='partner' row — the column's own default, i.e.
// every direct partner past and future — since only account_kind=
// 'channel_partner' is newly rejected here, and only from this one place.
export async function requirePartnerAdmin(partnerAccountId: string): Promise<PartnerAdminResult> {
  const { userId } = clerkAuth()
  if (!userId) {
    return { clerkUserId: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const supabase = createSupabaseAdminClient()
  const { data: membership } = await supabase
    .from('partner_admin_users')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  if (!membership) {
    return {
      clerkUserId: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'You do not administer this partner account.'), { status: 403 }),
    }
  }

  // NEW (v1.2) — the chokepoint fix. Same 403 shape as the missing-membership
  // case above, deliberately indistinguishable (no info leak about *why*,
  // matching this codebase's existing no-info-leak convention, e.g. B2B-21's
  // invite-accept error handling).
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('account_kind')
    .eq('id', partnerAccountId)
    .maybeSingle()

  if (account?.account_kind === 'channel_partner') {
    return {
      clerkUserId: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'You do not administer this partner account.'), { status: 403 }),
    }
  }

  return { clerkUserId: userId, error: null }
}
```

**Why this is safe and does not reopen anything already reasoned through:**
- **`requireChannelPartnerAdmin` (§6.6) is a fully separate, disjoint code path** — it does not call
  `requirePartnerAdmin` at all; it resolves the caller's own `channel_partner`-kind account directly
  via `getChannelPartnerAccountForClerkUser` and takes no `partnerAccountId` parameter. Structurally
  unaffected by this change — a sales-partner's own `/api/channel-partner/*` routes keep working
  exactly as specified in §6.6/§6.7/§6.8.
- **Every existing direct-partner call site is unaffected.** `account_kind` defaults to `'partner'` for
  every row that predates this brief and every row this brief itself creates via `createClientForChannelPartner`
  (always `account_kind='partner'`, §6.7) — the new check is a strict no-op for all of them, verified
  by construction (only the literal string `'channel_partner'` triggers the new branch).
  `partner_accounts` rows created with `account_kind='channel_partner'` only ever come from
  `createOrClaimPartnerAccount` when a sales-partner signs up (§6.2) — never from any pre-existing code
  path, since `account_kind` did not exist before this brief.
  - **This closes the entire 42-route surface, not just the two named in v1.1** — including, for a
  `channel_partner`-kind account id: `/api/admin/billing/*` (checkout, subscription, plan-subscription),
  `/api/admin/configurator/wizard/go-live`, `/api/admin/configurator/content/generate`,
  `/api/admin/configurator/integration/test-outbound`, `/api/admin/configurator/domain/custom-domain`,
  `/api/admin/configurator/oauth-clients`, `/api/partner/known-bugs/*`, `/api/admin/partner-keys`,
  `/api/admin/partner-accounts/*`, and every other current or future route that adopts
  `requirePartnerAdmin` — new routes get this protection automatically, with zero additional
  per-route work, which is the entire point of fixing the chokepoint instead of enumerating call
  sites.

### 6.15 Schema — DB-level invariant trigger (NEW in v1.1 — CEO's secondary suggestion, decided: build now)

Added to the same migration file (`086_b2b26_sales_partner_entity.sql`, §6.1), appended after the
`partner_team_invites` block:

```sql
-- ─── account_kind / owning_channel_partner_id invariants ───────────────────
-- Defense-in-depth (CEO review, v1.1): today's single write path
-- (createClientForChannelPartner, §6.7, hardcoded account_kind='partner')
-- makes a violation unreachable in practice, but B2B-27/B2B-28 will add more
-- write paths against this same table, so the invariant is enforced at the
-- DB layer now rather than left to every future write path to remember.
CREATE OR REPLACE FUNCTION check_account_kind_invariants()
RETURNS TRIGGER AS $$
BEGIN
  -- No nested sales-partner chains: a channel_partner-kind row can never
  -- itself be owned by another channel_partner-kind row.
  IF NEW.account_kind = 'channel_partner' AND NEW.owning_channel_partner_id IS NOT NULL THEN
    RAISE EXCEPTION 'A channel_partner-kind partner_accounts row cannot itself have an owning_channel_partner_id (no nested sales-partner chains)';
  END IF;

  -- owning_channel_partner_id, when set, must point at an actual channel_partner-kind row.
  IF NEW.owning_channel_partner_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM partner_accounts
      WHERE id = NEW.owning_channel_partner_id AND account_kind = 'channel_partner'
    ) THEN
      RAISE EXCEPTION 'owning_channel_partner_id must reference a partner_accounts row with account_kind = channel_partner';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_account_kind_invariants
  BEFORE INSERT OR UPDATE OF account_kind, owning_channel_partner_id ON partner_accounts
  FOR EACH ROW EXECUTE PROCEDURE check_account_kind_invariants();
```

No existing row is affected (both new columns default to values that already satisfy the invariants:
`account_kind` defaults to `'partner'`, `owning_channel_partner_id` defaults to `NULL`) — this trigger
is additive protection against future write paths, not a data migration.

---

## 7. Success Criteria (Acceptance Tests)

1. ✓ Given a visitor at `/partner-signup` State 1, when the page loads, then the new "Do you manage
   multiple clients?" toggle renders with "No" selected by default.
2. ✓ Given State 1 with "No" selected (the default, untouched), when "Continue" is clicked with a
   valid company name, then State 2's `<SignUp>` renders with
   `unsafeMetadata={{ signup_intent: 'partner', company_name: <name>, manages_multiple_clients: false }}`
   and `forceRedirectUrl="/dashboard/configurator"` — byte-identical outcome to B2B-25's existing
   behavior (non-regression).
3. ✓ Given State 1 with "Yes" selected, when "Continue" is clicked with a valid company name, then
   State 2's `<SignUp>` renders with `manages_multiple_clients: true` and
   `forceRedirectUrl="/dashboard/channel-partner"`.
4. ✓ Given a "Yes" signup completes and Clerk fires `user.created`, when the webhook processes it,
   then a `partner_accounts` row is created with `account_kind='channel_partner'`, and a
   `partner_admin_users` row (`role='owner'`) is created for that Clerk user.
5. ✓ Given a "No" signup completes, when the webhook processes it, then the resulting
   `partner_accounts` row has `account_kind='partner'` (the column's own default) — non-regression,
   verified explicitly since this is the row every existing B2B-25 acceptance test already depends on.
6. ✓ Given an already-signed-in visitor at State 1 answers "Yes" and clicks Continue, when State 2b's
   `POST /api/partner-signup/claim` succeeds, then the response includes `accountKind: 'channel_partner'`
   and the browser navigates to `/dashboard/channel-partner`.
7. ✓ Given a visitor who already administers a `partner_accounts` row with `account_kind='partner'`
   (an existing direct partner, still signed in) revisits `/partner-signup` and clicks "Yes" by
   mistake, when State 2b's claim call resolves, then `alreadyMember: true` and `accountKind: 'partner'`
   are returned (the account's real kind, not the toggle's value) and the browser navigates to
   `/dashboard/configurator` — no duplicate account, no incorrect redirect (§9 Edge Case 2).
8. ✓ Given a signed-in sales-partner (`account_kind='channel_partner'`) visits `/dashboard/channel-partner`,
   when the page loads, then `requireChannelPartnerAdmin()` resolves successfully and the Dashboard's
   four areas render with live counts.
9. ✓ Given a signed-in direct partner (`account_kind='partner'`) attempts to load
   `/dashboard/channel-partner` directly, when `requireChannelPartnerAdmin()` runs, then it returns
   403 (or the page renders an equivalent "you don't administer a sales-partner account" state) — this
   route tree is never reachable for a direct partner's own account.
9a. ✓ (NEW, v1.1 — closes the CEO review gap) Given a signed-in sales-partner
   (`account_kind='channel_partner'`, zero other memberships) manually navigates to any of the twelve
   `/dashboard/configurator/**` routes, when the page's server component calls
   `getConfiguratorAccountsForClerkUser()` (§6.14), then the returned array is empty (their own
   account is filtered out) and `<NoPartnerAccounts />` renders — the Configurator, including the
   Integration step and the API-key-issuance path (`/dashboard/configurator/api` →
   `/api/admin/partner-keys`), is never reachable via UI navigation for that account. Verified across
   all twelve routes, not just one.
9b. ✓ (NEW, v1.1) Given a user who administers both a genuine direct-partner account and a
   `channel_partner`-kind account, when they navigate to `/dashboard/configurator`, then
   `getConfiguratorAccountsForClerkUser()` returns only the `account_kind='partner'` row(s) — confirms
   the filter is additive/selective (removes only channel-partner rows), not an all-or-nothing gate.
9c. ✓ (NEW, v1.1) Given an INSERT or UPDATE on `partner_accounts` attempts to set
   `owning_channel_partner_id` to a row whose `account_kind` is not `'channel_partner'`, or attempts to
   set `account_kind='channel_partner'` while `owning_channel_partner_id` is non-null, when the
   statement executes, then `enforce_account_kind_invariants` (§6.15) raises an exception and the
   write is rejected.
9d. ✓ (NEW, v1.2 — the chokepoint fix) Given a `channel_partner`-kind account id is passed as
   `partnerAccountId` to `requirePartnerAdmin()` by a caller who genuinely administers that account
   (a real `partner_admin_users` row exists for the pair), when `requirePartnerAdmin` resolves, then it
   returns the same 403 `errorEnvelope('forbidden', ...)` shape as a missing-membership caller —
   regardless of which of the 42 `requirePartnerAdmin`-gated routes is hit. This assertion is made at
   the chokepoint level, not enumerated per-route: a parametrized/table-driven test exercising this
   through at least `/api/admin/partner-keys`, `/api/admin/billing/checkout`, and
   `/api/admin/configurator/wizard/go-live` (three routes spanning three different route families —
   key management, billing, configurator) is sufficient to demonstrate the shared-function property,
   not a requirement to individually test all 42.
9e. ✓ (NEW, v1.2) Given the identical caller/account pair as AT-9d but with `account_kind='partner'`
   (the default — every direct partner past and future), when `requirePartnerAdmin` resolves, then it
   succeeds exactly as it did before this revision — confirms the v1.2 guard clause is a strict no-op
   for the population every existing acceptance test (B2B-02 through B2B-25) already depends on.
9f. ✓ (NEW, v1.2) Given a sales-partner calls any `/api/channel-partner/*` route (gated by
   `requireChannelPartnerAdmin`, §6.6 — a fully separate code path that never calls
   `requirePartnerAdmin`), when the route resolves, then it succeeds exactly as specified in §6.6-6.8 —
   confirms the v1.2 guard clause on `requirePartnerAdmin` has zero effect on this brief's own new
   sales-partner-facing routes (non-regression against this document's own scope).
10. ✓ Given a sales-partner submits "Add client" with name `"Pluralsight"` and company URL
    `"pluralsight.com"`, when `POST /api/channel-partner/clients` succeeds, then a new
    `partner_accounts` row is created with `account_kind='partner'`,
    `owning_channel_partner_id = <the sales-partner's own account id>`, `company_url='pluralsight.com'`,
    and zero `partner_admin_users` rows.
11. ✓ Given the same sales-partner reloads `/dashboard/channel-partner/clients`, when the page fetches
    `GET /api/channel-partner/clients`, then the newly created client appears in the list with its
    name, company URL, and `active` status — and no other sales-partner's clients ever appear (scoped
    strictly to `owning_channel_partner_id = <caller's account id>`).
12. ✓ Given a sales-partner submits "Invite a team member" with a valid email, when
    `POST /api/channel-partner/team/invite` succeeds, then a `partner_team_invites` row is created
    (`status='pending'`, a fresh token hash, 7-day expiry) and `sendPartnerTeamInviteEmail` is called.
13. ✓ Given the invitee opens the emailed link, when `GET /team-invite/accept?token=...` resolves,
    then the page shows `"You've been invited to join {companyName}'s team on Clio."` with the invited
    email address.
14. ✓ Given the invitee signs in (or up) with the exact invited email and the page auto-fires
    `POST /api/team-invite/accept`, when it succeeds, then a `partner_admin_users` row
    (`role='member'`) is created on the inviting sales-partner's account, the `partner_team_invites`
    row is updated to `status='accepted'`, and the browser redirects to `/dashboard/channel-partner`.
15. ✓ Given the invitee then visits `/dashboard/channel-partner`, when `requireChannelPartnerAdmin()`
    resolves, then it succeeds (their new `partner_admin_users` membership grants access identically
    to the owner's) — confirming "full access" for a non-owner team member reaches every screen this
    brief builds (Dashboard, Clients, Team), since none of them currently branches on `role` at all
    (§8 — there is no billing UI to gate in this brief's scope, per CEO Q4).
16. ✓ Given a sales-partner clicks "Resend" on a pending invite, when
    `POST /api/channel-partner/team/invite/[id]/resend` succeeds, then the invite's token hash and
    expiry are refreshed and a new email is sent; the OLD token (from the original invite email) no
    longer resolves via `GET /team-invite/accept` (§8).
17. ✓ Given a sales-partner clicks "Revoke" on a pending invite, when
    `POST /api/channel-partner/team/invite/[id]/revoke` succeeds, then the row's `status` becomes
    `'revoked'`, it disappears from the Team page's "Pending invites" list on next load, and the
    original token no longer resolves.
18. ✓ Given a returning sales-partner signs in via `/sign-in` (not `/partner-signup`), when Clerk's
    `fallbackRedirectUrl="/dashboard"` fires, then `app/dashboard/page.tsx`'s smart router resolves
    their `account_kind='channel_partner'` membership and redirects to `/dashboard/channel-partner` —
    not `/dashboard/configurator`.
19. ✓ Given a returning direct partner (or any user with zero/`'partner'`-only memberships) signs in
    via `/sign-in`, when the same smart router runs, then it redirects to `/dashboard/configurator` —
    byte-identical to today's pre-this-brief behavior (non-regression, explicitly re-verified since
    `/sign-in`'s redirect target itself changed).
20. ✓ Given `clio/partner-account.created` fires for a `channel_partner`-kind account, when
    `inngest/partner-signup-reminder.ts`'s 24-hour sleep elapses, then the function reads
    `account_kind='channel_partner'` and returns early without sending any email — confirmed by a
    unit/integration test asserting `sendPartnerSignupReminderEmail` is never called for this
    `accountKind`.
21. ✓ `npx tsc --noEmit` clean; `npm run build` passes; no unapproved packages introduced; every new
    screen uses only `_shared.tsx`'s existing `COLORS`/`Card`/`PrimaryButton`/`SecondaryButton` tokens
    plus the `/partner-signup`-precedented input/toggle styling — no new colors or components invented.
22. ✓ Given `partner_admin_users`'s existing shape, `internal_admin_users`, `sales_partner_assignments`,
    and every file under `lib/internal-admin/*`, when this brief ships, then none has been modified
    (grep/diff check, mirrors B2B-21/B2B-25's own non-regression constraint). `requirePartnerAdmin`
    is explicitly excluded from this check as of v1.2 — see AT-9d/9e/9f instead, which assert its
    pre-existing logic is unchanged and its one new guard clause is a provable no-op for
    `account_kind='partner'`.

---

## 8. Error States

| Surface | Failure | Behavior |
|---|---|---|
| `/partner-signup` State 1 | Empty company name (unchanged from B2B-25) | Inline error, no advance (unchanged) |
| `/partner-signup` State 1 | Yes/No toggle — no failure mode exists (always has a default value) | N/A |
| `POST /api/webhooks/clerk`, partner branch | `manages_multiple_clients` missing/non-boolean in `unsafe_metadata` | Treated as `false` (`=== true` strict check, §6.4) — a malformed/absent value degrades to the safe default (direct partner), never silently creates a sales-partner account from ambiguous input |
| `POST /api/partner-signup/claim` | `managesMultipleClients` missing or non-boolean in the request body | `422` Zod validation error (schema requires the field, unlike the webhook's lenient fallback — this route only ever receives a request from this brief's own client code, which always sends a real boolean; a malformed body here indicates a client bug worth surfacing loudly, not defaulting silently) |
| `POST /api/channel-partner/clients` | No session, or session doesn't administer a `channel_partner`-kind account | 401 / 403 via `requireChannelPartnerAdmin()` (§6.6) |
| `POST /api/channel-partner/clients` | `name` missing/empty | `422` Zod validation error, inline error shown on the Add-client form |
| `POST /api/channel-partner/clients` | Supabase insert fails | `500`, inline error `"Couldn't add this client. Try again."` on the form (matches this codebase's plain-language error-copy convention) |
| `POST /api/channel-partner/team/invite` | Invited email already has a `partner_admin_users` row OR a pending `partner_team_invites` row on this account | `409`, inline error `"This person already has access or a pending invite."` (§6.8) |
| `POST /api/channel-partner/team/invite` | Malformed email | `422` Zod `.email()` validation error |
| `GET /team-invite/accept` (lookup) | Token not found, already accepted, revoked, or expired | Same no-info-leak discipline as B2B-21 (`{ valid: false }`, 200) — page shows `"This invite link is no longer valid."` |
| `POST /api/team-invite/accept` | Signed-in email doesn't match the invited email | `409`, page shows the email-mismatch state + "Sign out" button (mirrors B2B-21's State A3 exactly) |
| `POST /api/team-invite/accept` | Token invalid/expired/already used | `422`, page shows the invalid-link state |
| `POST /api/channel-partner/team/invite/[id]/resend` | Invite id doesn't belong to caller's account | `404` (not `403` — no info leak about whether the id exists at all under another account, matching this codebase's existing discipline for cross-tenant id guesses) |
| `POST /api/channel-partner/team/invite/[id]/revoke` | Invite already accepted/revoked | `409`, no-op with an inline `"This invite is no longer pending."` message |
| `/dashboard/channel-partner` (all three pages) | `requireChannelPartnerAdmin()` fails (403) | Renders a plain centered message `"You don't administer a sales-partner account."` — same minimal-dead-end pattern as `<NoPartnerAccounts />`, new sibling component `<NoChannelPartnerAccount />` (§4 State 2, §9 Edge Case 1) |
| `GET /api/channel-partner/clients` or `.../team` | Network/server error on initial load | Inline `"Couldn't load your {clients/team}."` with no retry button in this minimal scope (matches `TeamClient.tsx`'s own existing `salesPartnersError`/`superAdminsError` boolean-flag pattern — a manual page refresh is the only recovery, precedented) |

---

## 9. Edge Cases

1. **Webhook race for a brand-new sales-partner (State 2's redirect fires before the webhook lands).**
   Identical in kind to B2B-25's own accepted race for direct partners (§7 AT-7 there). This brief's
   new `<NoChannelPartnerAccount />` (§8) is the equivalent placeholder for `/dashboard/channel-partner`
   — a static "You don't administer a sales-partner account" message, resolved by a manual refresh
   once the webhook completes, exactly matching the existing precedent rather than inventing a new
   auto-retry mechanism this codebase has never used anywhere.
2. **An existing direct partner (`account_kind='partner'`), still signed in, revisits `/partner-signup`
   and clicks "Yes" out of curiosity or confusion.** Resolved in-brief (§4 State 2b, §6.2): the claim
   response's `accountKind` always reflects the account's *actual, already-existing* kind
   (`alreadyMember: true` short-circuits before any new row or kind is considered), never the toggle's
   momentary value. The user is redirected to `/dashboard/configurator` (their real destination),
   not `/dashboard/channel-partner`. No duplicate account, no incorrect landing.
3. **Why `getPartnerAccountsForClerkUser` is not filtered by `account_kind` — and why the Configurator
   and every `requirePartnerAdmin`-gated route are nonetheless now fully closed to a sales-partner
   account. RESOLVED in this revision (v1.2), not deferred.** The intuitive fix for "a sales-partner
   admin should never see their own account in the Configurator's account picker" would be to filter
   `getPartnerAccountsForClerkUser` itself to `account_kind='partner'` only. Still rejected, unchanged
   since v1.0: `createOrClaimPartnerAccount`'s idempotency check (§6.2) calls that exact function, and
   filtering it there would make a sales-partner's *own* account invisible to its own idempotency
   check, risking a second `partner_accounts` row on a future `/partner-signup` revisit.
   **What changed across revisions:** v1.0 reasoned that leaving the Configurator's twelve entry pages
   unfiltered was an "accepted, narrow, self-inflicted gap." CEO review of v1.0 independently
   re-verified this was not narrow or cosmetic — a `channel_partner`-kind admin who simply typed
   `/dashboard/configurator` would see the full Configurator render live, including real
   `partner_api_keys` issuance via `/api/admin/partner-keys` — and v1.1 fixed the *UI navigation* path
   with `getConfiguratorAccountsForClerkUser()` (§6.14, §7 AT-9a/9b). CEO review of v1.1 then found
   that fix, while correct as far as it went, still understated the remaining exposure: `requirePartnerAdmin`
   is the sole gate on 42 route files (independently reconfirmed for this revision, §6.14), not the 2
   named in v1.1 — meaning a `channel_partner`-kind admin who knew their own account id could still
   operate it as a live direct partner across billing, go-live, content generation, and OAuth-client
   issuance, entirely bypassing the UI-level fix. **Final fix (v1.2, §6.14):** one additive guard
   clause inside `requirePartnerAdmin` itself — the chokepoint every one of those 42 routes already
   shares — rejecting any `channel_partner`-kind `partnerAccountId` with the same 403 shape as a
   missing membership, provably a no-op for every `account_kind='partner'` row. This closes the gap at
   its actual root: not just today's known call sites, but any future route that adopts
   `requirePartnerAdmin` inherits the protection automatically (§7 AT-9d/9e/9f). No residual is logged
   for this edge case as of v1.2 — the source brief's own "do not touch `requirePartnerAdmin`"
   constraint was explicitly overridden by the CEO for this narrow purpose once the true blast radius
   was established (§6.14), a technical/security scoping call within CEO authority that leaves Arun's
   own Q6 product decision (§11) unchanged.
4. **A client row's `company_url` containing no protocol, or being left blank.** No format
   enforcement (§4, §6.1) — rendered as plain text, never treated as a clickable link in this minimal
   scope, so a malformed/missing value has no functional consequence, only a cosmetic gap (an empty
   line where the URL would show) — acceptable for an MVP screen whose own scope statement explicitly
   excludes URL/link polish.
5. **Two sales-partner admins add a client with the same name simultaneously.** No uniqueness
   constraint on `partner_accounts.name` (matches the existing precedent for direct-partner company
   names, B2B-25 §6.2) — both succeed, two distinct client rows are created. Not a real-world risk
   given `owning_channel_partner_id` scopes each sales-partner's own roster independently.
6. **An invite is sent to an email that is also the sales-partner account's own owner email.** The
   `already_has_access` check (§6.8, §8) catches this — the owner already has a `partner_admin_users`
   row, so the invite is rejected with the same message as any other already-has-access case. No
   special-cased "you can't invite yourself" copy — the generic message is accurate and sufficient.
7. **A revoked or expired invite's token is reused (stale email link).** `GET`/`POST /team-invite/accept`
   both filter on `status='pending'` and unexpired — a revoked or expired row simply doesn't match,
   producing the same "no longer valid" state as a never-existed token (§8's no-info-leak discipline,
   mirroring B2B-21 exactly).
8. **Mobile vs desktop.** Every new screen uses `SHELL_CONTENT_STYLE`'s existing `clamp()`-based fluid
   container (§4) — no new responsive behavior invented; the Add-client/Invite forms' two-field stacks
   already read naturally single-column at any width (no side-by-side layout to collapse).
9. **A sales-partner with zero clients and zero team members beyond themselves views the Dashboard.**
   All three relevant areas render their explicit empty/singular states (§4: "No clients yet.",
   `"1 people" — a` deliberately-accepted minor grammatical rough edge for `N=1`, matching this
   codebase's existing precedent of not special-casing singular/plural text anywhere else in Clio's own
   admin surfaces, e.g. B2B-24's own count displays) — no error, no crash, a fully legitimate first-run
   state.

---

## 10. Out of Scope

Everything the CEO brief itself named as deferred, unchanged:
- **Per-client detail screen** (Integration fields, usage cap, routing-address field) — B2B-27.
- **`*.hello-clio.com` subdomain routing layer** — separate brief, unchanged. No routing-address field
  anywhere in this brief's Clients screen, not even a placeholder (§4).
- **Per-client behavior/voice/language configuration UI** — separate brief.
- **Sales-partner billing** (shared wallet, per-client usage/caps, consolidated invoice) — B2B-28. This
  brief's Dashboard shows only the "Billing — coming soon" placeholder (§4). No Stripe changes.
- **Known Bugs aggregation for sales-partners** — B2B-29.
- **Renaming B2B-21's `sales_partner` role to `internal-staff`** — separate brief, not touched here.

Additional items this BA spec itself is scoping out, within BA authority (technical/UI minimality, not
product-shape changes):
- **Removing or deactivating an existing team member.** Only inviting is in scope (§4 Team screen);
  matches the CEO brief's literal phrasing ("invites their own team members").
- **Editing or deleting a client** once added. Only "Add client" + list is in scope (§4).
- **Clickable/validated `company_url` links.** Rendered as plain text (§4, §9 Edge Case 4).
- ~~Hard-blocking a sales-partner's own account from `requirePartnerAdmin`-gated API routes when
  called directly.~~ **Resolved as of v1.2, no longer out of scope** — `requirePartnerAdmin` itself now
  rejects any `channel_partner`-kind `partnerAccountId` (§6.14), closing both the UI navigation path
  (v1.1) and the direct-API-call path (v1.2) across all 42 routes it gates, present and future.
- **Any confirmation dialog on "Revoke."** Matches this codebase's existing no-confirm-dialog
  convention for equivalent B2B-21 actions (deactivate super-admin, etc.).
- **A `super_admin`/internal-admin view of all sales-partners and their clients** (brainstorm doc §1's
  "super-admin sees every partner and every sales-partner" visibility rule). Real, and eventually
  needed, but not named in this brief's own scope items (1-6) — logged here rather than invented, since
  building it would require touching B2B-21's `TeamClient.tsx`/admin surfaces, explicitly listed as
  untouched in Known Constraints. Candidate for a future admin-side follow-on brief.

---

## 11. Open Questions

None.

**Judgment call resolved (CEO brief's Q6 — can a sales-partner's own account ever also be a direct
partner with its own Configurator?):** No — a sales-partner's own account (`account_kind='channel_partner'`)
is strictly a management shell; all real product usage (Integration, sessions, meeting-bot dispatch)
happens on client rows (`account_kind='partner'`, `owning_channel_partner_id` set), never on the
sales-partner's own row. Grounded directly in the brainstorm doc's Scenario B language (§2 there):
"ai-learn creates a client record for Pluralsight... inside their dashboard" — every concrete action
described happens *through* client records, never on ai-learn's own account. Nothing in the brainstorm
doc's terminology table, visibility rules, or billing model (§4 there: "their clients never pay Clio
directly," implying the sales-partner itself never runs billable sessions either) describes the
sales-partner's own account as ever being a direct integration target. **As of v1.2, this is now
genuinely, fully enforced — not merely reflected in navigation, and not just at the UI layer:**
`/dashboard/channel-partner`'s 3-item nav (§4) has no Configurator/API/Docs/Known-Bugs tabs at all;
the smart router (§6.9) never sends a `channel_partner`-kind admin toward `/dashboard/configurator`;
`getConfiguratorAccountsForClerkUser()` (§6.14, v1.1) filters `channel_partner`-kind accounts out of
every one of the twelve Configurator entry points' own account resolution, closing direct URL
navigation; and — the gap CEO review of v1.1 found and required fixed — `requirePartnerAdmin` itself
(§6.14, v1.2) now rejects any `channel_partner`-kind `partnerAccountId` with the same 403 shape as a
missing membership, closing every one of the 42 routes it gates (billing, go-live, content generation,
API keys, OAuth clients, and any future route that adopts it) to direct, non-UI API calls as well. A
DB-level trigger (§6.15) additionally makes the underlying data-model relationship itself
self-enforcing (a `channel_partner`-kind row can never carry a non-null `owning_channel_partner_id`).
No residual gap is logged for this judgment call as of v1.2 — see §9 Edge Case 3 for the full
revision-by-revision history of how each layer was closed.

Every other question the CEO brief posed ("Questions for BA" 1-5) is resolved directly in the section
noted: naming (§0), the State 1 screen addition (§4/§5), `requireChannelPartnerAdmin`'s exact
401/403 shapes (§6.6), the team invite flow end-to-end (§4 Team screen, §6.8, §7 AT-12-17, §8), and
the Dashboard's four areas with wireframes (§4, §5). Per this project's governance, Section 11 is
empty and this spec is ready for CEO review.

---

## 12. Dependencies

**Must be true before build (all confirmed present, read directly for this spec):**
- `app/partner-signup/[[...partner-signup]]/page.tsx`, `lib/partner/signup.ts`,
  `app/api/partner-signup/claim/route.ts`, `app/api/webhooks/clerk/route.ts` — B2B-25's shipped State
  1/2/2b flow and `createOrClaimPartnerAccount()`, extended not forked.
- `partner_accounts` / `partner_admin_users` (migration 071) — unchanged shape, two new additive
  columns on the former only (§6.1).
- `lib/internal-admin/invite-tokens.ts` — `generateInviteToken`/`hashInviteToken`/`inviteExpiresAt`,
  reused verbatim (§6.8).
- `app/invite/accept/InviteAcceptClient.tsx` — accept-flow UI pattern reused (not its table) for the
  new `/team-invite/accept` (§4).
- `app/dashboard/configurator/_shared.tsx` — `COLORS`, `Card`, `PrimaryButton`, `SecondaryButton`,
  `SHELL_CONTENT_STYLE` design tokens, imported directly (generic, not Configurator-specific logic).
- `middleware.ts` — `/partner-signup(.*)` and `/invite/accept(.*)` public-route precedent, extended by
  one new entry (`/team-invite/accept(.*)`).

**New files:**
- `supabase/migrations/086_b2b26_sales_partner_entity.sql` (§6.1)
- `lib/partner/clients.ts` (§6.7)
- `lib/partner/team-invites.ts` (§6.8)
- `app/api/channel-partner/clients/route.ts` (GET, POST)
- `app/api/channel-partner/team/route.ts` (GET)
- `app/api/channel-partner/team/invite/route.ts` (POST)
- `app/api/channel-partner/team/invite/[id]/resend/route.ts` (POST)
- `app/api/channel-partner/team/invite/[id]/revoke/route.ts` (POST)
- `app/api/team-invite/accept/route.ts` (GET, POST — §4, §8)
- `app/dashboard/channel-partner/page.tsx` (Dashboard, §4)
- `app/dashboard/channel-partner/clients/page.tsx` + `ClientsClient.tsx`
- `app/dashboard/channel-partner/team/page.tsx` + `TeamClient.tsx` (new file, distinct from
  `app/dashboard/admin/team/TeamClient.tsx`)
- `app/team-invite/accept/page.tsx` + `TeamInviteAcceptClient.tsx`

**Modified files:**
- `app/partner-signup/[[...partner-signup]]/page.tsx` — new Yes/No toggle in State 1; conditional
  `forceRedirectUrl`/`unsafeMetadata` in State 2; response-driven redirect in State 2b (§4).
- `lib/partner/signup.ts` — `createOrClaimPartnerAccount` gains `accountKind` param + `accountKind` in
  `ClaimResult` (§6.2).
- `app/api/partner-signup/claim/route.ts` — `managesMultipleClients` in request body,
  `accountKind` in response (§6.3).
- `app/api/webhooks/clerk/route.ts` — reads `manages_multiple_clients`, passes `accountKind` through
  (§6.4).
- `lib/partner/admin-accounts.ts` — `AdminPartnerAccount` gains `account_kind`; new
  `getChannelPartnerAccountForClerkUser` export (§6.5); new
  `getConfiguratorAccountsForClerkUser` export (§6.14, added v1.1).
- `lib/partner/auth.ts` — new `requireChannelPartnerAdmin` export (§6.6); **(added v1.2, §6.14)**
  `requirePartnerAdmin` itself gains one additive guard clause rejecting `channel_partner`-kind
  `partnerAccountId`s, overriding the source brief's original "do not touch `requirePartnerAdmin`"
  constraint per the CEO's explicit v1.2 direction — provably a no-op for every `account_kind='partner'`
  row (§7 AT-9e).
- `app/dashboard/page.tsx` — smart router (§6.9).
- `app/(auth)/sign-in/[[...sign-in]]/page.tsx` — `fallbackRedirectUrl` → `/dashboard` (§6.9).
- `inngest/partner-signup-reminder.ts` — `account_kind` guard clause (§6.10).
- `lib/delivery/email.ts` — new `sendPartnerTeamInviteEmail` export (§6.11).
- `middleware.ts` — add `/team-invite/accept(.*)` to `isPublicRoute`.
- **(Added v1.1, §6.14)** The twelve existing Configurator entry points — `getPartnerAccountsForClerkUser(userId)`
  swapped for `getConfiguratorAccountsForClerkUser(userId)` at every account-resolution call site, no
  other line changed:
  `app/dashboard/configurator/page.tsx`, `wizard/page.tsx`, `visualization/page.tsx`,
  `integration/page.tsx`, `content/page.tsx`, `topics/page.tsx`, `questionnaire/page.tsx`,
  `domain/page.tsx`, `docs/page.tsx`, `known-bugs/page.tsx`, `api/page.tsx`, `api/playground/page.tsx`.
- `docs/b2b-pivot-status.md` — Live Status table entry for B2B-26 updated on merge (Orchestrator's
  standing responsibility, not a file this spec hands to Dev).

**Explicitly not touched (verified by direct read for this spec, per Known Constraints):**
`lib/partner/auth.ts`'s `requirePartnerApiKey` function body (unrelated auth system entirely — partner
API-key/OAuth2 authentication, §1 of that file's own header comment — never touched by this brief in
any revision); `requirePartnerAdmin`'s pre-existing logic (the Clerk-session check and the
`partner_admin_users` membership lookup, both byte-identical to their pre-B2B-26 form) — only one new
guard clause is appended after that existing logic succeeds (§6.14, v1.2); `partner_admin_users`'
existing schema/RLS (migration 071, beyond the two additive `partner_accounts` columns in §6.1),
`internal_admin_users`, `sales_partner_assignments`, every file under `lib/internal-admin/*`
(`auth.ts`, `invite-tokens.ts` — imported from, not modified), `app/api/admin/team/sales-partners/*`,
`app/dashboard/admin/team/TeamClient.tsx`, `app/invite/accept/*`,
`app/api/admin/glitches/route.ts`'s existing `sales_partner` scoping. **Note on the source brief's
"do not touch `requirePartnerAdmin`" constraint:** that constraint is explicitly superseded for this
one additive guard clause, per the CEO's direct v1.2 instruction, once the true scope of leaving it
untouched was established (42 routes, not 2) — documented in §6.14's revision history, not a unilateral
BA decision to override a stated constraint. The twelve `app/dashboard/configurator/**/page.tsx` entry
points are listed under **Modified files** above (v1.1, §6.14) — their account-resolution call site
changed; every other line in each of those twelve files remains untouched.

**No `BACKLOG.md` entry required for this brief's own scope** — as of v1.2, no residual gap remains in
the `account_kind` enforcement chain (§9 Edge Case 3, §11); the item that occupied this note in v1.1
(the direct-API-call residual) is resolved, not deferred, and removed from §10 accordingly.

---

*End of Requirement Document B2B-26 v1.3 — APPROVED, cleared for Dev. All 12 sections filled, Section
11 empty. Revised per CEO review of v1.0 (§6.14 Configurator entry-point gate, §6.15 DB invariant
trigger), v1.1 (§6.14 extended to the `requirePartnerAdmin` chokepoint, closing all 42 gated routes),
and v1.2 (copy-consistency pass — three stale "`requirePartnerAdmin` untouched" claims corrected to
match the v1.2 chokepoint fix; no substance change).*
