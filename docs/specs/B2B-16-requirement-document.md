# B2B-16 — Partner Dashboard Simplification (Configurator / API / Docs) — Requirement Document

Version: 1.1
Status: CEO APPROVED — cleared for Dev (Q2/Q3 resolved by CEO below; Q1 is a non-blocking escalation to Arun, tracked separately as B2B-17, does not gate this build)
Author: Business Analyst Agent
Date: 2026-07-17
CEO review: 2026-07-17 — independently re-verified all "current code" claims against live source (layout gate, DashboardShell 5 admin importers, developer/ dir, partner_wallets columns 075/081, Integration reveal-once masking/copy, both Clerk webhooks, users.subscription_status DEFAULT 'inactive', Q1 chain reachability). All confirmed. Approved.
Source brief: `.claude/agents/clio/feature-briefs/B2B-16-partner-dashboard-simplification-configurator-api-docs.md`
Priority: P1

> **Verification note.** Every "current code" claim below was read against live source on
> 2026-07-17 (not inferred from the brief). Where this document confirms a brief claim, the file
> and line are cited so QA and the developer can re-verify. Three of the brief's factual claims were
> checked and **confirmed** (DashboardShell shared with admin, `/plan`·`/checkout` still wired,
> `partner_wallets` has the banner columns); one was traced to a **precise resolution** (the
> access-gate contradiction); and one open item (the signup-chain coupling) was traced far enough to
> convert it from "unknown" into a **specific, bounded decision** for Arun (Section 11, Q1).

---

## 1. Purpose

A partner admin who signs in today lands in a `/dashboard` surface that mixes two unrelated systems:
the real partner **Configurator** (7 equal-weight cards, one of which — "Developer" — silently
contains the two things partners most need: API details and Documentation) and a pile of **dead B2C
individual-subscriber pages** (My Plan, Sessions, Knowledge Base, Phone Setup, Settings) reachable
through a leftover B2C nav shell. Arun's instruction is decisive: *"our partners will login then they
need 3 things: 1. configurator … 2. api details … 3. documentation … they dont need anything else."*

This feature restructures the partner-facing dashboard down to exactly three destinations —
**Configurator / API / Docs** — behind a new lean 3-item nav shell, removes the dead B2C page
surfaces, splits the buried "Developer" card into distinct **API** and **Docs** surfaces, and
replaces the broken hard billing-redirect access gate with the wizard's existing
onboarding-completion gate plus a non-blocking billing-health banner.

**Failure without it:** partners see a confusing double dashboard; the API and Docs they need are
hidden inside one undifferentiated card; and the current `app/dashboard/layout.tsx` gate is latently
broken for net-new partner admins (it redirects anyone without an `active`/`trialing` `users` row —
which is every genuine partner admin — to `/plan`; see Section 6). Left alone, the day a partner admin
without a legacy B2C `users` row signs up, they are bounced to a consumer pricing page they should
never see.

---

## 2. User Story

**Primary — Partner admin (Clerk-authenticated, `partner_admin_users` row).**
- As a partner admin, I want to sign in and see only the three things I need — **Configurator**,
  **API**, **Docs** — with nothing from the retired consumer product, so that I can configure my
  integration, read the API reference, and find documentation without wading through irrelevant
  subscriber screens.
- As a partner admin, I want my API details (authentication, endpoints, webhook) on their own
  clearly-labelled **API** page, and product/usage/billing documentation on their own **Docs** page,
  so that "find the API keys" and "read the billing explainer" are each one click, not a hunt inside a
  "Developer" card.
- As a partner admin whose plan payment later fails or whose wallet runs low, I want a visible warning
  with a link to fix billing — but I do **not** want to be locked out of my own dashboard over it, so I
  can keep configuring and reading docs while I resolve the payment.

**Secondary — Internal Clio admin/operator (existing `/dashboard/admin/*` user).**
- As an internal admin, I want the admin console (`/dashboard/admin/clients`, `/glitches`,
  `/templates`, template progress) to keep working exactly as it does today, so that removing the B2C
  pages and the billing gate does not disturb my tools.

---

## 3. Trigger / Entry Point

- **Who:** a Clerk-authenticated user who administers at least one `partner_accounts` row
  (`getPartnerAccountsForClerkUser(userId)` returns ≥ 1). Consumer sign-up does not exist under the
  pivot; there is no anonymous entry to this surface.
