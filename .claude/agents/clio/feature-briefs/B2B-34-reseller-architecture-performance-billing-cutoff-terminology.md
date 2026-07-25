# Feature Brief: B2B-34 — Reseller/Client Architecture, Demo Performance Tab, Minutes Reporting, Adaptive Cutoff, Terminology Cleanup

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 for Pieces 2 and 5 (real production data-integrity and naming-collision fixes with live
code already shipping against the wrong shape); P1 for Pieces 1, 3, 4 (net-new capability, no existing
break)
Date: 2026-07-23

---

## How to read this brief

This is **one Feature Brief covering five related pieces**, not five independent ones, because they
share data model and infrastructure — most concretely, Piece 2's `client_id` threading is a hard
prerequisite for Piece 3's per-client breakdown and for closing a real bug inside Piece 2 itself. I
considered splitting these into five separate CEO briefs and decided against it: the BA needs the full
picture to sequence migrations correctly (e.g., don't design Piece 3's reporting query against a
`client_id` column that doesn't exist yet), and Arun discussed all five in one continuous working
session as a single coherent ask. The BA may still choose to write five separate Requirement Documents
(or sub-sectioned ones) if that's cleaner for review — that's a BA documentation-structure call, not a
product-shape one.

**Dependency graph (binding on build order, not just documentation order):**

```
Piece 2 (client_id threading + reseller/client architecture)
   ├─▶ Piece 3 (super-admin minutes usage) — cannot show a correct per-client breakdown
   │                                          without Piece 2's client_id column existing and populated
   └─▶ Piece 2's own webhook fix (partner_reference hardcode) ships in the same pass, not separately

Piece 1 (Performance tab) — independent of 2/3/4/5, but reuses the demo dispatch account
                             from B2B-33 (already shipped) and the extraction pipeline from
                             B2B-09 (already shipped). Can build in parallel with Piece 2.

Piece 4 (adaptive Hume-verified cutoff) — independent of 1/2/3/5. Touches inngest/partner-live-cutoff.ts
                                           and the existing low-balance-alert gate. Can build in parallel.

Piece 5 (terminology cleanup) — independent of 1/2/3/4 in the sense that nothing else in this brief
                                 requires it first, but it touches the same admin/team code Piece 3
                                 sits near, and the CEO strongly recommends sequencing it BEFORE Piece 3
                                 lands new code in that area, not after — see "Sequencing recommendation"
                                 below.
```

**Sequencing recommendation (not a hard gate, but the CEO's strong preference, documented so the BA
doesn't have to re-derive it):** Piece 5 first (small, self-contained, prevents new Piece 3 code from
being written against the ambiguous `sales_partner` token while it's still live), then Piece 2 (unlocks
Piece 3 correctness), then Piece 1 and Piece 4 in parallel (fully independent of everything else), then
Piece 3 last. If the BA or Orchestrator finds a reason to reorder, that's fine — flag it, don't silently
resequence.

---

## Piece 1 — Performance tab on `/demo/[slug]` (Meeting / Learning Check / **Performance**)

### What Arun Said

Arun asked for a new "Performance" tab on the public demo pages (from B2B-33, already shipped —
`app/demo/[slug]/DemoTopicClient.tsx`), showing post-meeting analysis data for the currently-dispatched
meeting. During the discussion this became a full spec:

- **Duration** — sourced from Hume's own ground truth (`start_timestamp`/`end_timestamp` via
  `GET /v0/evi/chats/{chat_id}`), not the client-reported value. Arun and the team confirmed live that
  `fetchHumeChatDuration()` (`lib/voice/hume-native/session-details.ts:147-210`) already does exactly
  this for the legacy `sessions` table path — **I independently verified this function by reading the
  file directly**: it hits `GET {HUME_CHATS_URL}/{humeChatId}` with a 5s timeout, computes
  `(end_timestamp - start_timestamp) / 1000`, and returns a typed `{ok:false, reason}` on every failure
  mode rather than throwing or defaulting to zero — exactly the "prove it, don't assume it" pattern
  Arun has asked for elsewhere in this codebase (see Piece 4). Reuse this function verbatim against
  `partner_sessions.hume_chat_id` (confirmed this column exists — added in migration
  `078_b2b09_session_delivery_glitch_dashboard.sql`, populated by the B2B-09 extraction pipeline
  already shipped). Show just the raw duration (e.g. "8.5 minutes") — no dollar estimate, since this is
  a demo/reseller-facing informational tab, not a billing statement.
- **Action items** — `action_items[]` from `partner_session_insights`, unchanged from what B2B-09
  already extracts and stores.
- **A new `learner_insight` field, replacing `psychology_keywords`** in the Claude extraction
  (`inngest/partner-session-insights-extractor.ts`, `PartnerInsightsExtractionSchema`). **I confirmed
  by reading the live file** that `psychology_keywords: z.array(z.string())` exists today exactly as
  described, producing generic tone-word keywords ("hesitant", "time-pressured") per the current system
  prompt. Arun's explicit requirement: replace this with a crisp, actionable insight that helps a
  reseller decide what to recommend the learner next — not raw keywords. Shape (Arun approved this
  exact shape and the name `learner_insight` without objection when proposed — **treat as settled, not
  reopened by this brief**):
  ```
  learner_insight: {
    summary: string                  // 1-2 sentences: what this person cares about + what to show them next
    topics_of_interest: string[]     // specific subtopics they leaned into, from actual conversation content
    engagement_style: string         // HOW they learn/engage, inferred from question pattern (not generic tone words)
    suggested_next_topics: string[]  // Claude's inferred recommendation for what to show this learner next
  }
  ```
