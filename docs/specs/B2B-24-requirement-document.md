# B2B-24 — Configurator Dashboard / Overview (landing screen) — Requirement Document
Version: 1.0
Status: APPROVED — CEO approved 2026-07-18 (approval note: cleared for Dev pending B2B-23's
required-set update landing in code, per §12's sequencing note)
Author: Business Analyst Agent
Date: 2026-07-18
Source brief: `.claude/agents/clio/feature-briefs/B2B-24-configurator-dashboard-overview-landing.md`

> Scope in one line: add a **Dashboard** tab — pinned first in the Configurator's left nav
> (`ConfiguratorSurface.tsx`) and the **new default landing destination** for that route — composed
> of four read-only areas (setup glimpse, live status, wallet snapshot, quick-nav) built entirely from
> data sources B2B-20/B2B-16 already expose. No new configuration capability, no new API routes, no
> glitch/bug data.

---

## 1. Purpose

Today `/dashboard/configurator` opens **directly into a configuration section** — `page.tsx` resolves
the landing section to the first incomplete section (or Questionnaire once live). There is no
at-a-glance overview. A partner who signs in — especially a *returning* partner making a quick
adjustment to a live integration, the dominant mode per CORE_OBJECTIVES Objective 4 — has to
reconstruct their own state by clicking through sections one at a time to answer basic questions: Am I
live? Since when? What's left before I can go live? How much balance is in my wallet? Where do I go for
API keys or docs?

Every modern developer/SaaS console in Clio's own benchmark set (Stripe, Anthropic, Resend — B2B-16's
reference set) opens on an overview that answers those questions in one glance, then routes the partner
to what they came to do. This feature adds that missing front door: a **Dashboard** that is the first
item in the left nav and the default landing destination, surfacing status and routing — not a new
place to configure anything.

**Failure without it:** partners keep reconstructing their own state by clicking through sections one
at a time; a returning partner's "quick adjustment" (the dominant use case) stays slower than it needs
to be; wallet balance stays buried in a small top banner most partners will miss until it's a "past
due" emergency.

---

## 2. User Story

**Primary — returning partner (already live), adjusting one thing:**
> As a partner admin who has already gone live,
> I want to land on a single overview screen that tells me I'm live, since when, my wallet balance, and
> gives me one-click access to Configurator sections / API / Docs,
> So that I don't have to click through sections to reconstruct what I already know.

**Secondary — partner mid-setup (not yet live):**
> As a partner admin who hasn't finished required setup,
> I want the Dashboard to tell me exactly what's left before I can go live, in priority order, with one
> click to the next thing I need to do,
> So that I don't have to guess which section still needs attention.

**Tertiary — brand-new partner, nothing configured:**
> As a partner admin who just signed up,
> I want the Dashboard to be a clear, non-intimidating starting point that tells me where to begin,
> So that I'm not dropped cold into a form with no context.

---

## 3. Trigger / Entry Point

- **Route:** `/dashboard/configurator` (unchanged). Section selection is still expressed via
  `?section=<key>` (unchanged mechanism, B2B-20 §6.1/§6.4).
- **New valid section value:** `dashboard` — added to the existing `PanelSection` union
  (`ConfiguratorSection | 'go_live'` → `ConfiguratorSection | 'go_live' | 'dashboard'`) in both
  `app/dashboard/configurator/page.tsx` (`VALID_SECTIONS`) and
  `app/dashboard/configurator/ConfiguratorSurface.tsx` (`PanelSection`, `SECTION_LABEL`, the
  `renderPanel` switch).
- **What triggers it:** page load of `/dashboard/configurator`, Clerk-authenticated, partner-admin-only
  — identical auth/entry model as B2B-20. No auth changes.
- **New default-landing rule (replaces B2B-20 §3's first-incomplete default — see §4.6 below for the
  full resolution):** an explicit valid `?section=` still always wins. Absent that, **every** partner —
  brand-new, returning-not-live, or live — lands on **Dashboard**. The prior "live → Questionnaire" /
  "not-live → first-incomplete section" branching in `page.tsx` is removed.
- **Placement in the nav hierarchy:** Dashboard sits **inside** the Configurator content area, beneath
  `ConfiguratorNavShell`'s Configurator/API/Docs tab row — same boundary B2B-20 respected.
  `ConfiguratorNavShell` is **not** touched (brief Known Constraint 4).

---

## 4. Screen / Flow Description

### 4.1 Left nav pane — new pinned top entry

Above the three existing groups ("Learning experience", "Delivery & integration", "Billing") and above
the (removed, see §4.6) "Start here" hint, a single new pinned nav row:

- **"Dashboard"** — full-width clickable row, **no completion dot** (Dashboard has no complete/incomplete
  state — it isn't a configurable section). Active-state styling identical to existing `NavRow`: 3px
  purple `#7C3AED` left border, white text, `rgba(124,58,237,0.10)` background when selected; muted
  `#94A3B8` text / transparent background when not selected, hover → `#1A1A1A` background + white text.
  Visually separated from the groups below it by the same treatment the pinned "Go Live" row already
  uses at the bottom (a `border-t` divider), so the pane reads: **[Dashboard] · Learning experience… ·
  Delivery & integration… · Billing… · [Go Live]**.
- Clicking it calls the existing `selectSection('dashboard')`, which updates `?section=dashboard` and
  swaps the main panel — identical mechanism to every other nav item, no new routing logic.

### 4.2 Main panel — Dashboard content, four areas

Renders inside the existing `<main>` panel, reusing the existing `AnimatePresence`/`motion.div`
section-switch wrapper that already surrounds `renderPanel`'s output (no new motion code needed —
Dashboard is just another case in the same switch).

