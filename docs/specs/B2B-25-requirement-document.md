# B2B-25 — Remove Clerk Organizations from Partner Signup — Requirement Document

Version: 1.1
Status: APPROVED — CEO re-review 2026-07-19, all claims independently verified against source (incl.
State 2b/§6.2-6.4, §6.6 citation fix, and both minor non-blocking notes below). Cleared for Dev.
Author: Business Analyst Agent
Date: 2026-07-19

**Revision note (v1.1):** CEO review of v1.0 required one revision — §9 Edge Case 2 (an
already-signed-in visitor reaching `/partner-signup` with no `unsafeMetadata` ever attached) was
independently re-verified by the CEO as a materially reachable, first-class entry surface
(`components/marketing/MarketingNav.tsx`'s always-visible "Log in" CTA, plus the CEO brief's own
confirmation that `/sign-in`/`/sign-up` were deliberately funneled into the partner flow during
B2B-18) and as a regression this same brief would otherwise introduce — not a deferrable follow-on.
Added: a new State 2b (§4), a new shared helper + authenticated claim route (§6.2-6.4), three new
acceptance tests (§7), two new error-state rows (§8), and a full rewrite of §9 Edge Case 2 from
"deferred to BACKLOG.md" to "resolved in-brief." One citation nit from the CEO review is also fixed
in §6.6: `partner_accounts.clerk_org_id` was added in migration `079_b2b06_provisioning.sql`, not
`071` as v1.0 (and the CEO brief itself) stated — confirmed by direct read of both migration files.
Everything else in v1.0 was reviewed and approved unchanged.
Source brief: `.claude/agents/clio/feature-briefs/B2B-25-remove-clerk-organizations-partner-signup.md`

> Scope in one line: delete the Clerk `<CreateOrganization>` step from partner signup, capture
> company name in a small Clio-owned form instead, create `partner_accounts` +
> `partner_admin_users` (role `owner`) directly from a `unsafeMetadata`-carrying `user.created`
> webhook branch (the exact `ONBOARD-DATA-01` mechanism already proven for consumer onboarding),
> and retire `app/api/webhooks/clerk-organization/route.ts` and
> `app/partner-signup/organization/[[...organization]]/page.tsx` outright. Read-path auth
> (`requirePartnerAdmin`, `getPartnerAccountsForClerkUser`) is untouched. Single-deploy cutover.

---

## 1. Purpose

Clio currently has two structurally different identity/membership models living side by side:
`internal_admin_users` (B2B-21's flat table, already proven) and Clerk Organizations (the partner
self-serve signup path, `app/partner-signup/organization/[[...organization]]/page.tsx` +
`app/api/webhooks/clerk-organization/route.ts`). Arun has directly instructed that Clerk
Organizations be removed from the product entirely — "i am not very much happy with the
organization that clerk provides. too complicated" — so that every tenant type (internal staff,
partner, and the future sales-partner entity) ends up on the same flat-table pattern.

Beyond the architectural preference, this closes a concrete, already-reproduced bug class: both the
`/partner-signup/organization` catch-all-routing failure (the create-organization form re-rendering
instead of completing after a successful create) and the blank-page-for-signed-out-visitor bug lived
**inside Clerk's own `<CreateOrganization>` component's internal client-side navigation** — code Clio
does not control and cannot fix beyond routing workarounds. Deleting the step that renders
`<CreateOrganization>` removes this entire bug surface permanently, not just today's two instances.

**Failure without it:** the product keeps carrying a second, harder-to-secure identity pattern
indefinitely, and the two Clerk-internal-navigation bugs above (or variants of them) can recur any
time Clerk changes `<CreateOrganization>`'s internal behavior — a class of regression Clio has no way
to fix directly.

---

## 2. User Story

As a prospective Clio partner,
I want to sign up at `/partner-signup` and land in the Configurator with my account fully created
in one continuous flow,
So that I don't hit an extra "create your organization" screen that has already broken twice in
ways outside Clio's control.

As Clio's Business Analyst / Dev (secondary, internal user story — this brief also removes a live
authorization/architecture liability),
I want partner-account creation to use the exact same flat-table, webhook-driven pattern already
proven by internal-admin identity (B2B-21) and consumer onboarding (`ONBOARD-DATA-01`),
So that there is exactly one identity-creation pattern in the codebase to reason about and secure,
not two.

---