- **Glitches are explicitly EXCLUDED from this tab.** Arun's own words: "not part of this api call, it
  has to be a separate api call that pushes to the sales-partner dashboard and super admin dashboard...
  dont include in this api call." Glitches already have their own channel — B2B-17's glitch tracker and
  the existing `session.insights_ready` webhook for opted-in partners (**confirmed by reading
  `lib/partner/webhooks.ts:518-570`** that this webhook event already exists and, per its own doc
  comment, deliberately omits `action_items`/`glitches`/`psychology_keywords` from the wire payload
  today for data-boundary reasons — see Piece 2 for the one real bug in that same function). Don't
  duplicate a glitch channel here.
- Empty/pending state if no meeting dispatched yet or extraction not finished, matching the Meeting
  tab's existing empty-state pattern (the disabled/dimmed treatment with an inline explanatory note,
  per `docs/specs/B2B-33-requirement-document.md` §4 Screen D's D1 state).

### The Problem Being Solved

The demo surface (B2B-33, shipped) proves the bot can join a real meeting and narrate content live. It
does not yet prove the *other* half of Clio's value proposition to a prospective reseller: that a
session produces real, usable post-meeting intelligence (duration, action items, and — new — an
actionable read on what the learner actually cares about) that a reseller's own dashboard or CRM could
consume. Without this tab, a prospect sees the live-narration demo but never sees what they'd actually
get to act on afterward.

### What Success Looks Like

A visitor to `/demo/{slug}` who has dispatched (or watched Arun dispatch) the bot into a meeting can
click a new **Performance** tab and see, for that meeting: a real Hume-verified duration, real action
items extracted from the real transcript, and a `learner_insight` block that reads like something a
reseller would actually forward to their sales/success team — not a raw keyword dump. Glitches never
appear on this tab under any circumstance.

### Known Constraints

- **Reuse `fetchHumeChatDuration()` verbatim** (already proven for the legacy `sessions` path) — do not
  write a second Hume-duration-fetch implementation. The function signature already accepts a bare
  `humeChatId` string, so it is trivially reusable against `partner_sessions.hume_chat_id`.
- **The `learner_insight` shape is settled** (see above) — do not resurface it as an open question in
  the BA spec's Section 11. If the BA finds a genuine implementation gap in the shape (e.g., a field
  that can't be reliably extracted from a short transcript), that's a real escalation-worthy finding —
  flag it, don't silently redesign the shape.
- **Schema migration required**: `PartnerInsightsExtractionSchema` in
  `inngest/partner-session-insights-extractor.ts` changes from `psychology_keywords: z.array(z.string())`
  to the `learner_insight` object above. This is a breaking change to the Claude extraction contract —
  the BA must specify: (a) whether `partner_session_insights` gets a new `learner_insight` JSONB column
  alongside/replacing the existing `psychology_keywords` column (**I recommend replacing, not
  alongside** — Arun's instruction was "replacing psychology_keywords", and keeping a dead column with
  no writer is exactly the kind of orphan the "no delete without approval" rule is meant to catch before
  it happens, not after — flag this to me if the BA finds a reason a soft-deprecate is safer, e.g. an
  existing reader of the old column elsewhere I haven't found), and (b) whether historical rows with the
  old `psychology_keywords` shape need a migration/backfill or can simply go stale under the existing
  30-day purge job already in that file's doc comment (`purge_partner_session_insights_full_detail`,
  migration 078) — my instinct is the latter (let them purge naturally, no backfill), since this is
  pre-production internal/demo data, not real partner-facing history anyone depends on, but the BA
  should confirm no real partner has consumed `psychology_keywords` via the live webhook first (per the
  webhook doc comment I read, it's never been sent over the wire at all — only intended for internal
  dashboard use — so this should be a clean swap).
- **Never conflate this with glitches.** The BA must design the extraction prompt and schema so
  `learner_insight` cannot accidentally absorb glitch-shaped content (e.g., "engagement_style: confused
  and frustrated" reads uncomfortably close to a glitch signal) — this is a content-quality nuance for
  the prompt-writing, not a schema constraint, but worth naming explicitly since Arun was emphatic about
  the separation.
- **Empty state**: "no meeting dispatched yet" is a real distinct state from "meeting dispatched but
  extraction still pending" from "extraction failed" — the BA should specify exactly three distinct
  copy/visual treatments here (mirroring `partner_session_insights.extraction_status` values
  `pending`/`success`/`success_empty`/`failed`, confirmed live in the extractor file's idempotency
  guard), not collapse them into one generic "nothing yet" state.
- Per the standing responsive/mobile-friendly rule, this is a new screen — ship it fluid/mobile-friendly
  from the start, same bar as B2B-33's Meeting tab.

### Questions for BA

1. Exact placement/copy of the three-state empty treatment (not dispatched / pending / failed) —
   document each with example copy, per the "Ambiguous UX = STOP" rule.
2. Confirm `psychology_keywords` column replacement vs. addition (my recommendation above; BA to verify
   no live reader depends on the old column before removing it).
3. Confirm the `learner_insight` object round-trips cleanly through the existing 30-day
   full-detail-purge RPC (migration 078) — does that RPC's column list need updating for the new field?

---

## Piece 2 — Reseller/client architecture (the real production flow)

### What Arun Said

Arun's own description of the full production flow (verbatim, preserved in full since every clause
carries a real constraint):

