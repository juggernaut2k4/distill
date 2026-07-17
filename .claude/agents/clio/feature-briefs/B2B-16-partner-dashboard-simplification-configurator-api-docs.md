# Feature Brief: B2B-16 — Partner Dashboard Simplification (Configurator / API / Docs)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-17

## What Arun Said

Verbatim, the instruction that started this:

> "our partners will login then they need 3 things: 1. configurator - to enter their app details,
> 2. api details - to view our api details, 3. documentation - detailed information on our product,
> api, usage, billing etc. they dont need anything else."

Arun asked for competitive research first, then wanted the plan delivered to him incrementally —
understanding → approach → remove list → modify list — approving each chunk before the next. Every
chunk was approved. His final message was **"yes proceed."**

This brief formalizes that approved plan through the CEO → BA → Dev chain. Three specific decisions in
it (§ "Approved Decisions — NOT Open Questions") were explicitly approved by Arun and are **decisions,
not options for the BA to re-derive.** The rest is structural work the BA must specify precisely and
the developer must implement literally.

## The Problem Being Solved

Two parallel dashboard systems currently live under `/dashboard`, and a partner admin who signs in
today is exposed to a confusing mix of both:

- **System A — the real partner-admin Configurator** (`app/dashboard/configurator/*`, Clerk +
  `partner_accounts`-gated) presents **7 equal-weight cards** (Questionnaire, Topics, Content, Domain,
  Integration, Developer, Visualization). "API details" and "Documentation" — two of the three things
  Arun says partners actually need — are today buried together inside the single `Developer` card with
  no distinct identity.
- **System B — dead B2C individual-subscriber weight** (`components/dashboard/DashboardShell.tsx` nav:
  Dashboard / My Plan / Sessions / Knowledge Base / Phone Setup / Settings, plus the pages behind it,
  plus the individual-subscription checkout flow) — none of which a partner admin needs under the
  current model. This is the "they dont need anything else" that Arun is cutting.

The target end-state: a partner logs in and sees exactly three destinations — **Configurator / API /
Docs** — and nothing else. Lean, in the mold of the consoles Arun asked us to study.

## Competitive Research (already done — do not redo)

Studied Stripe, OpenAI, Anthropic, Resend, Clerk, Supabase, Hume AI (Clio's own voice vendor), and
Plaid. Key finding: **Anthropic's console and Resend are the closest models** — lean, 3–4 top-level
sections, a Developers/API-keys cluster, docs one click away, no B2C-style feature sprawl. Two
best-practice checklists were derived from that research; use them as **guidance for what "API" and
"Docs" should contain**, not as a mandate to invent net-new product surface beyond what this brief
specifies:

- **API-keys page checklist:** key masking, one-click copy button, per-key last-used metadata, scoping,
  environment separation (test/live).
- **Docs checklist:** getting-started quickstart, full API reference, code samples, webhook reference,
  error-code reference, plain-language billing explainer.

**Guardrail on this research:** the checklists describe an ideal. This brief builds the **structural
split** of what already exists, tightened toward the checklist where cheap. It does **not** authorize
inventing new API capabilities (key scoping, test/live environment separation, rate limits) that don't
exist in Clio's current partner-auth model. Anything larger than a trivial addition (e.g. masking +
copy button on keys that already exist) is a **future consideration to note**, not something to build
here. See § Constraints.

## Direct Verification (read against current source, 2026-07-17 — not inferred)

### System A — Configurator, confirmed live (KEEP, restructure)

- `app/dashboard/configurator/` contains subdirs: `content/`, `developer/`, `domain/`, `integration/`,
  `questionnaire/`, `topics/`, `visualization/`, `wizard/`, plus `HomeClient.tsx`, `_shared.tsx`,
  `page.tsx`. `HomeClient.tsx` renders the 7 equal-weight cards.
- `app/dashboard/configurator/developer/` contains `DeveloperDocsClient.tsx`, `content.ts`, `page.tsx`,
  and `playground/`. This is the seed of **both** "API" and "Docs" — currently one merged page. Its
  `content.ts` already holds an Authentication section, an Endpoints reference (4 partner API endpoints
  + 1 webhook), and a link to the Playground.
