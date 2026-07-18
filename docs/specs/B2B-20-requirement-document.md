# B2B-20 — Configurator Left-Nav Restructuring — Requirement Document
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-17
Source brief: `.claude/agents/clio/feature-briefs/B2B-20-configurator-left-nav-restructuring.md`

> Scope in one line: replace the Configurator's two divergent UI patterns (the forced-linear
> onboarding **wizard** and the post-go-live **card-grid Home**) with **one persistent, responsive
> left-nav + panel surface** used for both first-run setup and ongoing editing — a
> navigation/layout restructuring, not a rebuild of any section's internals.

---

## 1. Purpose

Today a Clio partner configures their integration through **two entirely separate UI patterns** that
cover an overlapping-but-not-identical set of eight config areas:

- **The wizard** (`app/dashboard/configurator/wizard/WizardClient.tsx`) — a **forced-linear** seven-step
  first-run flow (`questionnaire → topics → content → visualization → domain → payment → go_live`) that
  gates forward movement until each step's live-completion check passes.
- **The Home** (`app/dashboard/configurator/HomeClient.tsx`) — a **flat 3-column card grid** shown only
  *after* go-live, where each card is a separate full-page navigation to a standalone section route.

The two are **temporally mutually exclusive** per partner (`configurator/page.tsx` redirects to the
wizard while `partner_accounts.onboarding_completed_at` is null, else renders Home). A partner
therefore learns one navigation model to set up and a different one to maintain, and the primary
first-run experience marches them through seven steps in a fixed order — the wrong shape for a
configuration surface.

This feature replaces both with a single left-nav dashboard: every config section listed in a
persistent left pane, grouped into a few sensible categories, each directly clickable with no forced
order, the main panel swapping smoothly to the chosen section, each section showing a completion
indicator, and "Go Live" preserved as a deliberate activation action rather than a terminal step. The
whole surface must be genuinely responsive and mobile-friendly.

This directly serves **CORE_OBJECTIVES v3, Objective 4** — "the partner can configure everything
easily in our portal… After configuration they need not use our application." A single intuitive
configuration surface *is* that objective made real.

**Failure without it:** partners face two inconsistent navigation models, a rigid funnel that blocks
returning-to-adjust the one thing they want to change, and a surface that is unusable on a phone
(every Configurator file uses inline `style={{}}` objects, a hardcoded `repeat(3,1fr)` grid, and fixed
pixel widths — none of which can express a media query, so the surface is not mobile-capable as
written).

---

## 2. User Story

**Primary — returning partner (already live):**
> As a partner admin who has already gone live,
> I want to open the Configurator, see every section I can configure in one glance, and jump
> straight to the one I want to change,
> So that I can adjust a single setting without navigating a card grid into a separate full page.

**Secondary — first-run partner (nothing configured yet):**
> As a brand-new partner admin who just signed up,
> I want a clear, low-friction "start here" path through the same configuration surface I'll use
> forever after — with a visible sense of what's done and what's left, and a deliberate "Go Live" when
> I'm ready,
> So that I can get set up confidently without being forced through a rigid seven-step wizard and
> without learning a second UI later.

**Tertiary — multi-section editor:**
> As a partner admin,
> I want the surface to work on my phone and tablet, not just my laptop,
> So that I can check or tweak my configuration from any device.

---

## 3. Trigger / Entry Point

- **Route:** `/dashboard/configurator` (unchanged top-level route). Section selection is expressed via a
  `section` query param: `/dashboard/configurator?partner_account_id=<uuid>&section=<sectionKey>`.
- **What triggers it:** page load (server component `app/dashboard/configurator/page.tsx`), Clerk-
  authenticated, partner-admin-only. This is the same auth/entry model as today — nothing about
  auth changes.
- **State the user must be in:** signed in via Clerk, administers ≥1 partner account
  (`getPartnerAccountsForClerkUser` returns ≥1). If zero accounts → existing `<NoPartnerAccounts />`
  (unchanged).
- **Placement in the nav hierarchy:** the new surface renders **inside the Configurator tab's content
  area** — i.e. as the `children` of `<ConfiguratorNavShell active="configurator">` (the B2B-16
  Configurator / API / Docs tab row + billing-health banner). **`ConfiguratorNavShell` is NOT
  touched** (Constraint 1). The left-nav lives *beneath* that tab row.
- **Removed trigger:** the `onboarding_completed_at`-null → `/wizard` redirect in `configurator/page.tsx`
  and in every standalone section `page.tsx` is removed (see §6, §10, §12). `/dashboard/configurator/wizard`
  becomes a redirect into the unified surface for any bookmarked links.

