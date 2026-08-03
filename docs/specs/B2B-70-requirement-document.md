# Embeddable Widget Delivery Channel ("Learn with AI" In-Page) — Requirement Document
Version: 2.0 (supersedes v1.1 on every point listed in "What changed in v2.0" below)
Status: APPROVED (CEO Agent, 2026-08-03)
Author: Business Analyst Agent
Date: 2026-08-03

## CEO Review — Approved 2026-08-03

Reviewed against the Feature Brief's Part 2 amendment and independently re-verified the two most
load-bearing claims myself, directly against live code, rather than taking the BA's report on faith:

1. **`DemoTopicClient.tsx`'s actual Widget Demo tab structure** (Section 0.1 point 6) — confirmed by
   direct read (lines 1010-1053): the branch is exactly `widgetStatusLoading ? "Checking…" :
   widgetActive && widgetRenderUrl ? <live iframe> : <launch form>`. There is no third,
   container-gated "not registered" branch — the BA's correction to the amendment's own framing is
   accurate. The only container-dependent piece is the `no_widget_container` error copy inside the
   launch handler, which the spec correctly scopes the fix to.
2. **The iframe's current `allow`/`sandbox` attributes** (Section 4.B's flagged correction) — confirmed
   by direct read (line 1033-1034): `allow="microphone"` and `sandbox="allow-scripts"`, exactly as
   flagged, not `allow="microphone; autoplay"` with no `sandbox`. This is a real, independent bug
   (present since the tab was first built under v1.1) that the BA was right to surface rather than
   silently carry forward or silently fix without discussion. Correctly added to the Punch List
   (Section 12) as its own build item.
3. **The three new error codes** (`content_source_not_found`, `content_source_auth_type_not_supported`,
   `content_source_url_rejected`) — confirmed by direct read of the do-not-touch
   `app/api/partner/v1/sessions/route.ts` (lines 149, 153-157, 172) that these are the exact,
   already-existing codes that route already returns for the identical checks on the identical field —
   not new codes invented for this spec, exactly as claimed.

The BA's one added technical decision beyond my amendment's own text — re-adding the
`content_source_id` tenant-ownership/auth-type check (Section 6.3 step 5) that my amendment's
instructions did not explicitly call out — is correct and necessary: omitting it would have been a
silent cross-tenant security regression relative to the do-not-touch route's own behavior for the
identical field. Approved as written, not treated as scope creep.

Section 11 (Open Questions) confirmed empty. The one genuinely open product question (retroactive
meeting-bot purge) is correctly logged as a follow-up for Arun in Section 10, not silently resolved
either way and not blocking this document's approval — it is out of scope for what this document
builds.

Cleared for developer handoff.

## What changed in v2.0 (read this first)

