# Feature Brief: B2B-40 — Super-Admin Home Page + Login Routing Priority

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 — Arun's own daily login currently lands him on the wrong dashboard every time; not a
data-foundation blocker for other briefs, but a real daily-use annoyance surfaced live tonight in the
same session as B2B-38/B2B-39
Date: 2026-07-27

## What Arun Said

Relayed via the Orchestrator from Arun's own direct instruction tonight, transcribed verbatim:

"i dont want the channel-partner entity. whenever i login it should take to dashboard/admin. in this
screen i should see all the tabs or links and this is my dashboard. from this page i should be able to
navigate."

Two bundled asks, both in scope for this one brief:
1. Fix where a super-admin login lands by default.
2. Build a real `/dashboard/admin` home/landing page — a navigation hub linking to every existing
   admin sub-page — since none exists today.

## The Problem Being Solved

Verified against live code before writing this brief, not assumed:

- `app/dashboard/page.tsx` is a "smart router" built for B2B-26 (`docs/specs/B2B-26-requirement-document.md`
  §6.9). Its entire current logic, confirmed by direct read:
  ```
  const { userId } = auth()
  if (!userId) redirect('/sign-in')
  const accounts = await getPartnerAccountsForClerkUser(userId)
  if (accounts.some((a) => a.account_kind === 'channel_partner')) {
    redirect('/dashboard/channel-partner')
  }
  redirect('/dashboard/configurator')
  ```
  It calls `getPartnerAccountsForClerkUser()` (`lib/partner/admin-accounts.ts`) — a `partner_admin_users`
  membership lookup only. It has zero awareness of `internal_admin_users` / super-admin status at all
  (that's the B2B-21 identity layer, `lib/internal-admin/auth.ts`) — not "checks it and loses," it
  literally never queries it.
- Arun's own Clerk login (hello.arunprakash83@gmail.com) resolves to BOTH: a `super_admin` row in
  `internal_admin_users`, AND a `partner_admin_users` membership in a `channel_partner`-kind "HelloWorld"
  test account (leftover from earlier pivot testing). Because the router only ever checks the
  reseller-membership branch, he lands on `/dashboard/channel-partner` — HelloWorld's own reseller
  dashboard — every single login, never anywhere admin-relevant.
- `lib/internal-admin/auth.ts` (B2B-21) is the correct, already-built identity layer to resolve
  super-admin status. Confirmed exact exports and signatures the BA/dev should call from the router:
  - `resolveInternalAdmin(): Promise<InternalAdminResult>` — resolves the current Clerk session; returns
    a discriminated union: `{ role: 'super_admin', ... }` | `{ role: 'internal_staff', scopedPartnerAccountIds: string[], ... }` |
    `{ role: null, error: NextResponse }` (401 no session / 403 no matching row).
  - `requireSuperAdmin(): Promise<InternalAdminResult>` — calls `resolveInternalAdmin()`, then
    additionally 403s an `internal_staff` result down to `role: null` (i.e., only `super_admin` passes
    through with a non-null role).
  - Both are plain async functions with no request/route params required for the router's use case —
    they read the Clerk session internally via `auth()`/`currentUser()`. Suitable to call directly from
    `app/dashboard/page.tsx`'s server component, same pattern already used by every admin sub-page
    (e.g. `app/dashboard/admin/team/page.tsx`, `app/dashboard/admin/clients/page.tsx`).
  - Note for the BA: unlike the sub-pages (which call `requireSuperAdmin()` and `notFound()` on failure,
    because they assume you already know you belong there), the *router* must not error/404 for a
    non-admin — it must fall through silently to the existing reseller/configurator branches. Calling
    `resolveInternalAdmin()` (not `requireSuperAdmin()`) and checking `result.role === 'super_admin'`
    before any redirect decision, ignoring `result.error` entirely for this call site, is the shape that
    achieves that — BA should confirm/specify this precisely so the dev doesn't accidentally wire in a
    hard 401/403 for ordinary partner/reseller logins.
- `/dashboard/admin` has **no index/landing page today** — `app/dashboard/admin/page.tsx` does not
  exist (confirmed via direct directory listing; a plain visit to `/dashboard/admin` 404s). The only
  reachable admin surfaces are individual sub-pages a super-admin must already know the URL for.
  Confirmed the real, current, complete list by listing the directory (not assumed from memory):

  | Route | Page component | Access gate (confirmed by reading each file) | What it is |
  |---|---|---|---|
  | `/dashboard/admin/clients` | `PartnerBillingPage` | `requireSuperAdmin()` | Cross-partner billing/revenue detail |
  | `/dashboard/admin/glitches` | `GlitchDashboardPage` | `requireInternalAdmin()` (super_admin **and** scoped internal_staff) | Internal glitch/bug tracker (B2B-09/B2B-17) |
  | `/dashboard/admin/partner-invites` | `PartnerInvitesPage` | `requireSuperAdmin()` | Partner invite management (B2B-28) |
  | `/dashboard/admin/sales-partners` | `SalesPartnersPage` (+ `[id]` detail route) | `requireSuperAdmin()` | Sales-partner/reseller roster (B2B-28), per-partner detail+usage |
  | `/dashboard/admin/team` | `TeamPage` | `requireSuperAdmin()` | Manage super-admins, invite/manage sales-partners (B2B-21) |
  | `/dashboard/admin/templates` | `TemplateLibraryPage` (+ `[templateName]/progress` sub-route) | `requireSuperAdmin()` | Clio's own global content-approval queue (B2B-21) — no `partner_account_id`, not partner-scoped |

  Flagging one real nuance for the BA to resolve, not glossing over it: five of these six sub-pages gate
  on `requireSuperAdmin()` (super-admin only), but `glitches` gates on the broader `requireInternalAdmin()`
  (super-admin **or** scoped internal_staff). Since the new home page is a nav hub, not a re-implementation
  of each page's own gate, this doesn't change any sub-page's own access control either way — but it's a
  relevant fact if the BA wants the home page itself to also be reachable by internal_staff (see Question
  1 below).

## What Success Looks Like

1. **Routing priority fix, scoped generally (not a one-off for Arun's email):** when a Clerk login
   resolves to `role: 'super_admin'` (via `resolveInternalAdmin()`), the smart router sends them to
   `/dashboard/admin` — checked and applied **before** the existing `channel_partner` membership check,
   so super-admin status always wins regardless of what partner/reseller memberships that same login
   also happens to have. Every other existing branch (reseller membership → `/dashboard/channel-partner`,
   everyone else → `/dashboard/configurator`) stays byte-identical for every non-super-admin login —
   this is an additive priority check in front of the existing logic, not a rewrite of it.
2. **New `/dashboard/admin` page**, gated `requireSuperAdmin()` (matching every existing admin sub-page's
   own convention), that is a real landing page: a heading plus a grid/list linking to each of the six
   admin sub-pages above, each with a one-line description of what it is. Arun's own words: "i should
   see all the tabs or links and this is my dashboard, from this page i should be able to navigate."

## Known Constraints

- **Do not touch `/dashboard/channel-partner` itself, `account_kind='channel_partner'` accounts, or any
  reseller-facing functionality.** Arun's "i dont want the channel-partner entity" is about his own login
  not being *routed* there by default — it is not an instruction to remove, disable, or alter the
  channel-partner concept, HelloWorld's account, or any reseller's own login experience. A reseller
  logging in with their own (non-super-admin) Clerk account must land exactly where they do today.
- Do not change `getPartnerAccountsForClerkUser()` or `lib/partner/admin-accounts.ts` — this is purely
  additive routing logic in `app/dashboard/page.tsx`, layered in front of the existing checks.
- Do not add, remove, or reorder the six admin sub-pages themselves — this brief builds only the new
  landing page and the router priority fix, nothing inside the sub-pages changes.
- Per this project's standing responsive/mobile-friendly-by-default rule (`BACKLOG.md`): the new
  `/dashboard/admin` page is new UI, so it must be built to the fluid/tiered responsive standard from
  the start (Tailwind responsive classes + `clamp()` for spacing/typography, no hardcoded pixel-width
  caps) — not retrofitted later. Note also that `BACKLOG.md`'s responsive-audit tracking table currently
  lists `/dashboard/admin/*` broadly as "Not yet verified" except for `sales-partners` (list) and
  `sales-partners/[id]` (verified compliant under B2B-34 Part E) — this brief only need bring the *new*
  page up to the bar; it does not obligate auditing the other five untouched sub-pages, but the BA should
  have the dev add a row for the new page to that tracking table per the standing rule's own instruction
  to update it "the instant a screen's status changes."
- Per this project's "UX screens: implement literally, never interpret" rule: there is no prior
  CEO/BA-approved visual spec for this screen to inherit (the old B2C dark-executive-terminal design
  system was retired with the pivot; no B2B admin design system has been ratified yet). Keep the design
  minimal and functional — see Question 2 below for the recommended default.

## Design Questions I'm Resolving With a Recommended Default

**1. Should `/dashboard/admin` (and its priority-routing) also apply to `internal_staff` (scoped),
not just `super_admin`?** Arun's request was specifically about his own login, and he is a
`super_admin`. `internal_staff` is a narrower, partner-scoped role (B2B-21) that today only reaches one
admin surface at all (`glitches`, via the broader `requireInternalAdmin()` gate) — it has no natural
"home" among the other five super-admin-only pages. **Recommended default: scope both the routing
priority fix and the new landing page to `role === 'super_admin'` only, exactly as Arun's own wording
implies ("ANY super-admin login").** `internal_staff` logins are unaffected by this brief entirely —
they keep landing wherever they land today (this brief doesn't establish that they even reach the
router's reseller/configurator branches meaningfully, since internal_staff isn't necessarily a
`partner_admin_users` member either — that's pre-existing behavior, out of scope here). BA should
confirm this default or flag if there's a reason to extend to internal_staff, but do not silently widen
scope past what Arun asked for.

**2. Visual/layout style for the new page.** No prior CEO/BA-approved visual spec exists for this
screen. **Recommended default: keep it minimal and functional — a heading ("Admin") plus a responsive
grid or list of link cards, one per admin sub-page, each showing the page's name and a single-line
description** (content drawn from the verified table above — e.g. "Sales Partners — manage reseller
accounts and view usage"). No metrics, no charts, no data-fetching beyond the six static links — this is
a navigation hub, not a stats dashboard. A richer version (recent activity, key metrics surfaced inline,
etc.) is worth flagging as a possible future brief once this ships, not something to build now. BA
should scope narrowly per this recommendation unless something in Arun's own words suggests otherwise —
re-read his exact quote before deciding; it says "all the tabs or links," not metrics or data.

**3. Should a super-admin who also has channel-partner memberships still be able to reach
`/dashboard/channel-partner` manually?** Recommended default: **yes, nothing is removed — only the
default landing destination changes.** Direct URL navigation to `/dashboard/channel-partner` is
unaffected (middleware/auth checks for that route are not part of this brief's scope), so a super-admin
who genuinely needs to view a reseller dashboard (e.g. Arun checking HelloWorld's own view) can still
type the URL directly. Do not add a "view as reseller" nav link from the new admin home page as part of
this brief — that's a speculative addition Arun didn't ask for; if he wants that surfaced from the new
page later, that's a separate, small follow-up brief.

## Questions for BA

In addition to fully specifying Questions 1-3 above with concrete acceptance criteria:

1. Specify the exact code change to `app/dashboard/page.tsx`: where the new `resolveInternalAdmin()` /
   `role === 'super_admin'` check is inserted relative to the existing `accounts.some(...)` check, and
   confirm it must not introduce any new redirect/error path for non-super-admin users (their existing
   two branches — reseller membership, everyone else — must remain byte-identical to today).
2. Specify the new `app/dashboard/admin/page.tsx`'s exact content: confirm the six-row table above as
   the definitive link list and one-line descriptions (rewrite the descriptions in Arun-appropriate,
   executive-facing copy if the ones drawn from code comments above read too technical), confirm the
   `requireSuperAdmin()` gate and `notFound()`-on-failure pattern matching every existing admin sub-page
   exactly (e.g. `app/dashboard/admin/team/page.tsx`'s shape).
3. Confirm whether the new page needs its own entry in whatever shared admin-section nav/shell component
   exists today (check if one exists across the six sub-pages — e.g. a shared `DashboardShell` or admin
   sidebar — and whether that shell needs the new home page added to it, or whether the home page itself
   *is* effectively that nav).
4. Define the test plan: unit/integration test that a super-admin login with a channel-partner
   membership resolves to `/dashboard/admin` (not `/dashboard/channel-partner`); a channel-partner-only
   login (no super-admin row) still resolves to `/dashboard/channel-partner` exactly as today; a
   zero-membership login still resolves to `/dashboard/configurator` exactly as today; the new page
   renders all six links and 403/`notFound()`s for a non-super-admin direct visit.

## What NOT to Do

- Do not remove, rename, or alter `/dashboard/channel-partner`, the `channel_partner` account kind, or
  any reseller-facing account, page, or flow.
- Do not change `getPartnerAccountsForClerkUser()` / `lib/partner/admin-accounts.ts`.
- Do not add metrics, charts, or live data to the new `/dashboard/admin` page — links and descriptions
  only, per Question 2's recommended default.
- Do not extend this brief's routing-priority fix to `internal_staff` logins per Question 1's
  recommended default, unless the BA finds explicit reason to and flags it back to CEO for approval.
- Do not build a "view as reseller" link from the new page — out of scope per Question 3's recommended
  default above.