**Default section on entry** (when `?section=` is absent or invalid):
- If the partner is **not yet live** (`onboarding_completed_at` is null): the **first incomplete
  section** in canonical order (Questionnaire → Topics → Content → Visualization → Domain → Integration
  → Payment), so a brand-new partner lands on Questionnaire and a partially-set-up partner resumes where
  work remains. If all are complete but not yet live, default to the **Go Live** panel.
- If the partner **is live** (`onboarding_completed_at` set): default to **Questionnaire** (the first
  section), matching a settings dashboard's "top item" convention.

---

## 4. Screen / Flow Description

The surface is a **two-region layout**: a **left navigation pane** (grouped section list + pinned Go
Live) and a **main panel** (the selected section's editor, rendered via the reused `embedded`
component). Selecting a nav item swaps the panel; it never navigates to a separate page.

### 4.1 Left navigation pane — contents (exact)

Rendered top to bottom:

1. **Group heading: "Learning experience"** (uppercase micro-label, `text-muted` `#475569`, 11px,
   letter-spacing) — non-clickable.
   - Nav item **"Questionnaire"** + completion dot
   - Nav item **"Topics"** + completion dot
   - Nav item **"Content"** + completion dot
   - Nav item **"Visualization"** + completion dot
2. **Group heading: "Delivery & integration"**
   - Nav item **"Domain"** + completion dot
   - Nav item **"Integration"** + completion dot
3. **Group heading: "Billing"**
   - Nav item **"Payment"** + completion dot
4. **Pinned action (visually separated by a top border, sits at the bottom of the pane on desktop,
   bottom of the drawer on mobile):**
   - **"Go Live"** — a primary-styled action row, always visible, never a group member. Shows a live-
     status label to its right (see §4.4).

**Each nav item** is a full-width clickable row: a **completion dot** on the left (see §4.3), the
**section label**, and — on the currently-selected item — an **active treatment** (3px purple
`#7C3AED` left border, text `#FFFFFF`, subtle purple-tinted background `rgba(124,58,237,0.10)`).
Non-selected items: text `#94A3B8`, transparent background; **hover** → background `#1A1A1A`, text
`#FFFFFF`.

### 4.2 Main panel — contents

Renders **exactly one** section editor at a time, by reusing the existing section client with
`embedded` set (see §6 for the per-section mapping). The panel is the *only* thing that changes when a
nav item is selected — the left pane, the account switcher, and the `ConfiguratorNavShell` tab row all
persist.

The eight areas map to panel content as follows:

| Nav item | Panel renders | Reuse mechanism |
|---|---|---|
| Questionnaire | `QuestionnaireBuilderClient … embedded` | existing `embedded` prop |
| Topics | `TopicsConfigClient … embedded` | existing `embedded` prop |
| Content | `ContentConfigClient … embedded` | existing `embedded` prop |
| Visualization | `VisualizationClient … embedded` | existing `embedded` prop |
| Domain | `DomainConfigClient … embedded` | existing `embedded` prop |
| Integration | `IntegrationClient … embedded` | **`embedded` prop ADDED** (§6) |
| Payment | `PaymentConfigClient … embedded` | **NEW component** extracted from wizard's `PaymentStep` (§6) |
| Go Live | `GoLivePanel` | **NEW component** extracted from wizard's `GoLiveStep` + go-live action (§6) |

### 4.3 Completion indicators

Every nav item (except Go Live) shows a **completion dot**:
- **Complete** → filled green dot `#10B981` + `aria-label="complete"`.
- **Incomplete** → hollow ring, border `#475569` (`text-muted`) + `aria-label="incomplete"`.

Completion is computed **live** (not from the wizard's stored progress columns — those only flip on the
now-removed `advance` action). The single source of truth is the **existing** `checkStepComplete()`
function in `lib/partner/wizard.ts`, which already performs a direct existence check per section against
the underlying config tables — sidestepping the "GET returns default-filled values" problem. Integration
(not covered by `checkStepComplete`) reuses Home's existing "OAuth clients count > 0" check. See §6 for
the new aggregating endpoint. No new per-section query logic is invented.

### 4.4 Go Live states

The pinned **Go Live** row has three visual states driven by `onboarding_completed_at` + the live
completion map:

- **Not live, required sections incomplete** → row reads **"Go Live"**, status label to the right:
  **"Setup incomplete"** (`text-muted`). Clicking opens the Go Live panel (§5, screen state G), which
  lists what's still required; the confirm button in that panel is disabled until required sections pass.
- **Not live, required sections complete** → row reads **"Go Live"**, status label: **"Ready"**
  (`green`). Clicking opens the Go Live panel with the confirm button enabled.
