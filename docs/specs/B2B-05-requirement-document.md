# B2B-05 — Domain / White-label Infrastructure
# Requirement Document

Version: 1.2
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-13

Changelog: v1.2 — closed one CEO-review precision gap in Section 13, a confirmed technical (not product)
correction within BA authority: §13.4.A's "Embedding mechanism" paragraph stated every one of the 4
pre-existing B2B-03 components being wrapped has "exactly one wrapped return," and specified a single
`if (embedded) return <>{content}</>` insertion accordingly. Checked against the live files, this is true
for `TopicsConfigClient.tsx` and `VisualizationClient.tsx` but false for `QuestionnaireBuilderClient.tsx`
(two separately-wrapped `<ConfiguratorShell>` returns: the edit-mode branch and the list-mode branch) and
`ContentConfigClient.tsx` (two separately-wrapped returns: the review-mode branch and the default/list
branch). §13.4.A now states the correct per-component mechanics for all 5 embedded components, specifying
that the two two-return components get the `embedded` check inserted at each return site independently
(not a single merged check), and why. `architecture.md` §14.7.5 carries the matching correction with the
full per-branch code shape. Section 11 and Section 13.13 remain empty — this was a technical
implementation-instruction fix, not a product-shape question, so no new open question was raised. No other
part of this document changed: the wallet-reuse-for-Payment step, the schema, the API contracts, the
7-step scope, save-and-resume, non-blocking domain verification, and the Go-live mechanism are all
unchanged from v1.1.

