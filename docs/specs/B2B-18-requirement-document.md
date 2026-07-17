# B2B-18 — Retire the B2C Individual-Signup Chain + Deadlink / Stale-Surface Cleanup — Requirement Document

Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-17
Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-17-retire-b2c-signup-chain-and-deadlink-cleanup.md`
Priority: P1

> **⚠ ID RENUMBER — READ FIRST (Orchestrator to ratify).**
> This brief was filed as **B2B-17** but has been **renumbered to B2B-18**, per the project's
> established "whichever claims an ID second renumbers to the next free ID" rule (also stated in this
> brief's own ID note). **Evidence:** two briefs both reached for B2B-17 today —
> `B2B-17-glitch-log-to-issue-tracker.md` (filed **10:15:22**) and this one,
> `B2B-17-retire-b2c-signup-chain-and-deadlink-cleanup.md` (filed **10:15:23**, i.e. **1 s later =
> second**). The glitch-log brief's Requirement Document already occupies the canonical
> `docs/specs/B2B-17-requirement-document.md` slot (written 10:25:03). B2B-18 was a free gap
> (briefs jump 16 → 17 → 17 → 19). This spec therefore takes **B2B-18** and is written to
> `docs/specs/B2B-18-requirement-document.md`; the sibling glitch-log spec was **not** touched.
> **Reading key for this document:** every "**this brief**" / "**B2B-17 (this brief)**" reference below
> denotes **B2B-18 = this document**. Every "**B2B-16**" reference denotes the partner-dashboard sibling
> (`B2B-16-partner-dashboard-simplification-configurator-api-docs.md`). The source Feature Brief file is
> still named `B2B-17-…` on disk — renaming the brief file is the Orchestrator's call.

> **Governance note.** Every deletion in this document is backed by a grep-verified importer/caller
> sweep run against the **current live tree** on 2026-07-17 (post-B2B-16). Where the sweep could not
> reach certainty, the item is listed as a **named candidate** (Section 10 / Section 11), not an
> auto-delete, per the standing `no delete without approval` rule. The chain-retirement itself is
> authorized by Arun's 2026-07-17 instruction + `CORE_OBJECTIVES.md` v3 (see brief).

---

## 1. Purpose

The retired B2C individual-subscriber surface is **still live and publicly reachable on
`hello-clio.com`**, and the internal-admin sidebar points at pages that were deleted in B2B-16. A
visitor today can walk `Pricing → /onboarding → /topics → /plan → /checkout`, and a fresh Clerk
sign-up is still force-redirected into the dead `/onboarding` flow. The homepage hero still advertises
a product Clio no longer sells ("AI Readiness Score," "15 seconds a day," SMS Y/N replies). Internal
admins see five nav links that all 404.

This feature retires the entire individual-signup chain, repoints the Clerk auth redirects to a valid
partner destination, removes the dead "Pricing" nav item, trims the internal-admin nav to only live
destinations, and corrects the factually-wrong homepage hero copy — **without** touching any surface
the live partner/session engine depends on and **without** crossing into the frozen homepage-redesign
scope.

**Failure without it:** Clio's public demo domain keeps funnelling prospects into a broken, retired
B2C funnel and making false product claims; internal admins keep hitting 404s; the codebase carries a
live, reachable dead-product surface that contradicts the v3 objective.

---

## 2. User Story

- **As a prospective partner visiting `hello-clio.com`,** I want the site to describe and route me into
  Clio's actual (partner) product, so that I never land on a broken B2C funnel or read claims about a
  product that no longer exists.
- **As a fresh Clerk sign-up,** I want to be taken to the current partner onboarding step, so that I end
  up creating my organization and reaching the Configurator — not the deleted `/onboarding` page.
- **As an internal Clio admin,** I want the dashboard sidebar to list only real, live admin
  destinations (Clients, Templates, Glitches), so that no nav link 404s.
- **As an engineer,** I want the dead B2C page surfaces and their dead-only callers removed cleanly with
  a verified sweep, so that the tree matches the v3 objective and no live partner code is disturbed.

---

## 3. Trigger / Entry Point

This is a cleanup/retirement feature — its "trigger" is the set of routes and surfaces it changes:

| Surface | Current trigger | After this brief |
|---|---|---|
| `/pricing`, `/onboarding`, `/topics`, `/plan`, `/checkout` | Public routes reachable via nav/CTAs/redirects | **Deleted** — return the platform's normal 404 |
| Clerk sign-up (via `/sign-up` and the "Sign up" link inside `/sign-in`) | Force-redirects to `/onboarding` | Force-redirects to `/partner-signup/organization` |
| `MarketingNav` "Pricing" link | Rendered in the marketing header | **Removed** |
| `DashboardShell` sidebar (internal admin) | 6 items, 5 of them 404 | 3 live admin items |
| Marketing homepage hero (`/`) | Live B2C copy/visual | Corrected copy (text swaps only) |
| `/admin/seed` | Zero inbound links; B2C topic seeder | **Deleted** (named candidate — see §11 Q4) |

State required: none of these routes require a logged-in state to reach today (all public); the
DashboardShell and Configurator remain Clerk-gated (unchanged).

---

## 4. Screen / Flow Description

This brief is predominantly **removal and copy correction**. Below, each affected surface is described
state-by-state.

### 4.1 The individual-signup chain (DELETE)

The following page routes are retired in full. After deletion, any request to them falls through to the
platform's standard Next.js 404 (there is **no** custom redirect or "moved" page — the brief's success
criterion is that they "return the platform's normal 404").

- `app/onboarding/` (`page.tsx`)
- `app/topics/` (`page.tsx`)
- `app/plan/` (`page.tsx`, `PlanClient.tsx`)
- `app/checkout/` (`page.tsx`, `CheckoutForm.tsx`)
- `app/(marketing)/pricing/` (`page.tsx`)

All internal cross-links **within** this chain die with it and need no separate edit (verified — see
Section 6 evidence list): `app/plan/PlanClient.tsx:87`, `app/checkout/page.tsx:384`,
`app/(marketing)/pricing/page.tsx:43,62,80`, `app/topics/page.tsx:621,683`, and the multiple
`/onboarding` references inside `app/onboarding/page.tsx` are all in deleted files.

### 4.2 Chain-only API routes + components (DELETE — orphaned by the above)

Verified zero live callers **after** the §4.1 deletions:

- `app/api/onboarding/account-state/route.ts` — sole caller is `app/onboarding/page.tsx` (deleted).
- `app/api/onboarding/route.ts` — sole caller is `app/onboarding/page.tsx` (deleted). **Note:**
  `lib/onboarding` (which this route imports) is **KEPT** — it has a second, live importer,
  `app/api/webhooks/clerk/route.ts`, which is out of scope (webhook handlers are untouched). Delete
  only the route, never `lib/onboarding`.
- `components/onboarding/*` — `ProgressBar.tsx`, `OptionButton.tsx`, `QuestionCard.tsx`,
  `AlreadySignedInInterstitial.tsx`. Sweep confirms the **only** live-tree importer is
  `app/onboarding/page.tsx` (deleted). (`.claude/worktrees/*` copies are isolated agent worktrees, not
  the live tree — ignore them.)
- `components/plan/*` — `ArcSection.tsx`, `LearningPathView.tsx`, `PlanSkeleton.tsx`,
  `RecommendationCard.tsx`, `SessionCard.tsx`, `TopicTree.tsx`. **Already a zero-importer cluster**
  (they only import each other). `app/plan/PlanClient.tsx` does **not** import them (it uses only
  `@/components/ui/Button`); their former importer was the B2B-16-deleted
  `app/dashboard/sessions/SessionsClient.tsx`. Repo-wide sweep confirms zero live-tree importers.

### 4.3 Clerk auth redirect repoint (EDIT)

The partner self-serve flow (verified against live code) is:

```
/partner-signup  (Clerk <SignUp forceRedirectUrl="/partner-signup/organization">)
    → /partner-signup/organization  (Clerk <CreateOrganization afterCreateOrganizationUrl="/dashboard/configurator">)
        → /dashboard/configurator  (server: if !onboarding_completed_at → /dashboard/configurator/wizard)
```

Both raw Clerk auth pages currently force new sign-ups into the deleted `/onboarding`:

- `app/(auth)/sign-in/[[...sign-in]]/page.tsx:9` — `fallbackRedirectUrl="/dashboard/configurator"`
  → **correct, KEEP** (this is the post-*sign-in* target).
- `app/(auth)/sign-in/[[...sign-in]]/page.tsx:10` — `signUpForceRedirectUrl="/onboarding"`
  → **change to `/partner-signup/organization`** (post-*sign-up-from-sign-in-widget* target).
- `app/(auth)/sign-up/[[...sign-up]]/page.tsx:9` — `forceRedirectUrl="/onboarding"`
  → **change to `/partner-signup/organization`**.

`/partner-signup/organization` (the `CreateOrganization` step) is the correct non-circular target: a
raw `/sign-up` creates the Clerk *user*; sending them to `CreateOrganization` completes the *same*
partner path that `/partner-signup` uses, and Clerk then lands them at `/dashboard/configurator`.
(Redirecting to `/partner-signup` — the `SignUp` step — **would** be circular; that is why the target
is the `/organization` sub-step, not `/partner-signup` itself.) See §11 Q2 for the full trace and the
one env-var confirmation owed to the dev.

### 4.4 MarketingNav "Pricing" link (EDIT — remove)

`components/marketing/MarketingNav.tsx` lines 34–41 render a `<Link href="/pricing">` with an
active-state style. Its target is deleted and B2B-15 already removed the homepage pricing *section*.
Remove the entire nav `<Link>` (not repoint) — there is no partner-facing pricing page to point to
today, and partner pricing is not in scope. The header retains "How it works," "Log in," and the
"Get started" → `/partner-signup` CTA (all unchanged).

### 4.5 DashboardShell nav trim (EDIT)

`components/dashboard/DashboardShell.tsx` is **KEPT** (live importers:
`app/dashboard/admin/{clients,glitches,templates}`). Only its `NAV_ITEMS` array (lines 19–26) is
trimmed. Current items (5 of 6 now 404 after B2B-16):

```
/dashboard              → redirects to /dashboard/configurator (partner surface)   [see §11 Q3]
/dashboard/plan         → 404
/dashboard/sessions     → 404
/dashboard/knowledge-base → 404
/dashboard/phone        → 404
/dashboard/settings     → 404
```

Trimmed set — only live `/dashboard/admin/*` destinations (all confirmed to exist):

```
/dashboard/admin/clients    label "Clients"
/dashboard/admin/templates  label "Templates"
/dashboard/admin/glitches   label "Glitches"   ← closes the B2B-09 orphan-nav gap
```

`MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5)` continues to work unchanged (now yields all 3). Icon imports
must be updated accordingly (see Section 5 wireframe + Section 6). The generic "Dashboard" → `/dashboard`
item is **dropped** — `/dashboard` redirects to `/dashboard/configurator`, a partner surface, not an
internal-admin home; keeping it would send internal admins into the partner Configurator. This is the
light UX call flagged in the brief (see §11 Q3) — documented, not invented; Arun/CEO may override the
ordering or add a home item.

### 4.6 Homepage hero copy correction — TEXT SWAPS ONLY (EDIT)

`app/(marketing)/page.tsx`. **Hard boundary: copy/label string swaps only, no JSX-structure, section,
or visual-layout change.** The full homepage redesign is a separate, frozen backlog item
(`docs/b2b-pivot-status.md`, 2026-07-16 entry) and must not be touched here.

The **boundary rule** (see §11 Q1): a stale phrase is fixed **in place** only if it is a string swap
inside existing markup. Anything that would require restructuring a section, adding/removing JSX
elements, or redesigning a visual is **OUT of scope** and routed to the frozen redesign.

**IN SCOPE — text-only swaps** (each is a plain string replacement, no element added/removed). Line
numbers are approximate — dev matches on the string, not the number:

| Location (approx line) | Current (false under v3) | Replacement (hand-authored, honest, minimal) |
|---|---|---|
| Badge, ~L47 | `AI Readiness Platform` | `Voice learning infrastructure` |
| Subheadline, ~L58 | `15 seconds a day. Zero jargon. Total confidence.` | `The AI voice layer for learning platforms. Turn any lesson into a live spoken session.` |
| Hero CTA, ~L64 | `Start free — 3-day trial` | `Get started` *(keep href `/partner-signup`)* |
| Trust signal 1, ~L79 | `5-question onboarding` | `API-first integration` |
| Trust signal 2, ~L80 | `Daily in your inbox` | `Live voice sessions` |
| Trust signal 3, ~L81 | `Cancel anytime` | `Usage-based pricing` |
| How-it-works step 1, ~L230 | `Answer 5 questions` / `Tell us your role… 15 seconds. Zero typing.` | `Connect your content` / `Bring your lessons in through the partner API. No rebuild required.` |
| How-it-works step 2, ~L236 | `Receive one insight daily` / `Personalized… Email or SMS. 15–20 seconds to read.` | `Clio narrates it live` / `Clio turns each lesson into a real, spoken voice session.` |
| How-it-works step 3, ~L242 | `Watch your score climb` / `Your AI Readiness Score grows as you engage.` | `Your learners converse` / `Learners ask questions and talk back — not just read.` |
| How-it-works subhead, ~L259 | `No courses. No commitment. Just one signal, every morning.` | `From static content to a live voice conversation — through one API.` |
| Testimonials heading, ~L326 | `Trusted by leaders who move fast` | `Built for learning platforms` |
| Testimonial quote B, ~L306 | `…my AI Readiness Score is 78.` | `…our completion rates climbed once lessons could talk back.` |
| Testimonial roles, ~L303/309/314 | `CEO, Fortune 500 Retail` etc. | Partner personas, e.g. `Head of Product, Learning Platform` (dev may keep placeholder framing) |
| Bottom CTA button, ~L385 | `Get started — 15 seconds to set up` | `Get started` *(keep href `/partner-signup`)* |

> The problem section ("Sound familiar?", ~L162–178) is generic AI-confidence copy that is **not**
> B2C-product-specific and is left unchanged.

**OUT OF SCOPE — routed to the frozen redesign** (cannot be fixed without restructuring):

- **`PhoneMockup` (SMS Y/N reply visual, ~L98/L106–154).** Its entire premise is the retired SMS
  "Reply Y/N" mechanic. Making it accurate is a visual redesign; removing it collapses the hero's
  two-column layout — both cross the frozen boundary. **This is the one item escalated to Arun** — see
  §11 Q1. Default if unanswered: leave `PhoneMockup` untouched (a no-op that is *not* a layout change),
  ship the text swaps now, defer the visual to the redesign. The build is **not** blocked on Q1.

### 4.7 `/admin/seed` (DELETE — named candidate, §11 Q4)

`app/admin/seed/page.tsx` is a zero-inbound-link dev page that seeds the consumer `topic_catalog`
(via `/api/admin/seed-topics`) and sets a B2C `users`-table profile (via `/api/topics`). The partner
Configurator uses a **separate** system (`/api/admin/configurator/topics-config`) and does not touch
`topic_catalog` — verified. Recommendation: **delete the page.** The `/api/admin/seed-topics` route
itself is **left to the existing PRE-LAUNCH GATE item that already owns it** (avoid double-owning); note
that deleting the page removes its only UI caller.

### 4.8 Section-6 stale-copy / orphan sweep (EDIT / candidate DELETE)

See Section 6 for the exact per-file dispositions.

---

## 5. Visual Examples (text wireframes)

### 5.1 MarketingNav — after "Pricing" removal

```
┌───────────────────────────────────────────────────────────────┐
│  Clio AI          How it works          Log in  [ Get started →]│
└───────────────────────────────────────────────────────────────┘
   (was:  Clio AI    How it works   Pricing    Log in  [Get started →])
```

### 5.2 Homepage hero — after text swaps (structure unchanged)

```
┌───────────────────────────── HERO (min-h-screen, unchanged layout) ─────────────────────────────┐
│  [Badge: "Voice learning infrastructure"]                    ┌───────────────────────┐          │
│                                                              │  PhoneMockup           │          │
│  Meet Clio.                          (gradient on "Clio.")   │  (⚠ §11 Q1: left as-is │          │
│                                                              │   pending Arun's call) │          │
│  "The AI voice layer for learning platforms. Turn any        │                        │          │
│   lesson into a live spoken session."                        │                        │          │
│                                                              └───────────────────────┘          │
│  [ Get started → ]   See how it works ↓                                                          │
│                                                                                                  │
│  ⚡ API-first integration    ✉ Live voice sessions    ✕ Usage-based pricing                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 How-it-works — after text swaps (3-step layout unchanged)

```
   (1) Connect your content        (2) Clio narrates it live      (3) Your learners converse
   Bring your lessons in through   Clio turns each lesson into     Learners ask questions and
   the partner API. No rebuild.    a real, spoken voice session.   talk back — not just read.
```

### 5.4 DashboardShell sidebar — after nav trim

```
┌──────────────────┐
│  Clio AI         │
│                  │
│  ▸ Clients       │  → /dashboard/admin/clients
│  ▸ Templates     │  → /dashboard/admin/templates
│  ▸ Glitches      │  → /dashboard/admin/glitches
│                  │
│  ── (user) ──    │
│  [UserButton]    │
└──────────────────┘
   (was 6 items; 5 of them 404: /dashboard/plan, /sessions, /knowledge-base, /phone, /settings)
```

### 5.5 Fresh Clerk sign-up redirect (after repoint)

```
/sign-up  ──(forceRedirectUrl)──▶  /partner-signup/organization  ──(CreateOrganization)──▶  /dashboard/configurator
   (was: /sign-up ──▶ /onboarding [DELETED → would 404])
```

### 5.6 Retired route end-state

```
GET /pricing | /onboarding | /topics | /plan | /checkout
   ──▶  Next.js standard 404 (no custom redirect, no "moved" page)
```

---

## 6. Data Requirements

This feature is structural (route/nav/copy). No schema changes, no new DB reads/writes, no new API
calls introduced. The only "data" concerns are the **existing** DB reads inside routes being deleted or
swept — none of which are altered in behaviour for surviving code.

### 6.1 Exact edit set (wiring — files that are EDITED, not deleted)

| # | File | Change |
|---|---|---|
| E1 | `middleware.ts` | Remove exactly these 5 entries from `isPublicRoute`: `'/pricing(.*)'`, `'/onboarding(.*)'`, `'/plan(.*)'`, `'/checkout(.*)'`, `'/topics(.*)'`. Keep everything else (esp. `/sign-in`, `/sign-up`, `/partner-signup`, `/questionnaire`, all `/api/*`). |
| E2 | `app/(auth)/sign-up/[[...sign-up]]/page.tsx:9` | `forceRedirectUrl="/onboarding"` → `forceRedirectUrl="/partner-signup/organization"` |
| E3 | `app/(auth)/sign-in/[[...sign-in]]/page.tsx:10` | `signUpForceRedirectUrl="/onboarding"` → `signUpForceRedirectUrl="/partner-signup/organization"`. **Do not** change line 9 `fallbackRedirectUrl` (already correct). |
| E4 | `components/marketing/MarketingNav.tsx` | Remove the `<Link href="/pricing">…</Link>` block (lines 34–41). |
| E5 | `components/dashboard/DashboardShell.tsx` | Replace `NAV_ITEMS` with the 3 admin items (§4.5). Update icon imports (drop `LayoutDashboard, Settings, BookOpen, CalendarDays, Phone, Library`; add e.g. `Building2` Clients, `LayoutTemplate` Templates, `Bug` Glitches — dev picks from lucide-react). Remove the `hasBadge`/`planPending` plan-badge logic that referenced `/dashboard/plan` (now dead). |
| E6 | `app/(marketing)/page.tsx` | Text-only swaps per §4.6 table. **No** JSX-structure change. `PhoneMockup` untouched pending §11 Q1. Remove any icon import left unused by the label swaps. |

### 6.2 Deletion set (files/dirs DELETED)

Confirmed zero live-tree importers/callers (post-B2B-16, and post-§6.1 for the chain-internal ones):

```
app/onboarding/                              (page.tsx)
app/topics/                                  (page.tsx)
app/plan/                                    (page.tsx, PlanClient.tsx)
app/checkout/                                (page.tsx, CheckoutForm.tsx)
app/(marketing)/pricing/                     (page.tsx)
app/api/onboarding/account-state/route.ts    (sole caller = app/onboarding)
app/api/onboarding/route.ts                  (sole caller = app/onboarding; lib/onboarding KEPT)
components/onboarding/                        (ProgressBar, OptionButton, QuestionCard, AlreadySignedInInterstitial)
components/plan/                              (ArcSection, LearningPathView, PlanSkeleton, RecommendationCard, SessionCard, TopicTree)
app/admin/seed/                              (page.tsx — named candidate, §11 Q4)
```

### 6.3 Section-6 orphan-flag sweep (per-file disposition)

Evidence gathered 2026-07-17. Dev **must re-run** each grep at build time (B2B-16 may still be
settling) and adjust:

| File | Finding | Disposition |
|---|---|---|
| `app/api/topics/route.ts` | Both callers (`app/topics/page.tsx`, `app/admin/seed/page.tsx`) are deleted by this brief. Stale copy at `:208` links to `/dashboard/plan`. | **DELETE candidate** — fully orphaned after §6.2. Verify zero callers, then delete. If any caller survives, instead fix the `:208` `/dashboard/plan` URL. |
| `app/api/plan/approve/route.ts` | Referenced by `app/api/sessions/schedule/route.ts` (session engine). Stale `/dashboard/plan` copy at `:282`, `:330`. | **KEEP route** (session-engine-adjacent). **FIX** the stale `/dashboard/plan` URLs in the SMS/email bodies — repoint to a valid destination, or remove the dead message block if the send path is confirmed dead (Twilio/SMS cadence is retired). |
| `app/api/sessions/schedule/route.ts` | Documented live session infra (SES-01/SESS-03). Stale `/dashboard/sessions` copy at `:116`. | **KEEP route.** **FIX** the `:116` `/dashboard/sessions` URL only (the flag is the copy, not the route). |
| `app/api/checkout/topup/route.ts` | Stale `/dashboard/sessions` copy at `:46`. Caller `components/ui/TopUpModal.tsx` has **no live renderer** found. | **FIX** the `:46` copy. Route + `TopUpModal` = **candidate** — verify no partner-billing renderer before any delete; flag if uncertain. |
| `app/api/sessions/acknowledge-adaptation/route.ts` | Stale doc-comment at `:7` references `/dashboard/sessions`. | **KEEP route.** **FIX** the doc comment. |
| `lib/content/live-conductor-client.ts` | Flagged for a stale doc comment referencing a deleted `/dashboard/*` page (grep for `/dashboard/` in-file to locate). | **KEEP file** (live-session engine). **FIX** the stale doc comment only. |

### 6.4 Named candidates — flag, do NOT auto-delete (Section 10 / §11)

- `lib/learning/taxonomy` — still imported by `app/api/admin/seed-topics/route.ts`,
  `app/api/topics/catalog/route.ts`, `app/api/topics/catalog/add/route.ts` (plus the deleted
  `app/onboarding`). **KEEP** while those routes live; re-evaluate if/when they go.
- `app/api/topics/catalog/route.ts`, `app/api/topics/catalog/add/route.ts` — B2C topic-catalog routes;
  Configurator does not use them. Post-deletion orphan candidates — flag, don't delete in this brief.
- `components/ui/TopUpModal.tsx` — no live renderer found; candidate (see §6.3).
- `components/dashboard/ScheduleCard.tsx` — referenced by `app/api/user/schedule-prefs/route.ts`
  (BACKLOG "verify import-vs-comment"; an API route importing a React component is suspicious). Verify;
  if the reference is a dead comment/type-only, ScheduleCard becomes an orphan candidate.

---

## 7. Success Criteria (Acceptance Tests)

Each is verifiable by grep, `tsc`, `next build`, or a live-UI check.

1. **✓ Given** the merged branch, **when** `git ls-files` is inspected, **then** none of
   `app/onboarding/`, `app/topics/`, `app/plan/`, `app/checkout/`, `app/(marketing)/pricing/`,
   `app/api/onboarding/account-state/`, `app/api/onboarding/route.ts`, `components/onboarding/`,
   `components/plan/`, `app/admin/seed/` exist.
2. **✓ Given** the tree, **when** grepping for live route strings —
   `grep -rn "'/onboarding\|'/topics'\|'/plan'\|'/checkout'\|'/pricing" app components lib --include=*.ts --include=*.tsx`
   (excluding `.claude/worktrees/`) — **then** there are **zero** matches in surviving files
   (every prior match was either in a deleted file or one of the E1–E6 edits).
3. **✓ Given** `middleware.ts`, **when** read, **then** `isPublicRoute` contains none of
   `'/pricing(.*)'`, `'/onboarding(.*)'`, `'/plan(.*)'`, `'/checkout(.*)'`, `'/topics(.*)'`, and still
   contains `'/sign-in(.*)'`, `'/sign-up(.*)'`, `'/partner-signup(.*)'`, `'/questionnaire'`, and all
   pre-existing `/api/*` entries.
4. **✓ Given** both Clerk auth pages, **when** read, **then** neither contains `"/onboarding"`;
   `sign-up` has `forceRedirectUrl="/partner-signup/organization"`, `sign-in` has
   `signUpForceRedirectUrl="/partner-signup/organization"` **and** retains
   `fallbackRedirectUrl="/dashboard/configurator"`.
5. **✓ Given** `MarketingNav.tsx`, **when** rendered, **then** there is no "Pricing" link and no
   `href="/pricing"`; "How it works," "Log in," and "Get started" → `/partner-signup` remain.
6. **✓ Given** `DashboardShell.tsx`, **when** read, **then** the file still exists, `NAV_ITEMS` lists
   exactly `/dashboard/admin/clients`, `/dashboard/admin/templates`, `/dashboard/admin/glitches`
   (each an existing route), and no entry points at `/dashboard/plan|sessions|knowledge-base|phone|settings`.
7. **✓ Given** `app/(marketing)/page.tsx`, **when** the diff is reviewed, **then** it contains **only**
   text/string changes (no added/removed JSX elements, no changed class layout) — the copy-only boundary
   is verifiable in the diff; `PhoneMockup` is unchanged unless §11 Q1 was answered otherwise.
8. **✓ Given** the whole tree, **when** grepping the section-6 files for `/dashboard/plan` and
   `/dashboard/sessions`, **then** every surviving occurrence has been repointed or removed (zero stale
   links to deleted dashboard pages remain in shipped code).
9. **✓ Given** the branch, **when** `npx tsc --noEmit` and `npm run build` run, **then** both pass with
   zero errors (no dangling imports from deleted files).
10. **✓ (Live UI, `distill-peach.vercel.app`)** **Given** a visitor on the homepage, **when** they use
    any nav link or CTA, **then** there is no reachable path to `/onboarding`/`/topics`/`/plan`/
    `/checkout`/`/pricing` (each returns 404 if typed directly); the "Pricing" nav item is absent.
11. **✓ (Live UI)** **Given** a brand-new Clerk sign-up, **when** it completes, **then** the user lands
    on `/partner-signup/organization` (Create Organization), **not** `/onboarding`.
12. **✓ (Live UI)** **Given** an internal admin signed into `/dashboard/admin/*`, **when** they view the
    sidebar, **then** every nav link resolves (no 404), and "Glitches" is present.

---

## 8. Error States

This feature removes surfaces; the main "error" concern is a **dangling reference** (a surviving file
importing or linking a deleted one), which would surface as a build/type error or a runtime 404.

- **Dangling import after deletion:** caught by AC-9 (`tsc --noEmit` + `next build`). If any surfaces,
  the referencing file was missed by the sweep — re-run §6 greps, resolve, do not merge red.
- **Direct navigation to a deleted route:** expected outcome is the platform's **standard 404** — this
  is intended, not an error to handle. No custom 404, redirect, or "this moved" page is added.
- **Clerk redirect to a now-missing target:** mitigated by AC-4/AC-11 — the repointed target
  (`/partner-signup/organization`) is a live route (verified present). Dev must also confirm no env var
  (`NEXT_PUBLIC_CLERK_SIGN_UP_URL` / `*_AFTER_SIGN_UP_URL`) independently forces `/onboarding` (see
  §11 Q2 — env file was permission-inaccessible to the BA; dev verifies at build).
- **Section-6 message paths:** if an SMS/email body's `/dashboard/*` URL is repointed rather than
  removed, ensure the new URL resolves; if the send path is dead (Twilio retired), removing the block
  is preferred over repointing to another dead link.
- **No loading/slow-network states apply** — nothing async is added.

---

## 9. Edge Cases

- **A returning B2C user with a bookmark to `/plan` or `/checkout`:** gets a 404. Acceptable and
  intended per v3 (B2C is retired). No redirect is provided (brief's explicit success criterion).
- **`.claude/worktrees/*` copies** of the deleted files/importers: these are isolated agent worktrees,
  **not** the live tree. They will still contain references and must be **excluded** from all sweep
  greps and left untouched — they are not shipped.
- **B2B-16 still mid-flight at build time:** if B2B-16 has *not* finished, re-verify that the
  `app/dashboard/*` individual pages are already gone and `app/dashboard/layout.tsx`'s billing gate is
  already removed (both confirmed present-state on 2026-07-17) before deleting `/plan`. If B2B-16 has
  meanwhile claimed `/checkout` deletion, drop `/checkout` from this brief's delete set (see §11 Q5).
- **Fresh sign-up hitting the Configurator before its org webhook lands:** already handled by the
  existing `NoPartnerAccounts` transient state on `/dashboard/configurator` (B2B-06) — unchanged by
  this brief.
- **Internal admin on mobile:** `MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0,5)` now yields the 3 admin items —
  bottom bar renders 3, no empty slots, no dead links.
- **`topic_catalog` read by some non-Configurator engine path:** the reason `/admin/seed` deletion is a
  *named candidate* (§11 Q4) — dev confirms `topic_catalog` has no live partner-path reader before
  deleting the seeder page.

---

## 10. Out of Scope

- **Homepage layout / section / visual redesign** — frozen, separately-gated
  (`docs/b2b-pivot-status.md`, 2026-07-16). Only text/label swaps are in scope; `PhoneMockup` and any
  structural change are explicitly deferred.
- **Deleting `DashboardShell.tsx`** — KEEP; nav trim only.
- **Deleting or modifying `lib/onboarding`, `lib/learning/taxonomy`, `lib/content/*`, `lib/session-*`,
  `HumeAdapter`, the session/curriculum/rtv Inngest jobs, or any `app/api/webhooks/*` handler** — shared
  live-partner-path/engine code, untouched.
- **Deleting the `/api/admin/seed-topics` route** — owned by the existing PRE-LAUNCH GATE item; only the
  `/admin/seed` *page* is in scope here.
- **Building a partner-facing pricing page** — none exists; not in scope (why the "Pricing" nav item is
  removed, not repointed).
- **Section-6 route deletions beyond confirmed orphans** — `plan/approve`, `sessions/schedule`,
  `checkout/topup`, `acknowledge-adaptation`, `live-conductor-client` routes are **kept**; only their
  stale copy is corrected.
- **`components/ui/TopUpModal.tsx`, `components/dashboard/ScheduleCard.tsx`,
  `app/api/topics/catalog/*` deletions** — named candidates only (Section 6.4); not deleted in this
  brief unless the dev's build-time sweep proves zero importers *and* Arun signs off.

---

## 11. Open Questions

Per the brief, zero open questions is not required given the size. Four of the five brief-flagged
questions are **resolved with direct code evidence**; one narrow item (the `PhoneMockup` visual) is
**escalated to Arun** with a safe, non-blocking default. (A sixth, separate item — the **B2B-17 ID
collision** — is resolved in the header banner: this brief renumbers to **B2B-18**; Orchestrator to
ratify.)

**Q1 — Homepage hero: how much is separable from the frozen redesign? — RESOLVED (boundary) + one
narrow escalation.**
Resolution: the boundary is "**string swaps in, structural/visual changes out**." All the text/label
fixes in the §4.6 IN-SCOPE table are pure string swaps inside existing markup and are safe now. The
**only** genuinely-coupled item is the **`PhoneMockup` SMS visual** — it cannot be made accurate without
a visual redesign, and removing it collapses the two-column hero layout; both cross the frozen boundary.
**Escalated to Arun, one-line call:** *For the SMS-thread PhoneMockup on the hero specifically — (a)
leave it untouched until the redesign (ship the text fixes now), (b) remove it now (accepting the
right-column collapses — a minor layout change), or (c) hold the whole homepage until the redesign?*
**Default if unanswered (build proceeds): (a)** — ship the text swaps, leave `PhoneMockup` for the
redesign. This does **not** block the build. — NEEDS ANSWER FROM: Arun (confirmation only; default
unblocks).

**Q2 — Clerk post-auth redirect target — RESOLVED.**
Traced live: partner self-serve flow is `/partner-signup` (SignUp) → `/partner-signup/organization`
(CreateOrganization, `afterCreateOrganizationUrl="/dashboard/configurator"`) → `/dashboard/configurator`
(wizard gate). Correct targets: **post-sign-in** stays `/dashboard/configurator` (already set on
`/sign-in`); **post-sign-up** (both the `/sign-up` `forceRedirectUrl` and `/sign-in`
`signUpForceRedirectUrl`) → **`/partner-signup/organization`** (non-circular; completes org creation).
`/sign-in` remains a live entry point (MarketingNav "Log in" + unauthenticated redirects); `/sign-up`
remains reachable via the Clerk `<SignIn>` widget's "Sign up" link — so the pages **stay**, only the
redirect props change. **One residual dev check:** the BA could not read `.env.local.example`
(permission-denied). Dev must confirm no `NEXT_PUBLIC_CLERK_SIGN_UP_URL` / `*_AFTER_SIGN_UP_URL` env var
independently points at `/onboarding`; if it does, update it to match. This is a build-time verification,
not a product ambiguity — no escalation needed.

**Q3 — Exact trimmed `DashboardShell` nav set — RESOLVED.**
Final set (all verified live): `/dashboard/admin/clients` "Clients", `/dashboard/admin/templates`
"Templates", `/dashboard/admin/glitches` "Glitches". The generic "Dashboard" → `/dashboard` item is
dropped because `/dashboard` redirects to `/dashboard/configurator` (a partner surface, not an
internal-admin home). Ordering Clients → Templates → Glitches. This is the "light UX call" the brief
noted — documented, not invented; Arun/CEO may reorder or add a home item at spec review.

**Q4 — `/admin/seed` disposition — RESOLVED (delete recommended, named candidate).**
It seeds the consumer `topic_catalog` and sets a B2C `users` profile; zero inbound links; the partner
Configurator uses a separate `topics-config` system (verified — does not touch `topic_catalog`).
Recommendation: **delete the `app/admin/seed/` page.** Leave `/api/admin/seed-topics` to the existing
PRE-LAUNCH GATE item (no double-owning). Guard: confirm no live partner-path code reads `topic_catalog`
before deleting (that guard is why it's a named candidate, not a silent delete).

**Q5 — B2B-16 merge-order / ownership split — RESOLVED / CLOSED.**
Verified against current live code (2026-07-17): (1) `middleware.ts` was **not** modified by B2B-16 —
it still lists all five B2C routes, so **this brief owns the entire middleware trim**, no conflict. (2)
`app/checkout/` still exists — B2B-16 did **not** delete it, so **this brief owns `/checkout`
end-to-end**; B2B-16 dropped it from its Remove List. (3) The billing-redirect gate in
`app/dashboard/layout.tsx` is **already removed** by B2B-16 (confirmed in-file), so the dependency
"gate gone before `/plan` deleted" is **satisfied**. (4) `DashboardShell` nav was **not** trimmed by
B2B-16 — this brief owns it. (5) B2B-16's `app/dashboard/*` individual pages are **already deleted**, so
there is no double-delete risk (this brief touches no `app/dashboard/*` page). **Conclusion: no open
coordination remains** — this brief has a clean, non-conflicting remit. (If B2B-16 is somehow re-run and
reclaims `/checkout`/`middleware`, revert to the split in the brief's Coordination table; but current
state needs no such reconciliation.)

**All other product decisions** (the chain-retirement, sweep methodology, nav trim, MarketingNav
"Pricing" removal, copy-only homepage boundary) are specified above and are **not** open.

> **Gate note for the Orchestrator:** the only items still needing Arun are (i) the ID-renumber
> ratification (header banner — B2B-17 → B2B-18) and (ii) Q1's `PhoneMockup` confirmation, which ships
> with a safe default that does not block the build. Per the brief ("zero open questions is not required
> given the size") this spec is buildable on the default; surface both to Arun in parallel.

---

## 12. Dependencies

- **B2B-16 must have landed its `app/dashboard/*` individual-page deletions and the
  `app/dashboard/layout.tsx` billing-gate removal** — **CONFIRMED present** in the live tree on
  2026-07-17 (individual pages absent; gate removed). No blocking dependency remains; re-verify only if
  B2B-16 is re-run (see §11 Q5).
- **`/partner-signup/organization` must exist** as the Clerk redirect target — **CONFIRMED** present
  (`app/partner-signup/organization/page.tsx`, B2B-06).
- **`/dashboard/admin/{clients,templates,glitches}` must all exist** as nav targets — **CONFIRMED**
  present (glitches shipped under B2B-09, 2026-07-16).
- **ID reconciliation** — Orchestrator ratifies the B2B-17 → B2B-18 renumber (header banner) and,
  optionally, renames the source brief file on disk. Not a build blocker.
- **Standard three QA gates** apply (code review, automated tests, live UI on `distill-peach.vercel.app`),
  plus the brief's Gate-1 and Gate-3 specifics (Section 7 ACs 1–8 and 10–12 respectively).
- **No new packages, env vars, DB migrations, or vendor approvals** are required by this feature.
