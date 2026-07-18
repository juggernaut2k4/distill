# B2B-22 — Partner-Facing "Known Bugs" Screen (per-bug visibility toggle, status + ETA, partner comments) — Requirement Document
Version: 1.1
Status: APPROVED (CEO review round 2, 2026-07-18 — cleared for development, still gated on B2B-21
landing in `main` per §12)
Author: Business Analyst Agent
Date: 2026-07-18
Source brief: `.claude/agents/clio/feature-briefs/B2B-22-partner-facing-known-bugs-screen.md`
Hard dependency: `docs/specs/B2B-21-requirement-document.md` (Internal Admin Identity — Super-Admin +
Sales-Partner). This spec consumes B2B-21's role model (`internal_admin_users`,
`sales_partner_assignments`, `requireSuperAdmin()`, `requireInternalAdmin()`) exactly as B2B-21 defines
it and invents none of its own. B2B-22's own build cannot start until B2B-21 has landed in `main` — see
§12.

> Scope in one line: layer a **per-(issue, partner) visibility record** on top of B2B-17's internal
> `glitch_issues`/`glitch_instances` tracker, so a super-admin or a sales-partner tagged to a specific
> partner can toggle one bug visible to that one partner with an ETA and a partner-authored
> description; the partner gets a strictly read-only, per-partner-scoped **Known Bugs** screen (table +
> aggregate chart, both scoped identically — currently-visible bugs plus ever-visible bugs now Closed,
> sticky once resolved so disclosed history survives a later toggle-off) where they can comment on a
> currently-visible bug; internal operators get a small extension to the existing
> `/dashboard/admin/glitches` tracker to manage the toggle. Two structurally distinct read paths —
> partner-scoped vs. internal-unscoped — never one query with a role filter bolted on.

---

## 1. Purpose

Clio already tracks its own delivery glitches internally (B2B-17): a durable issue tracker with a
status lifecycle, root-cause notes, and per-glitch instances tied to a `partner_account_id`. That
tracker is explicitly internal-only — a partner today has zero visibility into bugs Clio has found and
is working on, even validated ones affecting their own account.

This creates a trust gap. When Clio finds and fixes a real problem, the partner never sees the work
happen — they only ever experience either the bug (before the fix) or silence (after it). Arun's own
words: *"we can show them progress and inform them when we complete so the partner gains confidence."*

