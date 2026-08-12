# B2B-79 — Inline Iframe Delivery & Mandatory Per-Sales-Partner Custom Domains
# Requirement Document
Version: 1.0
Status: APPROVED (CEO, 2026-08-11) — cleared for Dev, per the CEO→BA→Dev gate; Section 11 is empty
Author: Business Analyst Agent
Date: 2026-08-11

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-79-inline-widget-delivery-reseller-custom-domains.md`
Source brainstorm: `docs/2026-08-10-voice-language-brainstorm.md`, D15–D18.
Depends on: `docs/specs/B2B-77-requirement-document.md` (terminology), `docs/specs/B2B-78-requirement-document.md`
§4.B (this document fills the `Domain` tab that spec reserved in the shared
`/dashboard/channel-partner/developer` IA).
Prior art read in full: `docs/specs/B2B-05-requirement-document.md`, `supabase/migrations/076_b2b05_domain_whitelabel_infra.sql`,
`lib/partner/domain-settings.ts`, `lib/partner/vercel-domains.ts`, `lib/partner/domain-resolution.ts`,
`lib/partner/admin-accounts.ts`, `middleware.ts`, `next.config.mjs` (re-verified directly: no
`headers()` function, confirming D18's "no CSP/`X-Frame-Options` restriction exists today" claim).

---

## 0. Headline finding — the domain infrastructure already exists; it is simply unreachable for sales-partners

B2B-05 (shipped) already built everything D16/D17 describe as a mechanism: `partner_accounts` already
has `subdomain_slug`, `custom_domain`, `custom_domain_status`, `custom_domain_error`,
`custom_domain_verification`, `custom_domain_added_at`, `custom_domain_verified_at` (migration 076, all
already indexed/unique where needed); `lib/partner/vercel-domains.ts` already wraps the Vercel Domains API
(`addDomainToProject`/`checkDomainVerification`/`removeDomainFromProject`); `lib/partner/domain-settings.ts`
already owns the validation/DB/Vercel orchestration; `middleware.ts` already does host-header tenant
resolution against these exact columns. **None of this needs to be rebuilt.**

What's actually missing, confirmed by reading the access-control code directly: `getConfiguratorAccountsForClerkUser()`
(`lib/partner/admin-accounts.ts`, lines 71–74) **explicitly filters out every `channel_partner`-kind
account** before it ever reaches `/dashboard/configurator/*` — and `requirePartnerAdmin` (the API-level
gate behind `/api/admin/configurator/domain/*`) independently rejects a `channel_partner` account at the
same chokepoint (B2B-28's own confirmed finding). **A sales-partner today has zero path to the domain
screen or its APIs, by design, on both the UI and API sides.** This document's real job is not to invent
new domain infrastructure — it is to build the sales-partner-facing surface (UI + a new, parallel set of
API routes) that reuses the existing mechanism end to end, and to wire `bot-sessions`'s `render_url`
generation to actually use it (today, confirmed via `middleware.ts`'s own code comment, `render_url` is
"always built from `NEXT_PUBLIC_APP_URL`" — meaning **every sales-partner today gets exactly the shared
fallback domain D16 explicitly forbids**, since sales-partners have no way to set a domain at all).

---

## 1. Purpose

A client's own IT/security team must whitelist whatever domain an embedded iframe loads from. Asking them
to whitelist Clio's own shared domain — a vendor they have no direct relationship with — is a materially
harder sell than whitelisting a domain tied to the sales-partner they already have a contract with. Today,
every sales-partner's session renders on Clio's own domain regardless, because the mechanism that would
let them use their own domain exists in the codebase but is structurally unreachable to them. This
document closes that gap.

**What failure looks like without this document:** every sales-partner integration, indefinitely, ships on
`hello-clio.com`/`distill-peach.vercel.app` — the trust argument driving the entire white-label product
never becomes real, because the one piece of infrastructure it depends on was built for the wrong account
kind.

## 2. User Story

**Story 1 — Sales-partner setting up their integration**
As a sales-partner configuring my own domain,
I want to enter a subdomain I own, see the exact DNS record to add, add it myself, and click Verify,
So that my sessions render on my own domain with zero engineering help from Clio.

**Story 2 — A client's IT/security reviewer**
As the person deciding whether to whitelist an iframe source,
I want that source to be a domain visibly tied to the sales-partner we already have a contract with,
So that approving it is a normal vendor-trust decision, not a leap of faith about an unfamiliar third
party.

**Story 3 — An end_user inside the client's own page**
As someone clicking "learn with AI,"
I want the session to appear inline, on the same page, with working microphone access,
So that I never notice I've left the client's site at all.

## 3. Trigger / Entry Point

- **`GET /api/channel-partner/domain`** — page load of the new Domain tab (§4).
- **`PATCH /api/channel-partner/domain/custom-domain`** — sales-partner submits a desired domain.
- **`POST /api/channel-partner/domain/custom-domain/recheck`** — "Verify" button click.
- **`DELETE /api/channel-partner/domain/custom-domain`** — domain removal.
- All four routes: Clerk-authenticated, gated by `requireChannelPartnerAdmin()` (existing function,
  unchanged) — structurally identical to B2B-05's `/api/admin/configurator/domain/*` routes but
  swapping the gate function, exactly mirroring how B2B-78's `clients/[id]/configure/api` page already
  swaps `getConfiguratorAccountsForClerkUser` for `requireChannelPartnerClientAccess` against the same
  underlying UI component pattern.
- **Internal trigger (no user action):** `bot-sessions` (B2B-78) resolving `render_url` at session-creation
  time — reads `partner_accounts.custom_domain`/`custom_domain_status` for the authenticated sales-partner,
  described fully in §6.3.

## 4. Screen / Flow Description

This is the `Domain` tab of the shared `/dashboard/channel-partner/developer` page B2B-78 §4.B already
reserved a slot for. **Deliberately not the two-step subdomain-then-custom-domain flow B2B-05 built for
direct partners** — a sales-partner is never offered a `*.hello-clio.com` subdomain option at all, because
that subdomain is itself a Clio-owned domain the client's IT team has "no direct relationship with,"
exactly the thing D16 forecloses. Only the custom-domain path is shown, and — unlike a direct partner, for
whom it's an optional upgrade — it is **mandatory** before any `bot-sessions` call for that sales-partner
can successfully return a working `render_url` (§6.3).

**Screen state 1 — no domain configured yet**
```
┌──────────────────────────────────────────────────────────────┐
│  Developer                                                    │
│  Passcodes   API Keys   Bot Voices   [ Domain ]               │
│                                                                 │
│  Your sessions need to render on a domain you own — Clio      │
│  never serves them from a shared address. This is required    │
│  before bot-sessions will return a working render_url.         │
│                                                                 │
│  Domain                                                         │
│  [ widget.ailearn.com                                    ]    │
│  A subdomain of a domain you already own.                     │
│                                                                 │
│  [ Add domain ]                                                │
└──────────────────────────────────────────────────────────────┘
```
Text input, no default suffix (unlike the direct-partner subdomain field, this is a full domain the
sales-partner types themselves), validated client-side against the same format check
`isValidCustomDomainFormat`/`isClioOwnedDomainSpace` already enforce server-side (reject a value that is
itself `*.hello-clio.com` or one of Clio's own reserved domains — reusing those two existing functions
unchanged).

**Screen state 2 — domain added, awaiting DNS verification**
```
┌──────────────────────────────────────────────────────────────┐
│  Domain                                        ● Pending      │
│                                                                 │
│  widget.ailearn.com                                            │
│                                                                 │
│  Add this record on your own DNS provider:                    │
│                                                                 │
│  Type      Name                    Value                       │
│  CNAME     widget.ailearn.com      cname.vercel-dns.com        │
│                                                                 │
│  DNS changes can take a few minutes to a few hours to take     │
│  effect, depending on your provider.                           │
│                                                                 │
│  Last checked: just now — not yet verified.                    │
│                                                                 │
│  [ Verify ]                                    [ Remove ]      │
└──────────────────────────────────────────────────────────────┘
```
Clicking "Verify" calls the recheck endpoint synchronously (§6.2) and updates in place: button shows a
spinner labelled "Checking…" for the duration of the call, then either flips to state 3 or updates "Last
checked: just now — not yet verified." with no error styling (a not-yet-verified DNS record is an expected,
routine state, not a failure) — this mirrors B2B-05's own established non-alarming "still pending" tone.
**No attempt limit and no hard timeout** — DNS propagation genuinely can take hours depending on the
sales-partner's own provider/TTL; the sales-partner is the party motivated to fix it (they cannot go live
without it), so Clio imposes no artificial deadline on top of that.

**Screen state 3 — verified and live**
```
┌──────────────────────────────────────────────────────────────┐
│  Domain                                        ● Live         │
│                                                                 │
│  widget.ailearn.com                            [Copy] [Remove]│
│                                                                 │
│  Your sessions now render at:                                  │
│  https://widget.ailearn.com/widget-render/{session_id}         │
└──────────────────────────────────────────────────────────────┘
```
**Screen state 4 — verification failed (Vercel reports a real failure, not just "still pending")**
```
┌──────────────────────────────────────────────────────────────┐
│  Domain                                        ● Failed       │
│                                                                 │
│  widget.ailearn.com                                            │
│  Vercel could not verify this domain: <exact upstream reason>. │
│                                                                 │
│  Add this record on your own DNS provider:                    │
│  Type      Name                    Value                       │
│  CNAME     widget.ailearn.com      cname.vercel-dns.com        │
│                                                                 │
│  [ Verify ]                                    [ Remove ]      │
└──────────────────────────────────────────────────────────────┘
```
Reuses `custom_domain_error`'s existing stored message verbatim (already populated by B2B-05's own
`checkDomainVerification` error path) — no new error-message design needed.

**Removing a domain** — no confirm dialog (existing convention), but with an explicit inline warning
appended to the remove action's own description text, not a blocking modal: *"Removing this domain will
break any session links already issued on it. This cannot be undone."* This is a genuinely consequential,
irreversible action (§9), but this codebase has no existing confirm-dialog pattern to reuse, and inventing
a new interaction paradigm for one screen risks inconsistency more than it buys safety — the warning text
itself is the mitigation.

## 5. Visual Examples

All four states are given as literal wireframes in §4 above, per this project's standard.

## 6. Data Requirements

### 6.1 Domain table/schema (Brief §6 Q1)

**No new columns.** `partner_accounts.custom_domain`/`custom_domain_status`/`custom_domain_error`/
`custom_domain_verification`/`custom_domain_added_at`/`custom_domain_verified_at` (migration 076) already
capture exactly what was asked for: verification status (`custom_domain_status`, enum `none` /
`pending_verification` / `verified` / `failed`), the DNS-record detail to show (`custom_domain_verification`
JSONB), and timestamps for the two real state transitions (`custom_domain_added_at`,
`custom_domain_verified_at`). Cert issuance has no separate tracked state because Vercel auto-issues the
certificate the moment DNS verification succeeds — `custom_domain_status = 'verified'` already means
"DNS confirmed and TLS is live," confirmed by reading `checkDomainVerification`'s own return shape
(`{ verified: boolean }`, no separate cert field) — there is nothing else to track. **Foreign key
confirmation, per the Brief's explicit instruction to check against B2B-77 before finalizing:** the row
being updated is `partner_accounts` where `account_kind = 'channel_partner'` (B2B-77 §6.1's terminology
table) — the exact same table and column set a direct partner (`account_kind = 'partner'`) already uses,
differentiated only by which account_kind is doing the writing and which auth gate fronts it (§6.2). No
new table, no new foreign key.

**Uniqueness, already enforced:** `idx_partner_accounts_custom_domain` (migration 076) is already a unique
index — a second sales-partner attempting to register a domain already in use by any other account
(direct partner or sales-partner) fails at the DB layer today; `domain-settings.ts` must surface this as
the same clean `domain_already_in_use` error B2B-05 already returns for a direct partner's conflicting
attempt (Brief §6 Q4's third bullet — resolved, not new work, just confirmed the existing check applies
identically to a sales-partner caller).

### 6.2 New sales-partner-facing routes, reusing existing business logic unchanged

```
GET    /api/channel-partner/domain                       — read current settings
PATCH  /api/channel-partner/domain/custom-domain          — add/replace
POST   /api/channel-partner/domain/custom-domain/recheck  — poll verification
DELETE /api/channel-partner/domain/custom-domain          — remove
```
Each is a thin wrapper: swap `requirePartnerAdmin`/`getConfiguratorAccountsForClerkUser` for
`requireChannelPartnerAdmin()` (existing, unchanged), then call straight into the existing
`lib/partner/domain-settings.ts` functions (`getDomainSettings`, `setCustomDomain`, `recheckCustomDomain`,
`removeCustomDomain` — exact names to be confirmed against the live file by Dev, not re-derived here since
this document's job is the contract, not the internal function signatures) with the resolved
`channelPartnerAccountId` in place of whatever id the Configurator routes pass today. **Zero new domain
logic, zero new Vercel calls** — this is purely a second, parallel authorization front door onto
infrastructure that already works.

**Polling mechanism (Brief §6 Q3): synchronous check-on-click, not a background job.** Reasoning: this
mirrors B2B-05's own existing direct-partner "Verify" button exactly (confirmed by reading its spec,
§4.A) — a single Vercel API round-trip, typically sub-second, with no indication anywhere in the existing
implementation that this needed to be a background job for direct partners. Introducing a different
mechanism (polling job + WebSocket/SSE push, or client-side poll loop) for the sales-partner version of
the identical underlying check would be inconsistent for no benefit — same expected latency, same
UI-blocking-spinner treatment, same result.

### 6.3 `render_url` domain resolution (the actual behavioral change this brief makes)

`bot-sessions` (B2B-78) and, per this document's recommendation below, `widget-sessions`/`sessions` when
called by a `channel_partner`-authenticated caller, must resolve the response's `render_url` host as
follows, replacing today's unconditional `NEXT_PUBLIC_APP_URL`:

1. If `auth.accountKind === 'channel_partner'`: read that account's own `custom_domain`/
   `custom_domain_status`. If `custom_domain_status !== 'verified'`, **reject the call outright** — 422
   `{ error: { code: "domain_not_configured", message: "Configure and verify a custom domain in Developer
   settings > Domain before creating sessions." } }`. If verified, `render_url` is built as
   `https://{custom_domain}/widget-render/{session_id}`.
2. If `auth.accountKind === 'partner'` (a direct partner): unchanged — continues resolving against
   `NEXT_PUBLIC_APP_URL` today, or the direct partner's own configured domain if B2B-05's mechanism
   already threads that through for meeting-bot/widget render URLs (out of scope to verify/change here —
   direct-partner render-url resolution is untouched by this brief).

**Recommendation, stated explicitly since it has real rollout impact:** this document recommends the
`domain_not_configured` gate apply to **every** endpoint that can produce a `channel_partner`'s
`render_url`, not just the new `bot-sessions` — including the existing `widget-sessions`. Reasoning: C1's
own wording ("no exceptions, no shared fallback offered") describes a requirement on the sales-partner
relationship, not a requirement scoped to one endpoint; leaving `widget-sessions` exempt would let any
sales-partner simply keep calling the older endpoint to avoid ever configuring a domain, defeating the
entire trust argument this brief exists to satisfy. This costs nothing today — zero real sales-partner
accounts currently have a verified domain (the feature didn't exist to set one), so there is no live
integration this newly breaks; it only prevents one from ever starting without a domain, which is exactly
the intended behavior.

**Middleware activation:** `middleware.ts`'s `TENANT_SCOPED_PATTERNS` already lists `/widget-render/.+`
as a dormant entry, its own comment explaining it's inert only because render URLs are "always built from
`NEXT_PUBLIC_APP_URL` today." Once §6.3 point 1 ships, that comment becomes stale and should be updated
(not removed — the pattern itself already correctly routes a request arriving on any verified tenant host
to the same underlying session logic via `resolveTenantFromHost`, unchanged) to reflect that widget-render
URLs are now genuinely served from partner-owned hosts in production, not only in the dormant/defensive
sense the comment currently describes.

## 7. Success Criteria (Acceptance Tests)

✓ Given a sales-partner with no domain configured, when they call `bot-sessions`, then the response is 422
`domain_not_configured`, not a session created against `NEXT_PUBLIC_APP_URL`.

✓ Given a sales-partner who enters `widget.ailearn.com`, when they view the Domain tab, then they see the
exact CNAME record to add, matching the value `lib/partner/vercel-domains.ts` returns.

✓ Given a sales-partner whose DNS has propagated correctly, when they click "Verify," then
`custom_domain_status` becomes `'verified'`, `custom_domain_verified_at` is set, and the screen shows
state 3 with the live `render_url` domain.

✓ Given a verified sales-partner domain, when `bot-sessions` is called successfully, then the returned
`render_url`'s host is that sales-partner's own `custom_domain`, never `NEXT_PUBLIC_APP_URL`.

✓ Given a second sales-partner attempting to register a domain already verified for a different account,
when they submit it, then they receive `domain_already_in_use`, not a silent overwrite.

✓ Given a throwaway HTML file on a different origin embedding a real, live `render_url` in an
`<iframe allow="microphone">`, when a live voice session is started inside it, then both microphone
permission is granted and the WebRTC voice connection functions correctly — run and recorded as a
standalone pass/fail test (§9) before any real sales-partner domain exists.

## 8. Error States

| Failure | Response / UI |
|---|---|
| Malformed domain (fails format check) | Inline validation error below the input, "Add domain" disabled |
| Domain is itself `*.hello-clio.com` or another Clio-reserved space | Inline error: "This domain is reserved." |
| Domain already in use by another account | Inline error: "This domain is already registered to another account." |
| Vercel API call fails transiently | `custom_domain_error` populated, screen state 4, "Verify" remains clickable to retry |
| `bot-sessions`/`widget-sessions` called with no verified domain (channel_partner) | 422 `domain_not_configured` (§6.3) |
| Verify clicked while a request is already in flight | Button disabled for the duration (standard loading-state discipline), no double-submit |

## 9. Edge Cases

- **Sales-partner enters a domain they don't control; DNS never resolves.** No hard timeout (§4) — it sits
  in `pending_verification` indefinitely. This is a deliberate design choice, not an oversight: an
  unverified domain blocks only that sales-partner's own ability to go live, imposing no cost on Clio or
  any other account, so there is nothing to protect against by forcing an expiry.
- **Sales-partner changes domains after already going live.** Supported via remove-then-add (§4's Remove
  action, then Screen state 1 again for the new domain) — there is only one `custom_domain` slot per
  account (the existing single-column schema, unchanged). **Already-issued `render_url`s referencing the
  old domain break the moment it's removed** — the warning copy in §4 states this plainly; this document
  does not build any grace-period or dual-domain-serving mechanism, since B2B-78's reservations are
  already short-lived (15 minutes) and completed sessions' `render_url`s are not expected to be reused
  after the session ends, bounding the real-world blast radius of a domain change to whatever sessions are
  actively in-flight at the moment of removal.
- **The D18 iframe/mic/WebRTC test (Brief §6 Q5) — who runs it, when, what "pass" means.** Per the Feature
  Brief's own sequencing note, this needs only an already-working `render_url` from today's
  `widget-sessions` flow, not this brief's new pipeline — it can and should run **before** any of this
  brief's domain UI is built, as a fast, low-risk de-risking step. **Exact procedure and pass bar,
  specified so it isn't re-litigated informally later:**
  1. Take a real, live `render_url` from an existing `widget-sessions` call.
  2. Serve one throwaway HTML file, `<iframe src="{render_url}" allow="microphone" style="width:100%;
     height:600px;border:0"></iframe>`, from any origin genuinely different from the app's own (a
     different local port is sufficient — the only requirement is a different origin).
  3. **Pass bar, microphone check:** opening the browser's own permission indicator confirms the mic
     permission prompt is scoped to the iframe's embedded origin and, once granted, remains granted for
     the session's duration with no silent denial — recorded as a simple pass/fail with a screenshot of the
     permission-granted state.
  4. **Pass bar, WebRTC check:** the voice session inside the iframe completes a real, audible round-trip
     (the tester speaks, Clio responds) — recorded as pass/fail, with the specific voice provider tested
     (ElevenLabs, per the widget channel's current default) noted, since this is a provider-specific
     transport concern, not a generic "iframes work" claim.
  5. **Who runs it:** any engineer with access to a real `render_url`, before this brief's Dev phase
     begins — this is explicitly not gated on Arun's own involvement, since it's a technical
     pass/fail check with no product-shape ambiguity.
  Result (pass/fail plus what was checked) should be recorded in `BACKLOG.md` or this brief's own build
  notes once run, per the Feature Brief's instruction that this "isn't re-litigated informally later."
- **The meeting-bot (`partner-render`) channel's own domain handling** — confirmed, not assumed: reading
  `middleware.ts`'s `TENANT_SCOPED_PATTERNS`, `/partner-render/.+` is already listed there for the exact
  same dormant reason as `/widget-render/.+` (its own render URLs are also always built from
  `NEXT_PUBLIC_APP_URL` today). This brief does **not** extend the domain-mandatory gate to that channel —
  out of scope per the Feature Brief's own boundary — but notes for the record that the identical
  mechanism would apply cleanly there too, if a future brief decides to extend it.

## 10. Out of Scope

- Domain purchase or ownership transfer of any kind (unchanged from B2B-05's own established boundary).
- Any relaxation of CSP/frame posture beyond what's needed — none is needed today (re-confirmed, §0/D18);
  this brief adds no new header configuration at all.
- Any change to direct-partner domain handling (`account_kind = 'partner'`) — B2B-05's existing subdomain
  + optional-custom-domain flow for direct partners is completely untouched.
- The meeting-bot/`partner-render` channel's own domain handling (§9's last point) — confirmed dormant,
  not extended here.
- Any new confirm-dialog UI pattern — the domain-removal warning (§4) uses inline text, not a new modal
  paradigm.

## 11. Open Questions

None. Every question in the Feature Brief's §6 is resolved above: Q1 (§6.1 — no new schema, existing
columns already sufficient), Q2 (§4 — full wireframe-level detail for all four states), Q3 (§6.2 —
synchronous, mirroring the existing direct-partner mechanism), Q4 (§8/§9 — every named failure/edge case
specified), Q5 (§9 — exact D18 test procedure with a stated pass bar), Q6 (§4/B2B-78 §4.B — one shared
`Developer` settings area, `Domain` as one of its four tabs).

## 12. Dependencies

- B2B-05 (fully shipped) — this document's entire mechanism is reused from it unchanged; nothing here
  builds new domain infrastructure.
- B2B-77 — terminology (`channel_partner` = sales-partner) and the confirmation that a sales-partner's own
  account row is the correct target for `custom_domain`, not a new entity.
- B2B-78 — the `render_url` field this document's §6.3 resolution serves, and the shared
  `/dashboard/channel-partner/developer` dashboard shell whose `Domain` tab this document fully specifies.
- The D18 test (§9) has no dependency on any of this brief's own build work landing first — it can run
  immediately, against today's live `widget-sessions`.