- Shared UI primitives live in `app/dashboard/configurator/_shared.tsx` (`ConfiguratorShell` / `Card` /
  `COLORS`). This is the design system the new shell must reuse — see § Constraints.

### System B — dead B2C weight (REMOVE — see § Remove List for the confirmed items and the sweep)

- `components/dashboard/DashboardShell.tsx` exists and is the B2C-style nav shell.
- **Critical, verified:** `DashboardShell.tsx` is imported by **both** dead B2C pages **and
  confirmed-live admin pages.** Full importer list from repo grep:
  - Dead B2C individual-subscriber pages (removable per this brief): `app/dashboard/settings/page.tsx`,
    `app/dashboard/plan/page.tsx`, `app/dashboard/sessions/page.tsx`,
    `app/dashboard/sessions/[id]/page.tsx`, `app/dashboard/schedule-setup/page.tsx`,
    `app/dashboard/knowledge-base/page.tsx`, `app/dashboard/knowledge-base/[topicId]/page.tsx`,
    `app/dashboard/knowledge-base/rules/page.tsx`, `app/dashboard/phone/page.tsx`.
  - **Confirmed-live admin pages that MUST keep working:** `app/dashboard/admin/clients/page.tsx`,
    `app/dashboard/admin/clients/PartnerBillingClient.tsx`, `app/dashboard/admin/glitches/page.tsx`,
    `app/dashboard/admin/templates/page.tsx`,
    `app/dashboard/admin/templates/[templateName]/progress/page.tsx`.
  - **Consequence:** `DashboardShell.tsx` **must NOT be deleted** — the admin surface still depends on
    it (this exact constraint was established and shipped in B2B-14). The new 3-item nav shell is an
    **additive new component** for the Configurator/API/Docs surface. Only the dead pages' *usage* of
    `DashboardShell` disappears when those pages are deleted; the component itself stays for admin.

### The access-gate contradiction (verified — flag, do not hand-wave)

`app/dashboard/layout.tsx` currently wraps **all** of `/dashboard/*` (except a `/dashboard/welcome`
exemption — note `welcome` was itself deleted in B2B-14, so that branch is now effectively dead) in a
hard gate:

```tsx
const { data: user } = await supabase
  .from('users')
  .select('subscription_status, plan_tier')
  .eq('id', userId)
  .single()

const hasAccess =
  user?.subscription_status === 'active' || user?.subscription_status === 'trialing'

if (!hasAccess) redirect('/plan')
```

Partner admins never get a `users` row (nothing in the Clerk-org webhook creates one — they get a
`partner_admin_users` / `partner_accounts` row instead). So for a partner admin, `user` is `null`,
`hasAccess` is `false`, and this gate should redirect them to `/plan` — yet partner admins have
demonstrably been reaching the Configurator. **How is an open, unexplained contradiction.** The BA/Dev
must investigate and account for it as part of this work — do not let it resurface as a silent bug once
`/plan` no longer exists as a redirect target. See § Approved Decisions #1 for what replaces this gate.

### The two unresolved `/plan` · `/checkout` references (verified)

- `app/topics/page.tsx:621` → `router.push('/plan')`.
- `app/api/onboarding/account-state/route.ts:77,79` → returns `resumeUrl: '/plan'` and `'/checkout'`
  for the "signed up, not yet paid" individual-subscriber states; this route is called by
  `app/onboarding/page.tsx`.
- **Verified still-present:** `app/plan/` (tier picker: `PlanClient.tsx` + `page.tsx`),
  `app/(marketing)/pricing/`, and `app/checkout/` **all still exist** — B2B-14 pulled them out of its
  scope. This means the individual-subscriber signup chain (`app/onboarding` → `account-state` →
  `/topics` → `/plan` → `/checkout`) is **still fully wired.** Deleting `app/checkout/` in isolation
  will orphan/break those callers. This coupling is real and must be resolved by the sweep — see
  § Remove List and § Open Questions.

## Approved Decisions — NOT Open Questions (implement exactly)

These three were explicitly approved by Arun. The BA documents them as decisions; the developer builds
them as given. Do not re-open or re-derive.

