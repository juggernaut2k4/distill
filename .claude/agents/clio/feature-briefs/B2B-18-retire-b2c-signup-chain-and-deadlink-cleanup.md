# Feature Brief: B2B-18 — Retire the B2C Individual-Signup Chain + Deadlink / Stale-Surface Cleanup

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-17

**ID note (tie-break, RESOLVED):** this brief originally claimed `B2B-17` at write time. A 3-way
collision landed in the same ~3-second window (glitch-log brief, this brief, and the content-delivery
brief). Creation-timestamp order: glitch-log first (10:15:22, keeps `B2B-17`), this brief second
(10:15:23, renumbered to `B2B-18` per the established rule), content-delivery third (10:15:25,
renumbered to `B2B-19`). Orchestrator has renamed this file and its cross-references accordingly.

---

## What Arun Said

Verbatim, today (2026-07-17):

> "deadlinks - remove the deadlinks and align it based on our new objective and expectations."

Two words in that sentence carry the scope: **"deadlinks"** (remove routes/links that go nowhere or
point at the retired product) and **"align … based on our new objective"** (bring the remaining
surface into line with `CORE_OBJECTIVES.md` v3, rewritten today). This is not link-tidying for its
own sake — it is authorized cleanup of a product surface that v3 says no longer exists.

## Why This Is Authorized Now (not just link hygiene)