> "reseller needs to register the client manually. that way only reseller knows our application
> exists. the client only interacts through reseller. when reseller initiates the session, the
> reseller's client id is required. if reseller itself launching then reseller still need to register a
> client with their own details that way the client id is always there. initially client clicks learn
> with ai, that initiates a api request to the reseller with the topic details, meeting url, client id
> etc. then reseller api reads that and sends us api with meeting link and meeting content. the client
> does not know that we trigger the bot. our bots explains in meeting, meeting ends and then we fetch
> the meeting details through configure id, send it back to reseller with client id and reseller it.
> reseller takes the client id and pushes the api to the client id with the details, that data is
> received by client and they can store in db or do whatever they like to do. so our actual role is we
> get from reseller and we send to reseller. that is our focus."

### The Problem Being Solved

Today, `POST /api/partner/v1/sessions` (**I confirmed by reading `lib/partner/session-schema.ts` in
full**) has no `client_id` field anywhere in `CreateSessionSchema` — the closest existing concept,
`partner_end_user_ref`, is an optional, unvalidated free-text string, not a real foreign key to a
registered entity. This means Clio currently has no structural way to attribute a session to a
reseller's specific end-client, no way to enforce that a reseller can only launch sessions on behalf of
clients they've actually registered, and — as a direct consequence — no reliable way to report
per-client usage back to a reseller or to the super-admin dashboard (Piece 3). The reseller/client
architecture Arun describes is the real production shape of the business; today's schema doesn't
support it at all.

### What Success Looks Like

1. `client_id` is a required field on `POST /api/partner/v1/sessions`, validated server-side as a real
   `partner_accounts` row that is (a) owned by the authenticating reseller
   (`owning_channel_partner_id = auth.partnerAccountId`, confirmed this column exists — migration
   `086_b2b26_sales_partner_entity.sql`) and (b) exists at all. Unregistered or mismatched `client_id`
   values are rejected, not silently accepted or ignored.
2. Every reseller (`account_kind='channel_partner'`) account has a default "self" client
   auto-provisioned the moment the reseller account itself is created, so a brand-new reseller can
   immediately test their own integration without first having a real end-customer to register.
