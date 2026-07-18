# B2B-23 — Configurator Milestone Scope Reduction, Fully-Responsive Shell, and Partner Content-Auth Documentation — Requirement Document
Version: 1.1
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-07-18

> v1.1 (2026-07-18): CEO Agent approved v1.0 in full after independently re-verifying every claim
> against live code. One non-blocking note was raised — §6.1's `visibleGroups` filter didn't explicitly
> show the `<ConfiguratorNav>` call-site prop change. Addressed in §6.1 below (now shows the exact
> `groups={NAV_GROUPS}` → `groups={visibleGroups}` diff at the JSX call site). No other content changed;
> this does not reopen approval.
Source brief: `.claude/agents/clio/feature-briefs/B2B-23-configurator-milestone-scope-reduction-responsive-and-content-auth-docs.md`
Builds on: B2B-20 (`docs/specs/B2B-20-requirement-document.md`) — this spec assumes B2B-20's unified
`ConfiguratorSurface.tsx` left-nav + panel shell is live and does not re-derive it.

> Scope in one line: reduce the Configurator's visible nav to exactly what the fully API-driven
> session-trigger milestone needs (Integration + Payment only), make the shared shell fluid/responsive
> instead of hard-capped at 960px, and hand-author partner-facing content-auth documentation with an
> honest gap audit — no rebuild of any section's internals, no new capabilities.

---

## 1. Purpose

Arun's milestone is a **fully API-driven flow**: a partner registers content-source auth once via API,
then triggers a session via API with inline content (title/subtitle/HTML pages/images + transition
triggers), and Clio's bot runs the entire session with **zero portal interaction**. Today's Configurator
(built in B2B-20) presents seven sections as if all were equally relevant — including four
(Questionnaire, Topics, Content, Visualization) that drive Clio's own content-generation /
self-serve-onboarding path, which this milestone does not use at all, plus a "Domain" section (white-label
Clio-hosted-page hosting) that also has no role in an API-driven flow with no Clio-hosted page. Leaving
all seven visible tells a partner they must configure things the milestone flow ignores — friction and
confusion on a surface meant purely for API integration.

Independently, the shared Configurator shell (`_shared.tsx`) hard-caps its content column at
`maxWidth: 960px` on two wrappers, leaving large dead space on any normal desktop monitor — it reads as
unfinished on a surface partners judge Clio by, and it violates this project's standing responsive-design
policy (no hardcoded pixel-width caps).

Finally, for the milestone's content-source registration step, a partner needs one clear, accurate
reference for exactly what to send per auth type and what Clio expects back — to do this without the doc,
partners either guess (producing malformed registrations) or go back-and-forth with Clio's team, which
directly undermines the "zero human intervention" premise of the milestone itself.

**Failure without this feature:** partners configuring through the Configurator waste time on
sections that don't matter for their integration path, the surface looks visually broken/unfinished at
common desktop resolutions, and partners integrating content-source auth have no authoritative reference —
producing avoidable support load exactly where the milestone promises none.

---

## 2. User Story

**Primary — partner admin integrating the API-driven flow:**
> As a partner admin setting up Clio purely to trigger sessions via API,
> I want the Configurator to show me only Integration and Payment — the two things this flow actually
> needs — with no dead-end "Learning experience" sections I'll never use,
> So that I can complete setup quickly without confusion about what applies to my integration.

**Secondary — partner admin on any screen size:**
> As a partner admin opening the Configurator on a laptop, an ultrawide monitor, or a tablet,
> I want the surface to use the available width sensibly at every size, never boxed into a narrow
> column with dead space on either side,
> So that the product feels finished and trustworthy regardless of how I access it.

**Tertiary — partner engineer integrating content-source auth:**
> As a partner's backend engineer registering a content source via `POST /api/partner/v1/content-sources`,
> I want one accurate page that tells me exactly which fields to send for my auth type, what Clio expects
> when it fetches my content/images, and which auth mechanisms aren't supported yet,
> So that I can register correctly on the first attempt with no back-and-forth with Clio's team.

---

## 3. Trigger / Entry Point

- **Route (unchanged):** `/dashboard/configurator?partner_account_id=<uuid>&section=<sectionKey>` — same
  entry point as B2B-20. This brief changes which `section` values are **navigable and defaulted to**, not
  the route itself.
- **Route (unchanged):** `/dashboard/configurator/docs?partner_account_id=<uuid>` — gets new content, same
  entry point (`ConfiguratorNavShell active="docs"`, per B2B-16).
- **What triggers it:** page load, Clerk-authenticated, partner-admin-only — identical auth/entry model to
  B2B-20 and B2B-16. Nothing about auth changes in this brief.
- **State the user must be in:** signed in via Clerk, administers ≥1 partner account. Unchanged.
- **New default-landing behavior** (§4.4): because Questionnaire is no longer a navigable section, the
  "live partner, no `?section=`" default changes from Questionnaire to **Integration** — the first
  remaining visible section in canonical order.

---

## 4. Screen / Flow Description

### 4.1 What changes, precisely

Of the Configurator's seven sections, **five are hidden from the nav** and **two remain visible**:

