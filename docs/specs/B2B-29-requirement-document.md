# B2B-29 — Post-Signup Onboarding (No Pre-Signup Company Capture) & Per-Client "Configure" Screen — Requirement Document
Version: 1.0
Status: DRAFT — pending CEO review
Author: Business Analyst Agent
Date: 2026-07-19
Source brief: `.claude/agents/clio/feature-briefs/B2B-29-post-signup-onboarding-and-client-configure.md`

> Scope in one line: `/partner-signup` and `/partner-invite/accept` drop their pre-signup "Company
> name" capture entirely (both land signed-out visitors straight into Clerk `<SignUp>`, no
> interstitial of any kind); every `partner_accounts` row this brief's write paths create is
> seeded with a fixed placeholder name (`"Unnamed partner"`) instead; a new "Company info" card
> (Configurator Dashboard tab, reused by direct partners and, via Scope C, by sales-partner-managed
> clients) and a new `/dashboard/channel-partner/settings` page (Company info + Payment, for the
> sales-partner's own account) let the real name and a card get added post-signup, non-blocking;
> a new client-detail page + a client-scoped "Configure" route tree reuse the existing
> `ConfiguratorSurface`/`ConfiguratorNavShell`/`ApiClient`/`DocsClient`/`KnownBugsClient`/
> `PlaygroundClient`/`PaymentConfigClient`/`GoLivePanel`/`DashboardPanel` components **verbatim**
> (zero fork), made possible by threading two small new optional props (`basePath`, `navLabel`)
> through the handful of files that hardcode the `/dashboard/configurator` base path and the
> "Configurator" nav-tab label — both props default to today's exact literals, so direct-partner
> behavior and copy are provably unaffected. Authorization for the new client-scoped routes is a
> **single chokepoint fix** inside `requirePartnerAdmin()` (`lib/partner/auth.ts`) — a new fallback
> branch, reached only when no direct membership exists, that grants access when the target
> account's `owning_channel_partner_id` matches a channel-partner account the caller administers.
> This one function change covers all ~43 existing `requirePartnerAdmin`-gated routes with zero
> per-route edits, mirroring the B2B-26 §6.14 chokepoint precedent already in this file. A second,
> smaller function (`requireChannelPartnerClientAccess`) does the same ownership check for the new
> page-level (SSR) gates. **No new migration** — every column and table this brief needs
> (`owning_channel_partner_id`, `company_url`, `partner_wallets.stripe_default_payment_method_id`)
> already exists from B2B-26/B2B-27.

Every code-level identifier and route this brief introduces was checked against the live codebase
(read, not guessed) before being finalized — see the file-by-file diff list in §6.0.

---

## 0. Naming & Technical Decisions (read first — governs every section below)

The CEO brief left five points to BA discretion (its own "Questions for BA" list) and flagged that
resolving the ownership-check pattern might reveal more implementation detail than the five bullets
alone suggest. It did. Resolved below, all as technical decisions — none of these touch product
shape, so none are escalated to Arun (Section 11 is empty).

| # | Open point (from CEO brief) | Resolution |
|---|---|---|
| 1 | Placeholder `partner_accounts.name` string | **`"Unnamed partner"`** — a fixed literal, not an email-derived string. Rejected email-derivation because `partner_accounts.name` is displayed in multiple admin/partner-facing lists (`/dashboard/admin/sales-partners`, the sales-partner's own Clients list) and embedding a personal email address into a display name is an avoidable, unforced privacy leak for zero benefit — the account's real name is collected within one dashboard visit anyway (§4). |
| 2 | Where a direct partner's post-invite company name gets collected | A new **"Company info" card on the Configurator's existing Dashboard tab** (`DashboardPanel.tsx`, always visible, not gated by `VISIBLE_SECTIONS`). This is the smallest-diff answer: `DashboardPanel` already renders unconditionally for every direct partner the instant they land on `/dashboard/configurator`, needs no new nav entry, and — because Scope C reuses `DashboardPanel` verbatim for the client-scoped Configure surface too — the same card transparently lets a sales-partner correct a client's name from within Configure, at zero extra cost. Backed by a new `GET`/`PATCH /api/admin/configurator/account` route, gated by the same `requirePartnerAdmin` every other Configurator route uses (so it automatically benefits from this brief's own chokepoint fix and works for both a direct partner's own account and a sales-partner-managed client). |
| 3 | Exact placement/label of "Company info" within `ChannelPartnerShell` | A 4th top-nav tab, **"Settings"**, added to `ChannelPartnerShell` (`Dashboard \| Clients \| Team \| Settings`), at route `/dashboard/channel-partner/settings`. One page holding two cards — "Company info" and "Payment" — rather than two separate nav items, since each is a small, single-purpose form; two tabs for two three-field forms would be nav-item inflation for no navigational benefit. |
| 4 | Route slug for the per-client Configure screen | The route **does** say "configure": `/dashboard/channel-partner/clients/[id]/configure` (+ sibling `/api`, `/api/playground`, `/docs`, `/known-bugs`). This is a brand-new route tree with no back-compat constraint, so there is no reason for the URL to disagree with the label Arun corrected ("Configure"). The existing direct-partner route `/dashboard/configurator` is **not** renamed — Arun's correction was about the new client-facing surface being proposed to him, not an instruction to rename the established direct-partner route, and renaming it would violate the brief's own non-regression requirement for zero reason. |
| 5 | Full route enumeration + ownership-check pattern for client-scoped Configurator access | Two-part answer, detailed in §6.6–§6.9: (a) a **chokepoint fallback inside `requirePartnerAdmin()`** covers every existing `requirePartnerAdmin`-gated API route (full list in §6.9, 43 files, zero per-route changes); (b) a new **`requireChannelPartnerClientAccess(clientAccountId)`** function gates the 6 new page-level (SSR) routes this brief adds under `/dashboard/channel-partner/clients/[id]/...`. |

**A sixth finding, not on the CEO brief's list, surfaced by reading the actual reused components
(not just their names) — load-bearing for "verbatim reuse, no fork":**

`ConfiguratorSurface.tsx` and seven of the components it renders (`_shared.tsx`'s
`ConfiguratorNavShell`, `IntegrationClient.tsx`, `PaymentConfigClient.tsx`, `ApiClient.tsx`,
`DocsClient.tsx`, `PlaygroundClient.tsx`, `DashboardPanel.tsx`) **hardcode the literal string
`/dashboard/configurator`** in every internal nav link, back-link, and Stripe-return `router.replace`
call (23 call sites total, enumerated in §6.1). Reusing these components as-is for a client-scoped
Configure surface — without addressing this — would mean every "API" tab click, "back" link, and
Stripe-checkout return from inside a client's Configure screen silently kicks the sales-partner out
to their own (inapplicable) `/dashboard/configurator` route instead of staying inside
`/dashboard/channel-partner/clients/[id]/configure/...`. This is not a hypothetical: `getConfiguratorAccountsForClerkUser`
would then resolve *the sales-partner's own* memberships (which, being `channel_partner`-kind, is
filtered to an empty list — see `admin-accounts.ts` line 71-74), landing them on `<NoPartnerAccounts />`
mid-task. **Resolution:** add two new optional props — `basePath` (default `'/dashboard/configurator'`)
and `navLabel` (default `'Configurator'`) — threaded through exactly these 8 files. Every existing
call site (`/dashboard/configurator/**/page.tsx`, all 12 of them, none in this list) passes neither
prop, so it gets the exact literal defaults it already renders today — **zero behavior or copy
change for any direct partner**, confirmed by inspecting every one of the 23 call sites individually
(§6.1). This is what makes the reuse genuinely verbatim rather than a hidden fork: the component
tree, JSX structure, and business logic are byte-identical; only two prop *values* differ per caller.

---

## 1. Purpose

Two related gaps, one root cause: an earlier Arun instruction ("get the person into the product
first, collect company info from the dashboard after, gate only bot/API usage on payment") was
approved in conversation on 2026-07-19 but never actually implemented. `/partner-signup` and
`/partner-invite/accept` both still show a required "Company name" field before Clerk signup even
mounts — the opposite of what was approved. Separately, the sales-partner model B2B-26 shipped has
no way for a sales-partner to reach API keys, docs, or payment for themselves or for any client they
manage — `requirePartnerAdmin()` explicitly 403s a `channel_partner`-kind account (by design, per
B2B-26 §6.14), and a client (a `partner_accounts` row with zero `partner_admin_users` rows, by
design) has no detail page or Configure entry point at all.

**Failure without this:** the signup flow keeps contradicting an instruction Arun already approved;
sales-partners remain structurally unable to configure or bill their own clients, which blocks the
entire value proposition of the sales-partner model — a sales-partner who cannot generate a client's
API key or add a client's card cannot actually resell Clio to that client.

---

## 2. User Story

As a prospective sales-partner or direct partner (invited),
I want to sign up with just my email/Clerk identity — no company form first,
So that I can get into the product immediately and add company details when it's convenient, not
before I've even created an account.

As a self-serve sales-partner,
I want a non-blocking way to finish setting up my company info and add a card from my own dashboard,
So that I can browse, invite my team, and add clients immediately, and handle billing whenever I'm
ready — never as a gate to using the product itself.

As a sales-partner,
I want to click into any client I manage and reach a real "Configure" screen for that client —
API credentials, outbound routing, payment — scoped entirely to that client's own account,
So that everything I set up for a client is billed and tracked against the client, never against me.

As a direct partner (invited, no pre-signup form),
I want a place in my own Configurator to set my company's real name after I've signed up,
So that my account isn't stuck showing a meaningless placeholder forever.

---

## 3. Trigger / Entry Point

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| E-1 | Visitor reaches `/partner-signup` | `GET /partner-signup` | None (public) | None |
| E-2 | Signed-out visitor's browser renders the page | Client-side, immediate — no click | None | Page loaded |
| E-3 | Visitor completes Clerk `<SignUp>` | Existing mechanism, `unsafeMetadata.signup_intent === 'partner'` (no `company_name` key), `forceRedirectUrl="/dashboard/channel-partner"` | Clerk-managed | — |
| E-4 | Clerk fires `user.created` for a `/partner-signup` signup | `POST /api/webhooks/clerk` (existing branch, simplified) | svix signature | `unsafe_metadata.signup_intent === 'partner'` |
| E-5 | Already-signed-in visitor's browser renders `/partner-signup` | Auto-fires `POST /api/partner-signup/claim` on mount, no click | Clerk session | Page loaded |
| E-6 | Visitor opens `/partner-invite/accept?token=...` | `GET /partner-invite/accept` (unchanged route) | None (token-gated) | Valid, unexpired, unused token |
| E-7 | Token valid, visitor signed out | Auto-renders Clerk `<SignUp>`, no click, `unsafeMetadata.signup_intent === 'direct_partner_invite'` (no `company_name` key) | Clerk-managed | — |
| E-8 | Token valid, visitor signed in | Auto-fires `POST /api/partner-invite/accept` on mount, no click | Clerk session | — |
| E-9 | Clerk fires `user.created` for a `/partner-invite/accept` signup | `POST /api/webhooks/clerk` (existing branch, simplified) | svix signature | `unsafe_metadata.signup_intent === 'direct_partner_invite'` |
| E-10 | Sales-partner opens their own dashboard | `GET /dashboard/channel-partner` | Clerk session + `requireChannelPartnerAdmin` (page-level equivalent, unchanged) | — |
| E-11 | Sales-partner opens Settings | `GET /dashboard/channel-partner/settings` → `GET /api/channel-partner/account` | Clerk session + `requireChannelPartnerAdmin` | — |
| E-12 | Sales-partner saves company info | `PATCH /api/channel-partner/account` | Clerk session + `requireChannelPartnerAdmin` | On Settings, form submitted |
| E-13 | Sales-partner adds a card for their own account | `POST /api/channel-partner/billing/card-verification` → Stripe Checkout (`setup` mode) → return | Clerk session + `requireChannelPartnerAdmin` | On Settings, "Add a card" clicked |
| E-14 | Sales-partner clicks a client in their Clients list | `GET /dashboard/channel-partner/clients/[id]` | Clerk session + `requireChannelPartnerClientAccess` | Client row exists, owned by caller's channel-partner account |
| E-15 | Sales-partner clicks "Configure" on a client | `GET /dashboard/channel-partner/clients/[id]/configure` (+ `/api`, `/api/playground`, `/docs`, `/known-bugs`) | Clerk session + `requireChannelPartnerClientAccess` | Same as E-14 |
| E-16 | Any Configurator API call made from inside a client's Configure screen | Any of the 43 existing `requirePartnerAdmin`-gated routes (§6.9), called with the client's `partner_account_id` | Clerk session + `requirePartnerAdmin` (chokepoint-extended) | Same ownership relationship as E-14 |
| E-17 | Direct partner or sales-partner-managed client edits company name from inside Configurator | `GET`/`PATCH /api/admin/configurator/account` | Clerk session + `requirePartnerAdmin` (chokepoint-extended for the client case) | On Configurator Dashboard tab, "Company info" card |

---

## 4. Screen / Flow Description

### `/partner-signup` (MODIFIED — the entire pre-signup "capture" state is removed)

**Signed-out visitor, page load:**
Renders Clerk's `<SignUp>` component immediately, centered on a `bg-void` (`#080808`) full-height
page — no heading, no card, no form of any kind above it. This is the exact same Clerk `<SignUp>`
mount and `clerkAppearance` styling that existed before, just with nothing rendered ahead of it and
`unsafeMetadata` reduced to `{ signup_intent: 'partner' }` (the `company_name` key is removed
entirely, not set to an empty string). `forceRedirectUrl="/dashboard/channel-partner"` (unchanged).

**Already-signed-in visitor, page load:**
No UI is shown to click — the page auto-fires `POST /api/partner-signup/claim` (empty body; the
route no longer accepts or requires a `companyName` field) the instant `useAuth()` resolves
`isSignedIn === true`. While in flight: the same spinner card as before —
`<Loader2 className="w-4 h-4 animate-spin text-white" />` + `"Setting up your account..."`. On
success: `router.push` to `/dashboard/channel-partner` or `/dashboard/configurator`, taken from the
response's `accountKind` exactly as today (§9 non-regression note below — this ternary is still
load-bearing for an existing direct partner who revisits this page while signed in). On failure:
the same `"Something went wrong setting up your account."` + `"Try again"` button, where "Try again"
re-fires the same auto-claim call (the button still exists here — a failure is the one case where a
manual retry action is appropriate, since auto-retrying a failed network call forever would be
worse UX than a deliberate retry click).

### `/partner-invite/accept` (MODIFIED — same principle, its own "capture" state removed)

**Token validation (unchanged):** `loading` → `GET /api/partner-invite/accept?token=...` → `invalid`
(copy unchanged: `"This invite link is no longer valid."` / `"Ask your Clio contact for a new
link."`) or proceeds.

**Token valid, signed out:** Renders Clerk `<SignUp>` immediately — same one-line intro text above
it as before (`"You've been invited to set up a Clio partner account."`), but with no company-name
card beneath it; `<SignUp>` mounts directly under that line. `unsafeMetadata` reduced to
`{ signup_intent: 'direct_partner_invite', direct_partner_invite_token: token }` (`company_name`
key removed). `forceRedirectUrl="/dashboard/configurator"` (unchanged).

**Token valid, signed in:** No click needed — auto-fires `POST /api/partner-invite/accept` with
`{ token }` (no `companyName` field) the instant the token validates and `isSignedIn === true` is
known. Same `claiming`/`claim-error`/`already-member` states and copy as before (§9 Edge Case,
unchanged: `already-member` remains a distinct terminal state from `claim-error`).

### `/dashboard/channel-partner` (MODIFIED — new non-blocking setup banner)

Unchanged: the existing Clients/Team/Billing/Quick-links cards (`page.tsx`, B2B-26). **Added**, as
the first element inside the content column, above the existing Clients card — a `Card` rendered
only while at least one of the two setup items is incomplete (disappears once both are done; never
reappears):

- Heading: `"Finish setting up your account"` (`fontSize:16, fontWeight:600, color: COLORS.textPrimary`).
- Two checklist rows, each either a done row (green check + item label, no link) or a pending row
  (empty circle + item label + link):
  - `"Company info"` — done once the account's `name` no longer equals the literal placeholder
    `"Unnamed partner"`. Pending copy: `"Add your company name and website"`, link `"Add →"`.
  - `"Payment"` — done once a card is on file (`checkCardOnFile`-equivalent read on this account's
    own `partner_wallets` row). Pending copy: `"Add a card — this never charges you automatically"`,
    link `"Add →"`.
- Both links go to `/dashboard/channel-partner/settings`.
- This banner never blocks anything below it — Clients/Team/Quick-links render identically whether
  it's showing or not (matches the Known Constraint: gate is on usage only).

### `/dashboard/channel-partner/settings` (NEW)

`ChannelPartnerShell`-wrapped (new `active="settings"` value), reached via the shell's new 4th nav
tab, label `"Settings"`, href `/dashboard/channel-partner/settings`. New client component
`SettingsClient.tsx`, fetching `GET /api/channel-partner/account` on mount (same
`useState`+`useEffect`+try/catch/finally pattern every other client component in this codebase
uses).

- **Company info card:**
  - Heading `"Company info"`.
  - Label `"Company name"`, text input, pre-filled with the current name (shows the literal
    `"Unnamed partner"` placeholder text if unedited — visibly, not hidden, so the sales-partner
    knows this needs attention), `maxLength={200}`.
  - Label `"Company URL"`, text input, pre-filled with `company_url` or empty, placeholder
    `"acme.com"`, optional, `maxLength={500}`.
  - `"Save"` button (disabled while unchanged or in-flight, inline spinner on submit) → `PATCH
    /api/channel-partner/account`.
  - Inline validation error `"Company name is required."` on empty submit.
  - Inline success flash `"Saved."` for 1.5s (no toast system in this codebase — matches every
    other inline-save precedent, e.g. B2B-28's revenue-share field).
  - Inline error `"Couldn't save. Try again."` on failure.
- **Payment card:**
  - Heading `"Payment"`.
  - If `card_on_file === null` (still loading): `"Checking…"`.
  - If `false`: `"Add a card to unlock full access to your own account. This never charges you — it
    only confirms the card is valid."` + `PrimaryButton` `"Add a card"` → `POST
    /api/channel-partner/billing/card-verification` → Stripe Checkout (`setup` mode) →
    `window.location.href = checkout_url`.
  - If `true`: `"✓ Card on file."` (green check, same visual pattern as `PaymentConfigClient`'s own
    card-verification block).
  - Return handling: identical pattern to `PaymentConfigClient`'s `card_verified=1` handler —
    `router.replace` back to `/dashboard/channel-partner/settings?card_verified=1` cleans up, then
    re-fetches `GET /api/channel-partner/account` to confirm; on an unconfirmed return, the same
    `"We couldn't confirm your card yet — this can take a few seconds..."` message.

### `/dashboard/channel-partner/clients` (MODIFIED — rows become links)

`ClientsClient.tsx`'s existing list rows (each a `Card`) become a `<Link>` to
`/dashboard/channel-partner/clients/{client.id}` (mirroring the exact `<Link>`-not-`<tr>`-click-handler
pattern `SalesPartnersClient.tsx` established in B2B-28, for the same keyboard/screen-reader-navigable
reason). No other change to this screen — the existing "Add client" form, empty state, and loading/error
states are untouched.

### `/dashboard/channel-partner/clients/[id]` (NEW — client detail page)

Server component (`page.tsx`) calls `requireChannelPartnerClientAccess(params.id)`. On its `error`
(no session → the existing app-wide `/sign-in` redirect pattern via `redirect()`; not the caller's
own client, or client doesn't exist → `notFound()`, a plain 404, since exposing "this exists but
isn't yours" vs. "this doesn't exist" is exactly the info leak this codebase's auth functions already
avoid — see `requirePartnerAdmin`'s own identical-403-either-way convention).

New client component `ClientDetailClient.tsx`, `ChannelPartnerShell`-wrapped is **not** used here
(the shell's 4-tab nav — Dashboard/Clients/Team/Settings — doesn't apply to a single client's detail
view; instead this page uses a lighter, back-link-only header, matching B2B-28's
`SalesPartnerDetailClient.tsx` precedent exactly):

- Back link `"← All clients"` to `/dashboard/channel-partner/clients`.
- Heading: the client's name (`text-white text-2xl font-bold`), status pill beside it (`active`/`suspended`,
  same `StatusBadge` component `ClientsClient.tsx` already has — imported, not re-implemented).
- Sub-line: the client's `company_url`, or nothing if unset.
- **Configure card:** heading `"Configure"`, body `"Set up API credentials, outbound routing, and
  payment for this client."`, `PrimaryButton` `"Configure →"` linking to
  `/dashboard/channel-partner/clients/{id}/configure`.

### `/dashboard/channel-partner/clients/[id]/configure` (+ `/api`, `/api/playground`, `/docs`, `/known-bugs`) (NEW)

Five new server components, each following the exact shape of its direct-partner sibling
(`/dashboard/configurator/page.tsx`, `/api/page.tsx`, `/api/playground/page.tsx`, `/docs/page.tsx`,
`/known-bugs/page.tsx`) with two differences: (1) auth is `requireChannelPartnerClientAccess(params.id)`
instead of `getConfiguratorAccountsForClerkUser`; (2) the resolved `accounts` array passed to the
reused client component is a single-element array built from the resolved client
(`[{ id: client.id, name: client.name, account_kind: 'partner' }]`), and every one of the reused
client components (`ConfiguratorSurface`, `ApiClient`, `DocsClient`, `KnownBugsClient`,
`PlaygroundClient`) receives the new `basePath="/dashboard/channel-partner/clients/{id}/configure"`
prop (and `ConfiguratorSurface`/`ConfiguratorNavShell` additionally receive `navLabel="Configure"`).
Full detail in §6.2–§6.5.

Visibly, the reused surface renders **identically** to the direct-partner Configurator (Dashboard /
Integration / Payment / Go-Live left-nav — `VISIBLE_SECTIONS` is unchanged, still `['integration',
'payment']`, governed globally, not per-caller; API/Docs/Known Bugs top tabs; Playground), with
exactly two visible differences: (1) the top-nav tab that says "Configurator" on the direct-partner
route says **"Configure"** here; (2) the account switcher (`accounts.length === 1`) shows the
client's own name as a static label, never a dropdown (a sales-partner configuring one client
doesn't switch to another client from inside this view — they go back via "← All clients").

The account-name-editing "Company info" card described under Scope B above is also visible here
(reused verbatim via `DashboardPanel`), editing the **client's** name/URL — additive, not something
this brief was asked for, but a direct, harmless consequence of true component reuse, called out
explicitly so it doesn't read as unreviewed scope creep.

---

## 5. Visual Examples

### `/partner-signup` — signed-out load (no capture state)

```
┌─────────────────────────────────────────┐
│                                           │
│              [ Clerk <SignUp> ]          │
│                                           │
└─────────────────────────────────────────┘
  Nothing renders above it. No heading, no card, no field.
```

### `/partner-signup` — signed-in load (auto-claim)

```
┌─────────────────────────────┐
│  ⟳  Setting up your          │
│     account...                │
└─────────────────────────────┘
  Appears immediately on load, no click required.
```

### `/dashboard/channel-partner` — setup banner (both items pending)

```
┌───────────────────────────────────────────────────────────┐
│ Finish setting up your account                               │
│  ○ Company info — Add your company name and website  [Add →]│
│  ○ Payment — Add a card — this never charges you      [Add →]│
│              automatically                                    │
├───────────────────────────────────────────────────────────┤
│ Clients                                                       │
│   0 clients                                                   │
│   No clients yet.                                             │
│   [ View all clients → ]                                      │
└───────────────────────────────────────────────────────────┘
```

### `/dashboard/channel-partner/settings`

```
┌───────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Company info                                             │   │
│ │ Company name                                             │   │
│ │ ┌─────────────────────────────────────────────┐         │   │
│ │ │ Unnamed partner                                │         │   │
│ │ └─────────────────────────────────────────────┘         │   │
│ │ Company URL                                              │   │
│ │ ┌─────────────────────────────────────────────┐         │   │
│ │ │ acme.com                                       │         │   │
│ │ └─────────────────────────────────────────────┘         │   │
│ │                                            [ Save ]      │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Payment                                                  │   │
│ │ Add a card to unlock full access to your own account.   │   │
│ │ This never charges you — it only confirms the card is   │   │
│ │ valid.                                                    │   │
│ │                                        [ Add a card ]    │   │
│ └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### `/dashboard/channel-partner/clients/[id]` — client detail

```
┌───────────────────────────────────────────────────────────┐
│ ← All clients                                                 │
│                                                               │
│ Pluralsight                                          [active] │
│ pluralsight.com                                                │
│                                                               │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Configure                                                │   │
│ │ Set up API credentials, outbound routing, and payment   │   │
│ │ for this client.                                          │   │
│ │                                        [ Configure → ]   │   │
│ └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### `/dashboard/channel-partner/clients/[id]/configure` — reused surface, client-scoped

```
┌───────────────────────────────────────────────────────────┐
│ Clio Configurator                              Pluralsight   │
│ Configure   API   Docs   Known Bugs                            │
├───────────────────────────────────────────────────────────┤
│ Dashboard │                                                    │
│ ─────────  │  Dashboard                                        │
│ Integration│                                                    │
│ Payment    │  [ Setup ]  [ Live status ]                        │
│            │  [ Wallet ]  [ Quick nav ]                          │
│ Go Live    │                                                    │
└───────────────────────────────────────────────────────────┘
  Identical chrome to /dashboard/configurator, with two diffs:
  the tab says "Configure" not "Configurator", and the account
  label ("Pluralsight") is static text, never a dropdown.
```

---

## 6. Data Requirements

### 6.0 File-by-file diff summary (no new migration)

No schema change. Every column this brief needs already exists:
`partner_accounts.owning_channel_partner_id`, `partner_accounts.company_url` (both B2B-26),
`partner_wallets.stripe_default_payment_method_id` (B2B-27). This is a pure application-layer
change: routes, one auth function, and prop-threading through existing components.

**Modified:**
`app/partner-signup/[[...partner-signup]]/page.tsx`, `app/api/partner-signup/claim/route.ts`,
`app/partner-invite/accept/PartnerInviteAcceptClient.tsx`, `app/api/partner-invite/accept/route.ts`,
`app/api/webhooks/clerk/route.ts`, `app/dashboard/channel-partner/_shared.tsx`,
`app/dashboard/channel-partner/page.tsx`, `app/dashboard/channel-partner/clients/ClientsClient.tsx`,
`lib/partner/auth.ts`, `lib/partner/clients.ts`, `app/dashboard/configurator/_shared.tsx`,
`app/dashboard/configurator/ConfiguratorSurface.tsx`,
`app/dashboard/configurator/integration/IntegrationClient.tsx`,
`app/dashboard/configurator/PaymentConfigClient.tsx`, `app/dashboard/configurator/api/ApiClient.tsx`,
`app/dashboard/configurator/docs/DocsClient.tsx`,
`app/dashboard/configurator/api/playground/PlaygroundClient.tsx`,
`app/dashboard/configurator/DashboardPanel.tsx`.

**New:**
`app/dashboard/channel-partner/settings/page.tsx`, `app/dashboard/channel-partner/settings/SettingsClient.tsx`,
`app/api/channel-partner/account/route.ts`, `app/api/channel-partner/billing/card-verification/route.ts`,
`app/dashboard/channel-partner/clients/[id]/page.tsx`, `app/dashboard/channel-partner/clients/[id]/ClientDetailClient.tsx`,
`app/dashboard/channel-partner/clients/[id]/configure/page.tsx`,
`app/dashboard/channel-partner/clients/[id]/configure/api/page.tsx`,
`app/dashboard/channel-partner/clients/[id]/configure/api/playground/page.tsx`,
`app/dashboard/channel-partner/clients/[id]/configure/docs/page.tsx`,
`app/dashboard/channel-partner/clients/[id]/configure/known-bugs/page.tsx`,
`app/api/admin/configurator/account/route.ts`.

### 6.1 The 23 hardcoded-`/dashboard/configurator`-path call sites and their prop-threaded fix

New optional props, both threaded through the call chain below, both defaulting to today's exact
literals (so every existing `/dashboard/configurator/**/page.tsx` caller — none of which is modified
to pass either prop — renders byte-identical output to today):

```ts
// _shared.tsx
export function ConfiguratorNavShell({
  accounts, activePartnerAccountId, active, billingHealth, children,
  basePath = '/dashboard/configurator',
  navLabel = 'Configurator',
}: { /* ...existing props..., */ basePath?: string; navLabel?: string }) { /* ... */ }
```

| File | Call site (line, current) | Change |
|---|---|---|
| `_shared.tsx` | `BillingBanner`'s `href={`/dashboard/configurator/docs?...`}` (176) | Reads `basePath` prop, passed down from `ConfiguratorNavShell` |
| `_shared.tsx` | `navItems` × 4 (214–219) | Each href's `/dashboard/configurator` literal → `${basePath}`; the `configurator` item's `label: 'Configurator'` → `navLabel` |
| `ConfiguratorSurface.tsx` | passes `activePartnerAccountId` etc. into `ConfiguratorNavShell` and each section client | Gains `basePath`/`navLabel` props (default same), forwards `basePath` to every section-client render call in `renderPanel()` and to `ConfiguratorNavShell` |
| `IntegrationClient.tsx` | `backHref` (125) | Gains `basePath` prop, `${basePath}?partner_account_id=...` |
| `PaymentConfigClient.tsx` | `backHref` (344), 2× `router.replace` (102, 136), `successAndCancelUrls()`/`cardVerificationUrls()` (150-153, 196-199) | Gains `basePath` prop, all six literals use `${basePath}` |
| `ApiClient.tsx` | 2 links (69, 112) | Gains `basePath` prop |
| `DocsClient.tsx` | 3 links (114, 154, 360) | Gains `basePath` prop |
| `PlaygroundClient.tsx` | `backHref` (125), 1 link (174) | Gains `basePath` prop |
| `DashboardPanel.tsx` | 3 `QuickLink`s (293–295) | Gains `basePath` prop; the `"Configurator →"` link text becomes `` `${navLabel} →` `` (new `navLabel` prop, default `'Configurator'`) |

`ConfiguratorShell` (the older, non-nav-shell component, used only by non-embedded standalone
renders of section clients that this brief never invokes in the embedded/reused path) is untouched
— every reused component here is always invoked with `embedded` (Payment) or is inherently
embedded-only (`IntegrationClient` has no non-embedded branch used by this flow), so `ConfiguratorShell`'s
own separate `title`/`backHref` props are never in the code path this brief adds.

`GoLivePanel.tsx` needs **no change** — verified by direct grep: it contains zero hardcoded
`/dashboard/configurator` references (§ investigation, not assumed).

### 6.2 `lib/partner/auth.ts` — `requirePartnerAdmin` chokepoint fallback (MODIFIED)

```ts
async function findOwningChannelPartnerAccountId(targetAccountId: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('owning_channel_partner_id')
    .eq('id', targetAccountId)
    .maybeSingle()
  return (data?.owning_channel_partner_id as string | null) ?? null
}

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
    // B2B-29 — chokepoint fallback. No DIRECT membership on this account,
    // but the caller may administer the channel-partner account that OWNS
    // it (a client of theirs, B2B-26's owning_channel_partner_id
    // relationship). Two extra queries, ONLY on the already-failing path —
    // zero cost added to the existing direct-partner success path above.
    // Covers every requirePartnerAdmin-gated route (§6.9) with zero
    // per-route changes, mirroring the B2B-26 §6.14 chokepoint precedent
    // already in this file.
    const owningId = await findOwningChannelPartnerAccountId(partnerAccountId)
    if (owningId) {
      const { data: ownerMembership } = await supabase
        .from('partner_admin_users')
        .select('id')
        .eq('clerk_user_id', userId)
        .eq('partner_account_id', owningId)
        .maybeSingle()
      if (ownerMembership) {
        return { clerkUserId: userId, error: null }
      }
    }
    return {
      clerkUserId: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'You do not administer this partner account.'), { status: 403 }),
    }
  }

  // B2B-26 §6.14 chokepoint (unchanged, reached only on a DIRECT membership match —
  // see §9 non-regression note for why the fallback above can never reach this block).
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

### 6.3 `lib/partner/auth.ts` — `requireChannelPartnerClientAccess` (NEW)

```ts
type ChannelPartnerClientAccessResult =
  | {
      clerkUserId: string
      channelPartnerAccountId: string
      client: { id: string; name: string; company_url: string | null; status: 'active' | 'suspended' }
      error: null
    }
  | { clerkUserId: null; channelPartnerAccountId: null; client: null; error: NextResponse }

/**
 * B2B-29. Page-level (SSR) gate for the new /dashboard/channel-partner/clients/[id]... route
 * tree. Resolves the caller's OWN channel-partner account from the session (via
 * requireChannelPartnerAdmin — no client-supplied id for that half), then verifies the
 * requested client's owning_channel_partner_id matches it. Same indistinguishable-403
 * convention as every other auth function here — a client that doesn't exist and a client
 * that exists but isn't the caller's return the identical error, no info leak about which.
 */
export async function requireChannelPartnerClientAccess(clientAccountId: string): Promise<ChannelPartnerClientAccessResult> {
  const cp = await requireChannelPartnerAdmin()
  if (cp.error) return { clerkUserId: null, channelPartnerAccountId: null, client: null, error: cp.error }

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('id, name, company_url, status, owning_channel_partner_id')
    .eq('id', clientAccountId)
    .maybeSingle()

  if (!data || data.owning_channel_partner_id !== cp.partnerAccountId) {
    return {
      clerkUserId: null,
      channelPartnerAccountId: null,
      client: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'You do not manage this client.'), { status: 403 }),
    }
  }

  return {
    clerkUserId: cp.clerkUserId,
    channelPartnerAccountId: cp.partnerAccountId,
    client: {
      id: data.id as string,
      name: data.name as string,
      company_url: (data.company_url as string | null) ?? null,
      status: data.status as 'active' | 'suspended',
    },
    error: null,
  }
}
```

`errorEnvelope` is the existing private helper already in this file (line 24-26) — reused, not
duplicated.

### 6.4 `lib/partner/clients.ts` (MODIFIED — add single-row fetch)

No change to `listClientsForChannelPartner`/`createClientForChannelPartner`. This brief's own
`requireChannelPartnerClientAccess` (§6.3) already does its own single-row `partner_accounts` read
directly (avoids a second round-trip through this file for a shape `ChannelPartnerClient` doesn't
need — `owning_channel_partner_id` isn't part of that exported interface). No new export needed here.

### 6.5 Scope A — signup write-path changes

`lib/partner/signup.ts`'s `createOrClaimPartnerAccount(clerkUserId, companyName, email, accountKind)`
signature is **unchanged** — every call site now simply passes the literal `'Unnamed partner'` in
place of a captured value. Four call sites change what they pass, not the function itself:

1. **`app/api/webhooks/clerk/route.ts`, `signup_intent === 'partner'` branch** — deletes the
   `company_name` read and the "missing/empty → hard-stop, no account created" logic entirely
   (there is nothing left to be missing). Becomes:
   ```ts
   if (event.data.unsafe_metadata?.signup_intent === 'partner') {
     const result = await createOrClaimPartnerAccount(id, 'Unnamed partner', primaryEmail, 'channel_partner')
     if (!result.success) console.error('[clerk-webhook] createOrClaimPartnerAccount failed:', result.error)
     return NextResponse.json({ received: true })
   }
   ```
2. **`app/api/webhooks/clerk/route.ts`, `signup_intent === 'direct_partner_invite'` branch** —
   same simplification; keeps its existing `token` presence check (still required — the invite
   relationship, not the company name, is what this branch validates), drops the `company_name`
   check:
   ```ts
   if (event.data.unsafe_metadata?.signup_intent === 'direct_partner_invite') {
     const token = typeof event.data.unsafe_metadata.direct_partner_invite_token === 'string'
       ? event.data.unsafe_metadata.direct_partner_invite_token : null
     if (!token) { console.error(...); return NextResponse.json({ received: true }) }
     const { valid, inviteId } = await lookupDirectPartnerInviteByToken(token)
     if (!valid || !inviteId) { console.error(...); return NextResponse.json({ received: true }) }
     const result = await createOrClaimPartnerAccount(id, 'Unnamed partner', primaryEmail, 'partner')
     if (result.success && !result.alreadyMember) await markDirectPartnerInviteAccepted(inviteId, result.partnerAccountId as string)
     return NextResponse.json({ received: true })
   }
   ```
3. **`app/api/partner-signup/claim/route.ts`** — `ClaimSchema` becomes `z.object({})` (no body
   fields required; the route still accepts a JSON body for forward-compatibility but validates
   nothing from it). Calls `createOrClaimPartnerAccount(userId, 'Unnamed partner', primaryEmail, 'channel_partner')`.
4. **`app/api/partner-invite/accept/route.ts`** — `AcceptSchema` becomes `z.object({ token:
   z.string().min(1) })` (drops `companyName`). Calls `createOrClaimPartnerAccount(userId, 'Unnamed
   partner', primaryEmail, 'partner')`. `GET` handler (token lookup) is unchanged.

**Welcome email copy (small, in-scope fix, not deferred):** `sendPartnerSignupWelcomeEmail(email,
orgName)`'s subject line (`lib/delivery/email.ts` line 604) reads `` `Welcome to Clio — let's get
${orgName} set up` `` — with the placeholder this would literally read "let's get Unnamed partner set
up." Fixed at the call site, not inside the email function (keeps the function itself
placeholder-agnostic): `createOrClaimPartnerAccount` passes `companyName === 'Unnamed partner' ?
undefined : companyName`-equivalent is unnecessary complexity; simpler — `sendPartnerSignupWelcomeEmail`
gains a one-line internal check: `const displayName = orgName === 'Unnamed partner' ? 'your account' :
orgName`, used only in the subject line and any inline body reference, everywhere else in the
function unchanged.

### 6.6 `app/partner-signup/[[...partner-signup]]/page.tsx` (MODIFIED)

`Step` type shrinks from `'capture' | 'signup' | 'claiming' | 'claim-error'` to `'signup' |
'claiming' | 'claim-error'`. On mount (`useEffect`, gated on `isLoaded`): if `isSignedIn`, call
`submitClaim()` immediately (was previously only reachable via `handleContinue`'s click, now the
sole trigger is mount); if not signed in, set `step = 'signup'` immediately. `submitClaim()`'s fetch
body becomes `{}` (or the call drops the body/header entirely — either is acceptable; the schema
change in §6.5.3 accepts both). The `companyName`/`showValidationError` state and the entire
`capture`-step JSX block are deleted.

### 6.7 `app/partner-invite/accept/PartnerInviteAcceptClient.tsx` (MODIFIED)

`Step` type shrinks from 7 states to 6: `'loading' | 'invalid' | 'signup' | 'claiming' |
'claim-error' | 'already-member'` (`capture` removed). The `loading` effect's `load()` function, on
`data.valid === true`, now itself decides `signup` vs. auto-firing `submitClaim()` based on
`isSignedIn` (previously this decision lived in `handleContinue`, now unreachable since there's no
button left to wire it to). `companyName`/`showValidationError` state and the `capture`-step JSX
block are deleted; `submitClaim()`'s POST body becomes `{ token }` (no `companyName`).

### 6.8 `app/dashboard/channel-partner/_shared.tsx` (MODIFIED)

`ChannelPartnerShell`'s `active` prop type gains `'settings'`; `navItems` gains a 4th entry:
`{ key: 'settings', label: 'Settings', href: '/dashboard/channel-partner/settings' }`.

### 6.9 The 43 `requirePartnerAdmin`-gated routes the chokepoint fix covers (enumerated, per CEO brief's explicit ask)

Every route below calls `requirePartnerAdmin(partnerAccountId)` today and needs **zero code
changes** — the fix in §6.2 makes all of them work correctly for a sales-partner acting on an owned
client's `partner_account_id`, automatically:

```
app/api/admin/billing/card-verification/route.ts
app/api/admin/billing/checkout/route.ts
app/api/admin/billing/plan-subscription/route.ts
app/api/admin/billing/subscription/route.ts
app/api/admin/billing/test-block/route.ts
app/api/admin/configurator/content-config/route.ts
app/api/admin/configurator/content/[id]/approve/route.ts
app/api/admin/configurator/content/[id]/reject/route.ts
app/api/admin/configurator/content/[id]/route.ts
app/api/admin/configurator/content/generate/route.ts
app/api/admin/configurator/domain/check-slug/route.ts
app/api/admin/configurator/domain/custom-domain/recheck/route.ts
app/api/admin/configurator/domain/custom-domain/route.ts
app/api/admin/configurator/domain/route.ts
app/api/admin/configurator/domain/subdomain/route.ts
app/api/admin/configurator/integration/test-outbound/route.ts
app/api/admin/configurator/oauth-clients/route.ts
app/api/admin/configurator/outbound-config/route.ts
app/api/admin/configurator/preference-meter/route.ts
app/api/admin/configurator/prompt-behavior/route.ts
app/api/admin/configurator/questionnaire/[id]/publish/route.ts
app/api/admin/configurator/questionnaire/[id]/route.ts
app/api/admin/configurator/questionnaire/[id]/unpublish/route.ts
app/api/admin/configurator/questionnaire/route.ts
app/api/admin/configurator/status/route.ts
app/api/admin/configurator/templates/[templateName]/components/[slot]/route.ts
app/api/admin/configurator/templates/[templateName]/route.ts
app/api/admin/configurator/templates/[templateName]/sample-fill/route.ts
app/api/admin/configurator/templates/custom/[id]/confirm/route.ts
app/api/admin/configurator/templates/discover/route.ts
app/api/admin/configurator/templates/generate-new/route.ts
app/api/admin/configurator/templates/route.ts
app/api/admin/configurator/theme/route.ts
app/api/admin/configurator/topics-config/route.ts
app/api/admin/configurator/wizard/advance/route.ts
app/api/admin/configurator/wizard/go-live/route.ts
app/api/admin/configurator/wizard/progress/route.ts
app/api/admin/partner-accounts/[id]/outbound-config/route.ts
app/api/admin/partner-keys/[id]/route.ts
app/api/admin/partner-keys/route.ts
app/api/partner/known-bugs/[issueId]/comments/route.ts
app/api/partner/known-bugs/route.ts
app/api/partner/known-bugs/summary/route.ts
app/api/admin/configurator/account/route.ts   ← NEW, this brief (§6.10), gated the same way from day one
```

Of these, only `status`, `wizard/go-live`, `oauth-clients`, `outbound-config`, `partner-keys*`,
`billing/*`, and the new `account` route are ever actually called by the reduced, currently-visible
Configurator surface (`VISIBLE_SECTIONS = ['integration', 'payment']` plus API/Docs/Known-Bugs/Go-Live) —
the rest (questionnaire/topics/content/visualization/domain/templates/theme/etc.) belong to hidden
sections, per B2B-23's "hide, never delete" governance, and remain unreachable from any nav in
either the direct-partner or client-scoped surface. Listed in full regardless, since the chokepoint
fix protects all of them identically and the brief asked for the complete enumeration.

### 6.10 `app/api/admin/configurator/account/route.ts` (NEW)

```ts
const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  companyUrl: z.string().trim().max(500).optional().nullable(),
})

export async function GET(request: NextRequest) {
  const partnerAccountId = request.nextUrl.searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })
  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase.from('partner_accounts').select('name, company_url').eq('id', partnerAccountId).maybeSingle()
  return NextResponse.json({ name: data?.name ?? '', company_url: data?.company_url ?? null })
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('partner_accounts')
    .update({ name: parsed.data.name, company_url: parsed.data.companyUrl?.trim() || null })
    .eq('id', parsed.data.partner_account_id)
  if (error) return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

### 6.11 `app/api/channel-partner/account/route.ts` (NEW)

Same shape as §6.10, gated by `requireChannelPartnerAdmin()` (no `partner_account_id` param — acts
on the caller's own account, matching every other `/api/channel-partner/*` route's convention).
`GET` response additionally includes `card_on_file: boolean` (reuses `checkCardOnFile`, imported
from `lib/partner/configurator-status.ts` — that function is already fully generic over any
`partner_account_id`, zero changes needed to it).

### 6.12 `app/api/channel-partner/billing/card-verification/route.ts` (NEW)

```ts
const Schema = z.object({ success_url: z.string().optional(), cancel_url: z.string().optional() })

export async function POST(request: NextRequest) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error
  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 422 })
  try {
    const checkoutUrl = await createCardVerificationCheckoutSession(admin.partnerAccountId, parsed.data.success_url, parsed.data.cancel_url)
    return NextResponse.json({ checkout_url: checkoutUrl }, { status: 201 })
  } catch (err) {
    console.error('[channel-partner/billing/card-verification] Failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }, { status: 502 })
  }
}
```

`createCardVerificationCheckoutSession` (`lib/stripe.ts`, unchanged) is already fully generic over
any `partnerAccountId` — zero changes needed there either.

### 6.13 `app/dashboard/channel-partner/clients/[id]/configure/*` page.tsx pattern (all 5, NEW)

Each mirrors its direct-partner sibling structurally, replacing the auth/account-resolution block:

```ts
export default async function ClientConfigurePage({ params, searchParams }: { params: { id: string }; searchParams: { section?: string } }) {
  const access = await requireChannelPartnerClientAccess(params.id)
  if (access.error) redirect('/dashboard/channel-partner/clients')  // 403/not-yours → back to the list, no error page needed for a client-facing internal tool

  const accounts: AdminPartnerAccount[] = [{ id: access.client.id, name: access.client.name, account_kind: 'partner' }]
  const billingHealth = await getBillingHealth(access.client.id)
  // ...same initialSection resolution as /dashboard/configurator/page.tsx...

  return (
    <ConfiguratorSurface
      accounts={accounts}
      activePartnerAccountId={access.client.id}
      billingHealth={billingHealth}
      isLive={/* same onboarding_completed_at read */}
      onboardingCompletedAt={/* same */}
      initialSection={initialSection}
      basePath={`/dashboard/channel-partner/clients/${params.id}/configure`}
      navLabel="Configure"
    />
  )
}
```

Deliberately **not** replicated: the `onboarding_completed_at`-gated wizard redirect the API/Docs/
Known-Bugs *sibling* pages still carry (`if (!account?.onboarding_completed_at) redirect('/dashboard/configurator/wizard?...')`,
found in `api/page.tsx`, `docs/page.tsx`, `known-bugs/page.tsx` — the main `/dashboard/configurator/page.tsx`
itself already dropped this redirect under B2B-20). Reusing it here would gate *navigation* on
`onboarding_completed_at` (which is the same column Go-Live sets), directly violating this brief's
own Known Constraint ("gate is on usage, never navigation") for a client account. This is a
deliberate, reasoned omission, not an oversight.

---

## 7. Success Criteria (Acceptance Tests)

✓ Given a signed-out visitor on `/partner-signup`, when the page loads, then Clerk's `<SignUp>`
renders immediately with no company-name field or button rendered above or around it anywhere on
the page.

✓ Given a signed-out visitor on `/partner-invite/accept?token=<valid>`, when the token validates,
then Clerk's `<SignUp>` renders immediately (after the one-line intro text) with no company-name
field.

✓ Given an already-signed-in visitor with no existing partner account who lands on `/partner-signup`,
when the page loads, then `POST /api/partner-signup/claim` fires automatically (no click) and the
visitor lands on `/dashboard/channel-partner` on success, with `partner_accounts.name = 'Unnamed
partner'`.