3. `client_id` persists on `partner_sessions` (new column) and threads through to `usage_events` and
   `partner_session_insights`, so every downstream read (Piece 3's reporting, the outbound webhook) has
   it available without a join back through session metadata.
4. The existing `session.insights_ready` webhook (`lib/partner/webhooks.ts`) delivers the real
   `client_id` in its payload instead of the hardcoded `null` it sends today.
5. Billing remains exactly as it is today — reseller-level only, no per-client wallet. `client_id` is a
   pure attribution/correlation tag, never a billing entity.
6. The Developer Portal (B2B-07, already live) documents — but Clio never validates or enforces — the
   two integration points on either side of Clio: what the reseller collects from their own client
   before calling Clio, and what schema the reseller uses to push results onward to their client. Only
   the middle contract (reseller → Clio) is real and enforced.

### Known Constraints

- **Client registration stays manual-only, via the reseller's own dashboard.** I confirmed by reading
  `app/dashboard/channel-partner/clients/` and `lib/partner/clients.ts` that real CRUD already exists —
  `createClientForChannelPartner()` is a live, callable function backing
  `app/api/channel-partner/clients/route.ts`. **Do not build a server-to-server client-registration
  API.** This is deliberate, per Arun: "that way only reseller knows our application exists."
- **Billing is always at the reseller level.** Arun confirmed explicitly: "we dont have access to
  reseller's client's usage allowance... we only track the usage against [the reseller]." No per-client
  wallet, no shared/combined wallet concept. **I confirmed by reading
  `app/dashboard/channel-partner/page.tsx:127`** that a placeholder line already exists reading "Shared
  wallet billing for your clients is coming soon." — **this is explicitly NOT what Piece 2 builds.**
  The BA/Dev should either remove this placeholder line as part of this work (since it now describes a
  feature that will never exist in this form) or, if there's a reason to keep it as a future-facing
  teaser for something genuinely different, flag that to me rather than leaving stale/misleading copy
  live — my default recommendation is **remove it**, since shipping this brief while that sentence is
  still on screen would directly contradict what the reseller dashboard tells its own users.
- **The existing webhook bug must be closed correctly, not repeated.** I confirmed by reading
  `lib/partner/webhooks.ts` lines 518-570 (`recordInsightsReadyEvent`) that `partner_reference: null` is
  hardcoded in **two places** in that function (the `referencePayload` object and the
  `canonicalHashInput()` call used to compute the payload hash for idempotency/signing) — both must be
  fixed together, since fixing only one would produce a payload whose `partner_reference` field doesn't
  match the hash that was computed over it. The BA must specify the parameter name Piece 2's fix adds to
  this function's call sites (I'd expect something like a `clientId` param threaded in from
  `extractInsightsForPartnerSession()`'s existing `partner_sessions` read) — and confirm every other
  caller of `recordInsightsReadyEvent` (I found this is also called from
  `markInsightsExtractionFailed()`'s failure path) gets the same fix, not just the success path.
- **Naming collision the BA must not miss.** I found, by reading `supabase/migrations/079_b2b06_provisioning.sql`,
  that a table `partner_oauth_clients` already exists with its own `client_id TEXT` column — this is
  the OAuth2 Client Credentials identifier (B2B-06), a completely different concept from the reseller's
  end-customer `client_id` this brief introduces. Using the bare name `client_id` for both concepts in
  code (even though they'd live in different tables) is exactly the kind of ambiguous-token collision
  Piece 5 of this same brief is fixing for a different pair of concepts — I don't want this brief to
  create a new instance of the same problem it's adjacent to solving. **CEO Resolution: the BA must
  either (a) confirm the two `client_id` usages are contextually unambiguous enough to coexist safely
  (different tables, different auth layers, unlikely to be read side-by-side in the same code path), or
  (b) pick a more specific name for the new field** (candidates: `end_client_id`, `client_account_id` —
  BA's call on which reads best against the rest of the `partner_*` naming convention, document the
  choice and reasoning either way). Do not leave this as a silent judgment call buried in code — name it
  explicitly in the spec.
- **Documentation home for the two unenforced integration points**: the existing Developer Portal
  (B2B-07, confirmed live at `/dashboard/configurator/developer` and `.../developer/playground`) —
  extend it with example schemas for (a) what the reseller collects from their client before calling
  Clio, and (c) what the reseller sends onward to their client. Do not build a new docs surface.
- Approved libraries, Zod validation, and RLS/ownership-check discipline in `CLAUDE.md` apply as normal.

### Questions for BA

1. Resolve the `client_id` naming-collision question above — explicit decision, documented.
2. Exact migration shape: new `partner_sessions.client_id` column (FK to `partner_accounts.id`?
   nullable during backfill or required from day one for new sessions only?), plus the corresponding
   additive column on `usage_events` and `partner_session_insights`.
3. Exact mechanism and trigger point for auto-creating the default "self" client — at
   `account_kind='channel_partner'` row-insert time (a DB trigger?) or in the application-code
   provisioning path (`lib/partner/signup.ts` / `app/api/partner-signup/claim/route.ts`, which I
   confirmed by grep are the current provisioning entry points)? My instinct is application code, not a
   DB trigger, matching this codebase's existing convention of putting business logic in
   `lib/partner/*` rather than in trigger functions (the one exception I found, `check_account_kind_invariants()`
   in migration 086, is a pure data-integrity invariant, not business logic — auto-provisioning a
   related row is a different category) — but this is a technical call within BA/Dev autonomy, not a
   product one; document the choice.
4. Confirm the `Shared wallet billing for your clients is coming soon.` placeholder disposition (remove
   vs. reflag) — my recommendation above stands unless the BA surfaces a reason to keep it.
5. Confirm every existing caller of `CreateSessionSchema`/`POST /api/partner/v1/sessions` (both static
   API key and OAuth2 credential paths — I confirmed both exist via `partner_api_key_id` /
   `partner_oauth_client_id` on `partner_sessions`) correctly rejects requests missing the new required
   `client_id`, including the demo dispatch account from B2B-33 — **which needs its own default "self"
   client provisioned as part of this brief's rollout**, or B2B-33's live demo dispatch will start
   failing the moment this ships. Flag this explicitly in the spec's rollout/dependencies section, not
   just in code.

---

## Piece 3 — Minutes usage on the super-admin dashboard

### What Arun Said

Show minutes usage per reseller on the super-admin dashboard, and "if reseller itself uses then it
includes them and all their clients as well" — i.e., the reseller's total = sum of all `usage_events`
under that reseller's `partner_account_id`, which naturally includes all client-attributed sessions once
Piece 2's `client_id` threading lands (no separate wallets to combine — it was always one pool). Should
support a per-client breakdown (`GROUP BY client_id`) for drill-down, not just a single total.

### The Problem Being Solved

Arun (as super-admin) currently has no view of how much usage each reseller is actually driving, or
which of a reseller's clients are the heavy users — both important for account-management conversations
with resellers and for understanding where Clio's own real cost exposure sits.

### What Success Looks Like

The super-admin can see, per reseller, total minutes used (self + all clients combined) and drill into a
per-client breakdown for any reseller.

### CEO Resolution: which existing screen this extends

Arun left this as "likely extending `/dashboard/admin/clients` or `/dashboard/admin/sales-partners` —
both already exist" — I'm resolving this now rather than leaving it for the BA to guess, since "which
screen shows what" is a product-shape call that belongs at this layer, not a BA improvisation:

**Extend `/dashboard/admin/sales-partners` (list view) and `/dashboard/admin/sales-partners/[id]`
(detail view) — not `/dashboard/admin/clients`.** Reasoning: `/dashboard/admin/clients` (confirmed live,
built under B2B-04) is a billing/wallet administration surface scoped generically across every
`partner_accounts` row (money — balances, top-ups, rate versions), regardless of reseller/direct-partner
structure. Piece 3 is fundamentally a *usage-by-reseller-hierarchy* report — its natural home is the
page that already understands and displays the reseller entity and its owned clients as a hierarchy
(`/dashboard/admin/sales-partners`, confirmed live, built under B2B-26/28). Concretely:
`/dashboard/admin/sales-partners`'s list gets a new "Minutes (30d)" or similar summary column per
reseller row; `/dashboard/admin/sales-partners/[id]`'s detail page (confirmed exists) gets a new section
showing the reseller's own total plus a per-client breakdown table. If the BA finds a strong reason this
is wrong once in the code (e.g., `/dashboard/admin/sales-partners` turns out to be structurally unsuited
for a usage-query join in a way I haven't seen), escalate that specific finding back to me rather than
silently building it on `/dashboard/admin/clients` instead.

### Known Constraints

- Depends on Piece 2's `client_id` column existing and populated — do not attempt to build the
  per-client breakdown against `partner_end_user_ref` or any other stand-in field.
- No new wallet/balance concept — this is a read-only usage report, sourced from `usage_events` (already
  the ledger of record per F-01's resolution), never from `wallet_ledger`/`balance_usd`.
- Per the standing responsive rule: if this brief's build touches `/dashboard/admin/sales-partners` for
  any reason, that screen's responsive status must be verified/brought up to bar as part of the same
  change (currently untracked in `BACKLOG.md`'s responsive tracking table — the BA/Dev should add a row
  for it there once touched).

### Questions for BA

1. Time-window scoping for the "minutes usage" figure — all-time cumulative, trailing 30 days, current
   billing period, or a selector? Arun didn't specify; my instinct is trailing-30-days as the headline
   number with an all-time total available on the detail page, matching common admin-dashboard
   convention, but this is genuinely undecided — BA should either pick a sensible default and document
   the reasoning (acceptable under BA autonomy for a metric-presentation detail) or flag it back to me
   if there's a reason it needs my sign-off (e.g., if it materially changes what number the query
   actually runs, not just what's labeled where).
2. Exact query shape for the per-client breakdown (`GROUP BY client_id` against `usage_events`, joined
   to `partner_accounts` for client display names) — confirm indexing is sufficient once Piece 2's
   `client_id` column lands (a new index likely needed, since this is a new query pattern).

---

## Piece 4 — Hume-verified adaptive session cutoff

### What Arun Said

The existing per-session cutoff job computes a budget once at session start from wallet balance and then
blindly counts down on its own clock — it never re-verifies elapsed time against Hume's own ground
truth. This is the same class of problem Arun has flagged before as the reason he doesn't trust Hume
webhooks blindly: "this is why i dont rely on the webhooks from hume because there is no way for us to
validate whether we have it or not."

**I independently confirmed this gap is real by reading `inngest/partner-live-cutoff.ts` in full.** The
job (`partnerLiveCutoffJob`) receives a fixed `affordableMinutes` computed once at session-initiation
time in `app/api/partner/v1/sessions/route.ts` (lines ~255-282, `affordableMinutes = Math.floor(balance
/ rate.rate_usd)`), then does exactly two `step.sleep()` calls derived from that one number — a
wrap-up-nudge sleep, then a 60-second runway sleep — with **zero calls to Hume's API anywhere in the
file** to confirm the session has actually been running for the time the job assumes. If Hume's own
clock and Inngest's sleep-duration clock ever drift (server restart, Inngest scheduling jitter, a
session that was paused/resumed at the provider level), this job has no way to notice.

### Confirmed design (Arun's own proposal, refined together with the team)

- **Gate**: only activate periodic Hume-verification for a session if the reseller's account has
  *already* crossed 80% of usage before this session started. Reuse the **existing**
  `low_balance_alert_fired_at` mechanism (`lib/partner/webhooks.ts:400-423`,
  `checkLowBalanceAndAlert()`, confirmed live and firing at ≤20% balance remaining / 80% consumed) as
  the gate — check `partner_wallets.low_balance_alert_fired_at IS NOT NULL` at the moment this job
  starts (i.e., session-initiation time). Below 80% used, skip periodic checks entirely and rely on the
  existing upfront countdown as sufficient — this bounds the added Hume API-call volume to only the
  minority of sessions where it actually matters.
- **Tiered polling once activated**, generalizing to any starting budget (a session starting with only
  12 minutes of budget starts directly in the appropriate tier, not always at the top):
  - \>30 min remaining → check every 30 min
  - 10–30 min remaining → check every 10 min
  - 5–10 min remaining → check every 5 min
  - under 5 min remaining → check every 1 min (tightened from Arun's original flat 5-min floor, so the
    "~1 minute courtesy grace" promise below is accurate rather than allowing up to 5 minutes of
    undetected overage)
- Each check computes real elapsed time as `now - start_timestamp` from Hume's chat metadata (**reusing
  the same `HUME_CHATS_URL`/`GET /v0/evi/chats/{chat_id}` call `fetchHumeChatDuration()` already makes**
  — Piece 1 and Piece 4 both end up calling the same underlying Hume endpoint, for different purposes;
  the BA should confirm whether it's cleaner to add a lighter-weight sibling function that returns just
  `start_timestamp` without requiring `end_timestamp` to be present — `fetchHumeChatDuration()` today
  treats a missing `end_timestamp` as "unavailable," which is correct for its own post-session use case
  but wrong for Piece 4's use case of checking an *in-progress* call, where `end_timestamp` is expected
  to be absent).
- On crossing the budget (plus ~1 minute courtesy grace), push the wrap-up nudge and force-disconnect —
  reuse the existing nudge/force-end pattern already proven in `partner-live-cutoff.ts` (the
  `wrap_up_pending`/`wrap_up_nudge_text` fields, the `deleteBot()` call, the `mark-session-completed`
  step) rather than inventing a new one.
- **Implementation is a modification to the existing `inngest/partner-live-cutoff.ts` job, not a new
  job class.** Arun's own framing: "no new infrastructure class needed, just a smarter sleep schedule" —
  I confirm this reading the file: the existing job already follows the exact `step.sleep()`-chain
  pattern this needs, it just needs the sleep chain restructured to be tiered-and-Hume-checked instead
  of two fixed sleeps, when the 80%-gate condition is met at job start. When the gate is *not* met, the
  job should behave exactly as it does today (byte-for-byte, no regression) — this is an additive
  branch, not a rewrite of the whole file.

### Known Constraints

- **Do not touch `inngest/partner-trial-cutoff.ts` or `inngest/session-timer.ts`** — those are separate,
  already-correct jobs for different scopes (test-mode trial minutes, legacy `sessions` table) and are
  out of scope for this piece.
- **Fail-safe direction matters**: if a Hume API check fails (network error, timeout — both real,
  handled outcomes in `fetchHumeChatDuration()`'s existing error taxonomy), the job must not silently
  extend the session indefinitely — it should fall back to the existing blind-countdown behavior for
  that check cycle (log the failure, proceed on the assumption the Inngest clock is correct for this one
  cycle) rather than either force-ending prematurely on a transient network blip or looping forever
  waiting for a successful check. The BA should specify this fallback explicitly, not leave it to Dev
  improvisation, since it's a real product-risk tradeoff (cost-overrun risk vs. false-positive
  disconnect risk) — my default lean is "assume Inngest's clock for this cycle, retry Hume verification
  next cycle," since a single missed verification cycle at the tightest (1-minute) tier is a small,
  bounded risk, and the existing job's own final safety net (mark-session-completed) still fires
  eventually regardless of whether Hume verification ever succeeds mid-session.

### Questions for BA

1. Confirm the fail-safe direction above, or propose and justify an alternative.
2. Confirm whether a new lighter-weight "fetch just `start_timestamp`" Hume-fetch function is needed
   alongside `fetchHumeChatDuration()`, or whether reusing that function as-is (treating its "unavailable"
   result for a still-in-progress call as simply "skip this check cycle") is sufficient — my instinct is
   the latter is actually fine and avoids a near-duplicate function, since a "skip this cycle" outcome is
   exactly the safe fallback behavior from Question 1 anyway — but confirm against the real response
   shape.
3. Confirm the exact `step.sleep()` restructuring approach — a single job with a loop of variable-length
   sleeps (my expectation, matching the "loop of variable-length `step.sleep` calls" framing already
   agreed with Arun), vs. some other Inngest-idiomatic pattern, if the existing codebase has a stronger
   precedent I haven't found.

---

## Piece 5 — Terminology cleanup: reserve `sales_partner` for the reseller entity only

### What Arun Said / What I confirmed independently

A real, confirmed naming collision exists in the database and code, not just in docs. **I verified every
part of this by reading the actual files, not just trusting the description:**

- `internal_admin_users.role` (migration `084_b2b21_internal_admin_identity.sql`, confirmed) has a
  `CHECK (role IN ('super_admin', 'sales_partner'))` constraint. This `'sales_partner'` role value is
  for **Clio's own internal staff** — currently zero rows, per the migration's seed comment — and the UI
  (`app/dashboard/admin/team/TeamClient.tsx`, confirmed at lines 381-384) labels the panel showing these
  users **"Internal sales staff"**, using a component state variable literally named `salesPartners`.
- This is a **completely different concept** from the external reseller entity:
  `partner_accounts.account_kind='channel_partner'` (migration `086_b2b26_sales_partner_entity.sql`,
  confirmed), which the product's own user-facing copy now calls **"sales-partner"** — confirmed by
  reading the migration's own column comment: `'B2B-26: ... Code-level token only — user-visible copy
  always says "sales-partner", never "channel_partner".'`
- The collision is not confined to that one CHECK constraint — I traced it further than the original
  framing and found it also touches:
  - The join table `sales_partner_assignments` (migration 084) itself, whose very name uses the
    ambiguous term, and which links `internal_admin_users` (Concept A — internal staff) to
    `partner_accounts` (Concept B — the reseller entity being managed) — meaning the table's own name
    reads as if it assigns resellers to something, when it actually assigns *internal staff* to
    *resellers they're allowed to manage*.
  - **Three live API routes** built directly against this ambiguous naming:
    `app/api/admin/team/sales-partners/route.ts`,
    `app/api/admin/team/sales-partners/[id]/route.ts`, and
    `app/api/admin/team/sales-partners/[id]/resend-invite/route.ts` — all confirmed live via grep. Their
    URL path (`/admin/team/sales-partners`) sits under `/admin/team/`, strongly suggesting these are
    about *internal staff* (Concept A) despite the path segment literally saying "sales-partners" —
    exactly the confusion Arun is asking to eliminate.
  - `lib/internal-admin/auth.ts` (confirmed via grep) also references `sales_partner_assignments`.
  - A dedicated test file already exists naming this exact confusion:
    `tests/unit/b2b28-security-orthogonality-and-naming.test.ts` — the BA should read this file first,
    since its existence suggests a prior brief already partially grappled with this naming question and
    may contain useful context or a prior decision worth not contradicting.
  - `app/invite/accept/InviteAcceptClient.tsx` — **I confirmed line 142 verbatim**: `You've been invited
    to Clio as {view.role === 'super_admin' ? 'a super-admin' : 'a sales partner'}.` This is the
    invite-acceptance copy for `internal_admin_users.role='sales_partner'` (Concept A, internal staff)
    — meaning a brand-new Clio internal staff member, accepting their own invite, currently sees text
    telling them they're being invited "as a sales partner," which is doubly wrong now that "sales
    partner" is the product's own established term for the external reseller entity.

Arun's confirmed target taxonomy (this session): **3 account types** — `superadmin` (Clio itself),
`sales-partner` (the reseller, currently `channel_partner` in DB), `partner` (regular customer).
`internal-staff` is **not a 4th peer type** — it's a role that attaches to any of the three (each of
superadmin/sales-partner/partner can have their own internal staff/team members with scoped access).

### CEO Resolution: the new token

Arun offered `'staff'` or `'internal_staff'` as candidate replacement values without picking one — I'm
resolving this now rather than leaving it open, since an unresolved literal string is exactly the kind
of ambiguity that produces inconsistent code if left to individual developer judgment across a dozen
touched files:

**Use `internal_staff`, not the bare `staff`.** Reasoning: Arun's own confirmed taxonomy explicitly
frames this as "internal-staff... a role that attaches to any of the three [account types]" — the word
"internal" is load-bearing in his own framing, distinguishing this from any future notion of
partner-side or reseller-side staff roles that might need their own distinct handling later. A bare
`'staff'` token would be one bad future feature request away from becoming ambiguous all over again
(e.g., "reseller's own staff members" vs. "Clio's internal staff" — a real, foreseeable future
distinction given resellers already have their own `partner_admin_users`/team concept). `internal_staff`
costs nothing extra today and closes off that entire future collision.

**Corresponding rename recommendations (BA to confirm/finalize each, not re-litigate the direction):**
- `internal_admin_users.role` CHECK constraint: `'sales_partner'` → `'internal_staff'`.
- `sales_partner_assignments` table → `internal_staff_assignments` (reflects what it actually does:
  assigns internal staff to the reseller accounts they're scoped to manage).
- `app/api/admin/team/sales-partners/*` routes → `app/api/admin/team/internal-staff/*` (matches the
  `/admin/team/` parent path's actual subject).
- `TeamClient.tsx`'s `salesPartners` state variable and any related prop/type names → `internalStaff` (or
  equivalent) — the "Internal sales staff" UI panel header copy can stay closer to as-is or be simplified
  to "Internal staff" (BA's call on exact copy, minor).
- `InviteAcceptClient.tsx:142` — the ternary's `'a sales partner'` branch (for `role === 'internal_staff'`
  after the rename) → something like `'internal staff'` or `'a Clio staff member'` (BA's call on exact
  copy, but it must no longer say "a sales partner" for this role).

### Known Constraints

- **This is a real migration, not a doc-only fix.** New migration file renaming the CHECK constraint
  value (with a data migration for any existing rows — currently zero per the seed comment, so this
  should be a clean `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT` with no `UPDATE` needed, but the
  BA must confirm zero live rows before relying on that), renaming the table (Postgres `ALTER TABLE ...
  RENAME TO`, which preserves data/indexes/FKs automatically), and every code reference must be updated
  in the same change — a partial rename (schema renamed, code still referencing the old table/string
  name) would break the feature outright, not just leave stale naming.
- **Full audit required before code is written** — the BA must grep for every remaining reference to the
  bare string `'sales_partner'` (as opposed to `'channel_partner'` or the product-copy word
  "sales-partner") across the codebase, not rely solely on the file list I found above — I searched
  targeted locations based on the CEO brief's own leads, not an exhaustive sweep, and the BA's spec
  should document that an exhaustive `grep -rn "sales_partner"` (careful to distinguish from
  `sales_partner_assignments` after its own rename, and from `channel_partner`) was run and its results
  reconciled.
- **Do not touch `channel_partner` anywhere** — that token is correct as-is (it's Concept B's DB-level
  name, deliberately kept distinct from its user-facing "sales-partner" copy per migration 086's own
  documented reasoning) and is out of scope for this piece.
- Coordinate timing with Piece 3: if Piece 3's build touches `/dashboard/admin/sales-partners` (the
  Concept B / reseller-entity page, which keeps its name and URL unchanged — only Concept A's routes are
  renamed) while Piece 5 is still mid-rename elsewhere, there's no actual file overlap (Piece 3 touches
  `app/dashboard/admin/sales-partners/*`, Piece 5 touches `app/api/admin/team/sales-partners/*` — a
  different path despite the shared word) — flagged only so the BA doesn't assume a conflict that isn't
  really there, not because one exists.

### Questions for BA

1. Confirm zero live rows with `role='sales_partner'` in `internal_admin_users` before treating the
   constraint rename as data-migration-free.
2. Run and document the exhaustive `sales_partner` grep sweep described above; report anything found
   beyond the file list I've already identified in this brief.
3. Read `tests/unit/b2b28-security-orthogonality-and-naming.test.ts` first and reconcile whatever prior
   decision or context it contains with this brief's resolution — if it conflicts, escalate to me rather
   than silently picking one.
4. Confirm final copy for the `InviteAcceptClient.tsx` ternary branch and the `TeamClient.tsx` panel
   header — both are small enough to be BA-documented rather than escalated, per the "Ambiguous UX =
   STOP" 3-line rule (these are one-line copy changes with an obvious correct direction, not
   under-specified screens).