Panel heading: **"Dashboard"** (H1, matches the pattern every other panel uses, e.g. GoLivePanel's `<h1>Go
Live</h1>`).

Layout: a responsive grid of four card areas (Tailwind `grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6`
— fluid, no hardcoded pixel-width caps introduced by this component; see §6.5 for the one inherited
constraint this doesn't control). Area 1 (Setup) and Area 2 (Live status) occupy the top row side by
side at `lg`+; Area 3 (Wallet) and Area 4 (Quick-nav) occupy the second row. All four stack to a single
column below `lg`. Each area is its own `Card` (`bg-[#111111]`, `border-[#222222]`, rounded) — never raw
content floating on the void, per the brief's design-bar requirement.

#### Area 1 — Setup completion glimpse

Reads the **same** `status: ConfiguratorStatus | null` state `ConfiguratorSurface` already fetches via
`GET /api/admin/configurator/status` (no new fetch). Scoped to the **confirmed Go-Live required set**
`['integration', 'payment']` (B2B-23's C5/Domain resolution, Arun 2026-07-18 Option A) — **not** the
stale `questionnaire && payment` set still hardcoded in `ConfiguratorSurface.tsx:154` /
`GoLivePanel.tsx:31` (B2B-24 does not touch those; see §12 Dependencies for the sequencing note this
creates). Questionnaire/Topics/Content/Visualization never appear here — B2B-23 hides them from the
Configurator entirely.

- **Both required items incomplete:**
  ```
  2 steps left before you can go live
  ✕ Integration — connect at least one OAuth client        [Finish →]
  ✕ Payment — add a funding method
  ```
  The **first incomplete item in fixed order `['integration', 'payment']`** gets the primary
  `[Finish →]` button (routes to `?section=integration`); the second incomplete item is listed but not
  separately buttoned (avoids two competing primary CTAs).
- **One required item incomplete** (e.g. Integration done, Payment not): same list format, only the
  remaining item shown with `[Finish →]`:
  ```
  1 step left before you can go live
  ✓ Integration
  ✕ Payment — add a funding method                          [Finish →]
  ```
- **Both required items complete:** collapses to a compact readout, not a checklist (per the brief:
  "a live status readout, not a static checklist"):
  ```
  ✓ Setup complete — ready to go live
  ```
  (If already live, see the live variant in §4.3's Wireframe 3 — Area 1 shows `✓ Setup complete`
  with no further CTA, since Go Live is no longer relevant.)
- **Optional-but-incomplete secondary note:** if Domain is incomplete (the only remaining optional,
  visible section under B2B-23's scope reduction), a single muted line appears below the required list:
  `Optional: Domain not yet configured` (`text-[#475569]`, no button) — never a full second checklist.
  If Domain is complete, this line is omitted entirely (no "Optional: Domain configured ✓" noise).

#### Area 2 — Live status

Reads a **new** `onboardingCompletedAt: string | null` value (see §6.2 — the raw timestamp, not just
the coerced boolean `isLive` that already exists).

- **Live:** `● Live since Jul 14, 2026` (green dot + `format(new Date(onboardingCompletedAt), 'MMM d,
  yyyy')` via `date-fns`, already an approved dependency).
- **Not live:** `○ Not live yet` (hollow dot, `text-[#475569]`) + one line of context that mirrors
  Area 1's state without repeating its exact copy:
  - Required incomplete: `Finish required setup to go live.`
  - Required complete: `You're ready — go live when you want.` + `[Go live →]` button routing to
    `?section=go_live`.

#### Area 3 — Wallet / billing snapshot

Reads the **extended** `billingHealth: BillingHealth` prop (already passed into `ConfiguratorSurface`
today for the top banner) — extended per §6.3 to carry `balance_usd` and `next_billing_date` alongside
its existing `state`. No new query.

- **Wallet exists (`balance_usd` is a number):**
  ```
  $142.50 available
  Next billing Jul 24, 2026            [Manage billing →]
  ```
  (`next_billing_date` line omitted if null — e.g. usage-billed accounts with no fixed next date.)
  If `billingHealth.state !== 'healthy'`, a warning line appears above the balance, reusing the
  **exact existing CEO-locked copy** from `_shared.tsx`'s `BILLING_BANNER_COPY` (no new wording
  invented) — e.g. for `low_balance`: `⚠ Your usage balance is running low. Top up to avoid
  interruption.` in amber `#F59E0B`.
- **No wallet yet** (`balance_usd === null` — a wallet is only lazily created on first credit/decrement,
  per `app/api/admin/billing/clients/route.ts`'s own comment; this is a distinct state from a $0.00
  balance):
  ```
  No wallet yet
  Add a funding method to get started.        [Set up payment →]
  ```
  routes to `?section=payment`.
- Plan `tier` (`self_serve` etc.) is **deliberately not shown** — it's an internal billing enum with no
  partner-facing label defined anywhere in the codebase; inventing one here would be exactly the kind of
  unspecified content the brief prohibits ("no speculative … content"). Flagged as a possible future
  addition, not built now (§10).
- No sparkline/chart (brief Constraint 2, confirmed numeric-only — see §11 Q7 resolution).

#### Area 4 — Quick-nav tiles

Not a 3-column icon-in-a-circle grid (explicitly prohibited by the brief as an AI-slop pattern). Instead:
a single card containing a **compact list of link-rows** — same visual language as `NavRow` (icon-free,
label + trailing chevron `→`), laid out as a responsive wrap: one column on mobile, a 2-column list on
`md`+, never a decorative icon grid. Two sub-groups within the card, separated by a thin divider:

- **Top-level destinations** (always present, always the same three, literal reuse of
  `ConfiguratorNavShell`'s own `navItems` hrefs — brief Q5 confirmed):
  - `Configurator →` → `/dashboard/configurator?partner_account_id={id}`
  - `API →` → `/dashboard/configurator/api?partner_account_id={id}`
  - `Docs →` → `/dashboard/configurator/docs?partner_account_id={id}`

  Note: clicking "Configurator" while already on the Dashboard is a same-page, no-op navigation. This is
  **not a bug to fix** — it's identical to today's existing behavior of `ConfiguratorNavShell`'s own
  "Configurator" tab (clicking it while already in the Configurator is already a no-op). Included for
  grid completeness and consistency, per the brief's literal instruction to surface all three
  destinations.
- **Incomplete-section deep-links** (conditional, only rendered for sections that are currently
  incomplete — **all** incomplete visible/configurable sections, not only the required ones, so this
  area stays useful even after required setup is done): for each of `Domain`, `Integration`, `Payment`
  where `status[key] === false`, a row `Finish {label} →` → `?section={key}`. If all three are complete,
  this sub-group is omitted entirely (no empty "Nothing left!" filler row — the collapsed Area 1 already
  communicates that).

### 4.3 Wireframes

**Wireframe 1 — Desktop (≥1024px), brand-new partner, nothing configured, Dashboard (default landing)**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Clio Configurator                                        [Acme Corp ▾]      │  ← ConfiguratorNavShell (untouched)
├───────────────────────────────────────────────────────────────────────────┤
│  Configurator    API    Docs                                                │  ← tab row (untouched)
├──────────────────────────┬────────────────────────────────────────────────┤
│  ► Dashboard   ◀ active   │   Dashboard                                     │
│  ─────────────────────    │   ┌───────────────────────┬───────────────────┐│
│  LEARNING EXPERIENCE      │   │ Setup                  │ Live status       ││
│    (hidden by B2B-23)     │   │ 2 steps left before you│ ○ Not live yet    ││
│  DELIVERY & INTEGRATION   │   │ can go live             │ Finish required   ││
│   ○ Domain                │   │ ✕ Integration — connect│ setup to go live. ││
│   ○ Integration            │   │   an OAuth client       │                   ││
│  BILLING                  │   │           [Finish →]    │                   ││
│   ○ Payment                │   │ ✕ Payment — add a       │                   ││
│  ───────────────────────  │   │   funding method         │                   ││
│   ► Go Live  Setup         │   │ Optional: Domain not    │                   ││
│      incomplete            │   │ yet configured           │                   ││
│                           │   ├───────────────────────┼───────────────────┤│
│                           │   │ Wallet                  │ Quick links       ││
│                           │   │ No wallet yet            │ Configurator →    ││
│                           │   │ Add a funding method to  │ API →             ││
│                           │   │ get started.              │ Docs →            ││
│                           │   │        [Set up payment →]│ ── ── ── ── ── ── ││
│                           │   │                          │ Finish Domain →   ││
│                           │   │                          │ Finish Integration→│
│                           │   │                          │ Finish Payment →  ││
│                           │   └───────────────────────┴───────────────────┘│
└──────────────────────────┴────────────────────────────────────────────────┘
```

**Wireframe 2 — Desktop, returning partner, Integration done, Payment not, not yet live**

```
┌──────────────────────────┬────────────────────────────────────────────────┐
│  ► Dashboard   ◀ active   │   Dashboard                                    │
│  DELIVERY & INTEGRATION   │   ┌───────────────────────┬───────────────────┐│
│   ○ Domain                │   │ Setup                  │ Live status       ││
│   ● Integration            │   │ 1 step left before you │ ○ Not live yet    ││
│  BILLING                  │   │ can go live              │ Finish required   ││
│   ○ Payment                │   │ ✓ Integration           │ setup to go live. ││
│  ───────────────────────  │   │ ✕ Payment — add a       │                   ││
│   ► Go Live  Setup         │   │   funding method  [Finish →]│               ││
│      incomplete            │   └───────────────────────┴───────────────────┘│
└──────────────────────────┴────────────────────────────────────────────────┘
```

**Wireframe 3 — Desktop, live partner, everything configured**

```
┌──────────────────────────┬────────────────────────────────────────────────┐
│  ► Dashboard   ◀ active   │   Dashboard                                    │
│  DELIVERY & INTEGRATION   │   ┌───────────────────────┬───────────────────┐│
│   ● Domain                │   │ Setup                  │ Live status       ││
│   ● Integration            │   │ ✓ Setup complete       │ ● Live since      ││
│  BILLING                  │   │                          │   Jul 14, 2026    ││
│   ● Payment                │   ├───────────────────────┼───────────────────┤│
│  ───────────────────────  │   │ Wallet                  │ Quick links       ││
│   ► Live   ● (green)       │   │ $142.50 available        │ Configurator →    ││
│                           │   │ Next billing Jul 24, 2026│ API →             ││
│                           │   │              [Manage    │ Docs →            ││
│                           │   │               billing →]│                   ││
│                           │   └───────────────────────┴───────────────────┘│
└──────────────────────────┴────────────────────────────────────────────────┘
```

**Wireframe 4 — Mobile (<768px), live partner, drawer closed**

```
┌─────────────────────────────┐
│ Clio Configurator   [Acme ▾]│
├─────────────────────────────┤
│ Configurator  API  Docs     │
├─────────────────────────────┤
│ [☰ Sections]     Dashboard  │
├─────────────────────────────┤
│ Dashboard                   │
│ ┌─────────────────────────┐ │
│ │ Setup                    │ │
│ │ ✓ Setup complete          │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ Live status               │ │
│ │ ● Live since Jul 14, 2026 │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ Wallet                    │ │
│ │ $142.50 available          │ │
│ │ Next billing Jul 24, 2026  │ │
│ │        [Manage billing →]  │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ Quick links                │ │
│ │ Configurator →             │ │
│ │ API →                      │ │
│ │ Docs →                     │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
   Areas stack single-column below lg (grid-cols-1). No horizontal scroll.
```

**Wireframe 5 — Nav pane, pinned Dashboard entry (both live and not-live states, "Start here" hint removed)**

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  ► Dashboard   ◀ active   │        │  ► Dashboard              │
│  ─────────────────────    │        │  ─────────────────────    │
│  DELIVERY & INTEGRATION   │        │  DELIVERY & INTEGRATION   │
│   ○ Domain                │        │   ● Domain                │
│   ○ Integration            │        │   ● Integration            │
│  BILLING                  │        │  BILLING                  │
│   ○ Payment                │        │   ● Payment                │
│  ───────────────────────  │        │  ───────────────────────  │
│   ► Go Live  Setup         │        │   ► Live   ● (green)       │
│      incomplete            │        │                            │
└──────────────────────────┘        └──────────────────────────┘
   Not-live, nothing done              Live, everything done
   No "Start here → X" line in either state — Dashboard is the single front door (§4.6).
```

### 4.4 Responsive behavior

Same three-tier model B2B-20 established (no changes to the shell's breakpoints); Area cards use
Tailwind's `grid grid-cols-1 lg:grid-cols-2` with fluid `gap-4 lg:gap-6` and card internal padding on a
`clamp()`-scaled spacing pattern (`p-4 md:p-5 lg:p-6`) rather than a single fixed value, per the standing
responsive rule. No horizontal scroll at any width — card content wraps, never truncates unreadably.

### 4.5 Non-goals for this panel (repeated from the brief, made explicit here)

No configuration inputs, no forms, no editable fields anywhere on this panel. Every actionable element
is either a same-tab section navigation (`?section=`) or a read-only display. No glitch/bug data (owned
by B2B-22's Known Bugs screen, never duplicated here).

### 4.6 Resolution: Dashboard vs. first-incomplete auto-select (the brief's Q1 — decided, not escalated)

The brief explicitly delegates this to the BA with a recommendation and reasoning already supplied
("I recommend Option A … but this is a genuine product-interaction call — the BA must document the
chosen behavior … If the BA's analysis favors B or C over A that's fine — but it must be decided and
written, not left open"). This is the same delegation pattern B2B-20 §11 Q2 used for the Go-Live
required-set, and is resolved the same way: **decided in-spec, not escalated to Section 11.**

**Decision: Option A.** Land on **Dashboard by default** for brand-new, returning-not-live, and live
partners alike (an explicit `?section=` still always wins for all three). The Dashboard's Area 1 absorbs
the first-incomplete nudge as its own primary `[Finish →]` CTA (§4.2). The nav-level **"Start here"**
hint (`ConfiguratorSurface.tsx:334-338`, driven by `firstIncompleteLabel`/`CANONICAL_ORDER`) is
**removed entirely** — not moved, not kept alongside. `page.tsx`'s `initialSection` computation drops
its `isLive` / first-incomplete branching (§3) and its `getConfiguratorStatus` call for that purpose
(Dashboard computes its own CTA from the `status` state `ConfiguratorSurface` already fetches
client-side — no server-side status read is needed just to pick a landing section anymore).

**Why Option A over B or C:**
- **Against B (keep both):** Area 1 and the nav hint would show the *same* "what's next" information in
  two places simultaneously (the hint always visible in the pane, Area 1's CTA always visible in the
  panel) the moment a partner is on the Dashboard — direct duplication the brief's Known Constraint 3
  ("reuse existing data sources; duplicate no query logic") and general no-duplication principle argue
  against. It also undercuts the very reason for building a Dashboard: if the nav still nags with "Start
  here → Integration" regardless of which panel is open, the Dashboard hasn't actually consolidated
  anything.
- **Against C (auto-select first-incomplete unless live/complete):** this preserves the exact
  inconsistency the brief is trying to remove — a not-yet-live partner would *not* see the new front
  door by default, only after everything required is done, which is backwards (the overview is *more*
  useful mid-setup, not less). It also means two different landing behaviors to test, document, and
  explain, for no benefit once Area 1 already carries the same nudge.
- **Option A gives one clear front door, one nudge, no duplication** — exactly the CEO's own stated
  preference, and consistent with the Stripe/Anthropic/Resend precedent the brief cites (those consoles
  land every user, new or returning, on an overview).

**Concrete landing behavior by partner type (no ambiguity):**

| Partner type | No `?section=` | Explicit `?section=X` |
|---|---|---|
| Brand-new (nothing configured) | Dashboard (Wireframe 1) | That section, unchanged |
| Returning, not yet live | Dashboard (Wireframe 2) | That section, unchanged |
| Live | Dashboard (Wireframe 3) | That section, unchanged |

---

## 5. Visual Examples

See §4.3 — all five wireframes (desktop first-run, desktop partial, desktop live, mobile live, nav pane
before/after) are embedded there per this repo's established pattern of interleaving wireframes with the
flow description they illustrate (matching B2B-20 §4/§5's structure).

---

## 6. Data Requirements

This is a **read-only, additive overview**. No new database tables or columns. **No new API routes.**
Every data point is either already fetched by `ConfiguratorSurface`/`page.tsx` today, or is added by
**extending** one existing query's `select()` and return shape.

### 6.1 Area 1 — Setup completion glimpse

- **Source:** the existing `status: ConfiguratorStatus | null` state already held in
  `ConfiguratorSurface` (fetched via `GET /api/admin/configurator/status`,
  `lib/partner/configurator-status.ts`'s `getConfiguratorStatus()`, itself composing the existing
  `checkStepComplete()` + the OAuth-count Integration rule — B2B-20 §6.1). **No new fetch, no new
  endpoint.** `DashboardPanel` receives `status` as a prop, exactly as `GoLivePanel` already does.
- **Required-set literal:** `['integration', 'payment']` — hardcoded as a small local constant inside
  the new `DashboardPanel.tsx` (e.g. `const REQUIRED: ConfiguratorSection[] = ['integration',
  'payment']`), **not** read from `ConfiguratorSurface.tsx:154`'s `requiredReady` or
  `GoLivePanel.tsx:31`'s `REQUIRED_LABELS` — both of those remain on the stale `questionnaire &&
  payment` set until B2B-23's dev work updates them (see §12 Dependencies — this is a real sequencing
  risk, called out explicitly, not hand-waved).

### 6.2 Area 2 — Live status

- **New value needed:** the raw `onboarding_completed_at` timestamp, not just the coerced boolean.
  `page.tsx`'s existing query already selects it (`'onboarding_completed_at'`) but today only produces
  `isLive = !!account?.onboarding_completed_at` (`page.tsx:79`). **Mechanical addition:** also pass the
  raw value through as a new prop, e.g. `onboardingCompletedAt: account?.onboarding_completed_at ?? null`
  (type `string | null`), threaded `page.tsx` → `ConfiguratorSurface` (new prop) → `renderPanel` →
  `DashboardPanel`. No new query — same `select`, one more field read off the already-fetched row.
- **Formatting:** `date-fns`'s `format(new Date(onboardingCompletedAt), 'MMM d, yyyy')` → `"Jul 14,
  2026"`. `date-fns` is an approved, already-used dependency; no new package.

### 6.3 Area 3 — Wallet / billing snapshot

- **Extend, don't duplicate, `getBillingHealth()`** (`app/dashboard/configurator/_billing-health.ts`).
  Today it selects `plan_status, low_balance_alert_fired_at` from `partner_wallets` and returns only
  `{ state }`. Change:
  - Select also `balance_usd, next_billing_date` (both already proven columns — read today by
    `app/api/admin/billing/clients/route.ts` and `app/api/partner/v1/sessions/route.ts:208`).
  - Extend the `BillingHealth` interface in `_shared.tsx`:
    ```ts
    export interface BillingHealth {
      state: BillingHealthState
      balance_usd: number | null
      next_billing_date: string | null
    }
    ```
  - Populate both fields on **every** return path of `getBillingHealth()`:
    - `error || !data` (no wallet row / read failure — the existing fail-open branch): `{ state:
      'healthy', balance_usd: null, next_billing_date: null }`. This is the "no wallet yet" case Area 3
      must render distinctly from a real `$0.00` balance (§4.2, §9).
    - All other branches (`past_due` / `canceled` / `low_balance` / `healthy`): populate
      `balance_usd: data.balance_usd != null ? Number(data.balance_usd) : null` and
      `next_billing_date: data.next_billing_date ?? null` alongside the existing `state` value. The
      **state-derivation logic itself is untouched** — same `plan_status`/`low_balance_alert_fired_at`
      checks, same precedence, per Known Constraint 3 ("do not re-derive those states").
  - This is the exact mechanism the brief invited ("extend the existing read/shape") — one extra `select`
    on an already-executed query, zero new round-trips, zero new endpoints.
- **Low-balance signal:** unchanged — `low_balance_alert_fired_at` (migration 075), no invented numeric
  threshold, per Known Constraint 3.
- **Warning copy:** reused verbatim from `_shared.tsx`'s existing `BILLING_BANNER_COPY` map (CEO-locked,
  "Do not edit wording without a spec change") — Area 3 imports and displays the same `message` string
  the top banner already shows for the same `state`, never a new string.
- **`tier` explicitly excluded** from this display (§4.2) — no source of partner-facing tier copy exists
  in the codebase; not invented here.

### 6.4 Area 4 — Quick-nav tiles

- **Top-level destinations:** the exact same three hrefs already defined in
  `ConfiguratorNavShell`'s `navItems` (`_shared.tsx:186-190`) — `DashboardPanel` builds these from
  `activePartnerAccountId`, not by importing `ConfiguratorNavShell` internals (it's a `'use client'`
  sibling, not exported for reuse) — same route strings, no new routing logic.
- **Deep-links:** existing `?section=` mechanism (B2B-20 §6.4, §3) — `onSelect(key)` (the existing
  `selectSection` callback already passed to `ConfiguratorNav`) reused directly; `DashboardPanel` is
  given the same callback as a prop (e.g. `onSelect: (key: PanelSection) => void`).
- **Incomplete-section list:** derived client-side from the same `status` prop as Area 1 — `Domain`,
  `Integration`, `Payment` filtered to `status[key] === false`. No new data source.

### 6.5 One inherited, out-of-scope layout constraint

`ConfiguratorNavShell`'s outer content wrapper (`_shared.tsx:238`, untouched per Known Constraint 4) has
an inline `maxWidth: 960, margin: '0 auto'`. Because Dashboard content renders inside that wrapper (via
`ConfiguratorSurface`'s existing `-mx-8 -mb-8` + `<main>` structure), the Dashboard's overall content
column inherits that 960px cap. This is **not** a violation of the standing "no hardcoded pixel-width
caps" rule introduced by this feature — it is pre-existing, untouched, explicitly out-of-scope code
(Known Constraint 4 forbids touching `ConfiguratorNavShell`). Flagged factually, not treated as a defect
to fix under this brief.

### 6.6 localStorage / sessionStorage

None. Identical to B2B-20 — section selection lives in the URL, nothing in client storage.

### 6.7 New API routes

**None.** Zero new endpoints. This satisfies Known Constraint 3 ("reuse existing data sources; duplicate
no query logic") as literally as possible — every data point is either an existing prop, an existing
client-side fetch already in `ConfiguratorSurface`, or one extended `select()` on an existing query.

---

## 7. Success Criteria (Acceptance Tests)

**Navigation & default landing**
1. ✓ Given any partner (brand-new, returning-not-live, or live) navigates to `/dashboard/configurator`
   with no `?section=`, when the page loads, then the Dashboard panel renders and the "Dashboard" nav
   row shows the active-state treatment.
2. ✓ Given a partner is on any other section (e.g. `?section=payment`), when they click the "Dashboard"
   nav row, then the URL updates to `?section=dashboard`, the panel swaps to Dashboard, and the left
   pane / tab row / account switcher remain in place (no full-page navigation).
3. ✓ Given `?section=dashboard` is bookmarked, when the page reloads, then Dashboard is still selected.
4. ✓ Given the left nav pane, when it renders for any partner (not-live or live), then **no** "Start here
   → X" hint line appears anywhere in the pane (superseding B2B-20 ACs #4/#5 — see §12).

**Area 1 — Setup**
5. ✓ Given a partner with Integration incomplete and Payment incomplete, when Dashboard loads, then Area
   1 lists both as incomplete with Integration's row carrying the primary `[Finish →]` button (routing
   to `?section=integration`).
6. ✓ Given a partner with Integration complete and Payment incomplete, when Dashboard loads, then Area 1
   shows "1 step left", Integration as `✓`, and Payment's row carrying `[Finish →]` (routing to
   `?section=payment`).
7. ✓ Given a partner with both Integration and Payment complete, when Dashboard loads, then Area 1
   collapses to `✓ Setup complete` with no checklist and no `[Finish →]` button.
8. ✓ Given a partner with Domain incomplete and both required sections complete, when Dashboard loads,
   then Area 1 shows the collapsed complete state **plus** the muted `Optional: Domain not yet
   configured` line, with no button.

**Area 2 — Live status**
9. ✓ Given a live partner whose `onboarding_completed_at` is `2026-07-14T09:00:00Z`, when Dashboard
   loads, then Area 2 shows `● Live since Jul 14, 2026`.
10. ✓ Given a not-yet-live partner with both required sections complete, when Dashboard loads, then Area
    2 shows `○ Not live yet` with a `[Go live →]` button routing to `?section=go_live`.

**Area 3 — Wallet**
11. ✓ Given a partner with no `partner_wallets` row yet, when Dashboard loads, then Area 3 shows "No
    wallet yet" with a `[Set up payment →]` button — never `$0.00`.
12. ✓ Given a partner with `balance_usd = 142.50` and `low_balance_alert_fired_at` set, when Dashboard
    loads, then Area 3 shows the amber low-balance warning using the exact existing
    `BILLING_BANNER_COPY.low_balance.message` string, followed by `$142.50 available`.

**Area 4 — Quick-nav**
13. ✓ Given any partner, when Dashboard loads, then Area 4 always shows exactly three top-level tiles
    (Configurator, API, Docs) linking to `ConfiguratorNavShell`'s exact existing hrefs.
14. ✓ Given a partner with Domain incomplete and Integration/Payment complete, when Dashboard loads,
    then Area 4's deep-link sub-group shows only `Finish Domain →`; given all three complete, the
    deep-link sub-group is omitted entirely.

**Responsive & non-regression**
15. ✓ Given viewport <768px, when Dashboard loads, then all four areas stack in a single column and the
    page body never scrolls horizontally.
16. ✓ Given the new `DashboardPanel.tsx`, when `grep -c 'style={{' app/dashboard/configurator/DashboardPanel.tsx`
    runs, then it returns 0 (Tailwind classes only, consistent with B2B-20 AC #16's shell-file rule).
17. ✓ Given the build, when `npx tsc --noEmit` runs, then it completes with zero errors.

---

## 8. Error States

- **`GET /api/admin/configurator/status` fails:** inherited behavior, unchanged — `ConfiguratorSurface`'s
  existing `refetchStatus` catch block already defaults `status` to all-`false`. Dashboard's Area 1 and
  Area 4 render against that same safe-default state (both required items show incomplete; no error
  banner; no blocked navigation) — no new error-handling code needed in `DashboardPanel` itself.
- **`getBillingHealth()` read fails (DB error or missing row):** fail-open, unchanged mechanism — Area 3
  renders "No wallet yet" (the `balance_usd: null` branch), never a false balance and never a blocking
  error. This is the *same* code path as the legitimate "wallet not created yet" case (§6.3) — both
  render identically, which is intentional (the partner-facing outcome — "add a funding method" — is the
  same regardless of *why* there's no balance to show).
- **`onboardingCompletedAt` is present but unparseable** (defensive — should not happen given the column
  is a Postgres timestamp): Area 2 falls back to a plain `● Live` with no date clause, rather than
  crashing or showing "Invalid Date".
- **Slow load of `status`/`billingHealth`:** both are populated asynchronously already (status is a
  client fetch; billingHealth is server-rendered before first paint). While `status` is `null` (initial
  state before the first fetch resolves), Area 1 and Area 4's incomplete-list render nothing rather than
  guessing — a brief empty-to-populated flash on first load, consistent with how the nav's completion
  dots already behave today (they start hollow/incomplete-styled until the first fetch resolves, per
  `NavRow`'s `complete={status?.[item.key] === true}` defaulting `undefined` to `false`-equivalent
  styling).
- **Deep-link/quick-nav tile navigation failure:** none of these are network calls — they are all
  client-side `router.replace`/`Link` navigations to already-valid, already-tested routes (B2B-20 §6.4).
  No new failure mode is introduced.

---

## 9. Edge Cases

- **Brand-new partner, nothing configured:** Wireframe 1 — both required items incomplete, "No wallet
  yet", not live. No crash, no gating (Dashboard itself was never a gate).
- **Fully live partner, everything configured:** Wireframe 3 — Area 1 collapsed, Area 2 shows the live
  date, Area 3 shows a real balance, Area 4 shows only the three top-level tiles (no deep-link
  sub-group).
- **Wallet exists but `balance_usd` is exactly `0`:** rendered as `$0.00 available` (a real, distinct
  value from "No wallet yet" — §6.3's `balance_usd: null` vs. `0` distinction is load-bearing here).
- **Multi-account admin switching accounts while on Dashboard:** the account switcher persists (unchanged,
  `ConfiguratorNavShell`); switching triggers the existing account-switch re-render, which re-runs
  `page.tsx` (new `billingHealth`/`onboardingCompletedAt` for the new account) and
  `ConfiguratorSurface`'s `refetchStatus` (new `status` for the new account, already wired via the
  existing `activePartnerAccountId` dependency in its `useCallback`). No new wiring needed.
- **Mobile drawer open, then navigating to Dashboard via a drawer tap:** identical mechanism to every
  other section tap — `selectSection` closes the drawer and swaps the panel (B2B-20 §4's existing
  `setDrawerOpen(false)` inside `selectSection`).
- **A partner who never leaves Dashboard** (all needs met by the four areas): fully supported — no
  section is force-visited.
- **`prefers-reduced-motion`:** inherited from the existing `AnimatePresence`/`useReducedMotion` wrapper
  around `renderPanel`'s output — no new motion code in `DashboardPanel` itself, so no new
  reduced-motion handling is needed.
- **Partner with Domain complete but Integration/Payment incomplete:** Area 1 only ever discusses the
  required set (Integration, Payment); Domain's completeness doesn't affect Area 1's copy at all in this
  case (no "Optional: Domain not yet configured" line, since it's already done) — only Area 4's
  deep-link sub-group reflects Domain's state (omitted if complete).

---

## 10. Out of Scope

- **Touching `ConfiguratorNavShell`** (tab row, account switcher, billing banner) — untouched, per Known
  Constraint 4.
- **Updating `ConfiguratorSurface.tsx:154`'s `requiredReady` or `GoLivePanel.tsx:31`'s
  `REQUIRED_LABELS`** to the resolved `['integration','payment']` set — that is B2B-23's remit (its
  brief title is literally "Configurator milestone scope reduction"). B2B-24 reads the resolved set as
  its own local literal for Area 1's display only; it does not modify the Go-Live panel's or the pinned
  nav row's required-set logic. See §12 for the sequencing risk this creates.
- **Any new API route.** Zero created (§6.7).
- **Sparkline/chart for wallet balance or burn rate.** Confirmed unnecessary for v1 (brief Constraint 2,
  §11 Q7) — numeric-only.
- **Showing `partner_wallets.tier`** as partner-facing copy — no defined label mapping exists; not
  invented here (§6.3).
- **"← Back to Dashboard" links added to other section panels** (Domain/Integration/Payment/Go
  Live/etc.) — not requested by the brief; a reasonable low-cost future enhancement, not built now.
- **Glitch/bug data of any kind** — owned entirely by B2B-22's Known Bugs screen; never surfaced here
  (brief's explicit exclusion).
- **Any change to a section's internal behavior or fields** (Domain, Integration, Payment, Go Live) —
  unchanged. This is purely an additive read-only overview panel plus nav/routing changes.
- **Pixel-level visual polish** (exact spacing, icon choices for the quick-nav rows if any, hover
  micro-interactions beyond what's already specified) — this spec fixes IA/structure/responsive layout;
  a `/design-review` pass follows once built, per the CEO/BA-vs-design-review division of labor in
  `CLAUDE.md`.

---

## 11. Open Questions

**None.** All eight questions the brief posed are resolved in-spec:

- **Q1 (Dashboard-vs-first-incomplete interaction — the big one):** Option A, decided and documented with
  full reasoning and a per-partner-type table (§4.6). Nav "Start here" hint removed entirely, not moved.
  `page.tsx`'s `initialSection` first-incomplete branching dropped.
- **Q2 (Area 1 required-set):** Bound to the sibling brief's now-resolved `['integration', 'payment']`
  (§4.2, §6.1). Optional-but-incomplete (Domain) shown as a single muted secondary line, never a full
  second checklist.
- **Q3 (wallet snapshot data shape):** `getBillingHealth()`/`BillingHealth` extended with `balance_usd`
  and `next_billing_date` via one additional `select()` on the already-executed query (§6.3). Low-balance
  still uses `low_balance_alert_fired_at`, no invented threshold. Exact display specified: balance
  number, next-billing date, warning state (reusing exact existing copy); plan tier explicitly excluded
  with rationale.
- **Q4 ("Live since"):** Raw `onboarding_completed_at` timestamp threaded as a new
  `onboardingCompletedAt` prop; format `"Live since Jul 14, 2026"` via `date-fns` (§6.2).
- **Q5 (quick-nav tiles):** Exact three destinations confirmed (Configurator/API/Docs, literal
  `ConfiguratorNavShell` hrefs); deep-links cover **all** incomplete visible sections (not only required
  ones), reusing `?section=` (§4.2, §6.4).
- **Q6 (empty/first-run vs. fully-live):** Both wireframed (Wireframes 1 and 3, §4.3).
- **Q7 (sparkline/chart necessity):** Confirmed unnecessary — numeric-only wallet display for v1, no new
  dependency (§4.2, §10).
- **Q8 (visible label):** "Dashboard" — confirmed nav label and panel `<h1>` heading (§4.1, §4.2), per
  Arun's verbatim word choice.

---

## 12. Dependencies

**Must be true before build:**
- B2B-20 (Configurator left-nav restructuring) — Done. `ConfiguratorSurface.tsx`, `GoLivePanel.tsx`,
  `PaymentConfigClient.tsx`, `lib/partner/configurator-status.ts`,
  `GET /api/admin/configurator/status` all exist and behave as described in this spec (verified directly
  against current source, 2026-07-18).
- B2B-16 (`ConfiguratorNavShell`, billing-health banner, `_billing-health.ts`, `_shared.tsx`'s
  `BillingHealth`/`BILLING_BANNER_COPY`) — Done, verified directly against current source.
- **B2B-23's C5/Domain required-set resolution — RESOLVED** (Arun, 2026-07-18, Option A): confirmed
  required set is `['integration', 'payment']`, Domain excluded from the required set. This spec binds
  to that resolved value directly (§4.2, §6.1) — no further waiting needed on that specific point.
- `date-fns` — already an approved, present dependency. No new package required anywhere in this brief.

**Sequencing risk to flag for the Orchestrator (not an open question in this spec, but must be tracked):**
Because B2B-24 deliberately does **not** update `ConfiguratorSurface.tsx:154`'s `requiredReady` or
`GoLivePanel.tsx:31`'s `REQUIRED_LABELS` (that's B2B-23's own remit — §10), there is a window in which
the Dashboard's Area 1 correctly shows `['integration','payment']` as required while the pinned "Go
Live"/"Live" nav row and the Go Live panel itself still validate against the stale `['questionnaire',
'payment']` set, until B2B-23's dev work lands. **B2B-24's dev work should not be merged ahead of
B2B-23's required-set update landing** — merging B2B-24 first would produce a Dashboard that visibly
disagrees with the Go Live panel about what's required, which is the exact contradiction Known Constraint
1 prohibits. This is an ordering note for the Orchestrator, not a gap in this spec: B2B-23's own BA spec
independently owns updating those two files.

**Concrete build task list (files):**

*New:*
- `app/dashboard/configurator/DashboardPanel.tsx` — the four-area Dashboard panel component (Tailwind
  only, zero inline styles, responsive grid). Props: `{ status: ConfiguratorStatus | null; isLive:
  boolean; onboardingCompletedAt: string | null; billingHealth: BillingHealth; activePartnerAccountId:
  string; onSelect: (key: PanelSection) => void }`.

*Modified:*
- `app/dashboard/configurator/page.tsx` — add `'dashboard'` to `VALID_SECTIONS`; simplify default-section
  resolution to always fall back to `'dashboard'` when `?section=` is absent/invalid (drop the
  `isLive`/first-incomplete/`CANONICAL_ORDER`/`getConfiguratorStatus` branching used only for that
  purpose — §4.6); pass the raw `onboarding_completed_at` value through as a new
  `onboardingCompletedAt` prop to `ConfiguratorSurface` alongside the existing `isLive`.
- `app/dashboard/configurator/ConfiguratorSurface.tsx` — add `'dashboard'` to `PanelSection` and
  `SECTION_LABEL`; accept the new `onboardingCompletedAt` prop; add a pinned `DashboardNavRow` (styled
  like `NavRow` minus the completion dot) at the top of `ConfiguratorNav`, above the groups; **remove**
  the `firstIncomplete`/`firstIncompleteLabel`/`CANONICAL_ORDER`-driven "Start here" hint computation and
  its rendering block entirely (§4.6); add a `'dashboard'` case to the `renderPanel` switch, threading
  `status`, `isLive`, `onboardingCompletedAt`, `billingHealth`, `activePartnerAccountId`, and
  `selectSection` into `DashboardPanel`; thread `billingHealth` into `renderPanel`'s parameter object
  (not currently passed to it).
- `app/dashboard/configurator/_shared.tsx` — extend the `BillingHealth` interface with `balance_usd:
  number | null` and `next_billing_date: string | null`.
- `app/dashboard/configurator/_billing-health.ts` — extend the `partner_wallets` `select()` to include
  `balance_usd, next_billing_date`; populate both new fields on every return branch of
  `getBillingHealth()` (§6.3).

*Explicitly not modified* (see §10, §12's sequencing note): `ConfiguratorNavShell`,
`GoLivePanel.tsx`'s required-set constant, any section's internal client, any new API route.

---

*End of Requirement Document B2B-24 v1.0 — all 12 sections filled, Section 11 empty. Ready for CEO
review.*