- **Live** (`onboarding_completed_at` set) → row reads **"Live"** with a green dot; the panel shows the
  live URL and a note that the partner is live. The surface is otherwise identical — going live does
  **not** change the nav, the grouping, or any section's availability (Q2 answer: post-go-live the
  surface is the same, minus the "start here" first-run affordance).

### 4.5 First-run affordance (no forced gate)

For a **not-yet-live** partner, above the left-nav groups the pane shows a one-line **"Start here"**
hint and the default-selected section is the first incomplete one (§3). The main panel for a brand-new
partner with nothing configured shows the section editor as normal (each section already has its own
empty state). There is **no locked-until-previous gating** — every section is clickable at all times.
The only first-run difference from the live experience is (a) the "Start here" hint line and (b) the
first-incomplete default selection. Once live, both disappear.

---

## 5. Visual Examples (wireframes)

### Screen state A — Desktop (≥1024px), returning/live partner, "Topics" selected

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Clio Configurator                                        [Acme Corp ▾]      │  ← ConfiguratorNavShell (NOT touched)
├───────────────────────────────────────────────────────────────────────────┤
│  Configurator    API    Docs                                                │  ← tab row (NOT touched)
├──────────────────────────┬────────────────────────────────────────────────┤
│  LEARNING EXPERIENCE      │                                                 │
│   ● Questionnaire         │   Topics                                        │
│   ○ Topics      ◀ active  │   ┌───────────────────────────────────────────┐ │
│   ● Content               │   │ (TopicsConfigClient rendered embedded)    │ │
│   ○ Visualization         │   │  Source:  ( ) Clio-generated              │ │
│                           │   │           (•) Partner-supplied            │ │
│  DELIVERY & INTEGRATION   │   │  …existing Topics editor, unchanged…      │ │
│   ● Domain                │   │                                           │ │
│   ○ Integration           │   └───────────────────────────────────────────┘ │
│                           │                                                 │
│  BILLING                  │                                                 │
│   ○ Payment               │                                                 │
│  ───────────────────────  │                                                 │
│   ► Go Live      Ready ●  │                                                 │
└──────────────────────────┴────────────────────────────────────────────────┘
   ▲ persistent sidebar 260px         ▲ fluid main panel (content max-width 960px)
   ● = complete (green)   ○ = incomplete (hollow)   ◀ active = purple left-border row
```

### Screen state B — Mobile (<768px), drawer closed, "Topics" selected

```
┌─────────────────────────────┐
│ Clio Configurator   [Acme ▾]│  ← ConfiguratorNavShell
├─────────────────────────────┤
│ Configurator  API  Docs     │  ← tab row (horizontally scrollable if needed)
├─────────────────────────────┤
│ [☰ Sections]        Topics  │  ← hamburger + current-section label (new, mobile-only header row)
├─────────────────────────────┤
│  Topics                     │
│  ┌─────────────────────────┐│
│  │ (TopicsConfigClient      ││
│  │  embedded, full width)   ││
│  │  Source: ( ) Clio-gen    ││
│  │          (•) Partner      ││
│  └─────────────────────────┘│
│                             │
└─────────────────────────────┘
```

### Screen state C — Mobile (<768px), drawer OPEN (after tapping ☰)

```
┌─────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░│  ← scrim (dark, tap to close) behind drawer
│┌──────────────────────────┐ │
││ Sections            [✕]   │ │  ← drawer (80vw, max 320px) slides in from left
││                          │ │
││ LEARNING EXPERIENCE      │ │
││  ● Questionnaire         │ │
││  ○ Topics       ◀        │ │
││  ● Content               │ │
││  ○ Visualization         │ │
││ DELIVERY & INTEGRATION   │ │
││  ● Domain                │ │
││  ○ Integration           │ │
││ BILLING                  │ │
││  ○ Payment               │ │
││ ───────────────────────  │ │
││  ► Go Live     Ready ●   │ │
│└──────────────────────────┘ │
└─────────────────────────────┘
   Tapping a section → sets ?section, closes drawer, shows that panel.
