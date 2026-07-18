# Feature Brief: B2B-24 — Configurator Dashboard / Overview (landing screen)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-18

---

## ID / collision note — RATIFIED by Orchestrator, 2026-07-18

This brief originally claimed `B2B-21`, then self-reassigned to `B2B-22` — both wrong. A 4-way parallel
collision occurred (four briefs dispatched simultaneously, all reading `B2B-20` as the highest existing
ID). The Orchestrator resolved the final assignment by actual file mtime (not each agent's self-report,
which disagreed):

1. `B2B-21-internal-admin-identity-super-admin-and-sales-partner.md` (earliest, mtime) → **B2B-21**.
2. `B2B-22-partner-facing-known-bugs-screen.md` (2nd) → **B2B-22**.
3. `B2B-23-configurator-milestone-scope-reduction-responsive-and-content-auth-docs.md` (3rd) → **B2B-23**.
4. `B2B-24-configurator-dashboard-overview-landing.md` (this brief, last/4th) → **B2B-24**.

File renamed and this header corrected accordingly. Sibling cross-references below are bound to their
final ratified IDs.

---

## What Arun Said (verbatim, 2026-07-18)

Arun approved this screen in direct conversation. On placement:

> "yes this dashboard should be the first in the tab in the left pane"

On the quality bar:

> "make it useful, beautiful, modern, smooth and responsive"

**Conversation context (so the BA has the provenance):** the Orchestrator proposed a Dashboard/Overview
landing screen with **four content areas** (setup status, live status, wallet snapshot, quick-nav).
Arun confirmed the direction with the quality-bar line above **and deferred the exact scope to the
sibling Configurator-scope-reduction brief** — i.e. *build these four areas, but scope the "what's
required" content to whatever that sibling brief resolves as the real Go-Live required-set,* not
today's stale set. This brief carries that instruction literally.

---

## The Problem Being Solved

After B2B-20, the Configurator is a single left-nav surface (`ConfiguratorSurface.tsx`) that opens
**directly into a configuration section** — `page.tsx` resolves the landing section to the first
incomplete section (or Questionnaire once live). There is **no at-a-glance overview**. A partner who
signs in — especially a *returning* partner adjusting a live integration, which CORE_OBJECTIVES
Objective 4 says is the dominant mode — has to reconstruct their own state by clicking through sections
one at a time to answer basic questions:

- Am I live? Since when?
- What's left before I *can* go live?
- How much balance is in my wallet, and am I about to run dry?
- Where do I go for API keys or docs?

Every modern developer/SaaS console (Stripe, Anthropic, Resend — the exact set B2B-16 benchmarked
against) opens on an **overview that answers those questions in one glance**, then routes you to the
thing you came to do. Clio's Configurator currently drops the partner straight into a form. This brief
adds the missing front door: a **Dashboard** that is the first thing in the left nav and the default
landing destination, surfacing status and routing — not a new place to configure anything.

This is squarely CORE_OBJECTIVES v3 **Objective 4** ("configure everything easily… after
configuration they need not use our application") — a status-and-routing overview is what makes a
returning partner's "quick adjustment" actually quick.

---

## Dependency — READ THIS BEFORE THE BA STARTS

**This brief has a hard content dependency on the sibling "Configurator scope reduction" brief** —
**B2B-23**, `B2B-23-configurator-milestone-scope-reduction-responsive-and-content-auth-docs.md` (see the
ID note above). That sibling brief hides Questionnaire / Topics / Content / Visualization from the
Configurator and **resolves what Go-Live actually requires** for the current milestone.

Why this Dashboard depends on it: the Dashboard's **"setup completion glimpse" (Area 1) must reflect
the sibling brief's RESOLVED required-set — not the current stale one.** Today the required-set is
hardcoded as `questionnaire && payment` (`ConfiguratorSurface.tsx:154` `requiredReady`;
`GoLivePanel.tsx:31` `REQUIRED_LABELS`; `GoLivePanel.tsx:76`). **B2B-23's C5/Domain escalation is now
RESOLVED (Arun, 2026-07-18, Option A)** — the confirmed required set is **`['integration', 'payment']`**
(white-label Domain hidden entirely, not part of the set). Build Area 1 against this resolved set, not
the stale one, and remove the now-hidden Questionnaire/Topics/Content/Visualization sections from view
entirely. If this Dashboard were built against the current hardcoded set, it would show a partner a
"Questionnaire incomplete" nag for a section that no longer exists in their nav.

**Instruction to Orchestrator / BA:**
- **Write and review this brief now regardless** — it is complete and CEO-reviewable as-is.
- **Sequencing waits:** the BA should not finalize Area 1's exact section list, and the developer must
  not hardcode a required-set, until the sibling brief's required-set is resolved. Bind to it then.
- **Sibling ID is bound: B2B-23.**
- **Do NOT reintroduce the hidden sections** into this Dashboard to "fill it out." If the sibling brief
  hides them, they are hidden here too.

---

## What Success Looks Like

- A partner opens the Configurator and lands on a **Dashboard** — the **first item in the left nav** —
  that answers "where am I / what's left / am I live / what's my balance / where do I go" **without a
  single click**.
- **Live status** is unambiguous: a live partner sees "Live since {date}"; a not-yet-live partner sees
  what's still required and a one-click path to Go Live.
- The **setup glimpse shows what's left before Go Live** (scoped to the sibling brief's required-set) —
  a *live* status readout, not a static checklist, reusing the completion mechanism B2B-20 already
  built.