`CORE_OBJECTIVES.md` **v3** (2026-07-17, Arun's own restatement) states Clio's scope is **exclusively
API-driven partner integration** — the Objective 2 call-flow spine and nothing else. Two clauses make
this cleanup an instruction to execute rather than a discretionary tidy:

- **Hard Premise — B2C Is Killed:** "self-serve individual sign-up, consumer landing/pricing pages,
  gamified engagement (AI Readiness Score, streaks) … is retired, not paused." The individual-signup
  chain this brief retires is *precisely* that surface.
- **Objective 5 — Keep / Reuse / Remove To Fit This Scope:** anything not serving the Objective 2
  flow is "a named candidate for removal." The standing "no delete without approval" rule means those
  candidates are normally *surfaced*, not auto-deleted — **Arun's instruction today is that approval.**

So: the removal is authorized. The discipline is unchanged — trace every reference before deleting
(the B2B-14 / B2B-16 sweep standard), never delete engine code shared with the live partner path, and
escalate genuinely ambiguous product calls rather than guessing.

## The Problem Being Solved

A full navigation audit today (2026-07-17) found the retired B2C individual-subscriber surface is
**still live and publicly reachable on `hello-clio.com`**, and internal-admin nav points at deleted
pages. Concretely:

1. **The individual-signup chain is publicly wired, not orphaned.** `MarketingNav.tsx`'s "Pricing"
   nav link → `app/(marketing)/pricing/page.tsx` → CTAs → `/onboarding` → `app/topics/page.tsx`
   (`router.push('/plan')`) → `app/plan/` → `app/checkout/`. Every one of these is in `middleware.ts`'s
   `isPublicRoute` allowlist, and **both Clerk auth pages set `forceRedirectUrl="/onboarding"`** —
   i.e. a fresh sign-in/sign-up is still funnelled into the dead B2C onboarding.
2. **`components/dashboard/DashboardShell.tsx`'s `NAV_ITEMS` point at ~5 now-deleted routes**
   (`/dashboard/plan`, `/dashboard/sessions`, `/dashboard/knowledge-base`, `/dashboard/phone`,
   `/dashboard/settings`). DashboardShell itself is **KEEP** (live internal-admin importers), but its
   nav shows internal admins 5 dead links.
3. **Stale B2C copy on the marketing homepage hero** (`app/(marketing)/page.tsx`) describes the
   retired product: an "AI Readiness Platform" badge, "5-question onboarding," "AI Readiness Score,"
   "Email or SMS" delivery, a `PhoneMockup` SMS visual, and testimonial/CTA copy in the same vein.
   This is factually wrong under v3 and is live on a domain Arun is actively demoing.
4. **Other orphaned/stale references** the same audit flagged: `/admin/seed` (zero inbound links),
   and the retired-B2C API routes/copy that still reference deleted `/dashboard/*` pages (the BACKLOG
   "B2B-16 — post-deletion orphan flags" list).

Target end-state: no public path into a retired B2C flow, no internal nav pointing at 404s, and no
homepage copy claiming a product Clio no longer sells — without touching anything the live partner
path depends on, and without straying into the frozen homepage-redesign scope.

## What Success Looks Like

- A visitor on `hello-clio.com` has **no reachable path** into `/onboarding` → `/topics` → `/plan`
  → `/checkout` or `/pricing`. Those routes are gone (or return the platform's normal 404), the nav
  no longer offers "Pricing," and a fresh Clerk auth lands somewhere valid under the current
  partner model — **not** `/onboarding`.
- An internal Clio admin signing in sees a nav (`DashboardShell`) that lists **only real, live admin
  destinations**, including `/dashboard/admin/glitches`, and no dead links.
- Homepage hero copy makes only **accurate, minimal** claims about what Clio is now (API-driven
  partner voice-learning infrastructure) — with **no layout/section/visual redesign** (that is a
  separate frozen item).
- Every deletion is backed by a grep-verified sweep showing no live importer/caller remains;
  anything still shared with the live partner path is kept untouched.

## Direct Verification Already Done (2026-07-17, read against current source)

- **Hero copy confirmed present** in `app/(marketing)/page.tsx`: `Badge "AI Readiness Platform"` (~L47),
  subheadline "15 seconds a day. Zero jargon. Total confidence." (~L58), trust signal
  "5-question onboarding" (~L79), `<PhoneMockup />` (~L98, defined ~L106), how-it-works copy
  "Email or SMS" (~L237) and "AI Readiness Score" (~L243), testimonial referencing "AI Readiness
  Score is 78" (~L306), final CTA "Get started — 15 seconds to set up" (~L385).
- **MarketingNav** (`components/marketing/MarketingNav.tsx`) has a `/pricing` nav `Link` (~L35) with an
  active-state style; its sign-up CTA already points at `/partner-signup` (~L53) — B2B-12's fix.
- **`/plan` · `/checkout` chain confirmed still fully wired** by the sibling B2B-16 brief's own
  verification: `app/topics/page.tsx:621 → router.push('/plan')`;
  `app/api/onboarding/account-state/route.ts:77,79 → resumeUrl '/plan' / '/checkout'` (called by
  `app/onboarding/page.tsx`); `app/plan/`, `app/(marketing)/pricing/`, `app/checkout/` all still exist.
- **Orphan-flag list** (BACKLOG.md "B2B-16 — post-deletion orphan flags"): B2C API routes/copy still
  linking to deleted `/dashboard/*` pages — `app/api/topics/route.ts`, `app/api/plan/approve/route.ts`,
  `app/api/sessions/schedule/route.ts`, `app/api/checkout/topup/route.ts` (SMS/email bodies), plus doc
  comments in `lib/content/live-conductor-client.ts` and
  `app/api/sessions/acknowledge-adaptation/route.ts`.
- **`/dashboard/admin/glitches` is live** (shipped under B2B-09, 2026-07-16) but has no nav entry — a
  separate orphan-nav gap this brief's nav trim should close.

## CRITICAL — Coordination With Sibling Brief B2B-16 (do not double-own)

`B2B-16` (Partner Dashboard Simplification — Configurator/API/Docs) is **being built in parallel** and
**overlaps this brief on four surfaces.** The BA and Orchestrator must sequence these two so neither
double-deletes nor leaves the other pointing at a 404. The overlap, precisely:

| Surface | B2B-16 owns | B2B-18 (this brief) owns |
|---|---|---|
| `app/dashboard/*` individual pages (plan, sessions, knowledge-base, phone, settings, schedule-setup, walkthrough) | **Deletes these** (its Remove List) | Not this brief — do **not** re-delete |
| `app/dashboard/layout.tsx` billing-redirect gate → `/plan` | **Deletes the gate** (its Approved Decision #1) | Depends on it — the gate must be gone before `/plan` is deleted here |
| `middleware.ts` `isPublicRoute` | Removes entries for the `/dashboard/*` + `/checkout` routes **it** deletes | Removes entries for `/onboarding`, `/topics`, `/plan`, `/pricing`, `/checkout` **this brief** retires |
| `components/dashboard/DashboardShell.tsx` `NAV_ITEMS` | Builds a **new additive** 3-item Configurator shell; explicitly does **not** trim DashboardShell's own nav | **Trims DashboardShell's `NAV_ITEMS`** to the live internal-admin set (this is the B2B-16 follow-up) |
| Individual-signup-chain coupling (`/plan`·`/checkout`) | **Raised it as its Open Question #1**, deliberately did not resolve | **Resolves it — retire the whole chain** (see below) |

**This brief's relationship to B2B-16's Open Question #1:** B2B-16 flagged, but did not answer, whether
`app/checkout/` can be removed in isolation or is coupled to retiring the whole individual-signup chain
(`app/onboarding`, `app/topics`, `app/plan`, `app/(marketing)/pricing`, `account-state`). **Arun's
instruction today resolves it: retire the entire chain.** This brief is that resolution. The BA must
decide the merge order with B2B-16 explicitly — the cleanest path is that **B2B-18 owns the whole
individual-signup chain retirement (including `/checkout`) and B2B-16 drops `/checkout` from its own
Remove List**, so one brief owns the chain end-to-end. BA to confirm and document the split; if
B2B-16 has already merged its `/checkout` deletion by the time this is built, adjust accordingly and
note it. **Do not let both briefs delete the same file, and do not let either delete a route the other
still references.**

## Scope

### 1. Retire the individual-signup chain (the core of "deadlinks")

Retire, after a rigorous importer/caller sweep (B2B-14/B2B-16 discipline — trace before deleting):

- `app/onboarding/`
- `app/topics/`
- `app/plan/`
- `app/checkout/`
- `app/(marketing)/pricing/`

Plus the wiring that funnels users into them:

- **`middleware.ts`** — remove these routes from the `isPublicRoute` allowlist (only the ones this
  brief actually deletes; coordinate the exact diff with B2B-16 so the two middleware edits compose
  cleanly rather than conflict).
- **Both Clerk auth pages** — `forceRedirectUrl="/onboarding"` must change to a valid destination
  under the current partner model. **The correct target is an open question — see Open Questions #2.**
  Do not assume `/onboarding` survives; it does not.
- **`app/api/onboarding/account-state/route.ts`** and any other route/component that only exists to
  drive this chain (e.g. `resumeUrl: '/plan'|'/checkout'`) — sweep and resolve.

**Shared-component caution (must verify, do not guess):** `components/plan/*` was flagged in
BACKLOG.md as "still used by the retained `app/plan/`" — but this brief *retires* `app/plan/`, so
`components/plan/*` may now become deletable. It may **also** be imported elsewhere (e.g.
`components/plan/ArcSection.tsx` / `TopicTree.tsx` appear in `app/dashboard/sessions/SessionsClient.tsx`
per SES-01 notes, which B2B-16 is deleting). The BA must grep every `components/plan/*`,
`components/dashboard/*`, and `components/kb/*` module against the **post-B2B-16, post-B2B-18** tree and
delete only true zero-importer orphans; anything still imported by the live partner path stays
untouched. Per Objective 5 + "no delete without approval," any module that looks orphaned but the BA
isn't certain about is **flagged as a named candidate, not silently deleted.**

### 2. MarketingNav "Pricing" link

Remove the `/pricing` nav `Link` from `components/marketing/MarketingNav.tsx` (its target page is being
deleted; B2B-15 already removed the homepage pricing *section*). **Recommendation: remove the nav item
entirely** — there is no current partner-facing pricing page to repoint to. BA to confirm and justify
(the only alternative, repointing to a future partner-pricing surface, does not exist yet and is not in
scope here).

### 3. Stale B2C copy on the homepage hero — COPY ONLY, hard boundary

Replace factually-wrong B2C copy in `app/(marketing)/page.tsx` (the "AI Readiness Platform" badge,
"5-question onboarding," "AI Readiness Score," "Email or SMS," the `PhoneMockup` SMS visual, the
15-seconds-a-day framing, and testimonial/CTA copy describing the retired individual product) with
**accurate, minimal, honest** copy about what Clio is now: API-driven partner voice-learning
infrastructure.

**Explicit boundary — do NOT cross it:** this is copy/content correction only. **Do not redesign the
homepage's layout, sections, or visual design.** A full homepage redesign is a **separate, frozen
backlog item** — `docs/b2b-pivot-status.md` (2026-07-16 entry: "Homepage redesign for the B2B pivot +
competitor research," explicitly "NOT started yet … wait for a separate 'go' signal"). This brief must
not touch that scope.

**Decision rule for the BA/Dev:** fix a stale phrase/visual **in place** only when it can be corrected
without restructuring its surrounding section. **If a piece of stale copy cannot be fixed without
redesigning its section, flag it as OUT of scope for this brief** (route it to the frozen redesign) —
do not redesign the section to make the copy fit. See Open Questions #1 for the judgment call on how
much of the hero is even separable from the redesign.

### 4. Trim `DashboardShell.tsx` `NAV_ITEMS` (the B2B-16 follow-up)

Reduce `components/dashboard/DashboardShell.tsx`'s `NAV_ITEMS` to only destinations that exist and are
relevant to an **internal Clio admin** now that the B2C end-user pages are gone. Remove the ~5 dead
entries (`/dashboard/plan`, `/dashboard/sessions`, `/dashboard/knowledge-base`, `/dashboard/phone`,
`/dashboard/settings`). **Do NOT delete `DashboardShell.tsx`** — it has live internal-admin importers
(`app/dashboard/admin/{clients,glitches,templates}`).

**Also close the orphan-nav gap for `/dashboard/admin/glitches`** — it is live (B2B-09) but currently
unreachable via nav. Its inclusion should coordinate with whatever the glitch-tracker work needs; per
`docs/b2b-pivot-status.md`, B2B-09 already shipped (2026-07-16), so the target route exists today. The
**exact trimmed nav contents are an open question — see Open Questions #3** (mostly derivable, but the
final admin-nav set and what `/dashboard` root resolves to are a light UX call).

### 5. `/admin/seed` — confirm keep-vs-delete, do not guess

Investigate what `app/admin/seed/` (a DB seed page with zero inbound links) actually does and whether
anyone still needs it (dev/seed tooling vs. dead B2C seeding). It is **likely** dead in production, but
confirm before deleting. Note the pre-launch-gate cousin `/api/admin/seed-topics` already flagged in
BACKLOG's PRE-LAUNCH GATE — coordinate so this doesn't conflict with that item. If uncertain, flag as a
named candidate rather than delete.

### 6. Retired-B2C API routes / copy orphan sweep

Sweep and resolve each item on BACKLOG.md's "B2B-16 — post-deletion orphan flags" list now that the
pages they served are (being) deleted: `app/api/topics/route.ts`, `app/api/plan/approve/route.ts`,
`app/api/sessions/schedule/route.ts`, `app/api/checkout/topup/route.ts` (SMS/email bodies), and stale
doc comments in `lib/content/live-conductor-client.ts` and
`app/api/sessions/acknowledge-adaptation/route.ts`. For each: grep for live callers; delete only true
orphans; **do not delete anything still called by the live partner/session engine** — flag those as
kept-with-reason. `app/api/sessions/schedule/route.ts` in particular is documented (SES-01/SESS-03) as
live session-engine infrastructure — verify carefully before assuming it's B2C-only; the flag is about
the **B2C copy inside it** (SMS/email bodies), not necessarily the route itself.

## Known Constraints

- **Sweep discipline (non-negotiable):** trace every importer/caller with grep before deleting any
  file — the B2B-14 / B2B-16 standard. "Orphaned by a deleted page" ≠ "dead" for engine/shared code.
- **Never delete shared engine code.** `lib/session-*`, `lib/content/*`, `HumeAdapter`, the
  session/curriculum/rtv `inngest` jobs, and `app/api/webhooks/*` handlers are shared with the **live
  partner path** — out of scope, untouched. Only the B2C page surfaces and their dead-only callers go.
- **`components/plan/*` fate must be verified precisely**, not assumed — it flips from "keep" to
  "candidate for removal" only *because* this brief retires `app/plan/`, and only if nothing else
  imports it after B2B-16 also lands.
- **Homepage: copy correction only, no redesign.** The redesign is a frozen, separately-gated item.
- **Do NOT delete `components/dashboard/DashboardShell.tsx`** — trim its nav only.
- **No new design language, no AI-generated copy** on any user-facing surface (CORE principle #4 /
  B2B-07 convention): the homepage replacement copy is hand-authored, honest, minimal.
- **Coordinate all four overlap surfaces with B2B-16** (table above) — merge order matters.
- **`no delete without approval`** still governs anything the sweep leaves *uncertain*: flag as a named
  candidate for Arun, don't auto-delete on a hunch.

## Questions for BA (Section 11 — genuine open items; resolve or escalate, do NOT guess)

Given the size, zero open questions is not required. These are legitimately open:

1. **How much of the homepage hero is separable from the frozen redesign?** The audit shows the hero is
   *substantially* B2C. The BA must draw the precise line between "discrete in-place copy/visual swaps
   that are safe now" and "can't be fixed without restructuring the section → defer to the frozen
   redesign." **Recommendation:** do the minimal honest-copy fix now (false claims about a retired
   product are a live credibility risk on `hello-clio.com`), but if the minimal fix can't be cleanly
   isolated from the redesign, **escalate to Arun** for a one-line call: minimal copy fix now, or leave
   the whole homepage untouched until the redesign. Do not guess the boundary.

2. **Clerk post-auth redirect target.** `forceRedirectUrl="/onboarding"` on both auth pages needs a new
   destination, since `/onboarding` is being deleted. `/partner-signup` (B2B-06's Clerk-Organizations
   `CreateOrganization` surface) may be **circular** as a post-*sign-in* target. The BA must trace the
   current B2B-06 self-serve partner flow (Clerk Organizations → onboarding wizard → Configurator) and
   determine the correct post-sign-in and post-sign-up destinations — likely
   `/dashboard/configurator` or the onboarding wizard, **not** `/onboarding`. Confirm against live code;
   escalate if the partner-auth flow is ambiguous.

3. **Exact trimmed `DashboardShell` nav set.** Recommendation: the live internal-admin destinations —
   `/dashboard/admin/clients`, `/dashboard/admin/templates`, `/dashboard/admin/glitches`, plus whatever
   `/dashboard` root now resolves to (B2B-14/16 pointed `app/dashboard/page.tsx` at a redirect —
   confirm the current target). Confirm the final set and label each; it's mostly derivable, but the
   ordering and the root-destination are a light UX call — document, don't invent.

4. **`/admin/seed` disposition.** Report what it does and who (if anyone) still needs it, then
   recommend keep-as-dev-tooling vs. delete. Coordinate with the PRE-LAUNCH GATE `seed-topics` item.

5. **B2B-16 merge-order / ownership split.** Confirm and document who owns `/checkout` deletion and the
   `middleware.ts` diff so B2B-16 and B2B-18 compose without conflict or a dangling 404 (see the
   Coordination section). If B2B-16's state at build time changes the split, note it explicitly.

Everything else — the chain-retirement decision, the sweep methodology, the nav trim, the MarketingNav
"Pricing" removal, and the copy-only homepage boundary — is specified above and is not open.

## QA Gate (for the Orchestrator / QA Agent, per governance)

Beyond the standard three gates (code review, automated tests, live browser UI functional testing on
`distill-peach.vercel.app`), Gate 1 (code review) for this brief must specifically confirm:

- The finalized deletion set **exactly** matches the BA's post-sweep "Files Changed" list, with **no
  residual references** to any deleted route (grep for `/onboarding`, `/topics`, `/plan`, `/checkout`,
  `/pricing` across the tree — zero live callers).
- `middleware.ts` and both Clerk auth pages' redirect diffs match the spec verbatim, and the
  `middleware.ts` change composes cleanly with B2B-16's.
- `DashboardShell.tsx` still exists and its trimmed nav lists only live routes (every entry resolves,
  `/dashboard/admin/glitches` present).
- The homepage change is **copy/visual-swap only** — no section restructure, verifiable in the diff.

Gate 3 (live UI) must include: a visitor cannot reach `/onboarding`/`/topics`/`/plan`/`/checkout`/
`/pricing` from any homepage or nav link (happy path), the "Pricing" nav item is gone, a fresh Clerk
auth lands on a valid partner destination (not `/onboarding`), and an internal admin sees no dead nav
links.