✓ Given a fresh self-serve sales-partner signup, when `user.created` fires, then the created
`partner_accounts` row has `name = 'Unnamed partner'`, `account_kind = 'channel_partner'`, and
`/dashboard/channel-partner` shows the "Finish setting up your account" banner with both items
pending.

✓ Given a sales-partner with `name = 'Unnamed partner'` and no card on file, when they visit
`/dashboard/channel-partner/settings`, update the company name to `"Acme Reseller"`, and save, then
`GET /api/channel-partner/account` reflects the new name and the Dashboard's setup banner's
"Company info" row switches to done (green check) on next load.

✓ Given a sales-partner on `/dashboard/channel-partner/settings` with no card on file, when they
click "Add a card" and complete Stripe test-mode setup, then `partner_wallets.stripe_default_payment_method_id`
is set on the sales-partner's own account and the Payment card shows "✓ Card on file."

✓ Given a sales-partner with zero clients, when they visit `/dashboard/channel-partner/clients`,
then the empty state (`"No clients yet. Add your first client to get started."`) renders, unchanged
from today.

✓ Given a sales-partner with one client `"Pluralsight"`, when they click that row, then
`/dashboard/channel-partner/clients/{id}` renders showing the name, status pill, company URL, and a
"Configure →" button — this page did not exist before this brief.