| Section | Visible after this change? | Disposition |
|---|---|---|
| Questionnaire | **Hidden** | Drives the Clio-hosted-page / self-serve path, not used by the API-driven milestone |
| Topics | **Hidden** | Session title/subtitle/content is passed via API; Clio's own topic catalog is irrelevant to this flow |
| Content | **Hidden** | Content is passed via API |
| Visualization | **Hidden** | Visual URLs/images and their auth are sent via API |
| Domain | **Hidden** | White-label Clio-hosted-page hosting (subdomain/custom domain via Vercel Domains API) — no Clio-hosted page exists in the API-driven flow. **C5 resolved 2026-07-18, Option A** (brief §8): Arun's description of "Domain" (a base URL to which Clio appends `/people` etc.) matches the **existing, already-built** `outbound_base_url` field, which lives in **Integration**, not in the section currently labeled "Domain." Nothing new is built for that concept — it is clarified in place (§4.3). |
| Integration | **Visible, unchanged behavior** (only its outbound-URL field's presentation is clarified — §4.3) | Holds both directions of milestone-relevant plumbing: the partner's own OAuth client (so the partner can call Clio's API) and the outbound base URL (so Clio can call back to the partner) |
| Payment | **Visible, unchanged** | Real end users, real per-session cost — funding must be configured regardless of flow |

**Hide means:** removed from the Configurator's nav (`NAV_GROUPS` rendering) so a partner cannot click
into it from the Configurator. It does **not** mean deleted — every hidden section's route, client
component, API endpoints, and DB tables/columns remain fully intact and functional (governance: hide,
never delete; B2C-style "no impact on existing" applies equally to these B2B Option-2 surfaces, which may
return). Re-enabling a hidden section later is a one-line change (§6.1).

### 4.2 Left-navigation pane — new contents (exact)

Rendered top to bottom, replacing B2B-20's three-group, seven-item pane:

1. **Group heading: "Delivery & integration"** (unchanged uppercase micro-label styling from B2B-20)
   - Nav item **"Integration"** + completion dot
2. **Group heading: "Billing"**
   - Nav item **"Payment"** + completion dot
3. **Pinned "Go Live" / "Live" action** — unchanged position and visual treatment from B2B-20 (§4.4 of
   that spec), now validating a different required set (§6.3).

The **"Learning experience" group heading does not render at all** — not blanked, not shown-disabled,
simply absent, because every item that would have belonged to it (Questionnaire, Topics, Content,
Visualization) is hidden. This is **not** a special case for this one group: it is the general behavior
of a generic rule applied to every group (§4.5, §6.1) — if C5 or any future hide/unhide changes which
items are visible, no group-specific code changes.

All existing per-item visual treatment (active/hover/complete-dot states, §4.3 of B2B-20) is unchanged —
this brief only changes *which* items exist, not how any individual item looks or behaves.

### 4.3 Integration section — field clarification (C5 Option A)

`IntegrationClient.tsx`'s existing "Outbound webhooks" card (`OutboundWebhooksCard`, currently the second
of two cards, alongside `ApiCredentialsCard`) is **relabeled** to make explicit that its base-URL field
is the same "domain" concept Arun described — a base URL to which Clio appends integration-specific
paths — not merely a webhooks-delivery address. **No new field, no new card, no behavior change** — this
is a copy/label change only, on the existing `outbound_base_url` PATCH flow.

Exact copy changes (all four screen states of `OutboundWebhooksCard` get the same title/description
swap; the input, placeholder, save flow, and "Test connection" button are unchanged):

| Element | Current copy | New copy |
|---|---|---|
| Card title | "Outbound webhooks" | **"API base URL"** |
| Card description (edit state) | "Clio delivers usage events to your own system." | **"The base URL Clio uses to reach your systems — for delivering usage events and any future integration calls, e.g. `https://api.yourcompany.com` → `https://api.yourcompany.com/webhooks/usage`."** |
| Field label | "Your base URL" | "Your base URL" (unchanged) |
| Placeholder | `https://your-domain.com/clio` | `https://your-domain.com/clio` (unchanged) |
| Configured-state helper line (new, added beneath the existing "Your base URL: …" display line, screen state 4) | *(none)* | **"Clio appends a path per integration point (e.g. `/webhooks/usage`) — you don't need to register each path separately."** |

The card's second element (API token field, signing secret, "Test connection") keeps its existing copy
unchanged — this clarification touches only the base-URL framing.

### 4.4 Default section & deep-link behavior (Question 1, Question 2 answered)

**Default section when `?section=` is absent** (server-resolved in `page.tsx`, unchanged mechanism from
B2B-20, updated inputs):
- **Not yet live:** the first incomplete section among the now-two-item canonical order `[integration,
  payment]`, or the **Go Live** panel if both are already complete. (Previously: first incomplete among
  seven; the mechanism is identical, only the candidate list shrinks.)
- **Live:** defaults to **Integration** (previously Questionnaire, which is now hidden and can never be a
  valid default).

**Deep link to a hidden section** (Question 1 — e.g. a partner or a stale bookmark hits
`?section=topics`, or the existing standalone-route redirect from B2B-20 sends `/dashboard/configurator/
domain?...` into `?section=domain`): treated **identically to an absent or invalid `?section=`** — falls
back to the default-section rule above. This is a **narrower reuse of B2B-20's own existing rule**
("Invalid `?section=` value: treated as absent → falls back to the default-section rule. No error." —
B2B-20 spec §8) rather than a new UI state: a hidden section is now simply one more kind of "not a
currently valid destination." No new error screen, no "not part of your current setup" message — the
partner is transparently placed on their nearest valid section instead. **No code change is required in
any of the five hidden sections' own `page.tsx` redirect-into-`?section=X` logic** (B2B-20 already wired
these); only the *destination* surface's definition of "valid" narrows (§6.1).

### 4.5 Group-heading generic rule (Question 3 answered)

Confirmed as the brief requires: group headings are computed by filtering, never hardcoded per group.
Implementation (§6.1): each `NAV_GROUPS` entry's `items` array is filtered down to only currently-visible
section keys; any group whose filtered `items` array is empty is dropped entirely (heading and all) before
rendering. The full seven-item `NAV_GROUPS` data structure is **not** trimmed — it stays complete (all
three original groups, all seven items, correctly labeled) as the durable record of Clio's full section
taxonomy; only a separate visibility allowlist (§6.1) drives what actually renders. This is why the C5
outcome required no second code change once decided, and why any future hide/unhide is a one-line change.

### 4.6 Responsive shell (WS-2 — mechanism only, no visual redesign)

`_shared.tsx`'s two content wrappers (`ConfiguratorShell` line 84, `ConfiguratorNavShell` line 238) stop
hard-capping at `maxWidth: 960`. Both `padding` and `maxWidth` become **fluid `clamp()` values** —
continuously interpolated between a floor and a ceiling based on viewport width, never jumping at fixed
breakpoints, with the ceiling (1900px) existing solely to bound line length on ultrawide monitors:

- `padding`: `clamp(16px, 4vw, 32px)` — ~16px on narrow phones, smoothly growing to 32px by ~800px
  viewport width, flat 32px beyond that.
- `maxWidth`: `clamp(640px, 96vw, 1900px)` — content uses ~96% of the viewport width up to 1900px, where
  it caps. At common desktop widths (1440px, 1920px) this yields roughly 1382px–1843px of usable content
  width, versus the old flat 960px — the "large dead space on normal desktop widths" the brief names is
  gone. At mobile widths the 640px floor is never actually binding (viewport itself is narrower), so it
  has no visible effect there.

Both properties are expressed via a **shared CSS custom property**, not two independent literal values, so
`ConfiguratorSurface.tsx`'s existing full-bleed padding-cancel trick (`-mx-8 -mb-8`, which assumed a fixed
32px to cancel) stays mathematically correct at every viewport width instead of drifting out of sync
(§6.1, Constraint 6 — "must not regress... must compose with, not fight"). This is the reusable pattern
(§9): any future shell wrapper needing this exact fluid-column behavior imports the same constant instead
of re-hardcoding a pixel cap.

**Out of scope for this change** (confirmed, matches brief §9): no typography/font-size scaling, no
spacing-rhythm or type-scale redesign, no re-theming — those are the follow-on `/design-review` pass. This
is the layout *mechanism* only. As a side effect, the API and Docs pages (which also render inside
`ConfiguratorNavShell`) get the same fluid width for free, since they share the wrapper — no separate work
needed for them.

### 4.7 Docs page — new "Content & image auth" section (WS-3)