1. **Delete the hard billing-redirect gate in `app/dashboard/layout.tsx` entirely.** Keep only the
   Clerk session check there: no `userId` → `redirect('/sign-in')`. Remove the `users`
   `subscription_status`/`plan_tier` query and the `redirect('/plan')`. (This also cleanly resolves the
   now-dead `/dashboard/welcome` exemption and the "redirect to a route we're deleting" problem.)

2. **The existing per-page wizard-entry gate is the ONE gate that remains.** Every Configurator page
   already checks `partner_accounts.onboarding_completed_at` and redirects to
   `/dashboard/configurator/wizard` if onboarding is incomplete. Because B2B-13's plan-tier selection
   is a **step inside that same wizard**, "hasn't paid yet" and "hasn't finished onboarding" are
   already the same check, already redirecting to the correct place. **No new page needs to be built to
   receive a redirect.** Do not invent a new gate or a new billing-block screen.

3. **Billing problems that surface *after* onboarding completes do NOT hard-block dashboard access.**
   When a plan payment fails (`partner_wallets.plan_status` → `past_due`/`canceled`) or the wallet
   balance depletes, add a **persistent, non-blocking banner** in the new dashboard shell that reads
   `partner_wallets.plan_status` / `balance_usd` and surfaces a warning + a link to fix billing — while
   Configurator, API, and Docs all remain fully visible and usable. This matches how
   Stripe/OpenAI/Anthropic/Resend all handle billing problems: they never lock a customer out of their
   own dashboard over a failed payment; they restrict the costly *action* instead. **Designing that
   action-level restriction is explicitly OUT of scope for this brief** — just do not block dashboard
   viewing.

## What This Brief Specifies

### 1. Restructure `app/dashboard/configurator/` into exactly 3 top-level destinations

- **Configurator** — the existing **6 non-Developer cards** (Questionnaire, Topics, Content, Domain,
  Integration, Visualization), **unchanged in function.** Only their framing/grouping changes: they no
  longer share visual weight with a "Developer" card. This is **not** a redesign of the 6 sub-screens —
  their internal functionality is untouched (see § Constraints).
- **API** — split out of the current `developer/` page: the **Authentication / keys section + the
  Endpoints reference**, tightened toward the researched API-keys checklist. Minimum bar: keys are
  **masked** and have a **one-click copy button.** Do **not** invent scoping / environment-separation /
  last-used-metadata / rate-limit features that don't exist in the current auth model *unless the BA
  finds they are already trivially present* — flag anything larger as a follow-up, do not silently add.
- **Docs** — a **new page**: the endpoint + webhook reference content that lives in `developer/content.ts`
  today, **plus** a getting-started quickstart **and** a plain-language billing explainer.
  **Hand-authored content only** — this must match B2B-07's existing "no AI-generated call, no network
  fetch" convention for portal/docs content. **Do not** introduce an AI content-generation mechanism to
  populate Docs.
- **Playground** — currently linked from `developer/` (`developer/playground/`). It needs a home.
  **Recommendation: place it under API** (it is a live-test tool for API calls). BA to confirm, or
  surface a reason otherwise — see § Open Questions.

The BA must specify the exact route paths (technical decision — recommend keeping everything under
`/dashboard/*`, e.g. the 6-card Configurator home, an API route, a Docs route) and which existing files
(`developer/DeveloperDocsClient.tsx`, `developer/content.ts`, `developer/page.tsx`) are split, moved, or
renamed. The three **nav labels are fixed by Arun: Configurator / API / Docs.**

### 2. New lean nav shell (replaces the Configurator surface's nav, additively)

- Exactly **3 nav items: Configurator / API / Docs.**
- Includes the **non-blocking billing-health banner** from Approved Decision #3.
- **Reuses the existing Configurator design system** (`_shared.tsx`'s `ConfiguratorShell` / `Card` /
  `COLORS`) — **no new design language** (see § Constraints).
- This is a **new component**; it does **not** delete or replace `DashboardShell.tsx`, which the admin
  surface still needs (see Direct Verification).