✓ Given a sales-partner viewing a client's detail page, when they click "Configure →", then
`/dashboard/channel-partner/clients/{id}/configure` renders the full reused Configurator chrome with
the top-nav tab reading **"Configure"** (not "Configurator") and the account label showing the
client's name as static text (no dropdown).

✓ Given a sales-partner inside a client's Configure screen, when they click the "API" tab, then they
land on `/dashboard/channel-partner/clients/{id}/configure/api` — never on
`/dashboard/configurator/api` and never on `<NoPartnerAccounts />`.

✓ Given a sales-partner inside a client's Configure → Payment tab, when they add a card via Stripe
Checkout and return, then `partner_wallets.stripe_default_payment_method_id` is set on the
**client's own** account row, not the sales-partner's.

✓ Given a sales-partner inside a client's Configure → Integration tab, when they generate an API key,
then the created `partner_api_keys` row's `partner_account_id` is the **client's** id.

✓ Given a sales-partner who is NOT the owner of client account `X`, when their browser directly hits
`GET /api/admin/configurator/status?partner_account_id=X` with their own valid Clerk session, then
the response is `403 forbidden` — the chokepoint fallback does not grant access to a client they
don't own.

✓ Given a direct partner (never a sales-partner, no `owning_channel_partner_id` relationship
involved) using `/dashboard/configurator` exactly as before this brief shipped, when they navigate
every tab (Configurator/API/Docs/Known Bugs/Playground/Integration/Payment/Go-Live), then every link,
label, and Stripe-return behaves identically to pre-B2B-29 — the top-nav tab still reads
"Configurator," every href still points at `/dashboard/configurator/...`.