- The **wallet balance** and any low-balance warning are visible here, more prominently than the small
  top banner they live in today.
- **Quick-nav tiles** route in one click to Configurator / API / Docs and deep-link into whichever
  sections are still incomplete.
- It meets the **useful / beautiful / modern / smooth / responsive** bar within Clio's existing design
  system — real card/panel treatment, no AI-slop patterns, fully responsive from the start.
- It **adds no configuration capability** and **duplicates no existing screen's data logic** — it is a
  read-only overview composed from data sources that already exist.

---

## The Four Content Areas (adjusted for the milestone-scoped reality)

### Area 1 — Setup completion glimpse
- **Reuse the existing completion mechanism, invent none.** `getConfiguratorStatus()`
  (`lib/partner/configurator-status.ts`) already returns a live completion map for all seven sections
  by composing `checkStepComplete()` (`lib/partner/wizard.ts`) + the Integration OAuth-count rule; it is
  served at `GET /api/admin/configurator/status` and already consumed client-side by
  `ConfiguratorSurface` (`ConfiguratorSurface.tsx:117`). The Dashboard reads the **same** source.
- **Show what's left before Go Live, not a generic checklist.** Present completion **only across the
  sections that are actually required per the sibling scope brief** (likely Integration + Payment +
  possibly Domain — **bind to the sibling, do not hardcode**), and surface the *first incomplete
  required* section as the primary call-to-action.
- **Do NOT show the now-hidden sections** (Questionnaire/Topics/Content/Visualization) if the sibling
  brief hides them.

### Area 2 — Live status
- **Reuse `isLive`**, derived from `partner_accounts.onboarding_completed_at` (`page.tsx:79`). Do not
  invent a second live-state notion — `GoLivePanel` already treats this as the live signal.
- **"Since when" is a real data point**, but note the gap: `page.tsx:75-79` currently selects
  `onboarding_completed_at` and coerces it to a boolean (`isLive`). To show "Live since {date}", the
  **timestamp value itself** must be surfaced (select it as a value, thread it through). Flag for the BA
  as a small, precise mechanical addition — not a schema change.

### Area 3 — Wallet / billing snapshot
- **Surface the balance prominently.** `partner_wallets.balance_usd` is a real column, already read in
  several routes (`app/api/admin/billing/clients/route.ts`, `app/api/partner/v1/sessions/route.ts:208`).
- **Reuse the billing-health *state* logic** from `_billing-health.ts` for the low-balance / past-due /
  canceled warning — the same signal that drives B2B-16's top banner (`getBillingHealth()` →
  `BillingHealth`). **Do not re-derive** those states.
- **Named gap the BA must resolve:** the current `BillingHealth` shape (`_shared.tsx:96`) carries only
  `state` — **not the numeric balance.** `getBillingHealth()` selects `plan_status` +
  `low_balance_alert_fired_at`, *not* `balance_usd`. So a numeric balance snapshot needs `balance_usd`
  surfaced — either by extending the existing read/shape or a small co-located read. See Open Questions.
- **Low-balance threshold:** reuse the existing `low_balance_alert_fired_at` signal (migration 075) as
  B2B-16 did — **do not invent a numeric threshold.**
- This is a **more prominent surfacing** of data that already exists in the top banner — not a new
  billing subsystem.

### Area 4 — Quick-nav tiles
- One-click access to the **three B2B-16 top-level destinations: Configurator / API / Docs** (reachable
  via `ConfiguratorNavShell`).