## 3. Trigger / Entry Point

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| E-1 | Prospective partner opens the signup page | `GET /partner-signup` | None (public route, unchanged in `middleware.ts`) | Signed out, or signed in with no existing `partner_accounts` membership |
| E-2 | Partner submits the company-name step | Client-side only — no new API route; the value is carried forward into the `<SignUp unsafeMetadata={...}>` call on the same page (§4) | None (pre-Clerk, Clio-owned form) | Non-empty, validated company name in local component state |
| E-3 | Partner completes Clerk's hosted sign-up form | Clerk's own `<SignUp>` client flow (unchanged Clerk mechanics — email/password or SSO) | Clerk-managed | Company name already captured in step E-2 |
| E-4 | Clerk fires `user.created` | `POST /api/webhooks/clerk` (existing route, extended — not a new route) | svix signature (`CLERK_WEBHOOK_SECRET`, unchanged) | `event.data.unsafe_metadata.signup_intent === 'partner'` present |
| E-5 | Partner lands post-signup | `forceRedirectUrl="/dashboard/configurator"` (Clerk client-side redirect, fires immediately after Clerk's own account creation — does not wait for the webhook) | Clerk session (just created) | None — `/dashboard/configurator`'s existing `getPartnerAccountsForClerkUser` + `<NoPartnerAccounts />` race-handling (unchanged, `app/dashboard/configurator/_shared.tsx`) already covers the case where the webhook hasn't landed yet |
| E-6 (existing behavior, unaffected) | An already-signed-up partner admin returns via `/sign-in` | `GET /sign-in` | None (public route) | `fallbackRedirectUrl="/dashboard/configurator"` — already correct today, no change |

---

## 4. Screen / Flow Description

### State 1 — `/partner-signup`, company-name capture (NEW — Clio-owned, not Clerk)

A visitor lands on `/partner-signup`. Before Clerk's `<SignUp>` renders, this page now shows a
single-field, Clio-owned step:

- **Page-load gate.** The whole page waits on Clerk's `useAuth()` `isLoaded` flag before rendering
  State 1 at all — a brief `<div className="min-h-screen bg-void" />` shim renders in the interim.
  This mirrors the exact `!isLoaded` guard idiom already used by the now-deleted
  `app/partner-signup/organization/[[...organization]]/page.tsx`'s `!isLoaded || !isSignedIn` check
  — reused here because this page now needs to know `isSignedIn` (not just render unconditionally)
  before deciding what "Continue" does (see the branching rule below and State 2b).
- Full-viewport dark background (`bg-void`, `#080808`), centered content, same shell the page
  already uses today (`min-h-screen bg-void flex items-center justify-center`).
- A card, `max-w-sm` fluid width (per the standing responsive rule — no fixed pixel cap), background
  `#111111`, border `#222222`, rounded corners (`rounded-xl`), padding `p-6`.
- Heading text: `"Let's set up your Clio partner account"` — white, `text-xl font-semibold`.
- One label: `"Company name"` — `#94A3B8`, `text-sm font-medium`, `mb-1.5`.
- One text input, exact styling precedent already established by
  `app/dashboard/admin/team/TeamClient.tsx` line 361-367 (the existing "Add super-admin" email
  input): `className="w-full bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-sm
  text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED]"`. `type="text"`,
  `placeholder="Acme Corp"`, `maxLength={200}`.
- Inline validation error text (only shown after a failed submit attempt): `"Company name is
  required."` — `text-[#EF4444] text-xs mt-1.5`, same pattern as `TeamClient.tsx`'s
  `addSuperAdminError` line.
- One button: `"Continue"` — full-width, `bg-[#7C3AED] text-white`, hover `bg-[#A855F7]`, disabled
  (opacity-50, not-allowed cursor) while the input is empty/whitespace-only. Clicking it with a
  non-empty trimmed value **branches on `useAuth().isSignedIn`** (added in this revision — closes
  §9 Edge Case 2):
  - **Not signed in** (the ordinary case — a brand-new visitor): the page transitions to State 2
    (Clerk's `<SignUp>`, unchanged mechanics from v1.0 of this spec).
  - **Already signed in** (edge case 2's exact signal — a visitor who created their Clerk account
    via the bare `/sign-up` page or `/sign-in`'s built-in "Sign up" link *before* ever reaching
    `/partner-signup`, or an existing signed-in partner revisiting this page): the page transitions
    to **State 2b** instead, skipping Clerk's `<SignUp>` entirely — re-rendering `<SignUp>` for an
    already-authenticated visitor would be a dead end (Clerk simply recognizes the existing session
    and does nothing useful; there is no second account to create).
- No "skip" or "back" option. No other fields. This is the entire screen.

### State 2 — `/partner-signup`, Clerk `<SignUp>` (existing Clerk mechanics, metadata now attached)

Identical to today's `<SignUp>` render (`app/partner-signup/[[...partner-signup]]/page.tsx`
lines 26-46: same dark-void wrapper, same `appearance.variables`/`elements` overrides) with two
changes:
- `forceRedirectUrl="/partner-signup/organization"` → `forceRedirectUrl="/dashboard/configurator"`.
- A new `unsafeMetadata` prop is attached:
  ```ts
  unsafeMetadata={{ signup_intent: 'partner', company_name: companyName }}
  ```
  where `companyName` is the trimmed value captured in State 1 (held in the same page's client
  component state — no localStorage, no query string; State 1 and State 2 are two render branches
  of one client component, not two routes).

The visitor completes Clerk's own hosted sign-up (email/password or SSO, Clerk's own UI, unchanged
mechanics) exactly as today.

### State 2b — `/partner-signup`, already-signed-in visitor: authenticated claim (NEW — added in
this revision, closes the regression identified in CEO review, §9 Edge Case 2)

Reached only when State 1's "Continue" is clicked by a visitor whose Clerk session is already
active. Renders in the same card container in place of State 2:

- **Loading state.** Heading text replaces `"Let's set up your Clio partner account"` with
  `"Setting up your account..."` (same `text-xl font-semibold text-white` styling) plus a spinner —
  `Loader2` from `lucide-react`, `className="w-4 h-4 animate-spin"`, the exact spinner precedent
  already used by `TeamClient.tsx`'s own async row actions. No input, no button — this state is
  non-interactive.
- On entering this state, the page immediately fires `POST /api/partner-signup/claim` with
  `{ companyName }` (the same trimmed value captured in State 1).
- **On success** (`{ success: true, alreadyMember: boolean }` — see §6.4; both `alreadyMember: true`
  and `alreadyMember: false` redirect identically, no visible difference to the user): client-side
  navigation straight to `/dashboard/configurator` — no intermediate confirmation screen, matching
  how State 2's Clerk-driven redirect also lands directly on the Configurator with nothing in
  between.
