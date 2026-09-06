# Lead With Custom Domain — Requirement Document

Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-09-06

Source: Feature Brief `.claude/agents/clio/feature-briefs/DOMAIN-GUIDE-01-lead-with-custom-domain.md` (CEO/Arun, P0, 2026-09-06)

---

## 1. Purpose

Today the entire `domain` Configurator section is hidden from partners (`VISIBLE_SECTIONS` in
`lib/partner/configurator-sections.ts` is `['integration', 'payment']` only). A newly-invited
partner has no visible way to set up any domain at all. Even once the section is made visible, the
existing `DomainConfigClient.tsx` presents the shared Clio subdomain first and treats the custom
domain as a secondary, muted option gated behind having already claimed a subdomain — and its DNS
instructions are a bare Type/Name/Value table with zero explanation, written for someone who already
knows what a CNAME record is.

The result: partners either never set up a domain, or default to `hello-clio.com`-branded
subdomains, which puts Clio's brand in front of their end users and undercuts the white-label pitch
that is core to the B2B/B2B2C product.

This feature re-exposes the Domain section, reorders and reframes the two paths so custom domain is
presented first and as the recommended choice, and rewrites the custom-domain instructions in plain,
beginner-friendly language — without changing any underlying data model, verification flow, or
Vercel Domains integration, all of which are already correct and live.

Failure without this feature: partners continue defaulting to (or never leaving) the shared
subdomain, permanently undermining the product's white-label positioning for every partner who goes
live before this ships.

## 2. User Stories

As a **newly-invited partner admin** who has never configured DNS before,
I want to see, understand, and complete custom domain setup in the Configurator without needing
outside help,
So that my end users see my own domain, not `hello-clio.com`, from day one.

As a **partner admin who wants to start immediately without touching DNS**,
I want a clearly-labeled, low-friction fallback to a Clio subdomain,
So that I can go live today and add my own domain later without losing momentum.

As a **partner admin with a pending or failed custom-domain verification**,
I want to always be able to tell, at a glance, what state my domain is in and exactly what to do
next (recheck, wait, or try a different domain),
So that I'm never stuck wondering whether something is broken or just needs more time.

## 3. Trigger / Entry Point

- **Route:** `/dashboard/configurator/domain` (standalone) and the `domain` case inside the unified
  Configurator surface at `/dashboard/configurator?section=domain` (`ConfiguratorSurface.tsx`,
  rendered via `DomainConfigClient` with `embedded`).
- **Trigger:** partner admin clicks "Domain" in the Configurator left-nav ("Delivery & integration"
  group) — currently absent because `domain` is not in `VISIBLE_SECTIONS`; this feature adds it back.
- **Required state:** partner admin is authenticated (Clerk) and has at least one partner account
  they administer (`activePartnerAccountId` is always resolved before this component renders, per
  the existing `ConfiguratorShell`/`ConfiguratorNavShell` pattern — unchanged).
- No change to how the route is reached — only to what `VISIBLE_SECTIONS` contains and to the
  content of the `domain` screen itself.

## 4. Screen / Flow Description

All states below live inside the existing `DomainConfigClient.tsx` render tree: a loading state, an
error state, and the loaded state (heading + two cards, reordered). Exact literal copy is specified
in full — the Dev agent must not paraphrase.

### 4.1 Loading state (unchanged)
- Card containing centered text: `Loading domain settings…`

### 4.2 Load-error state (unchanged)
- Card containing centered text: `Couldn't load domain settings. Try refreshing the page.`

### 4.3 Loaded state — heading
- `<h1>` text: `Domain`
- Directly below the heading, a new one-line intro paragraph (new copy, not present today), 13px,
  `COLORS.textSecondary`:
  > "Your own domain means your end users only ever see your brand — never ours. We recommend
  > setting one up below."

### 4.4 Loaded state — card order (changed)
1. **Custom domain card** (was second, now first — the recommended path)
2. **Subdomain card** (was first, now second — reframed as the instant-start fallback)

Both cards keep their existing internal component boundaries (`CustomDomainCard`,
`SubdomainCard`) — only their rendering order in `DomainConfigClient`'s loaded-state JSX changes,
plus the copy/framing changes specified below.

### 4.5 Custom domain card — visual framing as "Recommended"