✓ Given a direct partner's own `partner_accounts.name` is still `'Unnamed partner'` (invited via
`/partner-invite/accept` after this brief ships), when they open `/dashboard/configurator`'s
Dashboard tab, then a "Company info" card is visible letting them set their real name, saved via
`PATCH /api/admin/configurator/account`.

✓ Given a sales-partner with a client that has a card on file and API credentials configured, when
that client's own outbound API caller sends a request through `/api/partner/v1/sessions`, then the
existing B2B-27 card-required / B2B-06 funding-required gate behaves exactly as it does for any
other `partner_account_id` — unmodified, unduplicated.

---

## 8. Error States

| Input / call | Failure | User sees |
|---|---|---|
| `/partner-signup` auto-claim (signed-in) | Network/server error | `"Something went wrong setting up your account."` + `"Try again"` button |
| `/partner-invite/accept` auto-claim (signed-in) | Network/server error | Same, `claim-error` state |
| `/partner-invite/accept` token | Invalid/expired/revoked/already-accepted | `"This invite link is no longer valid."` |
| `PATCH /api/channel-partner/account` | Empty name | Inline `"Company name is required."`, client-side, before submit |
| `PATCH /api/channel-partner/account` | Server error | `"Couldn't save. Try again."` |
| `POST /api/channel-partner/billing/card-verification` | Stripe error | `502`, generic `"Failed to create checkout session."` — matches `PaymentConfigClient`'s own precedent of not surfacing raw Stripe errors to the UI (button simply stays clickable, no crash) |
| Card-verification Stripe return, not yet confirmed | Webhook lag | `"We couldn't confirm your card yet — this can take a few seconds..."`, same as `PaymentConfigClient`'s existing pattern |
| `/dashboard/channel-partner/clients/[id]` | Client doesn't exist, or belongs to a different sales-partner | Plain `notFound()` (404) — no distinction shown between the two cases |
| `/dashboard/channel-partner/clients/[id]/configure*` | Same as above | Same `notFound()`-via-redirect-to-list pattern (§6.13) |
| Any of the 43 chokepoint-covered API routes, called with a client id not owned by the caller | Ownership check fails | `403 forbidden`, identical body/shape to every existing `requirePartnerAdmin` 403 |