- **Plus deep-links into incomplete Configurator sections.** Deep-linking already works: the surface
  reads `?section=` (`page.tsx:84`, `ConfiguratorSurface.tsx:147-149`), so a tile links to
  `?section={key}`. Reuse that; do not build new routing.

---

## Explicitly Excluded — by design, not oversight

**No glitch / issue / bug data on this Dashboard, of any kind.**
- A sibling **"Known Bugs" brief** — **B2B-22**, `B2B-22-partner-facing-known-bugs-screen.md` — owns
  partner-visible bug status as its **own dedicated screen**. Do not duplicate that content here.
- B2B-17's glitch tracker is **internal-Clio-only**. Only the Known Bugs brief's carefully-scoped
  partner-facing subset is ever partner-visible, and it lives on its own screen — **never surface raw
  internal glitch-tracker data on this Dashboard.**

---

## Nav Placement & Default Landing (this section is where the real ambiguity lives)

### Placement — my recommendation
Make **Dashboard a standalone, pinned top-level nav entry** — the **first item**, above the three
existing groups (`NAV_GROUPS`: Learning experience / Delivery & integration / Billing in
`ConfiguratorSurface.tsx:48-69`) and outside all of them — **mirroring how "Go Live" is already pinned
at the bottom** (`mt-auto` GoLiveRow, `ConfiguratorSurface.tsx:357-365`). Not a new group; a single
pinned entry, so the nav reads: **[Dashboard] · Learning experience… · Delivery & integration… ·
Billing… · [Go Live]**. Mechanically this means adding `'dashboard'` to `PanelSection`,
`VALID_SECTIONS` (`page.tsx:20`), `SECTION_LABEL` (`ConfiguratorSurface.tsx:71`), the `renderPanel`
switch (`ConfiguratorSurface.tsx:280`), and a pinned top NavRow.

### Default landing — the named ambiguity the BA MUST resolve precisely
Today `page.tsx:84-94` resolves the landing section: an explicit valid `?section=` always wins; else
**live → Questionnaire**; else **first-incomplete section → Go Live**. Separately,
`ConfiguratorSurface.tsx:155,334-338` renders a nav-level **"Start here → {firstIncomplete}"** hint.

The task is to make **Dashboard the default landing destination**, replacing the first-incomplete
auto-select. The precise, un-hand-waved interaction the BA must pin down:

- **Option A (my lean):** Land on **Dashboard by default** for *both* live and not-live partners
  (explicit `?section=` still wins). The Dashboard itself **absorbs the first-incomplete nudge** as its
  primary CTA ("Next: finish {section} →"). **Remove** the nav-level "Start here" hint to avoid the same
  nudge appearing twice. The `page.tsx` first-incomplete computation for `initialSection` is dropped
  (the Dashboard computes its own nudge from the status map it already fetches).
- **Option B:** Keep both — land on Dashboard, but *also* keep the nav "Start here" hint.
- **Option C:** Land on Dashboard only when nothing is incomplete / only when live; otherwise keep
  auto-selecting the first incomplete section.

I recommend **Option A** (one clear front door, one nudge, no duplication), but this is a genuine
product-interaction call — **the BA must document the chosen behavior for brand-new vs. returning vs.
live partners explicitly, with a wireframe, and reconcile it against `page.tsx`'s `initialSection`
logic and the nav "Start here" hint. Do not leave the Dashboard-vs-first-incomplete interaction
ambiguous.** If the BA's analysis favors B or C over A, that's fine — but it must be decided and
written, not left open.

---

## Design Bar — "useful, beautiful, modern, smooth, responsive"

This is a real design-quality requirement, not just structure. Enforce:

- **Existing design system only.** Work within Clio's dark-void/purple `COLORS` tokens (`_shared.tsx`)
  — **no new colors, no new typography.**
- **Real card/panel treatment per area.** Reference today's design-review finding: avoid the
  "no card/surface treatment" pattern — each of the four areas gets a proper surface/panel, not raw
  content floating on the `#080808` void.
- **No AI-slop patterns.** No generic 3-column icon-in-a-circle grid; no decorative gradients. The
  quick-nav tiles in particular must **not** default to that clichéd layout.
- **Responsive from the start**, using the fluid/tiered Tailwind-arbitrary-value approach B2B-20
  established as the new standard (`bg-[#080808]` etc., **zero inline-style objects, no hardcoded
  pixel-width caps**). No horizontal scroll on mobile.
- **Structure/IA is decided here; pixel polish is not.** Per the standing governance rule, this
  CEO/BA brief fixes information architecture and layout structure; a **`/design-review` pass follows
  once built** for final visual polish. The BA should spec IA + responsive layout structure per
  breakpoint, not attempt full pixel-level styling.

