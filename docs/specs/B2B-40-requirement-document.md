# Super-Admin Home Page + Login Routing Priority — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-27

---

## 0. Resolution of the CEO Brief's Design Questions and Open Nuance

The CEO brief (`.claude/agents/clio/feature-briefs/B2B-40-super-admin-home-page-and-login-routing-priority.md`)
flagged three Design Questions with recommended defaults, one further nuance about the `glitches` gate
asymmetry, and four numbered "Questions for BA." All are resolved below with concrete decisions. None
requires CEO re-review — every resolution either confirms the CEO's own recommended default as-is, or
fills a gap the brief explicitly left to the BA's judgment without expressing a preference.

**Design Question 1 — scope to `super_admin` only, confirmed.** Verified against
`lib/internal-admin/auth.ts:25-28` — `InternalAdminResult` is a discriminated union of exactly three
states: `role: 'super_admin'`, `role: 'internal_staff'` (narrower, partner-scoped), and `role: null`
(no access). The CEO's recommended default — scope both the routing-priority fix and the new landing
page to `role === 'super_admin'` only — matches Arun's own wording ("whenever i login") and the actual
role model exactly: `internal_staff` is confirmed to be a genuinely different, narrower role with no
natural home among five of the six super-admin-only sub-pages. **Confirmed as specified.** `internal_staff`
logins are untouched by this brief in every respect — router branches, `/dashboard/admin` access, and
`DashboardShell`'s nav all remain exactly as they behave today for that role.

**Design Question 2 — minimal nav hub, not a stats dashboard, confirmed.** Exact literal copy and
layout specified in full in §4 and §5 below, per the CEO's recommended default ("a heading... plus a
responsive grid or list of link cards... no metrics, no charts, no data-fetching beyond the six static
links"). Built to the fluid/tiered responsive standard from the start, per the standing responsive rule
— see §6.9 for why this spec uses this codebase's own already-verified-compliant fluid primitives
(`max-w mx-auto` + Tailwind responsive grid classes) rather than introducing a new `clamp()`-based
pattern with no precedent anywhere in the `/dashboard/admin/*` section.

**Design Question 3 — `/dashboard/channel-partner` and every other route stay directly reachable,
confirmed.** This brief touches only `app/dashboard/page.tsx` (the router) and adds one new page
(`app/dashboard/admin/page.tsx`) plus one additive `DashboardShell` nav entry (§6.2). It does not touch
`middleware.ts`, `/dashboard/channel-partner`'s own page code, or any of the six existing admin
sub-pages' own gates. Direct URL navigation to any existing route is unaffected — only the router's
*default* post-login destination for a `super_admin` changes. **Confirmed as specified, nothing further
to decide.**

**The `glitches` gate asymmetry — resolved, not left ambiguous.** Five of six sub-pages gate on
`requireSuperAdmin()`; `glitches` gates on the broader `requireInternalAdmin()` (which also admits
scoped `internal_staff`). Because the new `/dashboard/admin` hub itself gates on `requireSuperAdmin()`
(per Design Question 1), **every visitor who reaches the hub is, by construction, already a
`super_admin`.** `requireInternalAdmin()`'s logic (`lib/internal-admin/auth.ts:160-175`) calls
`resolveInternalAdmin()` and only narrows further for an `internal_staff` result with an out-of-scope
`partnerAccountId` — a `super_admin` result always passes through unmodified. **Concrete resulting
behavior: a `super_admin` who reaches the hub always passes `glitches`' own `requireInternalAdmin()`
gate too, with zero exceptions.** The asymmetry is real but inert for every user who can ever see the
hub — it only matters for `internal_staff`, who cannot reach the hub at all under this brief's scope
decision. **Decision: the hub links to all six sub-pages unconditionally, with no per-link gate
awareness of the asymmetry** — exactly the CEO brief's own "likely fine" framing, confirmed by tracing
the actual gate logic rather than assumed.

**Questions for BA, items 1-2** — resolved via the exact code in §6.1 and §6.3 below.