A new hand-authored section is inserted into `DocsClient.tsx`, between the existing "Getting started" and
"API & webhook reference" sections (renumbering those to 3rd/4th; "Billing explained" becomes 5th). No AI
generation, no network fetch — matching the file's existing B2B-07 convention (stated in its own header
comment) and this brief's explicit Constraint 5. Full content specified in §6.4.

---

## 5. Visual Examples (wireframes)

### Screen state A — Desktop (≥1024px), live partner, default landing on Integration

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Clio Configurator                                        [Acme Corp ▾]      │
├───────────────────────────────────────────────────────────────────────────┤
│  Configurator    API    Docs                                                │
├──────────────────────────┬────────────────────────────────────────────────┤
│  DELIVERY & INTEGRATION   │   Integration                                   │
│   ● Integration  ◀ active │   ┌───────────────────────────────────────────┐ │
│                           │   │ API credentials                           │ │
│  BILLING                  │   │  (OAuth client generation — unchanged)    │ │
│   ○ Payment               │   ├───────────────────────────────────────────┤ │
│                           │   │ API base URL   ← relabeled (was           │ │
│  ───────────────────────  │   │  "Outbound webhooks", §4.3)               │ │
│   ► Go Live  Setup incomplete  Your base URL: https://api.acme.com/clio   │ │
│                           │   │  Clio appends a path per integration      │ │
│                           │   │  point (e.g. /webhooks/usage)…            │ │
│                           │   └───────────────────────────────────────────┘ │
└──────────────────────────┴────────────────────────────────────────────────┘
   ▲ NOTE: no "LEARNING EXPERIENCE" heading anywhere — the entire group is
     gone because all 4 of its items are hidden (§4.5's generic rule).
   ▲ NOTE: content column is now fluid (§4.6) — at this width it uses far
     more than the old flat 960px, no dead space on the right.
```

### Screen state B — Mobile (<768px), not-yet-live partner, first-run

```
┌─────────────────────────────┐
│ Clio Configurator   [Acme ▾]│
├─────────────────────────────┤
│ Configurator  API  Docs     │
├─────────────────────────────┤
│ [☰ Sections]    Integration │
├─────────────────────────────┤
│  Start here → Integration    │  ← hint text, unchanged mechanism, now
│  Integration                 │     points at a visible section (§4.4)
│  ┌─────────────────────────┐│
│  │ (IntegrationClient,      ││
│  │  embedded, full width)   ││
│  └─────────────────────────┘│
└─────────────────────────────┘
```

Tapping `[☰ Sections]` opens the same off-canvas drawer mechanism as B2B-20, now listing only:
```
│ Sections            [✕]   │
│ DELIVERY & INTEGRATION     │
│  ● Integration   ◀         │
│ BILLING                    │
│  ○ Payment                 │
│ ─────────────────────────  │
│  ► Go Live  Setup incomplete│
```

### Screen state C — Deep link to a hidden section (`?section=topics`)

No distinct visible "error" screen — the partner is transparently placed on the resolved default section
(state A or B above, depending on live/not-live), per §4.4. The URL itself is corrected to the resolved
`?section=` value by the same `router.replace` mechanism `selectSection` already uses on ordinary
navigation (no separate handling needed — see §6.1).

### Screen state D — Go Live panel, required sections incomplete (updated required set)

```
┌───────────────────────────────────────────────┐
│  Go Live                                        │
│                                                 │
│  Before you go live, finish the required setup: │
│   ✕ Integration — configure your API base URL   │
│     (Integration) or register a content source  │
│     via the API                                 │
│   ✓ Payment — funding method added              │
│                                                 │
│  Your end users will reach you at:              │
│   https://distill-peach.vercel.app/partner-     │
│   questionnaire/acme-uuid  (Clio-hosted fallback)│
│                                                 │
│  [ Go live ]  ← disabled until required pass    │
└───────────────────────────────────────────────┘
```

Note: the previous "Optional (can be done later): Topics, Content, Visualization, Domain, Integration"
line is **removed** from this panel (§6.1) — with those four sections hidden entirely from the
Configurator, listing them as "optional-but-available" would be actively misleading (a partner cannot
reach them from this UI at all). There is nothing left to describe as optional once Integration becomes
required, since Integration and Payment are now the only two configurable sections.

### Screen state E — Docs page, new "Content & image auth" section (excerpt)

```
┌──────────────────────────────────────────────────────────────────┐
│ Docs                                                               │
│                                                                    │
│ Getting started                              [existing, unchanged]│
│ ──────────────────────────────────────────────────────────────── │
│ Content & image auth                                    [NEW]     │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ Register a content source once via                          │   │
│ │ POST /api/partner/v1/content-sources, then reference its     │   │
│ │ content_source_id when you trigger a session with inline     │   │
│ │ content. Clio uses the registered auth to fetch every HTML   │   │
│ │ page and image URL you pass at trigger time.                 │   │
│ │                                                                │   │
│ │ auth_type: none          [field table — label]                │   │
│ │ auth_type: static_bearer [field table — token, header_name,   │   │
│ │                            header_scheme, label]               │   │
│ │ auth_type: oauth2_client_credentials [field table — token_url,│   │
│ │                            client_id, client_secret, scope,   │   │
│ │                            audience, label]                    │   │
│ │                                                                │   │
│ │ Not yet supported: presigned_url / mtls as an auth_type       │   │
│ │  (rejected at registration, HTTP 422). If your images already│   │
│ │  carry a presigned/expiring signature IN the URL itself,     │   │
│ │  register with auth_type: 'none' instead — no gap there.     │   │
│ │  Also not yet supported: API-key-in-query-string auth, and   │   │
│ │  multiple custom headers per source (logged in BACKLOG.md).  │   │
│ │                                                                │   │
│ │ Fetch constraints: HTTPS only, publicly reachable (no         │   │
│ │  loopback/private-IP/link-local), 15s timeout, ≤3 redirects   │   │
│ │  (each re-validated), Content-Type must match declared media  │   │
│ │  type, 5MB HTML / 10MB image size cap.                        │   │
│ └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│ API & webhook reference                       [existing, renumbered]│
│ Billing explained                              [existing, renumbered]│
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

This is a scope-reduction, layout-mechanism, and documentation change. **No new database tables or
columns.** All reads/writes reused from B2B-20/B2B-19/B2B-06/B2B-05.

### 6.1 WS-1 — visibility, default section, deep links (code-level spec)

**New single source of truth for visibility** — `lib/partner/configurator-status.ts` (already the home of
`ConfiguratorSection`):

```ts
// B2B-23 WS-1 — the ONLY place that decides which sections are exposed in
// the Configurator nav. Hidden sections' routes, components, and DB tables
// remain fully intact (governance: hide, never delete) — this allowlist is
// the single toggle. Re-enabling a hidden section later is a one-line edit
// here; no other file needs to change.
export const VISIBLE_SECTIONS: ConfiguratorSection[] = ['integration', 'payment']
```

**`app/dashboard/configurator/ConfiguratorSurface.tsx` changes:**
- Remove the local `CANONICAL_ORDER` constant; import `VISIBLE_SECTIONS` from
  `lib/partner/configurator-status.ts` and use it directly wherever `CANONICAL_ORDER` was used (it already
  is the canonical visible order: Integration, then Payment).
- `NAV_GROUPS` **data structure is unchanged** (still all three groups, all seven items — §4.5). Rendering
  computes a filtered view immediately before use:
  ```ts
  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => VISIBLE_SECTIONS.includes(i.key)) }))
    .filter((g) => g.items.length > 0)
  ```
  `ConfiguratorNav`'s `groups.map(...)` internals are unchanged — the fix is entirely at the **call site**,
  where the `<ConfiguratorNav>` element is constructed (currently line 162-172, both the desktop-sidebar and
  mobile-drawer renders share this single `nav` variable, so one change covers both):
  ```diff
    const nav = (
      <ConfiguratorNav
  -     groups={NAV_GROUPS}
  +     groups={visibleGroups}
        status={status}
        activeSection={activeSection}
        isLive={isLive}
        requiredReady={requiredReady}
        firstIncompleteLabel={
          !isLive ? SECTION_LABEL[(firstIncomplete ?? 'integration') as PanelSection] : null
        }
        onSelect={selectSection}
      />
    )
  ```
  `ConfiguratorNav`'s own `groups: NavGroupDef[]` prop type is unchanged — it already receives whatever
  array it's handed and iterates it generically; passing it `visibleGroups` instead of `NAV_GROUPS` is the
  entire fix, and the `firstIncompleteLabel` fallback-string change (below) lands in this same JSX block, so
  a developer touching this call site should make both edits together.
- `requiredReady` (line 154): `status !== null && status.questionnaire && status.payment` →
  **`status !== null && status.integration && status.payment`** (matches the new
  `GO_LIVE_REQUIRED_STEPS`, §6.3).
- `firstIncompleteLabel` fallback (line 169): `SECTION_LABEL[(firstIncomplete ?? 'questionnaire')...]` →
  **`SECTION_LABEL[(firstIncomplete ?? 'integration')...]`** — the fallback must reference a currently
  visible section; `'questionnaire'` would resolve to a hidden section's label if ever hit.
- **Responsive-composition change** (§4.6, §6.2): the `-mx-8 -mb-8` className on the outer wrapper div
  (line 184) is replaced with `mx-[calc(-1*var(--cfg-shell-px))] mb-[calc(-1*var(--cfg-shell-px))]` — still
  a Tailwind arbitrary-value **className**, not a `style={{}}` object, preserving B2B-20's AC #16
  (`grep -c 'style={{' ConfiguratorSurface.tsx` stays 0).

**`app/dashboard/configurator/page.tsx` changes:**
- `VALID_SECTIONS` narrows from all seven + `go_live` to **`[...VISIBLE_SECTIONS, 'go_live']`** (i.e.
  `['integration', 'payment', 'go_live']`), imported from `configurator-status.ts`. Any `?section=` value
  outside this list (including every hidden section's key) is treated as absent → default rule applies
  (§4.4) — this is the entire mechanism behind the deep-link fallback; no separate "hidden section" branch
  is needed.
- Remove the local `CANONICAL_ORDER` constant; import and reuse `VISIBLE_SECTIONS` for the "not live, first
  incomplete" resolution (line ~91-93).
- Line 89 `initialSection = 'questionnaire'` (the live-partner default) → **`initialSection = 'integration'`**.

**`app/dashboard/configurator/GoLivePanel.tsx` changes:**
- `REQUIRED_LABELS` (lines 31-34):
  ```ts
  const REQUIRED_LABELS: { key: 'integration' | 'payment'; label: string; requirement: string }[] = [
    { key: 'integration', label: 'Integration', requirement: 'configure your API base URL (Integration) or register a content source via the API' },
    { key: 'payment', label: 'Payment', requirement: 'add a funding method' },
  ]
  ```
- `requiredReady` (line 76): `status.questionnaire && status.payment` → **`status.integration &&
  status.payment`**.
- The "Optional (can be done later): Topics, Content, Visualization, Domain, Integration…" paragraph
  (line 153-155) is **removed** — see §5 Screen state D rationale. No replacement copy; the checklist card
  simply ends after the two required rows.

### 6.2 WS-2 — responsive shell (code-level spec)

**`app/dashboard/configurator/_shared.tsx` changes:**

```ts
// B2B-23 WS-2 — Clio's standard fluid responsive pattern for shell content
// columns, replacing a hard maxWidth: 960 cap. Padding and max-width scale
// continuously via clamp() rather than jumping at fixed breakpoints; the
// 1900px ceiling exists only to bound line length on ultrawide monitors — it
// never binds on ordinary desktop widths. Exposed as a CSS custom property
// (not a bare inline value) so consumers that need to cancel this padding
// (see ConfiguratorSurface.tsx's full-bleed nav wrapper) reference the SAME
// live value via calc(), instead of hardcoding an assumed pixel amount that
// would silently drift out of sync at any viewport where the clamp()'d
// padding isn't exactly 32px. Future screens needing this exact fluid-column
// behavior should reuse this constant rather than re-hardcoding a cap.
export const SHELL_CONTENT_STYLE: React.CSSProperties = {
  ['--cfg-shell-px' as string]: 'clamp(16px, 4vw, 32px)',
  padding: 'var(--cfg-shell-px)',
  maxWidth: 'clamp(640px, 96vw, 1900px)',
  margin: '0 auto',
}
```

- Line 84 (`ConfiguratorShell`): `<div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>` →
  `<div style={SHELL_CONTENT_STYLE}>`.
- Line 238 (`ConfiguratorNavShell`): same replacement.
- No other property on either wrapper changes. No change to any other primitive in this file (`Card`,
  `PrimaryButton`, `SecondaryButton`, `BillingBanner`, `NoPartnerAccounts`) — all explicitly out of scope
  (§4.6, matches B2B-20's own precedent of leaving section-internal/primitive inline styles as-is).
- `ConfiguratorSurface.tsx`'s matching change is in §6.1 above (the `-mx-8 -mb-8` → `calc(-1*var(...))`
  swap) — both files change together; neither works correctly alone.

### 6.3 WS-1 — Go-Live required set & the `integration` completion check (the brief's named technical gap)

**`lib/partner/wizard.ts` changes:**

```ts
// The 6 steps actually backed by partner_onboarding_progress's stored status
// columns — unchanged from B2B-05/B2B-20. The (already-unused-by-the-current-
// UI, per B2B-20) advance/progress-row mechanism is NOT extended to
// Integration — no integration_status column exists and none is added; no
// migration is needed for this brief.
export type StoredWizardStep = 'questionnaire' | 'topics' | 'content' | 'visualization' | 'domain' | 'payment'

// B2B-23 — the live-completion-check surface consumed by checkStepComplete()
// and GO_LIVE_REQUIRED_STEPS. Adds 'integration', which — like every other
// step's "complete" state — is checked purely live against real config, never
// against a stored progress column.
export type WizardStep = StoredWizardStep | 'integration'

export const STEP_ORDER: StoredWizardStep[] = ['questionnaire', 'topics', 'content', 'visualization', 'domain', 'payment'] // unchanged, 6 items

const STEP_COLUMN: Record<StoredWizardStep, { status: keyof ProgressRow; statusAt: keyof ProgressRow }> = { /* unchanged, 6 keys */ }

function nextStepAfter(step: StoredWizardStep): WizardCurrentStep { /* unchanged; param type narrowed to match STEP_ORDER/STEP_COLUMN */ }

export async function advanceWizardStep(
  partnerAccountId: string,
  step: StoredWizardStep,   // narrowed from WizardStep — 'integration' has no stored column and was
                            // never a valid input to this (already-unused-by-the-UI) function; narrowing
                            // the type makes that a compile-time guarantee instead of a latent runtime bug.
  action: 'complete' | 'skip'
): Promise<AdvanceResult> { /* unchanged body */ }

export async function checkStepComplete(partnerAccountId: string, step: WizardStep): Promise<boolean> {
  const supabase = createSupabaseAdminClient()
  switch (step) {
    // ...existing 6 cases, byte-for-byte unchanged...
    case 'integration': {
      // Resolves the brief's C5 finding literally (§8 of the brief): "the
      // load-bearing thing for the API-driven milestone is that the partner
      // has configured how Clio reaches them / authenticates outward — which
      // today lives in Integration (outbound_base_url) and in the
      // content-source registration (B2B-19)." Either signal is sufficient.
      const { data: account } = await supabase
        .from('partner_accounts')
        .select('outbound_base_url')
        .eq('id', partnerAccountId)
        .maybeSingle()
      if (account?.outbound_base_url) return true

      const { data: source } = await supabase
        .from('partner_content_sources')
        .select('id')
        .eq('partner_account_id', partnerAccountId)
        .limit(1)
        .maybeSingle()
      return !!source
    }
  }
}

// B2B-23 §8 CEO resolution: Go-Live required set for the API-driven
// milestone. 'questionnaire' removed (hidden, milestone-irrelevant);
// 'integration' added (defined above); 'payment' unchanged.
const GO_LIVE_REQUIRED_STEPS: WizardStep[] = ['integration', 'payment']

export async function goLive(partnerAccountId: string): Promise<GoLiveResult> {
  // Body unchanged — already generic over GO_LIVE_REQUIRED_STEPS + checkStepComplete.
}
```

**Compile-safety note for the developer:** `app/api/admin/configurator/wizard/advance/route.ts`'s own Zod
`BodySchema.step` enum already hardcodes exactly the 6 `StoredWizardStep` values (it does not import
`WizardStep`/`STEP_ORDER`), so narrowing `advanceWizardStep`'s parameter type does not break that route —
verified by reading the route directly.

**`lib/partner/configurator-status.ts` changes:**
- `getConfiguratorStatus()`'s `integration` computation switches from the bespoke
  `checkIntegrationComplete()` helper (OAuth-clients-count-> 0) to **`checkStepComplete(partnerAccountId,
  'integration')`** — the same function and the same definition the Go-Live gate now uses, per the brief's
  own Question 4 ("Ensure the server gate and the nav's button-disabled state agree — they share
  checkStepComplete"). The `checkIntegrationComplete()` helper becomes dead code and is removed as part of
  this same change (a small internal refactor of duplicate logic into one source of truth — not a
  "section deletion" in the governance sense; the Integration *section* itself is untouched and still
  fully visible/functional).
- **Behavior consequence, stated explicitly:** the Integration nav dot's meaning changes from "you
  generated at least one OAuth client" to "you've configured an API base URL, or registered at least one
  content source" — i.e. it now reflects *outbound* reachability/auth rather than *inbound* API-credential
  issuance. This is a deliberate consequence of unifying on the CEO-specified definition (§8 of the brief),
  not an oversight — flagged here for visibility since it is a real, user-visible change in what "green
  dot" means for this section, even though generating an OAuth client remains just as necessary as before
  for the milestone to function at all (without one, the partner cannot call Clio's API in the first
  place) — it is simply no longer what the *dot* measures.
- `ConfiguratorSection` type is unchanged (already included `'integration'`).
- Add and export `VISIBLE_SECTIONS` (§6.1).

### 6.4 WS-3 — Docs page content (exact, hand-authored, no AI generation)

New section inserted into `DocsClient.tsx` between "Getting started" and "API & webhook reference"
(§4.7), reusing the file's existing `sectionHeadingStyle`/`Card`/`tableStyle`/`codeBlockStyle` primitives —
no new visual language.

**Section heading:** "Content & image auth"

**Intro paragraph:**
> Register a content source once via `POST /api/partner/v1/content-sources`, then reference its
> `content_source_id` when you trigger a session with inline content. Clio uses the registered auth to
> fetch every HTML page and image URL you pass at trigger time — the same auth, applied identically to
> every page in that session.

**Field table 1 — `auth_type: 'none'`:**
| Field | Required | Notes |
|---|---|---|
| `label` | No | Optional name for your reference |

No auth header is sent when fetching this source's URLs.

**Field table 2 — `auth_type: 'static_bearer'`:**
| Field | Required | Default | Notes |
|---|---|---|---|
| `token` | Yes | — | Your API token/key. Encrypted at rest (AES-256-GCM); never returned after registration. |
| `header_name` | No | `Authorization` | The HTTP header Clio sends the token in |
| `header_scheme` | No | `Bearer` | Prefix before the token. Set to an empty string to send the raw token with no prefix. |
| `label` | No | — | Optional name |

Clio sends: `{header_name}: {header_scheme} {token}` (or just the bare token if `header_scheme` is empty).

**Field table 3 — `auth_type: 'oauth2_client_credentials'`:**
| Field | Required | Notes |
|---|---|---|
| `token_url` | Yes | Your OAuth2 token endpoint — must be a valid, publicly reachable HTTPS URL |
| `client_id` | Yes | |
| `client_secret` | Yes | Encrypted at rest; never returned after registration |
| `scope` | No | |
| `audience` | No | |
| `label` | No | |

Clio performs an RFC 6749 §4.4 Client Credentials Grant against `token_url` (HTTP Basic auth,
`grant_type=client_credentials`, plus `scope`/`audience` if set), caches the resulting token, and sends
`Authorization: Bearer <token>` when fetching your content/image URLs.

**Not yet supported (a registration attempt with these values is rejected):**
> `presigned_url` and `mtls` are documented `auth_type` values but are **rejected at registration**
> (HTTP 422, `content_source_auth_type_not_supported`) — no row is ever stored for them.
>
> If your images already carry a presigned/expiring signature **in the URL itself** (e.g. an S3 presigned
> GET URL), this is **not a gap** — register that content source with `auth_type: 'none'`. Clio fetches
> the URL exactly as given, with no extra auth header, and the embedded signature authenticates it. Only
> a mechanism where Clio itself generates or refreshes presigned URLs on your behalf is unsupported.
>
> Also not yet supported: **API-key-in-query-string auth** (e.g. `?api_key=...`) and **multiple custom
> headers** per content source — only a single configurable header (`static_bearer`) or an
> `Authorization: Bearer` token (OAuth2) is supported today. Both are logged as candidate enhancements
> (`BACKLOG.md`).

**Fetch constraints (apply to every content/image URL Clio fetches, regardless of auth type):**
> - HTTPS only.
> - Must be publicly reachable. Clio blocks loopback addresses, private IP ranges, link-local addresses
>   (including cloud metadata endpoints), and `.internal`/`.local`/`.localhost` hostnames — checked against
>   every DNS address your hostname resolves to, not just the first.
> - 15-second timeout per request.
> - Redirects are followed up to 3 hops; each redirect target is independently re-validated against the
>   same reachability rules before being fetched (never blindly followed).
> - The response `Content-Type` must match what you declared: HTML pages must return `text/html`; images
>   must return an `image/*` type. A mismatch is treated as a fetch failure for that page.
> - Size limits: 5MB for HTML pages, 10MB for images.
> - Images are fetched server-side and re-hosted to the meeting bot as a data URI — your image URL is
>   never exposed to the browser, so no CORS configuration is needed on your end.

This content is placed in `BACKLOG.md` alongside the two identified gaps (query-param auth, multi-header
auth) so they're tracked as engineering candidates, not just documented and forgotten (§10, §12).

---

## 7. Success Criteria (Acceptance Tests)

**Nav visibility & grouping**
1. ✓ Given any partner account, when the Configurator loads, then the left pane shows exactly two group
   headings — "Delivery & integration" (containing only "Integration") and "Billing" (containing only
   "Payment") — and no "Learning experience" heading anywhere in the DOM.
2. ✓ Given the same load, when inspecting the pinned action row, then it still renders "Go Live"/"Live" at
   the bottom, unchanged in position and visual treatment from B2B-20.
3. ✓ Given the underlying `NAV_GROUPS` data structure, when read in source, then it still lists all seven
   original items across three groups (nothing deleted) — only the render-time filter narrows what's shown.

**Default section & deep links**
4. ✓ Given a live partner and no `?section=` param, when the page loads, then Integration is the selected
   section (not Questionnaire).
5. ✓ Given a not-yet-live partner with neither Integration nor Payment configured, when the page loads
   with no `?section=`, then Integration is selected and the "Start here → Integration" hint is visible.
6. ✓ Given any partner, when navigating to `?section=topics` (or `content`/`visualization`/`domain`/
   `questionnaire`) directly, then the page resolves to the same default section as if `?section=` were
   absent (§4.4) — no error screen, no blank panel, no console error.
7. ✓ Given a bookmarked `/dashboard/configurator/domain?partner_account_id=<id>`, when it loads, then the
   existing B2B-20 redirect still sends it to `?section=domain`, which then resolves per test 6 (no dead
   route, no regression to that existing redirect mechanism).

**Integration section clarification**
8. ✓ Given the Integration panel, when it renders, then the second card's title reads "API base URL" (not
   "Outbound webhooks") and its description mentions both usage-event delivery and general integration
   calls, per §4.3's exact copy table.
9. ✓ Given a partner who has already set `outbound_base_url`, when the Integration panel renders, then the
   new helper line ("Clio appends a path per integration point…") is visible beneath the existing base-URL
   display.

**Go-Live gate**
10. ✓ Given a partner with no `outbound_base_url` and no registered content source, when they open Go
    Live, then the panel lists "Integration" as required-and-incomplete with the copy "configure your API
    base URL (Integration) or register a content source via the API", and the "Go live" button is disabled.
11. ✓ Given the same partner, when `POST /api/admin/configurator/wizard/go-live` is called directly, then
    it returns 422 with `pending_steps` including `"integration"` (not `"questionnaire"`).
12. ✓ Given a partner with `outbound_base_url` set (or ≥1 registered content source) and a funding
    mechanism, when they click "Go live", then it succeeds, `onboarding_completed_at` is set, and on
    reload the pinned row reads "Live".
13. ✓ Given the Go Live panel in the not-ready state, when it renders, then the "Optional (can be done
    later): Topics, Content, Visualization, Domain, Integration" line from B2B-20 is **absent**.

**Responsive shell**
14. ✓ Given viewport width 1440px, when either `ConfiguratorShell` or `ConfiguratorNavShell` renders, then
    the computed `max-width` of the content wrapper is greater than 960px (verifying the cap is gone) and
    less than 1900px (verifying the ceiling still applies at ordinary desktop widths).
15. ✓ Given viewport width 2560px (ultrawide), when either wrapper renders, then the computed `max-width`
    is capped at 1900px (verifying the far-out ceiling still bounds line length).
16. ✓ Given any viewport width, when `ConfiguratorSurface.tsx`'s full-bleed nav wrapper renders inside
    `ConfiguratorNavShell`, then its negative margin exactly cancels the shell's live padding (no visible
    gap or overlap at the sidebar/panel edges) — verifying the `calc(-1*var(--cfg-shell-px))` composition
    holds at every width, not just 32px.