---

## Cross-cutting notes for the BA

- **Section 11 (Open Questions) must be empty across whatever document structure the BA chooses** before
  any of these five pieces reaches a developer agent, per the standing governance gate. Every question
  I've listed above under each piece's "Questions for BA" is delegated to the BA to resolve and document
  — none of them should survive into the Requirement Document's own Section 11 unresolved.
- **Migrations**: at minimum, expect one migration for Piece 2 (`client_id` columns +
  auto-provisioning), one for Piece 1 (`learner_insight` schema change on `partner_session_insights`),
  and one for Piece 5 (constraint/table rename). Piece 3 is likely migration-free (read-only reporting
  against Piece 2's new column) unless a new index is warranted. Piece 4 is code-only, no migration
  expected. The BA should confirm final migration numbering/sequencing against whatever's latest in
  `supabase/migrations/` at spec-writing time (I confirmed `093` is the next available as of this
  writing, but that may have moved by the time the BA starts).
- **Testing discipline**: per this repo's existing pattern (confirmed via the B2B-08/B2B-09/B2B-19 rows
  in `docs/b2b-pivot-status.md`), each piece should get unit/integration test coverage before being
  marked done, and — per this session's CEO-level standing instruction — **no piece in this brief may be
  marked "shipped" or "done" on code-review/`tsc`-clean grounds alone**; Pieces 1 and 2 in particular
  touch public-facing behavior (the demo Performance tab, the reseller session-creation contract) and
  must clear the full QA Gate (code review + automated tests + live browser UI functional testing per
  `testing-agent.md`) before merge, exactly as this CEO's standing QA Gate policy requires.