This feature exists to close that gap **without** turning into an uncontrolled internal-glitch firehose
— which would do the opposite of build confidence (raw internal glitches are noisy, often not
partner-actionable, and sometimes phrased in blunt internal shorthand never meant for a partner's eyes).
Arun's own design resolves this tension explicitly: exposure is **per-bug and human-gated**. An internal
operator (super-admin, or a sales-partner tagged to that specific partner) reviews a validated bug and
deliberately toggles it visible to the one partner it concerns. Nothing is visible by default.

**Failure without it:** partners keep experiencing Clio's rough edges with no visibility into whether
Clio even knows about them, has validated them, or is working on them — undermining exactly the
trust-building relationship Arun is trying to build, and giving Clio no controlled, safe channel to
demonstrate delivery quality to a partner without leaking its raw internal diagnostic stream.

---

## 2. User Stories

**US-1 — Super-admin or tagged sales-partner (toggler):**
As a Clio super-admin, or a sales-partner tagged to Partner X,
I want to take a validated tracked issue and toggle it visible to Partner X specifically, setting an ETA
and writing a partner-safe description,
So that Partner X sees real progress on a bug that affects them, without me having to expose my raw
internal investigation notes or root-cause analysis, and without any other partner ever seeing it.

**US-2 — Partner admin (viewer):**
As a partner's own admin, viewing my account's Known Bugs screen,
I want to see the status and ETA of any bug Clio has chosen to show me, and be able to add a comment or
mention more evidence on it,
So that I know Clio is aware of and working on problems affecting my account — without being able to
touch Clio's own description, status, or ETA fields.

**US-3 — Partner admin, nothing visible yet (empty state):**
As a partner's own admin whose account has no bug currently toggled visible,
I want the Known Bugs screen to show me the table structure and an aggregate chart (correctly showing
zero activity) rather than a blank or broken page,
So that the screen still communicates "there's a real system here, nothing flagged right now" rather
than looking like a dead end.

**US-4 — Partner admin (negative case — cannot edit, cannot see hidden bugs, cannot see another
partner's bugs):**
As a partner's own admin,
I want it to be structurally impossible for me to change a bug's description/status/ETA, to see a bug
Clio hasn't toggled visible to my account, or to see any bug belonging to a different partner account —
even one grouped under the same internal tracked issue as one of mine,
So that Clio's internal process stays protected and my data stays isolated from every other partner's.

**US-5 — B2B-17's internal tracker (non-regression):**
As the existing internal glitch tracker (`/dashboard/admin/glitches`, `glitch_issues`,
`glitch_instances`, `glitch_issue_notes`, the status lifecycle, the 30-day purge),
I want to be completely unaffected in my existing behavior by this brief,
So that internal triage, RCA, and the purge pipeline keep working byte-for-byte unchanged.

---

## 3. Trigger / Entry Point

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| E-1 | Operator opens the internal glitch tracker and expands a tracked issue | `/dashboard/admin/glitches` (existing page, extended) | `requireSuperAdmin()` or `requireInternalAdmin()` per B2B-21 (already gates this page once B2B-21 lands) | Signed in as an active super-admin, or an active sales-partner |
| E-2 | Operator toggles a bug visible/invisible to an eligible partner, sets ETA/description | `PATCH /api/admin/glitches/issues/[id]/partner-visibility` | `requireInternalAdmin()` + per-partner scope check (§6.4) | Same as E-1; target partner must have ≥1 `glitch_instances` under this issue (§6.4 eligibility guard) |
| E-3 | Partner admin opens their Known Bugs screen | `/dashboard/configurator/known-bugs?partner_account_id=<id>` (new tab, 4th entry alongside Configurator/API/Docs) | `requirePartnerAdmin(partner_account_id)` (existing `lib/partner/auth.ts` helper — **not** B2B-21's role system; see §6.5 auth-binding note) | Signed in as a member of that partner's own `partner_admin_users` |
| E-4 | Partner admin adds a comment on a visible bug | `POST /api/partner/known-bugs/[issueId]/comments` | `requirePartnerAdmin(partner_account_id)` + bug must be currently visible to that partner (§6.4) | Same as E-3 |
| E-5 | A hidden or foreign-partner bug is addressed directly (URL guess, stale link) | `GET /api/partner/known-bugs/[issueId]/comments` or any per-issue partner route | `requirePartnerAdmin` passes, but the visibility check fails | Returns `404` — never confirms the issue exists (§8) |

---

## 4. Screen / Flow Description

### 4.A — Partner-facing: Known Bugs screen (`/dashboard/configurator/known-bugs`)

Reached via a **new 4th tab** in `ConfiguratorNavShell`'s existing top nav row (today: Configurator /
API / Docs — see §6.6 for the exact, minimal extension). Not inside the Configurator's left-nav step
groups — per the CEO brief, this is an ongoing operational/status view, not a setup step, and
`ConfiguratorSurface`'s left-nav and B2B-24's new Dashboard panel are both explicitly untouched by this
brief (B2B-24 itself states glitch/bug data is "owned by B2B-22's Known Bugs screen, never duplicated
here" — confirming the boundary both specs agree on).

- **State P1 — page load / auth gate.** `requirePartnerAdmin(activePartnerAccountId)` (existing helper,
  mirrors every other Configurator page's own gate exactly — `page.tsx` → `currentUser()`/`auth()` →
  `getPartnerAccountsForClerkUser` → account switcher, identical shape to `configurator/page.tsx`,
  `configurator/api/page.tsx`, `configurator/docs/page.tsx`). No session → redirect `/sign-in`. Signed
  in but not a member of this partner's `partner_admin_users` → the existing partner-account-switcher
  pattern simply won't offer that account (never a bespoke error page needed here, same as every other
  Configurator screen).
- **State P2 — loading.** A single client fetch to `GET /api/partner/known-bugs?partner_account_id=<id>`
  populates the table; a second to `GET /api/partner/known-bugs/summary?partner_account_id=<id>`
  populates the chart (mirrors the existing `/api/admin/glitches` + `/api/admin/glitches/summary` split
  precedent). Both show a simple inline loading placeholder (skeleton bar), matching the existing
  Configurator loading convention (`ConfiguratorSurface`'s own `status` fetch has an identical
  fail-open/loading pattern) — no spinner overlay, no page block.
- **State P3 — empty (default; no bug ever toggled visible to this partner).** Per Arun's exact words:
  table shows **only its column headers** (`Bug`, `Status`, `ETA`, `Since`) with no rows and a plain
  "Nothing to show yet." caption row beneath the header (never a raw blank void — matches this
  codebase's existing empty-state convention of a captioned placeholder row rather than nothing at all).
  The aggregate chart **is still rendered**, showing all three buckets (Open / In Progress / Closed) at
  zero — never hidden, never replaced with its own separate "no data" message, per Arun's explicit
  instruction that the chart is shown alongside the empty table.
- **State P4 — populated (≥1 bug currently visible).** One row per visible bug: partner-safe description
  (truncated to 2 lines, full text on row expand), mapped status badge (`Open` amber / `In Progress`
  cyan / `Closed` green — reusing the existing glitch-tracker badge palette), ETA (`Jul 24, 2026` or
  `TBD` if null), and "Since" (the date this bug was first toggled visible). The chart renders live
  counts across exactly the same visibility scope as the table (§6.3 — table and chart are always
  perfectly consistent with each other, never disagreeing).
- **State P5 — row expanded (detail + comment thread).** Clicking a row expands it in place to show: the
  full (untruncated) partner-safe description, status, ETA, and a comment thread beneath — every comment
  the partner has previously added on this bug (oldest first), each with its author's name/email and
  timestamp. Everything above the comment thread is **read-only** — no edit affordance exists anywhere on
  a Clio-owned field, by construction (the API never accepts a write to them from this surface at all —
  §6.4). Below the thread: **if `can_comment` is `true`** (the row's underlying `is_visible` is currently
  `true`, §6.3), a text input + "Add comment" button renders. **If `can_comment` is `false`** (a
  sticky-closed row an operator has since hidden, §6.3), the thread still renders in full but the input
  is replaced with a single muted line: `This bug is closed and no longer accepting new comments.` — the
  partner can always read their own prior evidence/comments on a bug Clio once showed them, even after
  it's hidden, but can never add to a thread on a bug they can no longer currently see live.
- **State P6 — comment submitted.** Optimistic append to the thread + a `POST` to
  `/api/partner/known-bugs/[issueId]/comments`; on failure, the optimistic comment is rolled back with an
  inline "Couldn't post your comment — try again." error beneath the input (mirrors the existing inline
  error convention used elsewhere in the Configurator, e.g. `PaymentConfigClient`).
- **State P7 — a previously-visible bug is toggled off by an operator mid-session.** The partner's next
  poll/refresh of `GET /api/partner/known-bugs` reflects §6.3's hybrid rule: **if the bug's status is
  Closed** (`resolved`/`wont_fix`) **at the moment it's toggled off**, the row **stays** in the table and
  chart (bucketed Closed), its full detail and comment thread remain readable, and only the "Add comment"
  input disappears (State P5's `can_comment: false` branch) — no special "this was removed" notice,
  since nothing about the partner's view of the bug's history actually changed. **If the bug's status is
  still `open`/`investigating`** at the moment it's toggled off, the row disappears from both the table
  and the chart entirely, together, in the same request (no live-push — this is discovered on next
  poll/refresh, consistent with every other Configurator screen's own refresh model).

### 4.B — Internal: extension to the existing `/dashboard/admin/glitches` tracker

Per the brief's explicit instruction ("extend, don't build a second parallel admin surface"), this adds
one new collapsible section to the **existing** Issue Detail view in `GlitchDashboardClient.tsx` (the
view already opened when an operator clicks into a tracked issue from Panel 3, showing its notes and
attached instances today) — no new page, no new route outside `/api/admin/glitches/issues/[id]/*`.

- **State I1 — Issue Detail view, "Partner visibility" section (new, collapsed by default below the
  existing Notes/Attached Instances panels).** On expand, fetches
  `GET /api/admin/glitches/issues/[id]/partner-visibility`. Lists **one row per eligible partner** — a
  partner is eligible only if ≥1 of this issue's attached `glitch_instances` carries that
  `partner_account_id` (§6.4 eligibility guard; an issue spanning 3 partners' instances shows exactly 3
  rows here, never more, never fewer). **A sales-partner caller sees only the subset of those rows whose
  partner is in their own `sales_partner_assignments`** — rows for partners outside their scope are
  omitted entirely from the response, not merely disabled, so a sales-partner can never learn that this
  issue also touches a partner they're not tagged to (§6.4).
- **State I2 — a partner row, toggle off (not yet made visible).** Shows: partner name, an "off" toggle
  switch, and nothing else editable until switched on (ETA/description inputs are disabled/hidden while
  off — there is nothing productive to fill in for a bug the partner can't see yet).
- **State I3 — toggling a row on.** Flipping the switch to "on" reveals two required-before-save inputs:
  an ETA date picker (optional — may be left blank, partner sees "TBD") and a partner-facing description
  textarea (**required**, non-empty — the toggle cannot be saved "on" with a blank description; the
  server enforces this with a DB check constraint as well as route-level validation, §6.2). A "Save"
  button commits `PATCH .../partner-visibility` with `{ partner_account_id, is_visible: true, eta,
  partner_facing_description }`.
- **State I4 — a partner row, toggle on (currently visible).** Shows: partner name, an "on" toggle, the
  current ETA (editable inline, saves on blur/change), the current partner-facing description (editable
  inline textarea, saves on blur), "last updated by `<email>` on `<date>`", and a **"View comments"**
  expand revealing that partner's comment thread **read-only from the internal side** — the operator sees
  what the partner has written but does not reply in this same thread (§10 — v1 scope; see rationale
  there). Flipping the toggle back to "off" is a single click, no confirmation dialog needed (turning
  visibility off is non-destructive — the visibility row, its ETA/description, and the comment thread are
  all preserved, not deleted; toggling back on later restores everything intact, §9 edge case).
- **State I5 — save failure (network/validation).** Inline red error text directly beneath the failed
  row's inputs, mirroring the existing Team-page/PartnerBillingClient inline-error convention used
  elsewhere in this codebase; the toggle visually reverts to its last-saved state.
- **State I6 — no eligible partners.** If an issue has zero attached instances (a freshly created,
  not-yet-attached issue — a valid B2B-17 state per its own Section 8), the Partner visibility section
  shows: "No partners are eligible yet — attach a glitch instance to this issue first." No toggle UI
  renders at all.

---

## 5. Visual Examples

### Partner Known Bugs screen — Empty state (State P3)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Clio Configurator                                        [Acme Corp ▾]      │
├───────────────────────────────────────────────────────────────────────────┤
│  Configurator    API    Docs    Known Bugs  ◀ active                        │
├───────────────────────────────────────────────────────────────────────────┤
│  Known Bugs                                                                 │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐│
│  │  Open        In Progress       Closed                                  ││
│  │    0              0               0            ← aggregate chart       ││
│  └───────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  Bug                          Status         ETA          Since            │
│  ─────────────────────────────────────────────────────────────────────────│
│                        Nothing to show yet.                                │
└───────────────────────────────────────────────────────────────────────────┘
   Colors: bg-[#080808] page, bg-[#111111] chart card, border-[#222222],
   status badges reuse the existing glitch-tracker palette — amber #F59E0B
   (Open), cyan #06B6D4 (In Progress), green #10B981 (Closed). No new tokens.
```

### Partner Known Bugs screen — Populated, row expanded (State P4/P5)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Known Bugs                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐│
│  │  Open        In Progress       Closed                                  ││
│  │    1              1               2                                    ││
│  └───────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  Bug                                Status        ETA           Since      │
│  ─────────────────────────────────────────────────────────────────────────│
│  ▾ Session audio occasionally cuts  In Progress    Jul 24, 2026  Jul 15    │
│    out for ~2s during long topics                                          │
│    ┌─────────────────────────────────────────────────────────────────────┐│
│    │ We've reproduced this and are testing a fix in our audio relay      ││
│    │ layer. Full description here, untruncated.                          ││
│    │                                                                     ││
│    │ Comments                                                            ││
│    │  Priya (Acme Corp) — Jul 16: "Happens most on our biology topics."  ││
│    │                                                                     ││
│    │ ┌─────────────────────────────────────────────┐                    ││
│    │ │ Add a comment or note more evidence…          │  [ Post ]         ││
│    │ └─────────────────────────────────────────────┘                    ││
│    └─────────────────────────────────────────────────────────────────────┘│
│  ▸ Onboarding email delayed for      Open          TBD          Jul 10    │
│    new partner accounts                                                    │
└───────────────────────────────────────────────────────────────────────────┘
```

### Internal — `/dashboard/admin/glitches` Issue Detail, new "Partner visibility" section (State I3/I4)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Issue: Session audio occasionally cuts out          Status: Investigating │
│  [Notes ▸]  [Attached instances ▸]  [Partner visibility ▾]                 │
│                                                                             │
│  Acme Corp                                          ● Visible    [Toggle] │
│    ETA:  [ Jul 24, 2026 ▾ ]                                                │
│    Partner-facing description:                                            │
│    ┌─────────────────────────────────────────────────────────────────────┐│
│    │ We've reproduced this and are testing a fix in our audio relay      ││
│    │ layer.                                                               ││
│    └─────────────────────────────────────────────────────────────────────┘│
│    Last updated by hello.arunprakash83@gmail.com on Jul 18, 2026           │
│    [ View comments (1) ▾ ]                                                 │
│                                                                             │
│  Beta Inc                                            ○ Hidden     [Toggle] │
└───────────────────────────────────────────────────────────────────────────┘
   Same dark-admin palette as the rest of GlitchDashboardClient.tsx — no new
   visual language. A sales-partner tagged only to Acme Corp would see just
   that one row; "Beta Inc" would not render for them at all.
```

### Mobile (<768px) — Partner Known Bugs screen

```
┌─────────────────────────────┐
│ Clio Configurator  [Acme ▾] │
├─────────────────────────────┤
│ Configurator API Docs Bugs  │  ← horizontally scrollable tab row (same
├─────────────────────────────┤    pattern ConfiguratorNavShell already uses)
│ Known Bugs                  │
│ ┌───────────────────────────┐│
│ │ Open  In Progress  Closed ││
│ │  1         1          2   ││
│ └───────────────────────────┘│
│ ┌───────────────────────────┐│
│ │ ▾ Session audio cuts out    ││
│ │   In Progress · Jul 24     ││
│ │   [full description +      ││
│ │    comment thread stack    ││
│ │    full-width below]        ││
│ └───────────────────────────┘│
└─────────────────────────────┘
   Rows stack full-width, no horizontal body scroll, fluid clamp()-based
   spacing — per the standing responsive/mobile-friendly-by-default rule.
```

---

## 6. Data Requirements

### 6.1 New tables (migration, numbered after B2B-21's — see §12 numbering note)

**`glitch_issue_partner_visibility`** — the per-(issue, partner) visibility record. This is the
structural fix for the cross-partner-leak risk the CEO brief flagged: visibility is never a boolean on
`glitch_issues` itself, because one issue's `glitch_instances` can span multiple partners.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default `uuid_generate_v4()` | |
| `issue_id` | uuid NOT NULL REFERENCES `glitch_issues(id)` ON DELETE CASCADE | |
| `partner_account_id` | uuid NOT NULL REFERENCES `partner_accounts(id)` ON DELETE CASCADE | |
| `is_visible` | boolean NOT NULL DEFAULT false | the toggle itself; default OFF per Arun |
| `eta` | date NULL | optional; NULL → partner sees "TBD" |
| `partner_facing_description` | text NULL, `CHECK (char_length(partner_facing_description) BETWEEN 1 AND 2000)` when not null | **never** a passthrough of `glitch_issues.title` — a separate, deliberately-authored field (§6.2) |
| `toggled_by` | uuid NULL REFERENCES `internal_admin_users(id)` | who last changed `is_visible`/`eta`/description; NULL only if the row somehow predates B2B-21 (should not occur — B2B-21 is a hard dependency, §12) |
| `toggled_at` | timestamptz NULL | when last changed |
| `first_visible_at` | timestamptz NULL | set once, the first time `is_visible` is ever flipped to `true` for this pair; **never cleared or overwritten thereafter**, including when later toggled off. This is the explicit, durable marker of "this partner was genuinely shown this bug at some point" that §6.3's sticky-closed-history rule reads — it does not rely on row-existence as an implicit proxy for "was once visible," so the historical guarantee holds even if a future change ever allows creating a row without setting `is_visible: true` first. |
| `created_at` / `updated_at` | timestamptz | standard `update_updated_at_column()` trigger, same as every other table in this codebase |

`UNIQUE (issue_id, partner_account_id)` — one visibility record per pair, ever (created on first
toggle-on, then updated in place — never re-inserted).

`CHECK (NOT is_visible OR (partner_facing_description IS NOT NULL AND char_length(partner_facing_description) > 0))`
— **database-enforced**, defense in depth alongside route-level validation: a row can never be saved
`is_visible = true` with a blank description. This directly encodes Arun's "never show a partner
something unexplained" bar at the schema level, not just in application code.

`CREATE INDEX ... ON glitch_issue_partner_visibility(partner_account_id, is_visible)` — the exact shape
the partner-facing read path filters on.

**`glitch_issue_partner_comments`** — append-only, partner-authored comment/evidence record. Mirrors
`glitch_issue_notes`'s immutable, insert-only posture exactly (no update/delete route by design).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default `uuid_generate_v4()` | |
| `issue_id` | uuid NOT NULL | |
| `partner_account_id` | uuid NOT NULL | |
| `body` | text NOT NULL, `CHECK (char_length(body) BETWEEN 1 AND 5000)` | same length bound as `glitch_issue_notes.body` |
| `author_partner_admin_user_id` | uuid NULL REFERENCES `partner_admin_users(id)` | who on the partner side wrote it |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

`FOREIGN KEY (issue_id, partner_account_id) REFERENCES glitch_issue_partner_visibility(issue_id, partner_account_id)`
— a **composite FK**, not two independent FKs. This makes it structurally impossible for a comment to
exist without a visibility record for that exact (issue, partner) pair ever having been created — a
second, schema-level guard alongside the route-level "must currently be visible to post" check (§6.4).
Comments are **not** deleted or hidden when `is_visible` later flips to `false` — they persist, and
reappear intact if the bug is toggled visible again later (§9 edge case).

`CREATE INDEX ... ON glitch_issue_partner_comments(issue_id, partner_account_id, created_at DESC)`.

**RLS (both tables):** `ENABLE ROW LEVEL SECURITY` + a single `"Service role full access"` policy,
identical in shape to every other table in this codebase (`glitch_issues`, `glitch_instances`,
`partner_admin_users`, etc.). Neither table is ever read via a browser-authenticated Supabase client —
every read/write goes through `createSupabaseAdminClient()` behind the route-level auth checks in §6.4.

### 6.2 Status mapping — reusing B2B-17's lifecycle, never forking a parallel enum

New file `lib/glitches/partner-status.ts`:

```ts
import type { GlitchIssueStatus } from './issue-status'

export type PartnerBugStatus = 'open' | 'in_progress' | 'closed'

export const PARTNER_STATUS_LABEL: Record<PartnerBugStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  closed: 'Closed',
}

/**
 * Maps B2B-17's internal 4-state lifecycle to the partner-visible 3-bucket
 * vocabulary Arun asked for ("open, closed, in-progress"). `wont_fix` is
 * deliberately bucketed into `closed` alongside `resolved` — see rationale
 * below. There is no independent partner status field; this mapping is
 * computed at read time from `glitch_issues.status`, so the two can never
 * drift (B2B-22 Requirement Doc §6.2).
 */
export function mapToPartnerStatus(status: GlitchIssueStatus): PartnerBugStatus {
  switch (status) {
    case 'open':
      return 'open'
    case 'investigating':
      return 'in_progress'
    case 'resolved':
    case 'wont_fix':
      return 'closed'
  }
}
```

**Resolution of the CEO brief's named question ("is `wont_fix` ever partner-visible?"):** `wont_fix` maps
to `Closed`, identically to `resolved` — the partner is never shown a literal "won't fix" label.
Rationale: distinguishing "won't fix" from "resolved" in a partner-facing status badge adds no
confidence value (the entire point of this screen) and risks reading as a blunt, unexplained rejection —
exactly the internal-framing leak Constraint B warns against. If an operator needs to communicate *why*
something won't be fixed with appropriate nuance, that happens through the partner-facing description
field or a reply — not through a status label. Nothing is lost internally: the **internal** admin surface
still shows the true 4-state status untouched (§4.B, §7). An operator remains free to toggle a
`wont_fix` issue visible at all (no special restriction) — it simply reads as "Closed" to the partner,
same as any resolved issue.

### 6.3 The two read paths — partner-scoped vs. internal-unscoped (Arun's non-negotiable, 2026-07-18)

**Partner-facing (`GET /api/partner/known-bugs`, `GET /api/partner/known-bugs/summary`):** both the
table and the chart are scoped **identically** — this is still non-negotiable, the two must never
disagree — but the scope is **not** a bare `is_visible = true` filter. Per CEO review (2026-07-18,
returned for revision — see below), the scope is the **Option (c) hybrid** from the original chart
escalation: a bug counts for a partner if it is **currently visible**, **or** it was **ever** visible to
that partner (`first_visible_at IS NOT NULL`) **and its current status is Closed**
(`resolved`/`wont_fix`). A bug never toggled visible, or toggled off while still `open`/`in_progress`,
is fully excluded either way — the original no-hidden-bug-count guarantee is untouched.

```sql
SELECT v.*, i.status
FROM glitch_issue_partner_visibility v
JOIN glitch_issues i ON i.id = v.issue_id
WHERE v.partner_account_id = $1
  AND (
    v.is_visible = true
    OR (v.first_visible_at IS NOT NULL AND i.status IN ('resolved', 'wont_fix'))
  )
```

The table lists exactly these rows; the chart counts them by `mapToPartnerStatus(i.status)` (§6.2) —
one query shape, two presentations, always consistent with each other by construction.

**Revision history on this decision (read before touching this section again):** v1.0 of this spec
implemented a strict `is_visible = true`-only filter on both table and chart, reasoning that uniform
live-only scoping was "strictly safer and simpler" than the CEO brief's original escalation language
("counts only bugs that are *or have been* toggled visible"). **CEO review rejected that reading** on
three grounds, all upheld here: (1) Arun's own words for the empty-state chart are *"a chart of **past
list of issues**"* — a running historical record, not a live mirror of the current toggle state; (2) a
strict live-only filter actively undercuts the feature's own stated purpose — if an operator ever
toggles an already-shown, already-fixed bug back to hidden (e.g. routine cleanup), the partner's
evidence that Clio found and fixed something for them would silently vanish, which is the opposite of
"the partner gains confidence"; (3) Arun's actual one-line resolution — *"only the bugs tagged for the
partner should be considered for the display and charts"* — answered the escalation's real question
(does the partner learn how many bugs Clio is hiding from them?), not the separate, never-asked question
of whether *disclosed-and-closed* history should later disappear on toggle-off. Resolving that second,
distinct question unilaterally and marking Section 11 clean was the specific error flagged in review.
**This v1.1 now implements Option (c)** exactly as re-specified by CEO review: sticky once closed, still
fully excluded if never disclosed or if hidden while still open/in-progress.

**A further, genuinely new edge case this hybrid introduces (not present under the old strict-live
model) — see §9 edge case 10:** a bug that is sticky-closed-and-currently-hidden (`is_visible = false`,
`first_visible_at` set, status Closed) that then gets **reopened** (`resolved`/`wont_fix` → `open`, a
valid B2B-17 transition) will **drop out** of the table/chart again on its next read, because it is no
longer currently visible *and* no longer currently Closed. This is the correct, intended consequence of
the hybrid rule applied literally (§9 edge case 10), not a bug — but it is a real behavioral subtlety a
developer or QA pass could otherwise flag incorrectly, so it is called out explicitly here.

**Read vs. write scope are not the same thing (new distinction this revision introduces — see §6.4):**
a sticky-closed-but-currently-hidden bug is still **read-only viewable** by the partner (full
description/status/ETA/comment history, per the query above) — but the partner **cannot post a new
comment** on it, because posting requires `is_visible = true` right now, unchanged from v1.0. An
operator's decision to hide a bug always blocks new partner interaction on it immediately; it only ever
affects whether its *past, already-disclosed* record keeps appearing in the read-only table/chart.

**Internal (existing, unmodified in this regard): `/api/admin/glitches`, `/api/admin/glitches/issues`,
`/api/admin/glitches/issues/[id]`.** These routes — once gated by B2B-21's `requireInternalAdmin()` and
forced-scoped **by partner identity** for a sales-partner (B2B-21 §6.3) — **must never additionally
filter by `is_visible`.** They show every glitch/issue for a partner the caller is scoped to, visible or
not, exactly as B2B-17 built them. This brief adds **zero** new filtering to those existing routes; it
only adds the new `partner-visibility` sub-resource alongside them. This is stated as an explicit
non-regression acceptance test (§7 AT-16) because it is the single easiest way for a developer to get
this brief wrong — accidentally joining `is_visible` into the existing internal list "to be helpful."

### 6.4 New routes

**Internal (gated by `requireInternalAdmin()`, per B2B-21):**

- `GET /api/admin/glitches/issues/[id]/partner-visibility` — returns one row per **eligible** partner
  (distinct `partner_account_id`s among this issue's attached `glitch_instances` — computed via
  `SELECT DISTINCT partner_account_id FROM glitch_instances WHERE issue_id = $1`), left-joined to any
  existing `glitch_issue_partner_visibility` row (defaults `is_visible: false, eta: null,
  partner_facing_description: null` if no row exists yet — a row is only actually inserted on first
  toggle-on, §6.1). **If the caller is a `sales_partner`, the result is filtered to only partners in
  their own `scopedPartnerAccountIds` before returning** — a partner outside their scope is omitted
  entirely, not flagged/disabled, so a sales-partner can never learn an issue touches a partner outside
  their tag (§4.B State I1).
- `PATCH /api/admin/glitches/issues/[id]/partner-visibility` body
  `{ partner_account_id, is_visible?, eta?, partner_facing_description? }` (Zod: `partner_account_id`
  uuid required; `is_visible` boolean optional; `eta` nullable date-string optional; `description`
  string 1–2000 optional). Auth: `requireInternalAdmin()`; if caller is `sales_partner`,
  `partner_account_id` must be in their scope or `403 forbidden`. **Eligibility guard:** the target
  `partner_account_id` must have ≥1 `glitch_instances` under this `issue_id`, or `422
  partner_not_eligible` (an operator cannot toggle an issue visible to a partner who was never actually
  affected by it). Upserts the `(issue_id, partner_account_id)` row (`ON CONFLICT ... DO UPDATE`),
  setting `toggled_by`/`toggled_at` on every write, and — **on the specific write that sets
  `is_visible: true` while `first_visible_at IS NULL`** — also sets `first_visible_at = now()`
  (never touched again on any subsequent write, including later toggling off; §6.1, §6.3). If the
  resulting `is_visible = true` and `partner_facing_description` is null/empty, `422
  description_required` (mirrors the DB CHECK — caught at the route layer first for a clean error
  message, the DB constraint is the backstop).
- `GET /api/admin/glitches/issues/[id]/partner-visibility/comments?partner_account_id=` — internal,
  read-only view of that partner's comment thread on this issue (for State I4's "View comments"). Same
  sales-partner scope check as above.

**Partner-facing (gated by the existing `requirePartnerAdmin(partner_account_id)`, from
`lib/partner/auth.ts` — see §6.5 for why this is a *different* auth system from the internal routes
above):**

- `GET /api/partner/known-bugs?partner_account_id=` — returns the table rows per §6.3's hybrid scoping
  (currently visible, OR ever-visible-and-now-Closed): `id` (the `glitch_issue_partner_visibility.id`,
  used as the row/interaction key — **never** the raw `glitch_issues.id` is exposed as a label, though it
  is the same underlying value; framed purely as an opaque bug identifier), `status` (mapped, §6.2),
  `eta`, `description` (= `partner_facing_description`), `visible_since` (= `first_visible_at`, i.e.
  when it was first ever toggled visible — **not** `created_at`, so this date stays stable and
  meaningful even for a sticky-closed row that's since been toggled off), `comment_count`,
  `can_comment` (boolean = the row's *current* `is_visible`, §6.3's read/write split — the client uses
  this alone to decide whether to render the comment input, no separate fetch needed).
- `GET /api/partner/known-bugs/summary?partner_account_id=` — returns
  `{ open: number, in_progress: number, closed: number }`, computed over the identical hybrid scope as
  the row above (§6.3) — mirrors the existing `/api/admin/glitches` + `/api/admin/glitches/summary`
  split precedent exactly.
- `GET /api/partner/known-bugs/[issueId]/comments?partner_account_id=` — the partner's own comment
  thread for one bug. **Read scope matches §6.3's hybrid table scope** (currently visible, OR
  ever-visible-and-now-Closed) — a sticky-closed-but-hidden bug's past comment thread remains readable,
  consistent with its row still appearing in the table. Outside that scope (never visible, or hidden
  while still open/in-progress) → `404`, never `403` — a partner must never be able to distinguish "this
  bug isn't yours" from "this bug doesn't exist," per B2B-21's own "never leak via omission" convention
  applied in the opposite direction: here, silence is the safe default.
- `POST /api/partner/known-bugs/[issueId]/comments` body `{ partner_account_id, body }` (Zod: `body`
  string 1–5000). **Write scope is narrower than read scope, deliberately (§6.3): requires
  `is_visible = true` right now** for that exact `(issueId, partner_account_id)` pair, or `404` — a
  sticky-closed-but-hidden row is viewable but not commentable, and a never-visible/hidden-while-open row
  is neither. **A partner cannot comment on, or even confirm the existence of, a bug not currently
  toggled visible to them** (Constraint D, unchanged from v1.0). Inserts into
  `glitch_issue_partner_comments` with `author_partner_admin_user_id` resolved from the authenticated
  `partner_admin_users` row.

### 6.5 Auth binding — two genuinely different systems, used precisely (this is the load-bearing
clarification the CEO brief's "auth" section left implicit)

**Toggling (who decides what's visible)** is gated by **B2B-21's new internal-identity system** —
`requireSuperAdmin()` / `requireInternalAdmin()`, `internal_admin_users`, `sales_partner_assignments`.
This is the system this brief has a hard dependency on.

**Viewing one's own Known Bugs screen (the partner side)** is gated by the **existing,
already-built-and-unrelated** `requirePartnerAdmin(partner_account_id)` from `lib/partner/auth.ts` — the
same helper every other Configurator screen already uses (`ConfiguratorSurface`, `PaymentConfigClient`,
etc.), backed by the pre-existing `partner_admin_users` / Clerk-Organizations system. **This system is
not part of B2B-21 and has no dependency on it** — a partner's own admin views their Known Bugs screen
exactly the same way they view any other Configurator tab today, and this brief adds zero new auth
mechanism on the partner side. The only genuinely new auth surface this brief introduces is the internal
toggle route (§6.4), which is where B2B-21's role model is actually consumed.

### 6.6 Nav placement — coordinated with B2B-24, verified live

Per the CEO brief's Constraint G, Known Bugs is **not** a Configurator setup step and does not belong in
`ConfiguratorSurface`'s left-nav step groups (untouched by this brief) or inside B2B-24's new Dashboard
panel (which explicitly excludes glitch/bug data, deferring to "B2B-22's Known Bugs screen" by name —
confirmed directly from `docs/specs/B2B-24-requirement-document.md` §10, verified 2026-07-18, so this is
a *confirmed* coordination, not a guess about the sibling brief's outcome).

**Placement: a 4th tab in `ConfiguratorNavShell`'s existing top nav row** (today: Configurator / API /
Docs), the same shell every Configurator sub-area already uses. Minimal, additive extension:

- `app/dashboard/configurator/_shared.tsx` — widen `ConfiguratorNavShell`'s `active` prop union from
  `'configurator' | 'api' | 'docs'` to `'configurator' | 'api' | 'docs' | 'known_bugs'`, and add one
  entry to its local `navItems` array: `{ key: 'known_bugs', label: 'Known Bugs', href:
  '/dashboard/configurator/known-bugs?partner_account_id=${activePartnerAccountId}' }`. No other change
  to this shared file (the nav row already maps over `navItems` generically — no per-item special-casing
  needed).
- New route `app/dashboard/configurator/known-bugs/page.tsx` (+ `KnownBugsClient.tsx`) — mirrors
  `app/dashboard/configurator/api/page.tsx`'s exact shape (`auth()` → `getPartnerAccountsForClerkUser` →
  account resolution → render inside `ConfiguratorNavShell active="known_bugs"`), the same pattern every
  sibling tab already follows. No new shell, no new visual language.

The Orchestrator must verify this link resolves to a live, rendering page before merge (per the CEO
brief's explicit callout that a prior nav change once pointed at a dead page).

### 6.7 localStorage / sessionStorage

None. All state is server-side; table/chart data is fetched fresh on each screen load, matching every
other Configurator tab's own pattern (no client-side caching layer exists anywhere in this codebase to
reuse).

---

## 7. Success Criteria (Acceptance Tests)

**Toggle & eligibility (internal)**
1. ✓ Given a tracked issue with attached instances from Partner A and Partner B only, when a super-admin
   opens its Partner visibility section, then exactly 2 rows render (A and B), never a third.
2. ✓ Given the same issue, when a sales-partner tagged only to Partner A opens the same section, then
   only Partner A's row renders — Partner B's row is entirely absent from the API response, not merely
   disabled.
3. ✓ Given a partner with zero attached instances under an issue, when an operator attempts
   `PATCH .../partner-visibility` with that `partner_account_id`, then `422 partner_not_eligible` and no
   row is created.
4. ✓ Given a sales-partner attempts to toggle visibility for a partner outside their
   `sales_partner_assignments`, then `403 forbidden`.
5. ✓ Given an operator toggles `is_visible: true` with `partner_facing_description` omitted or empty,
   then `422 description_required` and no write occurs.
6. ✓ Given an operator toggles a bug visible with a valid description and no ETA, when the partner views
   it, then ETA renders as `TBD`.
7a. ✓ Given an operator toggles a bug's `is_visible` from `true` to `false` while the issue's status is
   `open` or `investigating`, when queried again later, then the row still exists in
   `glitch_issue_partner_visibility` with its ETA/description/comment thread intact (nothing deleted),
   but it is **excluded** from both the partner's table and chart (§6.3 hybrid scope).
7b. ✓ Given the same toggle-off, but the issue's status is `resolved` or `wont_fix` at the moment of
   toggle-off, when the partner's screen is queried again, then the row **remains** in both the table and
   the chart (bucketed `Closed`), its full description/ETA/comment thread remain readable, but
   `can_comment: false` and no new comment can be posted (`POST .../comments` → `404`).

**Partner screen — visibility scoping (the cross-partner-leak risk, the highest-priority tests)**
8. ✓ Given the same issue is toggled visible to Partner A but not Partner B, when Partner B's admin
   loads `/dashboard/configurator/known-bugs`, then that bug never appears in Partner B's table or chart.
9. ✓ Given Partner A's admin, when they call `GET /api/partner/known-bugs/[issueId]/comments` for a bug
   not currently visible to Partner A (or belonging to Partner B), then `404` — never `403`, never any
   content.
10. ✓ Given the empty state (no bug ever toggled visible to a partner), when their Known Bugs screen
    loads, then the table shows headers + "Nothing to show yet." and the chart shows `Open: 0, In
    Progress: 0, Closed: 0` — the chart is never hidden.

**Status mapping & data boundary**
11. ✓ Given an internal issue with status `investigating`, when read via the partner API, then
    `status: 'in_progress'`; given `wont_fix`, then `status: 'closed'` (never a literal "won't fix"
    string reaches the partner API response).
12. ✓ Given the partner-facing API response shape, when inspected, then it contains only `id, status,
    eta, description, visible_since, comment_count, can_comment` — never `title, root_cause_summary,
    created_by, glitch_type, is_visible` (the raw toggle flag itself is never exposed — `can_comment` is
    the only derived boolean the partner API surfaces), and never any field from `glitch_issue_notes` or
    raw `glitch_instances` rows.

**Comments**
13. ✓ Given a bug currently visible to Partner A, when their admin posts a comment, then it appears in
    both the partner's own thread and the internal operator's "View comments" panel for that
    (issue, partner) pair.
14. ✓ Given a bug not currently visible to Partner A, when their admin attempts
    `POST /api/partner/known-bugs/[issueId]/comments`, then `404` and no row is inserted.
15. ✓ Given a bug is toggled off then back on later, when the partner reopens it, then the full prior
    comment thread is intact and unchanged.
15a. ✓ Given a sticky-closed-but-currently-hidden bug (Closed status, `is_visible: false`,
    `first_visible_at` set), when the partner calls `GET /api/partner/known-bugs/[issueId]/comments`,
    then `200` with the full existing thread; when they call `POST` the same endpoint, then `404` and no
    row is inserted.
15b. ✓ Given a sticky-closed-but-currently-hidden bug is later **reopened** internally
    (`resolved`/`wont_fix` → `open`, a valid B2B-17 transition) while still `is_visible: false`, when the
    partner's screen is next queried, then the bug **drops out** of both the table and the chart — it is
    simultaneously not-currently-visible and not-currently-Closed, so neither branch of §6.3's hybrid
    scope applies (this is the intended behavior per §6.3/§9 edge case 10, not a regression).

**Two read paths — non-regression (Arun's explicit non-negotiable)**
16. ✓ Given `/api/admin/glitches` and `/api/admin/glitches/issues`, when this brief ships, then their
    query logic contains no reference to `is_visible`/`glitch_issue_partner_visibility` whatsoever
    (grep check) — they return every glitch/issue the caller's role is scoped to, visible-to-partner or
    not.
17. ✓ Given a super-admin viewing Partner A in the internal tracker, when compared against Partner A's
    own partner-facing Known Bugs screen, then the internal view shows strictly ≥ as many bugs as the
    partner view — every bug on the partner's screen (whether currently visible or sticky-closed-history,
    §6.3) is a subset of the internal view, since both are always bounded by rows that required an
    eligible attached instance and an explicit operator toggle; never the reverse.

**Non-regression & build hygiene**
18. ✓ Given `glitch_issues`, `glitch_instances`, `glitch_issue_notes`, and the existing
    `/api/admin/glitches/**` route family's pre-existing behavior, when this brief ships, then none of
    their existing columns, transitions, or response shapes are modified (grep/diff check).
19. ✓ `npx tsc --noEmit` clean; `npm run build` passes; all new API inputs Zod-validated; no unapproved
    packages; no new colors/typography/npm dependencies introduced by the new screens.

---

## 8. Error States

| Surface | Failure | Behavior |
|---|---|---|
| Internal `PATCH .../partner-visibility` | Target partner not eligible (no attached instances) | `422 partner_not_eligible` |
| Internal `PATCH .../partner-visibility` | `is_visible: true` with blank/missing description | `422 description_required` |
| Internal `PATCH .../partner-visibility` | Sales-partner targets a partner outside their scope | `403 forbidden` |
| Internal `GET .../partner-visibility` | Sales-partner, issue has zero eligible partners in their scope | `200` with an empty array — not an error; the UI shows State I6's message |
| Partner `GET /known-bugs`, `/summary` | Supabase read fails | `500`, inline "Couldn't load your bugs — try refreshing." Table/chart show their own last-good state if any, or the loading placeholder persists |
| Partner `GET/POST .../comments` | Bug not currently visible to this partner | `404` — no distinguishing detail (§6.4) |
| Partner `POST .../comments` | Empty/oversized body | `422` Zod validation error, inline under the comment input |
| Partner `POST .../comments` | Network failure mid-submit | Optimistic comment rolled back, inline "Couldn't post your comment — try again." (State P6) |
| Any `/api/partner/known-bugs*` route | No Clerk session | `401` |
| Any `/api/partner/known-bugs*` route | Signed in, not a member of `partner_account_id`'s `partner_admin_users` | `403 forbidden` (existing `requirePartnerAdmin` shape, unchanged) |
| Any `/api/admin/glitches/issues/[id]/partner-visibility*` route | No session / not an active internal admin | `401` / `403` (existing `requireSuperAdmin`/`requireInternalAdmin` shapes from B2B-21, unchanged) |
| `middleware.ts` tenant-host path | A partner's white-label domain requests `/dashboard/admin/glitches` or its partner-visibility routes | Unchanged: `neutralNotFoundResponse()` — internal surfaces never resolve on a partner domain |

---

## 9. Edge Cases

1. **An issue toggled visible to Partner A gets a new `glitch_instance` attached later that belongs to
   Partner B.** Partner B does not automatically gain visibility — eligibility only ever *permits* a
   toggle, it never *creates* one. Partner B's row now appears as an eligible-but-off row in the internal
   view (State I2); nothing changes on any partner-facing screen until an operator explicitly toggles it
   for B.
2. **All of a visible issue's instances get detached/reassigned to a different issue (B2B-17's own
   re-attach behavior, Section 8).** The original `glitch_issue_partner_visibility` row is **not**
   automatically cleared or migrated — it stays attached to the original `issue_id`, which may now have
   zero instances for that partner. This is a stale-but-harmless state (the partner still sees the same
   description/status/ETA they did before, now decoupled from live instance data); an operator noticing
   this can manually toggle it off. Not auto-corrected in v1 — flagged as a known limitation, not a
   defect, since B2B-17's re-attach is itself a rare manual operator action.
3. **A bug is toggled visible, the partner comments, then the underlying issue is reopened
   (`resolved → open`, a valid B2B-17 transition) while it is still `is_visible: true`.** The
   partner-visible status simply moves from `Closed` back to `Open` on their next screen load — no
   special notice, no "reopened" flag; the mapping is always computed live from current status (§6.2).
   The bug stays in the table/chart throughout (currently-visible branch of §6.3's hybrid scope covers
   this regardless of status). See edge case 10 for the *different* outcome when the same reopen happens
   while the bug is hidden.
4. **A partner admin belongs to multiple partner accounts** (the existing multi-account
   `partner_admin_users` model, same as every other Configurator screen). Switching accounts via the
   existing account switcher re-fetches `/api/partner/known-bugs` for the newly active
   `partner_account_id` — identical mechanism to every other tab, no new wiring.
5. **Two operators (a super-admin and a sales-partner both tagged to the same partner) edit the same
   visibility row near-simultaneously.** Last write wins (`toggled_by`/`toggled_at` reflect the most
   recent save) — same optimistic-no-lock behavior as every other admin write in this codebase (e.g.
   `glitch_issues` status PATCH); no new concurrency handling introduced.
6. **A partner tries to reach `/dashboard/configurator/known-bugs?partner_account_id=<some other
   partner's id>` directly.** `requirePartnerAdmin` rejects it exactly as it would for any other
   Configurator tab today — not a new failure mode.
7. **Mobile vs. desktop.** Table rows collapse to stacked cards below `md` (§5 wireframe); comment thread
   and description render full-width beneath each expanded card; no horizontal page-body scroll at any
   breakpoint (standing responsive rule).
8. **An issue is deleted or purged.** Not possible today — B2B-17 has no delete route for `glitch_issues`
   (only status transitions), so this case cannot occur; `ON DELETE CASCADE` on both new tables exists
   only as defensive schema hygiene in case that ever changes.
9. **A partner's comment contains something operationally sensitive (e.g. pasted credentials).** Out of
   scope for this brief to detect/redact — the same trust boundary already applies to every other
   partner-authored free-text field in this codebase (e.g. Questionnaire answers); no new
   sanitization/redaction is invented here.
10. **A sticky-closed, currently-hidden bug (Closed status, `is_visible: false`, `first_visible_at` set —
    §6.3's hybrid scope) is later reopened internally (`resolved`/`wont_fix` → `open`).** It **drops out**
    of the partner's table and chart on their next screen load — it is simultaneously not-currently-visible
    (an operator hid it) and not-currently-Closed (it's `open` again), so it satisfies neither branch of
    §6.3's `WHERE` clause. This is the correct, literal consequence of the hybrid rule (§7 AT-15b), not a
    defect: "sticky closed history" means the *closed* record is sticky, not an unconditional permanent
    record independent of status. If an operator wants the partner to see the reopened bug's fresh
    progress, they re-toggle it visible (a normal, one-click action, §4.B State I2/I4) — nothing about the
    bug's data is lost by this transition (the visibility row, ETA, description, and comment thread are
    all still intact underneath, exactly as in edge case 1 above; only the read-path query's inclusion
    criteria stop matching it).

---

## 10. Out of Scope

- **File/evidence attachments.** The CEO brief explicitly authorized deferring this: *"If that scope
  balloons, scope v1 to text comments only and defer file evidence to a follow-up."* Direct source check
  confirms **zero existing file-upload/Supabase-Storage usage anywhere in this codebase** (`grep` for
  `storage.from`/`createSignedUrl` across `lib/` and `app/` returns nothing) — meaning file evidence
  would require introducing an entirely new storage/upload-validation/virus-scanning surface with no
  existing pattern to extend. **v1 = text comments only.** File evidence is a clearly-scoped future
  follow-up (its own Feature Brief, not silently bundled into a "comments" field as base64 or similar).
- **Internal operators replying to a partner's comment inside the same thread.** v1 is a one-directional,
  partner-authored comment feed the operator can read in the admin surface (§4.B State I4) — no in-thread
  internal reply is built. Clio's own responses to partner-added evidence happen via updating the
  description/ETA/status (all of which the partner sees update live) or out-of-band, not via a reply
  message. A future enhancement could add internal replies visible to the partner; not requested by the
  brief and not built now.
- **Any change to B2B-17's internal tracker's existing behavior** — capture pipeline, status lifecycle,
  RCA/notes, 30-day purge. This brief only reads from and adds a visibility/comment layer alongside it.
- **Exposing any internal-only field to the partner** — investigation notes, `root_cause_summary`,
  `created_by`, raw instance descriptions, session linkage, internal `glitch_type` taxonomy, the literal
  internal `title`. Never (§6.4's whitelist is exhaustive).
- **Partner notifications** (email/SMS/push) when a bug is toggled visible or its status changes — not
  requested; the partner discovers changes by visiting the screen, same model as every other Configurator
  tab.
- **A persistent archive for *open/in-progress* bugs that are hidden before ever reaching Closed** —
  §6.3's sticky-history rule only ever applies once an issue reaches `resolved`/`wont_fix`; a bug hidden
  while still open/in-progress simply disappears (no partial or "was once shown" record for
  still-open bugs). Extending stickiness to non-Closed states was considered and rejected — it would
  reintroduce a hidden-bug-count signal for bugs Clio hasn't finished with yet, which is exactly the leak
  the original no-hidden-bug-count guarantee exists to prevent.
- **Self-serve partner bug-filing, external issue-tracker sync, AI-generated partner-facing summaries** —
  none were requested; explicitly excluded per the CEO brief.
- **Any sales-partner business mechanics** (commission, agreements, geography/language) — frozen,
  untouched, per both this brief and B2B-21.
- **Pixel-level visual polish** beyond what's specified here — structure/data/states are fixed by this
  spec; a `/design-review` pass follows once built, per the CEO/BA-vs-design-review division of labor in
  `CLAUDE.md`.

---

## 11. Open Questions

**None.** Every question the CEO brief posed to the BA is resolved above:

- **Q1 (aggregate-chart counting scope) — RESOLVED**, on its second pass. Arun's original one-line
  resolution (2026-07-18) — "only the bugs tagged for the partner should be considered for the display
  and charts" — answers the escalation's real question (partner never learns how many bugs Clio is
  hiding). This spec's first draft over-read that resolution as also requiring strict live-only scoping
  and was returned by CEO review for conflating two distinct questions. **Current resolution: the CEO
  brief's own originally-proposed Option (c) hybrid** — currently-visible bugs, plus ever-visible bugs
  now Closed, stay in the table and chart identically and permanently once closed; anything never
  disclosed, or hidden while still open/in-progress, is fully excluded (§6.3). Table and chart remain
  perfectly consistent with each other by construction (one shared query shape) — the no-hidden-bug-count
  guarantee Arun approved is fully preserved; only the "does closed history stay visible after toggle-off"
  question (which Arun was never actually asked) is now answered in the partner-confidence-preserving
  direction CEO review specified.
- **Q2 (issue-to-partner scoping model) — RESOLVED.** `glitch_issue_partner_visibility`, keyed
  `(issue_id, partner_account_id)`, exactly the CEO's own recommended shape (§6.1), with an eligibility
  guard tying it to actual attached `glitch_instances` (§6.4).
- **Q3 (status mapping, including `wont_fix`) — RESOLVED.** `open→Open`, `investigating→In Progress`,
  `resolved`/`wont_fix`→`Closed`, with rationale (§6.2).
- **Q4 (partner-visible "description") — RESOLVED.** A separate, operator-authored
  `partner_facing_description` field, required non-empty whenever `is_visible = true` (DB-enforced),
  never a passthrough of `glitch_issues.title` (§6.1, §6.2).
- **Q5 (ETA field shape) — RESOLVED.** Nullable `date`, optional, "TBD" empty state, editable by
  super-admin or the tagged sales-partner only (§6.1, §4.B).
- **Q6 (comments/evidence scope for v1) — RESOLVED.** Text-only for v1; file evidence explicitly deferred
  with rationale grounded in a direct codebase check finding no existing storage precedent (§10).
- **Q7 (field boundary enumeration) — RESOLVED.** Exhaustive whitelist in §6.4's partner-facing route
  definitions; exhaustive never-list in §10's second bullet.
- **Q8 (toggle eligibility guard) — RESOLVED.** Enforced at the route layer (`422
  partner_not_eligible`) against `glitch_instances` (§6.4), tested explicitly (§7 AT-3).
- **Q9 (auth binding) — RESOLVED.** Internal toggle routes consume B2B-21's `requireSuperAdmin()` /
  `requireInternalAdmin()` exactly as defined there; partner-facing routes use the existing, unrelated
  `requirePartnerAdmin()` — the two systems are explicitly distinguished so no one conflates them (§6.5).
  B2B-21 landing first remains a hard build-sequencing dependency (§12), not an open question in this
  spec's own content.
- **Q10 (nav placement) — RESOLVED.** A 4th tab in `ConfiguratorNavShell`, coordinated directly against
  `docs/specs/B2B-24-requirement-document.md`'s confirmed exclusion of glitch/bug data from its own
  Dashboard panel (§6.6) — not a guess about the sibling brief's outcome, a verified read of its actual
  spec text.

---

## 12. Dependencies

**Must be true before build:**
- **B2B-21 (Internal Admin Identity) must have landed in `main`** — `internal_admin_users`,
  `sales_partner_assignments`, `requireSuperAdmin()`, `requireInternalAdmin()` in `lib/internal-admin/auth.ts`,
  and `/dashboard/admin/glitches` gated by them (replacing today's bare `requireAuth()`/`currentUser()`
  check). Verified directly (2026-07-18): `lib/internal-admin/` does not exist yet in this codebase —
  B2B-21 is written (`docs/specs/B2B-21-requirement-document.md`, Status: CEO REVIEW) but not yet built.
  **This brief's development cannot start until that lands**, per the CEO brief's own hard-dependency
  metadata.
- B2B-17 (`glitch_issues`, `glitch_instances`, `glitch_issue_notes`, `lib/glitches/issue-status.ts`, the
  `/api/admin/glitches/**` route family) — Done, verified directly against current source (2026-07-18).
- `partner_accounts`, `partner_admin_users`, `lib/partner/auth.ts`'s `requirePartnerAdmin()` — Done,
  pre-existing, unrelated to B2B-21, verified directly.
- `app/dashboard/configurator/_shared.tsx`'s `ConfiguratorNavShell`, `app/dashboard/configurator/api/page.tsx`
  (the exact page-shape template this brief's new `known-bugs/page.tsx` mirrors) — Done, verified
  directly.
- `docs/specs/B2B-24-requirement-document.md` — Done (Status: CEO REVIEW at time of writing), confirms
  its own Dashboard panel excludes glitch/bug data — the coordination point this brief's nav placement
  relies on (§6.6).
- `update_updated_at_column()` Postgres trigger function — already defined, reused.

**Migration numbering note:** the highest existing migration at time of writing is `083` (B2B-19).
B2B-21's own spec claims `084`. This brief's migration should be numbered **`085`** (the next free number
after B2B-21's), created and merged only after B2B-21's `084` has actually landed — if B2B-21's
migration lands under a different actual number (renumbered during its own build), this brief's dev
agent must renumber to the true next-free slot at build time rather than hardcode `085` blindly.

**New files this brief creates:**
- `supabase/migrations/085_b2b22_partner_known_bugs.sql` — both new tables, indexes, RLS, CHECK
  constraints, composite FK (§6.1).
- `lib/glitches/partner-status.ts` — `mapToPartnerStatus`, `PARTNER_STATUS_LABEL` (§6.2).
- `app/api/admin/glitches/issues/[id]/partner-visibility/route.ts` (GET, PATCH).
- `app/api/admin/glitches/issues/[id]/partner-visibility/comments/route.ts` (GET, internal read-only).
- `app/api/partner/known-bugs/route.ts` (GET).
- `app/api/partner/known-bugs/summary/route.ts` (GET).
- `app/api/partner/known-bugs/[issueId]/comments/route.ts` (GET, POST).
- `app/dashboard/configurator/known-bugs/page.tsx` + `KnownBugsClient.tsx`.

**Modified files:**
- `app/dashboard/configurator/_shared.tsx` — widen `ConfiguratorNavShell`'s `active` union and
  `navItems` array by one entry (§6.6). No other change.
- `app/dashboard/admin/glitches/GlitchDashboardClient.tsx` — add the new "Partner visibility" collapsible
  section to the existing Issue Detail view (§4.B). No change to Panels 1/2/3's existing behavior.

**Explicitly not touched:** `glitch_issues`, `glitch_instances`, `glitch_issue_notes` (columns/behavior),
`lib/glitches/issue-status.ts`, `app/api/admin/glitches/route.ts`, `.../summary/route.ts`,
`.../issues/route.ts`, `.../issues/[id]/route.ts`, `.../attach`, `.../detach`, `.../notes` (all
pre-existing B2B-17 routes), `ConfiguratorSurface.tsx`'s left-nav, B2B-24's `DashboardPanel.tsx`,
`lib/partner/auth.ts`'s `requirePartnerAdmin` function body, `partner_admin_users`,
`app/api/webhooks/clerk-organization/route.ts`.

---

*End of Requirement Document B2B-22 v1.1 — all 12 sections filled, Section 11 empty. §6.3 (partner
table/chart scoping), its dependent acceptance tests, §4.A States P5/P7, and §9 edge case 10 revised per
CEO review round 1 (2026-07-18) to adopt the Option (c) hybrid — currently-visible bugs plus
ever-visible-now-Closed bugs stay in the partner's table/chart; never-disclosed or
hidden-while-still-open bugs remain fully excluded. Resubmitted for CEO review. Build blocked on B2B-21
landing in `main` (hard dependency, unchanged from the source brief).*