17. ✓ Given `ConfiguratorSurface.tsx`, when `grep -c 'style={{' ConfiguratorSurface.tsx` runs, then it
    still returns 0 (B2B-20's AC #16 preserved — the padding-cancel fix uses a Tailwind arbitrary-value
    className, not an inline style object).

**Docs**
18. ✓ Given `/dashboard/configurator/docs`, when it loads, then a "Content & image auth" section is
    present between "Getting started" and "API & webhook reference", containing all three field tables
    (none/static_bearer/oauth2_client_credentials) and the "Not yet supported" callout.
19. ✓ Given the Docs page's new section, when its content is compared against `content-sources.ts` and the
    `POST /api/partner/v1/content-sources` Zod schemas, then every field name, requiredness, and default
    matches the actual code exactly (no invented fields, no drift).

**Non-regression**
20. ✓ Given the build, when `npx tsc --noEmit` runs, then it completes with zero errors (including the
    `StoredWizardStep`/`WizardStep` split and `advanceWizardStep`'s narrowed parameter type).
21. ✓ Given the existing full test suite, when it runs, then it passes at the same baseline as before this
    change.
22. ✓ Given any of the five hidden sections' own routes/components/API endpoints, when inspected directly
    (not via the Configurator nav), then they remain fully present and functional — nothing was deleted.

---

## 8. Error States

Everything below is scoped to what this brief changes; all other Configurator error handling (per-section
load failures, Go Live network errors, payment-checkout-return handling, etc.) is unchanged from B2B-20
and not re-specified here.

- **`GET /api/admin/configurator/status` fails:** unchanged from B2B-20 — all dots (now just Integration
  and Payment) default to incomplete; navigation stays fully usable; silent retry on next section change.
- **`checkStepComplete(id, 'integration')`'s two internal reads fail independently** (e.g. a transient
  Supabase error on the `partner_content_sources` lookup after the `partner_accounts` lookup already
  succeeded with no `outbound_base_url`): the function does not catch internally — an unhandled rejection
  here behaves exactly as an unhandled rejection in any other `checkStepComplete` case already does today
  (propagates to the caller's existing error handling in the `/status` and `/go-live` routes); no new error
  path is introduced by this brief.
- **Deep link to a hidden section with a `partner_account_id` that also happens to be invalid:** the
  existing, unchanged `partner_account_id` fallback in `page.tsx` (falls back to `accounts[0].id`) resolves
  first; the hidden-section fallback (§4.4) applies afterward, independently. No interaction between the
  two.
- **`_shared.tsx`'s CSS custom property fails to apply** (e.g. a consumer renders `ConfiguratorSurface`
  outside of `ConfiguratorNavShell`, so `--cfg-shell-px` is unset on any ancestor): `var(--cfg-shell-px)`
  with no fallback would compute as invalid and the browser treats the property as unset, which for
  `margin` resolves to `0` — the cancel-margin becomes a no-op (extra ~16-32px of visible padding remains)
  rather than a crash or `NaN`. This is a graceful degradation, not a blocking error; noted for QA
  awareness, not treated as a bug to guard against with additional code, since `ConfiguratorSurface` is
  only ever rendered inside `ConfiguratorNavShell` in the current codebase.
