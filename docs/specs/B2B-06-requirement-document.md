# B2B-06 — Partner Provisioning
# Requirement Document
Version: 1.1
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-15

**Changelog — Version 1.1 (2026-07-15):** CEO review of v1.0 confirmed the self-serve signup flow,
static-key demotion, outbound-config UI, funding-guardrail placement, and both Section 11 judgment
calls as correct, and returned one blocking gap: `POST /api/partner/v1/sessions` would NOT NULL-violate
on `partner_sessions.partner_api_key_id` for every OAuth2-authenticated call (migration
`071_b2b02_partner_accounts_and_api_keys.sql:177` is `NOT NULL`; the route's insert,
`app/api/partner/v1/sessions/route.ts:51`, always writes `partner_api_key_id: auth.apiKeyId`, which
`architecture.md` §18.3's OAuth2 branch returns as `null`) — session creation, the core partner
operation, was uncallable via the OAuth2 mechanism this document mandates as the v1/day-one default.
Resolved in this version: `architecture.md` §18.1 step 4 makes `partner_api_key_id` nullable and adds a
new nullable `partner_oauth_client_id` FK with a `partner_sessions_auth_credential_check` CHECK
enforcing exactly one is set; §18.3's `PartnerApiKeyContext` gains a parallel `clientId` field; §18.7
now documents both the corrected `partner_sessions` insert and the funding-guardrail insertion (both
changes live in `architecture.md`, not in the live route file, since this document's own code is spec,
not yet implemented). Also fixed: the `architecture.md` §18.6 citation in Section 4.B.5 below (the
outbound-config route actually lives at §18.9 — §18.6 is the `clerk-organization` webhook route) and
`PartnerApiKeyContext.apiKeyId`'s type (now `string | null`, alongside the new `clientId: string |
null`). Section 7 gains one new acceptance test exercising `POST /api/partner/v1/sessions` end-to-end
with an OAuth2 token — the CEO's review noted this was the one place in this document's own acceptance
criteria that needed an end-to-end test on the write path and didn't have one (only `GET
/api/partner/v1/usage` was tested). No other section changed — self-serve signup, static-key demotion,
outbound-config UI, funding-guardrail placement, and Section 11 are unchanged from Version 1.0.

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-06-partner-provisioning.md`, **v3** (the
same-day auth-mechanism correction of v2 — read in full, including the v3 changelog banner explaining
the OAuth2 correction and the v2 banner explaining the Q1 self-serve flip). v1/v2 are superseded and not
re-derived here except where the v3 banner itself says something "survives unchanged."

Authoritative source material (all read in full): the v3 Feature Brief above,
`docs/brainstorm-partner-signup-integration.md` (the live discussion the brief traces back to — Decision
#1 Clerk Organizations, Decision #2 OAuth2, the B2C precedent note, the "Brief breakdown" confirming
B2B-06's scope is items 1–7 plus the invoice guardrail), `docs/reference-vendor-api-integrations.md` §5
(Clerk) and §8 (the payment-guardrail gap, exact `file:line`), `docs/b2b-pivot-status.md` (B2B-06 row,
current as of the v3 correction, plus the B2B-07/B2B-08 rows for cross-brief orthogonality confirmation),
`docs/specs/B2B-04-requirement-document.md` and `docs/specs/B2B-05-requirement-document.md` (format/rigor
precedent, screen-state convention, wireframe convention), `app/api/webhooks/clerk/route.ts` (the B2C
`user.created` handler this brief's new handler runs parallel to, not modified here),
`supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql` (live `partner_accounts`/
`partner_admin_users`/`partner_api_keys` schema), `supabase/migrations/075_b2b04_billing_metering.sql`
(live `partner_wallets` schema, incl. `stripe_default_payment_method_id`),
`supabase/migrations/076_b2b05_domain_whitelabel_infra.sql` (live `partner_accounts.onboarding_completed_at`
and the wizard's existing entry-point-redirect convention), `supabase/migrations/077_b2b08_testing_metering.sql`
(live `partner_wallets.trial_minutes_used`/`.test_minutes_balance`, live `partner_sessions.end_reason`
CHECK constraint), `lib/partner/auth.ts` (`requirePartnerApiKey()`, the function this document extends),
`lib/partner/webhooks.ts`, `lib/partner/api-keys.ts`, `lib/partner/crypto.ts`, `lib/partner/rate-limit.ts`,
`lib/partner/webhook-signature.ts`, `lib/partner/admin-accounts.ts` (all reused patterns, cited inline
below), `app/api/partner/v1/sessions/route.ts` (the exact insertion point for the funding guardrail — read
directly, not assumed; its own inline comment already names this document as the owner of the untouched
`auth.mode === 'live'` branch), `app/api/admin/partner-accounts/[id]/outbound-config/route.ts` and
`app/api/admin/partner-keys/route.ts` (existing, unmodified backend routes this document's new UI screens
call), `app/dashboard/configurator/_shared.tsx`, `HomeClient.tsx`, `domain/page.tsx`,
`domain/DomainConfigClient.tsx` (B2B-03/05's Configurator design-system precedent, followed not invented),
`app/dashboard/configurator/wizard/page.tsx` and `WizardClient.tsx` (the existing 7-step onboarding wizard
— confirmed its "Payment" step has a `Skip for now` button, which is why the funding guardrail in this
document is load-bearing, not redundant with the wizard), `middleware.ts` (confirms `/partner-signup` needs
adding to the public-route matcher), `app/(auth)/sign-up/[[...sign-up]]/page.tsx` (the existing B2C
`<SignUp>` styling precedent this document's `<SignUp>`/`<CreateOrganization>` wrapper reuses),
`inngest/abandoned-onboarding-cleanup.ts` (the B2C reminder/cleanup job shape this document's reminder job
borrows the *shape* of, explicitly not the deletion behavior), `lib/delivery/email.ts` (existing
`sendSignupWelcomeEmail`/`sendLowBalanceAlertEmail` patterns this document's two new email functions
follow), `package.json` (confirms no JWT/OAuth2 library is present — this document's token mechanism is
hand-rolled on Node's built-in `crypto`, per `CLAUDE.md`'s no-new-dependency-without-justification rule,
mirroring `lib/partner/webhook-signature.ts`'s existing HMAC precedent exactly).

Companion artifact produced alongside this document: `architecture.md` §18 (exact schema DDL, route
contracts, and the exact webhook-handler/token-signing code a developer implements against).
Migration file produced, **not applied**: `supabase/migrations/079_b2b06_provisioning.sql` (079 confirmed
as the next-free number — 078 is `B2B-09` per `docs/b2b-pivot-status.md`'s own migration list).

---

## Template Adaptation Note (per this repo's own established pattern, B2B-02/04/05)

This brief is not one screen-by-screen consumer feature — it is four related mechanisms (self-serve
signup, OAuth2 auth, self-serve outbound-config UI, a funding guardrail) that together close the "how
does a partner account come to exist and become safely usable" gap. Per the CEO brief's own closing
instruction ("you may split into two documents... but document that decision clearly if you do,
otherwise keep it as one document matching the CEO brief's own single-brief framing"), this BA's
judgment is to **keep this as one document**. Reasoning: unlike, say, B2B-04's billing engine plus one
unrelated admin screen, these four mechanisms are not separable — the OAuth2 credential a partner
generates is *how* they'd call the funding-guarded `sessions` endpoint; the outbound-config screen is
reached through the same signup flow; and the CEO brief's own "Approval note" and closing paragraph
describe all four as one dispatch. Splitting would mean cross-referencing four Section-11-empty
documents against each other for what is, in the CEO brief's own words, "the mechanism that makes the
rest of this brief's self-serve design safe to ship at all" — a single coherent unit. This mirrors
B2B-05's own precedent of keeping a wizard amendment (Section 13) inside one document rather than
spinning out a second spec.

Sections are kept in standard order/numbering to match every other spec in `docs/specs/`, adapted as
follows:
- **Section 4** covers all four new/changed UI-or-API surfaces (signup wrapper, OAuth2 token endpoint +
  credential-generation screen, outbound-config screen, funding-guardrail response), per the "do NOT say
  'a form'" discipline applied to JSON bodies as well as form fields.
- **Section 5** gives literal wireframes for every screen state, plus text sequence flows for every
  mechanism (signup → row creation, OAuth2 token issuance, credential generation, outbound-config save,
  test-connection, funding-gate check).
- All other sections apply directly.

---

## 1. Purpose

Today, `grep` across the entire codebase for any insert into `partner_accounts` or `partner_admin_users`
returns zero matches (re-confirmed by the CEO brief, not assumed) — every partner-lifecycle feature built
across B2B-02 through B2B-05/08/09 assumes the account already exists. There is no way for a real partner
(Capgemini, Pluralsight — Arun's own examples) to sign up for Clio without a Clio engineer manually
inserting rows. Separately, the only credential mechanism that exists today — a static, unexpiring API key
(`partner_api_keys`) — is exactly the shape of credential Arun explicitly rejected as the v1/day-one
default for real partners ("a static key is a standing risk if leaked... works forever until manually
revoked"). And separately again, `POST /api/partner/v1/sessions` has **zero funding check** before
dispatching a real, billable Attendee bot (confirmed by direct code read, `docs/reference-vendor-
api-integrations.md` §8) — a gap that was tolerable when every account was internal-operator-vetted before
it could exist, and stops being tolerable the moment signup becomes self-serve.

**What failure looks like without this document:** no prospective partner can ever reach Clio without a
manual, Clio-staff-mediated process that Arun has explicitly said should not exist ("our role will be to
help them if they face any issues... not perform the signup itself"); any partner who did get an account
would be issued the exact credential shape Arun rejected; and the moment self-serve signup ships without
the funding guardrail, an unvetted, unfunded account could dispatch unlimited real, billable meeting-bot
sessions at Clio's own cost with no way to ever collect payment.

## 2. User Story

**Story 1 — A prospective partner's own employee (e.g., someone at Capgemini or Pluralsight)**
As the person setting up my company's integration with Clio,
I want to sign up myself, with my own company's email and organization name, with no Clio staff
involvement,
So that I can start integrating today instead of waiting on a sales/ops process.

**Story 2 — The same partner-admin, generating their first API credential**
As the person who just signed up,
I want to generate a `client_id`/`client_secret` pair myself, in-app, immediately,
So that my own engineering team can start calling Clio's API without ever asking Clio for a credential.

**Story 3 — The same partner-admin, configuring outbound delivery**
As the person completing my integration,
I want to enter my own webhook base URL and generate my own signing secret, without ever sending that
secret to a Clio employee,
So that Clio can push usage events to my system without Clio ever having access to my own inbound-auth
secret.

**Story 4 — A Clio SPOC (Arun or future ops staff)**
As the person Arun designated to help partners who get stuck,
I want the existing internal-operator create/link routes to keep working exactly as before,
So that I can manually finish a stalled signup for a partner without needing new tooling.

**Story 5 — Clio's own backend (the session-dispatch code path itself)**
As the code that is about to dispatch a real, billable meeting bot for a `live`-mode request,
I want to confirm the requesting account has a payment method on file before dispatching,
So that Clio never incurs unrecoverable real vendor cost for an unfunded account — while never blocking
a `test`-mode request, which must keep working exactly as it does today (B2B-08, unmodified).

**Story 6 — A partner's own backend system, authenticating to Clio's API**
As a partner's own server calling `/api/partner/v1/*`,
I want to exchange my `client_id`/`client_secret` for a short-lived token and use that token on every
call,
So that no long-lived secret ever sits in a request header on every single API call, satisfying my own
company's security compliance requirements.

## 3. Trigger / Entry Point

- **Signup surface**: `GET /partner-signup`, no auth required (new public route), page load. Second step
  `GET /partner-signup/organization`, requires an active Clerk session (the user just created one on the
  first step) but no `partner_admin_users` row yet — this is the one deliberate pre-provisioning gap in
  the auth model, matching every other Clerk-hosted signup flow in this codebase.
- **`organization.created` / `organizationMembership.created` webhooks**: `POST
  /api/webhooks/clerk-organization` (new route, distinct from `app/api/webhooks/clerk/route.ts`),
  triggered by Clerk, svix-signature-verified, no Clerk session.
- **OAuth2 token exchange**: `POST /api/partner/v1/oauth/token`, no prior credential required beyond the
  `client_id`/`client_secret` in the request body itself — this route *is* the credential exchange.
- **OAuth2 credential generation**: `POST /api/admin/configurator/oauth-clients`, Clerk-authenticated
  partner-admin, state required: a `partner_admin_users` row for the target `partner_account_id` (same
  authorization pattern as every other `/api/admin/configurator/*` route).
- **OAuth2 credential listing**: `GET /api/admin/configurator/oauth-clients`, same auth.
- **Outbound-config read/save**: `GET`/`PATCH /api/admin/configurator/outbound-config` (new thin
  read-wrapper + the existing, unmodified `PATCH /api/admin/partner-accounts/:id/outbound-config`), same
  auth pattern.
- **Test-connection**: `POST /api/admin/configurator/integration/test-outbound`, same auth pattern.
- **New Configurator screen**: `GET /dashboard/configurator/integration`, page load, Clerk-authenticated,
  state required: at least one `partner_admin_users` row for the signed-in Clerk user (identical entry
  gate to every other Configurator screen — `NoPartnerAccounts` otherwise).
- **Funding guardrail**: triggered internally, synchronously, inside the existing `POST
  /api/partner/v1/sessions` handler — not a new externally-reachable route. Fires only for `auth.mode ===
  'live'` requests, between the existing `partner_sessions` insert and the existing `dispatchMeetingBot()`
  call (`app/api/partner/v1/sessions/route.ts`, the exact, already-annotated insertion point).
- **Abandoned-signup reminder**: triggered internally by the new `clio/partner-org.created` Inngest event
  (emitted from the `organization.created` webhook handler), not a user-facing trigger.

## 4. Screen / Flow Description

### 4.A `/partner-signup` and `/partner-signup/organization` — the signup wrapper

**Layout**: a minimal, Clio-branded wrapper reusing the exact dark-void styling already established by
`app/(auth)/sign-up/[[...sign-up]]/page.tsx` (`bg-void` full-screen, centered Clerk component, the same
`appearance` variables: `colorBackground: '#111111'`, `colorPrimary: '#7C3AED'`, etc.) — no new visual
direction invented, per `CLAUDE.md`'s "follow an established precedent rather than invent one when one
already exists" instruction; here, the B2C sign-up page is that exact precedent, reused verbatim for its
color/appearance props only (the component and copy are different, see below).

**Screen state 1 — `/partner-signup`, not yet signed in**

```
┌─────────────────────────────────────────┐
│              (black background)          │
│                                           │
│         ┌───────────────────────┐       │
│         │   Sign up for Clio     │       │
│         │   (Clerk <SignUp/>      │       │
│         │    hosted component,    │       │
│         │    dark-themed)          │       │
│         │                          │       │
│         │  [ Email address    ]   │       │
│         │  [ Password          ]   │       │
│         │  [ Continue ]            │       │
│         │  ── or ──                │       │
│         │  [ Continue with Google] │       │
│         └───────────────────────┘       │
└─────────────────────────────────────────┘
```

`<SignUp forceRedirectUrl="/partner-signup/organization" appearance={{ ...same variables as
app/(auth)/sign-up }} />` — literally the same component the B2C page already uses, with only
`forceRedirectUrl` changed. No new copy is written on this step; Clerk's own hosted form renders
entirely. This is a deliberate scope boundary (Section 10): a fully designed public marketing/signup page
is not built here — this is the identical mechanism v1's own Q2 leaned on for the internal-operator flow
("Clerk's own hosted dashboard... zero custom code"), applied here to the self-serve flow instead.

**Screen state 2 — `/partner-signup/organization`, signed in, no organization yet**

```
┌─────────────────────────────────────────┐
│              (black background)          │
│                                           │
│         ┌───────────────────────┐       │
│         │  Set up your company    │       │
│         │  (Clerk <CreateOrganiz-  │       │
│         │   ation/> hosted comp-   │       │
│         │   onent, dark-themed)    │       │
│         │                          │       │
│         │  [ Organization name ]  │       │
│         │  [ Continue ]            │       │
│         └───────────────────────┘       │
└─────────────────────────────────────────┘
```

`<CreateOrganization afterCreateOrganizationUrl="/dashboard/configurator" appearance={{ ...same
variables }} />`. Once the Clerk Organization is created, Clerk's own client redirects to
`/dashboard/configurator`. Per the existing, unmodified B2B-05 entry-point convention
(`app/dashboard/configurator/page.tsx`, already live), that page redirects on to
`/dashboard/configurator/wizard?partner_account_id={id}` the instant it sees `onboarding_completed_at IS
NULL` — which it always is for a brand-new partner. **This document adds no new redirect logic of its
own here** — "immediately access the Configurator to begin integration" (CEO brief, What Success Looks
Like #3) is satisfied entirely by B2B-05's own existing, unmodified mechanism, once this document's
webhook handler (4.B.1) has created the `partner_accounts`/`partner_admin_users` rows the Configurator's
own existing auth gate (`getPartnerAccountsForClerkUser`) depends on. This is a genuine "zero new code"
finding, not an assumption — verified by reading `app/dashboard/configurator/page.tsx` and
`wizard/page.tsx` directly.

**Screen state 3 — `/partner-signup/organization`, race condition: webhook hasn't landed yet**

Clerk's `afterCreateOrganizationUrl` redirect is a client-side navigation that can outrace the
`organization.created` webhook's own asynchronous delivery (Clerk fires webhooks async, not
synchronously inside the client SDK call). If `/dashboard/configurator` loads before the webhook has
created the `partner_accounts`/`partner_admin_users` rows, `getPartnerAccountsForClerkUser` returns an
empty array and the existing `<NoPartnerAccounts />` component renders: `"You don't administer any
partner accounts."` This is a **real, expected, transient state**, not an error — Section 9 documents the
mitigation (a short client-side retry).

### 4.B API Contracts

#### 4.B.1 `POST /api/webhooks/clerk-organization` (svix-verified, no Clerk session)

Handles two Clerk event types, following the exact structural pattern of the existing
`app/api/webhooks/clerk/route.ts` (svix verify → 400 on bad/missing signature → switch on `event.type`),
but as a genuinely new route, never merged into that file (Known Constraint, CEO brief).

**`organization.created`** — creates the `partner_accounts` row:
```
{
  "type": "organization.created",
  "data": {
    "id": "org_...",           // Clerk organization id
    "name": "Acme Learning",   // becomes partner_accounts.name verbatim
    "created_by": "user_..."   // Clerk user id of the creator — not used by this handler directly;
                                 // organizationMembership.created (below) is what creates the admin row
  }
}
```
Effect: `INSERT INTO partner_accounts (name, clerk_org_id, archetype, status) VALUES (data.name,
data.id, 'unspecified', 'active')`. If a row with that `clerk_org_id` already exists (Clerk redelivery),
the insert is a no-op — `ON CONFLICT (clerk_org_id) DO NOTHING`, idempotent, matching this codebase's
existing webhook-idempotency discipline (`webhook_dispatch_log`'s own unique-index pattern). After the
insert (whether newly inserted or already-existing), emits `clio/partner-org.created` to Inngest
(fire-and-forget, matches the existing `clio/user.created` emit pattern in `app/api/webhooks/clerk/
route.ts`) with `{ partnerAccountId, orgName: data.name, createdAt }` — this is what starts the
abandoned-signup reminder (4.B.6).

**`organizationMembership.created`** — creates the `partner_admin_users` row:
```
{
  "type": "organizationMembership.created",
  "data": {
    "organization": { "id": "org_..." },
    "public_user_data": { "user_id": "user_...", "identifier": "person@acme.com" }
  }
}
```
Effect: resolve `partner_account_id` via `clerk_org_id = data.organization.id` (if no matching
`partner_accounts` row exists yet — a genuine race with the `organization.created` event, Clerk does not
guarantee ordering across two webhook deliveries — retry via Clerk's own webhook redelivery, matching
existing convention of returning a non-2xx only on genuine processing failure; see Section 8). Then
`INSERT INTO partner_admin_users (clerk_user_id, partner_account_id, role) VALUES (data.public_user_data
.user_id, {resolved_id}, {role})`, `ON CONFLICT (clerk_user_id, partner_account_id) DO NOTHING`
(matches the table's existing unique constraint, migration `071`, unmodified). `role` is `'owner'` if
this is the **first** `partner_admin_users` row ever inserted for that `partner_account_id` (a
`SELECT COUNT(*) ... WHERE partner_account_id = X` immediately before the insert, inside the same
request — the org's creator is always the first membership event per Clerk's own behavior, so "first
admin becomes owner" falls out of event ordering exactly as the CEO brief states, no Clerk-role-string
parsing needed), else `'admin'` — every subsequent teammate, however Clerk itself classifies their
internal org role, is mapped to this table's `'admin'` value. This is a scoping call, not left ambiguous:
`partner_admin_users.role` is documented (migration `071`) as controlling only "which partner account a
logged-in Clerk admin is allowed to issue/revoke API keys for" — every admin-table membership already has
equal functional access in this schema, so `owner` vs `admin` is informational, not access-differentiating,
and finer-grained passthrough of Clerk's own org-role taxonomy is not warranted (Section 10).

On a newly-inserted **first** (`owner`) membership only: calls `sendPartnerSignupWelcomeEmail()` (4.B.7),
resolving the email via `data.public_user_data.identifier` (Clerk already supplies it on this event,
no extra `clerkClient().users.getUser()` round-trip needed, unlike the pre-existing `lib/partner/
webhooks.ts` low-balance-alert email resolution which lacks this and must call out).

Both event types: verified via `svix` (`CLERK_ORGANIZATION_WEBHOOK_SECRET`, a distinct env var from the
existing `CLERK_WEBHOOK_SECRET` — Clerk issues one signing secret per configured endpoint URL in the
dashboard, and this is a new endpoint URL). Missing secret → `500`. Missing/invalid svix headers or bad
signature → `400`, matching the existing route's exact pattern, no fallthrough (Section 8).

#### 4.B.2 `POST /api/partner/v1/oauth/token` (OAuth2 Client Credentials grant, RFC 6749 §4.4)

**Request** — `Content-Type: application/x-www-form-urlencoded` (the RFC 6749 §4.4.2 standard body shape
— chosen deliberately over this codebase's usual JSON-body convention specifically *because* Arun's own
stated reasoning for building this endpoint at all is compliance with "what enterprise security teams...
typically require as a compliance checkbox" (v3 banner); a partner's off-the-shelf OAuth2 client library
sends form-encoded by default, and diverging from the RFC shape here would undermine the exact reason
this mechanism exists):
```
grant_type=client_credentials&client_id=clio_client_...&client_secret=clio_secret_...
```

**Response — 200:**
```
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
  "token_type": "Bearer",
  "expires_in": 3600
}
```
`access_token` is a hand-rolled HS256 JWT (header `{"alg":"HS256","typ":"JWT"}`, no external JWT
library — see `lib/partner/oauth.ts`, `architecture.md` §18.4). Claims: `{ sub: client_id,
partner_account_id, mode: 'test'|'live', iat, exp, jti }`. `exp = iat + 3600` (1-hour TTL — a BA technical
judgment call, documented: long enough to avoid excessive re-auth traffic for a legitimate integration,
short enough to substantively bound the "damage window" Arun's own reasoning names for wanting this
mechanism at all). Signed with `PARTNER_OAUTH_TOKEN_SIGNING_SECRET` (new env var, `PLACEHOLDER_`-safe,
mirrors `lib/partner/crypto.ts`'s existing `deriveKey()`/dev-fallback convention).

**Response — 400:** `{ "error": "invalid_request", "error_description": "grant_type must be
client_credentials." }` — wrong/missing `grant_type`, matching RFC 6749 §5.2's own error-shape
convention (this is the one place in this document's API surface that deliberately does *not* use this
codebase's usual `{ error: { code, message, request_id } }` envelope — RFC 6749 §5.2 mandates a specific
`error`/`error_description` shape for OAuth2 token-endpoint errors, and matching it is the entire point of
building a standards-shaped endpoint).

**Response — 401:** `{ "error": "invalid_client", "error_description": "Client authentication failed." }`
— `client_id` not found, `client_secret` hash mismatch, or `partner_oauth_clients.status != 'active'`.
Never distinguishes "unknown client_id" from "wrong secret" from "revoked" in the response body (timing-
and-enumeration-safe, mirrors `requirePartnerApiKey()`'s existing "API key not recognized" vs "revoked"
distinction being kept server-log-only — see Section 8 for the exact parity table).

**Response — 403:** `{ "error": "invalid_client", "error_description": "This partner account is
suspended." }` — the resolved `partner_accounts.status != 'active'`. (Kept as a distinct HTTP status from
401 to mirror `requirePartnerApiKey()`'s existing `account_suspended` 403 vs `invalid_api_key` 401 split
exactly — the OAuth2 body shape changes per RFC 6749, the status-code semantics carried over from the
existing static-key mechanism do not.)

Rate-limited via a new `RateLimitClass` value, `'oauth_token'` (20 requests/min), keyed by `client_id`
rather than `partner_account_id` (the caller's account isn't resolved until after a successful secret
hash-compare) — `architecture.md` §18.5.

#### 4.B.3 `POST /api/admin/configurator/oauth-clients` (Clerk-authenticated, self-serve generation)

**Request body:** `{ "partner_account_id": "uuid", "mode": "test" | "live", "label": "string, optional" }`

**Response — 201:**
```
{
  "id": "uuid",
  "client_id": "clio_client_a1b2c3d4e5f6...",
  "client_secret": "clio_secret_9f8e7d6c5b4a...",
  "mode": "test",
  "label": "Production integration" | null
}
```
`client_secret` is returned **exactly once**, in this response only — mirrors `POST
/api/admin/partner-keys`'s existing one-time-copy discipline for the plaintext key, and the outbound-
config route's existing one-time-copy discipline for `outbound_signing_secret`. `client_id` is safe to
display indefinitely (it is a standalone identifier, never a secret — Known Constraint, CEO brief point
4). Only `client_secret_hash` (SHA-256) is ever persisted (`architecture.md` §18.2).

**Response — 403:** caller has no `partner_admin_users` row for the target account (identical pattern to
every other `/api/admin/configurator/*` route).
**Response — 422:** validation failure (missing/invalid `mode`).

#### 4.B.4 `GET /api/admin/configurator/oauth-clients?partner_account_id=...` (Clerk-authenticated)

**Response — 200:**
```
{
  "clients": [
    { "id": "uuid", "client_id": "clio_client_a1b2...", "mode": "test", "label": "Production integration" | null, "status": "active" | "revoked", "last_used_at": "2026-07-15T10:00:00Z" | null, "created_at": "..." }
  ]
}
```
Never includes `client_secret_hash` — matches `GET /api/admin/partner-keys`'s existing never-echo
discipline for `key_hash`.
**Response — 403:** same pattern as 4.B.3.

#### 4.B.5 `GET`/`PATCH /api/admin/configurator/outbound-config` (Clerk-authenticated, thin new wrapper)

A new, thinner pair of routes specifically for the Configurator UI (4.C below) to read/write against —
`GET` did not exist at all before this document (the pre-existing `PATCH .../outbound-config` route has
no corresponding read route, since it was built API-only with no UI in B2B-02). `PATCH` on this new route
is a direct pass-through to the existing, **unmodified** `PATCH /api/admin/partner-accounts/:id/
outbound-config` (same Zod schema, same behavior) — added under `/api/admin/configurator/*` purely so
this document's UI follows the same URL-namespace convention every other Configurator screen already
uses (`.../configurator/domain`, `.../configurator/topics`, etc.), rather than reaching into
`/api/admin/partner-accounts/*` directly the way no other Configurator screen does. This is a technical
routing-convention decision within BA authority, not a behavior change — zero new logic, zero new
validation, the existing route (Section 4.B in the file header comment, `lib/partner/crypto.ts`) is
reused byte-for-byte.

**`GET` query params:** `partner_account_id` (required, uuid)
**`GET` response — 200:**
```
{
  "outbound_base_url": "https://acme.example.com/clio-integration" | null,
  "outbound_auth_token_set": true,
  "outbound_signing_secret_set": true
}
```
Deliberately never returns the token or secret themselves — only booleans indicating whether each is
configured, matching Arun's "we should not see it" instruction literally: even Clio's own UI never
displays a value it already structurally cannot decrypt/recover for the signing secret, and never
re-displays the auth token even though it technically could be decrypted server-side (a stricter,
intentional choice — Section 9).

**`PATCH` request/response:** identical to the existing `PATCH /api/admin/partner-accounts/:id/
outbound-config` contract, verbatim (see that route's own docstring, reproduced for reference in
`architecture.md` §18.9) — `{ outbound_base_url?, outbound_auth_token?, regenerate_signing_secret? }` →
`{ id, outbound_base_url_updated, outbound_auth_token_updated, outbound_signing_secret? }` (secret
present only when `regenerate_signing_secret: true`).

#### 4.B.6 `POST /api/admin/configurator/integration/test-outbound` (Clerk-authenticated)

**Request body:** `{ "partner_account_id": "uuid" }`

Sends one synchronous, synthetic signed POST to `{outbound_base_url}/webhooks/usage` (the exact same
suffix `lib/partner/webhooks.ts`'s `attemptDispatch()` already posts real events to — a partner's real
webhook receiver is expected to already handle this path, so no second endpoint needs to be documented
or implemented by the partner) with a minimal, clearly-synthetic body:
```
{ "event_id": "test-<uuid>", "event_type": "webhook.test", "occurred_at": "<now, ISO>", "test": true }
```
signed with the account's real `outbound_signing_secret` via the existing, unmodified
`buildSignatureHeader()` (`lib/partner/webhook-signature.ts`) — so a "Test connection" success genuinely
proves the partner's receiver can verify Clio's real signature, not a mocked one. This call is **never**
written to `webhook_dispatch_log` (it is not a real billing/usage event and must not appear in that
table's audit trail — Section 6) and has no retry/backoff (a single 10-second-timeout attempt, result
returned synchronously to the caller).

**Response — 200:** `{ "success": true, "status_code": 200 }` (or whatever 2xx the partner's endpoint
returned).
**Response — 200 (delivery attempted, non-2xx or unreachable):** `{ "success": false, "status_code":
404 | null, "error": "Received HTTP 404." | "Could not reach the endpoint (timeout or connection
refused)." }` — a `200` from *this* Clio route regardless of the outbound outcome (the test itself
succeeded at running; whether the partner's endpoint responded correctly is the payload's own field, not
an HTTP-status-level failure of this route — Section 8).
**Response — 422:** `{ "error": { "code": "outbound_not_configured", "message": "Set your outbound base
URL and signing secret first." } }` — `outbound_base_url` or `outbound_signing_secret` is unset.
**Response — 403:** same pattern as 4.B.3.

#### 4.B.7 `POST /api/partner/v1/sessions` — funding guardrail (existing route, one named addition)

No new route — the existing, live route (`app/api/partner/v1/sessions/route.ts`) gets one new block
inserted at the exact location its own inline comment already reserves: between the `partner_sessions`
insert and the `dispatchMeetingBot()` call, **inside the `auth.mode === 'live'` branch only** (the
`test`-mode branch, B2B-08's trial-gate logic, is untouched — confirmed orthogonal by activation
condition, per `docs/b2b-pivot-status.md`'s own B2B-08 row).

**New response — 402 (added to this existing route):**
```
{ "error": { "code": "funding_required", "message": "Add a payment method before starting a live session. Test-mode sessions remain unaffected." } }
```
Fires when: no `partner_wallets` row exists for the account yet (fail-closed — Section 9), OR a row
exists but `stripe_default_payment_method_id IS NULL`. On this path, the just-inserted `partner_sessions`
row is updated to `status = 'failed'`, `end_reason = 'funding_required'` (extending the existing
`end_reason` CHECK constraint, migration `077`, to include this third value — `architecture.md` §18.1)
before returning — mirrors the existing `trial_exhausted` failure path in the same file exactly, same
shape, same discipline (`dispatchMeetingBot()` is never called on this path — no vendor cost is ever
incurred for a rejected dispatch).

**Note (v1.1):** the `partner_sessions` insert itself (immediately above this guardrail in the same
route) is also corrected in this version — `architecture.md` §18.7.1 — to write whichever of
`partner_api_key_id`/`partner_oauth_client_id` corresponds to the authenticating credential, since an
OAuth2-authenticated request has no `partner_api_keys` row to reference. See this document's v1.1
changelog banner above and Section 7's new acceptance test.

## 4.C `/dashboard/configurator/integration` — the one real new Configurator screen

**Layout**: follows `domain/page.tsx` + `DomainConfigClient.tsx` exactly — server component does the
Clerk `auth()` gate + `redirect('/sign-in')`, `getPartnerAccountsForClerkUser`, `<NoPartnerAccounts />` if
empty, resolves `activePartnerAccountId`, renders `IntegrationClient` wrapped in the existing
`<ConfiguratorShell>`, using `COLORS`/`Card`/`PrimaryButton`/`SecondaryButton` from `_shared.tsx`
unmodified — no new design system invented. Two cards on one screen, mirroring the Domain screen's own
two-card layout (subdomain card + custom-domain card) — this document's scoping call (Section 11): the
CEO brief's Approval note lists "a Configurator call site for... OAuth2 generation" and "a new
Configurator screen for... outbound base-URL + signing-secret entry" as two bullets, but nothing in the
brief requires them to be two separate pages, and combining them onto one screen with two cards is the
same pattern B2B-05 already established for two related-but-distinct concerns (subdomain vs. custom
domain) on its own Domain screen.

`HomeClient.tsx`'s 3-column grid gets one additional `DomainCard`-pattern card, **"Integration"**, linking
to `/dashboard/configurator/integration?partner_account_id={id}`, status text `"{n} API credential(s)"` if
at least one `partner_oauth_clients` row exists, else `"Not configured"` — same component, same pattern
as the existing four cards, not a new one.

**Screen state 1 — no OAuth2 client generated yet, no outbound config set**

```
┌─────────────────────────────────────────────────────┐
│  Clio Configurator          Integration  [Acme Co ▾]│
│  ← Back                                               │
│                                                        │
│  Integration                                          │
│                                                        │
│  ┌───────────────────────────────────────────────┐   │
│  │ API credentials                                │   │
│  │ Generate a client ID and secret for your own   │   │
│  │ backend to call the Clio API.                  │   │
│  │                                                 │   │
│  │  Mode:  (•) Test    ( ) Live                    │   │
│  │  Label (optional): [                    ]      │   │
│  │                                                 │   │
│  │  [ Generate credentials ]                      │   │
│  └───────────────────────────────────────────────┘   │
│                                                        │
│  ┌───────────────────────────────────────────────┐   │
│  │ Outbound webhooks                              │   │
│  │ Clio delivers usage events to your own system. │   │
│  │                                                 │   │
│  │  Your base URL:                                │   │
│  │  [ https://your-domain.com/clio          ]     │   │
│  │                                                 │   │
│  │  Your API token (for Clio to authenticate to   │   │
│  │  your API — optional, write-only):             │   │
│  │  [ ••••••••••••                          ]     │   │
│  │                                                 │   │
│  │  [ Save & generate signing secret ]            │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

Text input labelled `"Your base URL"`, placeholder `"https://your-domain.com/clio"`. Text input
labelled `"Your API token (for Clio to authenticate to your API — optional, write-only)"`, type
`password`-masked, never pre-filled even if a token was previously set (Section 9 — the plaintext is
never recoverable, so there is nothing honest to pre-fill). `[Save & generate signing secret]` calls
`PATCH .../outbound-config` with whatever fields are non-empty plus `regenerate_signing_secret: true`
always (every save on this screen regenerates the signing secret — Section 9 explains why a separate
"save without regenerating" control is deliberately not built).

**Screen state 2 — OAuth2 client just generated (reveal-once)**

```
┌───────────────────────────────────────────────┐
│ API credentials                    ● Generated │
│                                                │
│  Client ID                                    │
│  clio_client_a1b2c3d4e5f6...        [Copy]    │
│                                                │
│  Client secret  (shown once — save it now)    │
│  clio_secret_9f8e7d6c5b4a...         [Copy]    │
│                                                │
│  This secret will not be shown again.          │
│                                                │
│  [ Generate another credential ]               │
└───────────────────────────────────────────────┘
```
Green dot + `"Generated"` badge. Both `[Copy]` buttons briefly change their own label to `"Copied"` for
1.5s (matches the Domain screen's existing copy-button convention exactly). The client secret and this
entire reveal block exist only in React state for the lifetime of this page load — a page refresh loses
it permanently (by design; matches the outbound-signing-secret and static-API-key precedents exactly).
`[Generate another credential]` reverts the card to Screen state 1's form, pre-filled with nothing.

**Screen state 3 — one or more credentials already exist (returning visit)**

```
┌───────────────────────────────────────────────┐
│ API credentials                                │
│                                                │
│  clio_client_a1b2...   Test   Production integration │
│  clio_client_f9e8...   Live   —                       │
│                                                        │
│  [ + Generate new credential ]                        │
└───────────────────────────────────────────────┘
```
A simple list (client ID, mode, label) from `GET .../oauth-clients` — never a secret, never a "reveal"
control (there is nothing to reveal; the plaintext was never stored). `[+ Generate new credential]`
expands Screen state 1's form inline above the list.

**Screen state 4 — outbound config already set (returning visit)**

```
┌───────────────────────────────────────────────┐
│ Outbound webhooks                    ● Configured │
│                                                    │
│  Your base URL:                                   │
│  https://your-domain.com/clio                     │
│                                                    │
│  Your API token: ●●●●●●●● (set)                    │
│  Your signing secret: ●●●●●●●● (set — not          │
│  retrievable; regenerate to get a new one)         │
│                                                    │
│  [ Test connection ]   [ Edit ]                    │
└───────────────────────────────────────────────┘
```
Green dot + `"Configured"` badge (shown once `outbound_base_url` is set — the auth token and signing
secret are each independently optional/present, reflected only in their own `●●●●●●●● (set)` / not-set
line, never gating the badge itself, since `outbound_base_url` is the one field that must be present for
`attemptDispatch()` to have anywhere to send to). `[Edit]` reverts the base-URL field (and the write-only
token field, blank) back to Screen state 1's editable form, while leaving the "signing secret: set" line
visible until a new save actually regenerates it. `[Test connection]` calls 4.B.6 and shows the result
inline directly below the button:
- Success: green text, `"✓ Connected — received HTTP 200."`
- Failure: red text, `"✗ {error message from 4.B.6's response, verbatim}."`

**Screen state 5 — loading**

Both cards render a single centered line: `"Loading integration settings…"` — matches the Domain screen's
existing loading-state convention (`docs/specs/B2B-05-requirement-document.md` Section 4.A, Screen state
6) applied here.

**Screen state 6 — error (the data fetch itself failed)**

Both cards render: `"Couldn't load integration settings. Try refreshing the page."` — same convention as
B2B-05's Screen state 7.

## 5. Visual Examples

### 5.A Wireframes

All screen-state wireframes are given inline with their exact copy in Section 4.A/4.C, per this
repo's own established precedent (B2B-05 Section 5.A) of keeping wireframe and exact-copy together.

**The funding-gate's "user-facing" surface** (per the CEO brief's explicit closing instruction to
wireframe it) is not a Clio-rendered screen — no Clio UI banner is specified anywhere in the CEO brief
for this state, and per governance ("implement literally... if unclear, build the minimal version"),
this document does not invent one. What a partner's own developer actually sees is the API response
itself — its exact, annotated shape:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": {
    "code": "funding_required",
    "message": "Add a payment method before starting a live session. Test-mode sessions remain unaffected."
  }
}
```
This is the literal, falsifiable "wireframe" of this surface — matching how `docs/specs/
B2B-04-requirement-document.md` and `B2B-05-requirement-document.md` both already treat exact API error
shapes as satisfying "user-facing error state" documentation when no Clio-rendered screen exists for a
given failure (e.g. B2B-04 Section 8's entire table). If Arun later wants a Configurator-side balance/
funding banner, that is new UI scope, not invented here (Section 10).

### 5.B Sequence flows

**5.B.1 — Self-serve signup, happy path**
```
Partner employee → /partner-signup → Clerk <SignUp/> → account created →
  forceRedirectUrl → /partner-signup/organization → Clerk <CreateOrganization/> → org created →
  afterCreateOrganizationUrl → /dashboard/configurator
    │
    ├─ (async, may race) Clerk fires organization.created →
    │    POST /api/webhooks/clerk-organization → INSERT partner_accounts (clerk_org_id, name, archetype='unspecified')
    │    → emit clio/partner-org.created (Inngest)
    │
    └─ (async, may race) Clerk fires organizationMembership.created →
         POST /api/webhooks/clerk-organization → resolve partner_account_id via clerk_org_id
         → COUNT existing partner_admin_users for this account == 0 → role='owner'
         → INSERT partner_admin_users (clerk_user_id, partner_account_id, role='owner')
         → sendPartnerSignupWelcomeEmail(identifier, orgName)

/dashboard/configurator loads (client already has an active Clerk session) →
  getPartnerAccountsForClerkUser(userId) → once both webhook handlers above have landed, returns
  [{ id, name }] → existing page.tsx sees onboarding_completed_at IS NULL → redirect to
  /dashboard/configurator/wizard?partner_account_id={id} → B2B-05's existing wizard, unmodified,
  takes over from here.
```

**5.B.2 — OAuth2 token exchange**
```
Partner's backend → POST /api/partner/v1/oauth/token
  { grant_type: "client_credentials", client_id, client_secret }
  → hash client_secret (SHA-256) → look up partner_oauth_clients by client_id
  → not found OR hash mismatch OR status != 'active' → 401 invalid_client
  → look up partner_accounts by the client's partner_account_id → status != 'active' → 403 invalid_client
  → sign JWT { sub: client_id, partner_account_id, mode, iat, exp: iat+3600, jti }
    with PARTNER_OAUTH_TOKEN_SIGNING_SECRET (HS256, hand-rolled, lib/partner/oauth.ts)
  → best-effort, non-blocking partner_oauth_clients.last_used_at update (mirrors the existing
    partner_api_keys.last_used_at fire-and-forget pattern in lib/partner/auth.ts)
  → 200 { access_token, token_type: "Bearer", expires_in: 3600 }

Partner's backend → any /api/partner/v1/{sessions,usage,wallet} call
  → Authorization: Bearer <access_token>
  → requirePartnerApiKey(): looksLikePartnerApiKey(token) is false (not clio_{test,live}_sk_ shape)
    → looksLikeOAuthAccessToken(token) is true (3-segment JWT shape)
    → verify signature + exp (stateless) → look up partner_oauth_clients by claims.sub (client_id),
      confirm status='active' → look up partner_accounts by claims.partner_account_id, confirm
      status='active' → return { partnerAccountId, apiKeyId: null, clientId: partner_oauth_clients.id,
      mode: claims.mode, error: null } (apiKeyId is null and clientId is set for an OAuth2-authenticated
      request — a new, documented shape difference, Section 6; v1.1 adds clientId alongside the
      already-documented apiKeyId: null, see this document's v1.1 changelog banner and architecture.md
      §18.3)
  → any verification failure at any step → 401 invalid_api_key (same generic code the static-key path
    already returns — CEO brief's explicit "before returning the existing invalid_api_key 401")
```

**5.B.3 — Self-serve OAuth2 credential generation**
```
Partner-admin (Clerk session) → /dashboard/configurator/integration → selects mode=test →
  [Generate credentials] → POST /api/admin/configurator/oauth-clients { partner_account_id, mode: "test" }
  → generateOAuthClient('test') → { client_id, client_secret, client_secret_hash }
  → INSERT partner_oauth_clients (client_id, client_secret_hash, mode, status='active', partner_account_id)
  → 201 { id, client_id, client_secret, mode, label }
  → UI shows Screen state 2 (reveal-once) using the response's client_secret directly, never re-fetched
```

**5.B.4 — Outbound-config save + test connection**
```
Partner-admin → /dashboard/configurator/integration → enters base URL + (optional) API token →
  [Save & generate signing secret] → PATCH /api/admin/configurator/outbound-config
  { partner_account_id, outbound_base_url, outbound_auth_token?, regenerate_signing_secret: true }
  → pass-through to the existing, unmodified PATCH /api/admin/partner-accounts/:id/outbound-config
  → 200 { ..., outbound_signing_secret } (shown once, Screen state 4 badge flips to "Configured")

Partner-admin → [Test connection] → POST /api/admin/configurator/integration/test-outbound
  { partner_account_id }
  → look up outbound_base_url + outbound_signing_secret → both set →
    POST {outbound_base_url}/webhooks/usage, signed test payload, 10s timeout
  → 200 { success: true, status_code: 200 } → inline "✓ Connected — received HTTP 200."
  → (or) 200 { success: false, status_code: 404, error: "Received HTTP 404." } → inline "✗ Received HTTP 404."
```

**5.B.5 — Funding guardrail (the "no" path)**
```
Partner's backend (live-mode credential, however authenticated — 5.B.2's context shape is
credential-form-agnostic) → POST /api/partner/v1/sessions { meeting_url, partner_topic_ref }
  → requirePartnerApiKey() → auth.mode === 'live'
  → INSERT partner_sessions (status='requested', partner_api_key_id OR partner_oauth_client_id set
    per auth's non-null field — v1.1, architecture.md §18.7.1) → clioSessionRef minted
  → SELECT stripe_default_payment_method_id FROM partner_wallets WHERE partner_account_id = X
  → no row OR stripe_default_payment_method_id IS NULL →
      UPDATE partner_sessions SET status='failed', end_reason='funding_required' WHERE id=clioSessionRef
      → 402 { error: { code: "funding_required", message: "..." } }  [dispatchMeetingBot() never called]
  → row exists AND stripe_default_payment_method_id IS NOT NULL →
      dispatchMeetingBot() called exactly as today, unchanged
```

**5.B.6 — Abandoned-signup reminder**
```
clio/partner-org.created event (5.B.1) → inngest/partner-signup-reminder.ts
  → step.sleep('wait', '24h')
  → step.run: SELECT onboarding_completed_at FROM partner_accounts WHERE id = partnerAccountId
  → onboarding_completed_at IS NOT NULL → no-op, function ends (they finished on their own)
  → onboarding_completed_at IS NULL → resolve the owner's email via partner_admin_users +
    clerkClient().users.getUser() (same resolution pattern as lib/partner/webhooks.ts's
    getPartnerAdminEmails()) → sendPartnerSignupReminderEmail(email, orgName) → function ends
    (fires exactly once, ever — no repeating reminder loop; not named in the CEO brief's success
    criteria, so not built)
```

## 6. Data Requirements

Full schema DDL, exact route contracts, and exact webhook-handler/token code live in `architecture.md`
§18 and `supabase/migrations/079_b2b06_provisioning.sql`. Summarized:

**Modified table (one additive column, `partner_accounts`):**
- `clerk_org_id TEXT UNIQUE` — nullable (existing internal-operator-created accounts, and any account
  created before this document ships, have no Clerk Organization and never will unless separately
  migrated — out of scope, Section 10).

**Modified table (one additive column, `partner_sessions`):**
- `end_reason`'s existing CHECK constraint (migration `077`) extended to add `'funding_required'`
  alongside the existing `'trial_limit_reached'`/`'trial_exhausted'` values.
- **(v1.1)** `partner_api_key_id` is made nullable, and a new nullable `partner_oauth_client_id UUID
  REFERENCES partner_oauth_clients(id) ON DELETE RESTRICT` column is added, with a
  `partner_sessions_auth_credential_check` CHECK requiring exactly one of the two to be set on every row
  (`architecture.md` §18.1 step 4) — the fix for the CEO's blocking-gap finding, see this document's
  v1.1 changelog banner.

**New table, `partner_oauth_clients`:** mirrors `partner_api_keys`'s proven security shape exactly, per
the CEO brief's own explicit instruction — `id`, `partner_account_id` (FK, `ON DELETE CASCADE`),
`client_id` (TEXT UNIQUE, safe to display), `client_secret_hash` (TEXT, SHA-256 hex digest, never the
plaintext), `mode` (`'test' | 'live'`), `label` (TEXT, nullable), `status` (`'active' | 'revoked'`,
default `'active'`), `last_used_at`, `created_at`, `revoked_at`. RLS: service-role-only, matching every
other partner-facing table in this schema (`partner_api_keys`'s own policy, verbatim pattern).

**No token-storage table** — per the CEO brief's explicit instruction, tokens are stateless (verified by
signature + expiry, never looked up by value in a database). The two lightweight status checks the token-
verification path performs (`partner_oauth_clients.status`, `partner_accounts.status`) are reads of
already-existing rows the static-key path already reads identically — not a per-issued-token record, and
not what "no token-storage table" was instructing this document to avoid (Section 4.B.2's sequence flow
makes this distinction explicit).

**Read from the database:** `partner_accounts` (webhook idempotency check via `clerk_org_id`; suspension
check at token-issuance and token-verification time; funding-guardrail's own account resolution is
implicit via `partner_wallets.partner_account_id`), `partner_admin_users` (first-membership-becomes-owner
count check; Configurator auth gate, unmodified), `partner_oauth_clients` (token issuance secret-hash
lookup; token verification status check; Configurator listing screen), `partner_wallets`
(`stripe_default_payment_method_id`, funding guardrail — read-only, this document never writes to this
table).

**Written to the database:** `partner_accounts` (one `INSERT` per real signup, via the webhook handler),
`partner_admin_users` (one `INSERT` per real membership event, via the webhook handler),
`partner_oauth_clients` (one `INSERT` per self-serve credential generation; `last_used_at` updated
best-effort on every successful token exchange), `partner_sessions.end_reason` (one additional value
written on the guardrail's rejection path, reusing the existing `UPDATE` shape already used for
`trial_exhausted`), `partner_sessions.partner_api_key_id` / `.partner_oauth_client_id` **(v1.1)** — one
of the two is written on every `partner_sessions` insert, chosen by which of
`auth.apiKeyId`/`auth.clientId` is non-null.

**APIs called:** Clerk (`clerkClient().users.getUser()` — reused, unmodified pattern, for reminder-email
recipient resolution only; the welcome-email path avoids this call entirely per 4.B.1's own note, since
Clerk's `organizationMembership.created` payload already carries the email). No new vendor — Clerk is
already approved (`@clerk/nextjs`), and Clerk Organizations is a feature of the same SDK/account, not a
new package (Known Constraint, CEO brief — flagged as a dashboard-level toggle, not code, Section 12).

**Never written anywhere:** the plaintext `client_secret` (only its SHA-256 hash — mirrors
`partner_api_keys.key_hash` exactly), the plaintext outbound auth token (only its AES-256-GCM ciphertext,
via the existing, unmodified `encryptOutboundToken()`), the plaintext OAuth2 access token itself (it is
never persisted anywhere — stateless, verified by signature only).

**localStorage/sessionStorage:** none — the new Configurator screen holds only in-memory React state for
the reveal-once secret/token displays, matching every other Configurator screen's existing convention.

## 7. Success Criteria (Acceptance Tests)

✓ Given a Clerk Organization is created via `/partner-signup/organization`, when Clerk's
`organization.created` webhook is delivered to `POST /api/webhooks/clerk-organization` with a valid svix
signature, then a `partner_accounts` row is created with `clerk_org_id` matching the event's `data.id`
and `name` matching `data.name`, and a `clio/partner-org.created` Inngest event is emitted.

✓ Given the same organization, when Clerk's `organizationMembership.created` webhook is delivered for
the org's creator (the first membership event for that `partner_account_id`), then a `partner_admin_users`
row is created with `role='owner'`, and `sendPartnerSignupWelcomeEmail()` is called exactly once with the
event's own `public_user_data.identifier`.

✓ Given a second teammate is later invited via Clerk's own built-in org-invite flow and accepts, when the
resulting `organizationMembership.created` webhook is delivered, then a second `partner_admin_users`
row is created for the same `partner_account_id` with `role='admin'` (not `'owner'`), and no second welcome
email is sent.

✓ Given `POST /api/webhooks/clerk-organization` receives a request with a missing or invalid svix
signature, when the handler processes it, then the response is `400`, and neither `partner_accounts` nor
`partner_admin_users` is written — verified by asserting zero new rows exist after the call, proving no
fallthrough-to-processing exists (the exact bug class already flagged as a live issue on the *Attendee*
webhook, `docs/reference-vendor-api-integrations.md` §1 — this document's own new webhook handler must not
repeat it).

✓ Given a partner-admin generates an OAuth2 credential via `POST /api/admin/configurator/oauth-clients`
with `mode: "test"`, when the response is inspected, then it contains a plaintext `client_secret` exactly
once, and a subsequent `GET /api/admin/configurator/oauth-clients` call for the same account never
contains that plaintext value anywhere in its response, only `client_id`/`mode`/`label`/`status`.

✓ Given a valid `client_id`/`client_secret` pair, when `POST /api/partner/v1/oauth/token` is called with
`grant_type=client_credentials`, then the response is `200` with a well-formed 3-segment JWT whose decoded
claims contain the correct `partner_account_id` and `mode`, and `expires_in` is `3600`.

✓ Given the access token from the previous test, when it is used as `Authorization: Bearer <token>` on
`GET /api/partner/v1/usage`, then the request succeeds with the same response shape as an equivalent
static-API-key-authenticated call for the same account — proving `requirePartnerApiKey()`'s extension is
genuinely transparent to that route's own logic (zero call-site changes, per the CEO brief's explicit
requirement).

✓ **(v1.1 — new, closes the CEO's 2026-07-15 blocking-gap finding)** Given a valid OAuth2 access token
(`mode: 'live'`) for a partner account with a funded `partner_wallets` row
(`stripe_default_payment_method_id IS NOT NULL`), when it is used as `Authorization: Bearer <token>` on
`POST /api/partner/v1/sessions` with a valid body, then the request succeeds with `201`, a
`partner_sessions` row is inserted with `partner_oauth_client_id` set to the token's resolved
`partner_oauth_clients.id` and `partner_api_key_id` `NULL` (satisfying
`partner_sessions_auth_credential_check`, `architecture.md` §18.1 step 4), and `dispatchMeetingBot()` is
invoked exactly as it is for a static-key-authenticated call. This is the end-to-end write-path test the
prior version's acceptance criteria lacked — the previous OAuth2 test above only exercised a read route
(`GET /api/partner/v1/usage`); `POST /api/partner/v1/sessions` is the core partner operation and the
exact route the CEO's review found would otherwise fail a NOT NULL constraint on every OAuth2-
authenticated attempt.

✓ Given an access token whose `exp` claim is in the past (expired), when it is used on any
`/api/partner/v1/*` route, then the response is `401 invalid_api_key` — the same generic code a malformed
static key would produce, never a distinct "token expired" code (matching the CEO brief's explicit
"before returning the existing invalid_api_key 401").

✓ Given an access token that is well-formed and unexpired but whose `client_id` claim corresponds to a
`partner_oauth_clients` row with `status='revoked'`, when it is used on any `/api/partner/v1/*` route,
then the response is `401 invalid_api_key` — proving revocation is enforced even though token
verification is otherwise stateless (Section 6's distinction between "no token-storage table" and "the
existing client-row status check").

✓ Given a `client_id`/`client_secret` pair whose `partner_accounts` row has `status='suspended'`, when
`POST /api/partner/v1/oauth/token` is called, then the response is `403 invalid_client` (never `200`) —
suspension is enforced at issuance, not just at verification.

✓ Given a partner account with no `partner_wallets` row at all (a self-serve account that has never
funded anything), when a `live`-mode `POST /api/partner/v1/sessions` request is made, then the response
is `402 funding_required`, the `partner_sessions` row is `status='failed'`,
`end_reason='funding_required'`, and `dispatchMeetingBot()` is never invoked — verified by asserting no
outbound call to Attendee's `/bots` endpoint occurred for this request (the literal, falsifiable form of
"no unfunded account can ever dispatch a real bot").

✓ Given a partner account with a `partner_wallets` row whose `stripe_default_payment_method_id IS NOT
NULL`, when a `live`-mode `POST /api/partner/v1/sessions` request is made, then `dispatchMeetingBot()` is
invoked exactly as it is today (no behavior change on the funded path) and the response shape is
unchanged from the pre-existing contract.

✓ Given a `test`-mode credential (static key or OAuth2 token, `mode: 'test'`), when `POST
/api/partner/v1/sessions` is called regardless of whether `partner_wallets.stripe_default_payment_method_id`
is set, then the funding guardrail is never evaluated at all — the request proceeds through B2B-08's
existing trial-gate logic exactly as it does today, proving the two gates are activation-condition-
disjoint (confirmed orthogonal per `docs/b2b-pivot-status.md`'s own B2B-08 row).

✓ Given a partner-admin has configured `outbound_base_url` and generated a signing secret, when they
click `[Test connection]` and their own endpoint responds `200`, then the response shows `success: true`
and the signature on the received request verifies correctly against their own `outbound_signing_secret`
using the existing, unmodified `verifySignature()` function — proving the test call is genuinely signed
with real production machinery, not a stub.

✓ Given the same partner-admin's outbound endpoint is unreachable (connection refused), when they click
`[Test connection]`, then the response is still `200` from Clio's own route (`{ success: false, error:
"Could not reach the endpoint (timeout or connection refused)." }`) — never a `5xx` from this route
itself, and no row is ever written to `webhook_dispatch_log` for this test call (verified by asserting the
table's row count for this account is unchanged after the call).

## 8. Error States

| Failure | User-visible behavior | Clio-side behavior |
|---|---|---|
| `POST /api/webhooks/clerk-organization` — missing/invalid svix signature | N/A (Clerk-to-Clio call) | `400`, no DB write, no fallthrough (matches the existing `app/api/webhooks/clerk/route.ts` convention exactly, and explicitly does not repeat the Attendee webhook's known fallthrough bug) |
| `POST /api/webhooks/clerk-organization` — `organizationMembership.created` arrives before the matching `organization.created` (webhook delivery race) | N/A | No `partner_accounts` row found to resolve against → non-`2xx` response (e.g. `409`), so Clerk's own webhook retry mechanism redelivers later — never silently dropped, never a `partner_admin_users` row inserted with a dangling/null `partner_account_id` |
| `organization.created` redelivered for an already-existing `clerk_org_id` | N/A | `ON CONFLICT (clerk_org_id) DO NOTHING` — idempotent, `200`, no duplicate row |
| `/dashboard/configurator` loads before either webhook has landed (Screen state 3, Section 4.A) | `<NoPartnerAccounts />`: "You don't administer any partner accounts." | No error logged — this is an expected transient race, not a fault; Section 9 covers the client-side retry mitigation |
| `POST /api/partner/v1/oauth/token` — unknown `client_id`, wrong `client_secret`, or revoked client | `401 invalid_client` (RFC 6749 §5.2 shape) | Never distinguishes which sub-case in the response body; server logs the specific reason for Clio's own diagnostics only |
| `POST /api/partner/v1/oauth/token` — suspended partner account | `403 invalid_client` | Distinct status code from the 401 cases above, matching the existing static-key `account_suspended` precedent |
| `POST /api/partner/v1/oauth/token` — malformed body / wrong `grant_type` | `400 invalid_request` | No DB read attempted |
| `POST /api/partner/v1/oauth/token` — rate limit exceeded (20/min per `client_id`) | `429`, `Retry-After` header, matches existing `rate_limit_exceeded` envelope | No secret-hash comparison attempted once the limit is hit (throttles brute-force attempts, not just legitimate retries) |
| Any `/api/partner/v1/*` route called with an expired, malformed, or client_id-revoked OAuth2 token | `401 invalid_api_key` (same generic code as a bad static key) | `requirePartnerApiKey()`'s new branch returns before reaching route logic — zero behavior difference visible to `sessions`/`usage`/`wallet`'s own code |
| `POST /api/admin/configurator/oauth-clients` called by a Clerk user with no `partner_admin_users` row for the target account | `403`, same error envelope as every other `/api/admin/configurator/*` route | No DB write |
| `PATCH /api/admin/configurator/outbound-config` validation failure | `422`, field-level error, unchanged from the existing pass-through route's own behavior | No DB write |
| `POST .../integration/test-outbound` called before `outbound_base_url`/`outbound_signing_secret` are set | `422 outbound_not_configured` | No outbound HTTP call attempted |
| `POST .../integration/test-outbound` — partner's own endpoint times out or refuses connection | `200 { success: false, error: "Could not reach the endpoint..." }` (Clio's own route never errors) | Logged server-side; never written to `webhook_dispatch_log` |
| `POST /api/partner/v1/sessions`, `live`-mode, no wallet row or no payment method | `402 funding_required` | `partner_sessions.status='failed'`, `.end_reason='funding_required'`; `dispatchMeetingBot()` never called, zero vendor cost incurred |
| `POST /api/partner/v1/sessions`, `live`-mode, `partner_wallets` read itself fails (transient DB error) | `500`, generic internal error | Fails closed — treated the same as "no payment method," never falls through to dispatch on an inconclusive read (a technical safety decision within BA authority: an ambiguous funding state must never resolve in the direction that risks real vendor cost) |

## 9. Edge Cases

- **`/dashboard/configurator` loads before the webhook lands (the Clerk redirect race, Screen state 3)**:
  `IntegrationClient`-family pages are not affected directly (they gate on `partner_admin_users` existing
  at all, same as `<NoPartnerAccounts />`); the mitigation is client-side: `HomeClient.tsx`'s existing
  pattern of a `NoPartnerAccounts` empty state is left as the terminal state for a first load, but a new,
  small addition to the `/dashboard/configurator` server component (not the Configurator's later screens)
  retries the `getPartnerAccountsForClerkUser` lookup once more after a 2-second delay before rendering
  `<NoPartnerAccounts />`, specifically for a Clerk session that is less than 60 seconds old (a proxy for
  "just came from signup," avoiding a retry delay for a genuinely-empty long-lived session) — a small,
  named, technical addition to an existing B2B-05 file, not a rewrite (Section 12).
- **A partner's Clerk signup stalls mid-flow** (e.g. they abandon after creating a Clerk user but before
  creating an Organization, or abandon after creating the Organization but before the wizard): no
  `partner_accounts`/`partner_admin_users` row exists yet in the first case (nothing to clean up — Clerk's
  own user record is the only artifact, matching the existing B2C `abandoned-onboarding-cleanup.ts`
  precedent's own scope, unmodified, not extended here); in the second case, the row(s) do exist and this
  document's reminder job (4.B.6/5.B.6) fires once at T+24h — **no deletion**, unlike the B2C precedent —
  a real company's Organization is not deleted for inactivity, per the standing "no delete without
  approval" rule and because nothing in the CEO brief's "reminder email" item (brainstorm doc item 3)
  describes cleanup, only a reminder.
- **A partner authenticating with an expired OAuth2 token**: covered explicitly by Section 7's acceptance
  test — `401 invalid_api_key`, same code as any other bad credential, no special client-side handling
  required beyond "re-authenticate," which is the entire point of the short-lived-token pattern (Section
  4.B.2).
- **A partner authenticating with a malformed OAuth2 token** (garbage string, not 3-segment JWT shape,
  not `clio_{test,live}_sk_` shape either): `looksLikePartnerApiKey()` returns false, `looksLikeOAuthAccessToken()`
  also returns false (no 3-segment structure) → immediate `401 invalid_api_key`, no verification attempt
  wasted, matching the existing static-key path's own fast-fail-on-obviously-malformed-input convention.
- **A partner using the same `client_id`/`client_secret` from two different servers simultaneously**:
  fully supported — the token endpoint has no session/single-use concept, any number of concurrent token
  exchanges succeed independently, matching the stateless design (no server-side notion of "this client
  already has an active token").
- **A partner-admin regenerates their outbound signing secret while a webhook delivery is in flight**:
  the in-flight delivery was already signed with the *old* secret at dispatch-attempt time (`lib/partner/
  webhooks.ts`'s `attemptDispatch()` reads `outbound_signing_secret` fresh per attempt, not cached) — a
  regeneration mid-flight could cause one in-flight retry to be signed with the new secret while the
  partner's receiver still expects the old one for a moment; this is an accepted, narrow race identical in
  shape to Stripe's own webhook-secret rotation UX (a brief overlap window is expected, not a defect this
  document needs to solve — no product requirement anywhere names zero-downtime secret rotation).
- **A partner never sets an outbound API token** (the write-only field in Screen state 1/4): fully
  supported — `outbound_auth_token` was already optional in the pre-existing `PATCH` route's own Zod
  schema (`z.string().min(1).optional()`), unchanged; a partner who only wants inbound-signed delivery
  verification (the signing secret) and does not require Clio to authenticate outbound calls to their own
  API can leave it unset indefinitely.
- **A brand-new self-serve partner exploring the Configurator and calling test-mode API endpoints before
  ever generating a `live`-mode credential**: fully supported, matches CEO's "What Success Looks Like"
  #4 exactly — nothing in this document gates `test`-mode credential generation, token exchange, or API
  calls on funding; only `live`-mode session dispatch is gated (Section 7's own orthogonality acceptance
  test).
- **Two internal-operator recovery routes (`POST /api/admin/partner-accounts`, `POST /api/admin/
  partner-accounts/:id/admins`) used to manually finish a stalled self-serve signup**: fully preserved,
  unmodified, per the CEO brief's explicit "reframed as secondary, not deleted" instruction — a SPOC using
  these routes to create/link a partner manually produces `partner_accounts`/`partner_admin_users` rows
  with `clerk_org_id = NULL` (a manually-provisioned account was never a Clerk Organization to begin
  with), which is a valid, expected state this document's schema explicitly supports (the column is
  nullable for exactly this reason).
- **A manually-provisioned (pre-B2B-06, or SPOC-recovery-path) `partner_accounts` row with
  `clerk_org_id = NULL` later gets its own Clerk Organization retroactively linked**: explicitly out of
  scope (Section 10) — no backfill/linking mechanism is built here; the column simply stays `NULL`
  indefinitely for such accounts, which is harmless (nothing in this document's own logic requires
  `clerk_org_id` to be non-null for any existing mechanism to keep working).
- **Mobile vs. desktop**: not applicable to `/dashboard/configurator/integration` (an internal-to-
  partner-admin operational screen, matching every other Configurator screen's existing no-mobile-spec
  precedent) — the `/partner-signup` wrapper is a public page and inherits whatever responsive behavior
  Clerk's own hosted `<SignUp>`/`<CreateOrganization>` components already provide out of the box (no
  additional responsive work is specified here, matching how `app/(auth)/sign-up` also does not specify
  any).

## 10. Out of Scope

Explicitly excluded, per the CEO brief's own scope boundaries plus this document's own findings:

- **A fully designed public marketing/landing signup page.** Uses Clerk's own hosted `<SignUp/>`/
  `<CreateOrganization/>` components behind a minimal branded wrapper instead (Section 4.A) — CLAUDE.md's
  pivot design system is explicitly undefined; inventing one here would violate the "flag as blocker
  rather than invent a visual direction" instruction.
- **OAuth2 refresh-token grant / persistent refresh tokens.** Client Credentials tokens are short-lived
  and re-obtained by re-authenticating with `client_id`/`client_secret` each time — no refresh-token flow,
  no persistent token-session state (CEO brief, explicit).
- **OAuth2 scopes / fine-grained permissions per credential.** A `client_id`/`client_secret` pair has the
  same access as today's single-tier API key, gated only by `mode` (CEO brief, explicit).
- **Self-serve UI for static-API-key generation.** The static key is preserved but demoted to the
  internal-operator route only (`POST /api/admin/partner-keys`, unmodified) — no self-serve UI is built
  for it in this document (CEO brief, explicit).
- **Revocation UI for OAuth2 clients.** This document builds self-serve generation and listing only —
  matching the existing precedent that `partner_api_keys` also has no self-serve revocation UI (only
  `POST`/`GET` exist on `/api/admin/partner-keys` today). Revoking a compromised `client_secret` remains a
  manual, internal-operator action (e.g. directly setting `status='revoked'`) until a future brief scopes
  a self-serve revoke control — not named in the CEO brief's success criteria.
- **Any change to `app/api/webhooks/clerk/route.ts`.** Unchanged — the new handler is a fully separate
  route (Known Constraint, CEO brief).
- **Any change to `partner_wallets` or `partner_onboarding_progress`.** Both already self-provision
  (Q3, unchanged from v1/v2) — this document only reads `partner_wallets.stripe_default_payment_method_id`,
  never writes to either table.
- **B2B-04's negative-balance-during-a-live-session handling.** Unchanged (B2B-04 Section 9) — the funding
  guardrail only gates whether a real session can *start*, never what happens to an already-started one.
- **Deleting or restricting the v1/v2 internal-operator create/link routes.** Preserved as the manual
  support/recovery path per the standing "no delete without approval" rule (Known Constraints, CEO
  brief).
- **A Configurator-side balance/funding-status banner.** Not named anywhere in the CEO brief; the
  funding-guardrail's user-facing surface is the API error response itself (Section 5.A) — a Clio UI
  banner surfacing wallet status proactively is a reasonable future enhancement, not built here.
- **Retroactively linking `clerk_org_id` for pre-existing, manually-provisioned partner accounts.** Out of
  scope (Section 9's own edge case) — no backfill mechanism is built.
- **The Attendee inbound-webhook signature bypass** (`docs/reference-vendor-api-integrations.md` §1) — a
  distinct, unrelated security bug, explicitly named in the brainstorm doc as "not a brief, direct fix,"
  not part of this document's scope.
- **The 20-minute-free/2-hour-block testing-metering mechanism** — already built and live (B2B-08,
  migration `077`), confirmed orthogonal to this document's funding guardrail by activation condition
  (Section 7's own acceptance test) — not re-specified or modified here.
- **Session-delivery extraction / internal glitch dashboard** — already built and live (B2B-09, migration
  `078`), unrelated to provisioning, not touched here.
- **Developer docs / API playground** — B2B-07's scope, a separate Feature Brief, not built here.

## 11. Open Questions

None.

Two structural/technical judgment calls this document made, documented here per the established
"surface findings rather than silently resolve or silently escalate low-stakes ones" precedent
(`docs/specs/B2B-04-requirement-document.md` Section 11, `B2B-05-requirement-document.md` Section 11):

1. **Combining the OAuth2 credential-generation UI and the outbound-config UI onto one Configurator
   screen** (`/dashboard/configurator/integration`, two cards) rather than two separate pages. The CEO
   brief's Approval note names them as two bullets but does not require two pages; combining them mirrors
   the Domain screen's own established two-card-per-screen pattern (subdomain + custom domain) and avoids
   adding a second new top-level Configurator route for two closely-related "how does my integration
   authenticate" concerns. This is a technical/scoping decision, not a product decision the CEO brief
   withheld — it does not change what data is collected, generated, or displayed, only how many page loads
   it takes to reach it.
2. **The OAuth2 token endpoint's request body uses `application/x-www-form-urlencoded` (RFC 6749 §4.4.2)
   rather than this codebase's usual JSON-body convention.** Documented explicitly in Section 4.B.2:
   deviating from the RFC shape here would undermine Arun's own stated reason for building this mechanism
   at all (a real compliance checkbox for enterprise partners' own off-the-shelf OAuth2 tooling, which
   sends form-encoded by default). Every other new route in this document uses this codebase's normal JSON
   convention — this is the one deliberate, narrow, justified exception, not a pattern change elsewhere.

## 12. Dependencies

- **B2B-02** (done) — `partner_accounts`, `partner_admin_users`, `partner_api_keys`, `requirePartnerApiKey`/
  `requirePartnerAdmin` (`lib/partner/auth.ts`), the HMAC signing mechanism (`lib/partner/webhook-
  signature.ts`), the encryption mechanism (`lib/partner/crypto.ts`) — this document extends the first
  two functions and reuses the rest unmodified.
- **B2B-03** (done) — the Configurator screen family (`ConfiguratorShell`/`Card`/`PrimaryButton`/`COLORS`
  from `_shared.tsx`, the `page.tsx`+`Client.tsx` split, `getPartnerAccountsForClerkUser`,
  `HomeClient.tsx`'s card grid) — this document's new screen follows this pattern exactly, adds one card.
- **B2B-04** (done) — `partner_wallets` (specifically `stripe_default_payment_method_id`, migration `075`)
  — the funding guardrail reads this column, writes nothing to this table.
- **B2B-05** (done) — `partner_accounts.onboarding_completed_at` and the existing wizard entry-point
  redirect (`app/dashboard/configurator/page.tsx`, `wizard/page.tsx`) — this document's signup flow relies
  on this existing, unmodified mechanism entirely for "immediately access the Configurator" (Section 4.A,
  Screen state 2's own finding: zero new redirect code needed).
- **B2B-08** (done) — `partner_wallets.trial_minutes_used`/`.test_minutes_balance`,
  `partner_sessions.end_reason`'s existing CHECK constraint (extended, not replaced, by this document),
  the existing `test`-mode trial-gate branch in `app/api/partner/v1/sessions/route.ts` (untouched,
  confirmed orthogonal by activation condition).
- **Clerk Organizations enabled in the Clerk dashboard** — a one-time, account-level configuration toggle,
  not code (Known Constraint, CEO brief) — must happen before `/partner-signup/organization` can function
  in any real environment; `<CreateOrganization/>` renders an error state from Clerk's own SDK if the
  feature is disabled on the account, which this document does not need to special-case (Clerk's own
  component handles it).
- **A second Clerk webhook endpoint configured in the Clerk dashboard**, pointed at `POST
  /api/webhooks/clerk-organization`, subscribed to `organization.created` and
  `organizationMembership.created` — a one-time infra/dashboard action (mirrors the existing Clerk webhook
  endpoint's own setup), tracked here, not a code deliverable of this document beyond the route itself
  existing to receive it.
- **`PARTNER_OAUTH_TOKEN_SIGNING_SECRET`** and **`CLERK_ORGANIZATION_WEBHOOK_SECRET`** — new env vars,
  `PLACEHOLDER_`-safe (dev-fallback behavior mirrors `lib/partner/crypto.ts`'s existing convention exactly
  for the former; the latter follows `CLERK_WEBHOOK_SECRET`'s existing hard-`500`-if-missing convention,
  matching the existing Clerk webhook route's own behavior for a *configured* endpoint with a missing
  secret — not a soft mock, since a webhook receiver either genuinely verifies signatures or should refuse
  to run, unlike an outbound-calling SDK client which has an established mock-stub convention).
- **What this document unblocks**: B2B-07 (Developer Portal)'s own row in `docs/b2b-pivot-status.md`
  names this document by number as the source of the OAuth2 credential-generation UI and token endpoint
  its own Documentation/Playground screens will link to and exercise — this document's completion removes
  B2B-07's one named phasing dependency.
