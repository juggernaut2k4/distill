# Feature Brief: B2B-21 — Internal Admin Identity (Super-Admin + Sales-Partner) & Internal-Admin RBAC Gate

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 — with one P0-urgency sub-part: closing the internal-admin RBAC gap (any authenticated
Clerk user can currently reach `/dashboard/admin/*` and `/api/admin/*` cross-partner surfaces). That
hole was flagged in the 2026-07-17 feature audit and is a real, live authorization defect; it must be
closed as part of this brief, not deferred.
Date: 2026-07-18

---

## What Arun Said (verbatim, 2026-07-18)

> "build the admin (sales-partner - only can be invited by the super admin (me)) and super-admin (me -
> email - hello.arunprakash83@gmail.com, also i can add more super-admin emails and both will have
> equal roles and responsibilities and can initiate transactions separately. use the ceo agent,
> design-skill everything you need."

When asked whether the full reseller business mechanics (commission %, digital agreement,
product/geography/language scoping) come with this, his answer (verbatim):

> "we will brainstorm once the dashboard is complete."

So: build the **identity and access-control infrastructure** now — who logs in as what, invite
mechanics, scoped access, and gating the existing internal-admin surfaces. The reseller *business*
mechanics stay frozen (see Scope Boundary).

---

## The Problem Being Solved

Clio has no concept of **its own internal team's identity**. The only role model in the codebase is
`partner_admin_users` — and that is an entirely different axis: it scopes *a partner's own staff to
that one partner's own account* (a company's admins configuring their own integration), populated
automatically by the Clerk Organizations webhook. There is no notion of a **Clio-internal operator
who works across many partners**.

This produces two concrete failures:

1. **No internal identity layer exists.** There is no way to say "this person is a Clio super-admin
   with full cross-partner reach" or "this person is a Clio sales-partner who may only act on the
   partner accounts assigned to them." Arun wants exactly these two roles: super-admins (himself +
   any emails he adds, all equal peers, acting independently) and sales-partners (invite-only, issued
   *only* by a super-admin, scoped to specific partner accounts).

2. **The internal-admin surfaces are unprotected (P0-urgency).** The cross-partner internal pages —
   `app/dashboard/admin/clients` (cross-partner billing view), `app/dashboard/admin/glitches`
   (cross-partner glitch dashboard), `app/dashboard/admin/templates` — gate on `currentUser()` only
   (redirect to `/sign-in` if no session, otherwise render). Their backing routes
   (e.g. `app/api/admin/glitches/route.ts`, `app/api/admin/billing/clients`) gate on `requireAuth()`
   from `lib/clerk.ts`, which returns 200 for **any** Clerk session. **Any authenticated user —
   including any partner admin who signed up through the normal partner flow — can currently reach
   Clio's internal cross-partner operator screens and data.** Now that real internal roles are being
   built, these surfaces must be gated to super-admin (full) or appropriately-scoped sales-partner.

The outcome we want: a clean, orthogonal internal-identity layer that composes with — never touches —
the existing partner-admin model, plus every internal cross-partner surface locked behind it.

---

## What Success Looks Like