Applies to **all four** of `CustomDomainCard`'s existing status branches (`none`,
`pending_verification`, `verified`, `failed`) — the recommended framing is a persistent visual
treatment of the card itself, not tied to one status.

- The card gets a `border` override of `2px solid ${COLORS.purple}` (in place of the default `Card`
  border) to visually mark it as the primary path. Use the existing `Card` component's `style` prop
  to override: `style={{ border: \`2px solid ${COLORS.purple}\` }}` (merge with any existing
  per-status `style`, e.g. the `verified`/`pending_verification`/`failed` branches that don't
  currently pass a custom style will now pass this one; the `none`+muted branch's existing
  `opacity: 0.6` is removed entirely — see Section 4.7, muting no longer applies).
- A small badge-style label is added directly above the existing "Custom domain" title line, using
  the same `StatusBadge`-style visual pattern already defined in this file (dot + label), reusing
  `COLORS.purple` as the dot/text color and the literal label text `Recommended`:
  ```tsx
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: COLORS.purple, marginBottom: 8 }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.purple, display: 'inline-block' }} />
    RECOMMENDED
  </span>
  ```
  This renders in all four status branches, immediately above the existing `"Custom domain"` `<p>`
  title line, so it never disappears once a partner starts the flow.
- No new primitives are introduced — this reuses `Card`'s existing `style` merge pattern and the
  dot+label visual idiom that `StatusBadge` already established in this same file.

### 4.6 Subdomain card — reframed as fallback

- The card title `Your Clio subdomain` is unchanged (do not rename — `subdomain_slug` and its DB
  column are unrelated to this copy pass, and "Clio subdomain" remains factually accurate).
- Add one new line directly below the title in both the "already set" and the "editing" render
  branches, 12px, `COLORS.textSecondary`, literal text:
  > "Want to get started right now without touching DNS? Claim a free subdomain — you can switch to
  > your own domain any time."
- No visual de-emphasis (no dimming, no reduced border) — the fallback must still be fully usable
  and inviting for a partner who deliberately chooses it; only its position (now second) and this
  one framing line communicate that it's the secondary path.

### 4.7 Custom domain card — `none` status, un-gated (see Section 6.4 for the decision)

The `muted` gating (`const muted = !settings.subdomain_slug`) is **removed**. The `none`-status
branch always renders the full add-a-domain form — never the muted "Add your own domain once your
subdomain is set" message. New literal copy for this branch, replacing the existing intro paragraph:

> "Use your own domain so your end users always see your brand. You don't need a Clio subdomain
> first — you can add your own domain right now."

