# Clio — Current Product Backlog
_Last updated: 2026-06-23 | Source of truth for active work_

---

## How to read this

- **P0** — Blocker. Nothing downstream works without this.
- **P1** — Core feature. Ships in the next sprint.
- **P2** — Enhancement. Queued after P1.
- **Status**: `Not started` | `In progress` | `CEO brief done` | `BA spec needed` | `Approved, build ready` | `Done`

---

## 🔄 B2B PIVOT IN PROGRESS — see `docs/b2b-pivot-status.md`

Clio is pivoting from B2C (direct-to-executive) to B2B/B2B2C (API integration layer for partner
platforms like Pluralsight, white-label Designer for partners like Capgemini). B2C is being killed,
not paused. Full requirements, decisions, and objective-impact analysis: `docs/brainstorm-b2b-platform-pivot.md`.
**Live orchestration status (updated in real time): `docs/b2b-pivot-status.md`.**

Until B2B-01 (Core Objectives rewrite) lands, `CORE_OBJECTIVES.md` still reflects the old B2C
framing — do not treat it as current without cross-checking the pivot status doc.

**2026-07-17 — Arun restated the final core objective directly**: Clio is API-driven AI Voice
Learning Infrastructure with an exclusive scope (initiate call → title/subtitle/content as HTML
pages or images with transition triggers → headless-browser render during the call → bot
explains/transitions → transcript capture → call end → post-call insights + a trackable glitches
log). Per-minute pricing, needs real analysis (ties to F-02 below). CEO Agent dispatched for a
CORE_OBJECTIVES.md v3 rewrite + a gap analysis of every existing B2B feature against this scope.
See `docs/b2b-pivot-status.md` for status.

---

## 🎨 STANDING STORY — Responsive/mobile-friendly by default (active, ongoing, never "done")

**Arun's instruction, 2026-07-17, verbatim**: "i dont want you to audit entire application now, but
whenever we make any future modifications in any screens, double check this and implement this while
making other changes in the screen. this is should be a new story in the backlog with active
tracking."

**This is a standing policy, not a one-time task — do not close it.** No upfront audit of the whole
app. Instead: every time any future work touches a screen for an unrelated reason, that screen must
also be brought up to a genuinely responsive, smooth, mobile-friendly bar as part of the same change,
before considering the work done. This applies to Orchestrator-dispatched builds and any direct edits
alike.

**Bar to meet, per screen, when touched:**
- Renders correctly and usably from mobile width up through desktop (no horizontal scroll, no
  clipped/overlapping content, tap targets sized for touch).
- Transitions/interactions feel smooth (matches the design-quality bar set in B2B-20's Configurator
  left-nav redesign — Framer Motion where already in use, no janky reflow).
- No regression to desktop — this is "also make it responsive," not "redesign for mobile only."

**Active tracking — update this table the instant a screen is touched for other reasons, don't batch:**

| Screen / area | Responsive status | Last touched |
|---|---|---|
| Marketing homepage (`app/(marketing)/page.tsx`) | Not yet verified | B2B-18 (copy only, layout untouched) |
| `/partner-signup`, `/partner-signup/organization` | Not yet verified | 2026-07-17 (route-structure fixes only) |
| Configurator — left-nav layout | **In scope, being built now** — B2B-20 | 2026-07-17 |
| Configurator shared shell (`_shared.tsx` `ConfiguratorShell`/`ConfiguratorNavShell`) | **Fluid-width mechanism fixed** — hard `maxWidth: 960` cap replaced with `clamp()`-based `SHELL_CONTENT_STYLE` (16–32px padding, 640–1900px width), shared via CSS custom property so `ConfiguratorSurface.tsx`'s padding-cancel composes correctly at every width. This is the reusable pattern going forward for any new shell wrapper needing fluid columns. Typography/spacing-rhythm/type-scale polish is explicitly deferred to the follow-on `/design-review` pass (not in scope for B2B-23). | B2B-23 |
| Configurator — Questionnaire/Topics/Content/Domain/Integration screens | Shell-level fluid width inherited from the fix above (their standalone routes still render inside `ConfiguratorShell`); section-internal responsiveness not yet audited | B2B-23 (shell only) |
| API page, Docs page | Shell-level fluid width inherited from the fix above (both render inside `ConfiguratorNavShell`); section-internal responsiveness not yet audited | B2B-23 (shell only) / B2B-16 |
| Internal admin (`/dashboard/admin/*`) | Not yet verified | various |
| `/dashboard/admin/sales-partners` (list) | Compliant — verified as part of B2B-34 Part E. Already used fluid layout primitives (`max-w-6xl mx-auto`, no hardcoded pixel-width caps, `overflow-x-auto` on the table); the new "Minutes (30d)" column reuses the same primitives, no new hardcoded width introduced. | B2B-34 Part E |
| `/dashboard/admin/sales-partners/[id]` (detail) | Compliant — verified as part of B2B-34 Part E. Already used fluid layout primitives (`max-w-4xl mx-auto`, no hardcoded pixel-width caps); the new "Usage" card and its breakdown table reuse the same primitives plus `overflow-x-auto`, no new hardcoded width introduced. | B2B-34 Part E |
| `/partner-render/[clio_session_ref]` (live session view) | Not yet verified | B2B-19 |
| `/partner-questionnaire/[partner_account_id]` (public, end-user-facing) | Not yet verified | B2B-03 |

Add rows as new screens are built; update "Responsive status" to `Verified` (with the brief/commit
that verified it) the moment a screen is confirmed to meet the bar above.

---

## 🔌 B2B-23 WS-3 — content-source auth gaps (documented, not built)

Identified during the B2B-23 content-auth documentation/gap audit (`app/dashboard/configurator/docs/DocsClient.tsx`
"Content & image auth" section). Both are real gaps, confirmed against `lib/partner/content-sources.ts` and the
`POST /api/partner/v1/content-sources` Zod schemas — documented on the Docs page as "not yet supported," not
silently absorbed, and not built in B2B-23 (out of scope per the approved spec §10):

- **API-key-in-query-string auth** (e.g. `?api_key=...`) — `static_bearer` only supports header-based keys today.
  Some partner content/image APIs use query-param keys instead. Candidate fast-follow: a new `auth_type` (e.g.
  `query_param`) or an extension to `static_bearer` supporting a query-param placement mode.
- **Multiple/custom static headers per content source** — only a single configurable header name/value pair
  (`static_bearer`'s `header_name`/`header_scheme`) is supported; some partner APIs require more than one custom
  header. Candidate fast-follow: a `headers: Record<string,string>[]` shape on `static_bearer` (or a new auth type).

Neither gap blocks the API-driven milestone's viability (most content/image URLs use header-based bearer auth or
no auth), so neither required CEO escalation — both are logged here as candidate engineering work only.

---

## 🅿️ BACKLOG — explicitly not to build yet, awaiting a dedicated brainstorm