- **Super-admin accounts exist.** `hello.arunprakash83@gmail.com` is seeded as the first super-admin.
  A super-admin can add additional super-admin emails from the UI. All super-admins are **equal
  peers** — no hierarchy, no dual-approval / co-sign between them; each acts independently ("initiate
  transactions separately").
- **Sales-partner accounts exist, invite-only.** A sales-partner can be created **only** by a
  super-admin (never self-serve signup, never invitable by another sales-partner). Each sales-partner
  is **tagged/scoped to one or more specific `partner_accounts`** and may only act within that scope.
- **Internal-admin surfaces are gated.** `/dashboard/admin/*` (clients, glitches, templates) and their
  backing `/api/admin/*` cross-partner routes require super-admin (full access) or a scoped
  sales-partner (limited to their tagged partners, on the specific screens a sales-partner is entitled
  to). A partner admin who reaches these today gets a clean 403 / not-found after this ships.
- **Admin UI exists** for: (a) a super-admin inviting a sales-partner (email + which partner
  account(s) to tag), and (b) a super-admin adding another super-admin email. Built to Clio's existing
  dark-void / purple-accent design system and the `/design-review` App-UI rules — no new colors,
  typography, or npm dependencies.
- **The existing partner-admin (Clerk Organizations) model is untouched** — this is purely additive.

---

## What I Found In the Code (so the BA doesn't re-derive it)

**Two auth systems already exist, deliberately kept separate** (`lib/partner/auth.ts` header comment):
- `requirePartnerApiKey(request, routeClass)` — inbound partner→Clio direction, for
  `/api/partner/v1/*` (static API key or OAuth2 client-credentials token). Not relevant to this brief.
- `requirePartnerAdmin(partnerAccountId)` — Clerk-authenticated human; verifies a `partner_admin_users`
  row exists for `(clerkUserId, partnerAccountId)`. Returns 401 (no Clerk session) / 403 (session but
  no membership on that account). This is **scoped to one partner account** and backs the partner's own
  Configurator/billing routes (`/api/admin/partner-keys*`, `/api/admin/configurator/*`,
  `/api/admin/billing/*`, etc.). These are correctly scoped and are NOT the gap.

**`partner_admin_users` table** (migration `071_b2b02_partner_accounts_and_api_keys.sql`):
`id, clerk_user_id, partner_account_id (FK → partner_accounts, ON DELETE CASCADE),
role ('owner'|'admin'|'member', default 'admin'), created_at, UNIQUE(clerk_user_id, partner_account_id)`.
RLS: a user can SELECT their own memberships; service_role full access. **Its `role` column is
within-one-partner scoping (a partner's own team hierarchy) — do NOT overload it for super-admin /
sales-partner.** Memberships are created automatically by the Clerk Organizations webhook
(`app/api/webhooks/clerk-organization/route.ts`): `organization.created` → `partner_accounts` row;
`organizationMembership.created` → `partner_admin_users` row (first member = `owner`, rest = `admin`).
That provenance is wrong for internal operators — a sales-partner tagged to partners X and Y must not
become a `partner_admin_users` member of X and Y (that would hand them the partner's own Configurator).

**The RBAC gap, confirmed at the source:**
- Pages: `app/dashboard/admin/clients/page.tsx` and `app/dashboard/admin/glitches/page.tsx` both do
  `const clerkUser = await currentUser(); if (!clerkUser) redirect('/sign-in')` and then render —
  **no role check.** `app/dashboard/admin/templates` is the third internal page.
- Routes: `app/api/admin/glitches/route.ts` uses `requireAuth()` (`lib/clerk.ts`), which is literally
  "is there a Clerk session → 200, else 401." Its own comment cites `/api/admin/glitches/summary` and
  `/api/admin/billing/clients` as the same boundary. Full list of `/api/admin/*` route groups:
  `backfill-sub-sessions, billing, clear-all-kb-content, clear-topic-cache, configurator, debug-bot,
  delivery-health, glitches, partner-accounts, partner-keys, qa-*, repair-session-titles,
  rtv03-accuracy-report, seed-*, session-markers, test-*`. The BA must classify each group as either
  **partner-scoped** (already correctly behind `requirePartnerAdmin`, leave alone) or
  **internal/cross-partner** (currently behind bare `requireAuth()`/none — must move behind the new
  super-admin / scoped-sales-partner gate).

**No existing super-admin / sales-partner concept anywhere.** Greps for `super_admin`, `sales_partner`,
etc. returned only incidental hits (the `partner_admin_users.role` column, ledger audit logs). This is
genuinely net-new.

**middleware.ts** — Clerk middleware with a public-route matcher; `/dashboard` and `/api/admin/*`
require a Clerk session but have **no role gate**; it also neutral-404s `/dashboard` and `/api/admin/*`
on partner white-label domains. Whatever the BA designs must preserve both behaviors.

---

## My Recommendation on the Core Architectural Question

The internal-identity layer is a **new, orthogonal axis** and should be modeled as such — not by
extending `partner_admin_users`. My recommendation for the BA to evaluate and formalize:

- A new table (e.g. `internal_admin_users`): `clerk_user_id` (nullable until first login), `email`,
  `role ('super_admin' | 'sales_partner')`, `status`, `invited_by`, timestamps. Seed
  `hello.arunprakash83@gmail.com` as the first `super_admin`.
- A new join table for the sales-partner scoping axis (e.g. `sales_partner_assignments`):
  `internal_admin_user_id → partner_account_id`, many-to-many (a sales-partner may cover several
  partners; a partner may plausibly have more than one sales-partner tagged — confirm).
- New auth helpers parallel to `requirePartnerAdmin`: `requireSuperAdmin()` and
  `requireInternalAdmin(partnerAccountId?)` (super-admin passes for any account; sales-partner passes
  only for a tagged account). Reuse the same Clerk session for **login/identity**; use our own table
  for **role** — do not put internal operators into Clerk Organizations or `partner_admin_users`.

This is a recommendation, not a decision — the BA owns the final schema and helper design. I flag it
so the BA composes with the existing two-auth-system pattern rather than inventing a third shape.

---

## Known Constraints (from Arun + CLAUDE.md / CORE_OBJECTIVES — enforce these)

1. **Frozen — do NOT build in this brief:** commission / % tracking, digital agreements or
   e-signature, and product/geography/language territory scoping. These are the reseller *business*
   mechanics Arun explicitly deferred to a future brainstorm ("we will brainstorm once the dashboard
   is complete"). They remain in the CORE_OBJECTIVES backlog and the `BACKLOG.md` frozen section. This
   brief is **identity and access control only.**
2. **Do not touch the partner-admin (Clerk Organizations) model.** `partner_admin_users`, the
   `clerk-organization` webhook, and `requirePartnerAdmin` stay exactly as they are. This layer is
   additive and separate.
3. **Super-admins are equal.** No hierarchy, no co-sign / dual-approval between super-admins for any
   action. Each "initiates transactions separately" — independently.
4. **Reuse existing patterns.** Trace and mirror `requirePartnerAdmin` / the two-auth-system structure
   in `lib/partner/auth.ts`; diverge only where genuinely necessary (internal operators are not scoped
   to a single Clerk Organization the way partner admins are). Preserve middleware's Clerk-session +
   partner-domain-block behavior.
5. **Approved libraries only; no new npm dependencies** without written justification. Email for
   invites, if used, goes through Resend (approved, account-level notifications).
6. **New screens use Clio's existing design system** (dark-void `#080808` / surface `#111111` / purple
   `#7C3AED` accent) and the `/design-review` App-UI rules — calm hierarchy, dense-but-readable, no
   AI-slop patterns. No new visual direction, no new colors/typography.

---

## Scope Boundary — what this brief is NOT

- It is **not** the deferred super-admin "complete control / cross-partner analytics / which
  sales-partner brought each partner / revenue-share" console described in CORE_OBJECTIVES §Backlog.
  That is the big deferred version. **This brief builds only:** (a) the identity tables + auth helpers,
  (b) the RBAC gate over the *existing* clients/glitches/templates surfaces, and (c) a minimal admin
  UI for invite-sales-partner and add-super-admin. No new cross-partner reporting/analytics surface is
  in scope. The BA must state the exact screen inventory and keep it minimal.
- It does **not** re-home or redesign the existing internal-admin pages' *content* — only gates them.

---

## Questions for the BA to Resolve (Section 11 of the Requirement Document must end empty)

Real ambiguity is expected here. Name each precisely; escalate the genuine product calls (flagged ⬆)
back to me rather than guessing.

1. **Authentication mechanism for internal operators.** Confirm: internal admins and sales-partners
   log in via the *same Clerk instance* (identity), with role resolved from our own
   `internal_admin_users` table — and are explicitly NOT placed in Clerk Organizations /
   `partner_admin_users`. Spec exactly how a Clerk session resolves to an internal role (email match
   at first login → binds `clerk_user_id`).

2. ⬆ **Per-screen sales-partner visibility.** For each of the three internal pages, define what a
   scoped sales-partner sees, or whether they see it at all — trace whether each surface is
   cross-partner or partner-scoped first:
   - **glitches** — filtered to the sales-partner's tagged partners? (Plausibly yes.)
   - **clients / billing** — does a sales-partner see billing $ / revenue detail for their tagged
     partners, or is all billing-money detail super-admin-only? This brushes the deferred commission
     topic — resolve conservatively and flag to me if it's a genuine product call.
   - **templates** — are templates global (super-admin only) or per-partner (scoped)? Trace before
     deciding.

3. **Invite + acceptance flow.** How does a super-admin invite a sales-partner? Define the mechanism
   (email invite via Resend + tokenized accept link → Clerk sign-in → bind to `internal_admin_users`),
   token expiry, re-invite, and the tag/un-tag (re-assign partner accounts) lifecycle. Define equally
   the "add another super-admin email" flow (does the invitee exist immediately as pending, bound on
   first login?).

4. ⬆ **"Initiate transactions separately" — scope in THIS brief.** Clarify what "transactions" Arun
   means within an *identity/access* brief. If it means admin actions (invite, tag, gate toggles) with
   no co-sign among equal super-admins — spec that. If it implies super-admins initiating *financial*
   transactions on a partner's behalf from a console, that is likely the deferred super-admin console —
   confirm and escalate to me; do not build a new transaction surface here.

5. **Removal / deactivation guardrails.** Can any super-admin remove/deactivate another super-admin
   (equal rights implies yes)? Prevent last-super-admin lockout. May
   `hello.arunprakash83@gmail.com` be removed? Define sales-partner deactivation and what happens to
   their assignments and in-flight invites.

6. **Assignment cardinality.** Confirm many-to-many between sales-partners and partner accounts, and
   whether a single partner account may carry more than one tagged sales-partner (the sibling Known
   Bugs toggle brief's phrasing "any of the super-admin or sales-partner tagged to the specific
   partner" implies ≥1). Define uniqueness constraints.

7. **Exact screen inventory.** Enumerate every new/modified screen: the gated existing pages, plus the
   new admin UI (recommend a single super-admin-only "Team / Access" page — confirm route,
   e.g. `/dashboard/admin/team`). Keep it minimal per the Scope Boundary; no analytics console.

8. **Gate placement.** Role-gate per-page / per-route via new helpers (parity with
   `requirePartnerAdmin`), keeping middleware as the coarse Clerk-session + partner-domain gate?
   Confirm, and specify the exact behavior for a partner-admin who hits a now-gated surface (403 JSON
   for routes; not-found or 403 page for pages — match existing conventions).

9. **Seeding `hello.arunprakash83@gmail.com`.** Migration seed keyed on email vs. env-var bootstrap.
   Specify how the email→`clerk_user_id` binding happens given he may have no `clerk_user_id` row until
   first login, and how this stays idempotent across environments.

10. **Route classification deliverable.** Produce the explicit table classifying every `/api/admin/*`
    route group as partner-scoped (leave on `requirePartnerAdmin`) vs. internal/cross-partner (move to
    the new gate), so the Dev agent changes exactly the right routes and nothing else.

---

## CEO Review Gate

I will review the BA's Requirement Document before any code is written. It does not pass review until:
- All 12 sections are filled; **Section 11 (Open Questions) is empty** — every question above resolved,
  with the ⬆-flagged product calls either resolved from the docs or escalated to me and answered.
- The schema is a genuinely orthogonal layer (no changes to `partner_admin_users` / the Clerk-Org
  webhook / `requirePartnerAdmin`).
- The route-classification table (Q10) is present and complete.
- New screens are specified to the `/design-review` App-UI standard with wireframes/examples (≥3 lines
  + example per screen, per the "ambiguous UX = STOP" rule), reusing the existing design system.
- The frozen reseller mechanics (commission, e-signature, geo/language) appear nowhere in the spec.

Once approved, this goes to the Dev agent to build to spec — and through the full QA gate (code review
+ automated tests + live browser UI functional testing on the deployed app) before merge, with special
attention to negative auth paths (a partner-admin and an unscoped sales-partner each getting correctly
blocked from a surface they must not reach).