---

## Known Constraints (enforce these)

1. **Bind Area 1 to the sibling scope brief's resolved required-set. Do NOT hardcode
   `questionnaire && payment`** (the current stale set at `ConfiguratorSurface.tsx:154` /
   `GoLivePanel.tsx:31`).
2. **No new npm dependencies without written justification.** Specifically: check whether a
   chart/sparkline for wallet burn-rate is actually needed, or whether a **simple numeric balance
   display suffices for v1** (my steer: numeric-only v1; Framer Motion + Lucide are already available if
   any motion/icon is wanted). Anything beyond that needs justification.
3. **Reuse existing data sources; duplicate no query logic:** `getConfiguratorStatus()` /
   `checkStepComplete()` / `GET /api/admin/configurator/status` (setup), `isLive` /
   `onboarding_completed_at` (live state), `getBillingHealth()` + `balance_usd` (wallet), `?section=`
   deep-linking (quick-nav).
4. **Do NOT touch B2B-16's top-level nav shell** (`ConfiguratorNavShell`, the Configurator/API/Docs tab
   row) or its billing-health banner. The Dashboard sits **inside** the Configurator content area,
   beneath that nav — same boundary B2B-20 respected.
5. **Do NOT touch any section's internals** (the `embedded` section clients, `PaymentConfigClient`,
   `GoLivePanel`). This is an additive read-only overview.
6. **Implement literally.** Read-only status + routing. **No speculative AI-populated content** on this
   screen. No glitch/bug data (see Excluded).

---

## Questions for the BA to Resolve (Section 11 must end empty before dev)

Answer each with a concrete example / wireframe, not prose:

1. **Dashboard-vs-first-incomplete-auto-select interaction (the big one).** Choose Option A/B/C above
   (or a documented variant). Specify exactly what a **brand-new**, a **returning-but-not-live**, and a
   **live** partner each land on, what happens to `page.tsx`'s `initialSection` computation, and whether
   the nav "Start here" hint (`ConfiguratorSurface.tsx:334-338`) survives, moves onto the Dashboard, or
   is removed. No ambiguity.
2. **Area 1 required-set (blocked on sibling).** Which sections' completion appears in the setup
   glimpse — bound to the sibling scope brief's resolved required-set. Do not finalize this list until
   the sibling resolves it. Also: what, if anything, shows for *optional-but-incomplete* sections
   (nothing? a muted secondary list?).
3. **Wallet snapshot data shape (named gap).** How is `balance_usd` surfaced given the current
   `BillingHealth` shape carries only `state` — extend `getBillingHealth()`/`BillingHealth` to also
   return `balance_usd` (and possibly `next_billing_date`, already read in the admin billing route), or
   a separate small co-located read? Confirm low-balance uses the existing `low_balance_alert_fired_at`
   signal (no invented threshold). Specify exactly what the area displays (balance number, plan tier,
   next-billing date, warning state).
4. **Live "since when."** Confirm surfacing the `onboarding_completed_at` **timestamp value** (currently
   only read as a boolean at `page.tsx:79`); specify the copy/format ("Live since Jul 14, 2026").
5. **Quick-nav tiles.** Exact destinations (confirm Configurator / API / Docs via `ConfiguratorNavShell`
   routes) and how the incomplete-section deep-links render (only incomplete required sections? all
   incomplete? what labels?). Confirm they reuse `?section=` deep-linking.
6. **Empty / first-run state.** What the Dashboard shows for a brand-new partner with nothing configured
   vs. a fully-live partner — the two visual extremes, both wireframed.
7. **Sparkline/chart necessity (Constraint 2).** Confirm numeric-only wallet display for v1, or justify
   a visualization with **no new dependency**.
8. **Visible label.** "Dashboard" or "Overview"? Arun said "dashboard"; confirm the exact nav label and
   panel heading the partner sees.

---

## CEO Review Gate

Per the governance chain, I review the completed Requirement Document before any developer starts. I
will **not** approve it if: Section 11 has any open question; the Dashboard-vs-first-incomplete
interaction (Q1) is asserted rather than specified with a wireframe; Area 1 is finalized against the
stale `questionnaire && payment` set instead of the sibling brief's resolved required-set; the wallet
`balance_usd` gap (Q3) is hand-waved; or any content area is described in fewer than three lines without
an example. Send it back when all twelve sections are filled and every question above is answered with a
concrete example.