- **Super admin page (Arun)** — full cross-partner visibility/control, distinct from the existing
  internal-admin pages which currently have no real role-based access control beyond generic Clerk
  login (flagged separately in the 2026-07-17 feature audit — needs its own fix regardless of this
  item's timeline).
- **Sales-partner legal agreement + e-signature (DocuSign)** — **UPDATED 2026-07-19**: the rest of
  "Sales-partner (reseller) system" this item originally referred to is now built (B2B-21/25/26/27/28
  — onboarding, revenue-share % tracking, invite-only direct partners). Only the legal-document piece
  remains deferred, and now has a written CEO Feature Brief ready to resume from:
  `.claude/agents/clio/feature-briefs/B2B-30-sales-partner-agreement-document-generation-esignature.md`.
  Arun's 2026-07-19 instruction: "we can prioritize later. keep it in the backlog. we will brainstorm
  and generate the content and then i can review with a lawyer and give you the final document which
  we will continue to use it while onboarding the sales partner or partner. integration with docusign
  or any other tool you recommend, we can brainstorm and build it later." Do not dispatch a BA against
  B2B-30, and do not build any document-generation/e-signature mechanism, until Arun explicitly
  restarts this thread. `docusign-esign` was pre-approved in `CLAUDE.md`'s library list for whenever
  this resumes.
- **Meeting-platform bot admission (Google Meet / Teams / Zoom knock-and-admit prompt)** — Arun
  reported the meeting bot (Attendee.dev by default, Recall.ai as rollback — see
  `lib/meeting-bot/provider.ts`) shows up as an unverified/"risky" participant in Google Meet's 2026
  two-queue admission model, requiring a manual host override to admit it, with the admit option
  sometimes not obviously surfaced. Researched 2026-08-02 (see item 8,
  `docs/2026-08-02-farewell-narration-findings.md`): this is host/Workspace-side meeting config, not a
  Clio code fix — Meet's "confirmed users" queue auto-admits calendar-invited participants, so the
  likely lever is inviting the bot's own join identity/email (if the vendor exposes one) as an actual
  guest on the calendar event, rather than just pasting the raw Meet link — not yet confirmed whether
  Attendee.dev/Recall.ai expose such an identity. Teams and Zoom have their own, less favorable
  versions (Teams still gates *detected bots* even with lobby-bypass open; Zoom's Waiting Room has no
  bot exception at all). **Explicitly deprioritized by Arun 2026-08-02**: "lets discuss more once the
  last [transition-silence fix] is done... its not priority." Do not pick this up until that item
  closes and Arun revisits it directly.
- **Showcase tab full removal (channel-partner dashboard)** — **2026-08-12**: during a sales-partner
  dashboard tab review, Arun confirmed Showcase (`/dashboard/channel-partner/showcase` — an internal
  demo-prep tool: title/subtitle/script content + a Visualization sub-tab, used to prep a canned demo
  for prospective partners, gated behind an allowlist toggle so ordinary sales-partners never see it)
  isn't a partner-facing feature and shouldn't be offered. Per Arun: disable it now (nav tab hidden,
  routes/code left intact and reversible), full deletion deferred to a later pass. Nav entry disabled
  in `app/(with-clerk)/dashboard/channel-partner/_shared.tsx` (`ChannelPartnerShell`'s `showShowcaseTab`
  push is now a no-op) — `showcase/page.tsx`, `showcase/visualization/page.tsx`,
  `ShowcaseContentClient.tsx`, `ShowcaseVisualizationClient.tsx`, and the `showcase_access_enabled`
  gate/API routes are all untouched and still reachable by direct URL for an allowlisted account (i.e.
  Arun himself, if still used for demo prep) until this item is picked back up.

---

## 🧹 B2B-16 — post-deletion orphan flags (confirm before delete; NOT deleted in B2B-16)

B2B-16 deleted the dead B2C dashboard page surfaces (`app/dashboard/plan`, `sessions`,
`knowledge-base`, `phone`, `settings`, `schedule-setup`, `walkthrough`). Per the spec's sweep
discipline ("orphaned by these pages ≠ dead"), the following were left untouched and must be
confirmed before any deletion:

- **`components/dashboard/ScheduleCard.tsx`** — was imported by the deleted
  `app/dashboard/plan/PlanClient.tsx`. Still referenced by `app/api/user/schedule-prefs/route.ts`
  (verify whether that is a live import or a comment). Confirm sole-importer before deleting.
- **`components/dashboard/DashboardShell.tsx` NAV_ITEMS point at now-deleted routes.** Its nav still
  lists `/dashboard/plan`, `/dashboard/sessions`, `/dashboard/knowledge-base`, `/dashboard/phone`,
  `/dashboard/settings` — all 404 after B2B-16. DashboardShell is KEEP (5 live admin importers), and
  editing its nav was out of B2B-16's authorized scope, so it was left as-is. **Internal admins will
  see 5 dead nav links.** Needs a follow-up to trim NAV_ITEMS to the admin-relevant set (owner/UX
  decision — do not guess).
- **Retired-B2C route/copy still linking to deleted `/dashboard/*` pages** (part of the B2C
  signup/session chain that Q1/B2B-17 defers, out of B2B-16 scope): `app/api/topics/route.ts`,
  `app/api/plan/approve/route.ts`, `app/api/sessions/schedule/route.ts`,
  `app/api/checkout/topup/route.ts` (SMS/email bodies), plus stale doc comments in
  `lib/content/live-conductor-client.ts` and `app/api/sessions/acknowledge-adaptation/route.ts`.
  These are the same B2C chain B2B-16 deliberately left intact — sweep them when the chain is retired.
- **`WalkthroughClient.tsx` was relocated, not deleted** — moved from `app/dashboard/walkthrough/` to
  `app/walkthrough/[userId]/` because the surviving public bot route imports it. See the build report.
- **General per-module sweep still owed:** other `components/dashboard/*`, `components/plan/*`,
  `components/kb/*`, and B2C-only `app/api/*` routes that only the deleted pages called may now be
  orphaned. `components/plan/*` is still used by the retained `app/plan/` (Q1) — do NOT delete. Run
  the importer sweep before removing anything.

---

## 🚦 PRE-LAUNCH GATE — do not go live with real clients until this is cleared

These are dev-only shortcuts added deliberately during the build. They must be removed or secured before real customer traffic hits production. Arun: ask Claude to audit this list before flipping the switch to a real audience.

- **Debug/test endpoints to remove entirely:**
  - `/api/admin/test-session` — lets any signed-in user instantly spin up a live coaching session against any meeting link, bypassing the real session-creation flow and the newer security/billing checks built on top of it.
  - `/api/admin/test-voice`, `/api/admin/debug-bot`, `/api/admin/test-email`, `/api/admin/seed-topics` — similar dev-only conveniences.
- **Security gaps to close:**
  - Admin bypass in `/api/auth/session` (a hidden header that skips real login).
  - `/api/walkthrough-state/[userId]` has no authentication — anyone who knows a user ID can read that user's session content.
  - A couple of admin endpoints leak internal details (API key prefixes, user ID lists) in their responses.
- **Copy cleanup:** ~30 places in user-facing text still hardcode the word "AI" instead of adapting to context.

Full detail on each item lives in this session's memory (`project_pre_production_cleanup.md`) — ask Claude to pull the complete list when this gate is reached.

---

## P0 — Blockers (fix first)

### INFRA-01 — Inngest account hit its free tier usage limit
**Status:** Not started — Arun got the Inngest usage-limit email 2026-08-13. Not yet diagnosed; explicitly deferred by Arun ("note this down so we can fix it first if we face any issues when we start back again"), pick up before other work resumes.
**What:** `app/api/inngest/route.ts` registers 44 functions. Several are named after B2C-era daily-tip/curriculum features (`daily-delivery`, `weekly-digest`, `feedback-processor`, `session-reminder`, `curriculum-generator`, `curriculum-queue-cron`, `catalog-refresh`, `adapt-plan`, `update-learning-profile`) that CLAUDE.md says were retired along with the B2C product — worth checking whether any are still on active cron schedules and quietly burning quota for a dead product before assuming an upgrade is needed.
**Next:** pull the actual Inngest dashboard usage breakdown (which functions/runs are consuming quota), confirm or rule out the stale-cron hypothesis, then fix or upgrade based on what's actually driving it. Full context: `project_inngest_free_tier_limit_2026_08_13.md` (session memory).

### BILL-01 — Demo wallet has two disconnected minute-counters + opaque credit-exhausted error
**Status:** Not started — root cause identified 2026-08-09/10 during live B2B-75/76 widget testing. Temporarily unblocked with a manual data credit (not a fix — see below). Defer real fix until current widget testing session is complete, per Arun's direct instruction.
**What:** The "Clio Internal — Public Demo" account's `partner_wallets` row carries two entirely separate, disconnected minute-tracking mechanisms:
1. `demo_minutes_balance` / `demo_reference_topup_minutes` — shown on the admin dashboard's "Your demo access" card (`DemoAccessCard.tsx`, sourced from `GET /api/admin/demo-access`), credited via "Buy demo minutes" → `/api/admin/billing/demo-topup`.
2. `trial_minutes_used` (vs. a hardcoded 20-minute lifetime cap) + `test_minutes_balance` — what the *actual* session-dispatch gate checks before letting a widget/meeting-bot call start (`lib/partner/wallet-gate.ts`'s `resolveTestModeWalletGate`, and the inlined equivalent logic in `app/api/partner/v1/sessions/route.ts`).
These two never sync. Concretely hit 2026-08-09: admin dashboard showed "411 demo minutes remaining" (healthy), but every real widget test call 502'd with an upstream `trial_exhausted` (20/20 trial minutes used, 0 test_minutes_balance) — a live-testing partner had plenty of minutes by the number they could see and none by the number that actually gated dispatch.
**Compounding issue — opaque error surfacing:** the demo dispatch route (`app/api/demo/[slug]/dispatch/route.ts`) deliberately strips upstream error detail before returning to the client (§6.3's response-mapping table: "no vendor name, HTTP status, or billing-internal detail is ever exposed to a visitor") — correct for random public demo visitors, but it means even the account owner/admin sees only a bare `502 Bad Gateway` in the browser console with no indication it's a credit issue. Diagnosing this specific failure required pulling Vercel server-side runtime logs to find the real `trial_exhausted` upstream body, rather than being obvious from the response itself.
**Fix direction (not yet built, needs a design decision before building):**
1. Reconcile the two counters — either have the dispatch gate check `demo_minutes_balance` (the number the UI already shows and admins top up), or have the dashboard display whatever the gate actually checks (`test_minutes_balance`/trial cap), or unify into one column. Needs a decision on which is the intended source of truth before touching `wallet-gate.ts` or the do-not-touch `partner/v1/sessions/route.ts`.
2. There's an existing auto-top-up safety valve in `app/api/demo/[slug]/dispatch/route.ts` (B2B-39 §6.3) meant to credit `test_minutes_balance` automatically when it runs low — its own code comment says it exists specifically to fix "that account's 20-minute trial ran out mid-testing" (i.e. this exact class of failure has happened before). It did not fire reliably during this session (wallet `updated_at` was hours stale relative to the failed dispatch attempts) — worth checking why once the counter-reconciliation design is settled, since a good design might make this valve unnecessary anyway.
3. For credit-exhaustion specifically (as opposed to other 502 causes), surface a clear, specific error — at minimum to authenticated admin/reseller callers, without necessarily changing what an anonymous public demo visitor sees — so this is self-diagnosable from the browser/response body alone next time, not something that requires pulling server logs.
**Workaround applied 2026-08-09:** manually credited `test_minutes_balance` by 411 minutes via the existing `credit_test_minutes_balance` RPC (no code change) to match the admin-visible `demo_minutes_balance` figure and unblock live testing. This is a one-time patch, not a fix — the underlying disconnect remains.
**Files:** `lib/partner/wallet-gate.ts`, `app/api/partner/v1/sessions/route.ts` (do-not-touch without a clear plan — serves every real reseller, not just demo), `app/api/demo/[slug]/dispatch/route.ts`, `app/api/admin/demo-access/route.ts`, `app/(with-clerk)/dashboard/admin/DemoAccessCard.tsx`, `partner_wallets` table.

---

### LIVE-01 — Live Session: Visualization Shows Wrong Content (Display/Speech Desync)
**Status:** ✅ Already fixed in code — confirmed 2026-06-26. `show_visual` uses `section_index` (integer) as primary lookup; falls back to exact string match only. No fuzzy matching.
**What:** During a live session, the on-screen visualization shows content from a different generation run than what Clio is speaking. Example: screen showed "Thinking Partner / Language as Interface / Financial Services Fit" (Jun 15 data) while Clio spoke "Enterprise-grade / On-demand thinking partner / High-Stakes Text-Heavy Work" (Jun 23 script). Completely different items.
**Root cause:** `WalkthroughClient.tsx` (lines 321–332) resolves which section to display by **fuzzy-matching the topic title string** against `s.meta.subtopicTitle`. When Claude's generation rephrases a subtopic title slightly (e.g. "AI Strategy" vs "AI strategy"), the match can fail or hit a stale cached section from a prior run. Combined with stale rows in `topic_content_cache` (see LIVE-02), the displayed section is whichever stale entry the fuzzy match hits first.
**Fix:** Replace fuzzy title matching with index-based or slug-based lookup:
1. `show_visual()` tool call should pass `section_index` (int) not just `topic_title`
2. `WalkthroughClient.tsx` resolves by `sections[section_index]` directly
3. Training scripts (Step 3) must include the section index in the TEACH segment so Clio knows which index to emit
**Files:** `app/dashboard/walkthrough/WalkthroughClient.tsx` (lines 321–365), `lib/content/script-generator.ts`, ElevenLabs tool definition for `show_visual`
**Dependency:** Coordinate with LIVE-03 (NAV directives) — both touch script generation.

---

### SESS-06 — Session Plan Subtopic Wiring
**Status:** Approved, build ready — BA spec at `docs/specs/SESS-06-session-plan-subtopic-wiring.md`
**What:** Sessions created by `session-designer-auto` have empty or missing `sub_sessions`. When `generate-plan` runs on launch, it falls back to `findSubtopicsFromCatalog()` which returns 3 generic subtopics ("Core concepts", "Real-world application", "Key takeaways") with 0 visual sections. The LLM-designed subtopics exist in `curriculum_plans.visible_sessions[n].subtopics` but are not reliably wired into `sessions.sub_sessions`.
**Why it's P0:** Every session a user launches teaches generic, non-personalised content. The core Clio value proposition (role-specific, designed curriculum) is broken at the live session layer.
**Root cause:** Format and wiring investigation required before touching code — see Implementation Notes in spec (Section 12). The insert at `inngest/session-designer-auto.ts` line 124 already writes `sub_sessions: ds.subtopics`, but the column may be null for sessions where this step failed silently, or where `session-designer-auto` never ran (pre-fix sessions). Confirm actual DB state before writing code.
**Two-part fix:**
1. Verify/fix `inngest/session-designer-auto.ts` `insert-draft-sessions` step writes `sub_sessions` in the canonical `SubtopicObject[]` format.
2. Build `POST /api/admin/backfill-sub-sessions` — repairs existing sessions with empty `sub_sessions` by sourcing subtopics from `curriculum_plans.visible_sessions` (joined by `db_session_id`).
**Known affected user:** `user_3FV2YjHmbMdCS9YnyeFTelDvKUc` — 9 sessions, all showing generic subtopics. Session 1 should show 6 role-specific subtopics (listed in spec Section 7, AC-04).
**Files to change:** `inngest/session-designer-auto.ts` (verify/fix write); new file `app/api/admin/backfill-sub-sessions/route.ts`
**Do NOT change:** `app/api/sessions/[id]/generate-plan/route.ts` — reading logic is correct; only change if type investigation reveals a genuine mismatch.
**Dependencies:** `lib/curriculum/session-designer.ts` (SubtopicSchema, DesignedSession types), admin auth guard, existing `curriculum_plans` and `sessions` schema — no migration required.

---

### SCH-01 — Schedule Setup: Mandatory Gate
**Status:** ✅ BUILT + DEPLOYED 2026-06-09 (commit 0b59b08). Migration 032 still needs applying in Supabase dashboard (3 statements — safe with IF NOT EXISTS guards).
**What:** After plan approval, route the user to a Schedule Setup screen (day-picker + time dialer) before they can access sessions. On save, `scheduleSessions()` writes real `scheduled_at` to all pending sessions. Until done, a blocking banner on `/dashboard/sessions` and amber card on dashboard home nudge completion. Email nudge fires 24h after plan approval if still incomplete.
**Why it's P0:** All 8 scheduled sessions currently have `scheduled_at = null`. No dates = no reminders, no agenda emails, no structured learning cadence. The plan looks broken from the moment the user arrives.
**UI:** Reuse components from deleted `app/dashboard/schedule/ScheduleClient.tsx` (7-pill day selector, clock dialer, duration toggle). `lib/sessions/planner.ts` already works.
**Technical blockers (must be resolved in BA spec before build):**
1. 🔴 **Timezone** — `scheduleSessions()` has no timezone field. Server will store UTC, not user's local time. Fix: add IANA timezone to `SchedulePreferences`, use `date-fns-tz` to convert before storing.
2. 🔴 **Re-run creates duplicate rows** — If user changes prefs after Session 1 is `completed`, delete+reinsert creates two Session 1 rows. Fix: skip re-inserting sessions at indexes already covered by `completed`/`active` rows.
3. 🔴 **No unique constraint on `(user_id, session_index)`** — DB allows duplicates. Fix: add partial unique index excluding `completed`/`cancelled` rows.
**Warnings (design into spec):**
- 🟡 `session-content-cron` Branch B ignores `scheduled_at` entirely — curriculum sessions generate immediately regardless of date. Setting dates does NOT delay content gen.
- 🟡 Re-run fires duplicate `session.content.generate` Inngest events for new Session 1 (wasted LLM calls, possible duplicate KB entries).
- 🟡 `selectedDays: []` + unset `frequencyDays` → all sessions get same timestamp. UI must enforce ≥1 day selected.
**BA open questions (from CEO brief):** Route URL, gate enforcement mechanism, `scheduling_prefs` JSONB schema, `scheduleSessions()` call location (sync API vs Inngest), banner vs hard redirect, email nudge idempotency, settings page integration, duration options (15/30 only?).
**Dependencies:** `lib/sessions/planner.ts` ✅, `scheduling_prefs` column ✅, `app/api/sessions/schedule/route.ts` ✅ (exists, handles DB write).

---

### KB-01 — KB Content Pipeline Fix (enabling-team-ai-s1/s2)
**Status:** ✅ Done — deployed 2026-06-09.
**What:** `enabling-team-ai-s1` and `enabling-team-ai-s2` are stuck in a silent infinite loop — content never appears despite hourly cron firing.
**Root causes:**
1. Upsert to `topic_content_cache` in `inngest/session-content-pipeline.ts` (lines 213–233) never checks the Supabase error — silent failure, 0 rows written.
2. Step 6 (lines 238–243) marks `content_status = 'ready'` unconditionally regardless of rows written.
3. These combine: pipeline fires → upserts fail silently → Step 6 marks ready → stale-ready recovery resets to pending → repeat every hour.
4. `enabling-team-ai-s2` also has generic subtopics ("Core concepts", "Key takeaways") — session-designer never ran for it.
**Fix:**
- Add error check to upsert — throw if Supabase returns error so Inngest retries/alerts
- Guard Step 6 — only mark ready if `subtopicsProcessed > 0`
- After loop, verify actual rows in cache before marking ready
- Run session-designer for `enabling-team-ai-s2` before triggering its pipeline
**File:** `inngest/session-content-pipeline.ts`
**Do NOT trigger enabling-team-ai-s1 or s2 manually until fix is deployed.**

---

### VOICE-01 — Hume Keep-Alive Sends Disconnect-Causing Field
**Status:** Not started — root cause identified, fix not yet built.
**What:** During a live session, `WalkthroughClient.tsx` sends a "keep the connection alive" message every 8 seconds regardless of which voice engine (ElevenLabs or Hume) is active. For Hume specifically, this message includes a field Hume doesn't allow, which causes Hume to immediately close the connection — the session drops.
**Why it matters now:** We are actively testing Hume as the new voice engine (see [[project_voice_provider_toggle]]) — this bug directly breaks that testing.
**Fix direction:** Add a check before sending the keep-alive message — only include the problematic field when ElevenLabs is the active engine, skip it entirely for Hume.
**File:** `app/dashboard/walkthrough/WalkthroughClient.tsx` (the periodic keep-alive/injectContext block)

---

## P1 — Core Features (next sprint)

### API-ONBOARD-03 — Integration guide: schema recommendation, dashboards, insights usage
**Status:** Built and verified (`npx tsc --noEmit` clean on the changed files, `npm run build` shows
`✓ Compiled successfully`, `/dashboard/configurator/api` builds at its normal size) — 2026-09-06.
**Not committed/pushed** — Arun asked to review the actual drafted content first, given the volume
of new writing; holding for his go-ahead before it ships.
**Placement decision (CEO agent, resolving the brief's open placement question):** a new, dedicated
nav entry **"Integration guide"**, positioned between **Quick start** and the endpoint category list
in the left nav of `/dashboard/configurator/api`. Reasoning: Quick Start is deliberately a terse
2-call overview; the Usage webhook entry is a wire-format reference (fields, signature, retries); this
guide is a third, distinct thing — "what do I actually build on my end" — substantial enough (SQL,
dashboard recommendations, a business-value section) that folding it into either existing surface
would either dilute Quick Start or bloat the Usage webhook page past its focused purpose. Section 11
would otherwise be empty aside from this one placement call, which the CEO agent is resolving per its
standing authority to make product-shape/content-ambiguity calls and document them.
**What was built:**
- `app/(with-clerk)/dashboard/configurator/api/content.ts` — new exported `INTEGRATION_GUIDE_DOC`
  constant, hand-authored (not AI-generated per the repo's own file-header rule), covering all 5
  points from the brief. Every field name in the SQL/table below is transcribed from
  `WebhookPayload` in `lib/partner/webhooks.ts`, not invented.
- `app/(with-clerk)/dashboard/configurator/api/ApiClient.tsx` — new `IntegrationGuideDoc()` render
  component, new `'integration-guide'` nav-selection state, new nav button under the existing
  Quick Start/Webhooks button group.
**Content drafted (relayed to Arun for review before shipping):**
1. States plainly that `clio_session_ref` is the shared primary key across all 3 events.
2. Plain-language upsert-as-you-go pattern (create the row on whichever event arrives first, fill in
   the rest as the other 2 land, never overwrite an earlier event's columns with nulls).
3. A portable (non-Supabase-specific) `CREATE TABLE clio_sessions (...)` statement — nullable
   columns for anything that only arrives on one event type.
4. 5 concrete recommended dashboards (session volume, completion rate, avg voice minutes,
   engagement-style distribution, most frequent topics of interest).
5. A business-value section built on Arun's own example: `suggested_next_topics` per end user drives
   direct next-course recommendations; aggregated `topics_of_interest` across all sessions signals
   a partner's own content team/contributors where real demand exists for new material.
**What (per Arun's direct instruction, 2026-09-06):** now that the docs are narrowed to the 3
session-scoped webhook events (`session.completed`, `usage.voice_minute`, `session.insights_ready`
— all carrying `clio_session_ref` as the natural primary key), add a genuine integration guide to
the partner-facing API docs covering:
1. **Explicitly state `clio_session_ref` is the primary key** to key their own storage on — it's
   the shared identifier across all 3 events for a given session.
2. **What they need to do on their end** — plain-language description of the recommended pattern:
   receive each event, upsert a row keyed by `clio_session_ref`, merge in whatever fields that
   event carries (so a session's row fills in progressively as its 3 events arrive, not requiring
   all 3 before the row exists).
3. **A ready-to-run SQL `CREATE TABLE` statement** (generic/portable SQL, not Supabase-specific)
   they can literally copy to stand up their own local table, with columns matching the union of
   fields across all 3 events (`clio_session_ref`, `status`/completed timestamp, `voice_minutes`,
   `test_mode`, `learner_insight` fields — summary/topics_of_interest/engagement_style/
   suggested_next_topics — `action_items`, `extraction_status`, etc.) — nullable where a field only
   arrives on one event type.
4. **Recommended dashboards** — concrete suggestions for what to build from this data (e.g. session
   volume/completion trends, average voice minutes, engagement-style distribution, most common
   topics of interest).
5. **How to turn the data into insights** — specifically, Arun's own example: how the
   `learner_insight`/`suggested_next_topics` data can drive recommending new courses to end users,
   or signal their own content team/contributors where to build more material in a given domain.
**Where this lives**: extend the existing `/dashboard/configurator/api` docs surface (same page
API-ONBOARD-01/02 already touched) — CEO/BA to decide exact placement (new nav section vs. folded
into Quick Start) and document the choice.
**Explicitly out of scope**: no functional/API changes — this is a substantial new documentation
content addition, written carefully (not rushed), same governance chain as everything else.

### API-ONBOARD-02 — Hide GET /sessions/:id and usage.llm_generation_call from partner-facing docs
**Status:** Shipped, verified, committed and pushed to `main` — 2026-09-06, via full CEO → BA →
build chain. Commit `9d65d63`. BA spec at
`docs/specs/API-ONBOARD-02-requirement-document.md` (all 12 sections, Section 11 empty).
**What shipped:**
1. `app/(with-clerk)/dashboard/configurator/api/content.ts` — added `partnerVisible?: boolean` to
   `EndpointDoc`, set `false` only on the `sessions_get` entry (object otherwise unchanged, still in
   `ENDPOINTS`, `'sessions_get'` still in `PlaygroundEndpointId`). Removed the three
   `usage.llm_generation_call` doc-only string literals: the `usage` endpoint's `event_type` query
   param type, `WEBHOOK_DOC.eventTypes`, and the `generation_type` payload-field row.
2. `app/(with-clerk)/dashboard/configurator/api/ApiClient.tsx` — nav filter now also excludes
   `partnerVisible === false`; removed the Quick Start pane's one paragraph mentioning
   `GET /sessions/:id`, no replacement text.
3. Explicitly untouched, confirmed by direct grep/read: the real
   `GET /api/partner/v1/sessions/:clio_session_ref` route, `lib/partner/webhooks.ts`,
   `lib/partner/content-generation.ts`, `lib/partner/usage-log.ts`, `UsageLogClient.tsx`, and
   `PlaygroundClient.tsx` (confirmed it still reads the full unfiltered `ENDPOINTS` array and
   defaults to `sessions_get`).
**Verification:** `npx tsc --noEmit` clean (2 pre-existing unrelated `@testing-library/react`
errors confirmed via `git stash` diff to predate this change); a real `npm run build` showed
`✓ Compiled successfully` with zero new errors.
**Original context (per Arun's direct instruction, 2026-09-06):** to avoid confusing new partners in this
initial delivery phase, remove/hide two things from the partner-facing API docs
(`app/(with-clerk)/dashboard/configurator/api/`, both the `QuickStartDoc()` panel added in
API-ONBOARD-01 and the full endpoint list/nav): the `GET /api/partner/v1/sessions/:id` status
endpoint (optional, not part of the expected flow, unnecessary to surface right now), and the
`usage.llm_generation_call` webhook event (not applicable — Clio is not generating content or
visualization for clients in this delivery phase). **Docs/UI only — the underlying API route and
webhook event dispatch logic must keep working exactly as they do today; nothing about actual
functionality changes.** Same "hide, don't delete" governance principle already used elsewhere in
this codebase (`VISIBLE_SECTIONS`, `SHOWCASE_TAB_ENABLED`).
**Explicitly confirmed with Arun, not yet acted on**: the mental model is 1 outbound client POST
+ up to 3 inbound webhook calls per session (`usage.voice_minute`, `session.completed`,
`session.insights_ready`) + 1 separate account-level `wallet.low_balance` webhook — a deeper
discussion of consolidating/simplifying the multiple-inbound-calls-per-session pattern is
explicitly deferred to after this docs change lands ("We will talk about the multiple inbound
calls in detail once this done").

### API-ONBOARD-01 — Clarity pass on Integration + API docs/Playground for new partners
**Status:** Built, `npx tsc --noEmit` clean, committed and pushed — 2026-09-06, via full
CEO → BA → build chain, overnight per Arun's instruction ("tonight build all these we discussed").
CEO Feature Brief at
`.claude/agents/clio/feature-briefs/API-ONBOARD-01-integration-docs-clarity.md`; BA spec at
`docs/specs/API-ONBOARD-01-requirement-document.md` (all 12 sections, Section 11 empty).
**What shipped:**
1. `app/(with-clerk)/dashboard/configurator/api/ApiClient.tsx` — new `'quickstart'` nav
   selection, first item in the left nav (above the category groups), now the default view on
   page load (previously defaulted to the first Auth endpoint). New `QuickStartDoc()` component
   explains the whole model in plain language before the technical list: the one outbound call
   (`POST /api/partner/v1/sessions` with meeting URL + content pages), the one inbound
   `session.insights_ready` event (carrying `learner_insight`/`action_items`) pushed to the base
   URL set on Integration, a note that the same webhook URL is shared with other (billing/usage)
   event types — filter by `event_type` — and that `GET /sessions/:id` is optional/status-only,
   not a required third step. All 9 existing endpoint docs and the webhook doc's field table are
   unchanged. `WebhookDoc()`'s `Verify` section gained one plain-language sentence directly above
   the existing `verificationRecipe` formula (formula text itself byte-for-byte unchanged).
2. `app/(with-clerk)/dashboard/configurator/integration/IntegrationClient.tsx` —
   `OutboundWebhooksCard`'s intro paragraph now leads with "this is where you receive the summary
   and action items after each session ends," with the existing usage-events mention kept as
   secondary (was: "for delivering usage events and any future integration calls," no mention of
   session insights at all). `ApiCredentialsCard`'s copy was reviewed and left unchanged — already
   clear per BA spec §4.B.
**Verification:** `npx tsc --noEmit` clean — the only errors present (6, in
`tests/unit/b2b57b-*` and `tests/unit/b2b61-partb-*`, unrelated `@testing-library/react` typing
issues) are pre-existing, identical to the DOMAIN-GUIDE-01 baseline noted below.
**Not built (explicitly out of scope, spec §4.C/§10/§12):** the usage/billing webhook's own
framing or behavior (Arun is discussing that caveat tomorrow morning); any `lib/partner/webhooks.ts`
or other API/route changes; redesigning the endpoint list order/categories or the Playground
mechanics; `GO_LIVE_REQUIRED_STEPS`.
**Live browser QA on `distill-peach.vercel.app` not yet done** — needs a real deploy first, same
caveat as DOMAIN-GUIDE-01 below.

<details>
<summary>Original entry (2026-09-06, retained for history)</summary>

**Status:** In progress — dispatched to CEO agent 2026-09-06 for full CEO → BA → build chain,
overnight per Arun's instruction ("tonight build all these we discussed").
**What (per the conversation this session walked through with Arun):** after DOMAIN-GUIDE-01
(re-exposed Domain, led with custom domain, simplified DNS instructions), Arun and the Orchestrator
walked through the next real step for a newly-invited partner: Integration (get API credentials,
optionally set `outbound_base_url`) and the API docs/Playground (`/dashboard/configurator/api`,
`ApiClient.tsx` + `content.ts`). Confirmed in conversation, not yet reflected as a clarity
improvement in the product:
1. The core mental model a new partner needs is simple — **one outbound call** (`POST
   /api/partner/v1/sessions`, with meeting URL + content/visualization pages) to start a session,
   and **one inbound call** (the `session.insights_ready` webhook, delivering `learner_insight`:
   summary, topics of interest, engagement style, suggested next topics, plus `action_items`) after
   the session ends. `GET /sessions/:id` exists but is optional/status-only, not part of the
   expected flow. Today's docs page dives straight into a full endpoint list with no framing —
   nothing currently explains this simple 1-out/1-in model before the technical detail.
2. The live Playground (parameterize + fire real requests) already exists and works — confirmed in
   conversation, no functional gap there. This work is about clarity/onboarding framing around it,
   not new playground functionality.
3. Integration section itself (`IntegrationClient.tsx`) should be checked for the same kind of
   beginner-friendly framing DOMAIN-GUIDE-01 gave the Domain section — does a first-time partner
   understand what "outbound_base_url" is FOR (receiving the insights webhook) without already
   knowing the architecture?
**Explicitly out of scope, per Arun's direct instruction**: the usage/billing webhook caveat
(separate from `session.insights_ready`, fires independently for metering) — "we will discuss an
about the billing caveat in detail tomorrow morning." Do not touch billing-webhook docs/behavior in
this pass.
**Goal, verbatim from Arun**: "CEO agent review and ensure it's easy for the user to understand and
use ours." This is a comprehension/UX clarity pass, not a new-capability build — same spirit as
DOMAIN-GUIDE-01.

</details>

### DOMAIN-GUIDE-01 — Re-expose Domain setup, lead with custom domain, simplify DNS instructions
**Status:** Built and `npx tsc --noEmit` clean, 2026-09-06 — via full CEO → BA → build chain. NOT
committed, pushed, or deployed — awaiting Arun's review. Live browser QA on
`distill-peach.vercel.app` not yet done (needs a real deploy first).
**What shipped:** CEO Feature Brief at
`.claude/agents/clio/feature-briefs/DOMAIN-GUIDE-01-lead-with-custom-domain.md`; BA spec at
`docs/specs/DOMAIN-GUIDE-01-requirement-document.md` (all 12 sections, Section 11/14 empty).
`lib/partner/configurator-sections.ts`'s `VISIBLE_SECTIONS` now includes `'domain'` (was
`['integration', 'payment']`, now `['integration', 'payment', 'domain']`) — verified every
downstream consumer (`DashboardPanel.tsx`, `ConfiguratorSurface.tsx`, both `page.tsx` route
guards, the channel-partner client configure page, `wizard.ts`) already reads this array
generically, so no other file needed a change. `GO_LIVE_REQUIRED_STEPS` deliberately left
unchanged at `['integration', 'payment']` — explicit BA decision (spec §6.1): this pass is
visibility/comprehension, not a go-live gating change, and widening it would require touching
hardcoded `requiredReady`/`REQUIRED_LABELS` logic in `GoLivePanel.tsx` and
`ConfiguratorSurface.tsx`, well outside this feature's scope; logged as a possible future,
separate Feature Brief (spec §12) if Arun wants real gating later.
`DomainConfigClient.tsx` rewritten per spec: custom-domain card now renders first (previously
second) with a persistent "RECOMMENDED" badge + 2px purple border across all four status branches;
subdomain card now second, with a new "get started right now without touching DNS" framing
sentence, otherwise fully unchanged and still fully usable. The old subdomain-first gate on the
custom-domain card (`muted = !settings.subdomain_slug`) is removed entirely — verified directly
against `lib/partner/domain-settings.ts`'s `addCustomDomain()` that it has no dependency on a
subdomain existing, so a partner can now add their own domain immediately with no subdomain
prerequisite. The `pending_verification` DNS instructions are fully rewritten in plain language:
a CNAME explainer, a "log into wherever you manage DNS" paragraph naming GoDaddy/Namecheap/
Cloudflare/Google Domains as examples, the same live per-row record data (unchanged source,
`settings.custom_domain_verification`), and a reframed propagation/manual-recheck closing
paragraph replacing the old bare "up to 48 hours" warning. `verified`/`failed` branches unchanged
apart from the badge/border. No changes to `lib/partner/domain-settings.ts`,
`lib/partner/vercel-domains.ts`, `NAV_GROUPS`, `DashboardPanel.tsx`, or the underlying
`none | pending_verification | verified | failed` state machine — confirmed out of scope per spec
§11. No Tailwind introduced; inline `style={{}}` pattern preserved throughout.
**Verification:** `npx tsc --noEmit` clean — diffed against a `git stash` baseline, the only
errors present (6, in `tests/unit/b2b57b-*` and `tests/unit/b2b61-partb-*`, unrelated
`@testing-library/react` typing issues) are identical before and after this change.
**Not built (explicitly out of scope, spec §11/§12):** adding `domain` to
`GO_LIVE_REQUIRED_STEPS`; handling the `409 domain_already_configured` client response
differently; any redesign of the Type/Name/Value record table layout.

<details>
<summary>Original entry (2026-09-06, retained for history)</summary>

**Status:** In progress — dispatched to CEO agent 2026-09-06 for full CEO → BA → build chain.
**What (per Arun's direct instructions, 2026-09-06):** he wants a newly-invited partner's first
real activity to be setting up their own domain (not our shared `hello-clio.com` subdomain) so no
content ever renders under our domain. Two concrete asks:
1. **Re-expose the `domain` section** in `lib/partner/configurator-sections.ts`'s `VISIBLE_SECTIONS`
   (currently hidden — `['integration', 'payment']` only). One-line change per the file's own
   designed hide/show toggle, but confirm nothing else assumed it stays hidden before flipping it.
2. **Rewrite the guidance in `DomainConfigClient.tsx`** to be genuinely beginner-friendly, and
   **re-order/re-emphasize custom domain as the recommended primary path**, with the shared
   subdomain (`theircompany.hello-clio.com`) presented as a secondary/quick-start fallback rather
   than the default lead option (current code order is the reverse — subdomain first, custom domain
   second, and the custom-domain card is just a raw Type/Name/Value table with no explanation of
   what a CNAME record is, where to add it, or realistic wait-time framing).
**Content direction already agreed with Arun in conversation** (Orchestrator drafted, Arun
confirmed by saying "lets fix it"): explain what a CNAME record is in plain language, tell them to
log into wherever they manage DNS for their domain (name a few examples — GoDaddy, Namecheap,
Cloudflare, Google Domains — without assuming any one of them), keep the exact CNAME target
(`cname.vercel-dns.com`) but explain it rather than just tabulate it, and reframe the "DNS changes
can take up to 48 hours" line as reassurance/expectation-setting rather than a bare warning.
**No backend/API changes anticipated** — `lib/partner/domain-settings.ts`, `lib/partner/vercel-domains.ts`,
and the underlying Vercel Domains API integration are already correct and untouched; this is a
visibility toggle + a copy/layout/ordering pass on the existing screen.

</details>

### WAITLIST-INVITE-01 — One-click email invite from the waitlist admin page
**Status:** Built and `npx tsc --noEmit` clean, 2026-09-06 — via full CEO → BA → build chain. NOT
committed, pushed, or deployed — awaiting Arun's review. Live browser QA on
`distill-peach.vercel.app` not yet done (needs a real deploy first).
**What shipped:** BA spec at `docs/specs/WAITLIST-INVITE-01-requirement-document.md` (all 12
sections, Section 11 empty). Per-row "Invite" button on `/dashboard/admin/waitlist` that calls new
`POST /api/admin/waitlist/[id]/invite` — reuses `issueDirectPartnerInvite()` (extended with a new
optional `sourceWaitlistId` 5th param, fully backward-compatible with its existing callers) to
create a `direct_partner_invites` row and then sends a new `sendWaitlistInviteEmail()` (Resend,
`lib/delivery/email.ts`) containing the `/partner-invite/accept` link. New migration
`supabase/migrations/120_waitlistinvite01_source_waitlist_id.sql` adds a nullable
`direct_partner_invites.source_waitlist_id` column (FK to `waitlist_signups`) plus a partial unique
index that closes the double-click/race case as a `409`. `GET /api/admin/waitlist` now returns each
row's invite status (`pending`/`accepted`/`expired`/`revoked`/`null`) so the row shows a plain-text
status label instead of the button once invited — no re-invite action in this iteration.
**Confirmed unmodified (verified via `git status`/diff, not just claimed):**
`/dashboard/admin/partner-invites`, its API route, the `sales_partner_leads` invite flow,
`/partner-invite/accept`, `lib/partner/signup.ts`.
**Flagged, not fixed (out of scope per spec §9/§10):** deleting a waitlist row that already has a
linked invite will hit a foreign-key violation today (`ON DELETE NO ACTION` on the new column) and
surface the existing generic "Couldn't delete this entry" message — accurate but not specific about
why. A clean, separate follow-up if it ever comes up in practice.
**Not built (explicitly out of scope, spec §10):** resend/re-invite action, bulk "invite all,"
pre-invite check against existing partner accounts, `target_account_kind` selector on this screen.

### WAITLIST-01 — Homepage waitlist (narrowed scope)
**Status:** Done — built 2026-09-05 to `docs/specs/WAITLIST-01-requirement-document.md` (approved
2026-09-05, all 12 sections complete, Section 11 empty). This entry originally bundled the $10
demo-passcode flow (see original text below, retained for history); that flow was split out as its
own not-started entry, `DEMO-PASSCODE-01`, per the BA spec's Section 10.
**What shipped:** Homepage `<section id="waitlist">` (name + email form) inserted between
`Testimonials` and `BottomCTA` in `app/(with-clerk)/(marketing)/page.tsx`; `MarketingNav`'s "Log
in" link removed and "Get started" repointed to `/#waitlist`; `Hero` and `BottomCTA` primary CTAs
repointed from `/partner-inquiry` to `/#waitlist` ("Join the waitlist"); a single small secondary
link to `/partner-inquiry` retained under the waitlist form. New `waitlist_signups` Supabase table
(migration `118_waitlist01_signups.sql`, hard `UNIQUE` constraint on email — a duplicate submit
resolves to a friendly "You're already on the list" state, not an error) with public
`POST /api/waitlist` (honeypot-protected) and super-admin-only `GET`/`DELETE
/api/admin/waitlist[/id]` routes, `lib/partner/waitlist.ts`, a Resend admin-notification email
(`sendNewWaitlistSignupEmail` in `lib/delivery/email.ts`), and a new
`/dashboard/admin/waitlist` admin page (flat list + inline two-step delete confirm) linked from
the admin index.
**Explicitly out of scope this round (see `DEMO-PASSCODE-01` below):** the $10 demo-passcode
purchase flow, Stripe checkout for it, and passcode generation/email.

<details>
<summary>Original combined entry (2026-07-07, superseded 2026-09-05 — kept for history)</summary>

**What (per Arun's direct instructions, 2026-07-07):**
1. Homepage (`app/(with-clerk)/(marketing)/page.tsx` + `components/marketing/MarketingNav.tsx`): remove the "Log in" nav link (admin unaffected — still reaches `/dashboard/admin` via `/sign-in` directly, just not linked publicly). Add a waitlist signup section (name + email) to the existing homepage — existing page content/pillars stay, this is additive plus the nav removal. Recommended (Arun delegated the call): consolidate the existing "Get started" → `/partner-inquiry` CTA and the new waitlist into one conversion point rather than two competing forms — waitlist becomes primary; `/partner-inquiry` either retires or becomes a secondary/follow-up step, CEO/BA to confirm exact mechanics.
2. Admin: email notification (Resend) to hello.arunprakash83@gmail.com the instant someone joins the waitlist. Admin dashboard page listing waitlist entries (model off the existing `/dashboard/admin/sales-partner-leads` list-view pattern) with a delete action per entry.
3. Public "See the demo for $10" flow: CTA on site → explicit callout that the resulting passcode is usable only twice (shown before payment) → Stripe Checkout, $10 one-time (test mode for now, Arun will flip to live mode himself before real users) → on successful payment, generate a passcode restricted to exactly 2 uses, no expiry date → email the buyer immediately with the passcode and the demo page URL → they visit the demo page, enter name + passcode to get in.
**Reusable infra already in the codebase (do not rebuild from scratch):** `lib/demo/passcode-accounts.ts` (passcode generation/validation core), `app/(demo)/demo/[slug]` (existing public demo catalog/render page), `/dashboard/admin/sales-partner-leads` (existing admin leads-list UI pattern to model the waitlist admin view on), Resend already wired for transactional email, Stripe already integrated (this is a new one-time $10 price/product, separate from existing subscription/usage billing).
**New surfaces needed:** waitlist DB table + API route, admin waitlist list/delete page + API routes, Stripe checkout route for the $10 demo product + webhook handling for it, passcode-purchase confirmation email template, likely an extension to the passcode model to support "exactly 2 uses, no expiry" if the existing passcode infra doesn't already support that exact shape (existing demo-access passcodes are minutes-balance based, not use-count based — confirm during BA spec whether to extend the existing table/logic or add a parallel one).
**Approvals:** Arun answered all clarifying questions directly 2026-07-07 and explicitly delegated full CEO → BA → approval → build ownership — "go through ceo and take care of all approvals and build fully then let me know so i can test it." No outstanding open questions blocking BA spec Section 11 as of dispatch.

</details>

### DEMO-PASSCODE-01 — Paid ($10) demo-passcode flow
**Status:** Done — built 2026-09-05 to `docs/specs/DEMO-PASSCODE-01-requirement-document.md`
(approved, all 12 sections complete, Section 11 empty).
**What shipped:** New homepage CTA (`components/marketing/PublicDemoPasscodeCTA.tsx`, rendered from
`PublicDemoPasscodeSection()` in `app/(with-clerk)/(marketing)/page.tsx`, placed directly after
`<WaitlistSection />` and before `<BottomCTA />`) — "Already convinced? See the demo for $10.",
pre-payment "works twice and never expires" disclosure, `POST /api/public-demo-passcode/checkout`
→ Stripe Checkout (`mode: 'payment'`, `STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID`,
`createPublicDemoPasscodeCheckoutSession()` in `lib/stripe.ts`, mock-mode-safe). New Stripe webhook
branch in `app/api/webhooks/stripe/route.ts` (`purpose === 'public_demo_passcode'`, inserted between
the `demo_topup_purchase` and `plan_subscription` branches) generates a 2-use passcode
(`lib/demo/public-buyer-passcode.ts`, structurally separate from B2B-39's `passcode-accounts.ts`),
inserts a `public_demo_passcodes` row (migration
`119_demo_passcode01_public_buyer_passcodes.sql`, plus sibling table
`public_demo_passcode_redemptions` and a `consume_public_demo_passcode_use` atomic-decrement RPC),
and emails the plaintext passcode once via `sendPublicDemoPasscodeEmail` in `lib/delivery/email.ts`.
`app/api/demo/[slug]/widget-dispatch/route.ts` now falls through to the new public-buyer passcode
model after the existing B2B-39 reseller/admin resolution misses, per Known Constraint 5: skips the
duplicate-dispatch guard and all `demo_dispatches`/minutes-billing entirely for that path, and
consumes one use + logs a `public_demo_passcode_redemptions` row (best-effort, non-blocking) only
after a successful dispatch. New read-only admin page `/dashboard/admin/public-demo-passcodes`
(`PublicDemoPasscodesClient.tsx`, modeled on `WaitlistClient.tsx`, backed by
`GET /api/admin/public-demo-passcodes` / `lib/demo/public-demo-passcodes.ts`) lists issued
passcodes and the redemption log, linked from the admin index.
**Known gap (flagged for Arun, not blocking):** `.env.local.example` could not be edited by this
build — this session's sandbox permissions deny access to that path outright (not a
Read-before-Edit issue, a hard deny). The new env var
`STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID=PLACEHOLDER_STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID` needs to be
added to that file by hand, next to the other `STRIPE_*_PRICE_ID` vars — the code already reads it
correctly (falls back to mock mode when absent/placeholder, so nothing is broken without it).
**Verification:** `npx tsc --noEmit` clean (zero errors in any file this build touched; two
pre-existing, unrelated `@testing-library/react` type errors in `tests/unit/b2b57b-*` and
`tests/unit/b2b61-partb-*` predate this change, confirmed via `git stash`).

### PIPE-01 — Two Content-Generation Pipelines Running in Parallel
**Status:** Not started — needs a decision on which pipeline to keep.
**What:** There are two separate background jobs that both generate session content, registered at the same time. The older one still runs every hour against all scheduled sessions, which doesn't match the intended design (content should generate right when a user approves their plan, not on a recurring sweep). Having both running risks duplicate work and conflicting content.
**Decision needed:** Keep the "generate on approval" pipeline as the only one, and retire the old hourly one — or confirm there's still a reason to keep both.
**File:** both pipelines are registered in `app/api/inngest/route.ts`

---

### CONTENT-01 — Content Pipeline Redesign (Content → Script+Viz Atomic)
**Status:** ✅ Done — shipped (commit `6c732a0` + follow-ons `957a0da`, `91fb948`, `563a864`). Confirmed live 2026-07-03: all of CONTENT-01-A through M verified present in code, `tsc --noEmit` clean. See "CONTENT-01: Content Pipeline Redesign" task table below — every row in that table is now Done, not "Not started" as previously listed.
**What:** Three interconnected changes to produce elite, aligned session content:
1. **New generation order:** Content article (comprehensive, no word limit) → Script (2-min TEACH + ICE_BREAKER, calibrated to VP/C-suite) + Visualization (generated in the same LLM call as script — atomic, structurally impossible to desync)
2. **VP-level calibration:** Explicit rules in system prompt — skip definitional content, start at competitive landscape and procurement implications. Skip "enterprise grade, not a toy." Begin at: "You're probably evaluating Claude alongside GPT-4 or Gemini…"
3. **User psychology capture:** ICE_BREAKER segment is a genuine open conversational question (not a quiz). User's response is stored and analyzed post-session to update learning profile — influences which subtopics get prioritized in future sessions.
**Why P1:** The current script is a 7-min monologue that starts too basic and never lets the user speak. No connection. No adaptation. Sessions feel like a lecture, not a conversation.
**Quality bar set by Arun in conversation 2026-06-23 (approved sample):**
- TEACH: 2 min, 3 tight differentiators — no setup, VP already knows what an LLM is
- CHECKPOINT: "Which of those three will your risk/compliance team push back on first?"
- ICE BREAKER: "What's the specific context driving this evaluation for you right now?"
- VISUALIZATION: exactly 3 items matching exactly what the 2-min TEACH covered
**CEO brief:** `docs/specs/CONTENT-01-feature-brief.md`
**BA spec:** `docs/specs/CONTENT-01-requirement-document.md` (in progress)
**Files to change:** `lib/content/session-content-generator.ts` (Step 1 — expand to full article), `lib/content/script-generator.ts` (Step 3 — restructure segments, atomic viz), `inngest/session-content-pipeline.ts` (pipeline order)
**Dependencies:** LIVE-01 and LIVE-02 must be fixed first (stale cache causes any new content to still display wrongly).

---

### LIVE-02 — Pipeline Upsert Uses Wrong Conflict Key
**Status:** ✅ Already fixed in code — confirmed 2026-06-26. `session-content-pipeline.ts` uses `{ onConflict: 'topic_id,subtopic_slug,industry,role' }` matching the actual DB unique index.
**What:** `inngest/session-content-pipeline.ts` (line ~232) calls `.upsert(..., { onConflict: 'topic_id,subtopic_slug' })` but the database unique constraint is on `(topic_id, subtopic_slug, industry, role)`. The mismatch means:
- When pipeline runs for a user-specific context (industry='financial-services', role='vp'), a new row is inserted instead of updating the existing one
- Old rows from prior runs persist and are never cleaned up
- Multiple rows exist for the same (topic_id, subtopic_slug) pair — one per generation run
- The live session can pick up ANY of these stale rows
**Fix:** Change conflict key to match the actual DB constraint:
```typescript
{ onConflict: 'topic_id,subtopic_slug,industry,role' }
```
Also clean up existing duplicate rows — delete older rows keeping only the latest per `(topic_id, subtopic_slug, industry, role)`.
**File:** `inngest/session-content-pipeline.ts` line ~232
**Migration needed:** Add cleanup script to remove orphaned duplicate rows.

---

### LIVE-03 — Training Scripts Missing Tab Navigation Directives
**Status:** ✅ Already fixed in code — confirmed 2026-06-26. `script-generator.ts` embeds `[NAV:tab_0/1/2]` inline in TEACH segments. `WalkthroughClient.tsx` parses and fires tab navigation via `parseNavCommand()`.
**What:** The script generator (`lib/content/script-generator.ts`) produces TEACH/CHECKPOINT/PROBE/CONTINUE segments that mention visual items by name but include **no `[NAV:...]` directives**. The tab-switching system in `WalkthroughClient.tsx` (lines 110–145) parses `[NAV:tab_id]` markers from Clio's speech — but these are never emitted. Tab switching doesn't happen automatically during sessions.
**Fix:** Enhance `generateTrainingScript()` to emit `[NAV:tab_id]` at the moment Clio begins discussing each visual item:
```
"Now look at Risk Mitigation [NAV:risk-mitigation] — this is where regulated firms..."
```
The `tab_id` values come from `tab_manifests[section_index].tabs[].tab_id` — these must be passed into the script generator alongside `visual_spec`.
**Files:** `lib/content/script-generator.ts`, `lib/templates/generator.ts` (tab manifest generation), `inngest/session-content-pipeline.ts` (pass tab manifest to Step 3)
**Dependency:** Coordinate with CONTENT-01 (Step 3 restructure) — do this change inside the CONTENT-01 build, not separately.

---

### LIVE-04 — Pipeline Saves Content with Hardcoded industry='' and role=''
**Status:** ✅ Already fixed in code — confirmed 2026-06-26. Pipeline fetches user profile from DB and passes `userContext.industry` and `userContext.role` to the upsert (lines 302–303).
**What:** `inngest/session-content-pipeline.ts` (lines ~215–231) inserts to `topic_content_cache` with `industry: ''` and `role: ''` hardcoded, even though the pipeline receives the actual user context. This means:
- All generated content lands in the generic cache slot (industry='', role='')
- `getCachedSection()` (in `lib/topic-cache.ts`) searches by `(topic_id, subtopic_slug, industry, role)` — with a fallback to the generic row
- So everyone gets the same generic content regardless of their industry or role
- The personalization system is silently bypassed
**Fix:**
```typescript
industry: userContext.industry ?? '',
role: userContext.role ?? '',
```
Pass the actual values. Ensure the conflict key fix (LIVE-02) is applied first so the upsert correctly updates the user-specific row.
**File:** `inngest/session-content-pipeline.ts` lines ~215–231

---

### KB-02 — KB Section Ordering
**Status:** ✅ Done — deployed 2026-06-09.
**What:** KB topic detail page sorts sections by `generated_at DESC` — random order, not the teaching narrative. Should sort by session_index + subtopic position within each session.
**Fix:** `app/api/kb/topics/[topicId]/route.ts` — fetch sessions ordered by `session_index ASC`, read `sessions.subtopics` JSONB (ordered array), match KB sections to that order. No migration needed.
**Correct order example (claude-for-work-s1):**
1. Constitutional AI and Enterprise-Grade Safety (S1, opener)
2. Why Financial Services Firms Are Choosing Claude (S1)
3. Choosing Your Deployment Model (S1)
4. Framing Claude's Value to the C-Suite (S1, closer)
5. The Quick Win Zone (S2, opener) … etc.

---

### KB-03 — KB Overview Slide
**Status:** ✅ Done — deployed 2026-06-09.
**What:** Pinned card at top of each KB topic page showing: arc title, arc focus description (from `curriculum_plans.visible_sessions[].focus`), session list with status (Completed / Next Up / Upcoming), progress summary ("X of Y sessions completed").
**Design (approved):**
```
┌─────────────────────────────────────────────────────┐
│  Claude in Financial Services                       │
│  Safety Architecture, Deployment Models & C-Suite  │
│                                                     │
│  Establish what Claude is, how it differs...        │
│                                                     │
│  What you'll cover                                  │
│  ✅ Session 1 — Claude in Financial Services: Safety│
│     4 subtopics · Completed                         │
│  → Session 2 — From First Use to Strategic Advantage│
│     5 subtopics · Next up                           │
│                                                     │
│  9 subtopics · 2 sessions · 1 of 2 completed       │
└─────────────────────────────────────────────────────┘
```
**Interaction:** Display only — no navigation on session click.
**Data sources:** Focus from `curriculum_plans.visible_sessions[].focus`, sessions from `sessions` table by `curriculum_session_id`, status from `sessions.status`.
**Files:** `app/api/kb/topics/[topicId]/route.ts` (add arc metadata to response) + KB topic page UI.

---

### ONB-01 — Onboarding Bug Fixes (4 critical)
**Status:** ✅ Partial done 2026-06-09 — domainProficiency wired (ProficiencyStep now runs as step 5, total steps = 7). worry and deliveryPreference remain hardcoded — no BA spec, safe defaults. No profile edit page — still pending.
**What:** 8 bugs found in onboarding; 4 are critical:
1. `industry`, `worry`, and `roleLevel` values are captured in UI but never saved to the `users` table
2. Onboarding API is called fire-and-forget — data loss if the call fails
3. No profile edit page — once onboarding is complete, user cannot update their profile
4. `ai_maturity` field mapping inconsistency between onboarding UI values and DB enum
**Why P1:** Scheduling prefs (SCH-01) and content personalisation both depend on an accurate user profile. Building scheduling on top of broken onboarding data is a dead end.
**Note:** These must be fixed before SCH-01 is built (scheduling preferences require accurate user profile data).

---

## P1 — Core Features (continued)

### SES-01 — Session Architecture Redesign: DB Session as Unit of Truth
**Status:** ✅ Verified DONE 2026-07-03 (was already built, undocumented) — 1 minor data-hygiene gap found and left as-is (see below). No code changes made this session.
**Verification method:** Direct code + live DB read against Supabase project `nqxlpcshouboplhnuvrh` — not delegated. Full re-check requested because the prior 3 backlog items (CURR-02, CONTENT-01, CURR-01) had also turned out to already be shipped.

**Per-sub-area status:**
- **SESS-01** (re-key `topic_content_cache.topic_id` → DB session UUID) — ✅ **Done in application logic.** New content is written with `topic_id = sessions.id` (confirmed in `lib/topic-cache.ts` write path and live data: most `topic_id` values are session UUIDs). ⚠️ **Data-hygiene gap, not a functional bug:** migration `supabase/migrations/040_session_cache_key.sql` added a typed `session_id uuid` FK column intended as a backfilled convenience column, but it was never actually applied against this project (`list_migrations` shows no `040` entry) — all 157 rows in `topic_content_cache` have `session_id IS NULL`. This is harmless because `app/api/kb/topics/route.ts` and the pipeline both join on `topic_id` directly, never on the unused `session_id` column. Also found 1 legacy row still keyed by an old text slug (`claude-api-messages-and-tool-use`) and ~146 rows whose `topic_id` UUID no longer matches any live `sessions.id` (orphaned from deleted/regenerated sessions) — these are inert rows, not read by any current query path, and pose no correctness risk. **Left untouched** — backfilling `session_id` or cleaning orphaned rows on live data is a separate, low-priority hygiene task, not part of SES-01's functional scope, and changes to live session data require their own spec per the "Spec Before Build" rule.
- **SESS-02** (pipeline fires on `distill/session.designer.completed`, not plan/approve) — ✅ **Done.** Confirmed in `inngest/session-content-pipeline.ts` line 94 — function triggers on `distill/session.designer.completed`.
- **SESS-03** (schedule route UPDATE-only, no delete+reinsert) — ✅ **Done.** Confirmed in `app/api/sessions/schedule/route.ts` — does `UPDATE scheduled_at` per session_index, explicitly skips completed/active sessions, no delete/insert anywhere in the route. Comment in code states this directly.
- **SESS-04** (plan screen groups sessions under Topic/Arc headers) — ✅ **Done.** `app/dashboard/plan/PlanClient.tsx` + `components/plan/ArcSection.tsx` + `components/plan/TopicTree.tsx` group sessions by `arc_name`/`arc_position`/`arc_type`. Same grouping pattern also present in `app/dashboard/sessions/SessionsClient.tsx`.
- **SESS-05** (KB shows one entry per DB session) — ✅ **Done.** `app/api/kb/topics/route.ts` explicitly documents and implements this: queries `sessions` first (ordered by `session_index`), joins `topic_content_cache` by `topic_id IN (session UUIDs)` — one KB card per DB session, not per curriculum topic.
- **TITLE-01** (Arc → Topic → Session title hierarchy) — ✅ **Done**, though shipped bundled into commit `5511169` rather than its own commit. `sessions.session_title` is read as the single source of truth in `SessionsClient.tsx`, `SessionDetailClient.tsx`, and the KB route, with `visible_sessions[].title` as fallback only — matches the "Option B: curriculum plan title is canonical, downstream stores verbatim" decision in `docs/specs/TITLE-01-session-title-consistency.md`.

**Commits:** `5511169` / `010a871` "feat(sessions): DB session UUID as content cache key, schedule fix + KB routes (SESS-01–05)" — both sub-areas and TITLE-01 landed together, undocumented as complete in this backlog until now.
**Build performed this session:** None — everything was already shipped. `npx tsc --noEmit` re-run clean.
**Follow-up (optional, not blocking):** low-priority hygiene task — either drop the unused `topic_content_cache.session_id` column or run its backfill + clean orphaned rows. Not scheduled; flag only if it starts causing confusion.

---

## P2 — Enhancements (after P1)

### LIVE-05 — walkthrough_state Sections Can Drift After Content Regeneration
**Status:** ✅ Done — deployed 2026-06-26. Migration 047 applied.
**What:** `walkthrough_state.sections` is populated at session launch from `topic_content_cache`. If content is regenerated (e.g. via "Generate Content" button in KB) AFTER the user has already launched their walkthrough, the in-memory sections array becomes stale. Clio's LLM context may reference the new content while the UI still displays the old sections.
**Fix:** Add `last_regenerated_at` timestamp to `topic_content_cache` metadata. Before rendering the live session visualization, check if any cache rows have been regenerated more recently than `walkthrough_state.last_updated_at`. If so, refresh sections from DB.
**File:** `app/api/walkthrough-state/[userId]/route.ts`, `inngest/session-content-pipeline.ts` (stamp `last_regenerated_at`)
**Priority note:** This is P2 because it only affects users who trigger a regeneration mid-session — rare case. LIVE-01 and LIVE-02 are the primary causes of current desync.

---

### VIZ-01 — Visualization Fallback Fix
**Status:** Root cause investigated, not fixed.
**What:** Live session falls back to `generate-visual` (slow, unreliable) because `topic_content_cache` content is stored under the key `ai-fundamentals` (wrong) instead of the correct `curriculum_session_id`. 5 sessions need `generate-content` re-run after KB-01 fix is deployed.
**Fix options documented in VISUALIZATION_FALLBACK_ANALYSIS.md.**
**Dependency:** KB-01 must be deployed first.

### CURR-01 — Curriculum Redesign / Content-First Session Architecture
**Status:** ✅ Done — shipped 2026-06-26 (commit `734c50d`, spec `docs/specs/CURR-01-requirement-document.md`). Confirmed live 2026-07-03.
**What:** Planner LLM now emits a flat `comprehensive_subtopics[]` per arc with no session boundaries or artificial cap (`ArcSchema` v2 in `lib/curriculum/planner.ts`). A new pure-code `organizeSubtopicsIntoSessions()` (`lib/curriculum/session-organizer.ts`) divides that list into sessions based on the user's preferred duration — wired live into `app/api/plan/approve/route.ts`. All 3 pre-existing bugs fixed: duration now derives from user preference not subtopic count, `DesignedSessionSchema` subtopics cap raised `max(6)→max(30)`, and `roleLevel` is injected into the session-designer framing prompt (`lib/curriculum/session-designer.ts`).
**Known tradeoff (intentional, not a gap):** `lib/curriculum/enrichment.ts` — the older CURR-01 idea's 3-layer/quality-classifier/7-dimension-coverage engine — still references the retired v1 `arc.sessions[]` shape and is fully disabled on the v2 path (`enrichedPlan` hardcoded to `null` in `planner.ts` with an explicit comment). This is dead code left in place, not a live bug; nothing calls `enrichCurriculumPlan()`. Candidate for cleanup (delete or archive `enrichment.ts`) but not a functional regression.
**Note:** The pre-2026-06-26 version of this backlog entry (3-layer narrative + 7-variant classifier + VP roleId + dimension coverage) was superseded by the content-first architecture above and never built as originally scoped — the newer approach solved the same underlying problem (silent content loss / generic framing) differently.

---

### CURR-02 — Suggested "Breadth Expansion" Topics Never Shown to Users
**Status:** ✅ Done — shipped 2026-05-31 (commit `7986a22`, FB-004), patched 2026-07-02 (commit `0900180`). Confirmed live 2026-07-03.
**What:** The curriculum planner generates extra related topics as a matter of course. These already surface via a "Recommended for you" panel on `/dashboard/plan` (`components/plan/RecommendationCard.tsx`), backed by `app/api/curriculum/plan/route.ts` (GET, computes recommendations), `app/api/curriculum/accept-recommendation/route.ts`, and `app/api/curriculum/dismiss-recommendation/route.ts` — fully interactive (Accept/Dismiss), not just read-only. Gated by `RECOMMENDATION_LIMIT` per tier (executive/pro: 2, starter: 1, free/trial: 0).
**Note:** This entry was stale — the underlying reason a specific test user saw zero recommendations was that the planner's STEP 6 breadth-expansion instruction had no minimum count (fixed 2026-07-03, see planner.ts commit `a35f672`), not a missing surfacing UI.
**File:** `lib/curriculum/planner.ts`, `app/api/curriculum/plan/route.ts`, `components/plan/RecommendationCard.tsx`

---

### CONTENT-02 — Trim Unused/Over-Requested Fields in Generated Articles
**Status:** Not started.
**What:** Generated lesson articles currently ask the AI for a field nobody reads (`source_concepts`) and over-request detail on two other fields (`common_misconceptions`, `decision_questions`) beyond what's actually used. Trimming these would shrink each article by roughly 80–120 words and reduce generation cost slightly, with no loss of visible content.
**File:** the article/content generation prompt (content pipeline)

### B2B-43-FF — Live-Mode Stuck-Session Backstop Coverage
**Status:** Not started (fast-follow, logged per B2B-43's own recommendation).
**What:** B2B-43 Fix 3 added `partnerTrialStuckSessionBackstopSweep` (`inngest/partner-trial-cutoff.ts`), a cron backstop that force-completes `partner_sessions` rows stuck in `'requested'`/`'bot_active'` when their cutoff-arming event was silently dropped — but it is scoped to `test_mode=true` only, matching the one observed incident (2026-07-27, session `9ce14a76-a7ab-4087-a118-38e980f83e69`). Live-mode (non-test_mode) sessions can suffer the identical failure mode via `partner-live-cutoff.ts`'s own `clio/partner-live.started` event — same fire-and-forget `inngest.send()`, same lack of retry or "armed" flag — but no live-mode instance of this has been observed yet, so it was deliberately left out of tonight's fix per the brief's own recommendation.
**Fix (when picked up):** mirror `partnerTrialStuckSessionBackstopSweep`'s query/force-complete pattern against live-mode's own cutoff sequence in `partner-live-cutoff.ts` (its `affordableMinutes`/wallet-funding computation differs from trial's `20 - trial_minutes_used` math, so it needs its own availableMinutes-equivalent recomputation, not a copy-paste of the trial version).
**File:** `inngest/partner-trial-cutoff.ts` (existing, test-mode-only sweep), `inngest/partner-live-cutoff.ts` (target for the live-mode counterpart)

### B2B-43-4a — Exclude Clerk From `/demo/**` (Fix 4a Deferred, Needs Rework)
**Status:** Re-attempt specified 2026-07-29 as `.claude/agents/clio/feature-briefs/B2B-47-demo-multiple-root-layouts-exclude-clerk.md` — full CEO-level re-verification against live code, git history, and live `glitch_instances` data (a real crash was captured 2026-07-29 on `/demo/claude-ai/visuals/choosing-the-right-model` and `/demo/claude-ai/visuals/model-family`, `source: error-boundary`), exact file-move plan, and a mandatory build + live-click-through + live-repro verification bar. Treated as a pure technical fix (no BA gate) per CLAUDE.md's technical/product decision boundary — see that brief's "Governance call" section for the reasoning. Not yet implemented; superseded by B2B-47, not resolved by it until B2B-47's Definition of Done is met.
**What happened (2026-07-28 attempt):** Fixes 3 and 4b from the same original brief (`.claude/agents/clio/feature-briefs/B2B-43-demo-stuck-dispatch-and-screenshare-crash.md`) shipped; this one did not.
**What happened:** The brief's preferred mechanism — a client-side `usePathname()` gate (`ClerkProviderGate`) wrapping `<ClerkProvider>` conditionally around `<html>/<body>` in the root layout — built clean under `tsc --noEmit` but **failed a real `npm run build`**: `usePathname()` is unreliable that high in the tree during Next.js's static-generation pass, so the gate resolved to "no ClerkProvider" for nearly every static route in the app (not just `/demo/**`), causing `useAuth`/`useUser` call sites elsewhere (e.g. `app/partner-invite/accept/PartnerInviteAcceptClient.tsx`, `app/partner-signup/[[...partner-signup]]/page.tsx`) to throw `@clerk/nextjs: useAuth can only be used within the <ClerkProvider />` during prerendering, breaking the build for ~40 unrelated static pages. Caught by the mandatory real-build verification step (tsc alone did not catch it), reverted cleanly before shipping — `app/layout.tsx` and the new `components/ClerkProviderGate.tsx` file are both back to their pre-B2B-43 state.
**Root cause of the underlying issue (issue 4 — screen-share "Application error" crash) is still unresolved.** The brief's own confidence flag already noted this fix was circumstantial (unproven without a live repro) — that stands.
**Fix (when picked up):** the brief's own documented fallback — Next.js "multiple root layouts" via route groups, giving `/demo/**` its own root `<html>/<body>` layout with no `ClerkProvider`, and redistributing every other top-level route ((auth), (marketing), dashboard, invite, partner-invite, partner-questionnaire, partner-render, partner-signup, showcase-render, team-invite, test-harness, test-harness-render, walkthrough) into a second route group that keeps the current root layout. Higher blast radius than the client-gate attempt — needs a dedicated session with live click-through testing across every affected route, not another late-night unattended attempt. Fix 4b (the diagnostic shim's error-boundary detection) already shipped and will surface a real signal the next time the crash recurs, which should sharpen root-cause confidence before investing in this restructuring.
**File:** `app/layout.tsx`, new route-group layouts under `app/(demo)/` and `app/(main)/` or similar (exact grouping TBD)

### B2B-57b-FOLLOWUP — Cross-link Docs `#billing` section to the new Usage page
**Status:** Not started (trivial, additive follow-up logged per the B2B-57b Requirement Doc §10/§12's
own condition of CEO approval).
**What:** `DocsClient.tsx`'s `#billing` section explains the wallet/billing model conceptually but has
no link to the new reseller-facing Usage log page (`/dashboard/configurator/usage`, B2B-57b) that now
shows a reseller their actual per-event usage/delivery records. Add one line/link from `#billing` to
the Usage page, matching the existing `COLORS.cyan` `Link` pattern already used elsewhere in that file
(e.g. its Integration/Playground cross-links).
**File:** `app/(with-clerk)/dashboard/configurator/docs/DocsClient.tsx`

### B2B-75-FF — `/api/openai-realtime-token` missing from `middleware.ts`'s `TENANT_SCOPED_PATTERNS`
**Status:** Not started. **Observation only, deliberately NOT fixed in B2B-75** (different channel's
provider, out of that spec's scope — logged per its §6.11 and §10.B).
**What:** `middleware.ts`'s `TENANT_SCOPED_PATTERNS` lists `/^\/api\/hume-token$/` (and, as of
B2B-75, `/^\/api\/elevenlabs-token$/`) but **not** `/api/openai-realtime-token`. Pre-existing since
B2B-61 Part A.
**Why it is currently dormant, and what would wake it:** widget and partner render URLs are always
built today from `NEXT_PUBLIC_APP_URL` (Clio's own domain), never from a partner's white-label host,
so the tenant-host branch never evaluates this path. The moment a render page is served under a
resolved partner domain, `neutralNotFoundResponse()` would 404 that route and every OpenAI Realtime
session on that host would silently fail to obtain a token — the same latent gap the existing
`/partner-render` and `/widget-render` entries were added defensively to prevent.
**Fix (when picked up):** add `/^\/api\/openai-realtime-token$/` to the same array, alongside the two
sibling token routes. One line; the only reason it was not done in B2B-75 is that that build's
approved file list is exhaustive and this is the meeting-bot channel's provider, not the widget's.
**File:** `middleware.ts`

### B2B-76-FF — Live-Mode Widget Max-Call-Duration Backstop
**Status:** Not started (fast-follow, logged per B2B-76 item 3's own scope decision).
**What:** B2B-76 item 3 added a max-call-duration backstop for widget sessions, merged into
`partnerTrialStuckSessionBackstopSweep` (`inngest/partner-trial-cutoff.ts`) rather than a second
parallel cron (see that function's `MAX_WIDGET_CALL_DURATION_MS` JSDoc for the full reasoning) — but
it is scoped to `test_mode=true` only, deliberately, for the same reason `B2B-43-FF` above scoped the
abandoned-session half of the same sweep to test_mode: `runTrialCutoffSequence()`'s
`record-billable-events` step hardcodes `testMode: true`, and its `availableMinutes` computation
draws from the trial/test wallet (`Math.max(0, 20 - trial_minutes_used) + test_minutes_balance`) —
neither is correct for a real, live-mode (test_mode=false) paid widget session. A genuinely long-
running live-mode widget call today has no server-side duration ceiling at all beyond whatever the
client-side `maxDurationTimeoutRef` nudge in `WidgetRenderClient.tsx` achieves (which cannot survive
a killed or frozen tab).
**Fix (when picked up):** needs its own availableMinutes-equivalent derivation for live-mode billing
(the session's actual configured/purchased minute balance, not the trial/test wallet math) before
`runTrialCutoffSequence()` — or a live-mode-specific variant of it — can be safely reused. Same class
of follow-up work as `B2B-43-FF` above, for the sibling mechanism.
**File:** `inngest/partner-trial-cutoff.ts` (existing sweep, test-mode-only), `inngest/partner-live-cutoff.ts` (likely home for the live-mode billing derivation, matching B2B-43-FF's own file split)

### SCR-01 — Adaptive Script System
**Status:** ✅ Done — confirmed 2026-07-03. The approved spec (`docs/specs/SCR-01-requirement-document.md`) explicitly descopes the 7-variant system and action-item extraction (Section 10, "Out of Scope") — those live elsewhere:
- **7 response variants per checkpoint:** built in `lib/content/script-generator.ts` (CONTENT-01's `CheckpointVariants`, 7 named fields v1-v7) as part of CONTENT-01, not this spec.
- **YES/NO coverage check:** superseded by a 7-dimension coverage model under CURR-01 (`inngest/session-quality-evaluator.ts`), not a binary check — deliberate redesign, not a gap.
- **Plan-reorder engine (SCR-01's actual scope):** fully shipped — event-triggered (not a literal daily cron) via `distill/session.plan.adapt`, handled by `inngest/adapt-plan.ts` (6-step scoring/reorder/audit job), migrations 043/044 applied, acknowledge route live.
- Action-item extraction and `scheduled_at` rescheduling were explicitly deferred by the spec itself to a future item — not part of SCR-01.

---

## CONTENT-01: Content Pipeline Redesign + User Psychology Capture

_P0 — Session experience is broken for real users today. BA spec at `docs/specs/CONTENT-01-requirement-document.md`. Awaiting CEO approval before build._

| ID | Task | Priority | Complexity | Status |
|----|------|----------|------------|--------|
| CONTENT-01-A | Migration 038: Delete duplicate `topic_content_cache` rows, keeping most recent per `(topic_id, subtopic_slug, industry, role)` | P0 | S | Not started |
| CONTENT-01-B | Migration 039: Create `session_insights` table with indexes and RLS | P0 | S | Not started |
| CONTENT-01-C | Apply migrations 038 + 039 in Supabase dashboard (must run before code ships) | P0 | S | Not started |
| CONTENT-01-D | `lib/content/session-content-generator.ts`: Add `ContentArticle` type (6-section structured object); rename main export to `generateContentArticles`; update return shape to produce articles instead of coaching_narrative outlines | P0 | M | Not started |
| CONTENT-01-E | `lib/content/script-generator.ts`: Add `ICE_BREAKER` to `ScriptSegmentType`; add `VisualizationSpec` 3-tuple type; add `ScriptAndVisualizationOutput` type; add `generateScriptAndVisualization` function — one atomic LLM call that produces both script segments and exactly 3 visualization items | P0 | L | Not started |
| CONTENT-01-F | `inngest/session-content-pipeline.ts`: Reorder steps to Content → Script+Viz → Template Select → Template Data → Save → Mark Ready; replace `generateTrainingScript` call with `generateScriptAndVisualization`; pass `contentSpec` from script step into `generateTemplateData`; fix `onConflict` to `topic_id,subtopic_slug,industry,role` | P0 | M | Not started |
| CONTENT-01-G | VP/C-Suite negative + positive calibration rules: hardcode into `generateScriptAndVisualization` prompt — explicit DO NOT phrases (definitions, "enterprise-grade", "AI is not a toy") and explicit DO start phrases (competitive positioning, procurement, compliance framing) | P0 | M | Not started |
| CONTENT-01-H | ICE_BREAKER prompt rules: open situational question format, no comprehension-check phrasing, appears after CHECKPOINT on every subtopic; embed in `generateScriptAndVisualization` system prompt | P0 | S | Not started |
| CONTENT-01-I | Runtime guard: if `visualization_spec.items` count is not exactly 3, correct (truncate or pad) and log warning — prevents downstream template failures | P0 | S | Not started |
| CONTENT-01-J | `inngest/ice-breaker-analyzer.ts`: New Inngest function triggered by `distill/session.ice-breaker.response`; writes raw transcript to `session_insights`; calls Claude with structured extraction prompt; upserts `user_learning_profiles` with derived signals | P1 | M | Not started |
| CONTENT-01-K | Register `analyzeIceBreakerResponse` in `app/api/inngest/route.ts` | P1 | S | Not started |
| CONTENT-01-L | Recall.ai / session-end handler: emit `distill/session.ice-breaker.response` event with `{ sessionId, userId, subtopicSlug, rawTranscript }` at session end (coordinate with Recall.ai transcript pipeline owner) | P1 | M | Not started |
| CONTENT-01-M | TypeScript check: `npx tsc --noEmit` passes with zero errors after all changes | P0 | S | Not started |

**Dependencies for CONTENT-01:**
- Migration 035 must already be applied in production (`topic_content_cache_composite_key` unique constraint on `topic_id, subtopic_slug, industry, role`)
- KB-01 fix must be deployed (upsert error-throw + Step H row-count guard already in `inngest/session-content-pipeline.ts`)
- LIVE-02 (upsert conflict key fix) should land in the same PR as CONTENT-01-F, or before it
- For CONTENT-01-L: Recall.ai transcript pipeline must be able to identify and extract the ice breaker response segment from the full session transcript

**Internal build sequence:**
Migrations first (CONTENT-01-A → B → C, safe before code), then CONTENT-01-D + CONTENT-01-E in parallel, then CONTENT-01-F + G + H + I together (one PR), then CONTENT-01-J + K + L independently.

---

## Build Sequence (recommended)

> **Content Library:** Before any content generation job runs, check `docs/content/[topic-id].md`. If the file exists and is approved (listed in `docs/content/INDEX.md` with status APPROVED), load it as context. Never regenerate approved content from scratch. See `docs/content/CONTENT-METHODOLOGY.md` for the full generation methodology.

```
LIVE-02 (upsert conflict key fix)         ← 1-line fix, unblocks all cache correctness
LIVE-04 (pass industry/role to cache)     ← can do same PR as LIVE-02
    ↓
LIVE-01 (section display — index not fuzzy match) ← fixes the visible desync symptom
    ↓
SESS-06 (subtopic wiring)                 ← required for correct subtopic slugs to exist
    ↓
CONTENT-01 (pipeline redesign)            ← new Content→Script+Viz atomic order, ICE_BREAKER
  └─ LIVE-03 (NAV directives in script)   ← build inside CONTENT-01, same PR
    ↓
ONB-01 (onboarding bugs)                  ← unblocks accurate user profile
    ↓
SCH-01 (schedule setup gate)              ← unblocks all session scheduling
    ↓
KB-02 (section ordering) ✅
KB-03 (KB overview slide) ✅
    ↓
LIVE-05 (walkthrough_state drift)         ← P2, do after P1 complete
VIZ-01 (visualization fallback fix)       ← P2, depends on LIVE-02 deployed
    ↓
CURR-01 ✅ (done)
SCR-01                                     ← enhancement layer, not yet built
```

---

## Feature Briefs & Specs Status

| Feature | CEO Brief | BA Spec | Approved to Build |
|---------|-----------|---------|-------------------|
| LIVE-01 Section display desync (P0) | N/A (bug) | N/A | ❌ Awaiting Arun |
| LIVE-02 Upsert conflict key (P1) | N/A (bug) | N/A | ❌ Awaiting Arun |
| LIVE-03 NAV directives in script (P1) | N/A (bug) | N/A | ❌ Build inside CONTENT-01 |
| LIVE-04 Pipeline hardcoded context (P1) | N/A (bug) | N/A | ❌ Awaiting Arun |
| LIVE-05 walkthrough_state drift (P2) | N/A (bug) | N/A | ❌ Awaiting Arun |
| CONTENT-01 Pipeline Redesign (P0) | ✅ Done | ✅ Done — `docs/specs/CONTENT-01-requirement-document.md` | ❌ Awaiting CEO approval |
| SCH-01 Schedule Setup Gate | ✅ Done | ❌ Needed | ❌ |
| KB-01 Content Pipeline Fix | N/A (bug fix) | N/A | ✅ Done |
| KB-02 Section Ordering | N/A (bug fix) | N/A | ✅ Done |
| KB-03 KB Overview Slide | N/A (small) | N/A | ✅ Done |
| ONB-01 Onboarding Bugs | N/A (bug fix) | N/A | ✅ Partial |
| CURR-01 Content-First Session Architecture | ✅ Done | ✅ Done — `docs/specs/CURR-01-requirement-document.md` | ✅ Shipped 2026-06-26 |
| SCR-01 Adaptive Script | ✅ Done | ❌ Needed | ❌ |
| HUME-NATIVE-01 (Attendee+Hume-native-LLM voice pipeline) | ✅ Done | ✅ Done | ✅ Shipped 2026-07-05 |
| HUME-NATIVE-01 Phase C (nightly config archive + cleanup) | ✅ Done | ✅ Done | ✅ Shipped 2026-07-05 |
| CONTENT-POP-01 (live-conductor content population fix + self-heal) | ✅ Done | ✅ Done | ✅ Shipped 2026-07-05 |
| HUME-NATIVE-01 config-lifecycle consolidation (permanent read/archive function, `web_search` fix, retire debug endpoint) | ✅ Done | ✅ Done — approved, not yet built | ❌ Paused (was about to build on top of `config-provisioner.ts` while it was mid-edit for other fixes — re-verify file state before building) |
| **HUME-WEBHOOK-01** (Hume server-side "call ended + why" signal — safety net for silent client failures) | ✅ Done | ✅ Done — both narrow and broad scope drafted | ⏸️ **Deferred by Arun 2026-07-05** — low priority. Reasoning: existing safety nets (gap watchdog, session timer) already catch most disconnect scenarios; this only helps in the rare case where a user's browser dies so completely nothing else notices. Small effort but narrow real-world impact — revisit later, not urgent. |

---

## Future considerations

- **HUME-SPEAK-01 Q3**: no client-side fallback/timeout nudge added if Hume-native still opens silently after the Option A fix — deferred, low priority, per Arun's judgment call 2026-07-06.
- **RECALL-WEBHOOK-BILLING-GAP** (P1, billing): when the meeting-recording tool (Recall.ai) detects a call ended on its own — its own `bot.call_ended`/`status.call_ended` webhook, in `app/api/recall/webhook/route.ts` — it marks the session `completed` directly, without ever running the actual billing finalization (`forceEndSession()`). Result: no `disconnected` audit event, no minutes deducted, stale planned duration left showing on screen. Confirmed pre-existing (predates all of 2026-07-06's changes), and confirmed to have undercharged a real test call by 2-3 minutes. Fix identified (route this path through `forceEndSession()`, already safe to call twice) but explicitly deferred by Arun on 2026-07-06/07 — "we will come to this billing question later." Not yet built. Also open: whether to manually correct Arun's balance for the undercharged test call, or leave it.

---

_BACKLOG.md v3.4 | Updated 2026-07-07 | Added RECALL-WEBHOOK-BILLING-GAP (deferred per Arun)_