---

## Priority summary

| Piece | Priority | Reasoning |
|---|---|---|
| 2 (client_id + reseller/client architecture) | **P0** | Real production bug (webhook `partner_reference` hardcode) ships as part of the same fix; also the hard prerequisite for Piece 3. |
| 5 (terminology cleanup) | **P0** | Real, live naming collision across DB constraint + 3 API routes + UI copy today; risk compounds the longer it's left (more code gets written against the ambiguous token). |
| 1 (Performance tab) | P1 | Net-new capability, no existing break; extends the just-shipped B2B-33 demo. |
| 3 (super-admin minutes usage) | P1 | Net-new capability; blocked on Piece 2 landing first regardless of nominal priority. |
| 4 (adaptive Hume-verified cutoff) | P1 | Closes a real trust/accuracy gap Arun has flagged before, but the existing blind-countdown mechanism is functioning (not silently broken) — no active incident forcing P0. |

---

## Next step

Dispatch the BA Agent for a full 12-section Requirement Document (or a coherently-organized family of
documents, BA's structural call) covering all five pieces, informed by everything above. Per the
standing gate, nothing here should be treated as pre-approved for build — this is the CEO Feature Brief
only. I will review the resulting Requirement Document(s) against this brief before any code is
written, checking in particular that: Section 11 is empty everywhere, the `client_id` naming-collision
question from Piece 2 is explicitly resolved, the `learner_insight` shape from Piece 1 is carried
through unchanged, and Piece 5's rename list is complete against an exhaustive grep, not just the leads
I've already found.
