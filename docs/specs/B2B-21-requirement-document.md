# B2B-21 — Internal Admin Identity (Super-Admin + Sales-Partner) & Internal-Admin RBAC Gate — Requirement Document

Version: 1.0
Status: APPROVED — CEO sign-off 2026-07-18, all claims verified against source. Cleared for Dev.
Author: Business Analyst Agent
Date: 2026-07-18
Source brief: `.claude/agents/clio/feature-briefs/B2B-21-internal-admin-identity-super-admin-and-sales-partner.md`

> Scope in one line: build a new, orthogonal internal-identity layer (`internal_admin_users` +
> `sales_partner_assignments`, new `requireSuperAdmin()` / `requireInternalAdmin()` helpers) that
> never touches `partner_admin_users`/the Clerk-Org webhook/`requirePartnerAdmin`, seed
> `hello.arunprakash83@gmail.com` as the first super-admin, gate the three unprotected internal
> cross-partner surfaces (`clients`, `glitches`, `templates` + their `/api/admin/*` backing routes)
> behind it, and add one minimal super-admin-only "Team" screen for inviting sales-partners and
> adding super-admins. Commission %, e-signature, and geo/language scoping are explicitly frozen and
> appear nowhere below.

---

## 1. Purpose

Clio has no concept of its own internal team's identity. The only role model in the codebase today is
`partner_admin_users` — a *partner's own staff*, scoped to that one partner's own account and
populated automatically by the Clerk Organizations webhook (`app/api/webhooks/clerk-organization/route.ts`).
There is no notion of a Clio-internal operator who works *across* partners.

This produces two concrete, present-tense failures, confirmed directly at source during this spec's
research:

1. **No internal identity layer exists anywhere in the schema or codebase.** There is no way to
   express "this person is a Clio super-admin with full cross-partner reach" or "this person is a
   Clio sales-partner scoped to specific partner accounts." A grep for `super_admin` / `sales_partner`
   across the repo returns nothing but incidental hits.