```

### Screen state D — First-run (not yet live), brand-new partner, nothing configured

```
┌──────────────────────────┬────────────────────────────────────────────────┐
│  Start here → Questionnaire│  Questionnaire                                 │
│  LEARNING EXPERIENCE      │  ┌───────────────────────────────────────────┐ │
│   ○ Questionnaire  ◀      │  │ (QuestionnaireBuilderClient embedded —    │ │
│   ○ Topics                │  │  its own empty state: "No questionnaire   │ │
│   ○ Content               │  │  yet. Create one to get started.")        │ │
│   ○ Visualization         │  └───────────────────────────────────────────┘ │
│  DELIVERY & INTEGRATION   │                                                 │
│   ○ Domain                │                                                 │
│   ○ Integration           │                                                 │
│  BILLING                  │                                                 │
│   ○ Payment               │                                                 │
│  ───────────────────────  │                                                 │
│   ► Go Live  Setup incomplete                                              │
└──────────────────────────┴────────────────────────────────────────────────┘
   All items clickable (no gating). "Start here →" hint + first-incomplete default only.
```

### Screen state E — Go Live panel, required sections incomplete (confirm disabled)

```
┌───────────────────────────────────────────────┐
│  Go Live                                        │
│                                                 │
│  Before you go live, finish the required setup: │
│   ✕ Questionnaire — publish a questionnaire     │
│   ✓ Payment — funding method added              │
│                                                 │
│  Optional (can be done later):                  │
│   • Topics, Content, Visualization, Domain,     │
│     Integration                                 │
│                                                 │
│  Your end users will reach you at:              │
│   acme.hello-clio.com  (or Clio-hosted fallback)│
│                                                 │
│  [ Go live ]  ← disabled until required pass    │
└───────────────────────────────────────────────┘
```

### Screen state F — Go Live panel, ready (confirm enabled) → success

```
┌───────────────────────────────────────────────┐        ┌──────────────────────┐
│  Go Live                                        │        │        ✓             │
│  Everything required is ready.                  │  →→→   │   You're live.       │
│  Your end users will reach you at:              │  Go    │  Redirecting…        │
│   acme.hello-clio.com                           │  live  └──────────────────────┘
│  [ Go live ]  ← enabled                         │        (then panel shows "Live" state)
└───────────────────────────────────────────────┘
```

### Screen state G — Tablet (768–1023px), drawer closed

Identical interaction model to mobile (state B/C): hamburger `[☰ Sections]` in a header row, off-canvas
drawer on open — but drawer is a fixed 280px and the panel uses 24px padding (vs 16px mobile). Panel is
full-width.

---

## 6. Data Requirements

This is a navigation/layout restructuring. **No new database tables or columns.** All reads/writes are
existing.

### 6.1 Reads

- **`GET /api/admin/configurator/wizard/progress?partner_account_id=`** — existing. Still available;
  used only if a stored view is needed. NOT the completion source (see below).
- **NEW read endpoint — `GET /api/admin/configurator/status?partner_account_id=`** — a **thin
  aggregator** that returns the live completion map for the nav's dots. It is backed by a new
  `lib/partner/configurator-status.ts` that calls the **existing** `checkStepComplete()`
  (`lib/partner/wizard.ts`) for `questionnaire | topics | content | visualization | domain | payment`
  and adds an **integration** check reusing Home's existing rule (OAuth clients count > 0 via the same
  data `GET /api/admin/configurator/oauth-clients` returns). No new query *logic* — it composes the six
  existing `select('id').maybeSingle()` existence checks plus the existing OAuth-clients read into one
  response:
  ```json
  {
    "questionnaire": true, "topics": false, "content": true,
    "visualization": false, "domain": true, "integration": false, "payment": false
  }
  ```
  Auth: `requirePartnerAdmin(partner_account_id)`, identical to the other configurator admin routes.
  Rationale (Q5): these are the same lightweight existence reads the wizard already performs one at a
  time; aggregating them is not a new heavy read path.
- **`GET /api/admin/configurator/domain?partner_account_id=`** — existing. Used by the Go Live panel to
  compute the live-URL preview (verified custom domain → subdomain → Clio-hosted fallback), matching
  `goLive()`'s own precedence.
- Each reused section component performs its own existing reads unchanged when rendered `embedded`.

### 6.2 Writes

- **`POST /api/admin/configurator/wizard/go-live`** — existing, reused by `GoLivePanel`. Its underlying
  `goLive()` validation changes from "stored progress status ≠ pending" to **live `checkStepComplete()`
  for the REQUIRED sections only** (see §6.3). On success it sets `partner_accounts.onboarding_completed_at`
  (unchanged side effect).
- **`POST /api/admin/configurator/wizard/advance`** — **no longer called by the UI** (the linear advance
  action is removed). The route/function may remain in the codebase unused (out of scope to delete;
  §10), but the new surface never calls it.
- **`POST /api/admin/billing/plan-subscription`** and **`POST /api/admin/billing/checkout`** — existing,
  reused unchanged by the extracted `PaymentConfigClient` (the Stripe checkout return URLs update from
  `/wizard?...&funded=1` to `/dashboard/configurator?section=payment&funded=1` — see §9).
- All section writes (questionnaire publish, topics/content/theme save, domain, OAuth-client generation,
  outbound config) are unchanged — they happen inside the reused `embedded` components.

### 6.3 Go Live required-vs-optional (Q2 answer — BA decision, delegated)

`goLive()` currently requires all six non-`go_live` steps to be non-`pending` (where "skipped" also
passes) — effectively meaning a partner could skip everything and still go live. In the non-linear model
there is no "skip" action, so that check is re-expressed as a **live completion check on a defined
required set**:

- **REQUIRED to go live** (Go Live confirm disabled until both pass, validated server-side by `goLive()`
  via `checkStepComplete`):
  - **Questionnaire** — a published questionnaire must exist. It is the end-user entry point the live URL
    resolves to; without it the live surface is empty.
  - **Payment** — a funding mechanism must be set (`partner_wallets.funding_mechanism`). Going live means
    serving real end users at real per-session cost; the wizard already treated Payment as a setup step.
- **OPTIONAL** (never block go-live; each has a working default/fallback):
  - **Topics, Content** — Clio-generated defaults exist.
  - **Visualization** — default theme exists.
  - **Domain** — Clio-hosted `/partner-questionnaire/<id>` fallback exists (subdomain-first but not
    mandatory).
  - **Integration** — only needed for partners doing server-to-server API integration, not the hosted
    questionnaire flow.

This is a deliberate, grounded decision made under the CEO's explicit delegation (brief Q2). It is a
single-constant change if Arun later wants a different required set (e.g. trial-first go-live with
Payment optional) — noted, not escalated.

### 6.4 localStorage / sessionStorage

None. Section selection lives in the URL (`?section=`), not client storage.

---

## 7. Success Criteria (Acceptance Tests)

Each is verifiable by QA. `✓ Given [condition], when [action], then [observable outcome].`

**Navigation & structure**
1. ✓ Given a live partner on `/dashboard/configurator`, when the page loads, then a persistent left
   pane shows exactly three group headings ("Learning experience", "Delivery & integration", "Billing")
   and a pinned "Go Live"/"Live" row, listing all seven sections (Questionnaire, Topics, Content,
   Visualization, Domain, Integration, Payment) — no flat card grid.
2. ✓ Given the surface is open, when the partner clicks any section in the left pane, then the URL
   updates to `?section=<key>`, the main panel swaps to that section's editor, and the left pane, tab
   row, and account switcher remain in place (no full-page navigation).
3. ✓ Given the partner is on section X, when they reload the page, then section X is still selected
   (deep-linkable via `?section=`).
4. ✓ Given no `?section=` and a not-yet-live partner with Questionnaire incomplete, when the page loads,
   then Questionnaire is selected and a "Start here" hint is visible in the pane.
5. ✓ Given a live partner and no `?section=`, when the page loads, then Questionnaire is selected and no
   "Start here" hint is shown.

**Completion indicators**
6. ✓ Given a partner with a published questionnaire and no topic config, when the page loads, then the
   Questionnaire nav item shows a filled green complete dot and the Topics nav item shows a hollow
   incomplete dot, matching `GET /api/admin/configurator/status`.
7. ✓ Given a partner generates an OAuth client in the Integration panel, when the status refetches, then
   the Integration nav item flips from incomplete to complete.

**Go Live**
8. ✓ Given a not-yet-live partner with no published questionnaire, when they open Go Live, then the panel
   lists Questionnaire as a required-but-incomplete item and the "Go live" button is disabled; and a
   direct `POST /api/admin/configurator/wizard/go-live` returns 422 with `pending_steps` including
   `questionnaire`.
9. ✓ Given a not-yet-live partner who has a published questionnaire and a funding mechanism, when they
   click "Go live", then `onboarding_completed_at` is set, a success confirmation shows, and on reload the
   pinned row reads "Live".
10. ✓ Given a live partner, when the page loads, then the surface, grouping, and section availability are
    identical to before go-live (only the "Start here" hint and Go-Live-vs-Live label differ).

**Responsive (see §8/§9 for exact behavior)**
11. ✓ Given viewport ≥1024px, when the surface loads, then the left pane is persistently visible beside
    the panel and no hamburger is rendered.
12. ✓ Given viewport <768px, when the surface loads, then the left pane is hidden, a "☰ Sections" control
    is visible, and tapping it slides in an off-canvas drawer with a scrim; tapping a section closes the
    drawer and shows that panel; and the page body never scrolls horizontally.
13. ✓ Given viewport 768–1023px, when the surface loads, then the off-canvas drawer + hamburger model is
    used (panel full-width).

**Non-regression & mechanism**
14. ✓ Given any section is opened in the panel, when the partner performs that section's existing action
    (publish questionnaire, save topics, generate OAuth client, top-up payment, etc.), then it behaves
    exactly as it did on the standalone route today.
15. ✓ Given the build, when `npx tsc --noEmit` runs, then it completes with zero errors.
16. ✓ Given the new shell/nav files, when `grep -c 'style={{' <new shell/nav files>` runs, then it
    returns 0 (Tailwind classes only — see §8 grep list).
17. ✓ Given the existing full test suite, when it runs, then it passes at the same baseline as before the
    change (1 known pre-existing unrelated failure permitted).
18. ✓ Given a bookmarked `/dashboard/configurator/wizard?partner_account_id=<id>`, when it loads, then it
    redirects to `/dashboard/configurator?partner_account_id=<id>` (no dead route).

---

## 8. Error States

Every state below is scoped to the **new shell/nav**; reused section internals keep their existing error
handling.

- **Completion-status fetch fails** (`GET .../status` non-OK/network error): nav items render with
  **incomplete (hollow) dots** as the safe default; no error banner, no blocked navigation. Sections
  remain fully clickable. A silent retry occurs on next section change. Rationale: the dots are advisory;
  a failed fetch must never block configuration.
- **A section's own reused component fails to load** (e.g. `TopicsConfigClient` load error): the
  component renders its **own existing error state** inside the panel (each already handles this — e.g.
  Integration's "Couldn't load integration settings. Try refreshing the page."). The shell does not
  intercept it.
- **Go Live 422 (`steps_incomplete`)**: the panel shows which **required** sections are still incomplete
  (mapped from `pending_steps`) inline; the "Go live" button stays disabled. No page navigation.
- **Go Live network failure**: inline message "Couldn't go live — try again." in the panel; button
  re-enabled.
- **Payment checkout return unconfirmed** (`funded=1` but wallet not yet funded): reuse the existing
  wizard behavior — inline "We couldn't confirm your payment yet… try again" in the Payment panel; the
  Payment completion dot stays incomplete until confirmed.
- **Slow section load**: the reused component's own loading state ("Loading…") shows inside the panel; the
  left pane stays interactive so the partner can switch away.
- **Invalid `?section=` value**: treated as absent → falls back to the default-section rule (§3). No error.
- **`partner_account_id` missing/invalid**: existing server-side account-resolution logic in
  `page.tsx` applies (falls back to `accounts[0].id`), unchanged.

**Files that must be `style={{}}`-free (Tailwind only) — grep target for AC #16:**
- `app/dashboard/configurator/ConfiguratorSurface.tsx` (new — the left-nav shell)
- any new nav/group/drawer subcomponents co-located in or imported by it (e.g.
  `app/dashboard/configurator/_nav/*.tsx` if split out)

> Note: the reused `embedded` section components, the extracted `PaymentConfigClient`/`GoLivePanel`
> bodies, and the shared `_shared.tsx` primitives (`Card`, `PrimaryButton`, `SecondaryButton`) retain
> their existing inline styles — per the CEO steer to keep section internals as-is. They are out of the
> grep scope. Using `<PrimaryButton>` inside the new Tailwind shell is allowed and does not count as an
> inline style in the shell file.

---

## 9. Edge Cases

- **First-time vs returning:** handled explicitly — default-section rule + "Start here" hint for
  not-yet-live; plain first-item default for live (§3, §4.5). Same surface for both.
- **Partner with zero configured sections:** all dots hollow, all sections clickable, Go Live shows
  "Setup incomplete". No crash, no gating.
- **Partner with everything configured but not yet live:** all dots green, Go Live shows "Ready",
  default section = Go Live panel.
- **Multi-account admin:** the account switcher (in `ConfiguratorNavShell`) persists; switching accounts
  refetches `.../status` and the selected section's data for the new account. Section selection persists
  across the switch (same `?section=`).
- **Mobile drawer open + rotate to desktop width:** at ≥1024px the drawer/hamburger is not rendered; the
  persistent pane shows. Selection is preserved (URL-driven). No orphaned scrim.
- **Very long section (e.g. Visualization with many templates) on mobile:** the panel scrolls
  vertically; wide inline-styled child content is contained by the panel's `overflow-x-auto` +
  `min-w-0` so it scrolls *within* the panel and never forces the page body to scroll horizontally (AC
  #12). The section internals are NOT restyled (that is B2B-21); the shell just contains them.
- **Payment return from Stripe:** the `funded=1` return URL now targets
  `/dashboard/configurator?section=payment&funded=1`; the surface opens on the Payment panel and runs the
  existing confirm-and-refetch flow.
- **Slow network:** dots default to incomplete; sections still navigable; each section shows its own
  loading state.
- **Direct navigation to a standalone section route** (`/dashboard/configurator/topics?...`): redirects
  into `/dashboard/configurator?section=topics&partner_account_id=...` (§10), preserving old deep links.
- **`prefers-reduced-motion`:** all section-switch/drawer animations degrade to opacity-only or instant
  (§7 motion, §11 resolved).

---

## 10. Out of Scope

- **`ConfiguratorNavShell`** (the Configurator / API / Docs tab row + billing-health banner, B2B-16) —
  **not touched**. The new surface renders *inside* it.
- **Any change to a section's internal behavior or fields** — Questionnaire builder, Topics, Content,
  Visualization, Domain, Integration, Payment logic all behave exactly as today. This brief only changes
  how they are navigated and hosted.
- **Restyling the reused section internals for responsiveness** — kept as-is (inline-styled). Sections
  that visibly break on a phone are logged as **B2B-21** candidates, not fixed here (except the Home
  3-col card grid, which is *removed* by unification rather than fixed).
- **The app-wide responsive/mobile audit** ("all screens must be responsive") — explicitly the separate
  proposed **B2B-21** brief (CEO scope boundary). Not started under B2B-20.
- **Design-system changes** — no new colors, no new typography, no new npm dependencies. Existing
  `COLORS` tokens + Tailwind + Framer Motion + Lucide only.
- **Deleting the now-unused `advance` route/function** — left in place (unused); removal is a separate
  cleanup, not required for this brief.
- **New configuration capabilities or AI-populated screens** — none. Literal restructuring only.
- **Changing auth, tenancy, or the `partner_account_id`-in-URL model** — unchanged.

---

## 11. Open Questions

**None.** All seven CEO questions are resolved in-spec:

- **Q1 (unification + first-run):** UNIFY confirmed. Same left-nav surface for new and returning
  partners; first-run gets a non-gating "Start here" hint + first-incomplete default (§3, §4.5). The
  `configurator/page.tsx` wizard redirect is removed; `/wizard` redirects into the unified surface (§3,
  §12). *No escalation:* the only genuine risk in unifying — a brand-new partner bouncing without
  guidance — is fully dissolved by the empty-state affordance (suggested order via first-incomplete
  default + visible completion dots + "Start here"), which delivers first-run guidance without a forced
  gate. There is no irreconcilable conflict with first-run activation, so per the CEO's instruction
  ("escalate only if you find a real reason unification harms first-run") this is decided, not escalated.
- **Q2 (Go Live in a non-linear model):** Go Live is a **pinned action** at the bottom of the pane/drawer
  (not a group, not a forced terminal step). It validates a **required set** (Questionnaire + Payment)
  via live `checkStepComplete`; all other sections are optional (§4.4, §6.3). Post-go-live the surface is
  identical minus the first-run affordance.
- **Q3 (section-set asymmetry):** Integration gets an `embedded` prop added (mechanical, same pattern as
  the other five — §6). Payment is extracted from the wizard's `PaymentStep` into a new
  `PaymentConfigClient` (embedded-capable); Go Live is extracted from `GoLiveStep` + the go-live action
  into a new `GoLivePanel`. All eight areas placed (§4.2).
- **Q4 (grouping & labels):** Three groups — "Learning experience" (Questionnaire, Topics, Content,
  Visualization), "Delivery & integration" (Domain, Integration), "Billing" (Payment) — plus pinned "Go
  Live" (§4.1, wireframes §5). This revises the CEO's proposed grouping (Visualization moved into
  "Learning experience" alongside the content it renders; Domain+Integration form the plumbing group) —
  a validated revision, per the CEO's invitation to finalize.
- **Q5 (completion indicators):** Live per-section boolean via the **existing** `checkStepComplete()` +
  Integration's existing OAuth-count rule, aggregated into one thin `GET .../status` endpoint. No new
  query logic, no heavy read path (§4.3, §6.1).
- **Q6 (responsive, per-breakpoint):** Three tiers with the real behavioral break at `lg` (1024px) and a
  spacing break at `md` (768px) — full spec in §8 wireframes + the table below. Styling mechanism:
  Tailwind utility classes with the existing `COLORS` hexes as arbitrary values (`bg-[#080808]` etc.),
  the project's declared standard and the established B2B-03 pattern — no token changes. Section internals
  untouched; only the new shell/nav is made responsive.
- **Q7 (motion spec):** Defined in §12 "Motion" — Framer Motion (already `^12.38.0`) + CSS, no new
  dependency, with concrete durations/easings and `prefers-reduced-motion` fallbacks.

---

## 12. Dependencies

**Must be true before build:**
- B2B-03 Configurator, B2B-05 wizard + `onboarding_completed_at`/`partner_onboarding_progress`, B2B-06
  Integration, B2B-13 Payment step, B2B-16 `ConfiguratorNavShell` — **all Done** (per
  `docs/b2b-pivot-status.md`).
- `checkStepComplete()` in `lib/partner/wizard.ts` — exists, is the completion source.
- `framer-motion ^12.38.0`, `tailwindcss ^3.4.17`, `lucide-react ^0.511.0`, the `COLORS` token set in
  `_shared.tsx` — all present. **No new dependency required** (confirmed).

**Concrete build task list (files):**

*New:*
- `app/dashboard/configurator/ConfiguratorSurface.tsx` — the unified left-nav + panel client (Tailwind,
  responsive, Framer Motion). Rendered as the child of `<ConfiguratorNavShell active="configurator">`.
- `app/dashboard/configurator/PaymentConfigClient.tsx` — extracted from `WizardClient`'s `PaymentStep`,
  accepts `embedded`; checkout return URLs point at `?section=payment&funded=1`.
- `app/dashboard/configurator/GoLivePanel.tsx` — extracted from `WizardClient`'s `GoLiveStep` + the
  go-live action; reads domain settings for the live-URL preview; calls the existing go-live route.
- `app/api/admin/configurator/status/route.ts` + `lib/partner/configurator-status.ts` — the aggregated
  live-completion endpoint (composes existing `checkStepComplete` + OAuth-count).

*Modified:*
- `app/dashboard/configurator/page.tsx` — remove the `onboarding_completed_at` → `/wizard` redirect;
  resolve default section; render `ConfiguratorSurface` for both first-run and live partners.
- `app/dashboard/configurator/HomeClient.tsx` — removed/replaced by `ConfiguratorSurface` (its
  design-profile bar, if kept, moves into the surface header or a section; card grid removed).
- `app/dashboard/configurator/integration/IntegrationClient.tsx` — add `embedded?: boolean`; when
  `embedded`, return bare `{content}` instead of wrapping in `<ConfiguratorShell>` (mirror the other five).
- `app/dashboard/configurator/wizard/page.tsx` — redirect to `/dashboard/configurator?...`.
- `app/dashboard/configurator/wizard/WizardClient.tsx` — linear shell/`StepIndicator`/advance logic
  removed once `PaymentStep`/`GoLiveStep` are extracted; file removed or reduced to the redirect.
- `lib/partner/wizard.ts` — `goLive()` validation switched from stored-status to live `checkStepComplete`
  over the required set (§6.3).
- Standalone section pages (`questionnaire|topics|content|visualization|domain|integration/page.tsx`) —
  remove the per-page wizard redirect; redirect the route into `/dashboard/configurator?section=<key>`
  (preserve deep links).

**Responsive behavior table (Q6):**

| Tier | Width | Left nav | Panel | Padding |
|---|---|---|---|---|
| Desktop | ≥1024px (`lg`) | Persistent sidebar, fixed 260px, always visible; no hamburger | Fluid, beside sidebar; content max-width 960px | 32px |
| Tablet | 768–1023px (`md`–`lg`) | Off-canvas drawer, fixed 280px, opened by `☰ Sections`; scrim behind | Full-width | 24px |
| Mobile | <768px (`md`) | Off-canvas drawer, 80vw (max 320px), opened by `☰ Sections`; scrim behind; `[✕]` to close | Full-width; `overflow-x-auto` + `min-w-0` to contain wide section internals | 16px |

**Motion (Q7) — Framer Motion + CSS, no new dependency:**
- **Section switch:** `AnimatePresence mode="wait"`; enter `{opacity:0, y:8} → {opacity:1, y:0}`, exit
  `{opacity:0}`; duration 0.18s, ease `easeOut`.
- **Nav item hover:** CSS `transition` background/color 0.12s ease → `#1A1A1A` bg, `#FFFFFF` text.
- **Active nav item:** 3px purple `#7C3AED` left border + `rgba(124,58,237,0.10)` bg, no animation
  (instant state).
- **Drawer open/close:** transform `translateX(-100% → 0)` + scrim opacity `0 → 1`; duration 0.22s, ease
  `easeOut`.
- **`prefers-reduced-motion: reduce`:** all of the above degrade to opacity-only or instant; no transforms.

---

*End of Requirement Document B2B-20 v1.0 — all 12 sections filled, Section 11 empty. Ready for CEO
review.*