### 3. `app/dashboard/layout.tsx` — implement Approved Decision #1 exactly.

### 4. `middleware.ts` — update the public/protected route lists to match what is actually deleted.

Remove now-dead entries (e.g. `/checkout(.*)`, and `/plan(.*)` / `/pricing(.*)` *only if the
corresponding routes are deleted by this brief's finalized sweep*). The middleware diff must track the
actual deletion set — do not remove a public-route entry for a route that survives, and do not leave a
public-route entry for a route that's deleted. Write the exact `isPublicRoute` diff into the spec.

### 5. Remove List (starting set — the BA must finalize via a rigorous dependency sweep)

**Confirmed-removable individual-subscriber page surfaces under `/dashboard`** (partner admins "dont
need anything else" — Arun's instruction is decisive that these individual-facing pages go; note the
"session"/"plan" ambiguity that made B2B-14 hold these is now resolved by Arun's direct instruction
*for the page surfaces*, but the shared engine caveat below still binds):

- `app/dashboard/plan/` (the curriculum-review page — imports `DashboardShell`)
- `app/dashboard/sessions/` (+ `[id]/`)
- `app/dashboard/knowledge-base/` (+ `[topicId]/`, `rules/`)
- `app/dashboard/phone/`
- `app/dashboard/settings/`
- `app/dashboard/schedule-setup/`
- `app/dashboard/walkthrough/` (Clerk-`auth()`-gated individual live-session view — dead under the
  current architecture: partner end-users are anonymous and reach sessions via
  `/partner-render/[clio_session_ref]`, not this route)
- `app/checkout/` (individual-subscription checkout — but see the coupling flag below and § Open
  Questions before deleting)

**Mandatory dependency sweep before finalizing any deletion (same discipline as B2B-14's orphan
sweep):**

- **Do NOT delete the shared voice/session engine.** `sessions/`, `knowledge-base/`, and `walkthrough/`
  pages pull in machinery (`HumeAdapter`, `LiveConductorVisual`, `checkRtv03Transition`,
  `VisualizationTabPanel`, `SessionStack`, `lib/session-plan`, `lib/content/script-generator`, and the
  `inngest/session-*` / `curriculum-*` / `rtv03-*` jobs) that is **the same engine the live partner
  path uses** (`app/api/webhooks/hume`, `app/api/recall/webhook`, `app/api/attendee/webhook`,
  `lib/session-billing.ts`, `partner-render`). Delete **only the individual-facing dashboard page
  surfaces.** For every `lib/*`, `components/*`, or `inngest/*` module imported by a deleted page, the
  BA must verify whether it becomes orphaned. If it is still imported by the live partner path → **keep
  it, untouched.** If it appears orphaned → **do not silently delete it in this brief** — flag it as a
  separate item, because "orphaned by these pages" is not the same as "dead" for engine code.
- **Trace the `/plan` · `/checkout` coupling precisely.** Deleting `app/checkout/` orphans
  `account-state/route.ts`'s `resumeUrl: '/checkout'` return and (transitively) the
  `app/onboarding` → `account-state` → `/topics` → `/plan` → `/checkout` individual-signup chain.
  `app/topics/page.tsx:621` also `router.push('/plan')`. The BA must decide, and document, whether
  `checkout` can be cleanly removed in isolation, or whether it is coupled to retiring the whole
  individual-signup chain — see § Open Questions. Do not delete `checkout` and leave dangling
  references to a 404.
- **Trace B2C-only API routes with zero remaining callers** once the pages above are gone (e.g. routes
  under `app/api/onboarding/*`, `app/api/*` that only the deleted individual-subscriber pages called),
  same precision as B2B-14. List each in the spec's Files Changed with the grep evidence that it has no
  live caller before marking it deletable.
- **`components/dashboard/*` sub-components** (e.g. `ScheduleCard`, `RecommendationCard`, and any others
  imported only by the deleted pages): verify sole-importer before deleting; several `components/dashboard/*`
  survived B2B-14 specifically because they were shared. Do not assume.

### 6. Flag the access-gate contradiction

The BA/Dev must investigate *how* partner admins currently reach the Configurator despite the
`layout.tsx` gate that should redirect them to `/plan`, and account for it — so that removing the gate
(Approved Decision #1) is a clean, understood change and no partner-admin access path silently breaks
when `/plan` disappears as a redirect target. Document the finding in the spec.

## Known Constraints

- **This is NOT a redesign of the Configurator's 6 internal sub-screens.** Questionnaire, Topics,
  Content, Domain, Integration, Visualization keep their current functionality exactly. Only their
  framing/grouping (no longer sharing weight with "Developer") changes.
- **No new design language.** The new shell, the API page, and the Docs page reuse
  `app/dashboard/configurator/_shared.tsx` (`ConfiguratorShell` / `Card` / `COLORS`). Do not introduce a
  new visual system.
- **Do not invent new API features** (key scoping, test/live environment separation, rate limits)
  beyond the structural split + the trivial masking/copy-button bar. Note larger ideas as *future
  considerations* per the research checklist; do not build them here.
- **Docs is hand-authored content only** — no AI generation, no network fetch (B2B-07 convention).
- **Do not delete `components/dashboard/DashboardShell.tsx`** — the admin surface depends on it.
- **Do not touch the shared voice/session engine** (`lib/session-*`, `lib/content/script-generator`,
  `HumeAdapter`, the session/curriculum/rtv `inngest` jobs, or the `app/api/webhooks/*` handlers) — only
  the individual-facing dashboard *page* surfaces are in scope.
- **Do not touch** `app/dashboard/admin/*`, `app/partner-render/*`, `app/partner-questionnaire/*`,
  `app/partner-signup/*`, or the `app/(marketing)` homepage (its own work is tracked under B2B-12/B2B-15).

## Questions for BA (Section 11 — genuine open items; resolve or escalate, do not guess)

Given the size of this change, the following are **legitimately open** and must be resolved by the BA
(or escalated to CEO → Arun) before the spec is approved. The three Approved Decisions above are **not**
among them.

1. **Individual-signup-chain coupling.** Can `app/checkout/` be removed in isolation, or is it coupled
   to retiring the whole individual-subscriber signup chain (`app/onboarding`, `app/topics`, `app/plan`,
   `app/(marketing)/pricing`, `app/api/onboarding/account-state`)? Given the B2B pivot and "they dont
   need anything else," the strong likelihood is the entire individual-signup chain is dead — but B2B-14
   deliberately held `app/onboarding`/`app/topics` back because they touch the still-live curriculum/
   session engine. The BA must trace this precisely and, if retiring the chain expands scope beyond what
   Arun literally named, escalate for a one-line confirmation rather than guessing. **Do not delete
   `checkout` and leave the chain pointing at a 404.**
2. **Billing-health banner specifics.** Exact copy/wording; which states trigger it (`plan_status`
   `past_due`/`canceled` only, or also a low-`balance_usd` warning, and at what threshold); the "fix
   billing" link target. Also **verify the `partner_wallets` schema** actually exposes `plan_status` and
   `balance_usd` (B2B-13 built plan tiers + top-ups — confirm the column names) before the dev reads
   them. The *behavior* (persistent, non-blocking) is fixed by Approved Decision #3; only these details
   are open.
3. **Playground placement.** Confirm the recommended home under **API**, or surface a concrete reason to
   place it elsewhere.
4. **Exact route paths / file split** for Configurator vs. API vs. Docs (which of
   `developer/DeveloperDocsClient.tsx` / `content.ts` / `page.tsx` is split, moved, or renamed). This is
   a technical decision — document the chosen layout explicitly so QA can verify against it.
5. **Access-gate contradiction resolution** (§6) — the BA must report *how* partners reach the
   Configurator today and confirm removing the gate breaks no live access path.

Everything else — the remove list, the sweep methodology, the 3-destination structure, the additive
shell, and the three Approved Decisions — is specified above. QA's Gate 1 should confirm the deletion
set exactly matches the BA's finalized (post-sweep) Files Changed list with no residual references, the
`layout.tsx`/`middleware.ts` diffs match the spec verbatim, and the new shell + API/Docs pages reuse the
existing design system with the three fixed nav labels.