v1.1 (approved 2026-08-03, same day) specified Pattern A as a **container-registration model**: an
admin pre-registers a reseller's content once via `/dashboard/admin`, and every session-creation call
references that container by `container_id`. That model was built. Hours later, on the same day, Arun
reviewed the built code and reversed the content-ownership model via a direct amendment to the Feature
Brief (`.claude/agents/clio/feature-briefs/B2B-70-embeddable-widget-delivery-channel.md`, "Part 2 —
2026-08-03 Amendment"). This document (v2.0) is the corrected spec implementing that amendment. It is a
full replacement, not a patch note — read it standalone; do not cross-reference v1.1 for anything this
document itself covers.

**The one-sentence reversal:** a widget session's teaching content (`content_pages` and related fields)
is now supplied by the caller on every `POST /api/partner/v1/widget-sessions` call, exactly like the
existing meeting-bot flow's inline-content mode — never pre-registered, never stored in a Clio-owned
container table, and explicitly purged from the `partner_sessions` row once Clio's own findings have
been recorded back to the reseller. There is no more admin container-registration screen, no more
`partner_widget_containers`/`demo_widget_container_map` tables, and no more `container_id` concept at
all — retired, not renamed.

**What did NOT change from v1.1:** the render-path decision (the widget iframe still points at the
exact same `/partner-render/[clio_session_ref]` route, zero changes to `PartnerRenderClient.tsx` or
`page.tsx`), the auth mechanism (`requirePartnerApiKey`, unchanged), the wallet/billing gate semantics
and status codes, the rate-limit class, the stuck-session backstop sweep widening, the "zero diff to
any pre-existing test file" gate, and every do-not-touch constraint on the meeting-bot channel. Section
0 below (retained from v1.1) documents those unaffected verifications; Section 0.1 (new) documents the
amendment's own verified facts.

Feature Brief: `.claude/agents/clio/feature-briefs/B2B-70-embeddable-widget-delivery-channel.md`
(Part 1: original brief; Part 2: the 2026-08-03 amendment this document implements)
Tracked as: B2B-70 in `docs/b2b-pivot-status.md`

Scope of this document: **Pattern A (server-to-server session creation, caller-supplied inline content,
→ iframe embed) + the real, end-to-end `/demo` tab prototype.** There is no admin container-registration
surface in v2.0 — it is deleted, not merely out of scope (see the Punch List, Section 12). Pattern B
(public widget key, script-tag drop-in) and MCP exposure remain explicitly out of scope — see Section 10.

---

## 0. Independent verification performed for v1.1 (retained — unaffected in substance by the amendment)

Per this project's "no guessing, escalate cleanly" rule, every claim below was checked directly
against live code before v1.1 was written. None of it is invalidated by the amendment — the amendment
changes *where content comes from*, not the auth model, the render path, the billing gate, or the
backstop sweep. Retained verbatim for context; see Section 0.1 for what the amendment itself changes.

1. **`lib/partner/auth.ts`'s `requirePartnerApiKey`** is real, already handles both static API keys
   and OAuth2 tokens, already resolves `accountKind` ('partner' | 'channel_partner') and rate-limits
   per `partner_account_id` + route class. Reusable by import, unmodified, for Pattern A. Confirmed.
2. **`lib/partner/live-render.ts`'s `resolveLiveSessionRender`, `buildInlineSessionContent`, and
   `handleSessionEnd`** are real, already channel-agnostic. Reusable by import, unmodified. Confirmed.
3. **`/partner-render/[clio_session_ref]` (`page.tsx` + `PartnerRenderClient.tsx`) needs ZERO new
   wrapper route.** The widget's iframe `src` is the exact same `render_url` the session-creation
   response already returns (`${appUrl}/partner-render/${clioSessionRef}`). No new render route, no new
   client component, zero lines changed in `PartnerRenderClient.tsx` or `page.tsx`. Unaffected by the
   amendment — content still ultimately becomes an assembled prompt via the same render path regardless
   of whether it originated from a container row or a request body.
4. **`app/api/demo/[slug]/dispatch/route.ts` is a direct, load-bearing precedent** for a public-facing
   route calling the real session-creation endpoint server-to-server using `DEMO_PARTNER_API_KEY`/
   `DEMO_PARTNER_ACCOUNT_ID`. Re-verified directly against the live file for this v2.0 rewrite (see
   Section 0.1 point 4 below) — this is now the literal template the widget-dispatch route mirrors,
   even more closely than under v1.1's container model.
5. **`app/api/partner/render/end-session/route.ts` requires no changes** and already supports a
   bot-less session (`providerBotId` nullable, `billed_duration_source` already has `'client_reported'`).
   Unaffected by the amendment.
6. **`inngest/partner-trial-cutoff.ts`'s `runTrialCutoffSequence`** already handles a null
   `providerBotId`; the stuck-session backstop sweep's status-list widening to include `'widget_active'`
   is unaffected by the amendment — re-verified directly for this rewrite (Section 0.1 point 9).
7. **`partner_sessions.status` CHECK constraint widening** (adding `'widget_active'`) is unaffected —
   still needed, still correct, not touched by migration 109 (Section 6.1).
8. **Rate limiting** (`lib/partner/rate-limit.ts`'s `widget_sessions_create` class) is unaffected —
   re-verified directly for this rewrite (Section 0.1 point 10): still exactly as v1.1 left it.

None of the files on Arun's explicit do-not-touch list (`lib/meeting-bot/*`, `dispatchMeetingBot` in
`lib/partner/session-init.ts`, `app/api/partner/v1/sessions/route.ts`,
`PartnerRenderClient.tsx`/its render path) are modified anywhere in this document, v1.1 or v2.0.

## 0.1 — Independent verification of the 2026-08-03 amendment (new for v2.0)

Every claim in the amendment was re-checked directly against the live, already-built (soon-to-be-rewritten)
code before writing this section — not taken on the amendment's word alone:

1. **`lib/partner/widget-session-schema.ts`, as it exists right now**, is exactly the container-only
   shape the amendment describes: `{ container_id (uuid), end_user_name, end_user_role, end_user_industry,
   partner_end_user_ref, partner_reference, reseller_unique_id, language, reseller_id, client_id }` — no
   content fields at all. Confirmed byte-for-byte; this is the file Section 6.2 below rewrites.
2. **`app/api/partner/v1/widget-sessions/route.ts`, as it exists right now**, resolves `container_id`
   against `partner_widget_containers` (lines 103–122 of the live file), reads the container's own
   `content_pages`/`content_to_explain`/`content_title`/`content_subtitle`/`expected_duration_minutes`,
   generates transition markers from that stored content, and inserts the `partner_sessions` row with
   `container_id` set. Confirmed byte-for-byte; this is the file Section 6.3 below rewrites.
3. **`app/api/partner/v1/sessions/route.ts` (do-not-touch)**, re-read directly: lines 166–180 run
   `assertUrlSafe()` in a loop over every `content_pages[i].url` at request time, rejecting with
   `422 { error: { code: 'content_source_url_rejected', ... } }` — this is the exact protection the
   rewritten widget-sessions route must now run itself (content arrives per-call, not once at
   registration). Lines 144–152 resolve `content_source_id` via `getContentSource(content_source_id,
   auth.partnerAccountId)` — tenant-scoped, 422 `content_source_not_found` if absent — and reject
   `presigned_url`/`mtls` auth types with `content_source_auth_type_not_supported`. Both confirmed as
   the exact behaviors Section 6.3 below mirrors for the rewritten route.
4. **`app/api/demo/[slug]/dispatch/route.ts` (the Meeting-tab dispatch route)**, re-read directly:
   lines 170–178 build `content_pages` from `getDemoTopicBySlug(slug).chapters`, mapping each chapter to
   `{ url: '${DEMO_CONTENT_BASE_URL}/demo/${slug}/visuals/${ch.id}', media_type: 'html', title: ch.title,
   transition_trigger: ..., content_text: flattenBlocksToNarrationText(ch.blocks) }`; lines 180–183 sum
   chapter `durationLabel` minutes into `expected_duration_minutes`. This is confirmed, byte-for-byte,
   the exact construction Section 6.5 below specifies the rewritten `widget-dispatch` route must
   replicate — it is not a paraphrase, it is the same transform applied to the same `topic` object.
5. **`app/api/demo/[slug]/widget-dispatch/route.ts`, as it exists right now**, looks up
   `demo_widget_container_map` by slug (lines 61–73) and 422s with `no_widget_container` if absent.
   Confirmed; this lookup is deleted entirely in Section 6.5's rewrite.
6. **`app/(demo)/demo/[slug]/DemoTopicClient.tsx`**, re-read directly: the `'Widget Demo'` tab
   (line 36, in the `TABS` array) has **no separate "container not registered" gating state** in the
   live component today — `widgetStatusLoading` (line 1018) shows `"Checking…"`, then the branch is
   simply `widgetActive && widgetRenderUrl` (live iframe) vs. else (the launch form), with no third
   "not registered" branch blocking the form itself. The only container-dependent piece is the
   `no_widget_container` error-message branch inside `handleStartWidgetSession()` (line 522: `"No widget
   container has been registered for this topic yet — register one in Admin → Widget containers."`),
   which only fires as a *launch-attempt error*, not a tab-level precondition. This is a narrower finding
   than the amendment's own framing (which describes a distinct "State 1: no container" tab state) — the
   tab was, in fact, already unconditionally rendering its launch form regardless of container status;
   only the one error-copy branch (and its underlying `no_widget_container` cause) needs to go. Confirmed
   by direct read; Section 6.6 below reflects the code as it actually is, not the amendment's shorthand.
7. **`inngest/partner-session-insights-extractor.ts`**: `extractInsightsForPartnerSession()`'s own
   `SELECT` (line 231) does **not** currently select `delivery_channel` — confirmed; Section 6.4 below
   requires adding it, an additive column read (the column already exists on `partner_sessions` since
   migration 108/109, no schema change needed). Its terminal success write (`.update(...)`, lines
   326–338) writes only to `partner_session_insights`, confirmed as the correct place to trigger the new
   purge step immediately after. `markInsightsExtractionFailed()`'s own `partner_sessions!inner(...)`
   embed (line 417–419) also does not currently select `delivery_channel` — same additive fix needed.
   Both confirmed as the exact insertion points the amendment names.
8. **`lib/partner/live-render.ts`**: `assembled_prompt_snapshot` is written at two call sites (lines 487
   and 683 of the live file) — both copy the fully-assembled prompt, which embeds every page's
   `content_text` and the session-level narration fields verbatim, into `partner_sessions
   .assembled_prompt_snapshot`. Confirmed; this is why Section 6.4's purge list includes this column, not
   just the four caller-supplied ones.
9. **`inngest/partner-trial-cutoff.ts`'s backstop sweep** and **`lib/partner/rate-limit.ts`'s
   `widget_sessions_create` class** (`{ capacity: 300, refillPerMs: 300 / 60_000 }`) — both re-verified
   directly for this rewrite: neither references `container_id` or any container table anywhere.
   Confirmed unchanged, zero rework.
10. **`lib/partner/wallet-gate.ts`**: re-read directly — `resolveWalletGate(partnerAccountId, mode,
    expectedDurationMinutes)` takes only primitives, never a container row or `container_id`. Confirmed
    unchanged. The gate-rejection content-purge fix (Section 6.4's edge case) lives in the *calling*
    route (`widget-sessions/route.ts`), not inside this file.
11. **`app/api/demo/[slug]/widget-status/route.ts`**: re-read directly, confirmed zero container
    references anywhere — queries `partner_sessions` directly by `slug`/`delivery_channel`/`status`.
    Confirmed unchanged, zero rework.
12. **Migration `108_b2b70_widget_delivery_channel.sql`**, re-read directly: creates
    `partner_widget_containers` (with FK from `partner_sessions.container_id` and from
    `demo_widget_container_map.container_id`) and `demo_widget_container_map`, and adds
    `partner_sessions.container_id`/`delivery_channel` plus the widened status CHECK. Confirmed this is
    exactly what migration 109 (Section 6.1) must roll back — already applied to production, so 109 is a
    real rollback, not a no-op.

None of the files on Arun's do-not-touch list are touched by this amendment either — re-confirmed by
re-reading every file this document names against that list before finalizing it.

---

## 1. Purpose

Clio's only delivery mechanism today is a meeting-bot joining a real Google Meet/Zoom/Teams call. This
is a structural blocker for the entire class of self-serve, in-app learning reseller (the
Pluralsight-shaped buyer) Arun has identified as Clio's next growth stage — their end users learn
inside the reseller's own product, on demand, and will not join a scheduled video call to talk to an
AI tutor. Without this feature, Clio cannot be piloted or sold to this reseller archetype at all; every
sales conversation with this buyer profile hits the same blocking objection and stops.

This feature adds a second, wholly independent delivery channel: a "Learn with AI" button on a
reseller's own page that opens Clio's identical teaching experience (content pages, voice AI,
verification questions, summary, farewell) in an iframe, in-page, with no meeting platform, no
meeting-bot vendor, and no scheduled call involved at all. Failure without it: Clio remains
structurally unsellable to in-app/self-serve resellers, permanently gated on convincing every such
prospect to accept a workflow (join-a-meeting) their own product design already rejects.

**v2.0 addition to the purpose statement:** the reseller already owns and calls an API with their own
learning content — a Clio-side pre-registration step (v1.1's container model) added friction the
integration doesn't need and implied Clio stores reseller content between calls, which it does not and
should not. v2.0 removes that friction and that storage: every widget session is created with the
reseller's content inline, in the same call, exactly like the existing meeting-bot flow's inline mode —
and once Clio has sent its findings back, nothing reseller-owned is left behind.

## 2. User Stories

**As a reseller's backend engineer (Pattern A integrator),**
I want to call one Clio API with my existing private API key, my own learner's session details, and my
own content pages, in a single request,
So that I get back a session reference and an embeddable URL I can drop into an iframe on my own page —
without pre-registering anything with Clio, operating any meeting infrastructure, or leaving my content
sitting in Clio's database after the session ends.

**As Arun (internal, verifying the build),**
I want a `/demo` tab that actually launches a real widget session end-to-end (real content, real voice,
real billing), with `/demo` itself standing in for "the reseller's own external system" supplying that
content on each call,
So that I can see the exact experience — and the exact integration contract — a reseller's end user and
backend engineer would get, before any reseller ever sees it.

**As Clio (the platform, on behalf of every reseller),**
I want to record my own analysis of a widget session (action items, glitches, learner insight) and send
it back to the reseller, then discard the reseller's own content from that session's row,
So that no reseller's proprietary teaching material sits in Clio's database any longer than it takes to
run the session and report on it.

## 3. Trigger / Entry Point

**Pattern A session creation (production integration surface):**
- Route: `POST /api/partner/v1/widget-sessions` (unchanged route path from v1.1; request shape rewritten
  — see Section 6.2).
- Trigger: the reseller's own backend calls this route when their end user clicks "Learn with AI" in
  the reseller's product, supplying that learner's content pages inline in the same call.
- Required state: caller authenticates with the same partner API key / OAuth2 token mechanism as the
  existing meeting-bot flow (`Authorization: Bearer clio_live_sk_...` / `clio_test_sk_...`, or an OAuth2
  access token) — no new auth system, no Clerk session, no browser context required for this call.

**Container registration (internal admin) — REMOVED in v2.0.** There is no admin trigger, no admin
route, no admin screen for this feature any longer. See Section 4.A (retired) and the Punch List
(Section 12) for the deletion.

**`/demo` tab prototype:**
- Route/page: `app/(demo)/demo/[slug]/page.tsx` (existing) — the existing "Widget Demo" tab within the
  existing tab set (already added under v1.1; unaffected by the amendment).
- Trigger: a visitor on `test.hello-clio.com/demo/[slug]` clicks the "Widget Demo" tab, enters a
  participant name and the existing per-account demo passcode, and clicks "Start widget session."
- Required state: none (public, unauthenticated page, same as every other tab on this page today) —
  gated only by the existing per-account passcode mechanism (`resolveDemoPasscodeToAccount`), exactly
  as the Meeting tab's dispatch flow already is. **No container-registration precondition** — the tab's
  launch form is unconditionally available for every demo topic (see Section 0.1 point 6 — it already
  was, structurally; only the underlying error-cause and its copy change).

## 4. Screen / Flow Description

### 4.A — Admin: "Widget container" card on `/dashboard/admin` — RETIRED, not built

v1.1 specified this screen; it was built (`app/(with-clerk)/dashboard/admin/WidgetContainerCard.tsx` +
`app/api/admin/widget-container/route.ts` + `/resync/route.ts`). Per the amendment, container
registration no longer exists as a concept — a reseller's content is supplied on every session-creation
call, never pre-registered. This screen, its two API routes, and its two-line wiring in
`app/(with-clerk)/dashboard/admin/page.tsx` are **deleted** (Section 12 Punch List), not merely left
unbuilt. There is no replacement admin screen for this feature in v2.0.

### 4.B — `/demo/[slug]` page: existing "Widget Demo" tab, rewritten states

Tab already exists in the `TABS` constant in `DemoTopicClient.tsx` (`['Course Overview', 'Transcript',
'Visuals', 'Resources', 'Discussion', 'Meeting', 'Widget Demo', 'Learning Check', 'Performance']`),
positioned immediately after `'Meeting'`. No change to tab position or label. Per Section 0.1 point 6,
the tab's launch form was already unconditionally rendered (there was never a true tab-level "container
not registered, no controls shown" gate in the live code) — so v2.0's change here is narrower than v1.1
described: remove the one container-dependent error branch, not a whole screen state.

**State 1 — Ready to launch (default state, no precondition).**
Intro copy (unchanged from the live component):
`"A different delivery channel from the Meeting tab above: no Google Meet, no bot joining a call — Clio
renders directly in the box below, exactly as it would embedded in a reseller's own web page."`
Then, once the (unchanged) `widget-status` fetch resolves and reports no active session:
- A text input labeled `"Name"`, placeholder `"Participant's name"` (unchanged — `meetingInputStyle`/
  `meetingFieldWrapStyle`/`meetingLabelStyle`, identical markup to today).
- A primary button `"✨ Start widget session"` (unchanged `aiButtonStyle`), disabled until the name field
  is non-empty. Clicking it reveals a passcode input + `"Start widget session"` / `"Cancel"` pair
  (unchanged flow) rather than launching immediately — same two-step reveal as today.
- Passcode input (`type="password"`, placeholder `"Passcode"`) + the same primary button, now reading
  `"Starting…"` while in flight (unchanged copy/behavior).

**State 2 — Widget session live (embedded).** Unchanged from the live component:
- A framed `<iframe>` (`aspectRatio: '16/9'`, `background: '#000'`, `border: 1px solid ${COLORS.border}`,
  `borderRadius: 10`), `src` set to the `render_url` returned by the launch call.
- **Correction carried into v2.0 (flagged, not silently inherited):** the live component's current
  `<iframe>` sets `allow="microphone"` and `sandbox="allow-scripts"` — **not**
  `allow="microphone; autoplay"` and no `sandbox` attribute at all, which is what v1.1's own Section 4.B
  specified as load-bearing (autoplay permission; and a `sandbox` attribute without `allow-same-origin`
  can itself break `getUserMedia()` in some browsers, since sandboxed cross-origin content without
  `allow-same-origin` cannot be granted permissions-policy features reliably). This is a **genuine,
  pre-existing gap between the v1.1 spec and the shipped code**, orthogonal to the amendment, and is
  called out here rather than silently carried forward or silently "fixed" without discussion — flagged
  explicitly as a v2.0 build item (Section 12) to correct the iframe's `allow`/`sandbox` attributes to
  match v1.1's original, still-correct reasoning: `allow="microphone; autoplay"`, no `sandbox` attribute.
- An `"End session"` button (unchanged `secondaryButtonStyle`), always visible while the iframe is
  mounted.

**State 3 — Launch error.** Unchanged copy/placement, with one deletion:
- `"Incorrect passcode."` (unchanged).
- `"A widget session is already active for this topic..."` (unchanged, `session_already_active`).
- **Deleted:** the `no_widget_container` branch and its copy (`"No widget container has been registered
  for this topic yet — register one in Admin → Widget containers."`, live component line 522–523) — this
  error can no longer occur, since there is no container to be missing. Replaced by whatever the
  rewritten `widget-dispatch` route's own new failure modes are (Section 6.5/8) — in practice, a content
  build failure from the demo topic's own authored data, which should never happen for an existing,
  valid `slug` (the same content already renders successfully on the Meeting tab), so this becomes a
  generic `"Something went wrong starting the widget session. Try again in a moment."` catch-all rather
  than a named, expected error state.

## 5. Visual Examples

Section 4.A's two admin wireframes (v1.1) are **removed** — that screen does not exist in v2.0.

**`/demo/[slug]` — Widget Demo tab, State 1 (ready to launch):**
```
┌─────────────────────────────────────────────────────────┐
│  Course Overview  Transcript  Visuals  Resources          │
│  Discussion  Meeting  [Widget Demo]  Learning Check  Perf. │
│                                                           │
│  A different delivery channel from the Meeting tab        │
│  above: no Google Meet, no bot joining a call — Clio      │
│  renders directly in the box below, exactly as it would   │
│  embedded in a reseller's own web page.                   │
│                                                           │
│  Name          [ Participant's name            ]          │
│                                                           │
│  [✨ START WIDGET SESSION]                                 │
└─────────────────────────────────────────────────────────┘
```

**`/demo/[slug]` — Widget Demo tab, State 2 (live):**
```
┌─────────────────────────────────────────────────────────┐
│  Course Overview  ...  [Widget Demo]  ...                 │
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │        [ live Clio teaching experience, ]           │   │
│  │        [ same content/voice as Meeting  ]           │   │
│  │        [ tab, rendered via iframe        ]          │   │
│  │                                                     │   │
│  └───────────────────────────────────────────────────┘   │
│                                                           │
│  [END SESSION]                                             │
└─────────────────────────────────────────────────────────┘
```

## 6. Data Requirements

### 6.1 Migration `109_b2b70_widget_inline_content_amendment.sql` — rollback of migration 108's container tables

```sql
-- B2B-70 v2.0 (docs/specs/B2B-70-requirement-document.md §6.1) — reversal of the container-based
-- content-ownership model shipped in migration 108, per Arun's 2026-08-03 same-day amendment. Migration
-- 108 was already applied to production before this rollback was written — this is a real rollback, not
-- a no-op. Zero real (external-reseller) widget-channel sessions exist as of this migration — confirmed
-- nothing external depends on partner_sessions.container_id.

DROP TABLE IF EXISTS demo_widget_container_map;
DROP TABLE IF EXISTS partner_widget_containers CASCADE;

ALTER TABLE partner_sessions DROP COLUMN IF EXISTS container_id;

-- delivery_channel ('meeting_bot' | 'widget') and the widened status CHECK (admitting 'widget_active')
-- are KEPT, unchanged — still correct, still needed, orthogonal to the content-ownership reversal.
```

No new columns are added by this migration — the content-purge mechanism (Section 6.4) operates entirely
via `UPDATE` statements against `partner_sessions` columns that already exist (`content_pages`,
`content_to_explain`, `content_title`, `content_subtitle`, `assembled_prompt_snapshot`), all already
nullable.

### 6.2 Rewritten request schema: `lib/partner/widget-session-schema.ts`

Same exported name (`CreateWidgetSessionSchema`), same file — rewritten in place per the amendment's §1:

```ts
import { z } from 'zod'
import { ContentPageSchema, DEFAULT_EXPECTED_DURATION_MINUTES } from '@/lib/partner/session-schema'

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/

export const CreateWidgetSessionSchema = z
  .object({
    content_pages: z.array(ContentPageSchema).min(1),
    content_source_id: z.string().uuid().optional(),
    content_to_explain: z.string().max(5000).optional(),
    content_title: z.string().max(200).optional(),
    content_subtitle: z.string().max(300).optional(),
    expected_duration_minutes: z.number().int().positive().max(600).optional(),
    end_user_name: z.string().trim().min(1, 'end_user_name is required').max(200),
    end_user_role: z.string().trim().max(200).optional(),
    end_user_industry: z.string().trim().max(200).optional(),
    partner_end_user_ref: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    partner_reference: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    reseller_unique_id: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    language: z.string().trim().min(1).max(60).optional(),
    reseller_id: z.string().uuid('reseller_id must be a valid UUID'),
    client_id: z.string().uuid().optional(),
  })
  .refine((data) => Boolean(data.content_source_id), {
    message: 'content_source_id is required when content_pages is provided.',
    path: ['content_source_id'],
  })

export type CreateWidgetSessionInput = z.infer<typeof CreateWidgetSessionSchema>
```

Notes on this shape (settled, per the amendment — not re-litigated here):
- `ContentPageSchema` and `DEFAULT_EXPECTED_DURATION_MINUTES` are **imported** from
  `lib/partner/session-schema.ts`, not redefined — this is a genuinely different Zod object
  (`CreateWidgetSessionSchema` is not derived from `CreateSessionSchema`, since it has no `meeting_url`
  and no Option-2 reference fields), but the per-page shape and the default-duration constant are shared,
  single-sourced values, matching this codebase's existing convention of not duplicating shared shapes.
- `content_pages` is **always required** here (`min(1)`, no `.optional()`) — unlike `CreateSessionSchema`,
  there is no "Option 2" (reference-mode) branch for widget sessions at all, so the "exactly one of
  inline/reference" refine that `CreateSessionSchema` needs does not apply; only the second refine
  (`content_source_id` required alongside `content_pages`) is relevant, and is kept.
- `container_id` does not appear anywhere in this schema. Retired, not replaced with a passthrough field
  — `partner_reference`/`reseller_unique_id` already serve as the reseller's own correlation identifiers
  (per the amendment's own reasoning, §1).

### 6.3 Rewritten route: `POST /api/partner/v1/widget-sessions`

Same file, same route path. Full sequence:

1. `requirePartnerApiKey(request, 'widget_sessions_create')` — unchanged auth + rate-limit class.
2. Zod parse via the rewritten `CreateWidgetSessionSchema` (§6.2). Failure → `422` generic validation
   response (unchanged shape).
3. `reseller_id === auth.partnerAccountId` pre-flight — identical to the existing `/sessions` route,
   `422 invalid_reseller_id` on mismatch (unchanged from v1.1).
4. `client_id` pre-flight for `channel_partner` callers — identical to the existing `/sessions` route,
   `422 client_id_required` / `422 invalid_client_id` (unchanged from v1.1).
5. **Content-source tenant-scoped resolution (BA-added in v2.0; not explicit in the amendment's own
   text, resolved here rather than left open — see reasoning below).** Look up `content_source_id` via
   `getContentSource(content_source_id, auth.partnerAccountId)` (imported, unmodified — the exact
   function the do-not-touch `/sessions` route already calls at its own State B2). Not found →
   `422 { error: { code: 'content_source_not_found', message: 'content_source_id not found for this
   account.' } }`. Found but `authType` is `'presigned_url'` or `'mtls'` → `422 { error: { code:
   'content_source_auth_type_not_supported', message: "auth_type '<type>' is documented but not yet
   supported." } }`. **Reasoning:** the rewritten schema requires `content_source_id` whenever
   `content_pages` is present — identical to `CreateSessionSchema`'s own refine rule — but the amendment
   text does not explicitly say whether the existing tenant-ownership/auth-type check on that field
   should also apply here. Omitting it would be a real, silent regression relative to the do-not-touch
   `/sessions` route's own inline-mode behavior for the identical field (any account could reference any
   other account's `content_source_id` with no check). This is resolved here as a documented default —
   mirror the existing route's own check exactly — rather than left as an open question, per this
   project's "no guessing, but don't leave it open either" rule.
6. **Per-page URL safety** — `assertUrlSafe()` (imported, unmodified) run in a loop over every
   `content_pages[i].url`, mirroring the do-not-touch `/sessions` route's own State B3 exactly (lines
   166–180 of that file, per Section 0.1 point 3). Any unsafe URL → `422 { error: { code:
   'content_source_url_rejected', message: "content_pages[<i>].url is not an allowed URL (<reason>). Must
   be https to a public host.", rejected_index: <i> } }` — same error code the `/sessions` route already
   uses for the identical failure, not a new code invented for this route.
7. **Transition marker generation** — `generateTransitionMarkers()` (imported, unmodified), same call
   shape as the existing `/sessions` route's own inline pre-flight. Narration string built from
   `[content_to_explain, content_title, content_subtitle].filter(Boolean).join(' ')`, identical
   construction to the existing route.
8. **Insert `partner_sessions` row** — `delivery_channel: 'widget'`, `status: 'widget_active'`, no
   `container_id` column (dropped, §6.1), `content_pages` (with markers attached), `content_source_id`,
   `content_to_explain`, `content_title`, `content_subtitle`,
   `expected_duration_minutes: expected_duration_minutes ?? DEFAULT_EXPECTED_DURATION_MINUTES` (imported
   constant, 30 — **correction from the live, soon-to-be-replaced code's own local `?? 15` fallback**,
   which was a container-model artifact with no equivalent meaning here; `DEFAULT_EXPECTED_DURATION_MINUTES`
   is the single-sourced constant the existing `/sessions` route already uses for the identical
   fallback), plus the usual `end_user_*`/`partner_*`/`reseller_unique_id` fields. Idempotent-replay
   branch on Postgres `23505` (unique `reseller_unique_id` violation) — unchanged from v1.1, same
   original-row-return behavior as the existing `/sessions` route.
9. **Wallet gate** via `resolveWalletGate()` (`lib/partner/wallet-gate.ts`, unchanged — Section 0.1 point
   10) — identical card_required/trial_exhausted/funding_required/balance_exhausted semantics and status
   codes as v1.1/the existing route. **New in v2.0 (the amendment's edge-case fix, §3):** the
   gate-rejection branch's own `.update({ status: 'failed', end_reason: <code> })` call must, in the
   *same* update, also set `content_pages: null, content_to_explain: null, content_title: null,
   content_subtitle: null, assembled_prompt_snapshot: null` — because the row was inserted (step 8, with
   content already written) *before* this gate runs, and a rejected session never reaches
   `widget_active`, never emits `clio/partner-session.ended`, and so never enters the insights-extraction
   pipeline (Section 6.4) that would otherwise be the trigger for this same cleanup. This is a stronger
   instance of "no leftovers" than a completed session — no bot or voice model ever spoke this content —
   and costs nothing extra (same `UPDATE` statement, five more columns).
10. **Response (201):**
    ```json
    {
      "clio_session_ref": "uuid",
      "status": "widget_active",
      "render_url": "https://<app-host>/partner-render/<clio_session_ref>",
      "reseller_unique_id": "..." // echoed only if the caller sent one
    }
    ```

**No `clio/partner-trial.started`/`clio/partner-live.started` event is emitted** (unchanged from v1.1) —
those events arm a bot-leave timer with no equivalent in a browser-widget flow; the only abandoned-tab
safety net remains `inngest/partner-trial-cutoff.ts`'s stuck-session backstop sweep, already widened to
recover `'widget_active'` rows (Section 0 point 6 / 0.1 point 9).

**Embed URL trust model** — unchanged from v1.1: `render_url` is the same opaque-UUID-resolves-to-a-row
trust boundary the meeting-bot flow already uses. Not single-use, not time-boxed. No new security
primitive introduced by the amendment.

### 6.4 Content-purge mechanism ("no leftovers") — new in v2.0

**What counts as "the data" to purge:** the reseller-supplied teaching material written to the
`partner_sessions` row at creation time — `content_pages`, `content_to_explain`, `content_title`,
`content_subtitle` — plus the one derived artifact that embeds that same material verbatim:
`assembled_prompt_snapshot` (written by `lib/partner/live-render.ts`'s `buildInlineSessionContent()`
call sites, Section 0.1 point 8 — leaving this column populated after "purging" the source columns would
be a back door).

**What does NOT get purged:** `end_user_name`/`end_user_role`/`end_user_industry`,
`partner_reference`/`reseller_unique_id`/`partner_end_user_ref`, `conversation_language` — session/
participant metadata, not reseller content; every existing session (meeting-bot or widget) already
retains these indefinitely.

**What "our findings" means:** the existing, unmodified `session.completed`/`usage.voice_minute`/
`session.insights_ready` webhook events, dispatched through `recordBillableEvent()`/
`recordInsightsReadyEvent()` (`lib/partner/webhooks.ts`). Nothing new is added here.

**Trigger 1 — successful/empty extraction.** In
`inngest/partner-session-insights-extractor.ts`'s `extractInsightsForPartnerSession()`:
- `SELECT` (currently missing this field, Section 0.1 point 7) must add `delivery_channel` to its column
  list.
- Immediately after the existing `recordInsightsReadyEvent()` call succeeds (both the `'success'` and
  `'success_empty'` `extraction_status` paths), **and only when `session.delivery_channel === 'widget'`**,
  run a new, best-effort, non-blocking `UPDATE` on that `partner_sessions` row nulling
  `content_pages`/`content_to_explain`/`content_title`/`content_subtitle`/`assembled_prompt_snapshot`. A
  failure of this `UPDATE` is logged, never thrown — it must never revert or block the already-successful
  insights write that precedes it.

**Trigger 2 — permanent extraction failure.** In `markInsightsExtractionFailed()`:
- Its own `partner_sessions!inner(...)` FK embed (currently missing this field, Section 0.1 point 7)
  must add `delivery_channel` to its column list.
- At the exact point it fires its own `recordInsightsReadyEvent()` call (the `attempt_count >= 3`
  permanent-failure branch), **and only when the embedded session's `delivery_channel === 'widget'`**, run
  the identical nulling `UPDATE`. Reasoning (from the amendment): a session whose transcript extraction
  permanently failed still had its findings-attempt "sent" (the `extraction_status: 'failed'` webhook
  payload is itself a finding), and the reseller's own content is no more needed after a permanent
  failure than after a success.

**Trigger 3 — wallet-gate rejection (edge case, covered in Section 6.3 step 9, not here).** A session
rejected at the wallet-gate stage never reaches `widget_active` and never enters this extraction
pipeline at all — its content-nulling happens inline in the widget-sessions route itself, in the same
`UPDATE` that records the rejection. Listed here for completeness; the authoritative spec for it is
Section 6.3 step 9.

**Definition of "sent" (settled, not re-litigated):** "sent" means the `session.insights_ready`
reference event has been *recorded* (`recordInsightsReadyEvent()`'s `webhook_dispatch_log` insert has
completed) — not "HTTP-delivered to the reseller's endpoint." Actual HTTP delivery happens
asynchronously via `inngest/partner-webhook-dispatcher.ts`'s `attemptDispatch()`, which already treats an
account with no `outbound_base_url` configured as `'skipped_no_endpoint'` — left pending indefinitely, by
design (`lib/partner/webhooks.ts`). Clio's own internal demo account almost certainly has no
`outbound_base_url` configured. If purge waited on confirmed HTTP delivery, content would never purge for
the very account this feature's own `/demo` tab uses to prove the contract works — so "sent" = "recorded,"
consistent with this codebase's established fire-and-forget dispatch convention throughout `webhooks.ts`,
not a new precedent invented for this feature.

**Scope — widget channel only, not retroactive to meeting-bot sessions.** See Section 10 for the
explicit scope statement and the follow-up question logged for Arun.

**Interaction with the B2B-65 demo Performance tab:** `partner_session_insights` is a wholly separate
table from `partner_sessions`; the Performance tab reads only `partner_session_insights` columns, never
`partner_sessions.content_pages`/etc. No conflict.

### 6.5 Rewritten route: `POST /api/demo/[slug]/widget-dispatch`

Structural twin of `app/api/demo/[slug]/dispatch/route.ts` (the Meeting-tab dispatch route — Section 0.1
point 4), rewritten to stop depending on `demo_widget_container_map`/`container_id` entirely:

1. Same `DispatchSchema` (`{ passcode, end_user_name }`) + `resolveDemoPasscodeToAccount()` gate
   (unchanged).
2. Same duplicate-active-session guard, scoped to this slug's most recent `delivery_channel='widget'`
   session (unchanged from v1.1).
3. **Content assembly (rewritten)** — no longer a `demo_widget_container_map` lookup. Instead, assemble
   `content_pages`/`content_to_explain`/`content_title`/`content_subtitle`/`expected_duration_minutes`
   directly from `getDemoTopicBySlug(slug)` + `flattenBlocksToNarrationText()`, using the **exact same
   construction** the Meeting-tab dispatch route already uses (Section 0.1 point 4 — same
   `DEMO_CONTENT_BASE_URL`-rooted URL building: `${contentBaseUrl}/demo/${slug}/visuals/${ch.id}`; same
   `content_text: flattenBlocksToNarrationText(ch.blocks)`; same `expected_duration_minutes` = sum of
   parsed `durationLabel` minutes across chapters). `content_source_id: process.env.DEMO_CONTENT_SOURCE_ID`
   (same env var the Meeting-tab route already uses).
4. Calls the rewritten `POST /api/partner/v1/widget-sessions` (§6.3) with:
   ```json
   {
     "content_pages": [...],
     "content_source_id": "<DEMO_CONTENT_SOURCE_ID>",
     "content_to_explain": "<topic.overview>",
     "content_title": "<topic.title>",
     "content_subtitle": "<topic.subtitle>",
     "expected_duration_minutes": <sum>,
     "end_user_name": "<from request body>",
     "partner_reference": "<slug>",
     "reseller_id": "<DEMO_PARTNER_ACCOUNT_ID>"
   }
   ```
   via the same server-to-server `fetch()` + `DEMO_PARTNER_API_KEY` pattern already in place.
5. On success, writes the same `demo_dispatches` billing-attribution row (unchanged — this table was
   never scoped to meeting-bot sessions).
6. Response to the client: `{ status: 'dispatched', clio_session_ref, render_url }` (unchanged from
   v1.1 — `render_url` is still the one genuinely new piece of client-visible data this route adds, since
   the visitor's own browser renders the iframe, unlike the Meeting tab where the bot navigates there
   itself).

No `no_widget_container` error branch exists in the rewritten route — there is nothing to be missing.

### 6.6 `/demo/[slug]` Widget Demo tab — client changes

Per Section 0.1 point 6, the tab's launch form was already unconditionally rendered in the live
component; the only change is removing the `no_widget_container` error-message branch inside
`handleStartWidgetSession()` and its copy (`DemoTopicClient.tsx`, live line ~522–523), and — per Section
4.B's flagged correction — fixing the `<iframe>`'s `allow`/`sandbox` attributes to
`allow="microphone; autoplay"` with no `sandbox` attribute. No other lines in this component change; the
`TABS` array, all `widget*` state variables, the `widget-status` restore-on-load effect, and the
name/passcode/launch/end-session flow are all unchanged from the live component.

### 6.7 `/demo/[slug]` widget-status route — unchanged

`app/api/demo/[slug]/widget-status/route.ts` requires zero changes (Section 0.1 point 11) — it never
referenced containers.

### 6.8 `lib/partner/wallet-gate.ts` — unchanged

Confirmed content-model-agnostic (Section 0.1 point 10). The gate-rejection content-nulling fix
(Section 6.3 step 9) lives in the calling route, not in this file.

### 6.9 `lib/partner/rate-limit.ts` and `inngest/partner-trial-cutoff.ts` — unchanged

Both re-confirmed container-agnostic (Section 0.1 point 9). No changes from v1.1.

### 6.10 What is read from the database (widget-sessions route, v2.0)

`partner_accounts` (auth resolution, unchanged), `partner_content_sources` (via `getContentSource()`,
§6.3 step 5 — new in v2.0, replacing the v1.1 `partner_widget_containers` read), `partner_wallets`
(existing wallet-gate columns, unchanged). **`partner_widget_containers` is no longer read anywhere** —
the table no longer exists after migration 109.

## 7. Success Criteria (Acceptance Tests)

✓ Given a valid live-mode API key, a valid `content_source_id` owned by that account, at least one
  `content_pages` entry with a safe `https` URL, and a valid `end_user_name`/`reseller_id`, when the
  reseller's backend calls `POST /api/partner/v1/widget-sessions`, then the response is `201` with
  `status: 'widget_active'`, a `clio_session_ref`, and a `render_url`.

✓ Given that same `render_url`, when it is set as an iframe `src` with `allow="microphone; autoplay"` on
  a page served from a **different** origin, then the embedded page connects voice, renders the
  submitted content pages in order, accepts spoken verification answers, and reaches a farewell/
  `end_session` exactly as the same session would on the meeting-bot channel — with zero code changes to
  `PartnerRenderClient.tsx` or `page.tsx`.

✓ Given a request omitting `content_pages` entirely, when `POST /api/partner/v1/widget-sessions` is
  called, then the response is `422` (Zod validation failure — `content_pages` is required, `min(1)`).

✓ Given a request with `content_pages` present but `content_source_id` omitted, when the route is
  called, then the response is `422` (the schema's own refine rule).

✓ Given a `content_source_id` that does not belong to the caller's account, when the route is called,
  then the response is `422` with `error.code: 'content_source_not_found'`, no `partner_sessions` row is
  created, and no wallet/vendor cost is incurred.

✓ Given a `content_source_id` whose `auth_type` is `'presigned_url'` or `'mtls'`, when the route is
  called, then the response is `422` with `error.code: 'content_source_auth_type_not_supported'`.

✓ Given a `content_pages[].url` that fails `assertUrlSafe()` (e.g. a private/internal host), when the
  route is called, then the response is `422` with `error.code: 'content_source_url_rejected'` and the
  correct `rejected_index`, no session row is created.

✓ Given a test-mode API key whose account has no card on file, when the route is called against
  otherwise-valid content, then the response is `402` with `error.code: 'card_required'` — identical to
  the existing meeting-bot route's own card-required check — **and** the `partner_sessions` row created
  for that rejected attempt has `content_pages`/`content_to_explain`/`content_title`/`content_subtitle`/
  `assembled_prompt_snapshot` all `NULL` (the wallet-gate-rejection purge edge case, Section 6.3 step 9).

✓ Given a widget session that completes normally and its insights extraction succeeds (`'success'` or
  `'success_empty'`), when `extractInsightsForPartnerSession()`'s terminal write finishes, then that
  session's `partner_sessions` row has `content_pages`/`content_to_explain`/`content_title`/
  `content_subtitle`/`assembled_prompt_snapshot` all `NULL`, while its `partner_session_insights` row
  retains the full extracted findings unaffected.

✓ Given a widget session whose transcript extraction permanently fails (`attempt_count` reaches 3), when
  `markInsightsExtractionFailed()`'s permanent-failure branch fires its own `recordInsightsReadyEvent()`
  call, then the same content columns are nulled on that session's `partner_sessions` row.

✓ Given a **meeting-bot** (`delivery_channel = 'meeting_bot'`) session that completes and whose insights
  extraction succeeds, when the same extraction function runs, then its `content_pages`/etc. are **NOT**
  nulled — confirming the purge is scoped to `delivery_channel = 'widget'` only, and the meeting-bot
  channel's existing behavior is completely unaffected by this feature.

✓ Given a widget session whose content has been purged, when the demo Performance tab (or any partner's
  equivalent insights view) is loaded, then it renders identically to before the purge — it reads only
  `partner_session_insights` columns, never `partner_sessions.content_pages`.

✓ Given the entire existing meeting-bot test suite (every `tests/unit/*` and `tests/integration/*` file
  that predates this feature), when `vitest run` is executed after this feature is built, then every one
  of those files has **zero diff** and the full suite still passes — hard pass/fail gate, not a
  nice-to-have. (`tests/unit/b2b70-widget-session-schema.test.ts` is rewritten for the new inline schema —
  this is a v1.1/v2.0-era test file, not a pre-existing one, so rewriting it does not violate this gate;
  `tests/unit/b2b70-widget-active-backstop.test.ts` and `tests/unit/b2b70-widget-rate-limit.test.ts` are
  unchanged.)

✓ Given a widget session that never receives an explicit "End session" click or a `pagehide` beacon
  (e.g. a crashed tab), when `partnerTrialStuckSessionBackstopSweep` next runs (test-mode sessions only,
  ≥60 minutes stuck), then the session is force-completed and billed for its allotted minutes — identical
  recovery behavior to a stuck meeting-bot session.

## 8. Error States

| Call | Failure | User/caller sees |
|---|---|---|
| `POST /api/partner/v1/widget-sessions` | Missing/invalid API key | `401 invalid_api_key` (unchanged, reused via `requirePartnerApiKey`) |
| same | Rate limit exceeded | `429 rate_limit_exceeded` with `Retry-After` (unchanged, reused) |
| same | `reseller_id` mismatch | `422 invalid_reseller_id` (unchanged from v1.1) |
| same | `client_id` missing/invalid (channel-partner caller) | `422 client_id_required` / `422 invalid_client_id` (unchanged) |
| same | `content_pages` missing or empty | `422` generic Zod validation failure |
| same | `content_source_id` missing while `content_pages` present | `422` generic Zod validation failure (schema refine) |
| same | `content_source_id` not found / not this account's | `422 content_source_not_found` **(replaces v1.1's `container_not_found`)** |
| same | `content_source_id`'s `auth_type` is `presigned_url`/`mtls` | `422 content_source_auth_type_not_supported` (new in v2.0) |
| same | A `content_pages[].url` fails `assertUrlSafe()` | `422 content_source_url_rejected` with `rejected_index` (new in v2.0; replaces v1.1's registration-time-only check) |
| same | Test mode, no card on file | `402 card_required` (unchanged wallet-gate behavior; now also purges content columns on the rejected row) |
| same | Test mode, trial/test minutes exhausted | `402 trial_exhausted` (unchanged; also purges content columns) |
| same | Live mode, no card on file | `402 funding_required` (unchanged; also purges content columns) |
| same | Live mode, balance can't cover `expected_duration_minutes` | `402 balance_exhausted` (unchanged; also purges content columns) |
| `/demo` widget-dispatch | Wrong passcode | `"Incorrect passcode."` (tab State 3) |
| same | A widget session is already active for this slug | `"A widget session is already active for this topic. End it before starting a new one."` (unchanged) |
| same | Upstream `widget-sessions` call fails/network error, or any other unexpected failure (no more `no_widget_container` — nothing left to be missing) | `"Something went wrong starting the widget session. Try again in a moment."` (generic catch-all; never forwards vendor/internal detail) |
| iframe itself (inside `PartnerRenderClient.tsx`, unchanged) | Voice connection fails | Existing `'error'` status screen — no change, no new behavior introduced by embedding |
| Missing `allow="microphone; autoplay"` on the parent's iframe tag (see Section 4.B's flagged correction) | Browser rejects `getUserMedia()` inside the iframe | Same existing `'error'` status screen `PartnerRenderClient.tsx` already shows for any mic-permission failure |

Removed entirely from v1.1's table: `container_not_found`, `container_disabled` (both `POST
/api/partner/v1/widget-sessions`), and every admin-card error row (`"Couldn't create the container..."`,
`"Couldn't re-sync content..."`) — that screen no longer exists.

## 9. Edge Cases

- **A reseller updates their own content between calls.** No stale-container problem exists in v2.0 —
  nothing is stored between calls, so the very next session-creation call simply carries whatever
  content the reseller sends that time. (v1.1's "container content changes after sessions have already
  used it" edge case no longer applies — there is no container.)
- **First launch vs. repeat launch on the same `/demo` slug:** unchanged from v1.1 — the tab's launch
  form reappears after a session ends, no page reload needed.
- **Two widget sessions launched back-to-back before the first ends:** unchanged from v1.1 — each call
  creates an independent `partner_sessions` row; no at-most-one-active-session assumption for the widget
  channel (unlike the Meeting tab's own single-active-session guard, which is meeting-URL-scoped and
  does not apply here).
- **A widget session rejected at the wallet-gate stage:** covered explicitly now (Section 6.3 step 9,
  Section 7) — its content is purged in the same write as the rejection, a stronger case of "no
  leftovers" than a completed session.
- **Reseller's page embeds the iframe without `allow="microphone; autoplay"`:** unchanged failure mode
  from v1.1 (Section 4.B, Section 8) — the render page's existing mic-permission-error handling degrades
  exactly as it already does today for any other mic-denial scenario.
- **Channel-partner (reseller-of-resellers) calling this route on behalf of a client:** unchanged from
  v1.1 — the same `client_id` pre-flight already enforced by the existing `/sessions` route applies here
  too.
- **Mobile browser embedding:** unchanged from v1.1 — no special mobile handling beyond what
  `PartnerRenderClient.tsx` already provides; the tab's own markup (iframe wrapper, name/passcode inputs,
  buttons) follows this project's standing responsive/`clamp()` rule, no fixed pixel-width container.
- **Slow network on widget-session creation:** unchanged from v1.1 — no loading state beyond the
  button's own `"Starting…"` label swap.
- **A test file elsewhere in the suite enumerates `RateLimitClass`/`LIMITS` exhaustively:** unchanged
  flag from v1.1 — check before considering Section 7's zero-existing-test-diff acceptance test
  satisfied.
- **Pre-existing container rows in production (migration 108 was live before this rollback):** migration
  109's `DROP TABLE ... CASCADE` removes any container/mapping rows that may have been created during the
  brief window v1.1 was live, along with the FK from `partner_sessions.container_id` (also dropped). No
  application code reads these tables after this migration — a clean, one-directional transition.
- **Meeting-bot retroactive purge:** explicitly NOT an edge case resolved here — see Section 10's
  follow-up flag for Arun.

## 10. Out of Scope

- **Admin container-registration UI.** Retired entirely in v2.0 (Section 4.A), not merely deferred.
- **Pattern B (public, domain-scoped widget key; pure script-tag drop-in; zero reseller backend work).**
  Still explicitly out of scope, per the original Feature Brief's phasing — nothing in the amendment
  changes this. Note: v1.1's `allowed_domains`/`widget_public_key_hash` forward-compatibility columns on
  `partner_widget_containers` are moot in v2.0, since that table is dropped entirely (§6.1) — Pattern B's
  future data model (whatever it turns out to be, likely domain-scoped keys tied to
  `partner_accounts`/`partner_content_sources` directly rather than a container) is a decision for that
  future brief, not this one.
- **MCP exposure of the session-creation contract.** Still out of scope, unchanged from v1.1.
- **General, partner-facing self-service content-registration UI.** Moot in v2.0 — there is no
  registration step of any kind for either an internal demo or a real reseller; every reseller integrates
  by calling the API with their own content on every session, from day one, no Clio-side onboarding step
  required beyond issuing an API key (already covered by existing partner-account provisioning).
- **Automatic voice-provider selection changes.** Unchanged from v1.1 — out of scope.
- **Any change to the meeting-bot delivery channel's own behavior, UI, or test coverage.** Unchanged —
  zero lines changed in `lib/meeting-bot/*`, `dispatchMeetingBot`, `app/api/partner/v1/sessions/route.ts`,
  or `PartnerRenderClient.tsx`/its render path.
- **A dedicated "widget analytics" or usage dashboard.** Unchanged from v1.1 — out of scope.
- **Retroactive application of the "no leftovers" content-purge to the meeting-bot inline-content flow.**
  The purge mechanism (Section 6.4) is scoped to `delivery_channel = 'widget'` sessions only for this
  build. Two reasons, both from the amendment: (1) least blast radius — Arun's "no leftovers" instruction
  was made entirely in the context of this widget-channel redesign conversation, never mentioning the
  meeting-bot flow; (2) applying it to `delivery_channel = 'meeting_bot'` sessions would itself be a
  behavior change to that channel's existing data-retention behavior, which conflicts with the
  do-not-touch/never-modify constraint carried forward from Part 1 of the brief, even though
  `inngest/partner-session-insights-extractor.ts` is not itself a literally-forbidden file.
  **Follow-up flagged for Arun (not resolved here, not silently dropped either way):** should the
  "no leftovers" purge rule extend to the existing meeting-bot inline-content sessions too? BA/CEO
  recommendation carried from the amendment: widget-only for now; a meeting-bot-retroactive purge, if
  wanted, should be its own explicitly-scoped future brief (it would need its own review of whether any
  existing partner integration relies on reading back `content_pages` after the fact, which this
  amendment never needed to check for the widget channel since it is brand-new).

## 11. Open Questions

None.

## 12. Dependencies

**Migration:** `supabase/migrations/109_b2b70_widget_inline_content_amendment.sql` must be applied before
any of the rewritten routes are deployed — it is a production rollback of an already-shipped migration
(108), not a fresh additive change; sequence the deploy so the code rewrite and this migration land
together (old container-based route code must not run after the tables are dropped, and vice versa).

**Delete:**
- `app/api/admin/widget-container/route.ts`
- `app/api/admin/widget-container/resync/route.ts`
- `app/(with-clerk)/dashboard/admin/WidgetContainerCard.tsx`

**Edit (removal only, no other change):**
- `app/(with-clerk)/dashboard/admin/page.tsx` — remove the `WidgetContainerCard` import and its
  `<WidgetContainerCard />` render call (restores this page to its pre-B2B-70 composition; the other
  three existing cards are untouched).

**Rewrite:**
- `lib/partner/widget-session-schema.ts` — inline-content shape (§6.2).
- `app/api/partner/v1/widget-sessions/route.ts` — inline content, content-source resolution,
  `assertUrlSafe()` per page, wallet-gate rejection branch also nulls content columns (§6.3).
- `app/api/demo/[slug]/widget-dispatch/route.ts` — assemble `content_pages` itself, mirroring the
  Meeting-tab dispatch route; drop the `demo_widget_container_map` lookup and the `no_widget_container`
  branch (§6.5).
- `app/(demo)/demo/[slug]/DemoTopicClient.tsx` — remove the `no_widget_container` error branch/copy;
  correct the iframe's `allow`/`sandbox` attributes per Section 4.B's flagged finding (§6.6).
- `inngest/partner-session-insights-extractor.ts` — add `delivery_channel` to both the
  `extractInsightsForPartnerSession()` `SELECT` and the `markInsightsExtractionFailed()` FK embed; add
  the widget-scoped content-purge step in both functions' terminal branches (§6.4).
- `tests/unit/b2b70-widget-session-schema.test.ts` — rewrite for the new inline schema.

**New test files needed (not previously required under v1.1):**
- Coverage for the content-purge mechanism (§6.4/§7) — both extraction-success and permanent-failure
  triggers, and the wallet-gate-rejection edge case.
- Coverage for the new content-source resolution step (§6.3 step 5) — not-found and auth-type-rejected
  cases.
- Coverage confirming a meeting-bot session's content is **not** purged by the same extractor code path
  (the negative case proving the scope boundary in Section 10).

**Keep unchanged (verified, do not touch during this rework):**
- `lib/partner/wallet-gate.ts`, `lib/partner/rate-limit.ts` (`widget_sessions_create` class),
  `inngest/partner-trial-cutoff.ts`'s widened backstop query, `app/api/demo/[slug]/widget-status/route.ts`,
  `tests/unit/b2b70-widget-active-backstop.test.ts`, `tests/unit/b2b70-widget-rate-limit.test.ts`.
- Every file on Arun's do-not-touch list: `lib/meeting-bot/*`, `dispatchMeetingBot`
  (`lib/partner/session-init.ts`), `app/api/partner/v1/sessions/route.ts`, `PartnerRenderClient.tsx`.

**Before merging, the developer must confirm:**
- No existing test enumerates `RateLimitClass`/`LIMITS` exhaustively in a way this addition would break
  (carried forward from v1.1, still unresolved as a build-time check, not a spec question).
- The two `inngest/partner-session-insights-extractor.ts` `SELECT`/embed additions (`delivery_channel`)
  do not change behavior for any existing (meeting-bot) session — the new purge step must be verified to
  no-op for `delivery_channel = 'meeting_bot'` rows, not merely assumed to.

**Env vars:** none new. Reuses `DEMO_PARTNER_API_KEY`, `DEMO_PARTNER_ACCOUNT_ID`, `DEMO_CONTENT_BASE_URL`,
`DEMO_CONTENT_SOURCE_ID`, `DEMO_PARTNER_API_BASE_URL`, `NEXT_PUBLIC_APP_URL` — all already present.

**Integration guidance for a real Pattern-A reseller** (to be published on Clio's partner docs page, not
part of this build): the embed snippet must include `allow="microphone; autoplay"` on the iframe tag; the
reseller's own page must implement a `pagehide`/`beforeunload` handler calling
`POST /api/partner/render/end-session` via `navigator.sendBeacon`; and — new in v2.0 — the reseller sends
`content_pages` fresh on every session-creation call (never a stored reference), since Clio does not
retain it past the point its own findings have been sent back.