- **State required:** signed in (Clerk session) **and** the active partner account's
  `partner_accounts.onboarding_completed_at` is set. If onboarding is incomplete, every Configurator
  page already redirects to `/dashboard/configurator/wizard` — that is the sole gate that remains
  (Approved Decision #2).
- **Routes (this brief's target end-state):**
  - `/dashboard` → server redirect to `/dashboard/configurator` (unchanged; `app/dashboard/page.tsx:4`).
  - `/dashboard/configurator` → **Configurator** home (6 cards; "Developer" card removed).
  - `/dashboard/configurator/api` → **API** (new route; split out of `developer/`).
  - `/dashboard/configurator/docs` → **Docs** (new route).
  - `/dashboard/configurator/api/playground` → **Playground** (moved from `developer/playground/`).
- **How activated:** page load (Next.js App Router server components) after Clerk auth. Navigation
  between the three destinations is via the new 3-item nav shell (Section 4.2) and the existing card
  grid; the account switcher continues to carry `?partner_account_id=<id>` in the URL query on every
  route (existing `_shared.tsx` convention, `_shared.tsx:52-54`).

---

## 4. Screen / Flow Description

This is **not** a redesign of any of the 6 Configurator sub-screens (Questionnaire, Topics, Content,
Domain, Integration, Visualization). Their internal functionality is untouched. Only three things
change structurally: (A) the Configurator home drops the "Developer" card; (B) a new 3-item nav shell
wraps the Configurator/API/Docs surface and carries the billing-health banner; (C) the old "Developer"
page is split into **API** and **Docs**, and the Playground moves under API.

### 4.1 Configurator home — `/dashboard/configurator`

Current state (`app/dashboard/configurator/HomeClient.tsx:79-124`): a 3-column grid of 6 cards
(Questionnaire, Topics, Content, Domain, Integration, **Developer**) followed by a full-width
Visualization card, above a "Design profile" progress bar.

**Change:** remove the **Developer** `DomainCard` (`HomeClient.tsx:105-109`) from the grid. The grid
then holds Questionnaire, Topics, Content, Domain, Integration (5 cards) + the Visualization full-width
card = the **6 Configurator sub-screens** the brief names. Everything else on this page — the design
profile bar, the welcome banner, the per-card status fetches — is unchanged.

- API and Docs are **not** cards on this grid; they are top-level nav items in the shell (Section 4.2).
- After the change, the home page must not contain any link whose text or href references "Developer"
  or `/dashboard/configurator/developer`.

### 4.2 New lean nav shell (additive) — wraps Configurator / API / Docs

**Why new:** the existing `ConfiguratorShell` (`_shared.tsx:36-87`) is a top-bar-only chrome (title +
account switcher + optional back link). It has **no** left-nav; navigation is via the home grid and
per-page back links. The brief requires "exactly 3 nav items: Configurator / API / Docs." This is a
**new component** that reuses the existing design system — it does **not** replace or delete
`ConfiguratorShell` or `DashboardShell.tsx`.

**Recommended implementation (technical decision — see Section 6 for why additive/wrapping):**
extend `ConfiguratorShell` in `_shared.tsx` to accept an optional `nav` region, OR add a sibling
`ConfiguratorNavShell` in `_shared.tsx` that renders the same top-bar chrome **plus** a 3-item nav
row/sidebar and the billing-health banner, then wrap the three destination clients in it. Either way:
reuse `COLORS`, `Card`, and the existing top-bar markup verbatim — **no new visual language**
(Section 10 constraint).

- **Nav items (labels fixed by Arun, in this order):**
  1. `Configurator` → `/dashboard/configurator?partner_account_id=<id>`
  2. `API` → `/dashboard/configurator/api?partner_account_id=<id>`
  3. `Docs` → `/dashboard/configurator/docs?partner_account_id=<id>`
- Active-item styling: reuse the purple-accent active treatment already used elsewhere (e.g. the
  `bg-purple-950/40` active style in `DashboardShell.tsx:55-57`, re-expressed with `COLORS.purple`) —
  no new palette values.
- The `?partner_account_id=<id>` query must be preserved on every nav link (same reason as the
  existing switcher: no implicit server-side current-partner state, `_shared.tsx:11-18`).
- **Billing-health banner** (Approved Decision #3) renders at the top of the shell content area, above
  the page body, on **all three** destinations. It is persistent and non-blocking (Section 4.5).

### 4.3 API page — `/dashboard/configurator/api`

Split out of the current `developer/` page. Contains the **Authentication card** + the **Endpoints
reference** + the **outbound usage webhook** reference — i.e. everything currently rendered by
`DeveloperDocsClient.tsx` (`developer/DeveloperDocsClient.tsx:57-85`), moved under the new "API" label
and nav shell, plus an "Open Playground →" action.

- The reference data (`ENDPOINTS`, `WEBHOOK_DOC`) continues to come from the hand-authored
  `content.ts` (moved to `api/content.ts` — Section 4.6). No AI generation, no network fetch
  (B2B-07 convention, `content.ts:11-12`).
- **API-keys checklist minimum bar (masking + one-click copy) — already satisfied, do not
  re-implement.** The Authentication card does **not** render keys; it links to the **Integration**
  card to generate credentials (`DeveloperDocsClient.tsx:109-111`). The Integration card
  (`configurator/integration/IntegrationClient.tsx`) **already** implements the checklist minimum: a
  reveal-once `client_secret` that is "shown once … will not be shown again"
  (`IntegrationClient.tsx:209,218`), a masked `••••••••••••` placeholder (`IntegrationClient.tsx:421`),
  and one-click copy buttons via `navigator.clipboard.writeText` (`IntegrationClient.tsx:181-187,
  205,214,459`). Integration is one of the 6 untouched Configurator cards. **Therefore the API page
  keeps the "Generate credentials →" link to Integration and does not surface or re-render keys
  itself.** Surfacing masked keys directly on the API page would mean touching Integration's
  reveal-once security model (net-new scope) — flagged as a future consideration, Section 10 / Section
  11 Q3.
- **Do not invent** key scoping, test/live environment separation, per-key last-used metadata, or
  rate-limit configuration. The endpoint reference already documents per-endpoint rate limits as static
  text (`content.ts:40,84,100,131`); that is reference documentation, not a configurable feature. Any
  larger capability is a future consideration, not built here (Section 10).

### 4.4 Docs page — `/dashboard/configurator/docs`

A **new** hand-authored page. Content, all hand-authored (no AI, no fetch):
1. **Getting-started quickstart** — a short, ordered walkthrough: create credentials (link to
   Integration) → obtain an OAuth token → make a first `POST /api/partner/v1/sessions` call → read
   status. Reuse the auth recipe already written in `DeveloperDocsClient.tsx:97-104`.
2. **API / webhook reference** — the same endpoint + webhook reference content as the API page,
   sourced from the shared `api/content.ts` (`ENDPOINTS`, `WEBHOOK_DOC`). (Reference content
   legitimately appears in both API and Docs; both import the one source module — no duplication of the
   data itself.)
3. **Plain-language billing explainer** — hand-authored prose explaining the prepaid-wallet model
   (unified `partner_wallets.balance_usd`), Plan tiers vs. top-ups (B2B-13), what a metered event costs
   at a high level, and what `past_due`/low-balance means. **Facts only, no invented pricing** — draw
   from the wallet response shape already documented (`content.ts:126-149`) and B2B-13 plan tiers
   (`lib/billing/plan-tiers.ts`). Do not state dollar prices that aren't already codified.

### 4.5 Billing-health banner (all three destinations)

Reads `partner_wallets` for the active partner account (columns confirmed present — Section 6).
- **Trigger states (LOCKED by CEO — Section 11 Q2 resolved):**
  - `partner_wallets.plan_status = 'past_due'` → warning banner. Copy: **"Your plan payment is past due.
    Add a payment method to avoid interruption. [Fix billing →]"**
  - `partner_wallets.plan_status = 'canceled'` → warning banner. Copy: **"Your plan has been canceled.
    Reactivate to keep your integration running. [Fix billing →]"**
  - Low balance → informational banner. Copy: **"Your usage balance is running low. Top up to avoid
    interruption. [Add funds →]"** Drive this **off the existing `low_balance_alert_fired_at` signal**
    (`075_…:49-52`) — i.e. show when `low_balance_alert_fired_at IS NOT NULL`. **Do NOT invent a new
    numeric threshold.** If that signal cannot cleanly express "currently low" (e.g. it is never reset on
    top-up), the dev **falls back to plan-status-only** for v1 and logs the low-balance sub-case to
    `BACKLOG.md` as a follow-up — never a hand-picked balance threshold.
  - Otherwise (`plan_status` = `active` or `NULL`, healthy balance) → **no banner**.
- **No invented dollar figures in banner copy.** Strings above are fixed; do not add prices.
- **"Fix billing" / "Add funds" link target (LOCKED by CEO):** point at the Docs billing explainer this
  brief builds — **`/dashboard/configurator/docs#billing`** — NOT a new page. There is no partner-facing
  self-serve billing/top-up surface today (`PartnerBillingClient` under `admin/clients` is the *internal
  Clio* view, not partner-facing), so the Docs billing explainer (Section 4.4 item 3) MUST include the
  concrete resolution path for a `past_due`/`canceled`/low-balance state (e.g. how to update payment /
  top up, or "contact your Clio account manager" until self-serve exists). **Product gap noted for a
  future brief:** no partner-facing self-serve billing/top-up action surface exists yet — surfaced to
  Arun as a note, not built here.
- **Behavior (fixed by Approved Decision #3 — not open):** persistent, **non-blocking**. Configurator,
  API, and Docs remain fully visible and usable. The banner shows a short warning + a "Fix billing"
  link. **Designing any action-level restriction (e.g. blocking a live session on `past_due`) is
  explicitly OUT of scope** — do not gate dashboard *viewing*.
- **Data source:** a server read of `partner_wallets` by `partner_account_id`. No new table, no new
  column — Section 6 confirms `plan_status` and `balance_usd` exist.

### 4.6 File split (technical decision — resolved here, was brief OQ #4)

| Current file | Action | New path |
|---|---|---|
| `app/dashboard/configurator/developer/page.tsx` | rename/move → API server gate | `app/dashboard/configurator/api/page.tsx` |
| `app/dashboard/configurator/developer/DeveloperDocsClient.tsx` | rename → API client | `app/dashboard/configurator/api/ApiClient.tsx` |
| `app/dashboard/configurator/developer/content.ts` | move (shared reference data) | `app/dashboard/configurator/api/content.ts` |
| `app/dashboard/configurator/developer/playground/page.tsx` | move | `app/dashboard/configurator/api/playground/page.tsx` |
| `app/dashboard/configurator/developer/playground/PlaygroundClient.tsx` | move | `app/dashboard/configurator/api/playground/PlaygroundClient.tsx` |
| — | **new** Docs server gate | `app/dashboard/configurator/docs/page.tsx` |
| — | **new** Docs client | `app/dashboard/configurator/docs/DocsClient.tsx` |
| `app/dashboard/configurator/developer/` | delete empty dir after move | — |

- `ApiClient.tsx`, `PlaygroundClient.tsx`, and `DocsClient.tsx` all import the reference data from
  `api/content.ts` (Playground via `../content`, Docs via `../api/content`). `content.ts` is imported
  by both the API client and the Playground client today (`DeveloperDocsClient.tsx:6`,
  `playground/PlaygroundClient.tsx:7`) — keeping it as the single source under `api/` preserves both.
- The API and Playground server gates keep their existing Clerk-auth + `NoPartnerAccounts` +
  wizard-redirect logic verbatim (`developer/page.tsx:14-38`); only import paths for `_shared` change
  (`../_shared` stays `../_shared` from `api/`, becomes `../../_shared` from `api/playground/`).
- **Playground placement:** confirmed under **API** (brief OQ #3 resolved — it is a live API-call test
  tool; API is its natural home; no reason found to place it elsewhere).

### 4.7 `app/dashboard/layout.tsx` — Approved Decision #1 (exact)

Replace the entire billing gate with a Clerk-session-only check:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')
  return <>{children}</>
}
```

Removed: the `x-pathname` / `/dashboard/welcome` exemption (`welcome` was deleted in B2B-14 — dead
branch), the `createSupabaseAdminClient()` + `users` `subscription_status`/`plan_tier` query
(`layout.tsx:17-26`), and the `redirect('/plan')` (`layout.tsx:28-30`). The `headers`, `createSupabase…`
imports become unused and must be dropped. This is the only gate change; the per-page wizard gate
(Approved Decision #2) is untouched and remains.

---

## 5. Visual Examples (text wireframes)

**Configurator home — after Developer card removed:**
```
┌──────────────────────────────────────────────────────────────┐
│ Clio Configurator            [Acme Corp ▾ account switcher]   │  ← top bar (_shared)
├──────────────────────────────────────────────────────────────┤
│ [ Configurator ] [ API ] [ Docs ]                            │  ← NEW 3-item nav
│ ⚠ Payment past due — Fix billing →      (only if unhealthy)  │  ← NEW banner (non-blocking)
├──────────────────────────────────────────────────────────────┤
│ Design profile: 62% [██████░░░░]                             │
│                                                              │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                │
│ │Questionnaire│ │  Topics    │ │  Content   │                │
│ └────────────┘ └────────────┘ └────────────┘                │
│ ┌────────────┐ ┌────────────┐                                │  ← Developer card GONE
│ │  Domain    │ │Integration │                                │
│ └────────────┘ └────────────┘                                │
│ ┌──────────────────────────────────────────────┐            │
│ │ Visualization — Theme: … · N templates    Open →│           │
│ └──────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

**API page — `/dashboard/configurator/api`:**
```
┌──────────────────────────────────────────────────────────────┐
│ Clio Configurator            [Acme Corp ▾]                    │
│ [ Configurator ] [ API ] [ Docs ]      ← "API" active         │
│ (billing banner if unhealthy)                                │
├──────────────────────────────────────────────────────────────┤
│ API                                    [ Open Playground → ] │
│ Reference for the 4 partner endpoints + the usage webhook.   │
│ ┌── Authentication ─────────────────────────────────────┐   │
│ │ OAuth2 Client Credentials …                           │   │
│ │ POST /api/partner/v1/oauth/token  (code block)        │   │
│ │ [ Generate credentials → ]  (links to Integration)    │   │
│ └───────────────────────────────────────────────────────┘   │
│ Endpoints                                                    │
│ ┌── POST /api/partner/v1/sessions ──────────────────────┐   │
│ │ request fields · example req/res · other responses    │   │
│ └───────────────────────────────────────────────────────┘   │
│ … (sessions_get, usage, wallet) …                            │
│ Outbound usage webhook  ┌── POST {…}/webhooks/usage ──┐      │
└──────────────────────────────────────────────────────────────┘
```

**Docs page — `/dashboard/configurator/docs`:**
```
┌──────────────────────────────────────────────────────────────┐
│ [ Configurator ] [ API ] [ Docs ]      ← "Docs" active        │
├──────────────────────────────────────────────────────────────┤
│ Docs                                                         │
│ ┌── Getting started ────────────────────────────────────┐   │
│ │ 1. Generate credentials → 2. Get a token →            │   │
│ │ 3. Start a session → 4. Read status                   │   │
│ └───────────────────────────────────────────────────────┘   │
│ ┌── API & webhook reference ────────────────────────────┐   │
│ │ (endpoint + webhook reference, from api/content.ts)   │   │
│ └───────────────────────────────────────────────────────┘   │
│ ┌── Billing explained ──────────────────────────────────┐   │
│ │ Prepaid wallet · Plan tiers vs top-ups · past_due …   │   │
│ └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Billing-health banner (unhealthy state) — reused across all three:**
```
┌──────────────────────────────────────────────────────────────┐
│ ⚠  Your plan payment is past due. Some features may be        │
│    limited. [ Fix billing → ]                          [ × ] │  ← non-blocking; page fully usable
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

**Reads:**
- `partner_accounts.onboarding_completed_at` — per-page wizard gate (already read in every Configurator
  server page, e.g. `developer/page.tsx:28-36`). Unchanged.
- `getPartnerAccountsForClerkUser(userId)` → `AdminPartnerAccount[]` — which partner accounts the Clerk
  user administers. Unchanged (`lib/partner/admin-accounts`).
- **`partner_wallets` (NEW read, for the banner)** by `partner_account_id`. Columns confirmed present:
  - `balance_usd NUMERIC(14,6) NOT NULL DEFAULT 0` (`075_b2b04_billing_metering.sql:22`)
  - `plan_status TEXT` CHECK `IN ('active','past_due','canceled')` or `NULL`
    (`081_b2b13_plan_tiers_and_topups.sql:36-39`)
  - `reference_topup_amount_usd NUMERIC(14,6)` + `low_balance_alert_fired_at TIMESTAMPTZ` — existing
    80%-consumed low-balance model (`075_…:49-52`), available if the low-balance banner state is
    adopted (Section 11 Q2).
- Reference data `ENDPOINTS` / `WEBHOOK_DOC` from `api/content.ts` (hand-authored constant module — not
  a DB read, not a network call).

**Writes:** none. This feature adds no write path. (The banner is read-only; "Fix billing" links to an
existing billing surface — target TBD in Section 11 Q2.)

**APIs called:** the API-page/home per-card status fetches are unchanged (`HomeClient.tsx:29-38` calls
existing `/api/admin/configurator/*` routes). The Playground continues to call the live
`/api/partner/v1/*` routes from the browser (`playground/PlaygroundClient.tsx`), unchanged.

**localStorage / sessionStorage:** none added.

**Access-gate contradiction — investigated and resolved (brief §6 / OQ #5):**
- The partner-signup webhook `app/api/webhooks/clerk-organization/route.ts` creates `partner_accounts`
  (line 62-67) and `partner_admin_users` (line 110-116) rows only — **never** a `users` row (confirmed;
  matches the brief).
- However, the base user webhook `app/api/webhooks/clerk/route.ts` fires on Clerk `user.created`
  (line 67) and upserts a `users` row with **only** `{ id, email, phone }` (line 90-95) — no
  `subscription_status`. The `users.subscription_status` column DEFAULT is `'inactive'`
  (`001_initial.sql`). So a genuine partner admin's `users` row is `subscription_status = 'inactive'`.
- In the current `layout.tsx` gate, `hasAccess = status IN ('active','trialing')` → **false** for that
  row → `redirect('/plan')`. **So the current gate should bounce every net-new partner admin to
  `/plan`.** `app/dashboard/configurator` has **no nested layout** overriding this — the only layout
  under `/dashboard` is `app/dashboard/layout.tsx` (confirmed: `find app/dashboard -name layout.tsx`
  returns exactly one).
- **Most likely explanation (dev must confirm empirically):** the accounts that "demonstrably reach"
  the Configurator are legacy/seeded accounts (Arun's, team test accounts) that carry an
  `active`/`trialing` `users` row left over from B2C-era Stripe testing, masking the latent bug; or the
  Clerk user webhook is not wired in the tested environment so `.single()` returns null and the gate
  behaves inconsistently. Either way the current gate is **latently broken** for a clean partner admin.
- **Consequence for Approved Decision #1:** removing the gate can only ever **unblock** partner-admin
  access — it cannot break any live access path, because the gate today grants access only to rows with
  `active`/`trialing` status, which no genuine partner admin has by default. This is the reassurance the
  brief asked for: the removal is safe. The developer must still confirm empirically (Section 7,
  AC-13) that after removal a partner admin with an `inactive`/absent `users` row reaches
  `/dashboard/configurator`.

---

## 7. Success Criteria (Acceptance Tests)

Each is verifiable by QA. Grep commands are run from repo root.

**Structure — 3 destinations + nav**
- **AC-1 (happy path):** Given a signed-in partner admin with `onboarding_completed_at` set, when they
  load `/dashboard/configurator`, then they see the 6 Configurator cards (Questionnaire, Topics,
  Content, Domain, Integration, Visualization) and the 3-item nav (Configurator / API / Docs), and
  **no** "Developer" card. Verify: `rg -n "Developer" app/dashboard/configurator/HomeClient.tsx`
  returns **no** match, and `rg -n "/dashboard/configurator/developer" app` returns **no** match.
- **AC-2:** The three route directories exist and the old one is gone:
  `test -d app/dashboard/configurator/api && test -d app/dashboard/configurator/docs && test -d
  app/dashboard/configurator/api/playground && ! test -d app/dashboard/configurator/developer` → true.
- **AC-3:** Exactly three nav labels render, in order `Configurator`, `API`, `Docs`, on each of the
  three destination pages, each linking to its route with `?partner_account_id=` preserved.
- **AC-4:** The API page renders the Authentication card, all 4 endpoints from `ENDPOINTS`, and the
  webhook card, and an "Open Playground →" link to `/dashboard/configurator/api/playground`. Verify the
  reference data still comes from the hand-authored module:
  `rg -n "from './content'|from '../content'|from '../api/content'" app/dashboard/configurator/api app/dashboard/configurator/docs`
  returns matches; and no AI/fetch call populates it (`rg -n "anthropic|fetch\(|generate" app/dashboard/configurator/docs` returns no content-generation call).

**API keys minimum bar (already satisfied — must remain)**
- **AC-5:** The Integration card still masks the secret and offers copy: `rg -n "•|clipboard|shown
  once" app/dashboard/configurator/integration/IntegrationClient.tsx` returns matches (unchanged from
  today). The API page links to Integration for credentials and does not render a raw
  `client_secret` value itself.

**Docs content**
- **AC-6:** The Docs page contains three hand-authored sections — getting-started quickstart, API/webhook
  reference, and a billing explainer — with no dollar figure that is not already codified in
  `content.ts`/`lib/billing/plan-tiers.ts`.

**Access gate (Approved Decision #1)**
- **AC-7:** `app/dashboard/layout.tsx` contains only the Clerk `userId` check + `redirect('/sign-in')`;
  it no longer queries `users` or redirects to `/plan`. Verify:
  `rg -n "subscription_status|plan_tier|redirect\('/plan'\)|createSupabaseAdminClient|x-pathname" app/dashboard/layout.tsx`
  returns **no** match.
- **AC-13 (empirical):** A partner admin whose `users` row is absent or `subscription_status='inactive'`
  loads `/dashboard/configurator` and is **not** redirected to `/plan` — they reach the Configurator
  (verifying Decision #1 unblocks the previously-broken path; Section 6).

**Billing banner (Approved Decision #3)**
- **AC-8:** Given `partner_wallets.plan_status='past_due'` for the active account, when any of the three
  destinations loads, then the non-blocking banner shows with a "Fix billing" link **and** the page body
  (cards / API reference / docs) remains fully rendered and interactive (not hidden, not redirected).
- **AC-9 (healthy state):** Given `plan_status='active'` (or `NULL`) and a healthy balance, no banner
  renders.

**Removals & no dangling references**
- **AC-10:** The confirmed-removable dashboard page surfaces (Section 8 "Delete") no longer exist:
  `for d in plan sessions knowledge-base phone settings schedule-setup walkthrough; do test ! -e app/dashboard/$d && echo "$d gone"; done` prints all seven.
- **AC-11 (no 404 links):** No surviving code links to a deleted `/dashboard/*` page. Verify:
  `rg -n "/dashboard/(plan|sessions|knowledge-base|phone|settings|schedule-setup|walkthrough)" app components lib` returns **no** match. (Note: top-level public `/walkthrough` — `app/walkthrough/` — and its middleware entry are a **different** route and must survive; AC-12.)
- **AC-12:** `DashboardShell.tsx` still exists and its admin importers still resolve:
  `test -f components/dashboard/DashboardShell.tsx` true, and the four admin pages +
  `PartnerBillingClient` still import it (`rg -l "DashboardShell" app/dashboard/admin` → 5 files). The
  top-level public `app/walkthrough/` route and the `/walkthrough/(.*)` middleware entry are untouched.

**Build health**
- **AC-14:** `npx tsc --noEmit` is clean.
- **AC-15:** `npm run build` succeeds with zero errors.
- **AC-16:** `rg -n "/dashboard/configurator/developer" .` returns no match anywhere in `app`,
  `components`, `lib` (all references migrated to `api`/`docs`).

---

## 8. Error States

- **`partner_wallets` read fails or returns no row (banner):** treat as **healthy** — render **no**
  banner (fail-open). The banner is an advisory; a DB hiccup must never inject a false "past due"
  warning nor block the page. Log server-side; do not surface an error to the partner.
- **`getPartnerAccountsForClerkUser` returns 0:** render the existing `<NoPartnerAccounts />`
  (`_shared.tsx:138-144`) — unchanged behavior.
- **Onboarding incomplete:** existing wizard redirect fires (`developer/page.tsx:34-36` pattern, carried
  into `api/page.tsx` and `docs/page.tsx`). Unchanged.
- **Not signed in:** `layout.tsx` → `redirect('/sign-in')` (Decision #1). Unchanged from a partner's
  point of view.
- **Slow `partner_wallets` read:** it is a single indexed lookup by `partner_account_id` (unique); it
  is part of the server render. If it must be awaited, keep it fast/optional — if it would materially
  delay first paint, render the page first and hydrate the banner, or skip it (fail-open) rather than
  block. (Technical latitude for the dev; the invariant is: the banner never blocks or delays the three
  destinations.)
- **"Fix billing" link target missing:** until Section 11 Q2 fixes the target, the dev must point it at
  an existing billing surface (do not invent a new page); if none is confirmed, the link is a
  placeholder logged in `BACKLOG.md`, not a 404.

---

## 9. Edge Cases

- **Multi-account admin:** the account switcher (`_shared.tsx:68-82`) already scopes every route by
  `?partner_account_id=`. The banner must read `partner_wallets` for the **active** account in the URL,
  and re-read when the switcher changes accounts.
- **Partner admin with a legacy B2C `users` row (`active`/`trialing`):** after Decision #1 they still
  reach the Configurator — behavior is unchanged for them; only the mechanism (no longer gate-dependent)
  changes.
- **Net-new partner admin (`inactive`/no `users` row):** previously would have been bounced to `/plan`;
  now correctly reaches the Configurator (AC-13). This is the bug Decision #1 fixes.
- **Internal admin on `/dashboard/admin/*`:** admin pages self-authorize (`auth()` + own admin check,
  e.g. `admin/clients/page.tsx:9`); removing the billing gate does not affect them — they were never
  subscription-gated. The Clerk session check in `layout.tsx` is retained, so unauthenticated admin
  access still redirects to `/sign-in`.
- **`plan_status = NULL`** (partner on pure prepaid top-ups, no recurring Plan): healthy — no payment
  banner; only a low-balance banner could apply (Section 11 Q2).
- **Playground move:** existing Playground callers/links must be updated to the new path; verify no link
  still points at `/dashboard/configurator/developer/playground` (part of AC-16).
- **Mobile vs desktop:** the new nav shell must be usable on mobile. The existing `ConfiguratorShell` is
  a simple top-bar layout (not the mobile-bottom-bar `DashboardShell`); the 3-item nav should degrade to
  a horizontal row on narrow widths. No new design language — mirror the existing top-bar spacing.

---

## 10. Out of Scope

- **Redesigning any of the 6 Configurator sub-screens.** Questionnaire, Topics, Content, Domain,
  Integration, Visualization keep their exact current functionality; only the home grid framing and the
  wrapping nav change.
- **New API capabilities:** key scoping, test/live environment separation, per-key last-used metadata,
  configurable rate limits. Documented as **future considerations**, not built.
- **Surfacing/masking API keys on the API page itself.** The minimum bar is already met on the
  Integration card; moving key display to the API page would mean reworking Integration's reveal-once
  model — future consideration (Section 11 Q3).
- **Action-level billing restriction** (e.g. blocking a live session when `past_due`). Explicitly out of
  scope per Approved Decision #3 — only the non-blocking banner is built.
- **AI-generated Docs content.** Docs is hand-authored only (B2B-07 convention).
- **Deleting `components/dashboard/DashboardShell.tsx`** — admin surface depends on it (keep).
- **Touching the shared voice/session engine** (`lib/voice`/`HumeAdapter`, `lib/session-*`,
  `lib/content/script-generator`, `lib/content/rtv03-tracker`, `components/templates/SessionStack`,
  `components/kb/VisualizationTabPanel`, `components/live-conductor/*`, the session/curriculum/rtv
  Inngest jobs, `app/api/webhooks/*`). Confirmed shared with the live partner path
  (`app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` imports `HumeAdapter` from
  `@/lib/voice/hume-adapter`) — only individual-facing dashboard **page** surfaces are removed.
- **Touching** `app/dashboard/admin/*`, `app/partner-render/*`, `app/partner-questionnaire/*`,
  `app/partner-signup/*`, `app/walkthrough/*` (public bot route), or the `app/(marketing)` homepage.
- **Deleting the B2C individual-signup chain** (`app/onboarding`, `app/topics`, `app/plan`,
  `app/(marketing)/pricing`, `app/checkout`, `app/api/onboarding/account-state`, the auth-page
  `forceRedirectUrl`s). This chain is **still reachable** (Section 11 Q1) and retiring it exceeds Arun's
  literal instruction — deferred to Q1. **`app/checkout/` is therefore NOT deleted by this brief.**
- **`middleware.ts` public-route edits.** Because the signup chain is retained (Q1), no `isPublicRoute`
  entry is removed. The only deletions are `/dashboard/*` subpages (protected routes, not in the public
  list) and `app/dashboard/walkthrough/` (whose middleware entry `/walkthrough/(.*)` belongs to the
  **top-level** public `app/walkthrough/`, which survives). **Net middleware diff for this brief: none.**
  (If Arun approves retiring the chain under Q1, the middleware diff for `/plan`, `/checkout`,
  `/pricing`, `/topics`, `/onboarding` is specified as a follow-up, not here.)

---

## 11. Open Questions

**Q1 — Retire the B2C individual-signup chain? (needs Arun — product/scope decision.)**
Traced precisely (Section 6 groundwork; route sweep evidence below). The chain
`app/onboarding → /api/onboarding/account-state → /topics → /plan → /checkout` is **still fully wired
AND still reachable** — it is **not** orphaned:
- `MarketingNav.tsx:34-41` links **"Pricing" → `/pricing`**, and `app/(marketing)/pricing/page.tsx:43,62,80`
  has three CTAs → **`/onboarding`**. (B2B-12 redirected the *homepage* "Get started" CTA to
  `/partner-signup` — `MarketingNav.tsx:52-58` — but the Pricing page's own CTAs still point to the B2C
  flow.)
- `app/(auth)/sign-up/[[...sign-up]]/page.tsx:9` sets `forceRedirectUrl="/onboarding"`; `sign-in`
  `signUpForceRedirectUrl="/onboarding"` (`sign-in/[[...sign-in]]/page.tsx:10`). Any direct `/sign-up`
  → `/onboarding`.
- Deleting `app/checkout/` in isolation would orphan `account-state/route.ts:79` (`resumeUrl:'/checkout'`),
  `app/plan/PlanClient.tsx:73`, and `app/(marketing)/pricing/page.tsx:95` → dangling links to a 404.

**BA recommendation:** the strong likelihood under the B2B pivot is that the entire individual-signup
chain is dead product and should be retired **as one unit** — but that expands scope well beyond what
Arun literally named ("partners need 3 things"), touches the still-live curriculum/session engine that
B2B-14 deliberately held back (`/onboarding`, `/topics`), and is a public-marketing decision, not a
dashboard one. **So this brief does NOT delete `app/checkout/` or any chain member.** Escalating for a
one-line decision:
  - **(a) Retire the whole chain** (delete `app/onboarding`, `app/topics`, `app/plan`,
    `app/(marketing)/pricing`, `app/checkout`, `app/api/onboarding/account-state`; repoint auth
    `forceRedirectUrl`s to `/partner-signup` or `/dashboard/configurator`; drop the Pricing nav link;
    strip the corresponding `middleware.ts` public routes) — as a **follow-up brief (B2B-17)**, with its
    own orphan sweep of `app/api/onboarding/*` and the curriculum/session engine; **or**
  - **(b) Keep the chain** for now (do nothing to it in B2B-16).
Either answer leaves B2B-16 shippable as specified. **STATUS: NON-BLOCKING ESCALATION to Arun — this
exact question is already in flight separately (a parallel feature-audit surfaced the same finding);
do NOT duplicate the ask.** The BA correctly scoped B2B-16 to leave `app/checkout/` and the whole chain
alone (Section 10 / Appendix A "DEFER"), so B2B-16 ships regardless of Arun's eventual answer. If Arun
says "retire," that becomes follow-up brief **B2B-17**, not a change to this build. **This item does NOT
gate B2B-16.**

**Q2 — RESOLVED by CEO (2026-07-17).** Banner copy, triggers, and link target are now **LOCKED in
Section 4.5**. Summary of the decision:
  - **Triggers:** `plan_status='past_due'` and `plan_status='canceled'` are the primary (hard-confirmed
    columns) warning states; low-balance is a secondary informational state driven **off the existing
    `low_balance_alert_fired_at` signal** — no new numeric threshold; fall back to plan-status-only + a
    `BACKLOG.md` note if that signal can't cleanly express "currently low."
  - **Copy:** three fixed factual strings (Section 4.5), no invented dollar figures.
  - **Link target:** `/dashboard/configurator/docs#billing` (the Docs billing explainer this brief
    builds) — NOT a new page. The Docs billing explainer must include the concrete resolution path.
  - **Product-gap note:** no partner-facing self-serve billing/top-up action surface exists yet; noted
    for a future brief, surfaced to Arun, not built here.

**Q3 — RESOLVED by CEO (2026-07-17): keep link-only (link to Integration for credentials).**
Approved the BA recommendation. Surfacing keys on the API page would require reworking Integration's
reveal-once security model (net-new scope) AND would create a second surface that displays/handles
secrets — a larger attack surface and a consistency risk. The masking + one-click-copy minimum bar is
already met on the Integration card. The API page's Authentication card keeps **"Generate credentials →"
→ Integration** and does not render keys itself. "Consolidate keys onto the API page" is a **future
consideration, not built here.** (One canonical place for secrets is also the executive-UX-correct
choice.)

**Resolved (were brief OQs — closed here, not open):**
- Brief OQ #3 (Playground placement) → **resolved: under API** (`/dashboard/configurator/api/playground`).
- Brief OQ #4 (route paths / file split) → **resolved:** Section 4.6 table.
- Brief OQ #5 (access-gate contradiction) → **resolved:** Section 6; removal is safe (strictly
  unblocks). Residual empirical check is AC-13, a dev verification step, not an open product question.

---

## 12. Dependencies

- **B2B-03/B2B-05** — the Configurator surface, `_shared.tsx` design system, and per-page wizard gate
  must exist (they do). The new nav shell reuses `_shared.tsx` (`ConfiguratorShell`/`Card`/`COLORS`).
- **B2B-07** — the Developer/`content.ts` reference module (source of the API and Docs reference
  content, and the hand-authored-only convention). Present.
- **B2B-13** — `partner_wallets.plan_status` / `plan_tier_key` / `plan_billing_period` columns
  (migration `081`) that the banner and the billing explainer read. Applied.
- **B2B-04/B2B-08** — `partner_wallets.balance_usd`, `reference_topup_amount_usd`,
  `low_balance_alert_fired_at` (migrations `075`, `077`). Applied.
- **B2B-14** — established the "`DashboardShell` is shared with admin, do not delete" constraint and
  removed `/dashboard/welcome`; this brief builds directly on that (the `welcome` exemption removal in
  Decision #1). No conflict.
- **`lib/partner/admin-accounts`** (`getPartnerAccountsForClerkUser`, `AdminPartnerAccount`) and
  `lib/supabase` (`createSupabaseAdminClient`) — used unchanged by the API/Docs server gates and the
  banner read.
- **No new migrations, no new packages, no new env vars.** All required columns and libraries already
  exist.
- **Blocks nothing downstream**; Q1 (if answered "retire") would spawn a follow-up brief (B2B-17), not
  block B2B-16.

---

### Appendix A — Finalized Remove List (post-sweep)

**DELETE (confirmed-removable individual-subscriber dashboard page surfaces):**
- `app/dashboard/plan/` (`page.tsx`, `PlanClient.tsx`) — imports `DashboardShell` + `ScheduleCard`.
- `app/dashboard/sessions/` (`page.tsx`, `[id]/page.tsx`, `[id]/SessionDetailClient.tsx`).
- `app/dashboard/knowledge-base/` (`page.tsx`, `[topicId]/page.tsx`, `rules/page.tsx`).
- `app/dashboard/phone/` (`page.tsx`).
- `app/dashboard/settings/` (`page.tsx`).
- `app/dashboard/schedule-setup/` (`page.tsx`).
- `app/dashboard/walkthrough/` (`page.tsx`, `WalkthroughClient.tsx`) — Clerk-auth individual live view;
  dead under the pivot (partner end-users are anonymous via `/partner-render/[ref]`).

**KEEP (must not delete):**
- `components/dashboard/DashboardShell.tsx` — imported by `app/dashboard/admin/clients/page.tsx`,
  `admin/clients/PartnerBillingClient.tsx`, `admin/glitches/page.tsx`, `admin/templates/page.tsx`,
  `admin/templates/[templateName]/progress/page.tsx` (5 live admin importers, verified) in addition to
  the 9 dead B2C pages above. Delete only the dead pages; the component stays for admin.
- `app/dashboard/page.tsx` (redirect → `/dashboard/configurator`), `app/dashboard/admin/*`,
  `app/walkthrough/*` (public bot route), and the entire shared voice/session engine (Section 10).

**DEFER (do NOT delete in this brief):**
- `app/checkout/` — still reachable via the signup chain (Section 11 Q1). Deferred to Q1.

**ORPHAN-FLAG (do NOT auto-delete; confirm separately after the deletions land):**
- `components/dashboard/ScheduleCard.tsx` — sole importer is `app/dashboard/plan/PlanClient.tsx` (being
  deleted). Becomes orphaned. Flag for a follow-up cleanup; do **not** silently delete as part of
  B2B-16 (per the brief's "orphaned by these pages ≠ dead" discipline).
- Any `lib/*`, `components/*`, or `inngest/*` module imported by a deleted page: the developer must run
  the per-module importer sweep. **Confirmed still-shared (KEEP untouched):** `lib/voice`/`HumeAdapter`
  (also imported by `app/partner-render/.../PartnerRenderClient.tsx`), `lib/session-plan`,
  `lib/content/script-generator`, `lib/session-ai`, `lib/content/rtv03-tracker`,
  `components/templates/SessionStack`, `components/kb/VisualizationTabPanel`,
  `components/live-conductor/LiveConductorVisual` — all part of the live partner path. Anything found
  to be genuinely sole-imported by a deleted page and by nothing on the live partner path is
  **flagged, not deleted**, in this brief.

**Sweep methodology (developer must execute before finalizing deletions):**
1. For each deleted page, list its imports.
2. For each imported `lib/*` / `components/*` / `inngest/*` module, `rg -l` its importers across `app`,
   `components`, `lib`, `inngest`.
3. If any importer survives (especially the live partner path: `app/partner-render/*`,
   `app/api/webhooks/hume`, `app/api/recall/webhook`, `app/api/attendee/webhook`, `lib/session-billing`)
   → **KEEP** the module untouched.
4. If the only importers were deleted pages → **FLAG** it in `BACKLOG.md` as "orphaned by B2B-16,
   confirm before delete" — do **not** delete it in this brief.
5. Confirm no surviving code references any deleted route path (AC-11, AC-16).