2. **The three internal cross-partner pages are unprotected (P0-urgency).**
   `app/dashboard/admin/clients/page.tsx`, `app/dashboard/admin/glitches/page.tsx`, and
   `app/dashboard/admin/templates/page.tsx` each do only
   `const clerkUser = await currentUser(); if (!clerkUser) redirect('/sign-in')` — no role check —
   before rendering. Their backing `/api/admin/*` routes are gated by `requireAuth()`
   (`lib/clerk.ts`), which is "is there any Clerk session → 200, else 401," or in three cases
   (`repair-session-titles`, `seed-topic-cache`, and the templates-page's actual backing route
   `GET /api/templates/library`'s sibling reads) have **no role check at all beyond "any session"**
   — meaning **any authenticated Clerk user, including any partner admin who signed up through the
   normal self-serve partner flow, can today reach Clio's internal cross-partner billing, glitch, and
   template-approval screens and data.**

**Failure without it:** the identity gap blocks every future internal-operator feature (nothing to
build a super-admin console or a sales-channel on top of), and the RBAC gap is a live, exploitable
authorization defect — any partner's own admin can currently view every other partner's billing
balances, revenue, and unresolved glitch reports simply by guessing or being told the URL.

---

## 2. User Stories

**US-1 — Super-admin (Arun, or a peer he adds):**
As a Clio super-admin,
I want to sign in with my normal Clerk account and have full, unscoped access to every internal
cross-partner screen (clients/billing, glitches, templates) plus a Team page to add other
super-admins and invite sales-partners,
So that I can operate Clio across all partners without being folded into any single partner's own
admin team.

**US-2 — Sales-partner (invited by a super-admin):**
As a Clio sales-partner invited and tagged to specific partner accounts,
I want to sign in and see only the internal screens and partner data I've been scoped to,
So that I can do my job (e.g. monitoring glitches for the partners I brought on) without reaching
partner accounts, billing detail, or Clio-internal tooling outside my scope.

**US-3 — Existing partner admin (negative case):**
As a partner's own admin, signed up through the normal self-serve `partner-signup` flow,
I want the product to behave correctly if I ever guess or am sent a `/dashboard/admin/*` URL,
So that I get a clean "not found," never Clio's internal cross-partner data.

**US-4 — Existing partner-admin model (non-regression):**
As the existing `partner_admin_users` / Clerk-Organizations system,
I want to be completely unaffected by this brief,
So that partner self-serve signup, the Configurator, and partner-key management keep working
byte-for-byte unchanged.

---

## 3. Trigger / Entry Point

This brief adds **one new area** (`/dashboard/admin/team` + its backing API), **gates three existing
pages + their backing routes**, and adds **one new public accept-invite page**. No change to
`middleware.ts`'s Clerk-session / partner-domain-block behavior beyond adding two new public-route
patterns (§9).

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| E-1 | Super-admin/sales-partner opens an internal screen | `/dashboard/admin/{clients,glitches,templates,team}` | Clerk session + `requireSuperAdmin()` or `requireInternalAdmin()` per screen (§4, §6) | Signed in; bound `internal_admin_users` row with `status='active'` |
| E-2 | Super-admin adds another super-admin email | `POST /api/admin/team/super-admins` | `requireSuperAdmin()` | Signed in as an active super-admin |
| E-3 | Super-admin invites a sales-partner | `POST /api/admin/team/sales-partners` | `requireSuperAdmin()` | Signed in as an active super-admin; ≥1 target partner account exists |
| E-4 | Invitee accepts an invite | `GET /invite/accept?token=...` (public page) → `POST /api/admin/team/invites/accept` | Token + Clerk session (may be freshly created at this step) | Valid, unexpired, unconsumed invite token |
| E-5 | A now-gated internal page/route is hit by anyone else | any `/dashboard/admin/*` page or its backing `/api/admin/*` route | `requireSuperAdmin()` / `requireInternalAdmin()` fails | No session, or a session with no `internal_admin_users` row, or a `partner_admin_users`-only session |

---

## 4. Screen / Flow Description

### 4.A — Gated existing pages (content unchanged, gate added only)

Per the CEO brief's explicit instruction, this brief does **not** redesign `clients`, `glitches`, or
`templates` — it only adds a role check ahead of the existing `currentUser()` check. Each page's
`page.tsx` gains one extra step between "is there a Clerk session" and "render the existing client
component":

- **State G1 — no Clerk session.** Unchanged: `redirect('/sign-in')`.
- **State G2 — Clerk session, no bound `internal_admin_users` row (or a `deactivated` one).** New:
  `notFound()` (Next.js built-in, renders the app's standard not-found page). This covers a partner
  admin, a B2C-legacy user, or a deactivated former sales-partner. No "you don't have access" page is
  built (§11 Q8 rationale below) — this mirrors the existing `neutralNotFoundResponse()` convention
  `middleware.ts` already uses to hide `/dashboard`/`/api/admin/*` from partner white-label domains:
  don't reveal that an internal surface exists to someone not entitled to know about it.
- **State G3 — active super-admin.** Renders exactly as today, full data, no filtering.
- **State G4 — active sales-partner, on `glitches`.** Renders the existing `GlitchDashboardClient`,
  but every read is forced-scoped to the sales-partner's tagged partner accounts (§6.3). No client-side
  change is needed beyond the API response being pre-filtered.
- **State G5 — active sales-partner, on `clients` or `templates`.** New: `notFound()`. Per §11 Q2,
  billing/revenue detail and the global template-approval queue are super-admin-only (§11 rationale).

No wireframe is needed for G1–G5 beyond the above — the *visual content* of these three pages is
explicitly untouched (Out of Scope §10).

### 4.B — New page: `/dashboard/admin/team` (super-admin only)

- **State T1 — page load.** `requireSuperAdmin()` gate (fails → `redirect('/sign-in')` if no session,
  `notFound()` if session but not a super-admin — including an active sales-partner, who has no reason
  to manage the team). On pass: fetches `GET /api/admin/team/super-admins`,
  `GET /api/admin/team/sales-partners`, and `GET /api/admin/team/partner-accounts` (a minimal
  `{id, name}` list for the tagging picker — the one genuinely new cross-partner read this brief adds,
  and it returns only id+name, nothing financial).
- **State T2 — "Super-admins" panel.** Lists every `internal_admin_users` row with
  `role='super_admin'`: email, status (`pending` / `active`), invited-by (email or "—" for the seed
  row), added date. An inline "Add super-admin" row: one email input + "Add" button. On submit →
  `POST /api/admin/team/super-admins`.
- **State T3 — "Sales-partners" panel.** Lists every `internal_admin_users` row with
  `role='sales_partner'`: email, status badge (`pending` / `active` / `deactivated`), a chip list of
  their tagged partner account names (from `sales_partner_assignments`), invited date. Each row has:
  **Edit tags** (opens the same multi-select used at invite time, pre-populated), **Resend invite**
  (visible only while `status='pending'`), **Deactivate** / **Reactivate** (label flips per current
  status). A prominent **"Invite sales-partner"** button opens an inline form (not a separate route):
  email input + a multi-select checklist of partner accounts (from the `partner-accounts` read) +
  "Send invite" button. On submit → `POST /api/admin/team/sales-partners`.
- **State T4 — action feedback.** Every action (add super-admin, invite, edit tags, resend, deactivate,
  reactivate) is an in-place async action on the same page: a small inline spinner on the acted-upon
  row/button while pending, then either the list re-fetches (success) or an inline red error line
  appears directly under the form/row that failed (failure) — no toast system exists in this codebase
  to reuse, so this mirrors the existing inline-error convention already used by `PartnerBillingClient`
  and the Configurator section clients.
- **State T5 — last-super-admin guard.** If the only remaining `active`+`pending` super-admin row is
  the one a user is trying to deactivate, the "Deactivate" action is disabled client-side with a tooltip
  ("At least one super-admin must remain") and the server independently rejects it (422) — defense in
  depth, matching this codebase's existing pattern of never trusting a client-side-only guard for a
  destructive action.

### 4.C — New public page: `/invite/accept`

- **State A1 — token present, not signed in.** Shows: the Clio wordmark, "You've been invited to Clio
  as a sales partner." (or "as a super-admin" — copy branches on the invite's `role`), the invited
  email address, and a single "Sign in to accept" button linking to
  `/sign-in?redirect_url=%2Finvite%2Faccept%3Ftoken%3D<token>` (mirrors the existing `/partner-signup`
  pattern's own Clerk redirect handling — B2B-06). If the invited email has no existing Clerk account,
  Clerk's own sign-in screen offers its normal "Sign up" path; no new signup UI is built.
- **State A2 — token present, signed in, email matches.** Auto-fires
  `POST /api/admin/team/invites/accept` on page load; on success shows "You're in." with a "Go to
  Team" (super-admin) or "Go to Glitches" (sales-partner) button; auto-redirects after 2s.
- **State A3 — token present, signed in, email does NOT match the invite.** Shows: "You're signed in as
  `<current email>`, but this invite was sent to `<invited email>`. Sign out and sign back in with the
  invited address to accept." + a "Sign out" button (Clerk's own sign-out).
- **State A4 — token invalid, expired, or already consumed.** Shows: "This invite link is no longer
  valid. Ask a Clio super-admin to resend it." No further action possible on this page.

---

## 5. Visual Examples

### Screen state T2/T3 — Desktop (≥1024px), `/dashboard/admin/team`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Clio          [Clients] [Templates] [Glitches] [Team]      ⚫ Arun ▾       │  ← DashboardShell (existing), Team added as 4th nav item, super-admin-only
├───────────────────────────────────────────────────────────────────────────┤
│  Team & Access                                                              │
│                                                                             │
│  Super-admins                                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐│
│  │ hello.arunprakash83@gmail.com     Active     seed              —      ││
│  │ priya@clio.example.com            Pending    added by Arun  [Remove]  ││
│  │ ┌───────────────────────────┐  [+ Add]                                ││
│  │ │ email@example.com          │                                        ││
│  │ └───────────────────────────┘                                        ││
│  └───────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  Sales-partners                                          [+ Invite]        │
│  ┌───────────────────────────────────────────────────────────────────────┐│
│  │ rahul@salesco.example.com   Active   [Acme Corp] [Beta Inc]           ││
│  │        [Edit tags]  [Deactivate]                                      ││
│  │ jane@salesco.example.com    Pending  [Gamma LLC]                      ││
│  │        [Edit tags]  [Resend invite]  [Deactivate]                     ││
│  └───────────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────┘
   Colors: bg-[#080808] page, bg-[#111111] panels, border-[#222222], purple #7C3AED accents on
   primary buttons, text-[#94A3B8] secondary, status badges: green #10B981 (active), amber #F59E0B
   (pending), muted #475569 (deactivated). No new tokens.
```

### Screen state — "Invite sales-partner" inline form (expanded)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Invite sales-partner                                          [Cancel]    │
│                                                                             │
│  Email                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐│
│  │ rahul@salesco.example.com                                             ││
│  └───────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  Tag to partner account(s)                                                 │
│  ☑ Acme Corp        ☐ Beta Inc        ☑ Gamma LLC        ☐ Delta Co        │
│                                                                             │
│  [ Send invite ]                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### Screen state — Mobile (<768px), Team page

```
┌─────────────────────────────┐
│ Clio            ⚫ Arun ▾    │
├─────────────────────────────┤
│ [Clients][Tmpl][Glitch][Team]│ ← horizontally scrollable tab-style nav
├─────────────────────────────┤
│ Team & Access                │
│                              │
│ Super-admins                 │
│ ┌───────────────────────────┐│
│ │ hello.arunprakash83@       ││
│ │ gmail.com    Active    —  ││
│ ├───────────────────────────┤│
│ │ [ email@example.com ]     ││
│ │ [ + Add ]                 ││
│ └───────────────────────────┘│
│                              │
│ Sales-partners    [+ Invite] │
│ ┌───────────────────────────┐│
│ │ rahul@salesco.example.com  ││
│ │ Active                     ││
│ │ [Acme Corp][Beta Inc]      ││
│ │ [Edit tags][Deactivate]    ││
│ └───────────────────────────┘│
└─────────────────────────────┘
   Panels stack full-width; row actions wrap to a second line rather than
   truncating (per the standing responsive/mobile-friendly-by-default rule —
   fluid widths, clamp()-based spacing, no fixed px caps).
```

### Screen state — `/invite/accept` (State A1)

```
┌───────────────────────────────────────────┐
│              Clio                          │
│                                             │
│  You've been invited to Clio as a          │
│  sales partner.                            │
│                                             │
│  Invited: rahul@salesco.example.com        │
│                                             │
│  [ Sign in to accept ]                     │
└─────────────────────────────────────────────┘
```

---

## 6. Data Requirements

### 6.1 New tables (migration `084_b2b21_internal_admin_identity.sql`)

**`internal_admin_users`** — the orthogonal identity + role table. Never joined to, never written by,
never read by anything in the `partner_admin_users` / Clerk-Organizations path.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default `uuid_generate_v4()` | |
| `email` | text NOT NULL | unique case-insensitively (`CREATE UNIQUE INDEX ... ON internal_admin_users (lower(email))`) |
| `clerk_user_id` | text NULL | bound lazily at first authenticated request after acceptance (§6.4); unique when set |
| `role` | text NOT NULL CHECK IN (`super_admin`,`sales_partner`) | |
| `status` | text NOT NULL DEFAULT `pending` CHECK IN (`pending`,`active`,`deactivated`) | |
| `invited_by` | uuid NULL REFERENCES `internal_admin_users(id)` | NULL for the seed row |
| `invite_token_hash` | text NULL | SHA-256 hex digest of the current outstanding invite token, same discipline as `hashApiKey` (`lib/partner/api-keys.ts`) — never store the plaintext token |
| `invite_token_expires_at` | timestamptz NULL | 7 days from issue/resend |
| `invited_at` | timestamptz NOT NULL DEFAULT now() | |
| `accepted_at` | timestamptz NULL | set when `clerk_user_id` first binds |
| `created_at` / `updated_at` | timestamptz | standard `update_updated_at_column()` trigger, mirrors every other B2B table |

`CREATE UNIQUE INDEX ... ON internal_admin_users (clerk_user_id) WHERE clerk_user_id IS NOT NULL`.
`CREATE INDEX ... ON internal_admin_users (status)`.

**`sales_partner_assignments`** — many-to-many join, sales-partner ↔ partner account.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default `uuid_generate_v4()` | |
| `internal_admin_user_id` | uuid NOT NULL REFERENCES `internal_admin_users(id)` ON DELETE CASCADE | must reference a `role='sales_partner'` row (enforced in application code at write time, not a DB CHECK, since cross-table CHECKs aren't portable in Postgres — mirrors how `partner_sessions`' auth-credential pairing is enforced) |
| `partner_account_id` | uuid NOT NULL REFERENCES `partner_accounts(id)` ON DELETE CASCADE | |
| `assigned_by` | uuid NULL REFERENCES `internal_admin_users(id)` | audit trail |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

`UNIQUE (internal_admin_user_id, partner_account_id)`. No uniqueness constraint on
`partner_account_id` alone — confirmed many-to-many both directions (§11 Q6): a partner account may
carry more than one tagged sales-partner, and a sales-partner may cover several partners.

**RLS (both tables):** `ENABLE ROW LEVEL SECURITY` + a single `"Service role full access"` policy,
identical in shape to `partner_admin_users`/`partner_accounts`. Neither table is ever read via a
browser-authenticated Supabase client — every read goes through the new server-side helpers using
`createSupabaseAdminClient()`, exactly like `requirePartnerAdmin` does today. No end-user-facing RLS
policy is needed (same rationale `partner_accounts`' migration comment already states).

**Seed row (same migration, idempotent):**
```sql
INSERT INTO internal_admin_users (email, role, status, invited_by, accepted_at)
VALUES ('hello.arunprakash83@gmail.com', 'super_admin', 'pending', NULL, NULL)
ON CONFLICT (lower(email)) DO NOTHING;
```
Idempotent across environments and re-runs (§11 Q9). `clerk_user_id` stays NULL until Arun's next
authenticated request after this migration lands, at which point the lazy-bind in §6.4 flips it to
`active` with `accepted_at` set — no separate "accept" step is required for the seeded super-admin
(no email to click; he already knows).

### 6.2 New helpers — `lib/internal-admin/auth.ts` (new file, parallel to `lib/partner/auth.ts`)

```ts
export type InternalAdminResult =
  | { role: 'super_admin'; clerkUserId: string; internalAdminUserId: string; scopedPartnerAccountIds: null; error: null }
  | { role: 'sales_partner'; clerkUserId: string; internalAdminUserId: string; scopedPartnerAccountIds: string[]; error: null }
  | { role: null; clerkUserId: null; internalAdminUserId: null; scopedPartnerAccountIds: null; error: NextResponse }
```

- **`resolveInternalAdmin(): Promise<InternalAdminResult>`** — the shared core (§6.4 lazy-bind).
  1. `const { userId } = clerkAuth()`; no session → `error` 401 (mirrors `requirePartnerAdmin`).
  2. Look up `internal_admin_users` by `clerk_user_id = userId` AND `status != 'deactivated'`.
  3. If found and `status='active'` → build the result (for `sales_partner`, also fetch
     `sales_partner_assignments` for `scopedPartnerAccountIds`).
  4. If found and `status='pending'` with `clerk_user_id` already bound (edge case: an invite that was
     accepted but the admin was deactivated then reactivated without a new token — §6.4) → treat as
     `active` (binding already happened once; `pending` here just means "never explicitly
     deactivated/reactivated"). *(Clarifying note: `status` transitions are `pending → active` on first
     bind, `active ⇄ deactivated` thereafter — a row is never `pending` again after its first bind.)*
  5. If **not found** by `clerk_user_id` → lazy-bind attempt: fetch `currentUser()` from Clerk, take
     its primary **verified** email, look up `internal_admin_users` by
     `lower(email) = lower(thatEmail)` AND `clerk_user_id IS NULL` AND `status IN ('pending')`. If
     found → `UPDATE ... SET clerk_user_id = userId, status = 'active', accepted_at = now()` and
     proceed as active. If not found → `error` 403 (`errorEnvelope('forbidden', 'You do not have
     internal admin access.')`, mirroring `requirePartnerAdmin`'s 403 shape).
  6. This function deliberately does **not** hook into the legacy B2C `user.created` Clerk webhook
     (`app/api/webhooks/clerk/route.ts`) — that webhook fires globally for every new Clerk signup
     (including B2C-era `unsafe_metadata` onboarding writes) and is explicitly not to be extended per
     CLAUDE.md's "do not resurrect/extend B2C flows" rule. The lazy-bind-on-request pattern instead
     mirrors `requirePartnerAdmin`'s own model exactly: a plain per-request DB check, no webhook
     dependency, self-healing regardless of signup order.
- **`requireSuperAdmin(): Promise<InternalAdminResult>`** — calls `resolveInternalAdmin()`; if
  `role === 'sales_partner'`, overwrite with a 403 error (`errorEnvelope('forbidden', 'Super-admin
  access required.')`).
- **`requireInternalAdmin(partnerAccountId?: string): Promise<InternalAdminResult>`** — calls
  `resolveInternalAdmin()` unchanged; **does not** itself reject a sales-partner whose
  `scopedPartnerAccountIds` doesn't include `partnerAccountId` — callers that need that check do it
  explicitly (§6.3), because some callers (e.g. `glitches` list) need to *filter* rather than *reject*.
  A convenience `requireInternalAdmin(partnerAccountId)` overload additionally 403s immediately if
  `partnerAccountId` is supplied and out of scope, for the single-account routes.

### 6.3 Route-level data scoping (glitches, the one scoped-read surface)

`GET /api/admin/glitches` (and its `issues`/`summary` siblings): when the caller is a `sales_partner`,
the route forces `query = query.in('partner_account_id', scopedPartnerAccountIds)` **regardless of** a
client-supplied `?partner_account_id=` — if the client-supplied id is in scope, it further narrows to
that one id (existing behavior preserved); if it's out of scope, return `403 forbidden` rather than
silently ignoring it (never leak via omission). When the caller is `super_admin`, behavior is
unchanged (all partners, optional filter).

### 6.4 Reads / writes for the new Team surface

- **Reads:** `GET /api/admin/team/super-admins` (list `role='super_admin'` rows, `requireSuperAdmin()`),
  `GET /api/admin/team/sales-partners` (list `role='sales_partner'` rows + their
  `sales_partner_assignments`, `requireSuperAdmin()`), `GET /api/admin/team/partner-accounts` (id+name
  only from `partner_accounts`, `requireSuperAdmin()` — the one new cross-partner read, deliberately
  minimal per Scope Boundary).
- **Writes:**
  - `POST /api/admin/team/super-admins` `{ email }` → insert `role='super_admin', status='pending'`
    (`ON CONFLICT (lower(email)) DO NOTHING`, returns 409 `already_exists` if it conflicts — no
    silent no-op that looks like success).
  - `DELETE /api/admin/team/super-admins/[id]` → last-super-admin guard (§4.B T5): count
    `role='super_admin' AND status IN ('pending','active')`; if the target is the last one, 422
    `last_super_admin`; else set `status='deactivated'`.
  - `POST /api/admin/team/sales-partners` `{ email, partner_account_ids: string[] }` (min 1 id,
    Zod-validated uuids) → insert `internal_admin_users(role='sales_partner', status='pending')` +
    `sales_partner_assignments` rows + generate invite token (§6.5) + send invite email.
  - `PATCH /api/admin/team/sales-partners/[id]` `{ partner_account_ids?: string[], status?: 'active'|'deactivated' }`
    → replace assignment rows (diff insert/delete) and/or flip status. Reactivating a previously
    `deactivated` row with a `clerk_user_id` already bound needs no new invite (§11 Q5).
  - `POST /api/admin/team/sales-partners/[id]/resend-invite` → only valid while `status='pending'` and
    `clerk_user_id IS NULL`; mints a fresh token + resets `invite_token_expires_at`, resends the email.
  - `POST /api/admin/team/invites/accept` `{ token }` (called from the public `/invite/accept` page,
    itself gated by requiring an active Clerk session — no new anonymous-write surface): hash the
    token, look up by `invite_token_hash` + `invite_token_expires_at > now()` + `status='pending'` +
    `clerk_user_id IS NULL`; verify the now-authenticated Clerk user's primary verified email matches
    the row's `email` case-insensitively (State A3 otherwise); on match, bind `clerk_user_id`, set
    `status='active'`, `accepted_at=now()`, clear `invite_token_hash`/`invite_token_expires_at`
    (single-use).

### 6.5 Invite token generation

Mirrors `generateApiKey`/`hashApiKey` (`lib/partner/api-keys.ts`) exactly: `crypto.randomBytes(24).toString('hex')`
(48 hex chars) as the plaintext token, SHA-256 hex digest stored as `invite_token_hash`, plaintext
embedded once in the invite email URL (`/invite/accept?token=<plaintext>`) and never persisted.
Expiry: 7 days from issue/resend (a reasonable, low-risk default — no existing precedent in this
codebase to match, so this is a plain technical default, not a product ambiguity).

### 6.6 Invite email

New function `sendSalesPartnerInviteEmail(email, inviterName, partnerAccountNames, acceptUrl)` and
`sendSuperAdminAddedEmail(email, inviterName)` in `lib/delivery/email.ts`, following the exact
`EmailResult`-returning, Resend-based pattern already used by `sendPartnerSignupWelcomeEmail` (same
file, line 592) — non-blocking best-effort send; a failed send never blocks the underlying DB write
(the row and token already exist; "Resend invite" recovers a failed email).

### 6.7 localStorage / sessionStorage

None. All state is server-side; the invite token lives only in the emailed URL and the DB hash.

---

## 7. Route Classification Table (brief Q10 deliverable)

Every `/api/admin/*` route group, classified. **Partner-scoped** = already correctly gated by
`requirePartnerAdmin(partner_account_id)`, scoped to one partner's own admin team — leave untouched.
**Internal/cross-partner** = currently reachable by any authenticated Clerk session (or, in three
cases, literally no session check) — must move behind the new gate. A third bucket,
**already-gated-by-non-Clerk-secret**, covers the one route authenticated by a header secret rather
than a Clerk session at all (not part of the "any authenticated user" defect class, so out of this
brief's Clerk-role-gate scope, called out for completeness).

| Route group | Files | Current auth | Classification | New gate |
|---|---|---|---|---|
| `clients` (billing) | `app/api/admin/billing/clients/route.ts` | `requireAuth()` (bare) | **Internal/cross-partner** | `requireSuperAdmin()` |
| `billing` (per-account) | `checkout`, `subscription`, `plan-subscription`, `test-block` | `requirePartnerAdmin(partner_account_id)` | Partner-scoped | Unchanged, **plus** accept `requireInternalAdmin`-super-admin as an alternate passing credential on `test-block` only (§9, it's invoked from the now-gated Clients page by a super-admin who is not necessarily a `partner_admin_users` member of that account) |
| `glitches` (+`issues`,`summary`,`issues/[id]`,`detach`,`attach`,`notes`) | `app/api/admin/glitches/**` | `requireAuth()` (bare) | **Internal/cross-partner** | `requireInternalAdmin()` + forced scoping for sales-partner (§6.3) |
| `configurator` (all ~29 routes) | `app/api/admin/configurator/**` | `requirePartnerAdmin(partner_account_id)` (every route) | Partner-scoped | Unchanged |
| `partner-accounts` | `[id]/outbound-config` | `requirePartnerAdmin(id)` | Partner-scoped | Unchanged |
| `partner-keys` | `route.ts`, `[id]/route.ts` | `requirePartnerAdmin(partner_account_id)` | Partner-scoped | Unchanged |
| `backfill-sub-sessions` | `route.ts` | `auth()` (bare, legacy B2C `sessions` table, no partner concept) | **Internal/cross-partner** | `requireSuperAdmin()` |
| `clear-topic-cache` | `[topicId]/route.ts` | `auth()` (bare) | **Internal/cross-partner** | `requireSuperAdmin()` |
| `clear-all-kb-content` | `route.ts` | `x-admin-secret` header only (not Clerk at all) | **Already-gated-by-non-Clerk-secret** | Out of this brief's scope — not reachable by any bare authenticated session today; not the defect class this brief closes. Left unchanged. |
| `debug-bot` | `route.ts` | `auth()` (bare) | **Internal/cross-partner** | `requireSuperAdmin()` |
| `delivery-health` | `route.ts` | `auth()` (bare) | **Internal/cross-partner** | `requireSuperAdmin()` |
| `qa-curriculum-order`, `qa-role-checks`, `qa-session-context` | each `route.ts` | `auth()` (bare) | **Internal/cross-partner** | `requireSuperAdmin()` |
| `repair-session-titles` | `route.ts` | **none at all** (no auth import, no check) | **Internal/cross-partner** (worse — currently open to the public internet) | `requireSuperAdmin()` — flagged as an additional finding beyond the brief's own list, closed as part of this same P0 |
| `rtv03-accuracy-report` | `route.ts` | `auth()` (bare) | **Internal/cross-partner** | `requireSuperAdmin()` |
| `seed-topics` | `route.ts` | `auth()` (bare) | **Internal/cross-partner** | `requireSuperAdmin()` |
| `seed-topic-cache` | `route.ts` | **none at all** | **Internal/cross-partner** (same additional finding) | `requireSuperAdmin()` |
| `session-markers` | `route.ts` | `auth()` (bare) | **Internal/cross-partner** | `requireSuperAdmin()` |
| `test-email`, `test-session`, `test-voice` | each `route.ts` | `requireSessionAuth`/`auth()` (bare) | **Internal/cross-partner** | `requireSuperAdmin()` |

**Note on `templates`:** the `/dashboard/admin/templates` page's actual backing data route is **not**
under `/api/admin/*` at all — it's `GET /api/templates/library` and `PATCH /api/templates/library/[templateName]`
(`app/api/templates/**`), gated today by `requireSessionAuth` (any Clerk session, via the separate
`SESSION_JWT_SECRET`-based Clio-session-token mechanism, `lib/session-auth.ts` — a third,
pre-existing auth path distinct from both `requireAuth()` and `requirePartnerAdmin`). It is global
(no `partner_account_id` column on `template_library` at all), confirming §11 Q2's "templates are
global, not per-partner" resolution. **Classification: internal/cross-partner. New gate:
`requireSuperAdmin()`** on both the page and both routes, layered alongside the existing
`requireSessionAuth` + `isConfiguredApprover` write-gate (which governs *who may approve*, a separate,
untouched concern from *who may view the page at all*).

---

## 8. Success Criteria (Acceptance Tests)

**Identity & binding**
1. ✓ Given the migration has run, when queried, then exactly one `internal_admin_users` row exists for
   `hello.arunprakash83@gmail.com` with `role='super_admin'`, `status='pending'`, `clerk_user_id IS NULL`.
2. ✓ Given that seeded row, when Arun signs in with a Clerk account whose verified primary email is
   `hello.arunprakash83@gmail.com` and hits any `requireSuperAdmin()`-gated route, then the row's
   `clerk_user_id` binds, `status` flips to `active`, `accepted_at` is set, and the request succeeds.
3. ✓ Given a re-run of the migration in the same environment, then no duplicate seed row is created
   (`ON CONFLICT (lower(email)) DO NOTHING`).
4. ✓ Given a super-admin invited by email only (no prior Clerk account), when they sign up to Clerk
   with that exact verified email and then hit any gated route, then the same lazy-bind fires and they
   gain access — no separate accept step required for super-admins (§11 Q3).

**RBAC gate — negative paths (the P0 focus)**
5. ✓ Given a Clerk session belonging to a partner's own admin (a `partner_admin_users` member, no
   `internal_admin_users` row), when they GET `/dashboard/admin/clients`, `/glitches`, `/templates`, or
   `/team`, then each returns Next.js `notFound()` (404) — never the page content.
6. ✓ Given the same partner-admin session, when they call `GET /api/admin/billing/clients`,
   `GET /api/admin/glitches`, `GET /api/templates/library`, or any route in the "Internal/cross-partner"
   bucket of §7, then each returns `403 forbidden` JSON — never 200.
7. ✓ Given no Clerk session at all, when any of the above pages/routes are hit, then pages redirect to
   `/sign-in` and routes return `401`.
8. ✓ Given an active `sales_partner` session scoped to partner X only, when they GET
   `/dashboard/admin/clients` or `/dashboard/admin/templates`, then `notFound()`.
9. ✓ Given the same sales-partner, when they GET `/dashboard/admin/glitches`, then the page renders
   and `GET /api/admin/glitches` returns only rows where `partner_account_id = X`.
10. ✓ Given the same sales-partner, when they call `GET /api/admin/glitches?partner_account_id=Y` for
    an untagged partner Y, then `403 forbidden` (not a silently-empty 200).
11. ✓ Given every route classified "Partner-scoped" in §7, when this brief ships, then their auth code
    is byte-for-byte unchanged (grep/diff check) — no regression to existing partner-admin flows.

**Team management**
12. ✓ Given a signed-in super-admin, when they POST a new email to `/api/admin/team/super-admins`,
    then a `pending` row is created and appears in the Super-admins panel.
13. ✓ Given a signed-in super-admin, when they POST an invite (email + ≥1 partner account ids) to
    `/api/admin/team/sales-partners`, then an `internal_admin_users` row + matching
    `sales_partner_assignments` rows are created, an invite email is sent (or the send failure is
    surfaced without blocking the row/token creation), and the row appears `pending` in the panel.
14. ✓ Given exactly one active/pending super-admin remains, when a deactivation is attempted (self or
    by another super-admin) against that last row, then the API returns `422 last_super_admin` and no
    change is made.
15. ✓ Given ≥2 super-admins, when one deactivates another, then the target's `status` flips to
    `deactivated` and their next `requireSuperAdmin()` call fails with 403.
16. ✓ Given a signed-in `sales_partner`, when they call any `/api/admin/team/*` route, then `403`
    (team management is super-admin-only, not scoped-sales-partner-visible at all).

**Invite acceptance**
17. ✓ Given a valid, unexpired, unconsumed token, when the invited email signs in and
    `POST /api/admin/team/invites/accept` fires, then `clerk_user_id` binds, `status='active'`,
    `invite_token_hash` is cleared, and a second accept attempt with the same token returns
    `422 invalid_or_used_token`.
18. ✓ Given a token older than 7 days, when accept is attempted, then `422 invalid_or_used_token`
    (expired treated identically to consumed, per §4.C State A4 — no information leak about *why* it
    failed).
19. ✓ Given a signed-in Clerk user whose email does not match the invite's email, when they load
    `/invite/accept?token=...`, then State A3 renders and no bind occurs.
20. ✓ Given "Resend invite" on a `pending` sales-partner, when clicked, then the old token becomes
    permanently invalid (hash overwritten) and a new email is sent with a fresh token/expiry.

**Non-regression & build hygiene**
21. ✓ Given `partner_admin_users`, `app/api/webhooks/clerk-organization/route.ts`, and
    `requirePartnerAdmin`, when this brief ships, then none of the three has been modified (grep/diff
    check — the brief's hardest constraint).
22. ✓ `npx tsc --noEmit` clean; `npm run build` passes; all new API inputs Zod-validated; no
    unapproved packages; no new colors/typography/npm dependencies introduced by the new screens.

---

## 9. Error States

| Surface | Failure | Behavior |
|---|---|---|
| Any gated page, no session | — | Redirect `/sign-in` (unchanged existing behavior) |
| Any gated page, session but wrong/no role | — | `notFound()` — no bespoke "access denied" page built (§4.A rationale) |
| Any gated route, no session | — | `401` JSON, `{ error: 'Unauthorized' }` (mirrors `requirePartnerAdmin`) |
| Any gated route, session but wrong/no role | — | `403` JSON, `errorEnvelope('forbidden', ...)` |
| `POST /team/super-admins` | Email already exists (any status) | `409 already_exists` |
| `DELETE /team/super-admins/[id]` | Would remove the last active/pending super-admin | `422 last_super_admin` |
| `POST /team/sales-partners` | `partner_account_ids` empty array | `422` Zod validation error (min 1 required — a sales-partner with zero scope can never see anything, so this is rejected outright rather than silently allowed) |
| `POST /team/sales-partners` | Email already exists as any role | `409 already_exists` |
| `POST /team/invites/accept` | Token not found / expired / already used | `422 invalid_or_used_token` — same code for all three (no info leak) |
| `POST /team/invites/accept` | Token valid, signed-in email mismatch | `409 email_mismatch` (page renders State A3, not a hard error page) |
| Invite email send fails (Resend) | — | Row/token still created; API responds success with a `email_sent: false` flag so the UI can show "invite created, but the email failed to send — use Resend invite" inline, non-blocking (mirrors every other `EmailResult`-returning function's non-blocking discipline in this codebase) |
| `GET /team/partner-accounts` | Supabase read fails | `500`, panel shows inline "Couldn't load partner accounts — try refreshing," tagging picker disabled |
| `middleware.ts` tenant-host path | A partner's own white-label domain requests `/dashboard/admin/*` or `/invite/accept` | Unchanged: `neutralNotFoundResponse()` — internal surfaces never resolve on a partner domain, exactly as today |

---

## 10. Edge Cases

1. **A partner-admin who is also later invited as a sales-partner.** The two identities are
   independent rows in independent tables (`partner_admin_users` vs `internal_admin_users`) keyed on
   the same `clerk_user_id` — nothing prevents one human holding both roles simultaneously; each grants
   access through its own gate, with no interaction.
2. **A deactivated sales-partner's in-flight invite.** Deactivating an already-`active` (bound)
   sales-partner just flips `status`; there's no outstanding token to invalidate. Deactivating a still-
   `pending` (unaccepted) invite also flips `status` to `deactivated` and the accept page (State A4
   equivalent — `422`) rejects any later accept attempt with that now-stale token.
3. **Reactivating a sales-partner who already has a `clerk_user_id` bound.** No new invite/token
   needed — flip `status` back to `active` and their next request succeeds immediately (§11 Q5).
4. **Reactivating a sales-partner who never accepted (still `clerk_user_id IS NULL`, was deactivated
   while pending).** Functionally identical to "resend invite" — a fresh token must be issued (the UI's
   "Reactivate" action on a never-accepted row is presented as "Resend invite" instead, since there's
   nothing to merely un-deactivate).
5. **A sales-partner's last tagged partner account is untagged via Edit Tags (zero remaining).** Same
   validation as invite-time: `partner_account_ids` cannot be reduced to empty via `PATCH` either —
   422. A super-admin who wants to fully remove a sales-partner's access uses Deactivate, not
   zero-tagging.
6. **Arun (the seed row) tries to deactivate himself, and he's the only super-admin.** Same
   last-super-admin guard as any other super-admin — no special-cased immunity (§11 Q5, "equal peers"
   reading).
7. **Two super-admins add the same new super-admin email simultaneously.** The `ON CONFLICT (lower(email))
   DO NOTHING` + `409` on no-effect means the second caller gets a clear "already exists," no duplicate
   row, no silent double-invite email.
8. **A partner account referenced in a sales-partner's tags gets deleted/suspended.** `ON DELETE CASCADE`
   on `sales_partner_assignments.partner_account_id` removes the tag row automatically; the
   sales-partner simply loses that one scope entry, no orphaned reference, no crash.
9. **Slow network on the Team page.** Each panel shows its own existing-pattern loading state
   (skeleton/spinner, matching `PartnerBillingClient`'s own loading convention) independently — a slow
   `partner-accounts` fetch doesn't block the super-admins/sales-partners lists from rendering.
10. **Mobile vs desktop.** Team page panels stack full-width on mobile (§5 wireframe); the tagging
    multi-select becomes a vertically-stacked checklist rather than a horizontal row; no horizontal
    page-body scroll at any breakpoint (standing responsive rule).
11. **A super-admin's own email accidentally invited as a sales-partner (or vice versa) by another
    super-admin.** Rejected at insert time — `409 already_exists` checks across **both** roles for that
    email (§ "Data Requirements" 6.4), so one email can never hold two `internal_admin_users` rows.

---

## 11. Open Questions

**None.** All ten questions from the CEO brief are resolved below, grounded in the brief's own text
and/or direct source verification during this spec's research (files/line-level references given
where relevant).

- **Q1 (auth mechanism) — RESOLVED.** Same Clerk instance for identity; role resolved from the new
  `internal_admin_users` table; never placed into Clerk Organizations or `partner_admin_users`.
  Binding is a **lazy, per-request bind-by-verified-email** inside `resolveInternalAdmin()` (§6.2) —
  deliberately *not* hooked into the legacy B2C `user.created` webhook
  (`app/api/webhooks/clerk/route.ts`), per CLAUDE.md's explicit instruction not to extend retired B2C
  flows, and because the lazy-bind pattern already mirrors `requirePartnerAdmin`'s own model with zero
  new webhook surface.

- **Q2 (per-screen sales-partner visibility) — RESOLVED, conservative per the brief's own delegation.**
  Traced each surface at source:
  - **glitches** — genuinely cross-partner (`partner_account_id!inner` join, optional filter param),
    no dollar amounts in its column list (`glitch_type, description, ...` — `app/api/admin/glitches/route.ts`
    line 57). **Scoped sales-partner sees it, forced-filtered to their tagged accounts** (§6.3) — the
    brief's own "plausibly yes."
  - **clients/billing** — `app/api/admin/billing/clients/route.ts` reads `balance_usd`,
    `next_billing_date`, `payment_method_card_*`, and lifetime/period **revenue** aggregates per
    partner. This is squarely money/revenue detail that brushes the frozen commission topic. Per the
    brief's own instruction ("resolve conservatively and flag to me if it's a genuine product call"):
    **super-admin only.** A sales-partner gets `notFound()` on this page and `403` on its route. This
    is a conservative default under explicit brief delegation, not a guess — flagged here for visibility,
    not left as a blocking question.
  - **templates** — confirmed at source: `template_library` has no `partner_account_id` column at all
    (§7 note); it is Clio's own global content-approval queue, unrelated to any specific partner's
    business. **Super-admin only** — there is no plausible per-partner scope to grant a sales-partner
    here.

- **Q3 (invite + acceptance flow) — RESOLVED.** Sales-partner: token-based invite (§6.5) + email
  (§6.6) + `/invite/accept` page (§4.C) requiring **both** a valid unexpired unconsumed token **and**
  a matching signed-in Clerk email (defense in depth, since a sales-partner grants access to specific
  revenue-bearing partner accounts). Super-admin: no token needed — adding an email creates a
  `pending` row; Clerk's own email-verification during that person's sign-up/sign-in is sufficient
  proof of email ownership, and the lazy-bind (§6.2) picks it up on their next authenticated request;
  a courtesy (non-blocking, best-effort) notification email is still sent. Re-invite = mint a fresh
  token, overwrite the hash, reset expiry (§6.4 resend-invite). Tag/un-tag lifecycle: `PATCH
  .../sales-partners/[id]` replaces the assignment set (§6.4), min 1 tag always enforced (§10 edge
  case 5).

- **Q4 ("initiate transactions separately," scope in this brief) — RESOLVED.** No new financial
  transaction surface is built here — commission, billing actions beyond the existing per-partner
  `test-block` toggle, and revenue-share are explicitly frozen (Scope Boundary). Within this brief,
  "transactions" can only sensibly mean the **admin actions this brief does build** — invite, tag,
  deactivate, add-super-admin — each of which is already spec'd (§6.4) as independently callable by
  any super-admin with **no co-sign/dual-approval step**, matching "equal peers... initiates
  transactions separately" verbatim. If Arun later means literal financial transactions on a partner's
  behalf, that is the deferred super-admin console (Scope Boundary) and out of this brief by
  definition — there is no coherent alternate reading available within this brief's actual scope, so
  this is a resolution, not a guess requiring escalation.

- **Q5 (removal/deactivation guardrails) — RESOLVED.** Any active super-admin may deactivate any other
  super-admin (equal-peers reading — no special-cased immunity for the seed email; §10 edge case 6),
  gated only by the generic last-super-admin lockout guard (§4.B T5, §8 AT-14/15) which applies
  identically to every super-admin including the seed row. Sales-partner deactivation: any super-admin,
  no guardrail needed (multiple sales-partners can always exist or not); their `sales_partner_assignments`
  rows are preserved as history (not deleted) but access is immediately cut via the `status` check in
  `resolveInternalAdmin()`; in-flight invites are naturally invalidated (§10 edge case 2).

- **Q6 (assignment cardinality) — RESOLVED.** Confirmed many-to-many both directions: `UNIQUE
  (internal_admin_user_id, partner_account_id)` prevents a duplicate tag of the same pair, but neither
  column is independently unique — a sales-partner may be tagged to many partners, and a partner
  account may carry more than one sales-partner (§6.1), matching the brief's own quoted phrasing.

- **Q7 (exact screen inventory) — RESOLVED.** Gated (content unchanged): `/dashboard/admin/clients`,
  `/dashboard/admin/glitches`, `/dashboard/admin/templates`. New: `/dashboard/admin/team`
  (super-admin only) and the public `/invite/accept` page. No new analytics/reporting screen. This is
  the complete inventory — nothing else is built.

- **Q8 (gate placement) — RESOLVED.** Per-page/per-route helpers (`requireSuperAdmin()`,
  `requireInternalAdmin()`), called exactly where `requirePartnerAdmin()` is called today — at the top
  of each `page.tsx`'s server component and each route handler. `middleware.ts` stays the coarse
  Clerk-session + partner-domain gate, unchanged except for two new public-route matcher entries
  (`/invite/accept(.*)`, mirroring the existing `/partner-signup(.*)` entry — B2B-06's exact
  precedent) so the accept page can render its own sign-in prompt rather than being swallowed by
  Clerk's default protect-and-redirect. Blocked-surface behavior: pages → `notFound()`; routes → `401`
  (no session) / `403` (wrong role) JSON — the brief's own "match existing conventions" delegation,
  resolved using this codebase's own `neutralNotFoundResponse()` precedent for pages and
  `requirePartnerAdmin`'s existing 401/403 JSON shape for routes (§4.A, §8 AT-5/6/7).

- **Q9 (seeding) — RESOLVED.** Migration-seeded row keyed on `lower(email)` uniqueness,
  `ON CONFLICT DO NOTHING` (§6.1) — idempotent across repeated migration runs and across environments.
  No `clerk_user_id` at seed time; binds on Arun's first authenticated request post-migration via the
  same lazy-bind path every other super-admin uses (§6.2) — no special-cased bootstrap logic.

- **Q10 (route classification table) — RESOLVED.** Full table in §7, covering every route group the
  brief named plus two additional currently-**unauthenticated** routes (`repair-session-titles`,
  `seed-topic-cache`) discovered during this spec's direct source verification — flagged and closed
  under the same P0 rather than left as a second, separate defect.

---

## 12. Dependencies

**Must be true before build (all confirmed present):**
- `partner_accounts` table (migration 071) — FK target for `sales_partner_assignments`.
- `lib/partner/api-keys.ts` `hashApiKey`/`generateApiKey` pattern — mirrored for invite tokens, not
  imported directly (a dedicated `generateInviteToken`/`hashInviteToken` pair in the new
  `lib/internal-admin/` module, same algorithm).
- `lib/delivery/email.ts` `sendPartnerSignupWelcomeEmail`/`sendAdminAlert` pattern — mirrored for the
  two new invite/notification email functions (§6.6).
- `components/dashboard/DashboardShell.tsx` — the existing shell used by all three internal pages;
  gains one new `NAV_ITEM` (`/dashboard/admin/team`, "Team") — the nav array itself is not
  conditionally rendered per-role today (no per-item auth check exists in this client component), so
  the Team link's own page-level `requireSuperAdmin()` gate is what actually enforces access; the nav
  item may be visible-but-404-on-click to a sales-partner, which is acceptable (matches the existing
  pattern where all three current nav items are equally visible to any signed-in user today, entirely
  superseded by this brief's page-level gates).
- `update_updated_at_column()` Postgres trigger function — already defined, reused by every prior
  migration.
- `svix`, `resend`, `@clerk/nextjs` — already approved, no new dependency.

**New files this brief creates:**
- `supabase/migrations/084_b2b21_internal_admin_identity.sql` — both tables, indexes, RLS, seed row.
- `lib/internal-admin/auth.ts` — `resolveInternalAdmin`, `requireSuperAdmin`, `requireInternalAdmin`.
- `lib/internal-admin/invite-tokens.ts` — token generate/hash helpers (mirrors `lib/partner/api-keys.ts`).
- `app/api/admin/team/super-admins/route.ts` (+ `[id]/route.ts` for DELETE).
- `app/api/admin/team/sales-partners/route.ts` (+ `[id]/route.ts` for PATCH, `[id]/resend-invite/route.ts`).
- `app/api/admin/team/partner-accounts/route.ts` (minimal id+name list).
- `app/api/admin/team/invites/accept/route.ts`.
- `app/dashboard/admin/team/page.tsx` + `TeamClient.tsx` (new, follows the exact
  `currentUser()`-then-`DashboardShell`-then-`<Client/>` shape of the other three pages, substituting
  `requireSuperAdmin()` for the bare `currentUser()` check).
- `app/invite/accept/page.tsx` + client component (public route).

**Modified files:**
- `app/dashboard/admin/clients/page.tsx`, `.../glitches/page.tsx`, `.../templates/page.tsx` — add the
  role-gate step (§4.A); no other change.
- `app/api/admin/billing/clients/route.ts`, `app/api/admin/glitches/**`, `app/api/templates/library/**`,
  and every route in §7's "Internal/cross-partner" bucket — swap `requireAuth()`/`auth()`/no-check for
  the new gate; no other change to route logic.
- `app/api/admin/billing/test-block/route.ts` — accept `requireSuperAdmin()` as an alternate passing
  credential alongside the existing `requirePartnerAdmin(partner_account_id)` check (§7 note — needed
  so a super-admin, correctly not a member of every partner's own `partner_admin_users`, can still use
  this control from the now-properly-gated Clients page).
- `components/dashboard/DashboardShell.tsx` — add the "Team" nav item.
- `middleware.ts` — add `/invite/accept(.*)` to `isPublicRoute`'s matcher array (one-line addition,
  mirroring the existing `/partner-signup(.*)` entry).
- `lib/delivery/email.ts` — add `sendSalesPartnerInviteEmail`, `sendSuperAdminAddedEmail`.
- `.env.local.example` — no new required variable (invite tokens use the existing crypto module's
  built-in `crypto.randomBytes`, no new secret; Resend is already configured).

**Explicitly not touched (the brief's hardest constraint, verified achievable):** `partner_admin_users`
table, `app/api/webhooks/clerk-organization/route.ts`, `lib/partner/auth.ts`'s `requirePartnerAdmin`
function body, and every route already classified "Partner-scoped" in §7.

---

*End of Requirement Document B2B-21 v1.0 — all 12 sections filled, Section 11 empty. Ready for CEO
review.*