Followed by the existing `input` (placeholder `learning.acme.com`) and `PrimaryButton` ("Add
domain"), unchanged.

### 4.8 Custom domain card — `pending_verification` status, full rewrite

Replaces the existing bare Type/Name/Value table and the "up to 48 hours" line. Full literal copy,
in order:

1. Existing header row (unchanged): "Custom domain" title + `StatusBadge` amber "Pending".
2. Existing domain name line (unchanged): `{settings.custom_domain}`.
3. **New CNAME explainer paragraph** (13px, `COLORS.textSecondary`, replaces the old 12px "Add this
   DNS record at your domain registrar:" line):
   > "One more step: you need to add a DNS record for this domain. A CNAME record is just an
   > instruction that tells the internet "when someone visits this domain, send them to Clio" — it's
   > the standard way to point a domain you own at a service like ours."
4. **New "where to do this" paragraph** (13px, `COLORS.textSecondary`):
   > "Log into wherever you manage DNS for this domain — usually the same place you bought it or
   > manage your website (for example GoDaddy, Namecheap, Cloudflare, or Google Domains) — and add
   > the record shown below."
5. **The exact record itself** — unchanged data source (still read live, per-row, from
   `settings.custom_domain_verification`, never hardcoded), but re-labeled with a short intro line
   above the existing three-column Type/Name/Value layout (12px, `COLORS.textMuted`, replacing the
   old "Add this DNS record at your domain registrar:" line since that sentence's job is now done by
   items 3–4 above):
   > "Here's the exact record to add:"

   The Type/Name/Value column headers and per-row rendering (`v.type`, `v.domain`, `v.value`) are
   otherwise **unchanged** — same layout, same live data, same styling.
6. Existing action buttons row (unchanged): "Recheck verification" / "Remove domain".
7. **New "Recheck is manual" clarification**, placed directly below the buttons row, replacing the
   line that currently reads "DNS changes can take up to 48 hours to propagate." (12px,
   `COLORS.textMuted`):
   > "DNS changes usually take effect within a few minutes to a few hours, though occasionally up to
   > 48 hours. This doesn't check itself — click "Recheck verification" above once you've added the
   > record to see if it's picked up."

### 4.9 Custom domain card — `verified` and `failed` statuses

Unchanged apart from the "Recommended" badge addition (Section 4.5) and the border treatment. No
copy changes to the verified confirmation or the failed-domain error message — those are already
clear and are not called out in the CEO brief's content direction.

## 5. Visual Examples

### 5.1 Loaded state — custom domain `none`, un-gated (new default first-visit view)

```
┌───────────────────────────────────────────────────────────┐
│  Domain                                                     │
│  Your own domain means your end users only ever see your   │
│  brand — never ours. We recommend setting one up below.    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │ ← 2px purple border
│  │ ● RECOMMENDED                                        │   │
│  │ Custom domain                                        │   │
│  │ Use your own domain so your end users always see     │   │
│  │ your brand. You don't need a Clio subdomain first —  │   │
│  │ you can add your own domain right now.               │   │
│  │ [ learning.acme.com                                ]  │   │
│  │ [ Add domain ]                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Your Clio subdomain                                  │   │
│  │ Want to get started right now without touching DNS?  │   │
│  │ Claim a free subdomain — you can switch to your own   │   │
│  │ domain any time.                                      │   │
│  │ [ acme-co            ] .hello-clio.com                │   │
│  │ Lowercase letters, numbers, and hyphens only.         │   │
│  │ 3–63 characters.                                      │   │
│  │ [ Save subdomain ]                                    │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### 5.2 Loaded state — custom domain `pending_verification`

```
┌───────────────────────────────────────────────────────────┐
│  Domain                                                     │
│  Your own domain means your end users only ever see your   │
│  brand — never ours. We recommend setting one up below.    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │ ← 2px purple border
│  │ ● RECOMMENDED                                        │   │
│  │ Custom domain                          ● Pending      │   │
│  │ learning.acme.com                                     │   │
│  │                                                        │   │
│  │ One more step: you need to add a DNS record for this  │   │
│  │ domain. A CNAME record is just an instruction that    │   │
│  │ tells the internet "when someone visits this domain,  │   │
│  │ send them to Clio" — it's the standard way to point a │   │
│  │ domain you own at a service like ours.                │   │
│  │                                                        │   │
│  │ Log into wherever you manage DNS for this domain —    │   │
│  │ usually the same place you bought it or manage your   │   │
│  │ website (for example GoDaddy, Namecheap, Cloudflare,  │   │
│  │ or Google Domains) — and add the record shown below.  │   │
│  │                                                        │   │
│  │ Here's the exact record to add:                       │   │
│  │   Type   Name          Value                          │   │
│  │   CNAME  learning      cname.vercel-dns.com            │   │
│  │                                                        │   │
│  │ [Recheck verification]  [Remove domain]               │   │
│  │                                                        │   │
│  │ DNS changes usually take effect within a few minutes  │   │
│  │ to a few hours, though occasionally up to 48 hours.   │   │
│  │ This doesn't check itself — click "Recheck            │   │
│  │ verification" above once you've added the record to   │   │
│  │ see if it's picked up.                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Your Clio subdomain  ...(unchanged, second)           │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### 5.3 Loaded state — custom domain `verified`

```
┌───────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────┐   │ ← 2px purple border
│  │ ● RECOMMENDED                                        │   │
│  │ Custom domain                          ● Verified     │   │
│  │ learning.acme.com                      [Copy]        │   │
│  │ [Remove domain]                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Your Clio subdomain  ...(unchanged, second)           │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### 5.4 Loaded state — custom domain `failed`

```
┌───────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────┐   │ ← 2px purple border
│  │ ● RECOMMENDED                                        │   │
│  │ Custom domain                            ● Failed     │   │
│  │ learning.acme.com                                     │   │
│  │ Couldn't add this domain: <error>                     │   │
│  │ [Try a different domain]                              │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Your Clio subdomain  ...(unchanged, second)           │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

## 6. Data Requirements — and Explicit Decisions

No new data is read or written by this feature. All four open questions from the Feature Brief are
resolved below with full reasoning, per the brief's explicit delegation of these calls to the BA.

### 6.1 Decision — `domain` and `GO_LIVE_REQUIRED_STEPS`

**Call: Do NOT add `domain` to `GO_LIVE_REQUIRED_STEPS`.** It stays `['integration', 'payment']`,
unchanged.

**Reasoning:**
- The Feature Brief itself frames this work as "a visibility + comprehension problem, not a
  missing-capability problem" — a copy/layout/ordering pass, not a gating-logic change. Adding
  `domain` to the required set is a materially different kind of change: it would newly block
  Go-Live for any partner who has not yet claimed a subdomain or added a custom domain, including
  partners currently mid-onboarding today who are otherwise fully ready.
- It would also require touching hardcoded logic well outside this feature's stated blast radius,
  in files the Feature Brief explicitly did not ask this pass to modify: `GoLivePanel.tsx`'s
  `requiredReady` check (`status.integration && status.payment`, line 80) and its `REQUIRED_LABELS`
  array (lines 35–38, hardcoded to `'integration' | 'payment'`), and `ConfiguratorSurface.tsx`'s own
  duplicate `requiredReady` check (line 162, same hardcoded pair). Both would need new domain-aware
  logic and copy to stay internally consistent with a widened `GO_LIVE_REQUIRED_STEPS` — a
  meaningfully larger and riskier change than a copy pass, and one that risks the exact
  "irreconcilable inconsistency" failure mode the project's escalation rules exist to catch.
- Re-exposing `domain` in `VISIBLE_SECTIONS` alone already gets most of the desired behavioral
  effect for free, with zero additional code: `DashboardPanel.tsx`'s `SetupArea` computes its
  `optional` list generically as `VISIBLE_SECTIONS.filter((k) => !REQUIRED.includes(k) &&
  !status[k])` (line 211) and will automatically start rendering "Optional: Domain not yet
  configured" the moment `domain` is visible — no `DashboardPanel.tsx` edit needed. Combined with
  this feature's "Recommended" framing on the domain screen itself and the new intro sentence
  ("we recommend setting one up"), a partner going through Configurator is already strongly nudged
  toward setting up a real domain without being hard-blocked from going live on the subdomain in the
  meantime — which the brief explicitly confirms remains a legitimate path ("a partner can go live
  on the shared subdomain today with no domain at all").
- This keeps the feature's actual code change surface to exactly what the brief's Known Constraints
  ask for: `configurator-sections.ts`'s `VISIBLE_SECTIONS` array, and `DomainConfigClient.tsx`'s
  copy/layout/ordering — nothing else.

**Flagged as a dependency for a possible future, separate Feature Brief** (Section 12): if Arun later
wants real go-live gating on domain, that is a distinct, larger change touching
`GO_LIVE_REQUIRED_STEPS`, `GoLivePanel.tsx`'s `REQUIRED_LABELS`/`requiredReady`, and
`ConfiguratorSurface.tsx`'s `requiredReady` — logged in Section 12, not built here.

### 6.2 Decision — card ordering and visual framing

**Call:** Custom domain card first, Subdomain card second (Section 4.4). Custom domain gets a
persistent `2px solid COLORS.purple` border plus a small `RECOMMENDED` dot+label badge (Section 4.5),
reusing the existing `Card`/`StatusBadge` visual idiom already in this file — no new primitive.
Subdomain gets one added framing sentence (Section 4.6) but no visual de-emphasis, since it must
remain a fully legitimate, inviting choice for partners who want it.

**Reasoning:** matches the brief's explicit ask ("custom-domain card appears first, visually framed
as the recommended choice; the shared subdomain appears second, framed as an optional instant-start
fallback") using only primitives already present in `../_shared` and this file, per the Known
Constraint against inventing new visual primitives.

### 6.3 Decision — exact literal copy

All four requested copy blocks are written out in full in Section 4: the CNAME explainer (4.8 item
3), the DNS-provider examples list (4.8 item 4), the propagation reassurance line (4.8 item 7), and
the "Recheck verification is manual" clarification (also 4.8 item 7 — the brief's content direction
combines the propagation-timing reassurance and the manual-recheck clarification into one continuous
idea, so they are written as a single flowing paragraph rather than two separate sentences that would
read as redundant). The Dev agent implements these literally, verbatim.

### 6.4 Decision — un-gate the custom-domain card from requiring a subdomain first

**Call: Remove the `muted` gating entirely.** `CustomDomainCard`'s `none`-status branch always shows
the full add-a-domain form, regardless of whether `settings.subdomain_slug` is set. This is a
client-side-only logic change (Section 4.7), confirmed safe:

**Reasoning:**
- Verified directly against `lib/partner/domain-settings.ts`'s `addCustomDomain()` function (the
  server logic backing `POST /api/admin/configurator/domain/custom-domain`): it takes only
  `partnerAccountId` and `domain` as arguments, checks domain format, Clio-owned-domain-space
  conflicts, and cross-account uniqueness — **it has no dependency on `subdomain_slug` existing at
  all.** The `muted` gate in `CustomDomainCard` is purely a client-side UI artifact from the original
  B2B-05 build, not a real product or technical requirement.
- Given the brief's explicit premise — custom domain is now the primary, recommended path, and the
  whole point of this feature is to make a first-time partner's very first real action be setting up
  their own domain — requiring them to first claim and configure a throwaway Clio subdomain (a step
  whose entire framing is now "the fallback for people who don't want to do this yet") before they're
  even allowed to start the recommended path is directly self-contradicting. It would force every
  partner through the deprioritized path first no matter what they actually want.
- This is exactly the kind of client-side gating change the Known Constraints permit ("client-side
  gating logic changes are allowed only if the BA spec explicitly calls for and documents it") —
  done here, with the server-side verification above as evidence it's safe.
- No change to `lib/partner/domain-settings.ts` or `lib/partner/vercel-domains.ts` is needed or made.

## 7. Business Logic

- `VISIBLE_SECTIONS` in `lib/partner/configurator-sections.ts` changes from `['integration',
  'payment']` to `['integration', 'payment', 'domain']` (order within the array is irrelevant — the
  nav's own `NAV_GROUPS` in `ConfiguratorSurface.tsx` already places `domain` correctly inside the
  "Delivery & integration" group and filters against this array; no `NAV_GROUPS` change needed).
- `GO_LIVE_REQUIRED_STEPS` is **unchanged**: `['integration', 'payment']` (Section 6.1).
- `CustomDomainCard`'s `muted` computed value and its usage are removed entirely (Section 6.4); the
  `none`-status branch's JSX collapses to always render the form (no more `muted ? (...) : (...)`
  ternary — always the "else" branch's content, with new copy per Section 4.7).
- All other state transitions (`none → pending_verification → verified`, `→ failed`, subdomain
  claim/edit, recheck, remove, try-a-different-domain) are **byte-for-byte unchanged** — this feature
  touches only copy, layout order, visual framing, and the one gating removal above.

## 8. Error States

No new error states are introduced. Existing error states are preserved exactly:
- Domain settings fail to load → existing `loadError` Card message (Section 4.2), unchanged.
- Subdomain slug taken/reserved/invalid format → existing inline helper text under the slug input,
  unchanged.
- Custom domain add fails (`422 vercel_rejected` or format error) → existing `failed`-status card
  (Section 4.9), unchanged, still shows `settings.custom_domain_error` verbatim.
- Custom domain add conflicts with another account (`409`) → existing behavior: the client's `add()`
  function treats `res.ok || res.status === 422` as "clear the input and reload"; a `409` is not
  explicitly handled by the client today and this feature does not change that — out of scope (no
  Feature Brief content direction addressed this, and touching it would be a logic change beyond
  copy/layout).
- Recheck fails transiently → existing behavior (no error surfaced, `onUpdated()` still called since
  the fetch call itself doesn't throw on a non-2xx in the current implementation) — unchanged.

## 9. Edge Cases

- **Partner has already claimed a subdomain and has no custom domain yet:** custom domain card still
  renders first, fully interactive (no longer muted) — this is now the common case this feature is
  designed to nudge, not an edge case, but worth stating explicitly since it's a behavior change from
  today (today this partner would see an active, non-muted custom domain card already — the only
  change for this partner is card order + copy).
- **Partner has zero subdomain and zero custom domain (true first-time state):** previously saw a
  muted "Add your own domain once your subdomain is set" message as their first impression of the
  Domain screen; now sees the fully-interactive custom domain form first (Section 5.1) — this is the
  primary scenario this feature is built for.
- **Partner already has a verified custom domain:** card order changes (custom domain now first) but
  the verified-state content is otherwise identical (Section 4.9) — no re-verification, no data
  change, purely a reflow.
- **`custom_domain_verification` array is empty or null while status is `pending_verification`:**
  pre-existing edge case, unrelated to this feature — the record-listing `.map()` over
  `(settings.custom_domain_verification ?? [])` already handles this by rendering zero rows; the new
  copy in Section 4.8 items 1–4 and 7 still renders regardless, only the "exact record" table itself
  would show nothing, which is unchanged existing behavior.
- **Very long custom domain names or root-domain values:** existing `wordBreak: 'break-all'` handling
  on the verified-state domain display is untouched; the new explanatory paragraphs are ordinary flow
  text with no fixed-width containers, so they wrap naturally at any viewport width.
- **Screen viewed on mobile:** see Section 10 (Non-Functional/Responsive).

## 10. Non-Functional / Responsive Requirements

Per the project's standing responsive/mobile-friendly rule (any screen touched for any reason must
be brought up to a genuinely responsive bar as part of the same change):

- This screen has no hardcoded pixel-width layout caps today (it relies on the parent
  `ConfiguratorShell`/`ConfiguratorNavShell`'s `SHELL_CONTENT_STYLE` for outer width constraints,
  defined in `design-tokens.ts` and out of this feature's scope) — no change needed there.
- The new copy blocks (Sections 4.3, 4.5–4.8) are plain wrapped text (`fontSize` + default line flow,
  no `white-space: nowrap`, no fixed-width spans) — they reflow naturally at any container width,
  including the `320px`–`80vw` mobile drawer width already used elsewhere in the Configurator
  (`ConfiguratorSurface.tsx`'s off-canvas drawer).
- The existing Type/Name/Value record table (Section 4.8 item 5) already uses `flex` with a `gap`,
  not fixed pixel columns beyond small label widths (`width: 60`/`100` for the header labels only,
  values flow) — unchanged, and acceptable at mobile widths since it already wraps within the card's
  padding; no change required here since the brief did not direct a table redesign and the existing
  layout does not overflow horizontally (the parent `main` panel already has `overflow-x-auto` as a
  safety net per `ConfiguratorSurface.tsx`).
- The new `RECOMMENDED` badge (Section 4.5) uses `display: inline-flex` with no fixed width — wraps
  naturally next to the card title at narrow widths.
- No `clamp()` typography scaling is introduced or needed: all new text uses the same fixed `px`
  font-size pattern already used throughout this file (e.g. `fontSize: 13`, `fontSize: 12`) —
  consistent with the existing component's established pattern, and these are body-copy sizes, not
  hero/display typography where the project's `clamp()` guidance is aimed.
- No new interactive control introduced needs a minimum touch-target size beyond what already exists
  (`PrimaryButton`/`SecondaryButton` padding is unchanged).

## 11. Out of Scope

- Any change to `lib/partner/domain-settings.ts` or `lib/partner/vercel-domains.ts` (Known
  Constraint — confirmed not needed, per Section 6.4's verification).
- Any change to the `none | pending_verification | verified | failed` state machine itself (Known
  Constraint) — only copy, layout, ordering, and the one client-side gating removal (Section 6.4)
  around the existing `none` branch.
- Adding `domain` to `GO_LIVE_REQUIRED_STEPS`, and any consequent change to `GoLivePanel.tsx`'s
  `REQUIRED_LABELS`/`requiredReady` or `ConfiguratorSurface.tsx`'s `requiredReady` (Section 6.1) —
  logged as a possible future Feature Brief in Section 12.
- Any change to `NAV_GROUPS` in `ConfiguratorSurface.tsx` (domain's group placement is already
  correct and needs no edit once `VISIBLE_SECTIONS` includes it).
- Any change to `DashboardPanel.tsx` (its generic `optional`/`incomplete` computations already
  correctly pick up `domain` once `VISIBLE_SECTIONS` includes it — Section 6.1).
- Handling the `409 domain_already_configured` case in the client's `add()` function differently
  than today (Section 8) — not directed by the Feature Brief's content direction.
- Any redesign of the Type/Name/Value record table's layout (Section 10) — only the surrounding
  explanatory copy changes.
- Renaming "Your Clio subdomain" or any other unchanged literal string not explicitly called out in
  Section 4.
- Introducing Tailwind classes anywhere in `DomainConfigClient.tsx` (Known Constraint — inline
  `style={{}}` only, matching the existing pattern).

## 12. Dependencies

- No new dependencies for this feature to ship — `lib/partner/configurator-sections.ts`,
  `DomainConfigClient.tsx`, and the existing `_shared.tsx` primitives (`Card`, `PrimaryButton`,
  `SecondaryButton`, `COLORS`) are sufficient.
- **Logged for a possible future, separate Feature Brief** (not part of this build): if Arun later
  decides domain setup should hard-block Go-Live, that follow-on work must touch
  `GO_LIVE_REQUIRED_STEPS` (`configurator-sections.ts`), `GoLivePanel.tsx`'s `REQUIRED_LABELS` array
  and `requiredReady` computation, and `ConfiguratorSurface.tsx`'s separate `requiredReady`
  computation — three files, not one, and needs its own BA spec given the blast radius identified in
  Section 6.1.

## 13. Acceptance Criteria / Test Cases

✓ Given a partner admin who has never configured a domain, when they open the Configurator, then a
"Domain" nav item is visible in the "Delivery & integration" group (was previously absent).

✓ Given a partner admin on `/dashboard/configurator/domain` (or `?section=domain`), when the screen
finishes loading, then the custom domain card renders first (above the subdomain card) and displays
a "RECOMMENDED" badge and a `2px solid` purple border.

✓ Given a partner admin with no subdomain claimed and no custom domain configured, when they view the
custom domain card, then it shows the full add-a-domain form (input + "Add domain" button) — not the
old muted "Add your own domain once your subdomain is set" message.

✓ Given a partner admin with `custom_domain_status: 'pending_verification'`, when they view the
custom domain card, then they see, in order: the CNAME explainer paragraph, the "where to manage DNS"
paragraph naming GoDaddy/Namecheap/Cloudflare/Google Domains as examples, the live DNS record
(unchanged data source), the Recheck/Remove buttons, and the propagation-and-manual-recheck
paragraph — with none of the old bare "Add this DNS record at your domain registrar:" / "DNS changes
can take up to 48 hours to propagate." copy remaining.

✓ Given a partner admin with `custom_domain_status: 'verified'`, when they view the screen, then the
custom domain card still appears first with the "RECOMMENDED" badge, and the verified confirmation
content (domain name, Copy button, Remove button) is unchanged from today.

✓ Given a partner admin with `custom_domain_status: 'failed'`, when they view the screen, then the
failed-state card (with its existing error message and "Try a different domain" button) still
appears first with the "RECOMMENDED" badge, unchanged apart from that framing.

✓ Given any partner admin, when they view the subdomain card, then it appears second and includes the
new "get started right now" framing sentence, with all existing functionality (claim, edit, copy)
working exactly as before.

✓ Given `GO_LIVE_REQUIRED_STEPS`, when this feature ships, then it still equals `['integration',
'payment']` — Go-Live is not newly blocked for any partner on the shared subdomain or with no domain
at all.

✓ Given the Configurator Dashboard panel's Setup area, when a partner has not yet configured any
domain, then it shows "Optional: Domain not yet configured" in its optional-items line (verifying the
existing generic `VISIBLE_SECTIONS`-driven computation in `DashboardPanel.tsx` correctly picks up the
newly-visible section with zero code change there).

✓ Given the screen is viewed at a narrow (mobile drawer) width, when all new copy blocks render, then
no text overflows its container and the page body does not scroll horizontally.

✓ Given `npx tsc --noEmit`, when run after this change, then it completes with zero errors.

## 14. Open Questions

None. All four items raised in the Feature Brief are resolved with documented reasoning in Section 6.