- **On failure** (any non-2xx response, or a network error): the loading state is replaced by an
  inline error in the same card — `"Something went wrong setting up your account."`
  (`text-[#EF4444] text-sm`, this codebase's standard inline-error color) plus a `"Try again"` button
  (`bg-[#7C3AED] text-white`, same primary-button styling as "Continue") that re-fires the identical
  `POST /api/partner-signup/claim` call. This is the one path that, before this revision, had **no**
  recovery at all (CEO review's core finding) — it now always has one.

### State 3 — post-signup landing (unchanged existing behavior, reached from either State 2's Clerk
redirect or State 2b's client-side redirect; webhook now does more work)

Clerk redirects the browser straight to `/dashboard/configurator` the instant its own client-side
account creation completes — this does not wait for `POST /api/webhooks/clerk` to finish server-side.
`/dashboard/configurator`'s existing entry pages (`wizard/page.tsx`, `visualization/page.tsx`,
`integration/page.tsx`, etc.) already call `getPartnerAccountsForClerkUser(userId)` and render the
existing `<NoPartnerAccounts />` transient placeholder (`app/dashboard/configurator/_shared.tsx` line
325-331: `"You don't administer any partner accounts."`) if the webhook hasn't landed yet. **No
change needed here** — this race-handling was already generic (keyed on `partner_admin_users`
existence, not on anything Clerk-Organizations-specific) and continues to work identically once the
webhook's write path changes (§6).

### State 4 (retired) — `/partner-signup/organization`

Deleted outright, not stubbed. `app/partner-signup/organization/[[...organization]]/page.tsx` is
removed from the codebase entirely (§9's rationale: a route that 404s is more diagnosable than a
silent stub).

---

## 5. Visual Examples

### `/partner-signup` — State 1, company-name capture (Desktop + Mobile, same layout — fluid card)

```
┌─────────────────────────────────────────┐
│                                           │
│                                           │
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
│                                           │
│                                           │
└─────────────────────────────────────────┘
  bg-void (#080808) page background
  Card: bg-[#111111], border-[#222222], rounded-xl, p-6, max-w-sm (fluid,
  no hardcoded px cap — clamp()-based side padding on very narrow viewports)
```

### `/partner-signup` — State 1, validation error (after empty submit attempt)

```
┌─────────────────────────────┐
│  Let's set up your Clio      │
│  partner account             │
│                               │
│  Company name                │
│  ┌─────────────────────────┐ │
│  │                          │ │
│  └─────────────────────────┘ │
│  Company name is required.   │  ← text-[#EF4444] text-xs
│                               │
│  [       Continue       ]    │  ← still enabled once text is entered
└─────────────────────────────┘
```

### `/partner-signup` — State 2, Clerk `<SignUp>` (unchanged visual — existing Clerk-hosted form)

```
┌─────────────────────────────────────────┐
│     ┌─────────────────────────────┐     │
│     │  [Clerk-hosted sign-up form] │     │
│     │  (email/password or SSO,     │     │
│     │   dark-void appearance vars, │     │
│     │   unchanged from today)      │     │
│     └─────────────────────────────┘     │
└─────────────────────────────────────────┘
```

### `/partner-signup` — State 2b, already-signed-in visitor: loading (NEW)

```
┌─────────────────────────────┐
│                               │
│   ⟳  Setting up your         │  ← Loader2, animate-spin
│      account...               │
│                               │
└─────────────────────────────┘
```

### `/partner-signup` — State 2b, failure + retry (NEW)

```
┌─────────────────────────────┐
│  Something went wrong        │  ← text-[#EF4444] text-sm
│  setting up your account.    │
│                               │
│  [      Try again      ]     │  ← bg-[#7C3AED], re-fires the same POST
└─────────────────────────────┘
```

---

## 6. Data Requirements

### 6.1 Reads

- `app/api/webhooks/clerk/route.ts` reads `event.data.unsafe_metadata.signup_intent` and
  `event.data.unsafe_metadata.company_name` off the incoming Clerk `user.created` payload (no DB
  read needed to branch).
- `getPartnerAccountsForClerkUser` (`lib/partner/admin-accounts.ts`) — **unchanged**, already reads
  `partner_admin_users` by `clerk_user_id` only. Reused (not modified) by the new shared helper
  (§6.2) as the idempotency check for both write paths.
- `requirePartnerAdmin` (`lib/partner/auth.ts`) — **unchanged**, already reads
  `partner_admin_users` by `clerk_user_id` + `partner_account_id` only.

### 6.2 New shared helper — `lib/partner/signup.ts`, `createOrClaimPartnerAccount()`

Added in this revision per CEO review: rather than duplicating the account-creation logic in both
write paths (§6.3, §6.4), it is factored into one function both call, so there is exactly one place
this logic lives.

```ts
// lib/partner/signup.ts
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getPartnerAccountsForClerkUser } from './admin-accounts'
import { sendPartnerSignupWelcomeEmail } from '@/lib/delivery/email'
import { inngest } from '@/inngest/client'

export interface ClaimResult {
  success: boolean
  alreadyMember: boolean
  partnerAccountId: string | null
  error: string | null
}

/**
 * Creates a partner_accounts + partner_admin_users (role='owner') pair for a
 * Clerk user, or no-ops if they already administer a partner account.
 * Called from two places: the unsafeMetadata branch in the `user.created`
 * webhook (§6.3, keyed off the newly-created Clerk user id) and the
 * authenticated claim route (§6.4, keyed off an existing session's userId).
 * Idempotent: never creates a second partner_accounts row for a Clerk user
 * who already administers one.
 */
export async function createOrClaimPartnerAccount(
  clerkUserId: string,
  companyName: string,
  email: string
): Promise<ClaimResult> {
  const existing = await getPartnerAccountsForClerkUser(clerkUserId)
  if (existing.length > 0) {
    return { success: true, alreadyMember: true, partnerAccountId: existing[0].id, error: null }
  }

  const supabase = createSupabaseAdminClient()
  const { data: account, error: acctError } = await supabase
    .from('partner_accounts')
    .insert({ name: companyName, archetype: 'unspecified', status: 'active' })
    .select('id')
    .single()

  if (acctError || !account) {
    return { success: false, alreadyMember: false, partnerAccountId: null, error: acctError?.message ?? 'partner_accounts insert failed' }
  }

  const { error: adminError } = await supabase
    .from('partner_admin_users')
    .insert({ clerk_user_id: clerkUserId, partner_account_id: account.id, role: 'owner' })

  if (adminError) {
    // Orphaned partner_accounts row with no owner — same accepted, logged
    // edge case as v1.0's webhook-only design (§8), now reachable from
    // either write path. Not auto-rolled-back (no existing transactional
    // discipline in this codebase to match, per §8's original reasoning).
    return { success: false, alreadyMember: false, partnerAccountId: account.id, error: adminError.message }
  }

  inngest
    .send({ name: 'clio/partner-account.created', data: { partnerAccountId: account.id, companyName, createdAt: new Date().toISOString() } })
    .catch((err: unknown) => console.error('[partner-signup] Failed to emit clio/partner-account.created:', err))

  await sendPartnerSignupWelcomeEmail(email, companyName).catch(
    (err: unknown) => console.error('[partner-signup] sendPartnerSignupWelcomeEmail failed:', err)
  )

  return { success: true, alreadyMember: false, partnerAccountId: account.id, error: null }
}
```

No `partner_account_id` uniqueness constraint is added on `clerk_org_id` (that column is not
written to at all by this brief — see §6.6). `partner_accounts.name` has no application-level
uniqueness check — two different partners may legitimately share a company name (e.g. two
franchisees); nothing in the existing schema (migration 071, `name TEXT NOT NULL`, no unique index)
implies otherwise.

### 6.3 Write path A — `app/api/webhooks/clerk/route.ts`, new branch inside the existing `user.created` handler

The existing handler already does, unconditionally, for every new Clerk user (lines 89-106 of the
current file): upsert `users` (the B2C-era table — this write is harmless/inert for a partner
signup, since nothing reads a partner admin's row out of `users`) and emit `clio/user.created`
(drives the 75-minute abandoned-onboarding cleanup timer — also harmless/inert for a partner signup,
since that Inngest function only acts on B2C onboarding state that a partner signup will never
populate). **Neither of these existing unconditional side effects is touched or gated** — this
brief adds one new conditional branch alongside the existing `ONBOARD-DATA-01` branch, not a
replacement of the handler's existing behavior:

```ts
// New branch — sibling to the existing ONBOARD-DATA-01 unsafeMetadata branch,
// checked first since the two are mutually exclusive by signup_intent.
if (event.data.unsafe_metadata?.signup_intent === 'partner') {
  const companyName = typeof event.data.unsafe_metadata.company_name === 'string'
    ? event.data.unsafe_metadata.company_name.trim()
    : ''
  if (!companyName) {
    console.error('[clerk-webhook] partner signup_intent with missing/empty company_name for', id)
    // No partner_accounts row is created — see §8 Edge Cases for why this
    // is treated as a hard-stop rather than a fallback name.
  } else {
    const result = await createOrClaimPartnerAccount(id, companyName, primaryEmail)
    if (!result.success) {
      console.error('[clerk-webhook] createOrClaimPartnerAccount failed:', result.error)
    }
  }
  return NextResponse.json({ received: true })
}
```

This branch `return`s before reaching the existing `ONBOARD-DATA-01`/`saveOnboardingProfile` block
and the generic `sendSignupWelcomeEmail` call at the bottom of the handler — a partner signup never
runs the B2C onboarding-save path, matching the CEO brief's Q1 branch instruction exactly ("if
`signup_intent === 'partner'`, create `partner_accounts` + `partner_admin_users` ... instead of
running the consumer onboarding-save path").

### 6.4 Write path B (NEW, added per CEO review) — `POST /api/partner-signup/claim`

New route, `app/api/partner-signup/claim/route.ts`. Serves State 2b (§4) — the already-signed-in-
visitor path identified in §9 Edge Case 2.

- **Auth:** `const { userId } = clerkAuth()` (`@clerk/nextjs/server`); no session →
  `401 { error: 'Unauthorized' }` (identical shape to `requirePartnerAdmin`'s own 401,
  `lib/partner/auth.ts`).
- **Body:** Zod-validated `{ companyName: z.string().trim().min(1).max(200) }` → `422` with the
  standard Zod validation-error shape on failure (mirrors this codebase's existing convention for
  `/api/admin/team/*`, B2B-21 §9).
- **Email lookup:** fetches the current user's primary email via `currentUser()`
  (`@clerk/nextjs/server`) — needed for `sendPartnerSignupWelcomeEmail`, since (unlike the webhook)
  this route receives no Clerk payload with `email_addresses` on it. Mirrors the exact
  `clerkClient().users.getUser(userId)` → primary-email-lookup pattern already used by
  `saveOnboardingProfile` (`lib/onboarding.ts` lines 53-58) — same goal, different call site (`
  currentUser()` vs. that function's admin-SDK `clerkClient().users.getUser(userId)`; `currentUser()`
  is the correct choice here since this is an authenticated route handler acting on the current
  session, not a server-side lookup by an arbitrary user id — CEO re-review note, tightened for
  accuracy).
- **Body:** calls `createOrClaimPartnerAccount(userId, companyName, email)` (§6.2) — the identical
  shared logic write path A uses; this route contains no account-creation logic of its own.
- **Response:** `200 { success: true, alreadyMember: boolean }` on success (client redirects either
  way, §4 State 2b); `500 { success: false, error: 'Failed to set up your account.' }` on failure
  (client shows the inline "Try again" error, §4 State 2b).
- **Middleware:** not added to `middleware.ts`'s public-route matcher — unnecessary. Confirmed by
  reading `middleware.ts` directly: `/api/*` routes are never gated by `auth().protect()` in this
  codebase regardless of the public-route list (line 91-94: "API routes handle auth via
  `requireAuth()` in the route handler itself. Only apply Clerk's redirect-to-sign-in gate on page
  routes."). This route's own `clerkAuth()` check inside the handler is the complete and correct
  auth gate — exactly the same shape as every existing `/api/admin/*` route.

### 6.5 New Inngest event: `clio/partner-account.created`

Replaces `clio/partner-org.created` as the trigger for `inngest/partner-signup-reminder.ts`
(§9/§12 — the file needs a one-line trigger-name change plus a payload-field rename, no logic
change: `orgName` → `companyName` used identically, `partnerAccountId` unchanged). This is a
same-brief, same-deploy rename, not a parallel/duplicate event — the old `clio/partner-org.created`
event name stops being emitted anywhere the instant `app/api/webhooks/clerk-organization/route.ts`
is deleted, so both names existing transiently is not a concern. Emitted from within the shared
helper (§6.2), so it fires identically regardless of which write path created the account.

### 6.6 Schema — no migration required

No new table, no new column. `partner_accounts.clerk_org_id` — added by migration
`079_b2b06_provisioning.sql` (`ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS clerk_org_id
TEXT UNIQUE`), **not** migration 071 as the CEO brief's own Technical Findings stated; corrected
here after a direct read of both migration files during CEO review — 071 only creates the base
`partner_accounts`/`partner_admin_users` tables, no `clerk_org_id` column — stays in place,
nullable, simply never written to by any live code path after this brief ships (per the CEO brief's
explicit instruction and this project's "hide, don't delete without approval" default). No
migration file is needed for this brief.

### 6.7 localStorage / sessionStorage

None. The company name travels only as React client-component state within the single
`/partner-signup` page — for the few seconds between State 1 and State 2's Clerk `unsafeMetadata`
submission (write path A), or between State 1 and State 2b's `POST /api/partner-signup/claim` body
(write path B, added this revision). Never persisted client-side, never round-tripped through a
query string or storage API, in either path.

### 6.8 Deletions

- `app/partner-signup/organization/[[...organization]]/page.tsx` — deleted.
- `app/api/webhooks/clerk-organization/route.ts` — deleted.
- `CLERK_ORGANIZATION_WEBHOOK_SECRET` — removed from `.env.local.example` and any other env
  documentation once no code reads it.

---

## 7. Success Criteria (Acceptance Tests)

1. ✓ Given a signed-out visitor at `/partner-signup`, when the page loads, then State 1 (company-name
   capture) renders first — no Clerk component is mounted yet.
2. ✓ Given State 1, when "Continue" is clicked with an empty/whitespace-only company name, then the
   inline "Company name is required." error shows and the page does not advance to State 2.
3. ✓ Given State 1, when "Continue" is clicked with a non-empty company name, then State 2 (Clerk
   `<SignUp>`) renders with `unsafeMetadata={{ signup_intent: 'partner', company_name: <trimmed value> }}`
   attached to the `<SignUp>` call.
4. ✓ Given a visitor completes Clerk's hosted sign-up form in State 2, when Clerk fires `user.created`
   to `POST /api/webhooks/clerk`, then a `partner_accounts` row is created with
   `name = <the captured company name>`, `status = 'active'`, and a `partner_admin_users` row is
   created for that Clerk user with `role = 'owner'`.
5. ✓ Given the same successful signup, when the webhook completes, then `clio/partner-account.created`
   is emitted to Inngest and `sendPartnerSignupWelcomeEmail(email, companyName)` is called.
6. ✓ Given the same successful signup, when Clerk's client redirects the browser, then it lands
   directly on `/dashboard/configurator` — no intermediate "create your organization" screen is ever
   shown, and `GET /partner-signup/organization` returns a 404 (route no longer exists).
7. ✓ Given the webhook has not yet landed at the moment `/dashboard/configurator` first renders, when
   `getPartnerAccountsForClerkUser` returns zero accounts, then the existing `<NoPartnerAccounts />`
   placeholder renders (unchanged component, unchanged behavior) — no error, no crash.
8. ✓ Given a Clerk `user.created` event with no `unsafe_metadata` at all (e.g. an unrelated Clerk
   account event, or a legacy signup), when the webhook processes it, then neither the new partner
   branch nor the existing `ONBOARD-DATA-01` branch fires, and the handler's existing unconditional
   `users` upsert + welcome-email behavior is unaffected (non-regression).
9. ✓ Given `POST /api/webhooks/clerk-organization` is hit directly (e.g. a stale Clerk redirelivery
   attempt after the Clerk-dashboard-side webhook endpoint is removed per §9), then the request
   receives Next.js's standard 404 (route file no longer exists) rather than a 200 or 500.
10. ✓ Given an existing signed-in partner admin visits `/sign-in`, when they authenticate, then
    `fallbackRedirectUrl="/dashboard/configurator"` fires exactly as it does today (non-regression —
    this brief does not touch the sign-in redirect for existing users).
11. ✓ Given a brand-new visitor who reaches Clerk's hosted sign-up via `/sign-up` or the "Sign up"
    link inside `/sign-in` (not via `/partner-signup` directly), when they complete sign-up, then
    they land on `/partner-signup` (not a 404, not the deleted organization step) per the redirect-
    target fix in §9 — and, since no company name was ever captured for this path, `/partner-signup`
    is treated as a fresh, un-started signup (State 1 renders normally; nothing pre-fills or breaks).
12. ✓ Given that same visitor (now signed in, with no `partner_accounts` membership) reaches State 1
    and submits a company name, when "Continue" is clicked, then State 2b renders (not Clerk's
    `<SignUp>`), `POST /api/partner-signup/claim` fires with the captured name, and a
    `partner_accounts` + `partner_admin_users` (`role='owner'`) row is created for them — closing
    the regression identified in CEO review (§9 Edge Case 2). This also covers a visitor who reaches
    `/partner-signup` directly via `MarketingNav.tsx`'s "Log in" CTA → Clerk's built-in "Sign up"
    link, the concrete path the CEO review traced.
13. ✓ Given an already-signed-in visitor who **already** administers a `partner_accounts` row (e.g.
    a fully onboarded partner who revisits `/partner-signup`), when State 2b's claim call fires,
    then `createOrClaimPartnerAccount` returns `alreadyMember: true` without creating a duplicate
    row, and the visitor is still redirected to `/dashboard/configurator` — no error, no duplicate
    account, no visible difference from AT-12's first-time case.
14. ✓ Given `POST /api/partner-signup/claim` fails (no session, invalid body, or a Supabase error),
    when State 2b's request returns a non-success response, then the inline "Something went wrong
    setting up your account." error and "Try again" button render, and clicking "Try again" re-fires
    the identical request without a full page reload.
15. ✓ Given `requirePartnerAdmin`, `getPartnerAccountsForClerkUser`, and the `partner_admin_users`
    table's schema, when this brief ships, then none of the three has been modified (grep/diff check
    — mirrors B2B-21's own hardest non-regression constraint).
16. ✓ `npx tsc --noEmit` clean; `npm run build` passes; no unapproved packages introduced; no new
    colors/typography tokens introduced by the new company-name screen or State 2b (only tokens
    already used elsewhere in this codebase, per §4/§5).

---

## 8. Error States

| Surface | Failure | Behavior |
|---|---|---|
| `/partner-signup` State 1 | Empty/whitespace company name on submit | Inline error, no advance to State 2 (§7 AT-2) |
| `/partner-signup` State 2 | Clerk sign-up itself fails (existing Clerk-hosted error UI) | Unchanged — Clerk's own hosted form shows its own inline errors; out of this brief's control or scope, identical to today |
| `POST /api/webhooks/clerk`, partner branch | `unsafe_metadata.company_name` missing or empty despite `signup_intent === 'partner'` (should be structurally impossible via State 1's own required-field gate, but the webhook must not trust client-supplied metadata blindly) | Logged as an error server-side; **no** `partner_accounts`/`partner_admin_users` row is created; the handler still returns `200 { received: true }` to Clerk (never retry-loop a webhook over a client-side data-quality issue); the user lands on `/dashboard/configurator` and sees the existing `<NoPartnerAccounts />` placeholder indefinitely — a real but expected-rare dead end, logged for manual follow-up (no automated recovery is built here; not worth new UI for a case that requires bypassing a required client-side field) |
| `POST /api/webhooks/clerk`, partner branch | `partner_accounts` insert fails (Supabase error) | Logged; `200` returned to Clerk (matches the existing handler's non-5xx discipline for its other writes); no `partner_admin_users` row is attempted; same `<NoPartnerAccounts />` dead-end as above |
| `POST /api/webhooks/clerk`, partner branch | `partner_accounts` insert succeeds, `partner_admin_users` insert fails | Logged; **orphaned `partner_accounts` row with no owner** — flagged as a known, accepted edge case (§9), not auto-rolled-back (this webhook has never used a DB transaction for its existing B2C writes either — matching that existing discipline, not introducing a new pattern) |
| `POST /api/webhooks/clerk`, partner branch | `sendPartnerSignupWelcomeEmail` fails | Non-blocking — already caught with `.catch()`, logged, never blocks the row creation (mirrors the existing `clerk-organization` webhook's own non-blocking email discipline, §6.2) |
| `POST /api/webhooks/clerk`, partner branch | Inngest emit fails | Non-blocking — already caught with `.catch()`, logged (mirrors the existing pattern exactly) |
| `GET /partner-signup/organization` (post-deploy) | Route file deleted | Standard Next.js 404 (§7 AT-9) |
| `POST /api/webhooks/clerk-organization` (post-deploy, stale Clerk redelivery) | Route file deleted | Standard Next.js 404 — diagnosable if Clerk ever redelivers against a still-configured endpoint (§9 rollout note covers removing the endpoint from Clerk's dashboard in the same deploy window) |
| `POST /api/partner-signup/claim` (NEW) | No Clerk session | `401 { error: 'Unauthorized' }` (mirrors `requirePartnerAdmin`) |
| `POST /api/partner-signup/claim` (NEW) | `companyName` missing, empty, or over 200 chars | `422` Zod validation error |
| `POST /api/partner-signup/claim` (NEW) | `createOrClaimPartnerAccount` fails (Supabase error at either insert, §6.2) | `500 { success: false, error: 'Failed to set up your account.' }` — client shows State 2b's inline "Try again" error (§4 State 2b); this is the recovery path that did not exist for this scenario before CEO review (§9 Edge Case 2) |
| `/partner-signup` State 2b | Network failure calling the claim route (no response at all) | Same inline "Try again" error/retry as above — indistinguishable to the user from a server-side failure, same recovery |

---

## 9. Edge Cases

1. **`/sign-in` and `/sign-up`'s own redirect targets — an additional finding beyond the CEO
   brief's file list, closed under this same brief.** A direct grep found two files the brief did
   not name: `app/(auth)/sign-in/[[...sign-in]]/page.tsx` (`signUpForceRedirectUrl="/partner-signup/organization"`)
   and `app/(auth)/sign-up/[[...sign-up]]/page.tsx` (`forceRedirectUrl="/partner-signup/organization"`).
   Both were retargeted from `/onboarding` to `/partner-signup/organization` during B2B-18 (retiring
   the B2C signup chain) so that *any* Clerk sign-up entry point — not just `/partner-signup` itself
   — funnels into the partner flow, since B2C's own onboarding no longer exists. Both must be
   updated in this same brief to point at `/partner-signup` instead of the now-deleted
   `/partner-signup/organization`, or a brand-new user reaching Clerk via `/sign-up` directly would
   hit a 404 immediately after creating their account. This is a mechanical redirect-target fix
   (identical shape to the change already being made in `app/partner-signup/[[...partner-signup]]/page.tsx`
   itself), not a product-shape decision — resolved here, not escalated (§7 AT-11).
2. **A user who reaches Clerk via `/sign-up` or `/sign-in`'s "Sign up" link, not via
   `/partner-signup` — RESOLVED in this revision, not deferred.** Originally logged (v1.0 of this
   spec) as a narrow gap deferred to `BACKLOG.md`. CEO review independently re-verified this as
   materially more severe than that framing and required a fix in-brief, for two reasons this spec
   did not originally weigh: (a) `components/marketing/MarketingNav.tsx` lines 34-48 — read directly
   to confirm — put "Log in" (→ `/sign-in`) and "Get started" (→ `/partner-signup`) as two co-equal,
   always-visible top-nav CTAs shown to every marketing-site visitor before any account exists,
   meaning `/sign-in` (and, via its own "Sign up" link, Clerk's built-in sign-up) is a first-class,
   intentionally-built entry surface, not a bookmark/legacy path nobody uses; (b) the CEO brief's own
   Technical Findings already establish `/sign-in`/`/sign-up`'s redirect targets were deliberately
   pointed at the partner flow during B2B-18 specifically so *any* Clerk sign-up entry point funnels
   into it. Combined with the fact that, pre-this-brief, this same path still worked (it funneled
   into `<CreateOrganization>`, which — bugs aside — could still create a `partner_accounts` row):
   this brief, unfixed, would have turned a working path into a **permanent, silent dead end** — a
   regression this same brief introduces, not a pre-existing, independently-scoped gap.

   **Fix (State 2b, §4; write path B, §6.4):** `/partner-signup`'s "Continue" button branches on
   `useAuth().isSignedIn` after State 1's company-name capture. An already-signed-in visitor (this
   edge case's exact signal) skips Clerk's `<SignUp>` entirely and the page instead calls
   `POST /api/partner-signup/claim`, which runs the identical `partner_accounts`/`partner_admin_users`
   creation logic as write path A (both now call the same `createOrClaimPartnerAccount` helper,
   §6.2) keyed off the current Clerk session's `userId` instead of `unsafe_metadata`. This closes the
   gap within this brief — no `BACKLOG.md` follow-on remains for this path (§10, §12 updated
   accordingly). The narrower "second onboarding-completion webhook" and "redirect before Clerk's
   form renders" alternatives considered in v1.0 remain correctly ruled out as oversized; this fix
   achieves the same outcome at the same blast radius as the rest of this brief.
3. **A partner who already exists (has a `partner_admin_users` row) revisits `/partner-signup` while
   still signed in — updated in this revision.** Previously (v1.0) this relied on Clerk's own
   `<SignUp>` implicitly recognizing an already-authenticated session and doing nothing further. With
   State 2b's `isSignedIn` branch now in place (§4, added for edge case 2), this visitor instead sees
   State 1 (company-name capture — the page has no way to know they're already fully onboarded) and,
   on "Continue," reaches State 2b, whose claim call correctly resolves via `alreadyMember: true`
   (§6.2's idempotency check) — no duplicate row, straight redirect to `/dashboard/configurator`.
   Net effect is the same as v1.0 (no duplicate, ends up at the Configurator) but now via an explicit,
   tested code path (§7 AT-13) rather than incidental Clerk behavior. The one visible difference: this
   visitor briefly sees the company-name screen again before landing on the Configurator — a minor,
   accepted UX redundancy for a rare path (a fully onboarded partner manually navigating back to
   `/partner-signup`), not worth special-casing away given this brief's blast-radius constraints.
4. **Two browser tabs, same visitor, State 1 completed differently in each.** Each tab holds its own
   independent client-component state — no shared/global state — so this behaves like any other
   uncoordinated multi-tab form-fill; whichever tab's Clerk sign-up actually completes first is the
   one whose `unsafe_metadata` reaches the webhook. Not a new risk this brief introduces.
5. **Mobile vs desktop.** State 1's card is `max-w-sm` with fluid horizontal padding (`clamp()`-based
   per the standing responsive rule), no fixed pixel width cap; identical layout at every breakpoint
   (a single centered card was already the existing pattern for both `/partner-signup` and the now-
   deleted `/partner-signup/organization`, so no new responsive behavior is being invented).
6. **Company name with leading/trailing whitespace, or containing only symbols/emoji.** Trimmed
   client-side before validation and before being sent as `unsafeMetadata` (§4 State 1) or in the
   claim route's POST body (§4 State 2b); no further content restriction is applied — matches this
   codebase's existing discipline of not over-validating free-text name fields (e.g.
   `partner_accounts.name` itself has no format constraint in the existing schema).
7. **Slow network between State 1 submit and Clerk's hosted form finishing its own load in State 2.**
   No network call is made at the State 1→2 transition itself (it's a pure client-side state change,
   §4) — only Clerk's own form-load latency applies, unchanged from today's existing `<SignUp>`
   render.

---

## 10. Out of Scope

- The sales-partner entity itself (self-serve signup, client CRUD, dashboard) — separate brief per
  the brainstorm doc.
- Renaming B2B-21's "sales-partner" role to "internal-staff" — separate brief.
- Any partner-facing "invite a teammate" feature — confirmed not to exist today (CEO brief finding,
  independently unchanged by this brief); not built here.
- A "rename my company" / partner-account-settings UI — no such UI exists today; the company name
  captured at signup is effectively permanent until a future brief builds one (CEO brief Q2 finding).
- Dropping the `partner_accounts.clerk_org_id` column — left in place, nullable, unused (CEO brief's
  explicit instruction).
- Subdomain routing, billing model changes, the generic `tenant_staff_users` table — later briefs.
- Manually removing the Clerk-dashboard-side `organization.created`/`organizationMembership.created`
  webhook subscription — a one-time manual action in Clerk's own dashboard, documented as a rollout
  step (§9 rollout note below), not application code.

---

## 11. Open Questions

None. Every point requiring a decision was either already resolved in the CEO brief (Q1-Q4, adopted
as-is) or resolved here with direct source verification and documented reasoning (the company-name
screen's exact spec, the `/sign-in`/`/sign-up` redirect-target finding, the webhook branch's exact
code, the Inngest event rename, and — added in this revision per CEO review — the already-signed-in
visitor's State 2b flow and the shared `createOrClaimPartnerAccount` helper). Section 11 is empty,
per this project's gate for CEO approval.

---

## 12. Dependencies

**Must be true before build (all confirmed present):**
- `app/api/webhooks/clerk/route.ts` — existing `user.created` handler with the proven
  `ONBOARD-DATA-01` `unsafeMetadata` pattern this brief's new branch sits alongside.
- `partner_accounts` / `partner_admin_users` tables (migration 071) — unchanged shape, only the
  write path changes.
- `sendPartnerSignupWelcomeEmail(email, orgName)` (`lib/delivery/email.ts` line 592) — reused as-is;
  its second parameter is already a plain string display name, not Clerk-Organization-specific
  despite its current parameter name — no signature change needed, `companyName` is passed
  positionally where `orgName` is expected.
- `inngest/partner-signup-reminder.ts` — existing file, needs the trigger-event rename (§6.5).
- `middleware.ts` — `/partner-signup(.*)` public-route matcher already covers the single remaining
  page; its comment (currently "Clerk `<SignUp/>` + `<CreateOrganization/>`") needs a one-line
  update to reflect the removed step; no matcher-logic change.

**New files (added this revision):**
- `lib/partner/signup.ts` — `createOrClaimPartnerAccount()`, the shared helper (§6.2) called by
  both write paths.
- `app/api/partner-signup/claim/route.ts` — write path B (§6.4), serves State 2b.

**Modified files:**
- `app/partner-signup/[[...partner-signup]]/page.tsx` — add State 1 (company-name capture) as a
  new client-component render branch ahead of the existing `<SignUp>` render; change
  `forceRedirectUrl` to `/dashboard/configurator`; attach `unsafeMetadata`; add the
  `useAuth().isSignedIn` branch and State 2b (added this revision, §4).
- `app/api/webhooks/clerk/route.ts` — add the new `signup_intent === 'partner'` branch, now calling
  the shared helper (§6.2, §6.3).
- `inngest/partner-signup-reminder.ts` — trigger event `clio/partner-org.created` →
  `clio/partner-account.created`; payload field `orgName` → `companyName` (used identically
  throughout the function body, no logic change).
- `app/(auth)/sign-in/[[...sign-in]]/page.tsx` — `signUpForceRedirectUrl` →
  `/partner-signup` (§9 edge case 1).
- `app/(auth)/sign-up/[[...sign-up]]/page.tsx` — `forceRedirectUrl` → `/partner-signup` (§9 edge
  case 1).
- `middleware.ts` — update the `/partner-signup(.*)` matcher's inline comment only. No matcher entry
  needed for `/api/partner-signup/claim` (§6.4's own reasoning — `/api/*` routes are never gated by
  `auth().protect()` in this codebase regardless of the public-route list).
- `.env.local.example` — remove `CLERK_ORGANIZATION_WEBHOOK_SECRET`.
- `docs/b2b-pivot-status.md` — Live Status table entry for B2B-25 updated to reflect merged state
  once shipped (Orchestrator's standing responsibility, not a file this spec hands to Dev).

**Deleted files:**
- `app/partner-signup/organization/[[...organization]]/page.tsx`
- `app/api/webhooks/clerk-organization/route.ts`

**No `BACKLOG.md` entry required this revision** — v1.0 planned to log Edge Case 2's gap there; it
is now resolved in-brief (§9) instead, so that line item is removed rather than added.

**Explicitly not touched (verified independently, not just trusted from the CEO brief):**
`lib/partner/auth.ts`'s `requirePartnerAdmin` function body (read in full — confirmed it already
reads `partner_admin_users` purely by `clerk_user_id` + `partner_account_id`, zero Clerk-
Organizations awareness), `lib/partner/admin-accounts.ts`'s `getPartnerAccountsForClerkUser` (read
in full — same finding), `partner_admin_users` table shape (migration 071, read directly — `role
TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin','member'))`, unchanged by this brief),
`app/dashboard/configurator/_shared.tsx`'s `<NoPartnerAccounts />` race-handling (read in full —
confirmed generic, keyed only on `partner_admin_users` existence), `components/marketing/MarketingNav.tsx`
(read in full this revision — confirmed "Log in"/"Get started" are co-equal always-visible CTAs at
lines 34-48, grounding §9 Edge Case 2's severity), `middleware.ts` (read in full this revision —
confirmed `/api/*` routes bypass the public-route matcher entirely, grounding §6.4's claim that no
matcher change is needed for the new route).

**Rollout note (not application code, but must happen in the same deploy window per the CEO brief's
Q4 staging guidance, confirmed correct after independent verification — see below):** the Clerk-
dashboard-side webhook endpoint subscription for `organization.created` /
`organizationMembership.created` must be removed (or pointed elsewhere) at or before this deploy, so
there is no window where Clerk retries a now-404ing endpoint indefinitely. This is a manual
dashboard action, not something Dev can automate from this repo.

**Staging/cutover — independently confirmed, not taken as given.** Re-verified the CEO brief's Q4
reasoning directly against the code read for this spec: (a) `partner_accounts`/`partner_admin_users`
carry zero live rows (confirmed via the Orchestrator's already-completed data wipe, out of this
brief's scope per the brief itself) so no live partner's auth is at risk; (b) `requirePartnerAdmin`
and `getPartnerAccountsForClerkUser` — both read in full for this spec — contain no
Clerk-Organizations-aware code at all, confirming the read path is genuinely untouched; (c) the
write-path change is fully contained to the signup moment (one webhook branch, one page). Single-
deploy, non-feature-flagged cutover is confirmed safe.

---

*End of Requirement Document B2B-25 v1.1 — all 12 sections filled, Section 11 empty. Revised per CEO
review of v1.0 (State 2b / claim-route addition, §6.6 citation fix), re-reviewed and APPROVED
2026-07-19. Cleared for Dev.*