- **Docs page:** no dynamic data, no fetch, no error state possible for the new section (hand-authored
  static content, consistent with the rest of the file).

---

## 9. Edge Cases

- **A partner with an already-registered content source but no `outbound_base_url`:** Integration shows
  complete (green dot), matching the OR logic in §6.3 — this is intentional; either signal alone satisfies
  "the partner has configured how Clio reaches them."
- **A partner who generated an OAuth client but has neither `outbound_base_url` nor a content source:**
  Integration shows **incomplete**, even though they can technically call Clio's API. This is a known,
  deliberate consequence of the CEO-specified definition (§6.3) — flagged, not silently absorbed.
- **A not-yet-live partner where Integration and Payment are both already complete but they haven't
  clicked Go Live:** the "Start here → Integration" hint text (§6.1's fallback) may still display even
  though Integration is in fact complete, because `firstIncomplete` is `null` in this state and the hint's
  pre-existing (B2B-20) fallback logic always shows *some* section name whenever `!isLive`, regardless of
  whether anything is actually incomplete. **This is a pre-existing minor UX inconsistency carried forward
  unchanged from B2B-20** (only the fallback string changes, from `'questionnaire'` to `'integration'`,
  §6.1) — not introduced or fixed by this brief. Flagged for visibility, not in scope to fix here.
- **Multi-account admin switching from an account with `outbound_base_url` set to one without:** the
  Integration dot and Go-Live "Ready"/"Setup incomplete" label both refetch on account switch, exactly as
  B2B-20 already specifies for every other section.
- **A partner whose only registered content source has `auth_type: 'none'`:** still counts as "a
  registered content source exists" for the `integration` completion check (§6.3) — the OR condition
  checks existence of a row, not which `auth_type` it uses.
- **Very large content-auth field tables on mobile (Docs page):** the existing `overflowX: 'auto'` on
  `tableStyle` (already present in `DocsClient.tsx`) contains any table overflow; no new mobile-specific
  handling needed for the new section, consistent with the existing tables in the file.
- **A partner directly calls the now-superseded `checkIntegrationComplete` semantics by generating an
  OAuth client and expecting the Integration dot to flip green (matching pre-B2B-23 behavior):** it will
  not, per §6.3's documented behavior change — this is an intentional, CEO-specified redefinition, not a
  regression to guard against.
- **Ultrawide monitor (≥2560px) with the sidebar open:** content column caps at 1900px and centers via
  `margin: '0 auto'` (unchanged mechanism) — confirmed no change to the centering behavior, only to the cap
  value itself.

---

## 10. Out of Scope

- **Deleting any hidden section's code, routes, components, or DB tables/columns.** Explicitly forbidden
  by governance and by the brief (§4). `questionnaire/`, `topics/`, `content/`, `visualization/`, `domain/`
  and their API routes remain untouched.
- **The C6 partner-supplied encryption keyword.** Per the brief's own security-design reasoning (§7 of the
  brief): a partner-supplied passphrase adds no meaningful protection beyond the existing AES-256-GCM
  at-rest encryption (`lib/partner/crypto.ts`) when Clio must store it to replay the credential outward at
  fetch time — it would only add value under a per-request-passphrase model (partner re-supplies the
  secret on every session trigger, never persisted), which is a materially heavier integration model the
  milestone does not need. **Decision: DEFERRED.** No new field, no new UI, no schema change for this in
  this brief. If Arun wants it after reviewing this spec, it is a fast-follow with its own brief.