Changelog: v1.1 — Arun directly confirmed (his exact words: "Build it now") the onboarding wizard
originally scoped out of v1.0 below (see the Scope Note, now superseded). Section 13 (new) specifies the
wizard: 7-step guided flow (Questionnaire → Topics → Content → Visualization → Domain → Payment method →
Go-live), sequencing this document's own Domain screen and B2B-03/B2B-04's existing Configurator screens
into one linear first-run experience, per `docs/brainstorm-b2b-platform-pivot.md` §7.6. Sections 1–12
(v1.0) are otherwise unchanged. `architecture.md` §14.7 (new) is the companion schema/route detail.

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-05-domain-whitelabel-infra.md`
Authoritative source material (all read in full): the Feature Brief above, `middleware.ts` (current
Clerk-gate implementation), `docs/specs/B2B-02-requirement-document.md` and its companion
`architecture.md` Sections 1–11, `docs/specs/B2B-03-requirement-document.md` (Out-of-Scope section,
lines ~1003–1016, which names this brief by name) and its companion `architecture.md` Section 12,
`docs/specs/B2B-04-requirement-document.md` (format/rigor precedent), `supabase/migrations/
071_b2b02_partner_accounts_and_api_keys.sql` (live `partner_accounts` schema), `docs/b2b-pivot-status.md`,
the live code in `app/dashboard/configurator/{page.tsx,_shared.tsx,HomeClient.tsx,topics/*}`,
`lib/partner/{auth.ts,admin-accounts.ts,theme.ts}`, `app/api/admin/configurator/topics-config/route.ts`,
`app/api/admin/partner-accounts/[id]/outbound-config/route.ts`, `app/partner-render/[clio_session_ref]/
page.tsx`, `app/partner-questionnaire/[partner_account_id]/page.tsx`.

Companion artifact produced alongside this document: `architecture.md` §14 (exact schema, route map,
middleware logic, and Vercel API sequence a developer implements against).

---

## Scope Note (per the Orchestrator's explicit instruction) — SUPERSEDED by v1.1, see Section 13

**v1.1 update:** the exclusion below described the state of this document as of v1.0 (2026-07-13,
morning). Arun has since directly confirmed the wizard is in scope, with an explicit instruction to build
it now, not as a fast-follow. The paragraph immediately below is kept verbatim for the historical record
of *why* it was excluded at the time (the Feature Brief genuinely left it as Arun's call) — it no longer
describes this document's actual scope. Section 13 is the wizard's full specification; Sections 1–12 are
unchanged and stand on their own exactly as they did in v1.0.

~~The onboarding wizard (Questionnaire → Topics → Content → Visualization → Domain → Payment → Go-live)
named in `docs/brainstorm-b2b-platform-pivot.md` §7.6 is **explicitly excluded** from this document. It
is a genuine, unresolved product-shape question the Feature Brief itself declines to answer ("Arun's
call, not mine") and is not spec'd, referenced as in-scope, or scaffolded with placeholder screens
anywhere below. Every deliverable in this document stands independently of whatever is decided about
the wizard — see Section 10 for the explicit boundary and Section 12 for why nothing here depends on it.~~

This document's original (v1.0), still-valid scope is the four items the Feature Brief approved for BA
dispatch:

1. Subdomain-first hosting (Configurator-driven slug picker, live instantly on Clio's wildcard domain).
2. Custom domain as an upgrade path (Vercel Domains API registration, CNAME/TXT display, auto-SSL).
3. Host-header tenant resolution at the edge (`middleware.ts`, additive to the existing Clerk gate).
4. A Configurator domain-settings screen, following B2B-03's established screen pattern.

v1.1 adds a fifth item, specified in full in Section 13:

5. The onboarding wizard shell — a guided-flow surface that sequences items 1–4's Domain screen plus
   B2B-03's Questionnaire/Topics/Content/Visualization screens plus B2B-04's payment-method flows into one
   linear first-run experience, with save-and-resume and a non-blocking domain-verification step.

---

## Template Adaptation Note

Like B2B-02 and B2B-04, this brief is primarily an infrastructure mechanism (schema, middleware,
outbound calls to Vercel) plus **one** real Clio-hosted UI screen — it is not a screen-by-screen
consumer feature. Sections are kept in standard order/numbering to match every other spec in
`docs/specs/`, adapted as follows:

- **Section 4** covers both the one real screen (states, exact copy, exact fields) and the API contracts
  (request/response shapes, exact field names/types), per the "do NOT say 'a form'" discipline applied
  to JSON bodies as well as form fields.
- **Section 5** gives literal wireframes for the screen's states, plus text sequence flows for the
  mechanisms (subdomain claim, custom-domain add, verification poll, removal, Host-header resolution).
- All other sections apply directly.

For exact schema DDL, exact Vercel API request/response shapes, and the exact middleware logic a
developer implements against, this document defers to `architecture.md` §14 rather than duplicating it.

---

## 1. Purpose

Today, both public end-user-facing surfaces B2B-03 built — `/partner-questionnaire/[partner_account_id]`
and `/partner-render/[clio_session_ref]` — are reachable only as Clio-domain paths bearing a raw UUID.
`middleware.ts` has zero `Host`-header logic, and `partner_accounts` has no `subdomain_slug` or
`custom_domain` column. This directly contradicts a requirement Arun stated in his own words (brainstorm
§1.2): a Type 2 partner's end users should have "no awareness that Clio exists." An employee at a
partner's downstream sub-tenant filling out the pre-session questionnaire today sees Clio's own
production domain and a UUID in their browser's address bar — the opposite of white-label.

`docs/specs/B2B-03-requirement-document.md`'s own Out-of-Scope section (lines ~1009–1016) named this gap
explicitly and handed it to this brief by name — this is not ambiguity this document is inventing; it is
a confirmed, unbuilt dependency every prior brief in the pivot sequence deferred here.

**What failure looks like without this document:** a Type 2 (no-platform) partner cannot go live in any
form that satisfies their own white-label requirement — every session and questionnaire link they'd share
with their own end users would visibly say "this is powered by a third party," permanently blocking the
core value proposition of that partner archetype (brainstorm §1.2, §1.3).

## 2. User Story

Like B2B-02/04, this is infrastructure-plus-one-screen, not an individual end-user-facing feature in the
traditional sense — except that its correctness is directly, visibly observable by a partner's own end
users (the audience with the least tolerance for anything going wrong, since they have no relationship
with Clio at all).

**Story 1 — Partner-admin human (No-Platform partner, e.g. Capgemini)**
As the person setting up my company's Clio integration from the Configurator,
I want to pick a subdomain and be live immediately, and optionally add my own domain later without
waiting on an engineer,
So that my end users only ever see my own brand, never Clio's.

**Story 2 — A downstream sub-tenant's employee (e.g. Hartford, via Capgemini)**
As an end user who has never heard of Clio,
I want the questionnaire link Capgemini sends me to load under Capgemini's own domain, with no visible
UUID and no third-party branding anywhere,
So that the experience feels like it's genuinely Capgemini's own product.

**Story 3 — Clio's own edge/runtime (the middleware itself)**
As the code that resolves every incoming request before any page renders,
I want to read the `Host` header, resolve it to the owning partner account (or determine it isn't a
partner domain at all), and never let one partner's domain configuration expose another partner's
content,
So that multi-tenant isolation — the same hard requirement Arun set for B2B-03 — holds identically here.

**Story 4 — Arun / Clio ops**
As the person accountable for Clio's infrastructure,
I want the wildcard root domain to be a single configuration value, not hardcoded anywhere,
So that `INFRA-07`'s still-in-progress final brand/domain decision doesn't require rework of this
mechanism once it lands.

## 3. Trigger / Entry Point

Several independent trigger points, exact per the API-contract discipline (full detail in
`architecture.md` §14):

- **Subdomain claim**: `PATCH /api/admin/configurator/domain/subdomain`, Clerk-authenticated
  partner-admin, state required: a `partner_admin_users` row for the target `partner_account_id` (same
  authorization pattern as every other `/api/admin/configurator/*` route).
- **Slug availability check**: `GET /api/admin/configurator/domain/check-slug`, same auth.
- **Custom domain registration**: `POST /api/admin/configurator/domain/custom-domain`, same auth.
- **Custom domain verification recheck**: `POST /api/admin/configurator/domain/custom-domain/recheck`,
  same auth.
- **Custom domain removal**: `DELETE /api/admin/configurator/domain/custom-domain`, same auth.
- **Domain settings read**: `GET /api/admin/configurator/domain`, same auth. Page load of
  `/dashboard/configurator/domain` triggers this.
- **Host-header tenant resolution**: triggered internally, on every incoming request, by `middleware.ts`
  — not a user-facing trigger. Applies only to requests whose resolved pathname is `/`, `/questionnaire`,
  `/partner-questionnaire/(.*)`, or `/partner-render/(.*)` (Section 6). Never applies to `/dashboard/*`,
  `/api/admin/*`, `/sign-in`, `/sign-up`, or any other Clerk-protected or Clio-branded route — those are
  explicitly excluded from Host resolution regardless of what domain the request arrives on (Section 6).

## 4. Screen / Flow Description

### 4.A `/dashboard/configurator/domain` — the one real screen this brief builds

**Layout**: follows the existing Configurator pattern exactly (`app/dashboard/configurator/topics/
{page.tsx,TopicsConfigClient.tsx}` is the literal template) — server component does the Clerk
`auth()` gate + `redirect('/sign-in')` if absent, calls `getPartnerAccountsForClerkUser(userId)`, renders
`<NoPartnerAccounts />` if empty, else resolves `activePartnerAccountId` from `?partner_account_id=`
(defaulting to the first account) and renders a client component (`DomainConfigClient`) wrapped in the
existing `<ConfiguratorShell>` from `_shared.tsx`, using the existing `COLORS`/`Card`/`PrimaryButton`/
`SecondaryButton` exports unmodified — no new design system invented, per `CLAUDE.md`'s instruction to
follow an established visual precedent rather than invent one when one already exists (it does, this
exact screen family).

`app/dashboard/configurator/HomeClient.tsx` gets one additional `DomainCard` in its 3-column grid
(alongside Questionnaire/Topics/Content), linking to `/dashboard/configurator/domain?partner_account_id=
{activePartnerAccountId}`, showing status text `"{subdomain}.{root domain}"` once a slug is set, or
`"Not configured"` if not. This is the same `DomainCard` component pattern already used for the other
three, not a new component.

**Screen state 1 — no subdomain claimed yet (first visit)**

```
┌─────────────────────────────────────────────────────┐
│  Clio Configurator            Domain      [Acme Co ▾]│
│  ← Back                                               │
│                                                        │
│  Domain                                               │
│                                                        │
│  ┌───────────────────────────────────────────────┐   │
│  │ Your Clio subdomain                            │   │
│  │                                                 │   │
│  │  [ acme-co        ] . hello-clio.com           │   │
│  │  Lowercase letters, numbers, and hyphens only. │   │
│  │  3–63 characters.                              │   │
│  │                                                 │   │
│  │  [ Save subdomain ]                            │   │
│  └───────────────────────────────────────────────┘   │
│                                                        │
│  ┌───────────────────────────────────────────────┐   │
│  │ Custom domain                                  │   │
│  │ Add your own domain once your subdomain is set.│   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

Text input labelled "Your subdomain", pre-filled with an auto-suggested slug derived from
`partner_accounts.name` (lowercased, non-alphanumeric stripped to hyphens, truncated to 63 chars) but
fully editable — not locked, since the account name and desired slug may legitimately differ. A static,
non-editable suffix `.{root_domain}` (from the API response's `root_domain` field, e.g.
`.hello-clio.com`) is shown immediately to the right of the input, not editable, not part of the input's
own value. Helper text below the input, exact copy: `"Lowercase letters, numbers, and hyphens only. 3–63
characters."` As the partner types (debounced 400ms), a live-availability check runs
(`GET .../check-slug`); if unavailable, helper text below the input is replaced with one of:
- `"This subdomain is already taken."` (slug in use by another partner)
- `"This subdomain is reserved."` (on the reserved-word list, Section 6)
- `"Only lowercase letters, numbers, and hyphens, 3–63 characters."` (fails format validation)
in red (`COLORS.red`), and the "Save subdomain" button is disabled. If available, helper text reverts to
the default gray copy and the button is enabled. The custom-domain card below is present but visually
muted (not disabled, just lower-emphasis — matches this codebase's existing convention of showing
what's-next rather than hiding it) with the copy: `"Add your own domain once your subdomain is set."`

**Screen state 2 — subdomain claimed, no custom domain**

```
┌─────────────────────────────────────────────────────┐
│  Domain                                               │
│                                                        │
│  ┌───────────────────────────────────────────────┐   │
│  │ Your Clio subdomain                    ● Live  │   │
│  │                                                 │   │
│  │  acme-co.hello-clio.com          [Copy] [Edit] │   │
│  └───────────────────────────────────────────────┘   │
│                                                        │
│  ┌───────────────────────────────────────────────┐   │
│  │ Custom domain                                  │   │
│  │ Use your own domain instead of the subdomain   │   │
│  │ above. Your subdomain keeps working either way.│   │
│  │                                                 │   │
│  │  [ learning.acme.com                    ]      │   │
│  │  [ Add domain ]                                │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

A green dot + `"Live"` badge (`COLORS.green`) confirms the subdomain is active. `[Copy]` copies the full
URL (`https://acme-co.hello-clio.com`) to the clipboard, briefly changing its own label to `"Copied"` for
1.5s. `[Edit]` reverts the card to Screen state 1's editable input, pre-filled with the current slug.
Custom domain card: text input labelled implicitly by its own placeholder `"learning.acme.com"`, helper
copy exact: `"Use your own domain instead of the subdomain above. Your subdomain keeps working either
way."` — stating explicitly that adding a custom domain is additive, never a replacement (Section 9).

**Screen state 3 — custom domain: `pending_verification`**

```
┌───────────────────────────────────────────────┐
│ Custom domain                    ● Pending    │
│                                                │
│  learning.acme.com                            │
│                                                │
│  Add this DNS record at your domain registrar:│
│                                                │
│  Type    Name         Value                   │
│  CNAME   learning     cname.vercel-dns.com    │
│                                                │
│  [ Recheck verification ]   [ Remove domain ] │
│                                                │
│  DNS changes can take up to 48 hours to       │
│  propagate.                                   │
└───────────────────────────────────────────────┘
```

Amber dot + `"Pending"` badge (`COLORS.amber`). The DNS record table renders exactly what Vercel's
domain-registration response returned (`architecture.md` §14.3) — Clio never computes or invents a
record value itself, it displays Vercel's own `verification` array verbatim (one row per entry; an apex
domain may return an `A`/`ALIAS` row instead of `CNAME` — the table renders whatever type Vercel
returned). Helper copy below the table, exact: `"DNS changes can take up to 48 hours to propagate."`
`[Recheck verification]` calls the recheck endpoint and re-renders the card in its current (possibly now
`verified` or still `pending_verification`) state — no page reload. `[Remove domain]` is a two-step
inline confirm: first click changes its own label to `"Click again to remove"` (still same button,
`COLORS.red` border) for 5 seconds, reverting to `"Remove domain"` if not clicked again in that window;
second click within the window executes the removal call.

**Screen state 4 — custom domain: `verified`**

```
┌───────────────────────────────────────────────┐
│ Custom domain                    ● Verified   │
│                                                │
│  learning.acme.com              [Copy]        │
│                                                │
│  [ Remove domain ]                            │
└───────────────────────────────────────────────┘
```

Green dot + `"Verified"` badge. `[Copy]` copies `https://learning.acme.com`. No DNS table (nothing left
to configure). `[Remove domain]` same two-step confirm as state 3.

**Screen state 5 — custom domain: `failed`**

```
┌───────────────────────────────────────────────┐
│ Custom domain                     ● Failed    │
│                                                │
│  learning.acme.com                            │
│                                                │
│  Couldn't add this domain: Domain is already  │
│  in use by a different project.               │
│                                                │
│  [ Try a different domain ]                   │
└───────────────────────────────────────────────┘
```

Red dot + `"Failed"` badge. The message line is exact: `"Couldn't add this domain: "` followed by
`custom_domain_error` verbatim (Vercel's own returned error message, never a Clio-invented string —
Section 6). `[Try a different domain]` clears the failed state and reverts the card to Screen state 2's
empty custom-domain input (pre-filled with nothing), letting the partner retype and resubmit.

**Screen state 6 — loading**

While `GET /api/admin/configurator/domain` is in flight: both cards render with a single centered line of
placeholder text `"Loading domain settings…"` in place of their normal content. No partial/flickering
render of stale data — matches the `/dashboard/admin/clients` loading-state convention
(`docs/specs/B2B-04-requirement-document.md` Section 4.A, Screen state 2) applied here.

**Screen state 7 — error (the data fetch itself failed)**

Both cards render a single centered line: `"Couldn't load domain settings. Try refreshing the page."` —
no partial data shown, no invented values. Same convention as B2B-04's Screen state 4.

### 4.B API Contracts

#### 4.B.1 `GET /api/admin/configurator/domain` (Clerk-authenticated, backs 4.A)

**Query params:** `partner_account_id` (required, uuid)

**Response — 200:**
```
{
  "root_domain": "hello-clio.com",
  "subdomain_slug": "acme-co" | null,
  "subdomain_url": "https://acme-co.hello-clio.com" | null,
  "custom_domain": "learning.acme.com" | null,
  "custom_domain_status": "none" | "pending_verification" | "verified" | "failed",
  "custom_domain_error": "Domain is already in use by a different project." | null,
  "custom_domain_verification": [
    { "type": "CNAME", "domain": "learning.acme.com", "value": "cname.vercel-dns.com", "reason": "CNAME Record" }
  ] | null,
  "custom_domain_url": "https://learning.acme.com" | null
}
```
`custom_domain_verification` is non-null only while `custom_domain_status = 'pending_verification'` —
`architecture.md` §14.3 details exactly when each field clears. `subdomain_url`/`custom_domain_url` are
derived, display-ready values (never require the frontend to string-concatenate `root_domain` itself).

**Response — 403:** caller has no `partner_admin_users` row for the target account (identical pattern to
every other `/api/admin/configurator/*` route, `requirePartnerAdmin`, unmodified).
**Response — 400:** missing `partner_account_id`.

#### 4.B.2 `GET /api/admin/configurator/domain/check-slug` (Clerk-authenticated)

**Query params:** `partner_account_id` (required, uuid), `slug` (required, string)

**Response — 200:**
```
{ "available": true } 
```
or
```
{ "available": false, "reason": "taken" | "reserved" | "invalid_format" }
```
Never errors on an unavailable slug — unavailability is a normal `200` outcome, not a `4xx` (Section 8).
A slug identical to the account's own already-claimed slug returns `{ "available": true }` (checking
your own current slug is not a conflict — Section 9).

#### 4.B.3 `PATCH /api/admin/configurator/domain/subdomain` (Clerk-authenticated)

**Request body:** `{ "partner_account_id": "uuid", "subdomain_slug": "string" }`
Validation: lowercase `a-z0-9-`, 3–63 chars, not starting/ending with `-`, not on the reserved list
(`architecture.md` §14.2), not already claimed by a different `partner_account_id` (re-validated
server-side even though the UI already checked — never trust a client-side-only check for a uniqueness
constraint).

**Response — 200:** `{ "subdomain_slug": "acme-co", "subdomain_url": "https://acme-co.hello-clio.com" }`
**Response — 409:** `{ "error": { "code": "slug_taken" | "slug_reserved", "message": "..." } }` — slug
became unavailable between the check and the save (race condition, Section 9).
**Response — 422:** format validation failure, field-level Zod error.
**Response — 403:** same pattern as 4.B.1.

#### 4.B.4 `POST /api/admin/configurator/domain/custom-domain` (Clerk-authenticated)

**Request body:** `{ "partner_account_id": "uuid", "custom_domain": "string" }`
Validation: a syntactically valid hostname (Zod, lowercase, no protocol, no path, no port, no trailing
dot); not already set as this or any other partner's `custom_domain`; not equal to `root_domain` or any
`*.{root_domain}` value (a partner cannot register Clio's own domain space as their "custom" domain).

**Response — 201 (registration accepted, now pending):**
```
{ "custom_domain": "learning.acme.com", "custom_domain_status": "pending_verification", "custom_domain_verification": [ { "type": "CNAME", "domain": "learning.acme.com", "value": "cname.vercel-dns.com", "reason": "CNAME Record" } ] }
```
**Response — 201 (registration accepted, already verified — rare but possible if Vercel recognizes
existing valid DNS immediately):**
```
{ "custom_domain": "learning.acme.com", "custom_domain_status": "verified", "custom_domain_verification": null }
```
**Response — 422 (Vercel rejected the domain synchronously):**
```
{ "custom_domain_status": "failed", "custom_domain_error": "Domain is already in use by a different project." }
```
This is a `422`, not a `500` — Clio's own request was well-formed; the failure is a real, expected,
partner-actionable outcome (Section 8), and the `partner_accounts` row is updated to `custom_domain_status
= 'failed'` with the domain and error message both persisted, so the screen shows Screen state 5 on the
next load even without keeping the response payload client-side.
**Response — 409:** `{ "error": { "code": "domain_already_configured" } }` — this partner already has a
different `custom_domain` set; must be removed first (Section 9 — one custom domain per partner account,
Section 10).
**Response — 403 / 422 (validation):** same patterns as 4.B.3.

#### 4.B.5 `POST /api/admin/configurator/domain/custom-domain/recheck` (Clerk-authenticated)

**Request body:** `{ "partner_account_id": "uuid" }`

**Response — 200:** same shape as the `GET /api/admin/configurator/domain` response's custom-domain
fields — calls Vercel's domain-config-check endpoint live, updates `custom_domain_status`/
`custom_domain_verified_at` if now verified, returns the current (possibly unchanged) state.
**Response — 404:** `{ "error": { "code": "no_custom_domain_configured" } }` — nothing to recheck.
**Response — 403:** same pattern as above.

#### 4.B.6 `DELETE /api/admin/configurator/domain/custom-domain` (Clerk-authenticated)

**Request body:** `{ "partner_account_id": "uuid" }`

**Response — 200:** `{ "custom_domain_status": "none" }` — always succeeds from the caller's point of
view once the DB fields are cleared, even if the upstream Vercel deregistration call itself failed
(Section 8 — the partner's intent to remove is honored locally regardless; an orphaned Vercel-side
registration is a Clio-ops cleanup concern, not a partner-facing error).
**Response — 404:** `{ "error": { "code": "no_custom_domain_configured" } }` — nothing to remove.
**Response — 403:** same pattern as above.

## 5. Visual Examples

### 5.A `/dashboard/configurator/domain` — literal wireframes

See Section 4.A for all seven screen-state wireframes (states 1–7), inline with their copy — not
duplicated here per this document's own precedent of keeping wireframe and exact-copy together rather
than splitting them across two sections when every state needs both simultaneously to be unambiguous.

### 5.B Sequence flows

**5.B.1 — Subdomain claim**
```
Partner-admin types slug → debounced GET .../check-slug → {available}
  → [Save subdomain] → PATCH .../subdomain → server re-validates (format, reserved list, uniqueness)
  → 200 → partner_accounts.subdomain_slug updated → Screen state 2
  → 409 (race lost) → error shown inline, partner re-picks
```

**5.B.2 — Custom domain add**
```
Partner-admin types domain → [Add domain] → POST .../custom-domain
  → Clio calls Vercel Domains API: POST /v10/projects/{VERCEL_PROJECT_ID}/domains { "name": domain }
     [architecture.md §14.3 — exact request/response]
  → Vercel 200/201 with verification[] required → partner_accounts.custom_domain_status =
    'pending_verification', .custom_domain_verification = verification[] → Screen state 3
  → Vercel 200/201 with verified:true already → custom_domain_status = 'verified' → Screen state 4
  → Vercel 4xx/409 (e.g. domain claimed elsewhere) → custom_domain_status = 'failed',
    .custom_domain_error = Vercel's own error message → Screen state 5
```

**5.B.3 — Verification recheck**
```
[Recheck verification] → POST .../recheck → Clio calls Vercel:
  GET /v9/projects/{VERCEL_PROJECT_ID}/domains/{domain}/config
  → verified:true → custom_domain_status = 'verified', .custom_domain_verified_at = now(),
    .custom_domain_verification = NULL → Screen state 4
  → verified:false → custom_domain_status stays 'pending_verification', verification[] refreshed
    (Vercel may return an updated record if the requirement changed) → Screen state 3, unchanged
```

**5.B.4 — Custom domain removal**
```
[Remove domain] (two-step confirm) → DELETE .../custom-domain
  → Clio calls Vercel: DELETE /v9/projects/{VERCEL_PROJECT_ID}/domains/{domain}
  → 200 OR 404 (already gone on Vercel's side) → both treated as success →
    partner_accounts.custom_domain = NULL, .custom_domain_status = 'none',
    .custom_domain_verification = NULL, .custom_domain_error = NULL → Screen state 2
  → Vercel call throws/network error → logged, Clio-side fields still cleared identically
    (Section 8 — partner's removal intent is never blocked by an upstream failure)
```

**5.B.5 — Host-header tenant resolution (every request, `middleware.ts`)**
```
Request arrives → clerkMiddleware callback runs (existing, unmodified entry point)
  │
  │ 1. host = request.headers.get('host') (lowercased, port stripped)
  │ 2. IF host === CLIO_ROOT_DOMAIN OR host does NOT end with `.${CLIO_ROOT_DOMAIN}`
  │      AND host is not a row in partner_accounts.custom_domain (verified) →
  │      NOT a tenant request → existing Clerk-gate logic runs completely unchanged, fall through
  │ 3. ELSE (host is `{slug}.${CLIO_ROOT_DOMAIN}` OR a verified custom_domain):
  │      resolveTenantFromHost(host, rootDomain) → { partnerAccountId, status } | null
  │      IF null (no matching row) OR status !== 'active' (suspended) →
  │        pathname is one of the 4 tenant-scoped patterns (Section 6)? → render the existing
  │          NeutralMessage ("This page could not be found.") — reuse the literal string/component
  │          already used at app/partner-questionnaire/[partner_account_id]/page.tsx, no new copy
  │        pathname is anything else (e.g. /dashboard, /sign-in) → same neutral 404, never fall
  │          through to Clio's own marketing/dashboard content on a resolved-but-blocked tenant host
  │      IF resolved AND active:
  │        pathname === '/' OR pathname === '/questionnaire' →
  │          NextResponse.rewrite(`/partner-questionnaire/${partnerAccountId}`) with
  │          x-clio-resolved-partner-account-id header set (architecture.md §14.4)
  │        pathname matches /partner-questionnaire/(.*) or /partner-render/(.*) already →
  │          pass through unchanged (already correctly scoped by their own path segment)
  │        anything else → same neutral 404 as above (Section 6 — dashboard/admin routes never
  │          resolve on a partner's own domain, even though DNS wouldn't normally route there)
  ▼
NextResponse.next() with x-pathname header (existing behavior, unchanged)
```

## 6. Data Requirements

Full schema DDL, exact Vercel request/response shapes, and the exact `middleware.ts` diff live in
`architecture.md` §14. Summarized:

**Modified table (additive ALTERs only, `partner_accounts`):**
- `subdomain_slug TEXT UNIQUE` — nullable until claimed, stored lowercase.
- `custom_domain TEXT UNIQUE` — nullable, stored lowercase, no protocol/path/port/trailing dot.
- `custom_domain_status TEXT NOT NULL DEFAULT 'none' CHECK (... IN ('none','pending_verification',
  'verified','failed'))`
- `custom_domain_error TEXT` — nullable; Vercel's own error message verbatim, only non-null while
  `status='failed'`; cleared on every new add/remove attempt.
- `custom_domain_verification JSONB` — nullable; Vercel's `verification` array verbatim, only non-null
  while `status='pending_verification'`; cleared when verified or removed.
- `custom_domain_added_at TIMESTAMPTZ`, `custom_domain_verified_at TIMESTAMPTZ` — nullable, set at the
  obvious lifecycle points, no other consumer than the settings screen and future ops visibility.

No new tables — this is partner-account-level configuration, the same category as the already-live
`outbound_base_url` columns (Known Constraint in the Feature Brief).

**Reserved subdomain-slug list** (`architecture.md` §14.2, exact list a developer implements against —
not invented ad hoc): existing top-level Clio route segments (`www`, `api`, `app`, `admin`, `dashboard`,
`sign-in`, `sign-up`, `pricing`, `onboarding`, `plan`, `checkout`, `topics`, `walkthrough`,
`partner-render`, `partner-questionnaire`, `questionnaire`) plus common infra words (`mail`, `ftp`,
`staging`, `dev`, `test`, `docs`, `status`, `blog`, `cdn`, `static`, `assets`, `help`, `support`, `clio`,
`vercel`).

**Read from the database:** `partner_accounts.subdomain_slug`/`.custom_domain`/`.custom_domain_status`
— every incoming request that carries a non-root `Host` header (middleware, Section 5.B.5); every
`GET`/check-slug/recheck call.

**Written to the database:** `partner_accounts` (the 6 new columns above), via the subdomain PATCH,
custom-domain POST/recheck/DELETE routes. Nothing else — no new tables, no new event type
(`docs/specs/B2B-04-requirement-document.md` already confirmed this is unrelated to billing; no
`usage_events` row is ever created by any route in this document).

**APIs called:** Vercel Domains API (`POST/GET/DELETE /v{9,10}/projects/{projectId}/domains[/{domain}]`
and `/v9/projects/{projectId}/domains/{domain}/config`), via the official Vercel SDK
(`@vercel/sdk`, newly approved for `CLAUDE.md`'s vendor list per the Feature Brief's own instruction —
same approval pattern already used for `hume`/`googleapis`/`@dagrejs/dagre`), never a raw unauthenticated
`fetch`. If `VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID` are `PLACEHOLDER_`-safe values, every Vercel-calling
function mocks the call (logs what it would send via `console.log('[MOCK]', ...)`, returns a realistic
mock `verification`/`verified` shape), mirroring `lib/stripe.ts`'s `isPlaceholder` guard convention
exactly (`architecture.md` §14.3 gives the mock's exact return shape).

**Never written anywhere:** no end-user data of any kind — this document has zero end-user-facing state
beyond the two existing, unmodified render routes. Domain configuration is account-level, same
data-boundary category as `outbound_base_url`.

**localStorage/sessionStorage:** none — the Configurator screen holds only in-memory React state (no
persistence beyond the two-step "Remove domain" 5-second confirm window, which is a plain `setTimeout`,
not storage).

## 7. Success Criteria (Acceptance Tests)

✓ Given a partner account with no `subdomain_slug` set, when the partner-admin claims `"acme-co"` via
`PATCH /api/admin/configurator/domain/subdomain`, then the response is `200`, `partner_accounts.
subdomain_slug = 'acme-co'`, and a subsequent request with `Host: acme-co.{root_domain}` and path `/`
resolves (via middleware) to the partner's published questionnaire content — verified by asserting the
rewritten request reaches `/partner-questionnaire/{that partner's id}`, not a 404.

✓ Given partner A already holds `subdomain_slug = 'acme-co'`, when partner B calls
`PATCH /api/admin/configurator/domain/subdomain` with the same slug, then the response is `409
slug_taken`, and partner B's `partner_accounts` row is unchanged (still `NULL` or its prior value).

✓ Given a slug on the reserved list (e.g. `"dashboard"`), when a partner-admin calls
`GET /api/admin/configurator/domain/check-slug?slug=dashboard`, then the response is
`{ "available": false, "reason": "reserved" }`, and a subsequent `PATCH` attempt with that same slug
returns `409 slug_reserved` — proving the server-side check is authoritative, not just the UI's
debounced check.

✓ Given a partner-admin submits a syntactically valid custom domain that Vercel's API accepts, when
`POST /api/admin/configurator/domain/custom-domain` completes, then the response is `201`,
`partner_accounts.custom_domain_status = 'pending_verification'`, and `.custom_domain_verification`
contains the exact `verification` array Vercel returned (byte-identical field values, not a Clio
paraphrase).

✓ Given a `custom_domain_status = 'pending_verification'` domain that has since had its DNS correctly
configured, when the partner-admin clicks `[Recheck verification]`
(`POST .../custom-domain/recheck`), then the response reflects `custom_domain_status = 'verified'`,
`custom_domain_verified_at` is set, and `custom_domain_verification` is `null`.

✓ Given a custom domain that Vercel rejects synchronously (e.g. already claimed by a different Vercel
project), when `POST /api/admin/configurator/domain/custom-domain` is called, then the response is `422`
with `custom_domain_status: "failed"` and `custom_domain_error` set to Vercel's own returned message, and
the `partner_accounts` row persists that same state so a page reload still shows Screen state 5, not a
blank/reset form.

✓ Given a partner with a `verified` custom domain, when they call
`DELETE /api/admin/configurator/domain/custom-domain`, then the response is `200
{ "custom_domain_status": "none" }`, and all four custom-domain columns (`custom_domain`, `.status`,
`.verification`, `.error`) are `NULL`/`'none'` — verified by re-fetching `GET .../domain` and confirming
Screen state 2, not a stale `verified` badge.

✓ Given partner A's `subdomain_slug = 'acme-co'` and partner B's `subdomain_slug = 'other-co'`, when a
request arrives with `Host: acme-co.{root_domain}`, then the resolved tenant is exclusively partner A —
verified by asserting the injected `x-clio-resolved-partner-account-id` header equals partner A's id in
every case, never partner B's, regardless of request volume or ordering (the literal, falsifiable form of
"one partner's domain can never resolve to another partner's content").

✓ Given a `Host` header that does not match any `partner_accounts.subdomain_slug` (as `{slug}.
{root_domain}`) and does not match any `verified` `custom_domain`, when a request arrives at path `/` or
`/questionnaire`, then the response is the neutral "This page could not be found." message (reusing the
existing `app/partner-questionnaire/[partner_account_id]/page.tsx` `NeutralMessage` string/component),
never a `500`, never a silent fallthrough to Clio's own marketing page.

✓ Given a partner account with `status = 'suspended'` but a previously-`verified` `custom_domain`, when
a request arrives on that domain, then Host resolution treats it identically to an unmatched domain
(neutral 404), not as a valid tenant — proving suspension revokes domain resolution the same way it
already revokes partner-API-key access (B2B-02 precedent).

✓ Given a request with `Host: {anything}.{root_domain}` or a partner's `verified` custom domain, when the
path is `/dashboard` (or any other `/dashboard/*` or `/api/admin/*` route), then the response is the same
neutral 404 — never Clio's own Configurator, proving the Clerk-gated Configurator itself never becomes
reachable via a partner's own branded domain (Known Constraint #5 in the Feature Brief).

✓ Given the existing literal path `/partner-questionnaire/[partner_account_id]` (with the correct UUID)
is requested under a partner's own resolved custom domain rather than Clio's own domain, when the
request arrives, then the page renders identically to how it renders on Clio's own domain today (no
regression) — proving this document's middleware changes are additive to, not a replacement of, the
existing public-route behavior (Known Constraint: "middleware change is additive only").

## 8. Error States

| Failure | User-visible behavior | Clio-side behavior |
|---|---|---|
| Slug fails format validation (client-side) | Inline red helper text under the input, save button disabled | No API call made |
| Slug taken/reserved (server-side, race or bypassed client check) | `409`, error surfaced inline on the Configurator screen | No DB write |
| Custom domain fails Zod hostname validation | `422`, field-level error | No Vercel call made, no DB write |
| Custom domain already configured for this account | `409 domain_already_configured` | No Vercel call made, no DB write — partner must remove the existing one first (Section 9) |
| Vercel API rejects domain add (already claimed elsewhere, invalid TLD, etc.) | `422`, Screen state 5, Vercel's own message shown verbatim | `partner_accounts.custom_domain_status = 'failed'`, `.custom_domain_error` set; the domain string itself is still saved (so the partner sees what they tried, not a blank field) |
| Vercel API unreachable/erroring on add (network failure, not a rejection) | `502`-equivalent JSON error, Configurator shows a generic retry prompt (reuses the existing "Couldn't load domain settings. Try refreshing the page." string where applicable, or an equivalent inline retry state for the add action specifically) | Logged; no `partner_accounts` row mutation — the partner can retry the same `POST`, matching B2B-04's Stripe-unreachable convention (`docs/specs/B2B-04-requirement-document.md` Section 8) exactly |
| Vercel API unreachable/erroring on recheck | Screen stays in its current (`pending_verification`) state, no error banner — a transient check failure is not user-facing, the partner can just click Recheck again | Logged, `custom_domain_status` unchanged |
| Vercel API unreachable/erroring on removal | Removal still succeeds from the partner's point of view (Section 6/5.B.4) | Logged as an orphaned-registration cleanup item; DB fields still cleared |
| `GET /api/admin/configurator/domain` query fails | Screen state 7 | `500` from the API route, logged server-side, no partial/stale data rendered |
| Clerk-authenticated caller has no `partner_admin_users` row for the target account, on any route in this document | `403`, same error envelope as every other `/api/admin/configurator/*` route | No DB write, no Vercel call |
| Host resolves to a suspended or nonexistent partner, path is tenant-scoped | Neutral "This page could not be found." (Section 6/7) | No DB write; this is a read-only resolution, never an error path that needs recovery |

**Loading/slow-network state:** `GET /api/admin/configurator/domain` and the check-slug endpoint are
simple indexed reads — Screen state 6 (Section 4.A) covers the admin page's loading UX. The Vercel-calling
routes (`custom-domain` POST/recheck/DELETE) involve a real external vendor call; no specific timeout is
imposed beyond the codebase's existing default fetch behavior, consistent with how B2B-02 handled the
meeting-bot vendor call's timeout (a reasonable timeout in the 15–30s range, not a hard number specified
here to avoid needing a spec update if vendor latency characteristics change).

## 9. Edge Cases

- **Checking availability of your own current slug**: returns `{ "available": true }`, not `false` —
  re-saving your own unchanged slug (or re-typing it while editing) is never treated as a conflict with
  yourself (Section 4.B.2).
- **Adding a custom domain while a subdomain is already live**: fully additive, not a replacement — the
  subdomain keeps resolving exactly as before; a partner with both configured has two working entry
  points simultaneously. Explicit screen copy states this (Section 4.A, Screen state 2).
- **A partner with neither a subdomain nor a custom domain configured**: the existing literal
  `/partner-questionnaire/[partner_account_id]` and `/partner-render/[clio_session_ref]` Clio-domain URLs
  keep working exactly as they do today — this document adds an option, it never removes the existing
  fallback (Known Constraint, Feature Brief item 2's Q2 recommendation).
- **A custom domain that fails, then the partner retries with a corrected value**: `[Try a different
  domain]` clears the failed state client-side; the next `POST` overwrites `custom_domain`/
  `custom_domain_error`/`.status` entirely — no merge of old and new attempt data, no stale error message
  surviving a successful retry.
- **Custom domain removed while still `pending_verification` (never completed)**: fully supported —
  removal doesn't require having reached `verified` first (Section 5.B.4 handles this identically
  regardless of prior status).
- **Two browser tabs racing on the same partner account** (e.g. partner-admin has the Configurator open
  in two tabs, claims two different slugs): the second `PATCH` to complete wins at the DB layer (the
  unique constraint on `subdomain_slug` prevents two different partners from colliding, but nothing
  prevents the same partner from legitimately changing their own mind twice in a row) — this is the same
  "last write wins" convention every other Configurator PATCH endpoint already uses (e.g.
  `topics-config`), not a new pattern invented here.
- **`INFRA-07` (final root-domain decision) still unresolved**: `CLIO_ROOT_DOMAIN` is a single env var
  (`architecture.md` §14.1); nothing in this document's schema or code hardcodes `hello-clio.com` or any
  other value — changing the env var once `INFRA-07` closes requires no code change and no data migration
  (`subdomain_slug` values themselves are root-domain-agnostic).
- **A partner's `custom_domain` value happens to collide with an existing Clio-owned domain** (the
  production domain itself, or any `*.{root_domain}` value): rejected at validation time (`4.B.4`), not
  a runtime resolution ambiguity — a partner cannot claim Clio's own namespace as their "custom" domain.
- **Mobile vs. desktop**: not applicable to `/dashboard/configurator/domain` (an internal-to-partner-admin
  operational screen, matching every other Configurator screen's existing no-mobile-spec precedent) — end
  users never see this screen; they only ever see the already-existing, already-responsive
  `/partner-questionnaire` and `/partner-render` pages this document routes them to.
- **A request arrives with a `Host` header that is itself malformed or missing entirely** (unusual, but
  possible from a malformed client): treated identically to a non-matching host — falls through to the
  existing Clerk-gate logic unchanged (Section 5.B.5, step 2's `does NOT end with` check naturally
  handles an empty/malformed value the same as any other non-matching string, no separate branch needed).

## 10. Out of Scope

Explicitly excluded, per the Feature Brief's own scope boundaries plus this document's own findings:

- **The onboarding wizard** (brainstorm §7.6) — see the Scope Note at the top of this document. Not
  spec'd, not referenced, not stubbed.
- **A vanity, uuid-free path for `/partner-render/[clio_session_ref]`** (e.g.
  `acme-co.hello-clio.com/session/{ref}`). The Feature Brief's own Known Constraint #6 states this is
  "additive polish... not a functional dependency" — the meeting bot always uses the literal Clio-domain
  UUID form regardless of any domain configuration (B2B-02, unmodified), and no acceptance criterion
  anywhere in this pivot names a need for a partner-facing branded render link beyond what already works
  (the literal path resolves correctly under a partner's own custom domain today, per this document's
  last acceptance test in Section 7, even without a dedicated clean-path rewrite). Building an unused
  vanity path would be inventing UI/routing surface with no evidenced demand — not done here. If Arun
  later wants this, it is a small, additive follow-up (the middleware and Vercel-registration mechanism
  this document builds does not need to change to support it later).
- **Programmatic wildcard-domain provisioning** (`*.{root_domain}` added to Clio's own Vercel project).
  Per the Feature Brief's own recommendation and Question 4, this is a one-time, Orchestrator-run manual
  setup step against Clio's own Vercel project, not runtime code — see Section 12.
- **DNS record auto-configuration at the partner's registrar.** Clio never touches a partner's own DNS
  provider — it only displays what Vercel requires the partner to add themselves (Section 4.A, Screen
  state 3). No registrar API integration of any kind.
- **Email or Slack notification on domain verification completing.** Not named in the Feature Brief's
  "What Success Looks Like," and B2B-04 already establishes the precedent that new notification channels
  are a deliberate, separately-scoped decision, not a default add-on — the partner-admin sees the updated
  status the next time they load or manually recheck the Configurator screen.
- **Multiple custom domains per partner account.** `custom_domain` is a single column, not a list —
  matches the existing singular `outbound_base_url` precedent (Known Constraint) and nothing in the
  Feature Brief's success criteria describes more than one.
- **SSO or any custom authentication scheme tied to a partner's own domain.** Unrelated — the end-user
  surfaces this document routes to (questionnaire, render) have no authentication model today (Clio has
  no end-user identity, per the Non-Negotiable Data Boundary) and this document does not introduce one.
- **Billing/metering implications of domain configuration.** `docs/specs/B2B-04-requirement-document.md`
  already states domain/custom-domain provisioning is unrelated to billing; this document creates no new
  `usage_events` event type, confirmed in Section 6.
- **Retrofitting the existing `/partner-questionnaire`/`/partner-render` pages' own visual content or
  behavior.** This document only changes how a request *arrives* at those pages (via Host resolution and
  the new clean `/`/`/questionnaire` paths) — it does not modify `QuestionnaireClient.tsx`,
  `PartnerRenderClient.tsx`, or any B2B-03 rendering/theming logic.

## 11. Open Questions

None.

All four items the Feature Brief flagged as "Questions for BA" were resolved as judgment calls within
this document, per the same "document the call, don't escalate a technical scoping decision" pattern
`docs/specs/B2B-02-requirement-document.md` and `docs/specs/B2B-04-requirement-document.md` both
established:

1. **Domain settings screen** — fully specified, Section 4.A (7 screen states, exact copy, exact
   validation rules, exact reserved-word list in `architecture.md` §14.2).
2. **Vanity URL routing shape** — the CEO brief's own recommendation is adopted with one narrowing: only
   the questionnaire route gets a new clean path (`/` and `/questionnaire`, rewritten internally to
   `/partner-questionnaire/[partner_account_id]` with `partner_account_id` also passed via a new
   `x-clio-resolved-partner-account-id` header, following the existing `x-pathname` injection pattern).
   The render route does **not** get an equivalent vanity path — Section 10 documents why this is a
   scoping decision grounded directly in the Feature Brief's own Known Constraint #6, not a fork the
   Feature Brief left genuinely open.
3. **Custom domain removal/replacement flow** — fully specified, Section 5.B.4 and Section 9: removal
   always succeeds locally regardless of upstream Vercel outcome; "replacement" is documented as two
   sequential calls (remove, then add), not a dedicated endpoint, since no product requirement
   distinguishes "replace" from "remove-then-add" behaviorally.
4. **Wildcard domain provisioning** — adopted the Feature Brief's own recommendation verbatim: one-time,
   Orchestrator-run manual setup against Clio's own Vercel project, tracked as a Dependency (Section 12),
   explicitly not part of this build's runtime code path.

None of these required a genuine architectural fork or product-shape decision beyond what the Feature
Brief itself already resolved or explicitly delegated to BA judgment — consistent with why Section 11 can
close empty here exactly as it did for B2B-02 and B2B-04.

## 12. Dependencies

- **B2B-02** (done) — `partner_accounts` (the table this document adds 6 columns to), `requirePartnerAdmin`
  (`lib/partner/auth.ts`, reused unmodified), `middleware.ts`'s existing Clerk-gate/`isPublicRoute`/
  `x-pathname` pattern (extended, not replaced).
- **B2B-03** (done) — the Configurator screen family (`ConfiguratorShell`/`Card`/`PrimaryButton`/
  `COLORS` from `_shared.tsx`, the `page.tsx`+`Client.tsx` split, `getPartnerAccountsForClerkUser`), and
  the two public render routes (`/partner-questionnaire/[partner_account_id]`,
  `/partner-render/[clio_session_ref]`) this document routes traffic to without modifying their internals.
- **Wildcard domain provisioning against Clio's own Vercel project** (`*.{CLIO_ROOT_DOMAIN}` added once,
  manually or via the Orchestrator, to the project's own domain settings) — **must happen before
  subdomain-first hosting actually resolves in production**, tracked here as a one-time infra action, not
  a code deliverable of this document (Section 10). Until it happens, subdomain claims still save
  correctly and the Configurator screen still works end-to-end in every state except the final DNS
  resolution of `{slug}.{root_domain}` itself reaching Clio's deployment.
- **`INFRA-07`** (final brand/root-domain decision, `docs/b2b-pivot-status.md`, status "in progress") —
  not a hard blocker (Section 9's edge case covers why), but production usefulness of subdomain hosting
  depends on it landing. `hello-clio.com` (already aliased to production per current infra) is a
  reasonable default for `CLIO_ROOT_DOMAIN` today.
- **Vercel API credentials** (`VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`) — real values needed to exercise
  live custom-domain registration end-to-end; `PLACEHOLDER_`-safe mock behavior otherwise (Section 6).
- **`CLAUDE.md` approved-library list** — the Feature Brief pre-approves `@vercel/sdk` as part of this
  brief per `CLAUDE.md`'s own stated process ("New vendor approvals... will be added here as the relevant
  Feature Briefs land"); the Orchestrator should reflect this in `CLAUDE.md`'s vendor table when this
  document's build lands. Not this document's own action to take.
- **What this document unblocks**: this is the fifth and final Feature Brief in the B2B pivot sequence
  (`docs/b2b-pivot-status.md`) — it closes the last named dependency B2B-02 and B2B-03 both deferred by
  name. Sections 1–12 above are otherwise the terminal node of the pivot's dependency graph; Section 13
  (below) is additive on top of them, not a new dependency chain.

---

# Amendment v1.1 — Section 13: The Onboarding Wizard

Per Arun's direct, explicit confirmation ("Build it now" — not a fast-follow, not a lightweight
checklist): the full 7-step guided flow named in `docs/brainstorm-b2b-platform-pivot.md` §7.6 —
**Questionnaire → Topics → Content → Visualization → Domain → Payment method → Go-live** — sequencing
B2B-03's existing Configurator screens plus this document's own new Domain screen (Section 4.A) plus a new
Payment-method step plus a new Go-live step into one linear first-run experience, with save-and-resume.

This section follows the same template structure as Sections 1–12 (13.1 Purpose through 13.12
Dependencies), self-numbered to keep it a clean, independently reviewable unit rather than renumbering
Sections 1–12. `architecture.md` §14.7 is this section's companion schema/route document, exactly as
§14.1–14.6 back Sections 1–12.

## 13.1 Purpose

Today, a brand-new partner-admin's first login lands directly on `/dashboard/configurator` (Section 4.A's
own `HomeClient`), which assumes five independent, self-contained screens the partner discovers and visits
in whatever order they happen to click — including this document's own new Domain screen once built. For a
B2B buyer where "IT/design stakeholders loop in mid-setup" (the Orchestrator's own §7.6 rationale), an
unordered set of independent screens has no natural stopping point, no visible notion of "done," and no
guarantee a partner ever configures billing or a domain at all before their first end-user-facing link goes
out. **What failure looks like without this section:** a partner-admin clicks around five disconnected
screens, believes they're finished after touching two of them, and either never sets up billing (so no
revenue is ever collected from real usage) or never claims a domain (so B2B-05 Sections 1–12's entire
white-label purpose goes unused) — silently, with no forcing function surfacing either gap.

## 13.2 User Story

**Story 1 — First-time partner-admin (either archetype)**
As the person setting up my company's Clio integration for the very first time,
I want a single guided path through every setup decision, one at a time, that I can leave and come back to
without losing my place,
So that I reach a working, live, billable configuration without having to know in advance which of five
separate screens I need to visit or in what order.

**Story 2 — Returning partner-admin (post-go-live)**
As a partner-admin who already completed setup weeks ago,
I want to change one thing (e.g. my domain) without being walked through the other six steps again,
So that ongoing configuration changes feel like normal settings editing, not a repeated onboarding ritual —
exactly the distinction `docs/brainstorm-b2b-platform-pivot.md` §7.6 itself draws ("after initial setup,
drop the wizard framing").

**Story 3 — A partner-admin mid-setup whose custom domain's DNS hasn't propagated yet**
As someone who just added a custom domain and is waiting on DNS,
I want to keep configuring Payment and reach Go-live without being blocked on a 48-hour DNS window,
So that an external, partner-controlled delay never stalls Clio's own onboarding flow.

## 13.3 Trigger / Entry Point

**Concrete, checkable condition** (not "when appropriate"): `partner_accounts.onboarding_completed_at IS
NULL` for the `activePartnerAccountId` currently resolved by the Clerk-authenticated request. This is a
single nullable timestamp column (architecture.md §14.7), set exactly once, by exactly one route (Section
13.4's Go-live step) — never re-cleared by anything in this document.

- Every existing Configurator page (`/dashboard/configurator`, `/dashboard/configurator/questionnaire`,
  `/topics`, `/content`, `/visualization`, and this document's own new `/domain`) performs the identical
  check, immediately after resolving `activePartnerAccountId` and before rendering its own client
  component: if `onboarding_completed_at IS NULL`, `redirect()` to
  `/dashboard/configurator/wizard?partner_account_id={activePartnerAccountId}` — the partner-admin is
  never shown a standalone Configurator screen while `onboarding_completed_at` is unset, regardless of
  which URL they land on or type directly.
- The inverse holds at `/dashboard/configurator/wizard` itself: if `onboarding_completed_at IS NOT NULL`
  for the resolved account, `redirect()` to `/dashboard/configurator?partner_account_id={...}` — the
  wizard is unreachable once an account has gone live (Section 13.5's post-wizard-state requirement, made
  literal).
- **Pre-existing partner accounts (the "no impact on existing" case):** the migration that adds
  `onboarding_completed_at` (architecture.md §14.7) backfills every row that already exists at migration
  time to a non-null value. No partner account created before this ships is ever redirected into the
  wizard — this is a hard requirement, not an incidental side effect (see 13.9).
- `partner_onboarding_progress` (Section 13.6) is lazily created — with all six steps `'pending'` and
  `current_step='questionnaire'` — the first time `GET /api/admin/configurator/wizard/progress` is called
  for an account with no existing row, mirroring `partner_wallets`' own lazy-creation convention
  (`docs/specs/B2B-04-requirement-document.md`).

## 13.4 Screen / Flow Description

### 13.4.A `/dashboard/configurator/wizard` — the wizard shell

Server component (`page.tsx`): identical Clerk `auth()` + `redirect('/sign-in')` + account-resolution
pattern as every other Configurator page, plus the two redirect checks in 13.3. Renders a client component
(`WizardClient`) — **not** wrapped in `<ConfiguratorShell>` (the wizard has its own, different chrome: a
7-step progress indicator instead of a title bar, and a persistent Back/Skip/Continue footer the standalone
screens don't have).

**The 7 steps, in fixed order** (`current_step` values, `architecture.md` §14.7):

| # | Step | New screen or embeds existing? | "Complete" condition (server-validated) |
|---|---|---|---|
| 1 | `questionnaire` | Embeds `QuestionnaireBuilderClient` (B2B-03) | ≥1 `questionnaires` row for this account with `status='published'` |
| 2 | `topics` | Embeds `TopicsConfigClient` (B2B-03) | A saved topics-config row exists for this account (the same presence `GET .../topics-config` already exposes — `architecture.md` §12) |
| 3 | `content` | Embeds `ContentConfigClient` (B2B-03) | A saved content-config row exists for this account (`GET .../content-config`, §12) |
| 4 | `visualization` | Embeds `VisualizationClient` (B2B-03) | A saved theme row exists for this account (`GET .../theme`, §12) |
| 5 | `domain` | Embeds `DomainConfigClient` (this document, Section 4.A) | `partner_accounts.subdomain_slug IS NOT NULL` — **custom domain status is never part of this condition** (13.5) |
| 6 | `payment` | New — wraps B2B-04's existing checkout/subscription flows (13.4.B) | `partner_wallets.funding_mechanism IS NOT NULL` for this account |
| 7 | `go_live` | New (13.4.C) | N/A — terminal step, no "complete" condition of its own; instead validates all 6 prior steps |

**Embedding mechanism:** each of the 5 embedded client components (`QuestionnaireBuilderClient`,
`TopicsConfigClient`, `ContentConfigClient`, `VisualizationClient`, `DomainConfigClient`) gains one new,
additive, optional prop: `embedded?: boolean` (default `false`). Every one of these components today
renders its own `<ConfiguratorShell>` internally; when `embedded=true`, the component returns only the
content currently nested *inside* its `<ConfiguratorShell>...</ConfiguratorShell>` call(s), unwrapped —
the wizard shell supplies the equivalent outer chrome instead, so the partner-admin never sees two stacked
nav bars.

Three of the five have exactly one such call: `TopicsConfigClient.tsx` (line 35), `VisualizationClient.tsx`
(line 25), and `DomainConfigClient` (new, this document's own Section 4.A, authored with one). For these,
the check is inserted once, at that single return.

The other two do not — confirmed against the live code, not assumed: `QuestionnaireBuilderClient.tsx` has
two separately-wrapped `<ConfiguratorShell>` returns (the `view.mode === 'edit'` branch, wrapping
`<EditView>`; and the list/default branch, wrapping the New-button header plus loading/empty/list states),
and `ContentConfigClient.tsx` likewise has two (the `reviewingItem` branch, wrapping `<ReviewView>`; and
the default/list branch, wrapping the content-source toggle plus generated-items list). For these two
components, the `embedded` check is inserted at **each** of the two return sites independently, not once
for the whole component — the two branches render different content and pass different `title`/`backHref`
values to `ConfiguratorShell`, so a single merged check point would need to thread those per-branch values
through for no behavioral benefit (neither prop is read at all once `embedded=true`). The exact per-branch
mechanics are pinned in `architecture.md` §14.7.5 (v1.2 correction).

This is the only code change made to any of the 4 pre-existing B2B-03 components; their own business
logic, validation, save behavior, and API calls are completely untouched (per the Orchestrator's brief:
"you are NOT rebuilding these screens") — that promise holds per-branch for the two components with two
return sites exactly as it does for the three with one.

**Step indicator** (shown at the top of every wizard screen, all 7 steps always visible): each step renders
as a numbered circle + label. Current step: purple fill (`COLORS.purple`), circle shows its number. A
step whose status is `'completed'`: green checkmark (`COLORS.green`) replacing the number. A step whose
status is `'skipped'`: a muted "Skipped" tag (`COLORS.textMuted`) instead of a checkmark, circle outline
only. A step not yet reached (`'pending'`, and not the current step): plain gray number, not clickable.
A step already `'completed'`/`'skipped'` (i.e. behind the current step): clickable, navigates back to
review/redo that step without losing forward progress (13.9).

**Footer** (persistent across all step screens except `go_live`, 13.4.C): `[← Back]` (hidden on step 1,
navigates to the previous step, client-side only — see 13.6 on why Back never mutates persisted state);
`[Skip for now]` (always present on steps 1–6, secondary/muted styling, `SecondaryButton`); `[Continue →]`
(`PrimaryButton`, disabled until that step's condition in the table above is met, per-step live-checked the
same way the Domain screen's own Save button is already gated).

**Screen state 1 — loading** (while `GET .../wizard/progress` is in flight):

```
┌───────────────────────────────────────────────────────────┐
│  Clio Configurator — Getting set up          [Acme Co ▾]  │
│                                                              │
│                    Loading your setup…                      │
└───────────────────────────────────────────────────────────┘
```

**Screen state 2 — error** (progress fetch failed):

```
┌───────────────────────────────────────────────────────────┐
│  Clio Configurator — Getting set up          [Acme Co ▾]  │
│                                                              │
│         Couldn't load your setup. Try refreshing the page. │
└───────────────────────────────────────────────────────────┘
```

**Screen state 3 — a mid-flow step (example: step 2, Topics)**

```
┌───────────────────────────────────────────────────────────┐
│  Clio Configurator — Getting set up          [Acme Co ▾]  │
│                                                              │
│  ✓ Questionnaire   ●2 Topics   3 Content   4 Visualization │
│  5 Domain   6 Payment   7 Go live                           │
│                                                              │
│  [ ...TopicsConfigClient content, embedded=true... ]        │
│                                                              │
│  ───────────────────────────────────────────────────────  │
│  [ ← Back ]                [ Skip for now ]  [ Continue → ]│
└───────────────────────────────────────────────────────────┘
```
`[Continue →]` is disabled (per the table's condition) until a topics-config row has been saved via the
embedded screen's own existing save action — identical enablement logic to how the Domain screen's own
Save button already disables on invalid/unavailable input (Section 4.A).

**Screen state 4 — step 6, Payment method**

```
┌───────────────────────────────────────────────────────────┐
│  Clio Configurator — Getting set up          [Acme Co ▾]  │
│                                                              │
│  ✓ Questionnaire ✓ Topics ✓ Content ✓ Visualization        │
│  ⊘ Domain (skipped)   ●6 Payment   7 Go live                │
│                                                              │
│  Add a payment method                                       │
│  Choose how you'll fund usage.                               │
│                                                              │
│  [ Pay as you go ]        [ Set a monthly minimum ]         │
│  One-time top-up via      Auto-recharge subscription,        │
│  Stripe Checkout.          discounted rate.                  │
│                                                              │
│  ───────────────────────────────────────────────────────  │
│  [ ← Back ]                [ Skip for now ]  [ Continue → ]│
└───────────────────────────────────────────────────────────┘
```
`[Pay as you go]` and `[Set a monthly minimum]` call the existing, unmodified
`POST /api/admin/billing/checkout` and `POST /api/admin/billing/subscription`
(`docs/specs/B2B-04-requirement-document.md` 4.B.3/4.B.4) with `success_url` set to
`/dashboard/configurator/wizard?partner_account_id={id}&step=payment&funded=1` and `cancel_url` set to the
same URL without `&funded=1` — i.e. the wizard reuses B2B-04's existing hosted Stripe Checkout flow
verbatim, adding no new payment logic of its own (13.10). On return with `&funded=1`, `WizardClient`
re-fetches `GET .../wizard/progress` (which re-derives `payment_status` live from `partner_wallets.
funding_mechanism`) rather than trusting the URL param alone — the param only triggers *when* to re-check,
never *what* the result is. `[Continue →]` enables once `payment_status` comes back `'completed'` from that
re-fetch.

**Screen state 5 — step 7, Go live**

```
┌───────────────────────────────────────────────────────────┐
│  Clio Configurator — Getting set up          [Acme Co ▾]  │
│                                                              │
│  ✓ Questionnaire ✓ Topics ✓ Content ✓ Visualization        │
│  ✓ Domain   ⊘ Payment (skipped)   ●7 Go live                │
│                                                              │
│  You're ready to go live.                                   │
│  Your end users will reach Acme Co at:                       │
│                                                              │
│      acme-co.hello-clio.com                                  │
│                                                              │
│  [ Go live ]                                                 │
│                                                              │
│  ───────────────────────────────────────────────────────  │
│  [ ← Back ]                                                  │
└───────────────────────────────────────────────────────────┘
```
The displayed URL uses the exact same precedence Section 13.4.C's `go-live` response computes: verified
`custom_domain_url` > `subdomain_url` > the raw `/partner-questionnaire/{partner_account_id}` Clio-domain
fallback (never blank — Section 9's existing edge case guarantees a working URL always exists). No `[Skip
for now]` on this step — it is the terminal action, not skippable (13.10).

**Screen state 6 — go-live confirmation (brief, before redirect)**

```
┌───────────────────────────────────────────────────────────┐
│                                                              │
│                          ✓                                   │
│                                                              │
│                     You're live.                             │
│           Redirecting to your Configurator…                  │
│                                                              │
└───────────────────────────────────────────────────────────┘
```
Shown for 1.5s (a technical UX default, adjustable without a spec change — same discipline as B2B-04's
`amount_usd` bounds), then redirects to `/dashboard/configurator?partner_account_id={id}&welcome=1`. The
`&welcome=1` param is read once by `HomeClient` to optionally show a one-line "Setup complete" banner and
is not itself persisted anywhere (no new column, no new state — a page reload without the param simply
shows the normal Home screen).

### 13.4.B The Payment step's underlying mechanism

Deliberately not a new screen with new logic — the two buttons in Screen state 4 call B2B-04's existing
`POST /api/admin/billing/checkout` / `POST /api/admin/billing/subscription` routes unmodified
(`docs/specs/B2B-04-requirement-document.md` 4.B.3/4.B.4), exactly as those routes already work from
anywhere else they might be called. `POST /api/admin/billing/invoice` (enterprise, ops-only, 4.B.5) is
**not** offered as a wizard button — it was already scoped as "not partner-self-serve... called by Clio's
own ops" in the base B2B-04 document, and nothing in Arun's wizard instruction changes that; an enterprise
partner's `payment_status` becomes `'completed'` the same way it does today — Clio ops runs the invoice
flow out-of-band, which sets `partner_wallets.funding_mechanism='invoicing'`, which this wizard step reads
exactly like the other two funding mechanisms (no wizard-specific branching needed).

### 13.4.C `POST /api/admin/configurator/wizard/go-live` — the Go-live action

Validates every one of the 6 prior steps' status in `partner_onboarding_progress` is `'completed'` **or**
`'skipped'` (never `'pending'`) — this is the step's only precondition; it does not re-inspect the
*content* of any prior step (13.9). On success: sets `partner_accounts.onboarding_completed_at = now()`,
sets `partner_onboarding_progress.current_step = 'go_live'`. This is the **entire** mechanical effect of
Go-live — it does not touch `partner_accounts.status` (independent, Clio-ops-controlled, unrelated field),
does not touch `partner_api_keys` (B2B-02's keys already function from account creation, never gated on
onboarding), and creates no `usage_events` row (unrelated to billing, same as every other route in this
document, Section 6). What "becomes true" concretely: the entry-point condition in Section 13.3 flips, so
the partner-admin's *next* visit to any Configurator URL renders that screen directly instead of
redirecting into the wizard — that redirect-suppression is the enablement Go-live provides. Full request/
response contract: `architecture.md` §14.7.

## 13.5 Non-blocking domain verification (the specific brainstorm-doc requirement, made falsifiable)

- The Domain step's `[Continue →]` enables the instant `partner_accounts.subdomain_slug IS NOT NULL` —
  **regardless of `custom_domain_status`.** A partner who has claimed a subdomain and then added a custom
  domain that is still `pending_verification` can continue immediately; the wizard never polls or waits on
  Vercel verification to unblock progress.
- `[Skip for now]` is available on the Domain step exactly like every other step — a partner can reach
  Payment/Go-live having configured no domain of any kind, relying on the raw
  `/partner-questionnaire/[partner_account_id]` Clio-domain URL (Section 9's existing edge case: "the
  existing literal ... URLs keep working exactly as they do today"). This is a deliberate, documented
  choice (13.9), not an oversight — forcing a domain claim would invent a hard requirement the source
  material never establishes.
- **Go-live's hard requirement is therefore: subdomain claimed OR explicitly skipped — never "custom domain
  verified."** A partner can and routinely will go live on the default subdomain (or even the raw Clio
  URL) and add/verify a custom domain afterward, entirely through the plain, un-chromed
  `/dashboard/configurator/domain` screen post-go-live (13.6) — exactly the brainstorm doc's own framing
  ("continue configuring other steps while DNS propagates").

## 13.6 Post-wizard state: re-visiting a "completed" step later

After Go-live, `partner_onboarding_progress` is never read or written by any route again — it becomes a
historical record only (13.9's audit-trail edge case). Changing the domain (or questionnaire, topics,
content, visualization, or payment method) later is **not** "wizard step 5 revisited" — it is simply
loading `/dashboard/configurator/domain` (or the equivalent existing route) the same way every other
Configurator screen has always worked, with `embedded` defaulting to `false` so the screen renders in its
normal, full `<ConfiguratorShell>` chrome, not the wizard's. There is no code path, flag, or condition
anywhere in this document that re-applies wizard framing to an already-`onboarding_completed_at` account —
Section 13.3's redirect is the sole mechanism, and it only ever fires while `onboarding_completed_at IS
NULL`. This directly satisfies `docs/brainstorm-b2b-platform-pivot.md` §7.6's own instruction ("after
initial setup, drop the wizard framing — configuration becomes directly editable via the Configurator, not
a repeated wizard flow") as a literal, testable claim rather than a paraphrase (13.7).

**Save-and-resume, exact mechanism:** `partner_onboarding_progress.current_step` is the resume position.
It advances forward by exactly one position every time `POST .../wizard/advance` succeeds (whether
`action="complete"` or `"skip"`), and is set to `'go_live'` by the Go-live route itself. It is **never**
regressed by `[← Back]` — Back is pure client-side navigation within `WizardClient`'s already-loaded
`steps` state (no API call), letting a partner look at or redo an earlier step without losing their
furthest-reached position; leaving the wizard entirely (closing the tab, navigating away) and returning
later re-fetches `GET .../wizard/progress` and re-renders at `current_step` exactly as left, satisfying
"save-and-resume" as a literal, server-persisted guarantee, not a client-only convenience.

## 13.7 Visual Examples

Covered inline with 13.4's screen states (six states, verbatim wireframes and copy together, per this
document's own established precedent of not splitting wireframe from copy — Section 5's own note).

## 13.8 Data Requirements

**New column:** `partner_accounts.onboarding_completed_at TIMESTAMPTZ` (nullable; backfilled non-null for
every pre-existing row at migration time — 13.3, `architecture.md` §14.7).

**New table:** `partner_onboarding_progress` — one row per `partner_account_id`, lazily created. Exact DDL:
`architecture.md` §14.7. Six `{step}_status` TEXT columns (`'pending'|'completed'|'skipped'`) + six
`{step}_status_at` TIMESTAMPTZ columns + `current_step` TEXT.

**Read from the database:** `partner_accounts.onboarding_completed_at` (every Configurator page's entry
check, 13.3); `partner_onboarding_progress` (wizard progress GET); the existing questionnaire/topics-
config/content-config/theme/`partner_accounts.subdomain_slug`/`partner_wallets.funding_mechanism` reads
already exposed by their own existing endpoints (13.4.A's table) — this document adds no new read path to
any of those five, it only re-derives a boolean "is there a row/value" from responses those endpoints
already return.

**Written to the database:** `partner_accounts.onboarding_completed_at` (Go-live route only, set once,
never cleared — 13.4.C); `partner_onboarding_progress` (advance/go-live routes only). Nothing else — the
wizard writes no data belonging to any of the 5 embedded screens; those screens' own existing save actions
(already spec'd in B2B-03/this document) are the only writers of their own underlying tables, called
identically whether `embedded` is `true` or `false`.

**APIs called:** none beyond what the embedded screens and B2B-04's existing checkout/subscription routes
already call — no new external vendor integration in this section.

**localStorage/sessionStorage:** none — identical to the base document's own Section 6 conclusion; all
wizard state is either server-persisted (`partner_onboarding_progress`) or plain in-memory React state
(which step is currently displayed client-side before a Continue/Skip call commits it).

## 13.9 Success Criteria (Acceptance Tests)

✓ Given a partner account with `onboarding_completed_at IS NULL`, when the partner-admin loads
`/dashboard/configurator`, then they are redirected to `/dashboard/configurator/wizard?partner_account_id=
{id}` and never see `HomeClient`'s content.

✓ Given the same account, when the partner-admin navigates directly to `/dashboard/configurator/topics`
(bypassing the wizard via a typed/bookmarked URL), then they are still redirected to the wizard — never
shown the standalone Topics screen while `onboarding_completed_at IS NULL`.

✓ Given a partner account with `onboarding_completed_at` already set, when the partner-admin navigates
directly to `/dashboard/configurator/wizard`, then they are redirected to `/dashboard/configurator` — the
wizard is unreachable post-go-live, proving Section 13.6's claim is enforced, not just documented.

✓ Given `current_step='questionnaire'` and no questionnaire yet published for the account, when the
partner-admin publishes one via the embedded screen and clicks `[Continue →]`, then
`POST .../wizard/advance {step:"questionnaire", action:"complete"}` returns `200`,
`questionnaire_status='completed'`, and `current_step` becomes `'topics'`.

✓ Given `current_step='questionnaire'` and no questionnaire published, when a client bypasses the disabled
button and calls `POST .../wizard/advance {step:"questionnaire", action:"complete"}` directly, then the
response is `422 step_not_ready` and `questionnaire_status` remains `'pending'` — proving the condition is
server-authoritative, not merely a disabled-button UI convenience.

✓ Given `current_step='domain'` and no `subdomain_slug` claimed, when the partner-admin clicks
`[Skip for now]`, then `POST .../wizard/advance {step:"domain", action:"skip"}` returns `200` regardless of
domain state, `domain_status='skipped'`, and `current_step` becomes `'payment'` — the literal, falsifiable
form of "domain verification is never a hard block" (13.5).

✓ Given a `subdomain_slug` claimed but a `custom_domain_status='pending_verification'`, when the
partner-admin clicks `[Continue →]` on the Domain step, then the request succeeds identically to a fully-
`verified` custom domain — proving custom-domain verification status never gates wizard progress.

✓ Given 5 of 6 steps `'completed'`/`'skipped'` and `payment_status='pending'`, when
`POST /api/admin/configurator/wizard/go-live` is called, then the response is
`422 { "error": { "code": "steps_incomplete", "pending_steps": ["payment"] } }`, and
`partner_accounts.onboarding_completed_at` remains `NULL`.

✓ Given all 6 steps `'completed'` or `'skipped'`, when `POST .../wizard/go-live` is called, then the
response is `200`, `partner_accounts.onboarding_completed_at` is a non-null timestamp, and `live_url`
reflects the documented precedence (verified custom domain > subdomain > raw `/partner-questionnaire/{id}`
fallback) — verified by testing all three precedence branches independently.

✓ Given a partner account row that existed before the `onboarding_completed_at` migration ran, when that
migration's backfill executes, then the row's `onboarding_completed_at` is immediately non-null, and that
account's partner-admin is never redirected into the wizard on their next login — proving no regression to
already-configured partners, the standing "no impact on existing" requirement.

## 13.10 Error States

| Failure | User-visible behavior | Clio-side behavior |
|---|---|---|
| `GET .../wizard/progress` fails | Screen state 2 ("Couldn't load your setup...") | `500` logged, no partial render |
| `POST .../advance` with `action="complete"` before the step's condition is met | `[Continue →]` was already disabled; if bypassed, inline text "This step isn't finished yet." | `422 step_not_ready`, no DB write |
| `POST .../advance` with a `step` that no longer matches the server's `current_step` (stale tab, double-submit) | Wizard silently re-fetches progress and re-renders at the real `current_step` | `409 step_mismatch`, no DB write |
| `POST .../wizard/go-live` with any step still `'pending'` | Inline message naming which step(s) still need attention; that step's nav dot stays highlighted | `422 steps_incomplete`, no `partner_accounts` write |
| Payment step's Stripe Checkout is abandoned or fails | Partner returns to the wizard's Payment step unchanged, `payment_status` still `'pending'` — same no-partial-state convention as B2B-04's own abandoned-checkout case | No wallet mutation, no progress write |
| Clerk-authenticated caller has no `partner_admin_users` row for the target account, on any wizard route | `403`, same error envelope as every other `/api/admin/configurator/*` route | No DB write |

## 13.11 Edge Cases

- **A partner-admin skips every single step and clicks Go live immediately:** fully allowed. Go-live only
  checks each step's status is non-`'pending'` — it never re-validates that a skipped step has "good
  enough" content. This is a deliberate scope call (not an oversight): the wizard is a *sequencing* aid,
  ensuring every decision point is visited once, not a *content-quality* gate re-litigating what each
  embedded screen's own spec already governs. A partner who wants to go live with an unpublished
  questionnaire and no payment method configured is allowed to — the same way an enterprise partner today
  can already have "no payment method on file" per `docs/specs/B2B-04-requirement-document.md`'s own
  wireframe.
- **Two browser tabs on the same account, each mid-advance on a different step:** identical "last write
  wins" / `409`-then-retry convention as every other Configurator mutation (Section 9's own precedent,
  `topics-config`).
- **A partner-admin who administers multiple `partner_accounts`:** wizard state is entirely per-account
  (`partner_onboarding_progress.partner_account_id` is the primary key). Switching accounts via the
  wizard's own header account-switcher immediately re-fetches that other account's progress — if that
  account already has `onboarding_completed_at` set, the switch itself triggers the 13.3 redirect straight
  to that account's Home, not a jarring "reset to step 1" experience.
- **A partner-admin who reaches Go-live, then later wants to redo the Questionnaire:** uses the plain
  `/dashboard/configurator/questionnaire` screen exactly as it worked before this section existed — no
  wizard chrome, no step tracking, `partner_onboarding_progress` untouched (13.6).
- **`INFRA-07` (root-domain decision) still unresolved at Go-live time:** identical to the base document's
  own edge case (Section 9) — `live_url` still resolves correctly once `CLIO_ROOT_DOMAIN` is set; nothing
  in this section hardcodes a root-domain value either.
- **A brand-new partner account created via B2B-02's account-creation path after this migration ships:**
  gets `onboarding_completed_at = NULL` by the column's own default (no explicit insert-time value
  required from B2B-02's own code) — the wizard intercepts it on first Configurator visit automatically,
  with no B2B-02 code change needed.

## 13.12 Out of Scope

- **Re-ordering, hiding, or making any of the 7 steps optional/reconfigurable.** The sequence is fixed,
  per Arun's exact confirmed scope (Questionnaire → Topics → Content → Visualization → Domain → Payment →
  Go-live) — not a partner-configurable flow.
- **A Clio-ops dashboard showing which partners are stuck mid-wizard.** `partner_onboarding_progress`
  makes this queryable in the future, but no such screen is named in Arun's instruction or built here.
- **Any change to the 5 embedded screens' own business logic, validation, or save behavior** beyond the
  single additive `embedded` prop (13.4.A). This section is a sequencing shell, not a rebuild.
- **Undoing a completed Go-live.** `onboarding_completed_at`, once set, is never cleared by any route in
  this document. A manual ops correction (direct DB update) is the only path, and is out of scope here.
- **A dedicated "replace payment method" flow inside the wizard.** The wizard's Payment step offers the
  same two funding entry points B2B-04 already built; changing a payment method after go-live uses
  whatever B2B-04's own billing screen already provides (`docs/specs/B2B-04-requirement-document.md`), not
  a wizard-specific mechanism.
- **Email/Slack notification when a partner-admin abandons the wizard mid-flow.** Not named in Arun's
  instruction; matches the base document's own precedent that new notification channels are a deliberate,
  separately-scoped decision (Section 10).

## 13.13 Open Questions

None.

All ambiguity in Arun's instruction was resolvable as a documented BA judgment call, consistent with the
same "document the call, don't escalate a technical scoping decision" pattern Sections 1–12 (and
B2B-02/B2B-04) already established:

1. **Progress persistence model** (new table vs. JSON column on `partner_accounts`) — resolved: a new
   table, `partner_onboarding_progress`, with typed status+timestamp columns per step, matching this
   codebase's existing preference for typed columns over a generic JSON blob when the shape is small and
   fixed (`partner_wallets` is the precedent, not a JSONB settings column).
2. **Whether Go-live requires genuine completion of each step vs. merely having visited/skipped it** —
   resolved: only requires non-`'pending'` status; Go-live is a sequencing gate, not a content-quality gate
   (13.11, explicitly documented as a deliberate choice).
3. **Whether the Domain step requires at least a claimed subdomain before advancing** — resolved: no,
   `[Skip for now]` is available on every one of the 6 non-terminal steps including Domain, consistent with
   the base document's own "the raw Clio-domain UUID URL always works" fallback (Section 9).
4. **Whether re-visiting a completed step post-go-live needs a distinct "wizard-aware" screen** — resolved:
   no, it reuses the plain, already-existing Configurator screen unchanged (`embedded=false`), per the
   brainstorm doc's own explicit instruction that wizard framing fully drops after go-live (13.6).

None of these required escalation beyond what Arun's own direct instruction and the brainstorm doc's
existing §7.6 recommendation already resolved — consistent with why this section, like Sections 1–12,
closes empty here.

## 13.14 Dependencies

- **Sections 1–12 of this same document** (Domain screen, Section 4.A) — must land first or alongside,
  since the wizard's Domain step embeds `DomainConfigClient`, which does not exist until Section 4.A is
  built. The wizard cannot ship before or without it.
- **B2B-03** (done) — `QuestionnaireBuilderClient`, `TopicsConfigClient`, `ContentConfigClient`,
  `VisualizationClient`, each requiring the single additive `embedded` prop (13.4.A) — the only code touch
  this section makes to pre-existing B2B-03 files.
- **B2B-04** (done) — `POST /api/admin/billing/checkout` / `/subscription`, `partner_wallets.
  funding_mechanism`, reused completely unmodified as the Payment step's mechanism (13.4.B) — this section
  adds no new payment logic.
- **B2B-02** (done) — `partner_accounts`, `partner_admin_users`, `requirePartnerAdmin`,
  `getPartnerAccountsForClerkUser`, reused unmodified.
- **Migration ordering:** the `onboarding_completed_at` backfill (13.3, `architecture.md` §14.7) must run
  in the same migration that adds the column — this is the concrete mechanism that protects every existing
  partner account from being caught mid-wizard on their next login (13.9's last acceptance test).
- **What this section unblocks:** nothing further in the pivot's dependency graph depends on it — like
  Sections 1–12, it is additive, terminal scope within B2B-05.
