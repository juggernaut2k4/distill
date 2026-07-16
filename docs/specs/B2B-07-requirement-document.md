# B2B-07 — Developer Portal (Documentation + Playground)
# Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-07-15

> **RECONSTRUCTED 2026-07-15/16** — original lost to a concurrent-agent git-stash collision during the
> parallel B2B-06/07/08/09 build spree (see `docs/b2b-pivot-status.md`, Backlog section, "Reconstruct
> lost B2B-06/07/08/09 governance documents"). Rebuilt from the reconstructed CEO Feature Brief
> (`.claude/agents/clio/feature-briefs/B2B-07-developer-portal.md`) and `architecture.md` §17 (the full
> technical spec — file layout, `content.ts`'s complete `ENDPOINTS` array and `WEBHOOK_DOC`,
> `PlaygroundClient.tsx`'s `handleSend()` logic, the auth/onboarding gate — all intact and
> git-committed, never lost). Content matches the historical record to the best available evidence;
> where the CEO brief itself flagged a gap (the two lost secondhand-sourced documents,
> `docs/reference-vendor-api-integrations.md` and `docs/brainstorm-partner-signup-integration.md`), this
> document inherits that same secondhand-sourcing caveat rather than papering over it — see the CEO
> brief's own reconstruction note for the full chain of custody.
>
> **Confirmed as of this reconstruction: the screens this document specs were never actually built.**
> The CEO brief independently verified (`git log --all --diff-filter=A --name-only | grep -i
> playgroundclient` — zero hits, any branch, ever; every `.claude/worktrees/agent-*` worktree checked,
> not present in any of them) that `app/dashboard/configurator/developer/` does not exist anywhere in
> this repository's history. **This document represents the approved, ready-to-build spec, not an
> as-built record.** Do not treat any reference below to these screens' behavior as evidence they exist
> today — a developer building against this document is building net-new files.

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-07-developer-portal.md` (reconstructed
2026-07-15, itself citing the lost original CEO brief plus `docs/b2b-pivot-status.md`'s Live Status
table and Changelog as its own chain of evidence — read in full before this document was written).

Authoritative source material (all read in full or read directly against the live code for this
reconstruction):
- `.claude/agents/clio/feature-briefs/B2B-07-developer-portal.md` — the reconstructed CEO brief, this
  document's primary instruction source, including its "Known Constraints" and "Questions for BA"
  sections (all four already resolved, reproduced in Section 11 below).
- `architecture.md` §17 (B2B-07 companion technical spec) — file layout (§17.1), the complete
  `content.ts` `ENDPOINTS` array and `WEBHOOK_DOC` constant (§17.2), `PlaygroundClient.tsx`'s
  `handleSend()` mechanics (§17.3), the auth/onboarding gate (§17.4), and the `dispatchMeetingBot()`
  test-mode gap note (§17.5). Confirmed intact and git-committed per the CEO brief's own reconstruction
  note.
- `docs/specs/B2B-06-requirement-document.md` — structural/format template for this document (section
  numbering, heading style, acceptance-criteria density) per this repo's own established precedent of
  each spec following the prior one's format; the one surviving Requirement Document in this B2B-06/07/
  08/09 series.
- `app/api/partner/v1/sessions/route.ts`, `app/api/partner/v1/sessions/[clio_session_ref]/route.ts`,
  `app/api/partner/v1/usage/route.ts`, `app/api/partner/v1/wallet/route.ts`, `app/api/partner/v1/oauth/
  token/route.ts` — read directly to make every request/response example in Section 4 byte-accurate
  against the live routes, not copied from prose.
- `lib/partner/auth.ts` (`requirePartnerApiKey()`, the OAuth2 fallback branch, the `PartnerApiKeyContext`
  shape, the error-envelope helper), `lib/partner/rate-limit.ts` (`RateLimitClass` values and their
  actual capacity/window), `lib/partner/webhook-signature.ts` (`Clio-Signature` header format, HMAC
  recipe), `lib/partner/webhooks.ts` (the outbound webhook payload contract and 5-attempt backoff
  schedule) — read directly for the same byte-accuracy reason.
- `app/dashboard/configurator/topics/page.tsx` — the existing Configurator screen gate pattern (Clerk
  `auth()` → `redirect('/sign-in')` → `getPartnerAccountsForClerkUser` → `<NoPartnerAccounts />` if empty
  → resolve `activePartnerAccountId` → `onboarding_completed_at` wizard-redirect check) that this
  document's two new screens' own gates (`architecture.md` §17.4) must match and were confirmed,
  side-by-side, to match byte-for-byte.
- `app/dashboard/configurator/integration/page.tsx` and `IntegrationClient.tsx` — confirmed live
  (B2B-06's shipped Configurator screen) as the destination this document's Documentation screen links
  to for OAuth2 credential generation, per the CEO brief's explicit scope boundary that credential
  issuance is not duplicated here.

Companion artifact (already produced, unmodified by this document): `architecture.md` §17, the exact
technical spec a developer implements against — file layout, full `content.ts` source, `handleSend()`
logic, and the auth-gate code. This Requirement Document does not restate every line of §17's code; it
specifies the product/UX behavior, screen states, acceptance criteria, and edge cases that code must
satisfy, and reproduces the load-bearing shapes inline where a developer needs them without
cross-referencing.

No migration produced or required — Section 6.

---

## Template Adaptation Note (per this repo's own established pattern, B2B-06/04/05)

This document covers two related screens (`/dashboard/configurator/developer` and its `/playground`
child route) that together form one coherent feature — a partner cannot productively use the Playground
without the Documentation screen's reference content (the Playground reuses `content.ts`'s `ENDPOINTS`
array directly, per `architecture.md` §17.1's file layout: both client components import the same
constants file, "example payloads are shared, not duplicated"). Per B2B-06's own established precedent
of keeping structurally-inseparable screens in one document rather than splitting for no product reason,
this BA keeps this as **one document**, not two.

Sections are kept in standard order/numbering to match every other spec in `docs/specs/`, adapted as
follows:
- **Section 4** covers both screens' full behavior — 4.A the Documentation screen, 4.B the exact
  `content.ts` data contract both screens read from (reproduced inline, not just cross-referenced,
  because a developer implementing this document needs the literal shape), 4.C the Playground screen.
- **Section 5** gives literal wireframes for every screen state on both routes, plus text sequence flows
  for the Playground's Send mechanics (both the three-enabled-endpoint path and the
  `sessions_create`-disabled path).
- All other sections apply directly to both screens together.

---

## 1. Purpose

Today, a partner integrating with Clio's B2B API has no self-serve way to learn the API surface or
verify a request before writing code against it. There is no OpenAPI spec, no `/docs` route, no page
showing a real example request/response for any of the four live `/api/partner/v1/*` routes, and no way
to try a call without guessing at field names and shapes from internal spec documents the partner never
sees (confirmed by direct code search at CEO-brief-writing time: zero `/docs` route, zero playground UI
anywhere in the repository).

This directly undercuts B2B-06's self-serve signup motion: a partner can complete `/partner-signup`,
generate an OAuth2 credential on `/dashboard/configurator/integration`, and have nothing built to tell
them what to do with it next. This is exactly items 5 ("a documentation/developer option showing all of
Clio's partner-facing APIs and schemas") and 6 ("a playground where a partner can paste JSON and test a
request against the live API") of Arun's original 8-point platform vision, confirmed by the CEO brief as
the two items a gap-analysis dispatch found not built at all.

**What failure looks like without this document:** a partner's engineering team either reverse-engineers
the API surface from trial and error against production, asks Clio staff directly for documentation that
does not exist in any shareable form, or gives up integrating — undermining the entire self-serve
provisioning motion B2B-06 was built to enable.

## 2. User Story

**Story 1 — A partner's engineer, learning the API for the first time**
As a developer at a partner company who just received (or generated) API credentials,
I want to read exactly what each endpoint does, what fields it accepts, what a real response looks like,
and what every possible error means,
So that I can write correct integration code without guessing or asking Clio staff.

**Story 2 — The same engineer, verifying a request before writing code**
As a developer integrating with Clio's API,
I want to paste my own test-mode API key and try a real request against the live API directly from my
browser,
So that I can confirm my understanding of a request/response shape is correct before I write a single
line of my own integration code.

**Story 3 — The same engineer, understanding outbound webhooks**
As a developer building the receiving end of Clio's usage webhook,
I want to see the exact payload fields, the signature header format, the HMAC verification recipe, and
the retry schedule,
So that I can build a correct, secure webhook receiver without reverse-engineering the signature scheme.

**Story 4 — The same engineer, evaluating whether to trust the auth documentation**
As a developer deciding how to authenticate my server to Clio's API,
I want the documentation to describe the mechanism I should actually build against today,
So that I don't build against a static API key that Clio has already demoted to a secondary/recovery
path, or worry the documented mechanism is a stub that might not be real yet.

## 3. Trigger / Entry Point

- **Documentation screen**: `GET /dashboard/configurator/developer`, page load, Clerk-authenticated.
  State required: at least one `partner_admin_users` row for the signed-in Clerk user (identical entry
  gate to every other Configurator screen — `<NoPartnerAccounts />` otherwise), and
  `partner_accounts.onboarding_completed_at IS NOT NULL` for the active account (otherwise redirected to
  `/dashboard/configurator/wizard?partner_account_id={id}`, same as every other Configurator screen).
  Reached via a new card on `HomeClient.tsx`'s existing card grid (or a direct URL/bookmark) — this
  document does not specify new top-level navigation chrome beyond following the existing Configurator
  card-grid convention, since no CEO brief instruction names one.
- **Playground screen**: `GET /dashboard/configurator/developer/playground`, page load, identical gate
  shape to the Documentation screen (`architecture.md` §17.4 — the same auth/onboarding check, duplicated
  in `playground/page.tsx`, not shared via a layout, matching how every other Configurator route pair in
  this codebase gates independently rather than via a shared parent gate).
- **Playground "Send" action**: button click inside `PlaygroundClient.tsx`, client-side only — no page
  navigation; triggers `handleSend()` (Section 4.C), which calls one of the four live `/api/partner/v1/*`
  routes directly from the browser using the API key value the user typed into the Playground's own input
  field.

## 4. Screen / Flow Description

### 4.A `/dashboard/configurator/developer` — Documentation screen

**Layout**: follows the existing Configurator screen pattern exactly — server component
(`page.tsx`) does the Clerk `auth()` gate + `redirect('/sign-in')`, `getPartnerAccountsForClerkUser`,
`<NoPartnerAccounts />` if empty, resolves `activePartnerAccountId`, checks
`onboarding_completed_at` and redirects to the wizard if unset, then renders `DeveloperDocsClient`
wrapped in the existing `<ConfiguratorShell>`, using `COLORS`/`Card`/`PrimaryButton`/`SecondaryButton`
from `_shared.tsx` unmodified — no new design system invented, byte-for-byte the same gate shape as
`app/dashboard/configurator/topics/page.tsx` (confirmed by direct side-by-side read).

Renders **hand-authored reference content only**, imported from `content.ts` — never an AI-generated API
call. This is a hard requirement, not a style preference: per this repo's standing rule against
populating undefined/reference-content screens with speculative model output, and per `architecture.md`
§17.2's own file-header convention ("hand-transcribed from the live route files... verified against them
directly. Update this file whenever any of those four routes' request/response contract changes — a
stale reference here is worse than none").

**Screen state 1 — loaded, all four endpoints + webhook doc visible**

```
┌───────────────────────────────────────────────────────────┐
│  Clio Configurator          Developer  [Acme Co ▾]         │
│  ← Back                                                     │
│                                                               │
│  Developer                                    [Open Playground →]
│                                                               │
│  Authentication                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Clio's partner API uses OAuth2 Client Credentials      │ │
│  │ (RFC 6749 §4.4). Exchange your client_id/client_secret │ │
│  │ for a short-lived access token, then send it as        │ │
│  │ `Authorization: Bearer <token>` on every request.      │ │
│  │                                                          │ │
│  │ POST /api/partner/v1/oauth/token                       │ │
│  │ Content-Type: application/x-www-form-urlencoded         │ │
│  │                                                          │ │
│  │ grant_type=client_credentials&client_id=...&            │ │
│  │ client_secret=...                                       │ │
│  │                                                          │ │
│  │ → 200 { access_token, token_type: "Bearer",             │ │
│  │         expires_in: 3600 }                              │ │
│  │                                                          │ │
│  │ Tokens expire after 1 hour — re-authenticate to get a   │ │
│  │ new one. A static API key mechanism also exists as a    │ │
│  │ secondary, internal-operator recovery path; new         │ │
│  │ integrations should use OAuth2.                         │ │
│  │                                                          │ │
│  │ [ Generate credentials → ]  (links to /dashboard/       │ │
│  │   configurator/integration)                              │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                               │
│  Endpoints                                                   │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ POST /api/partner/v1/sessions                          │ │
│  │ Starts a new Clio session — dispatches a real meeting   │ │
│  │ bot into the given URL and provisions the live voice/   │ │
│  │ visual experience.                                       │ │
│  │ Rate limit: 60 requests/minute per partner account.      │ │
│  │                                                            │ │
│  │ Request fields                                            │ │
│  │  meeting_url          string (URL)   required             │ │
│  │  partner_topic_ref    string         no*                  │ │
│  │  content_ref          string (UUID)  no*                  │ │
│  │  partner_end_user_ref string         no                   │ │
│  │  partner_reference    string         no  (echoed on every │ │
│  │                                            usage webhook) │ │
│  │                                                            │ │
│  │ Example request                                           │ │
│  │  { "meeting_url": "https://meet.google.com/abc-defg-hij", │ │
│  │    "partner_topic_ref": "onboarding-101",                 │ │
│  │    "partner_reference": "acct_492" }                      │ │
│  │                                                            │ │
│  │ Example response (201)                                    │ │
│  │  { "clio_session_ref": "uuid", "status": "bot_active",    │ │
│  │    "render_url": "string" }                               │ │
│  │                                                            │ │
│  │  * At least one of partner_topic_ref or content_ref is    │ │
│  │    required.                                               │ │
│  │  401/403/429 use { error: { code, message, request_id } }.│ │
│  │  402/500 use { error: { code, message } } — no request_id.│ │
│  │  422 uses { error: "Validation failed", details } —       │ │
│  │  error is a plain string here, not an object.              │ │
│  │                                                            │ │
│  │  Other responses                                           │ │
│  │   401  invalid_api_key / revoked_api_key                   │ │
│  │   402  trial_exhausted (test-mode keys only, once the      │ │
│  │        free 20-minute allowance is used up)                │ │
│  │   403  account_suspended                                   │ │
│  │   422  validation failure                                  │ │
│  │   429  rate limit exceeded, Retry-After header present     │ │
│  └───────────────────────────────────────────────────────┘ │
│  (three more endpoint cards follow: GET .../sessions/:ref, │
│   GET .../usage, GET .../wallet — see Section 4.B for the   │
│   exact content of each)                                     │
│                                                               │
│  Outbound usage webhook                                      │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ POST {your outbound_base_url}/webhooks/usage            │ │
│  │ Payload fields: event_id, event_type, clio_session_ref, │ │
│  │ partner_reference, quantity, unit, generation_type,       │ │
│  │ occurred_at, dispatched_at, test_mode                     │ │
│  │                                                            │ │
│  │ Signature header: Clio-Signature: t=<unix_timestamp>,    │ │
│  │ v1=<hex_hmac>                                              │ │
│  │                                                            │ │
│  │ Verify: HMAC-SHA256(signing_secret, `${t}.${raw_body}`), │ │
│  │ constant-time compare, reject if |now - t| > 300s.        │ │
│  │                                                            │ │
│  │ Retries: 1m, 5m, 30m, 2h, 6h (5 attempts total, then      │ │
│  │ marked exhausted).                                         │ │
│  │                                                            │ │
│  │ Known gap: no transcript, action-item, glitch, or          │ │
│  │ psychology data in this payload today — usage/billing      │ │
│  │ fields only.                                               │ │
│  └───────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

Every endpoint card renders directly from one `EndpointDoc` object in `content.ts`'s `ENDPOINTS` array
(Section 4.B) — method, path, purpose, rate limit, request fields (or query params, or path param,
whichever the endpoint has), example request body (when applicable), example response, response notes
(rendered as a bullet list under the example response, verbatim), and the full `otherResponses` table.
The webhook card renders directly from the `WEBHOOK_DOC` constant, also verbatim.

The `[Open Playground →]` button in the top-right (or an equivalent per-endpoint "Try it" link — this
document leaves the exact placement to implementation, since no CEO brief instruction specifies more than
that the two screens must link to each other) navigates to
`/dashboard/configurator/developer/playground?partner_account_id={id}`.

The `[Generate credentials →]` link inside the Authentication card navigates to the existing, unmodified
`/dashboard/configurator/integration?partner_account_id={id}` screen (B2B-06, confirmed live) — this
document builds no credential-generation UI of its own (Section 10).

**Screen state 2 — loading**

Renders a single centered line: `"Loading developer documentation…"` — matches the Domain screen's
existing loading-state convention (`docs/specs/B2B-05-requirement-document.md` Section 4.A, Screen state
6), applied here. In practice this state is near-instantaneous since `content.ts` is a static,
build-time-bundled constants file with no network fetch — the loading state exists only for the
`getPartnerAccountsForClerkUser`/`onboarding_completed_at` server-side resolution that precedes render,
matching every other Configurator screen's own brief loading flash.

**Screen state 3 — no partner accounts**

Identical to every other Configurator screen: `<NoPartnerAccounts />`, unmodified,
`"You don't administer any partner accounts."`

### 4.B `content.ts` — the documentation source of truth (data contract for both screens)

Reproduced here verbatim from `architecture.md` §17.2 because both Section 4.A (Documentation) and
Section 4.C (Playground) read from this exact shape — a developer building either screen needs the
literal contract, not a paraphrase, and per the CEO brief's own instruction this file must be
"hand-transcribed from the live route files... verified against them directly," which this document's
own authoring confirmed by reading `app/api/partner/v1/sessions/route.ts`,
`sessions/[clio_session_ref]/route.ts`, `usage/route.ts`, and `wallet/route.ts` directly (Section 4.B.1–4
below cite the exact `file:line` each field traces to).

```ts
export type PlaygroundEndpointId = 'sessions_create' | 'sessions_get' | 'usage' | 'wallet'

export interface EndpointDoc {
  id: PlaygroundEndpointId
  method: 'GET' | 'POST'
  path: string
  purpose: string
  rateLimit: string
  requestFields?: { field: string; type: string; required: string; notes: string }[]
  queryParams?: { param: string; type: string; default: string; notes: string }[]
  pathParam?: { name: string; type: string; notes: string }
  exampleRequestBody?: object
  exampleResponse: object
  responseNotes: string[]
  otherResponses: { status: string; meaning: string }[]
  playgroundDisabled: boolean
  playgroundDisabledReason?: string
}
```

#### 4.B.1 `sessions_create` — `POST /api/partner/v1/sessions`

Traced against `app/api/partner/v1/sessions/route.ts`. Request schema (`CreateSessionSchema`, lines
21–29): `meeting_url` (URL string, required), `partner_topic_ref` (1–512 printable-ASCII chars,
conditionally required), `content_ref` (UUID, conditionally required — at least one of
`partner_topic_ref`/`content_ref` must be present, enforced by the schema's `.refine()`),
`partner_end_user_ref` (1–256 printable-ASCII chars, optional), `partner_reference` (1–256
printable-ASCII chars, optional, echoed on every usage webhook for this session). Success response is
`201` with `{ clio_session_ref, status, render_url }` (lines 84–139, both the test-mode and live-mode
branches return this exact shape). Rate limit: 60 requests/minute per partner account
(`lib/partner/rate-limit.ts` line 30, `sessions_create` class).

Error responses, traced directly: `401 invalid_api_key`/`revoked_api_key` (`lib/partner/auth.ts`'s
`requirePartnerApiKey()`, envelope `{ error: { code, message, request_id } }`), `402 trial_exhausted`
(test-mode only, lines 99–108, envelope `{ error: { code, message } }` — no `request_id`, hand-rolled
inline in the route, not via the `errorEnvelope()` helper), `402 funding_required` (live-mode only, lines
165–175, same no-`request_id` shape), `403 account_suspended` (`requirePartnerApiKey()`, same envelope as
401), `422` validation failure (`{ error: 'Validation failed', details: parsed.error.flatten() }` — line
39, a plain string `error`, not an object, the one deliberate deviation from the codebase's usual error
shape for this specific failure mode), `429 rate_limit_exceeded` (`requirePartnerApiKey()`, `Retry-After`
header set), `500 internal_error` (line 74, insert failure, no `request_id`).

`playgroundDisabled: true` — see Known Constraints (Section 4.C.1) and `playgroundDisabledReason`:
> "Live testing for this endpoint is temporarily disabled. Dispatching a session sends a real meeting bot
> into the meeting URL you provide — Clio's current test-mode safeguard does not yet prevent this for
> every account state, so this Playground does not enable it until that's fixed. The request/response
> shape above is accurate; you just can't send it from here yet."

#### 4.B.2 `sessions_get` — `GET /api/partner/v1/sessions/:clio_session_ref`

Traced against `app/api/partner/v1/sessions/[clio_session_ref]/route.ts`. Path param
`clio_session_ref` (UUID, required — a malformed UUID short-circuits to `404` before any DB query, line
27). Success response `200` (implicit status) with `{ clio_session_ref, status, created_at, ended_at }`
(lines 40–45) — **never** includes `provider_bot_id`, `provider_name`, or `meeting_url` (internal-only
fields, explicit in the route's own docstring). A ref that doesn't exist and a ref that belongs to a
different partner are structurally indistinguishable — both `404` `not_found`, enforced by scoping the
query to `auth.partnerAccountId` (line 35), not a separate ownership check. Rate limit: 300
requests/minute (`reads` class). `playgroundDisabled: false`.

#### 4.B.3 `usage` — `GET /api/partner/v1/usage`

Traced against `app/api/partner/v1/usage/route.ts`. Query params: `from` (ISO 8601, default 30 days
ago), `to` (ISO 8601, default now), `event_type` (`'usage.voice_minute' | 'usage.llm_generation_call' |
'session.completed'`, default all types — `session.completed` always returns an empty `events` array
since it is never written to the billable `usage_events` ledger, lines 104–107), `cursor` (opaque
base64 string, from the previous response's `next_cursor`). Success response `200` with
`{ events: [...], next_cursor }`, page size 100 (`PAGE_SIZE` constant, line 33), each event shaped as
`{ event_id, event_type, clio_session_ref, partner_reference, quantity, unit, generation_type,
occurred_at, dispatched_at, test_mode, delivery_status }` — always filtered to `test_mode = false` (line
118). `422` on an invalid `event_type` (plain-string-error shape, same as `sessions_create`). Rate limit:
300 requests/minute (`reads` class). `playgroundDisabled: false`.

#### 4.B.4 `wallet` — `GET /api/partner/v1/wallet`

Traced against `app/api/partner/v1/wallet/route.ts`. No request body, no query params, no path param.
Success response `200` with `{ balance_usd, reference_topup_amount_usd, low_balance_alert_active,
burn_rate_by_event_type: [{ event_type, unit, rate_usd, rate_basis }], avg_daily_burn_usd,
projected_days_remaining, days_remaining_null_reason, next_billing_date, updated_at }` —
`burn_rate_by_event_type` always lists all 8 current event types (`EVENT_TYPES`, lines 24–33);
`rate_usd: null` means no rate configured yet for that type. No explicit 4xx handling beyond the shared
auth check — a DB read failure surfaces as a generic, unstructured `500` (confirmed by direct read: no
`try`/`catch` around the `supabase` calls in this route). Rate limit: 300 requests/minute (`reads`
class, same as `usage`). `playgroundDisabled: false`.

#### 4.B.5 `WEBHOOK_DOC` — outbound usage webhook contract

Traced against `lib/partner/webhook-signature.ts` and `lib/partner/webhooks.ts`. Path:
`POST {your outbound_base_url}/webhooks/usage` (the exact suffix `attemptDispatch()` posts real events
to, `lib/partner/webhooks.ts`). Payload fields: `event_id`, `event_type`, `clio_session_ref`,
`partner_reference`, `quantity`, `unit`, `generation_type`, `occurred_at`, `dispatched_at`, `test_mode`.
Signature header: `Clio-Signature: t=<unix_timestamp>,v1=<hex_hmac>` (`HEADER_NAME` constant,
`webhook-signature.ts` line 19). Verification recipe: `HMAC-SHA256(signing_secret,
`${t}.${raw_body}`)`, constant-time compare, reject if `|now - t| > 300s` (`computeSignature()` and
`DEFAULT_TOLERANCE_SECONDS`, lines 20–24 — the exact reference implementation a partner's own receiver
should mirror). Retry schedule: 1m, 5m, 30m, 2h, 6h (5 attempts total, then marked exhausted) — traced
directly to `BACKOFF_SECONDS` and the comment at `lib/partner/webhooks.ts` line 595. Known gap (stated
verbatim on the Documentation screen, not softened): no transcript, action-item, glitch, or psychology
data in this payload today — usage/billing fields only.

### 4.C `/dashboard/configurator/developer/playground` — Playground screen

**Layout**: identical gate shape to 4.A (`architecture.md` §17.4 — Clerk `auth()` → onboarding-completion
check), rendering `PlaygroundClient` instead of `DeveloperDocsClient`. Renders inside the same
`<ConfiguratorShell>`, no new visual language — explicit Known Constraint (CEO brief): no Monaco,
CodeMirror, Swagger UI, or any OpenAPI-spec-renderer package. The JSON body editor is a plain
`<textarea>`; path/query param inputs are plain `<input>`; endpoint reference cards reuse the same
hand-rolled card components as the Documentation screen (imports `content.ts`'s `ENDPOINTS` directly, not
a duplicate copy).

**Screen state 1 — initial load, no endpoint selected / `sessions_get` selected by default**

```
┌───────────────────────────────────────────────────────────┐
│  Clio Configurator     Developer › Playground [Acme Co ▾]  │
│  ← Back to Developer Docs                                    │
│                                                                │
│  Playground                                                  │
│                                                                │
│  Your API key                                                │
│  [ clio_test_sk_...                                    ]     │
│  Held in memory only — never saved, cleared on reload.       │
│                                                                │
│  Endpoint                                                     │
│  ( ) POST /sessions          — disabled, "Documented, not    │
│                                  testable" badge               │
│  (•) GET /sessions/:ref                                       │
│  ( ) GET /usage                                                │
│  ( ) GET /wallet                                                │
│                                                                │
│  clio_session_ref                                             │
│  [ uuid                                                 ]     │
│                                                                │
│  [ Send ]                                                      │
│                                                                │
│  Response                                                      │
│  (empty — nothing sent yet)                                   │
└───────────────────────────────────────────────────────────┘
```

The API key input is a plain `<input type="password">`-style masked text field, `useState`-backed only —
**never** written to `localStorage`/`sessionStorage` (Section 6/9), cleared by React's normal unmount
behavior on navigation or reload, no explicit clear logic required (Known Constraint, CEO brief).

The endpoint selector renders one radio/tab per `ENDPOINTS` entry. The `sessions_create` option is
visually present (so a partner can see it exists and read its disabled reason) but rendered
**disabled**, with a short badge or inline note showing `endpoint.playgroundDisabledReason` (Section
4.B.1's exact text) — either inline under the option or in a tooltip; this document does not mandate
which, only that the reason text must be genuinely reachable on this screen, not only on the
Documentation screen, since a user who lands on the Playground first and never visits `/developer` must
still be able to see why the option is inert.

Below the endpoint selector, the input area adapts per the selected endpoint's own shape (mirrors
`handleSend()`'s own per-endpoint branching, Section 4.C.1):
- `sessions_get`: one text input, labelled `"clio_session_ref"`, placeholder `"uuid"`.
- `usage`: one `<textarea>`, labelled `"Query params (JSON)"`, placeholder
  `'{ "from": "2026-07-01T00:00:00Z", "event_type": "usage.voice_minute" }'`, pre-filled empty
  (an empty/omitted body is valid — all query params are optional per Section 4.B.3).
- `wallet`: no input area at all — `[Send]` is immediately reachable, matching the endpoint's own
  no-body, no-query-param, no-path-param shape.
- `sessions_create`: no input area rendered at all (the `[Send]` control state below applies instead).

**Screen state 2 — `sessions_create` selected**

```
┌───────────────────────────────────────────────────────────┐
│  Endpoint                                                     │
│  (•) POST /sessions          🔒 Documented, not testable      │
│  ( ) GET /sessions/:ref                                        │
│  ( ) GET /usage                                                 │
│  ( ) GET /wallet                                                  │
│                                                                    │
│  Live testing for this endpoint is temporarily disabled.         │
│  Dispatching a session sends a real meeting bot into the         │
│  meeting URL you provide — Clio's current test-mode safeguard    │
│  does not yet prevent this for every account state, so this      │
│  Playground does not enable it until that's fixed. The           │
│  request/response shape above is accurate; you just can't send   │
│  it from here yet.                                                │
│                                                                     │
│  See the full request/response reference on the Developer Docs   │
│  page →                                                            │
│                                                                     │
│  [ Send ]  (disabled, no onClick wired)                            │
└───────────────────────────────────────────────────────────┘
```

The `[Send]` button in this state has **no `onClick` handler wired at all** — not merely a disabled
button that would otherwise call `handleSend()` (Section 4.C.1's own `if (endpoint.playgroundDisabled)
return` early-exit is defense-in-depth, not the only gate — the CEO brief is explicit that there must be
no path for a partner to trigger a real bot dispatch from this screen). A link to the Documentation
screen's `sessions_create` card is shown so the request/response shape is still one click away.

**Screen state 3 — sending**

`[Send]` shows a brief loading state (`sending` boolean, `handleSend()`'s own `setSending(true)`/
`setSending(false)` around the `fetch()` call) — button text or a spinner, implementation's choice, no
specific copy mandated since no CEO brief instruction names one. The Response area below is left
unchanged (previous response, if any, stays visible) until the new response arrives.

**Screen state 4 — response received (success)**

```
┌───────────────────────────────────────────────────────────┐
│  Response                                          200        │
│  {                                                              │
│    "clio_session_ref": "3f9a...",                               │
│    "status": "bot_active",                                       │
│    "created_at": "2026-07-15T18:02:11Z",                          │
│    "ended_at": null                                                │
│  }                                                                   │
└───────────────────────────────────────────────────────────┘
```

The raw response is rendered — status code prominently, JSON body pretty-printed below it. This document
does not require the response viewer to be a rich JSON tree/collapsible widget (Known Constraint: no new
JSON-rendering dependency) — a pretty-printed `<pre>` block of `JSON.stringify(body, null, 2)` satisfies
this screen state; a `Retry-After` header value, when present (429 responses), is also shown alongside
the status code (`handleSend()` captures `res.headers.get('Retry-After')` into the response state
explicitly, Section 4.C.1).

**Screen state 5 — response received (error)**

Identical layout to Screen state 4, showing whatever status code and body the live API actually
returned (401/402/403/404/422/429/500, per Section 4.B's own per-endpoint `otherResponses` tables) — the
Playground renders the real API's real response verbatim, it does not interpret, translate, or prettify
error codes into different copy. This is a deliberate product property, not an omission: the entire point
of hitting the real API (Section 4.C.1) is that a partner sees genuinely correct error shapes, not a
simulation.

**Screen state 6 — client-side validation error (before any request is sent)**

Two cases, both rendered as an inline red validation message near the `[Send]` button, and **no network
request is made**:
- No API key entered: `"Enter an API key first."` (`handleSend()`'s own `setValidationError('Enter an
  API key first.')`, Section 4.C.1).
- Malformed JSON in the `usage` query-params textarea: `` "Not valid JSON: {parse error message}." ``
  (`handleSend()`'s own `catch` block around `JSON.parse(editorValue || '{}')`, Section 4.C.1).

**Screen state 7 — network error (fetch itself failed, not an HTTP error response)**

```
┌───────────────────────────────────────────────────────────┐
│  Response                                                       │
│  Could not reach the API. Check your connection and try again.  │
└───────────────────────────────────────────────────────────┘
```

Traced to `handleSend()`'s own `catch { setResponse({ networkError: true }) }` branch (Section 4.C.1) —
distinct from an HTTP error response (Screen state 5), which always has a status code; this state has
none, meaning the `fetch()` call itself threw (DNS failure, CORS block, offline, etc.).

#### 4.C.1 `handleSend()` — Send mechanics

Reproduced here verbatim from `architecture.md` §17.3 (simplified to the load-bearing logic) because this
is the literal behavior a developer implements against — this document does not paraphrase it into looser
prose:

```ts
async function handleSend(endpoint: EndpointDoc, apiKey: string, editorValue: string, pathParamValue: string) {
  if (endpoint.playgroundDisabled) return // belt-and-suspenders — the button has no onClick wired at all
                                           // in this state; this guard is defense-in-depth, not the only gate.
  if (!apiKey) { setValidationError('Enter an API key first.'); return }

  let url = endpoint.path
  const init: RequestInit = { method: endpoint.method, headers: { Authorization: `Bearer ${apiKey}` } }

  if (endpoint.id === 'sessions_get') {
    url = url.replace(':clio_session_ref', encodeURIComponent(pathParamValue))
  } else if (endpoint.id === 'usage') {
    let params: Record<string, string>
    try { params = JSON.parse(editorValue || '{}') }
    catch (e) { setValidationError(`Not valid JSON: ${(e as Error).message}`); return }
    const qs = new URLSearchParams(params).toString()
    if (qs) url += `?${qs}`
  }
  // 'wallet' — no path param, no query params, no body.
  // 'sessions_create' — unreachable here; playgroundDisabled short-circuits above.

  setValidationError(null)
  setSending(true)
  try {
    const res = await fetch(url, init)
    const body = await res.json().catch(() => null)
    setResponse({ status: res.status, retryAfter: res.headers.get('Retry-After'), body })
  } catch {
    setResponse({ networkError: true })
  } finally {
    setSending(false)
  }
}
```

Calls the **real, live** `/api/partner/v1/*` route directly from the browser, using the partner's own
credential — never a mock, simulated, or Clio-proxied backend (Questions for BA #3, resolved: real API,
`test`-mode credential, so a partner gets real validation errors and real response shapes instead of a
simulation that could silently drift from actual behavior). No new Clio-owned API route is introduced for
this — the four target endpoints already exist and are already reachable cross-origin from the browser
via the partner's own bearer token (no CORS/proxy work is named in scope by the CEO brief, and none is
invented here).

## 5. Visual Examples

All screen-state wireframes are given inline with their exact copy in Section 4.A/4.C, per this repo's
own established precedent (B2B-06 Section 5.A / B2B-05 Section 5.A) of keeping wireframe and exact copy
together rather than separated into a distinct section.

### 5.A Sequence flows

**5.A.1 — Documentation screen, happy path**
```
Partner-admin (Clerk session) → /dashboard/configurator/developer
  → Clerk auth() gate passes → getPartnerAccountsForClerkUser → at least one account
  → onboarding_completed_at IS NOT NULL → renders DeveloperDocsClient
  → content.ts's ENDPOINTS array + WEBHOOK_DOC render as static cards, no network fetch
  → partner-admin clicks [Open Playground →] → /dashboard/configurator/developer/playground
```

**5.A.2 — Playground, a live-testable endpoint (`sessions_get`, `usage`, or `wallet`)**
```
Partner-admin → /dashboard/configurator/developer/playground → pastes their own clio_test_sk_... key
  → selects "GET /sessions/:ref" → enters a clio_session_ref they own → [Send]
  → handleSend(): playgroundDisabled is false → apiKey present → builds URL with path param substituted
  → fetch('/api/partner/v1/sessions/{ref}', { headers: { Authorization: 'Bearer clio_test_sk_...' } })
  → real route: requirePartnerApiKey() authenticates the real key → real DB read scoped to the caller's
    own partner_account_id → 200 { clio_session_ref, status, created_at, ended_at }
  → setResponse({ status: 200, retryAfter: null, body }) → Screen state 4 renders the real response
```

**5.A.3 — Playground, `sessions_create` (disabled)**
```
Partner-admin → selects "POST /sessions" → radio option renders selected but [Send] has no onClick
  → playgroundDisabledReason text is visible → no request is ever possible from this screen
  → partner-admin instead reads the Documentation screen's sessions_create card for the exact shape,
    then implements the call in their own backend directly against the live API
```

**5.A.4 — Playground, malformed API key or a genuinely wrong/revoked key**
```
Partner-admin → enters a key → [Send] on a live-testable endpoint
  → handleSend() proceeds (client-side, apiKey is non-empty, so it is not caught by the
    "Enter an API key first" validation — client-side validation only checks presence, never format)
  → fetch() reaches the real route → requirePartnerApiKey() rejects: malformed → 401 invalid_api_key,
    or a real but revoked key → 401 revoked_api_key, or a real key on a suspended account → 403
    account_suspended
  → setResponse({ status: 401 | 403, body }) → Screen state 5 renders the real error verbatim
```

## 6. Data Requirements

**No schema change, no migration** — per `architecture.md` §17's own header note and the CEO brief's
explicit "No schema change" Known Constraint. This document reads no new table and writes no new table.

**Read from the database (indirectly, via the four existing live routes, not by this document's own new
code):** `partner_sessions` (via `sessions_create`/`sessions_get`), `usage_events` +
`webhook_dispatch_log` (via `usage`), `partner_wallets` + `billing_rate_versions` (via `wallet`),
`partner_oauth_clients` + `partner_accounts` (via the OAuth2 token-exchange branch of
`requirePartnerApiKey()`, if the pasted key is a bearer token rather than a static key) — all reads
happen inside the four already-live routes; this document's own new code (`content.ts`,
`DeveloperDocsClient.tsx`, `PlaygroundClient.tsx`, both `page.tsx` gate files) issues **zero** direct
database reads of its own beyond the existing Configurator gate's own `getPartnerAccountsForClerkUser`/
`onboarding_completed_at` check (identical to every other Configurator screen, not new).

**Written to the database:** none, by this document's own new code. The four existing routes may write
as they already do today (e.g. `sessions_create`'s `partner_sessions` insert) when actually invoked from
the Playground — this document changes none of that existing write behavior.

**APIs called:** the four existing, already-approved `/api/partner/v1/*` internal routes only — no new
external vendor call, no new Clio-owned API route (CEO brief, explicit: "No new Clio-owned API route").

**localStorage/sessionStorage:** **none.** The Playground's `apiKey` value is held in `useState` only —
never written to `localStorage` or `sessionStorage` — cleared by React's normal unmount behavior on
navigation or reload, no explicit clear logic required (Known Constraint, CEO brief; Section 4.C).

## 7. Success Criteria (Acceptance Tests)

✓ Given a Clerk-authenticated partner-admin with at least one `partner_admin_users` row and
`onboarding_completed_at IS NOT NULL`, when they load `/dashboard/configurator/developer`, then all four
`ENDPOINTS` cards and the webhook-doc card render with content matching `content.ts`'s `ENDPOINTS` array
and `WEBHOOK_DOC` constant exactly (method, path, purpose, rate limit, fields, example request/response,
response notes, other-responses table) — verified by asserting the rendered DOM text contains each
field's literal value from the constants file, not a paraphrase.

✓ Given a Clerk-authenticated partner-admin with no `partner_admin_users` row, when they load either
`/dashboard/configurator/developer` or `/dashboard/configurator/developer/playground`, then
`<NoPartnerAccounts />` renders — identical to every other Configurator screen's own empty-state gate.

✓ Given a Clerk-authenticated partner-admin whose active account has `onboarding_completed_at IS NULL`,
when they load either screen, then they are redirected to
`/dashboard/configurator/wizard?partner_account_id={id}` before either screen's own content ever renders
— proving the gate matches `app/dashboard/configurator/topics/page.tsx`'s own byte-for-byte shape.

✓ Given the Playground with a valid `test`-mode API key pasted in, when `GET /sessions/:ref` is selected,
a real `clio_session_ref` belonging to the same account is entered, and `[Send]` is clicked, then a real
`fetch()` request is made to `/api/partner/v1/sessions/{ref}` with `Authorization: Bearer <the pasted
key>`, and the rendered response matches the real API's actual `200` response body exactly — proving the
Playground calls the live API, not a mock (Questions for BA #3).

✓ Given the Playground with `POST /sessions` selected, when the screen renders, then the `[Send]` control
has no `onClick` handler wired at all (not merely `disabled={true}` on a button that would otherwise call
`handleSend()`), and `endpoint.playgroundDisabledReason`'s exact text is visible on screen — verified by
inspecting the compiled component for the absence of any click-triggered code path reachable from this
state, satisfying the CEO brief's explicit review criterion "(b) the `sessions_create` Playground control
ships genuinely disabled, with no path for a partner to trigger a real bot dispatch from this screen."

✓ Given the Playground with no API key entered, when any live-testable endpoint is selected and `[Send]`
is clicked, then `"Enter an API key first."` renders inline and **no network request is made** — verified
by asserting zero `fetch()` calls occurred for this interaction.

✓ Given the Playground with `GET /usage` selected and a malformed JSON string typed into the query-params
textarea, when `[Send]` is clicked, then `"Not valid JSON: {the actual JSON.parse error message}."`
renders inline and no network request is made.

✓ Given the Playground successfully sends a request that the real API rejects with `401 invalid_api_key`
(a genuinely wrong key), when the response arrives, then the rendered Response area shows status `401`
and the real response body verbatim — not a Playground-authored error message — proving errors are
passed through unmodified (Section 4.C.1's "renders the real API's real response verbatim" requirement).

✓ Given the Playground's `apiKey` input has a value typed into it, when the page is reloaded or the user
navigates away and back, then the field is empty — proving no persistence to `localStorage`/
`sessionStorage` occurred (Section 6, Known Constraint).

✓ Given the Documentation screen's Authentication section, when it is inspected for content, then it
describes `POST /api/partner/v1/oauth/token` as the primary mechanism (RFC 6749 §4.4 Client Credentials,
the exact request/response shape from Section 4.A's wireframe) and explicitly states the static API key
is a secondary/internal-operator recovery path — never framed as "interim, subject to change" — satisfying
the CEO brief's explicit review criterion "(a) the auth documentation correctly describes the live OAuth2
mechanism, not a stale 'interim' framing."

✓ Given the entire feature as built, when its source files are inspected, then no AI/LLM API call
(Anthropic SDK or otherwise) appears anywhere in `content.ts`, `DeveloperDocsClient.tsx`, or
`PlaygroundClient.tsx` — satisfying the CEO brief's explicit review criterion "(c) no AI-generated content
appears on either screen," and this repo's standing rule against populating undefined-content screens with
model output.

✓ Given the entire feature's `package.json` diff, when it is inspected, then no new npm dependency was
added (no Monaco, CodeMirror, Swagger UI, or JSON-editor package) — satisfying the CEO brief's explicit
review criterion "(d) no new npm dependency was introduced for the JSON editor or endpoint reference
cards."

## 8. Error States

| Failure | User-visible behavior | Clio-side behavior |
|---|---|---|
| Playground: no API key entered, `[Send]` clicked | Inline: `"Enter an API key first."` | No network request made |
| Playground: malformed JSON in the `usage` query-params textarea | Inline: `"Not valid JSON: {parse error message}."` | No network request made |
| Playground: `sessions_create` selected | `[Send]` has no `onClick` at all; `playgroundDisabledReason` text visible | No request possible from this screen under any interaction |
| Playground: real API returns `401 invalid_api_key` / `revoked_api_key` | Response area shows `401` + the real body verbatim | None — pass-through only, this document adds no interpretation layer |
| Playground: real API returns `402 trial_exhausted` (not reachable today since `sessions_create` is disabled, but structurally documented for when it is re-enabled) | Response area shows `402` + real body | None |
| Playground: real API returns `403 account_suspended` | Response area shows `403` + real body | None |
| Playground: real API returns `404 not_found` (`sessions_get`, bad or foreign ref) | Response area shows `404` + real body | None |
| Playground: real API returns `422` validation failure | Response area shows `422` + real body (plain-string `error` shape, Section 4.B.1) | None |
| Playground: real API returns `429 rate_limit_exceeded` | Response area shows `429` + real body + the `Retry-After` header value | None |
| Playground: real API returns `500` (e.g. `wallet`'s unstructured DB-failure case) | Response area shows `500` + whatever body the route returned (may be an unstructured/empty body for `wallet`, Section 4.B.4) | None |
| Playground: `fetch()` itself throws (network/CORS/offline) | `"Could not reach the API. Check your connection and try again."` | `networkError: true` internal flag, no status code shown (distinct from an HTTP error response) |
| Documentation/Playground: partner-admin has no `partner_admin_users` row | `<NoPartnerAccounts />` | No content rendered, identical to every other Configurator screen |
| Documentation/Playground: `onboarding_completed_at IS NULL` for the active account | Redirect to `/dashboard/configurator/wizard?partner_account_id={id}` | Neither screen's own content ever renders |
| Documentation/Playground: no Clerk session | Redirect to `/sign-in` | Standard Clerk middleware behavior, unchanged |

## 9. Edge Cases

- **A partner pastes a `live`-mode key into the Playground for a live-testable endpoint (`sessions_get`,
  `usage`, `wallet`)**: fully supported and not specially restricted by this document for these three
  endpoints — they are pure reads with no vendor-cost or funding implication (CEO brief: "The other three
  endpoints... are pure reads and can ship fully live with no such gate"). The only endpoint where
  live-vs-test distinction matters at all is `sessions_create`, and it is disabled entirely regardless of
  key mode.
- **A partner pastes an OAuth2 access token (a 3-segment JWT) instead of a static API key into the
  Playground's API key field**: fully supported without any Playground-side special-casing — `handleSend()`
  sends whatever string is typed as the `Bearer` value unmodified, and `requirePartnerApiKey()`'s own
  existing fallback branch (`lib/partner/auth.ts`, `looksLikeOAuthAccessToken()`) already distinguishes
  and verifies it correctly; the Playground's own code has zero awareness of which credential shape was
  pasted.
- **A partner's pasted access token has expired between page load and clicking `[Send]`**: the real API
  correctly returns `401 invalid_api_key` (Section 7's own OAuth2 acceptance parity with B2B-06's
  Section 7) — the Playground renders it as any other 401, no special "token expired" copy invented here
  since the real API itself deliberately never distinguishes this case in its response body (B2B-06
  Section 4.B.2/8).
- **A partner switches endpoints mid-flow after a response has already been shown**: the previous
  response is cleared (or left visible until the next Send completes — implementation's choice, not
  specified by any CEO brief instruction) when a new endpoint is selected; this document does not mandate
  specific state-clearing behavior on endpoint switch beyond "the input area adapts to the newly selected
  endpoint's own shape" (Section 4.C).
- **`GET /usage`'s query-params textarea is left empty and `[Send]` is clicked**: fully supported —
  `handleSend()`'s own `JSON.parse(editorValue || '{}')` defaults an empty string to `{}`, producing a
  request with no query string at all, which the real route already treats as "use all defaults" (30 days
  ago through now, all event types, first page) — no validation error for this case.
- **A partner reloads the Playground page mid-Send (network request in flight)**: the in-flight `fetch()`
  is abandoned by the page unload; no special abort-handling is specified (no CEO brief instruction names
  this), matching how no other Configurator screen in this codebase implements request cancellation on
  unload either.
- **Two different partner-admins on the same partner account use the Playground simultaneously with
  different pasted keys**: fully supported and entirely uncoordinated — the Playground has no
  server-side session state of its own; each browser tab's `apiKey` is independent client state,
  identical in shape to how two people could `curl` the same API independently today.
- **A partner-admin without a generated OAuth2 credential yet visits the Playground before visiting
  `/dashboard/configurator/integration`**: fully supported — nothing on the Playground requires a
  credential to already exist; the API key field is simply empty until the partner-admin pastes one they
  generated elsewhere (or already had). The Documentation screen's `[Generate credentials →]` link exists
  precisely to guide a partner-admin who lands here first.
- **Mobile vs. desktop**: not specified — matches every other Configurator screen's existing no-mobile-spec
  precedent (`docs/specs/B2B-06-requirement-document.md` Section 9's identical finding for
  `/dashboard/configurator/integration`, an internal-to-partner-admin operational screen).
- **The `dispatchMeetingBot()` test-mode gap is fixed in a future change**: per `architecture.md` §17.5,
  the follow-on change to this document's own code is explicitly small and pre-planned — flip
  `playgroundDisabled` to `false` for `sessions_create` in `content.ts`, and add the client-side
  test-mode-only restriction (reject a `clio_live_sk_...` key client-side for this one endpoint
  specifically) as a layered guard on top of the now-real server-side fix. This document does not build
  that follow-on change — it is out of scope (Section 10) — but names the exact edit path so a future
  developer does not have to rediscover it.

## 10. Out of Scope

Explicitly excluded, per the CEO brief's own scope boundaries plus this document's own findings:

- **Credential generation.** Issuing API keys or OAuth2 client credentials lives entirely in B2B-06's own
  Configurator screen (`/dashboard/configurator/integration`, confirmed live). This document links to
  that screen; it does not duplicate credential-generation UI of its own.
- **Fixing the `dispatchMeetingBot()` test-mode gap.** Named as a hard pre-condition on one UI control
  (Section 4.C.1/9), not resolved by this document. That fix belongs to `lib/partner/session-init.ts`
  itself, or an equivalent confirmed guard, as a separate piece of work.
- **New backend routes.** The Playground calls Clio's four existing live routes directly; no new API
  surface is built here.
- **Schema or migration changes.** None — this is a documentation and testing UI over already-live data
  and routes.
- **Domain-config endpoints on the Documentation screen.** `/api/admin/configurator/domain*` is gated by
  `requirePartnerAdmin()` (a Clerk-session check), not the partner API key — verified by direct code
  read, it is not part of the partner-API-key-authenticated surface this screen documents (Questions for
  BA #2, resolved).
- **A JSON-editor or OpenAPI-renderer package.** No Monaco, CodeMirror, Swagger UI, or equivalent — a
  plain `<textarea>` and hand-rolled endpoint cards are sufficient for a 4-endpoint surface; a dedicated
  package would be an unjustified new dependency for this scope (Questions for BA #4, resolved).
- **OAuth2 refresh-token flows, scopes, or revocation UI.** Unchanged from B2B-06's own scope — this
  document only documents and exercises the mechanism B2B-06 already built; it introduces no new
  auth-mechanism behavior of its own.
- **A rich, collapsible/tree JSON response viewer.** A pretty-printed `<pre>` block satisfies Section
  4.C's Screen state 4/5 — no interactive JSON tree widget is required or built.
- **Request cancellation / abort-on-unload for in-flight Playground sends.** Not specified by any CEO
  brief instruction; matches the rest of this codebase's own convention of not implementing this for
  other screens either.
- **CORS/proxy infrastructure for the Playground's cross-origin calls.** Not needed — the Playground
  calls Clio's own `/api/partner/v1/*` routes from a page already served by the same origin
  (`app.hello-clio.com`/`distill-peach.vercel.app`), so these are same-origin requests, not cross-origin
  ones; no new CORS configuration is introduced by this document.

## 11. Open Questions

None.

Per the reconstructed CEO brief's own "Questions for BA" section, all four questions were resolved
before original dispatch and are reproduced here (not re-litigated) so the reasoning remains visible:

1. **Should this brief block entirely on B2B-06's OAuth2 landing first?** Resolved: no, and now moot —
   B2B-06 v3 shipped (`POST /api/partner/v1/oauth/token`, confirmed present and read directly for this
   document, Section 4.B). The auth documentation describes the live OAuth2 mechanism directly, not an
   "interim" framing (Section 4.A, Section 7's acceptance test).
2. **Do domain-config endpoints belong on the Documentation screen?** Resolved: no (Section 10) —
   verified by direct code read that `/api/admin/configurator/domain*` is gated by `requirePartnerAdmin()`
   (a Clerk-session check), not the partner API key.
3. **Should the Playground hit a mocked/simulated backend or the real API?** Resolved: the real API,
   using the partner's own `test`-mode credential (Section 4.C.1) — this gives a partner real validation
   errors and real response shapes instead of a simulation that could silently drift from actual API
   behavior.
4. **Should a JSON-editor or OpenAPI-renderer package be added?** Resolved: no (Section 10) — a plain
   textarea and hand-rolled endpoint cards are sufficient for a 4-endpoint surface.

Zero open questions block this document's approval or its build.

## 12. Dependencies

- **B2B-02** (done) — `requirePartnerApiKey()` (`lib/partner/auth.ts`), the four `/api/partner/v1/*`
  routes this document documents and the Playground calls, `lib/partner/rate-limit.ts`'s
  `RateLimitClass` values — all reused unmodified, read directly for this document's own byte-accuracy
  (Section 4.B).
- **B2B-04** (done) — `GET /api/partner/v1/wallet` and its `lib/billing/metrics.ts` burn-rate/projection
  formula — documented, unmodified.
- **B2B-06** (done) — `POST /api/partner/v1/oauth/token`, `partner_oauth_clients`,
  `requirePartnerApiKey()`'s OAuth2 fallback branch, and the live `/dashboard/configurator/integration`
  screen this document's Documentation screen links to for credential generation. This was this
  document's one named phasing dependency (per B2B-06's own Section 12 closing line, "this document's
  completion removes B2B-07's one named phasing dependency") — confirmed cleared, since B2B-06 v3's
  OAuth2 mechanism is live and this document's Authentication section is written to describe it directly,
  not as an interim placeholder.
- **B2B-08** (done) — the `402 trial_exhausted` response shape documented in Section 4.B.1's
  `otherResponses` table, and the `B2B-08` trial-gate lines (`app/api/partner/v1/sessions/route.ts`,
  75–126) that this document's Section 4.C.1/9 name as the reason `sessions_create`'s Playground control
  must stay disabled — read directly, not modified.
- **`app/dashboard/configurator/topics/page.tsx`** (existing, unmodified) — the exact gate-shape template
  both this document's new `page.tsx` files copy (Section 3, Section 4.A) — confirmed byte-for-byte
  identical by direct side-by-side read as part of this reconstruction.
- **`app/dashboard/configurator/_shared.tsx`** (existing, unmodified) — `<ConfiguratorShell>`, `Card`,
  `PrimaryButton`, `SecondaryButton`, `COLORS`, `<NoPartnerAccounts />` — reused, no new design-system
  components introduced.
- **What this document unblocks**: nothing else in the current `docs/b2b-pivot-status.md` backlog names
  this brief as its own phasing dependency as of this reconstruction — this is a leaf feature in the
  current dependency graph, blocking only itself becoming buildable, not any other named brief.