---

## 9. Edge Cases

- **Non-regression, re-verified line by line (the brief's own top concern):** every one of the 8
  files touched in §6.1 was checked for a *third* possible caller beyond "direct-partner page" and
  "new client-scoped page" — there is none; `basePath`/`navLabel` are consumed only by
  `ConfiguratorSurface` and its direct children, never leaked into any other component tree.
- **The `requirePartnerAdmin` fallback and the B2B-26 §6.14 channel-partner block can never both
  apply to the same call.** The fallback only runs inside the `if (!membership)` branch (i.e., no
  direct row exists); the §6.14 block only runs after a direct membership match. A channel-partner
  calling with their **own** account id always has a direct membership row (they signed up for that
  account), so they hit §6.14's existing block, unchanged — they still cannot reach their own
  Configurator/Go-Live. A channel-partner calling with a **client's** id never has a direct
  membership row for that client (zero `partner_admin_users` rows exist for a client, by design), so
  they always go through the new fallback — never through §6.14's block, which never even queries
  for their case. This is why Known Constraint "Go-Live must not start applying to channel-partner
  accounts themselves" holds structurally, not by convention.
- **A direct partner with two separate memberships is impossible** (unchanged from B2B-26 — a Clerk
  user gets at most one `partner_accounts` row total, of either kind), so there is no case where the
  direct-membership check and the fallback could both plausibly match for the same caller.
- **`markDirectPartnerInviteAccepted` / welcome-email / inngest-event side effects on
  `createOrClaimPartnerAccount`** are all unchanged by this brief — only the `companyName` argument's
  *value* changes at the four call sites, not any downstream consumer of it.
- **A client's name is user-editable from inside their own Configure surface's "Company info"
  card** (reused, not specially built) — this is intentional (§4's own callout), not a gap: nothing
  in the brief restricts a sales-partner from renaming a client they manage, and the client itself
  never logs in to be confused by it.
- **The `known-bugs` page for a client-scoped Configure surface** shows whatever
  `glitch_issue_partner_comments`/known-bugs data exists for the client's own `partner_account_id` —
  correct by construction, since `KnownBugsClient.tsx` already takes `activePartnerAccountId` as a
  prop and this brief passes the client's id, not the sales-partner's.
- **Mobile/responsive:** `/dashboard/channel-partner/settings`, the client detail page, and the setup
  banner all use the fluid `clamp()`/Tailwind-responsive pattern already established by
  `SHELL_CONTENT_STYLE` (`_shared.tsx`) and B2B-23's Configurator work — no new hardcoded
  pixel-width caps introduced anywhere in this brief's new files, per the standing responsive policy.
  The reused Configure surface inherits B2B-23's existing responsive drawer/sidebar behavior
  automatically (zero new work — it's the same component).
- **A sales-partner whose Clerk session expires mid-Configure-flow** hits the same 401 behavior every
  other Configurator API call already has (`requirePartnerAdmin`'s existing `!userId` branch,
  unchanged) — no new handling needed.

---

## 10. Out of Scope

- Any change to the `/dashboard` smart router, `getPartnerAccountsForClerkUser`, or
  `createOrClaimPartnerAccount`'s idempotency logic beyond the `companyName` argument value at each
  call site.
- Any change to `VISIBLE_SECTIONS` (still `['integration', 'payment']`) — this brief does not
  re-expose any hidden Configurator section for either direct partners or clients.
- Any change to the existing card-required (B2B-27) / funding-required (B2B-06) usage gates in
  `app/api/partner/v1/sessions/route.ts` — confirmed already fully generic over `partner_account_id`,
  zero changes needed or made.
- A sales-partner's own subscription/billing plan (as distinct from a client's usage billing) — the
  "Payment" card added to the sales-partner's own Settings page is card-**verification** only
  (`setup`-mode Stripe Checkout, no charge), identical in kind to what B2B-27 already built for
  direct partners; no plan-selection UI is added for a channel-partner account itself.
- `direct_partner_invites`/`revenue_share_percent`/`/dashboard/admin/sales-partners` (B2B-28) —
  untouched.
- Legal-agreement tracking — untouched, still the documented forward-reference placeholder.
- Any change to how a client is created (`createClientForChannelPartner`, the "Add client" form) —
  clients already capture name + company URL correctly at creation time; this brief's "Company info"
  card is for the two account types that previously had NO way to set a real name (self-serve
  sales-partners, invite-accepted direct partners), not for clients, which never had this gap.

---

## 11. Open Questions

None. Every point the CEO brief flagged as BA-discretion (§0's table) is resolved above as a
technical decision; the additional prop-threading finding (§0, sixth row) is also a technical
decision, not a product-shape question, and is resolved the same way.

---

## 12. Dependencies

- B2B-26 (`account_kind`, `owning_channel_partner_id`, `partner_team_invites`,
  `requireChannelPartnerAdmin`, `ChannelPartnerShell`, `ClientsClient.tsx`,
  `listClientsForChannelPartner`/`createClientForChannelPartner`) — must exist; it does, shipped.
- B2B-27 (`partner_wallets.stripe_default_payment_method_id`, `checkCardOnFile`,
  `createCardVerificationCheckoutSession`) — must exist; it does, shipped.
- B2B-28 (`createOrClaimPartnerAccount`'s current 3-call-site shape, the `/partner-invite/accept`
  route tree, the `direct_partner_invite` signup_intent) — must exist; it does, shipped, and this
  brief modifies it in place (§6.5) rather than depending on any further change to it.
- B2B-20/23/24 (`ConfiguratorSurface`, `ConfiguratorNavShell`, `VISIBLE_SECTIONS`,
  `SHELL_CONTENT_STYLE`, the responsive drawer/sidebar) — must exist; it does, shipped, and this
  brief's entire Scope C is additive prop-threading on top of it, not a rebuild.
- No new external vendor, package, or environment variable.