- **Any visual/spacing/typography redesign of the Configurator, Integration panel, Go Live panel, or Docs
  page.** This brief changes copy (§4.3), layout mechanism (§4.6), and adds documentation content (§4.7)
  only — no new colors, no new type scale, no re-theming. The follow-on `/design-review` pass (per the
  brief's own sequencing, §13) owns polish.
- **Building query-param API-key auth or multi-custom-header auth for content sources.** Identified as real
  gaps (§6.4), documented as "not yet supported" on the Docs page, and logged to `BACKLOG.md` as candidate
  fast-follows — not built here.
- **Any change to `docs/b2b-pivot-status.md`'s Live Status table beyond the standard "update on merge"**
  the Orchestrator already performs for every landed brief — not a BA-authored deliverable of this spec.
- **Changing auth, tenancy, the `partner_account_id`-in-URL model, or any Clerk/Stripe behavior.**
  Unchanged.
- **Re-deriving or modifying B2B-20's core left-nav + panel mechanism** (section-switch animation, drawer
  behavior, completion-dot visual treatment, `ConfiguratorNavShell`'s tab row/billing banner). Only the set
  of navigable sections, two pieces of copy, one CSS property set, and the Docs content change.

---

## 11. Open Questions

**None.** The brief's one genuine blocker (C5/Domain) was resolved by Arun on 2026-07-18 (Option A,
brief §8) before this spec was written, and every question the brief delegated to the BA (§12 of the
brief) is answered in-spec, not escalated:

- **Deep-link to a hidden section (Q1):** falls back to the default-section rule, identical treatment to
  an invalid `?section=` value — reusing B2B-20's existing rule rather than inventing a new state (§4.4).
- **First-incomplete default & canonical order (Q2):** narrows to the two visible sections,
  `[integration, payment]`, in that order; live-partner default moves from Questionnaire to Integration
  (§4.4, §6.1).
- **Group-heading rendering (Q3):** generic filter-then-drop-empty-groups rule, applied uniformly, not
  hardcoded per group (§4.5, §6.1).
- **Go-Live gate (Q4):** final `GO_LIVE_REQUIRED_STEPS = ['integration', 'payment']`; the `integration`
  completion check is defined as `outbound_base_url IS NOT NULL OR a registered content source exists`,
  wired into both `checkStepComplete()` (server gate) and `getConfiguratorStatus()` (nav dot) so both
  agree, per the brief's explicit instruction (§6.3).
- **WS-2 approach (Q5):** a shared `clamp()`-based CSS-custom-property constant (`SHELL_CONTENT_STYLE`),
  applied inline (not a Tailwind class migration, since only two properties change and neither needs a true
  breakpoint-triggered structural change) — with `ConfiguratorSurface.tsx`'s padding-cancel margin
  converted to a Tailwind arbitrary-value `calc()` expression referencing the same custom property, so the
  two compose correctly at every width instead of drifting (§4.6, §6.2). Ceiling: 1900px (within the
  brief's suggested 1800-2000px range).
- **WS-3 gaps (Q6):** three candidate gaps confirmed real (query-param auth, multi-header auth — both
  documented "not yet supported" + logged to `BACKLOG.md`) and one confirmed a non-gap (presigned image
  URLs already work today via `auth_type: 'none'`, clarified in the Docs copy) — none of the three block
  milestone viability, so none required CEO escalation (§6.4, §10).
- **C6 keyword (Q7):** the CEO's "recommend defer" (brief §7) is affirmed and documented as a decided
  deferral (§10), not built.

**CEO Agent review: APPROVED, 2026-07-18.** The CEO Agent independently re-verified every claim in this
document against live code (see the v1.1 changelog note at the top of this file for the one non-blocking
follow-up, now addressed in §6.1) before clearing it to proceed to Developer agents.

---

## 12. Dependencies

**Must be true before build (all already true):**
- B2B-20 (`docs/specs/B2B-20-requirement-document.md`) — **Done.** `ConfiguratorSurface.tsx`,
  `_shared.tsx`, `GoLivePanel.tsx`, `lib/partner/configurator-status.ts`, and the standalone-section
  redirect-into-`?section=X` pattern all exist exactly as read for this spec.
- B2B-19 (inline content delivery + content-source auth) — **Done**, migration 083 applied
  (`docs/b2b-pivot-status.md`). `lib/partner/content-sources.ts`, the
  `POST /api/partner/v1/content-sources` route, `lib/partner/crypto.ts`, `lib/partner/live-render.ts`, and
  `lib/partner/ssrf.ts` all exist exactly as read and documented in §6.4.
- B2B-06 (Integration section, `outbound_base_url` on `partner_accounts`) — **Done**, confirmed via
  `app/api/admin/configurator/outbound-config/route.ts` and cross-referenced in `lib/partner/webhooks.ts`,
  `render-data.ts`, `questionnaire.ts`, `topics-config.ts`.
- B2B-05 (wizard/`checkStepComplete`/`GO_LIVE_REQUIRED_STEPS` origin) — **Done**, `lib/partner/wizard.ts`
  read directly for this spec.
- No new npm dependency required. No new environment variable required.

**Concrete build task list (files):**

*Modified:*
- `app/dashboard/configurator/ConfiguratorSurface.tsx` — `NAV_GROUPS` filtering (§6.1), `CANONICAL_ORDER`
  removed in favor of imported `VISIBLE_SECTIONS`, `requiredReady`/`firstIncompleteLabel` fallback updates,
  padding-cancel className swap (§6.2).
- `app/dashboard/configurator/page.tsx` — `VALID_SECTIONS`/`CANONICAL_ORDER` narrowed via
  `VISIBLE_SECTIONS`, live-partner default section changed to `'integration'` (§6.1).
- `app/dashboard/configurator/GoLivePanel.tsx` — `REQUIRED_LABELS`, `requiredReady`, removal of the
  optional-sections paragraph (§6.1).
- `app/dashboard/configurator/integration/IntegrationClient.tsx` — `OutboundWebhooksCard` copy changes only
  (§4.3) — no field/behavior change.
- `app/dashboard/configurator/_shared.tsx` — `SHELL_CONTENT_STYLE` constant; lines 84 & 238 use it (§6.2).
- `app/dashboard/configurator/docs/DocsClient.tsx` — new "Content & image auth" section (§6.4).
- `lib/partner/wizard.ts` — `StoredWizardStep`/`WizardStep` split, `checkStepComplete`'s new `'integration'`
  case, `advanceWizardStep`'s narrowed parameter type, `GO_LIVE_REQUIRED_STEPS` update (§6.3).
- `lib/partner/configurator-status.ts` — `VISIBLE_SECTIONS` export, `getConfiguratorStatus()`'s
  `integration` computation switched to `checkStepComplete`, `checkIntegrationComplete` helper removed
  (§6.1, §6.3).
- `BACKLOG.md` — log the two confirmed WS-3 gaps (query-param auth, multi-header auth) and a reference to
  the new `SHELL_CONTENT_STYLE` responsive pattern under the existing "STANDING STORY — Responsive/
  mobile-friendly by default" entry (§4.6, §6.4).
- `docs/b2b-pivot-status.md` — Live Status update on merge (Orchestrator's standard step, not a build task
  for the Developer agent).

*Not touched (confirmed, §10):*
- `questionnaire/`, `topics/`, `content/`, `visualization/`, `domain/` section implementations, their
  standalone `page.tsx` redirects, their API routes, and their DB tables/columns.
- `lib/partner/domain-settings.ts`, `app/dashboard/configurator/domain/DomainConfigClient.tsx`.
- `app/api/admin/configurator/wizard/advance/route.ts` (its own Zod enum already matches
  `StoredWizardStep` exactly; no change needed, verified by direct read).
- `app/api/admin/configurator/status/route.ts` (thin passthrough to `getConfiguratorStatus`; no route-level
  change needed).

---

*End of Requirement Document B2B-23 v1.1 — all 12 sections filled, Section 11 empty. CEO Agent APPROVED
2026-07-18. Cleared to proceed to Developer agents.*