**Question for BA, item 3 — does `DashboardShell` need a new nav entry for the home page, or is the
home page itself effectively the nav?** Both, in a specific, minimal-diff way — resolved concretely,
not left open:
- The new `/dashboard/admin` page's own **main content area** is the primary nav surface Arun asked
  for ("i should see all the tabs or links and this is my dashboard, from this page i should be able
  to navigate") — the 6-card grid in §4/§5 fully satisfies this on its own, on every viewport including
  mobile (where `DashboardShell`'s sidebar is hidden entirely).
- Separately, **one new entry is appended to the end of `DashboardShell.tsx`'s existing `NAV_ITEMS`
  array**, linking back to `/dashboard/admin`, so a super-admin who has clicked into a sub-page has a
  way back to the hub without using the browser's back button. This follows the array's own established,
  self-documented growth convention (its comments already record B2B-21 adding `Team` and B2B-28 adding
  `Partner invites`/`Sales-partners` the same way) — it is not a new pattern, it is the codebase's
  existing pattern applied once more.
- **Appended, not prepended, and this ordering choice is deliberate and load-bearing:**
  `MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5)` (`DashboardShell.tsx:36`) currently yields `[Clients,
  Templates, Glitches, Team, Partner invites]` for the mobile bottom bar, already excluding
  `Sales-partners` (today's 6th item) from that bar — an existing, pre-B2B-40 fact, not something this
  brief changes. Appending the new `Admin Home` entry as the 7th item keeps that slice **byte-identical**
  — zero visible or behavioral change to any of the six existing sub-pages' mobile bottom nav. Prepending
  it instead would have bumped a second existing item (`Partner invites`) out of the mobile bar, a real,
  avoidable regression to existing behavior — ruled out for that reason. On desktop, the sidebar has no
  such constraint (all 7 items render), so the only visible cross-page effect of this brief is one
  additional link appearing at the bottom of the desktop sidebar list on the six existing sub-pages —
  consistent with, not a departure from, the array's own established per-feature growth history.

---

## 1. Purpose

Every login from a super-admin (currently only Arun, `hello.arunprakash83@gmail.com`) lands on the
wrong screen. The smart router at `app/dashboard/page.tsx` only ever checks `channel_partner`
membership; it has zero awareness of `internal_admin_users`/super-admin status. Because Arun's own
Clerk account also holds a `channel_partner` membership in a leftover test account ("HelloWorld"), he
is redirected to that reseller's own dashboard on every single login — never anywhere admin-relevant —
and there is also no real admin home page to land on even if the router were fixed: `/dashboard/admin`
404s today, and the only way to reach any of the six admin sub-pages is to already know its exact URL.

Without this feature, Arun's daily login continues to land him somewhere irrelevant to his actual job
every time, and even after manually navigating away from it, he has no single screen that shows him
everything he can do as a super-admin — he has to remember six separate URLs.

## 2. User Story

As a **super-admin** (Clio's own internal owner/operator, e.g. Arun),
I want my login to take me directly to a real admin home screen, not a reseller's dashboard I happen
to also have a stale membership in,
so that every login lands me somewhere immediately useful to my actual role.

As a **super-admin** on the new admin home screen,
I want to see every admin tool I have access to, each with a one-line description of what it does,
so that I can navigate to any of them without memorizing URLs.

As a **reseller or any other existing user** (channel-partner admin, direct-partner admin,
zero-membership user),
I want my own login destination to be completely unaffected by this change,
so that nothing breaks for me because of a fix that has nothing to do with my account.

## 3. Trigger / Entry Point

- **Router fix**: `app/dashboard/page.tsx` — no URL change, no new route. Triggered the same way it
  is today: any authenticated visit to `/dashboard` (including the implicit landing destination after
  Clerk sign-in, per `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`/equivalent app config, unchanged by this
  brief).
- **New page**: `GET /dashboard/admin` — a brand-new route (the directory/file does not exist today;
  a visit currently 404s). Requires an authenticated Clerk session **and** a `super_admin` row in
  `internal_admin_users` (via `requireSuperAdmin()`); any other authenticated visitor gets `notFound()`
  (404), identical to every other admin sub-page's own convention. Unauthenticated visitors are
  redirected to `/sign-in`, also identical to every sub-page's convention.

## 4. Screen / Flow Description

### 4.A The router — no visible screen, pure redirect logic

Not a screen a user sees; described fully in §6.1's exact code. Behavior summary:
1. No Clerk session → redirect to `/sign-in` (unchanged).
2. Clerk session resolves to `role: 'super_admin'` (via `resolveInternalAdmin()`) → redirect to
   `/dashboard/admin`. **New, and checked first**, before any membership lookup.
3. Otherwise, `channel_partner` membership exists → redirect to `/dashboard/channel-partner`
   (unchanged, exact same check as today).
4. Otherwise → redirect to `/dashboard/configurator` (unchanged).

### 4.B `/dashboard/admin` — the new admin home page

One single state — no loading state (no client-side data fetch exists; the six links and their
descriptions are static, known at render time), no error state visible to the user beyond the existing
`notFound()`/`redirect('/sign-in')` gate behavior shared with every sub-page.

Rendered inside the existing `DashboardShell` (same sidebar/mobile-top-bar/mobile-bottom-nav chrome as
every other admin sub-page), with `activeNav="/dashboard/admin"` so the new sidebar entry (§6.2)
highlights as active while on this page.

Main content area, top to bottom:
- Heading text, exact literal copy: **"Admin"**
- Subheading text, exact literal copy, immediately below the heading: **"Jump into any part of
  Clio's internal admin tools."**
- A responsive grid of exactly 6 link cards, one per existing admin sub-page, in this exact order
  (matching `DashboardShell`'s own `NAV_ITEMS` order, so the grid and the sidebar always agree):

  | # | Card title (exact literal copy) | Card description (exact literal copy) | Links to |
  |---|---|---|---|
  | 1 | Clients | Cross-partner billing and revenue detail. | `/dashboard/admin/clients` |
  | 2 | Templates | Clio's global content-approval queue. | `/dashboard/admin/templates` |
  | 3 | Glitches | Internal bug and issue tracker. | `/dashboard/admin/glitches` |
  | 4 | Team | Manage super-admins and sales-partner access. | `/dashboard/admin/team` |
  | 5 | Partner invites | Manage partner invite links and their status. | `/dashboard/admin/partner-invites` |
  | 6 | Sales-partners | Reseller roster, usage, and demo access. | `/dashboard/admin/sales-partners` |

Each card: the entire card is a clickable `Link` (not just a title or a separate "Open" button) to its
target route. Each card shows its `lucide-react` icon (reusing the exact same icon `DashboardShell.tsx`
already uses for that same destination — `Building2` / `LayoutTemplate` / `Bug` / `Shield` / `Link2` /
`Users`, respectively — for visual consistency between the grid and the sidebar), the title, and the
one-line description. No metrics, counts, avatars, or any other data-driven content on any card — text
and an icon only, per Design Question 2.

## 5. Visual Examples

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Admin                                                                    │
│  Jump into any part of Clio's internal admin tools.                      │
│                                                                            │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐    │
│  │ [Building2] Clients│  │ [LayoutTemplate]   │  │ [Bug] Glitches     │    │
│  │ Cross-partner       │  │ Templates          │  │ Internal bug and   │    │
│  │ billing and revenue │  │ Clio's global       │  │ issue tracker.     │    │
│  │ detail.              │  │ content-approval    │  │                     │    │
│  │                      │  │ queue.              │  │                     │    │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘    │
│                                                                            │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐    │
│  │ [Shield] Team       │  │ [Link2] Partner    │  │ [Users] Sales-     │    │
│  │ Manage super-admins │  │ invites             │  │ partners            │    │
│  │ and sales-partner   │  │ Manage partner      │  │ Reseller roster,    │    │
│  │ access.              │  │ invite links and    │  │ usage, and demo     │    │
│  │                      │  │ their status.        │  │ access.              │    │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```
Desktop (`lg:` and above) — 3 columns, as drawn above.

```
┌───────────────────────────────┐
│  Admin                        │
│  Jump into any part of        │
│  Clio's internal admin tools. │
│                                │
│  ┌─────────────────────────┐  │
│  │ [Building2] Clients      │  │
│  │ Cross-partner billing    │  │
│  │ and revenue detail.      │  │
│  └─────────────────────────┘  │
│  ┌─────────────────────────┐  │
│  │ [LayoutTemplate]         │  │
│  │ Templates                │  │
│  │ Clio's global content-   │  │
│  │ approval queue.          │  │
│  └─────────────────────────┘  │
│  ... (remaining 4 cards, one  │
│  per row, same shape) ...     │
└───────────────────────────────┘
```
Mobile (below `sm:`) — 1 column, full-width stacked cards, `DashboardShell`'s mobile top bar above and
mobile bottom nav below (both unchanged chrome, per §6.2).

Tablet (`sm:` to below `lg:`) — 2 columns, same card shape, per the grid classes in §6.3.

## 6. Data Requirements

- **Reads**: `internal_admin_users` (via `resolveInternalAdmin()`/`requireSuperAdmin()`, existing
  queries, unchanged), `partner_admin_users`/`partner_accounts` (via
  `getPartnerAccountsForClerkUser()`, existing query, unchanged, and only reached when the new
  super-admin check does not already redirect). No new tables, no new columns, no new queries.
- **Writes**: none. This brief introduces zero new writes to any table.
- **APIs called**: none beyond the existing Clerk session resolution already used by every page in
  this app. No new API routes.
- **localStorage/sessionStorage**: none.

## 6.1 Exact code — `app/dashboard/page.tsx` (modified)

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { resolveInternalAdmin } from '@/lib/internal-admin/auth'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.9) — smart router.
 * B2B-40 (docs/specs/B2B-40-requirement-document.md §6.1) — a super-admin
 * priority check is inserted BEFORE the existing channel_partner membership
 * check. Uses resolveInternalAdmin() (NOT requireSuperAdmin() — that helper
 * would 403 every non-super-admin session, which would break this router
 * for every ordinary partner/reseller login). admin.error is intentionally
 * never inspected here: for a non-super-admin session, resolveInternalAdmin()
 * either returns role: 'internal_staff' or role: null with a populated
 * `error` field, and both cases simply fall through to the two existing
 * branches below, completely unchanged from pre-B2B-40 behavior.
 */
export default async function DashboardPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const admin = await resolveInternalAdmin()
  if (admin.role === 'super_admin') {
    redirect('/dashboard/admin')
  }

  const accounts = await getPartnerAccountsForClerkUser(userId)
  if (accounts.some((a) => a.account_kind === 'channel_partner')) {
    redirect('/dashboard/channel-partner')
  }
  redirect('/dashboard/configurator')
}
```

## 6.2 Exact code — `components/dashboard/DashboardShell.tsx` (modified — additive only)

```tsx
import { UserButton } from '@clerk/nextjs'
import { Building2, LayoutTemplate, Bug, Shield, Link2, Users, Home } from 'lucide-react'
import Link from 'next/link'

// ...(ShellUser interface, DashboardShellProps interface unchanged)...

const NAV_ITEMS = [
  { href: '/dashboard/admin/clients', icon: Building2, label: 'Clients' },
  { href: '/dashboard/admin/templates', icon: LayoutTemplate, label: 'Templates' },
  { href: '/dashboard/admin/glitches', icon: Bug, label: 'Glitches' },
  { href: '/dashboard/admin/team', icon: Shield, label: 'Team' },
  { href: '/dashboard/admin/partner-invites', icon: Link2, label: 'Partner invites' },
  { href: '/dashboard/admin/sales-partners', icon: Users, label: 'Sales-partners' },
  // B2B-21 (docs/specs/B2B-40-requirement-document.md §0/§6.2) — Admin Home
  // is appended LAST, not prepended: MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5)
  // below must stay byte-identical to its pre-B2B-40 value ([Clients,
  // Templates, Glitches, Team, Partner invites]) so none of the six existing
  // sub-pages' mobile bottom nav changes. This entry is desktop-sidebar-only
  // in practice (it falls outside the slice(0, 5) window).
  { href: '/dashboard/admin', icon: Home, label: 'Admin Home' },
]

// Primary nav items shown in mobile bottom bar (most important 5)
const MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5)

// ...(rest of the component body is completely unchanged — no other edits)...
```

## 6.3 Exact code — `app/dashboard/admin/page.tsx` (new file)

```tsx
import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Building2, LayoutTemplate, Bug, Shield, Link2, Users, LucideIcon } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'

/**
 * B2B-40 (docs/specs/B2B-40-requirement-document.md §4.B) — super-admin
 * home/navigation hub. Same currentUser()-then-DashboardShell-then-content
 * shape as every other admin sub-page (e.g.
 * app/dashboard/admin/team/page.tsx), substituting requireSuperAdmin() +
 * notFound() on failure — identical gate convention to every sibling page,
 * not a new pattern. No client component: the content below is 100% static
 * (no data fetch, no interactivity), so it renders directly as part of this
 * server component per §4.B / Design Question 2 (link grid only, no
 * metrics/charts/live data).
 */

interface AdminLinkCard {
  href: string
  icon: LucideIcon
  title: string
  description: string
}

const ADMIN_LINKS: AdminLinkCard[] = [
  { href: '/dashboard/admin/clients', icon: Building2, title: 'Clients', description: 'Cross-partner billing and revenue detail.' },
  { href: '/dashboard/admin/templates', icon: LayoutTemplate, title: 'Templates', description: "Clio's global content-approval queue." },
  { href: '/dashboard/admin/glitches', icon: Bug, title: 'Glitches', description: 'Internal bug and issue tracker.' },
  { href: '/dashboard/admin/team', icon: Shield, title: 'Team', description: 'Manage super-admins and sales-partner access.' },
  { href: '/dashboard/admin/partner-invites', icon: Link2, title: 'Partner invites', description: 'Manage partner invite links and their status.' },
  { href: '/dashboard/admin/sales-partners', icon: Users, title: 'Sales-partners', description: 'Reseller roster, usage, and demo access.' },
]

export default async function AdminHomePage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

  return (
    <DashboardShell
      user={{ email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/admin"
    >
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-white">Admin</h1>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Jump into any part of Clio&apos;s internal admin tools.
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ADMIN_LINKS.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col gap-2 rounded-xl border border-[#222222] bg-[#111111] p-5 transition-colors hover:border-[#333333] hover:bg-[#1A1A1A]"
            >
              <div className="flex items-center gap-2 text-white">
                <Icon size={18} />
                <span className="font-semibold">{title}</span>
              </div>
              <p className="text-sm text-[#94A3B8]">{description}</p>
            </Link>
          ))}
        </div>
      </div>
    </DashboardShell>
  )
}
```

## 6.9 Responsive approach — why Tailwind fluid primitives, not a new `clamp()` pattern

`BACKLOG.md`'s active responsive-tracking table already records `/dashboard/admin/sales-partners`
(list) and `.../[id]` (detail) as **verified compliant** using `max-w-6xl mx-auto`/`max-w-4xl mx-auto`
plus Tailwind responsive classes — no `clamp()` anywhere in that section of the codebase. This spec
mirrors that exact, already-verified-compliant convention (`max-w-6xl mx-auto` container, `grid-cols-1
sm:grid-cols-2 lg:grid-cols-3` for the card grid) rather than introducing a new, unprecedented
`clamp()`-based layout mechanism into the one section of the app that has none. This satisfies the
standing rule's actual requirement — no hardcoded pixel-width caps, fluid scaling across breakpoints —
without inventing a second competing convention inside `/dashboard/admin/*`. No fixed `px` width exists
anywhere in the new page's markup.

## 6.10 `BACKLOG.md` tracking-table update (new row, added as part of this change)

Per the standing rule's own instruction to update the tracking table "the instant a screen's status
changes," add this row to the table in `BACKLOG.md` (§ "🎨 STANDING STORY — Responsive/mobile-friendly
by default"), immediately after the existing `/dashboard/admin/sales-partners/[id]` row:

```
| `/dashboard/admin` (new super-admin home page) | Compliant — built responsive from the start per B2B-40. Uses the same fluid primitives already verified compliant on `/dashboard/admin/sales-partners` (`max-w-6xl mx-auto`, no hardcoded pixel-width caps); card grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, stacking to a single column on mobile with no horizontal scroll or clipped content. | B2B-40 |
```

## 7. Success Criteria (Acceptance Tests)

✓ AT-1: Given a Clerk session that resolves to `role: 'super_admin'` (via `resolveInternalAdmin()`)
and has **no** `channel_partner` membership, when the user visits `/dashboard`, then they are
redirected to `/dashboard/admin`.

✓ AT-2: Given a Clerk session that resolves to `role: 'super_admin'` **and also** has a
`channel_partner` membership (Arun's exact real-world case), when the user visits `/dashboard`, then
they are redirected to `/dashboard/admin` — **not** `/dashboard/channel-partner` — because the
super-admin check runs and redirects before the membership check is ever reached.

✓ AT-3 (regression): Given a Clerk session with a `channel_partner` membership and **no** `super_admin`
row (`resolveInternalAdmin()` returns `role: 'internal_staff'` or `role: null`), when the user visits
`/dashboard`, then they are redirected to `/dashboard/channel-partner`, exactly as before this brief.

✓ AT-4 (regression): Given a Clerk session with zero partner-account memberships and no `super_admin`
row, when the user visits `/dashboard`, then they are redirected to `/dashboard/configurator`, exactly
as before this brief.

✓ AT-5: Given a `super_admin` session that also has a `channel_partner` membership, when they manually
navigate the browser directly to `/dashboard/channel-partner` (not via the `/dashboard` router), then
the page loads normally and is fully functional — direct URL access to that route is completely
unaffected by this brief.

✓ AT-6: Given a `super_admin` session, when they visit `/dashboard/admin`, then the page renders all
six link cards with the exact titles, descriptions, and target `href`s specified in §4.B's table, and
`DashboardShell`'s sidebar (desktop) shows the new "Admin Home" entry highlighted as active.

✓ AT-7: Given a non-super-admin session (any authenticated user without a `super_admin`
`internal_admin_users` row — reseller, direct-partner admin, or zero-membership user), when they visit
`/dashboard/admin` directly by URL, then they receive a 404 (`notFound()`), identical to the existing
behavior of every other admin sub-page (e.g. `/dashboard/admin/team`) for the same user.

✓ AT-8: Given no Clerk session at all, when visiting either `/dashboard` or `/dashboard/admin`, then
the user is redirected to `/sign-in`, exactly as every other protected route in this app behaves today.

✓ AT-9: Given a `super_admin` session, when they click any of the six link cards on `/dashboard/admin`,
then they land on that exact sub-page and it renders normally (all six sub-pages' own
`requireSuperAdmin()` gates pass, since the visitor is by definition a super-admin per AT-6's
precondition).

✓ AT-10: Given the `DashboardShell` sidebar rendered on any of the six pre-existing admin sub-pages
(e.g. `/dashboard/admin/team`), then the mobile bottom nav bar (`MOBILE_NAV_ITEMS`) shows exactly
`[Clients, Templates, Glitches, Team, Partner invites]`, in that order — byte-identical to its
pre-B2B-40 value, confirming the new "Admin Home" entry does not appear in or alter the mobile bottom
bar on any existing page.

## 8. Error States

- **`resolveInternalAdmin()` throws or its underlying Supabase query errors** inside the router: not
  separately handled by this brief — `resolveInternalAdmin()` itself already returns a safe `role: null`
  result on any resolution failure (per `lib/internal-admin/auth.ts`'s own existing error handling); the
  router's `if (admin.role === 'super_admin')` check simply evaluates false and falls through to the
  existing membership check, with no new failure mode introduced.
- **`requireSuperAdmin()` returns an error on `/dashboard/admin`** (no session, or a session with no
  matching/active `internal_admin_users` row): handled exactly as every sibling admin page — `notFound()`
  for an authenticated non-admin, `redirect('/sign-in')` for no session at all (checked first, before
  the `requireSuperAdmin()` call, matching `TeamPage`'s own ordering).
- **A link on the grid points to a sub-page that itself errors or is slow to load**: out of scope for
  this brief — each sub-page owns its own loading/error states; this page only renders static links to
  them.
- **No network/API calls exist on this page** beyond the existing auth resolution already used
  everywhere in this app, so there is no "slow API" loading state to design for this specific screen.

## 9. Edge Cases

- **A `super_admin` row exists but is `status: 'deactivated'`**: `resolveInternalAdmin()`'s existing
  query already filters `.neq('status', 'deactivated')`, so a deactivated super-admin resolves to
  `role: null` and falls through to the existing membership/configurator branches exactly like any other
  non-admin — no special handling needed in this brief, inherited for free from the existing helper.
- **A `super_admin` row is `status: 'pending'` with `clerk_user_id` already bound**: per
  `lib/internal-admin/auth.ts`'s own doc comment (§6.2 point 4), a `'pending'` row with a bound
  `clerk_user_id` is treated as active by `resolveInternalAdmin()` already — this brief inherits that
  behavior unchanged, no new logic needed.
- **A brand-new super-admin whose Clerk account has never visited `/dashboard` before**: the lazy-bind
  path inside `resolveInternalAdmin()` (matching by verified primary email) already runs on first visit,
  per its existing implementation — the router calls the same function every other admin surface uses,
  so this "just works" without any B2B-40-specific handling.
- **Mobile viewport on `/dashboard/admin`**: single-column card stack (§5), `DashboardShell`'s mobile
  top bar above and mobile bottom nav below, unchanged chrome — the new "Admin Home" nav entry does not
  appear in the mobile bottom bar (§6.2/AT-10), so on mobile the 6-card grid on the page itself is the
  only way to navigate to a sub-page (in addition to typing a URL directly) — this is expected, not a
  gap, since the page's own grid already fully serves that purpose per Design Question 3's own framing
  of the home page as "effectively that nav."
- **A super-admin lands on `/dashboard/admin` and clicks browser back**: standard browser history
  behavior, returns to whatever preceded `/dashboard` in their history (e.g. `/sign-in`, external
  referrer) — no custom back-navigation handling exists or is needed, matching every other page in this
  app.
- **Slow network on the initial `/dashboard` → `/dashboard/admin` redirect chain**: both are
  server-side redirects with no client-rendered loading state in between (standard Next.js App Router
  `redirect()` behavior, unchanged from the existing B2B-26 router) — no new loading UI is introduced or
  required by this brief.

## 10. Out of Scope

- No changes to `/dashboard/channel-partner`, the `channel_partner` account kind, or any reseller-facing
  page, flow, or account data.
- No changes to `getPartnerAccountsForClerkUser()` or `lib/partner/admin-accounts.ts`.
- No changes to any of the six existing admin sub-pages' own files, gates, or content — only
  `DashboardShell.tsx`'s shared nav array gets one additive entry (§6.2); no sub-page's own `page.tsx`
  or `*Client.tsx` file is touched.
- No metrics, charts, recent-activity feed, or any live/computed data on the new `/dashboard/admin`
  page — links and one-line descriptions only, per Design Question 2. A richer version is explicitly
  deferred to a possible future brief, not built here.
- No "view as reseller" link or any other new navigation affordance beyond the 6-card grid and the one
  `DashboardShell` sidebar entry described above.
- No extension of this brief's routing-priority fix or `/dashboard/admin` access to `internal_staff`
  logins, per Design Question 1's confirmed scope.
- No changes to `middleware.ts` or any route-level auth gating beyond what `requireSuperAdmin()` already
  provides on the new page.
- No changes to any of the six sub-pages' own responsive status in `BACKLOG.md`'s tracking table beyond
  adding the one new row for `/dashboard/admin` itself (§6.10) — this brief does not obligate auditing
  the five untouched sub-pages currently marked "Not yet verified."

## 11. Open Questions

None. Every design question, the `glitches`-gate nuance, and all four "Questions for BA" items from the
CEO brief are resolved above with concrete decisions and exact code.

## 12. Dependencies

- **`lib/internal-admin/auth.ts` (B2B-21)** — already built, unmodified by this brief. This feature
  depends on `resolveInternalAdmin()` and `requireSuperAdmin()` exactly as they exist today; no changes
  to that file are needed or made.
- **`components/dashboard/DashboardShell.tsx`** — one additive array entry only (§6.2); no other part
  of the component changes.
- **No database migration** — this brief introduces no new tables, columns, or RPCs.
- **No new environment variables, no new approved-library additions** — uses only `@clerk/nextjs`,
  `next/navigation`, `next/link`, and `lucide-react`, all already approved and already in use throughout
  this exact part of the codebase.

## 13. Test Plan

No existing test file covers `app/dashboard/page.tsx`'s router logic today (confirmed — no
`dashboard`-router-named test exists in `tests/unit/` or `tests/integration/` at spec-writing time), so
this brief adds the first one, following this codebase's own established Vitest convention for testing
server-side auth/routing logic by mocking `@clerk/nextjs/server` and the relevant lib module directly
(same pattern as `tests/unit/b2b28-security-orthogonality-and-naming.test.ts`, which mocks `auth` from
`@clerk/nextjs/server` and `@/lib/supabase` to drive `requirePartnerAdmin()` through its branches).

**New file: `tests/unit/b2b40-admin-routing.test.ts`**

Structure:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClerkAuth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockClerkAuth(),
  currentUser: vi.fn(),
}))

const mockResolveInternalAdmin = vi.fn()
vi.mock('@/lib/internal-admin/auth', () => ({
  resolveInternalAdmin: () => mockResolveInternalAdmin(),
  requireSuperAdmin: () => mockResolveInternalAdmin(), // page-level test doubles this separately, see below
}))

const mockGetPartnerAccountsForClerkUser = vi.fn()
vi.mock('@/lib/partner/admin-accounts', () => ({
  getPartnerAccountsForClerkUser: (userId: string) => mockGetPartnerAccountsForClerkUser(userId),
}))

// next/navigation's redirect() throws in the real Next.js runtime — mock it to
// throw a distinguishable sentinel so the test can assert which path fired
// without needing a full Next.js server render.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) },
  notFound: () => { throw new Error('NOT_FOUND') },
}))

describe('B2B-40 — app/dashboard/page.tsx router', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('AT-1/AT-2: super_admin (with or without channel_partner membership) redirects to /dashboard/admin', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user_super' })
    mockResolveInternalAdmin.mockResolvedValue({ role: 'super_admin', error: null })
    mockGetPartnerAccountsForClerkUser.mockResolvedValue([{ account_kind: 'channel_partner' }])
    const { default: DashboardPage } = await import('@/app/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/dashboard/admin')
    expect(mockGetPartnerAccountsForClerkUser).not.toHaveBeenCalled() // short-circuits before membership check
  })

  it('AT-3: channel_partner membership, no super_admin, redirects to /dashboard/channel-partner unchanged', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user_reseller' })
    mockResolveInternalAdmin.mockResolvedValue({ role: null, error: {} })
    mockGetPartnerAccountsForClerkUser.mockResolvedValue([{ account_kind: 'channel_partner' }])
    const { default: DashboardPage } = await import('@/app/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/dashboard/channel-partner')
  })

  it('AT-4: zero memberships, no super_admin, redirects to /dashboard/configurator unchanged', async () => {
    mockClerkAuth.mockReturnValue({ userId: 'user_plain' })
    mockResolveInternalAdmin.mockResolvedValue({ role: null, error: {} })
    mockGetPartnerAccountsForClerkUser.mockResolvedValue([])
    const { default: DashboardPage } = await import('@/app/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/dashboard/configurator')
  })

  it('AT-8: no Clerk session redirects to /sign-in before any lookup', async () => {
    mockClerkAuth.mockReturnValue({ userId: null })
    const { default: DashboardPage } = await import('@/app/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/sign-in')
    expect(mockResolveInternalAdmin).not.toHaveBeenCalled()
  })
})
```

A second `describe` block in the same file (or a sibling `b2b40-admin-home-page.test.ts`, developer's
call — either satisfies this spec) covers `app/dashboard/admin/page.tsx` directly, mocking
`requireSuperAdmin()`/`currentUser()` the same way, asserting: (AT-6) a `super_admin` result renders
without throwing and the six `ADMIN_LINKS` entries' `href`/`title` values match §4.B's table exactly
(assert on the exported `ADMIN_LINKS` array directly rather than full DOM rendering, consistent with
this being a server component with no client-testable interactivity); (AT-7) a `requireSuperAdmin()`
result with a populated `error` throws `'NOT_FOUND'`; (AT-8) no `currentUser()` result throws
`'REDIRECT:/sign-in'` before `requireSuperAdmin()` is ever called.

**AT-5, AT-9, AT-10** are better suited to a lightweight Playwright E2E check than a unit test (real
browser navigation and real `DashboardShell` render), added to `tests/e2e/` following this codebase's
existing Playwright convention (`tests/e2e/.auth` session fixtures) — not written out line-by-line here
since no comparable existing E2E file was found to mirror the exact fixture setup; the developer should
follow whatever fixture pattern the most recent admin-page E2E test in that directory uses, or flag to
the BA if no such precedent exists yet so a minimal one can be specified.

All new/modified unit tests must pass via the project's existing `npm run test` (`vitest run`, per
`package.json`) before this feature is considered done, per the Final Integration Checklist in this
project's `CLAUDE.md`.
