> **RECONSTRUCTED 2026-07-15** — original lost to a concurrent-agent `git stash` collision during the
> parallel B2B-06/07/08/09 build spree. Rebuilt from `architecture.md` §16 (all subsections, the exact
> extraction prompt/schema, function signatures, purge job cron, and inline rationale comments —
> including the v1.1 correction note), `docs/b2b-pivot-status.md`'s Live Status row and Changelog
> entries for B2B-09, `docs/reference-vendor-api-integrations.md` §7's confirmed root-cause finding
> (both since lost themselves and not recoverable verbatim — reconstructed from the Changelog's own
> restatement of their content, which is detailed enough to work from), `docs/brainstorm-partner-signup-
> integration.md`'s recorded Decisions 5–6, and the shipped code's own comments
> (`inngest/partner-session-insights-extractor.ts`, `app/dashboard/admin/glitches/GlitchDashboardClient.tsx`,
> `app/api/webhooks/hume/route.ts`). Content matches the historical record to the best available
> evidence. This is not fresh authorship — no decision below is re-made; every decision, option, and
> approval recorded here already happened and already shipped (commit `2d3b3d0`).

# Feature Brief: B2B-09 — Session Delivery Extraction Fix + Internal Glitch Dashboard
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-15

## Series context
Written the same day as, and in parallel with, B2B-06 (Partner Provisioning), B2B-07 (Developer
Portal), and B2B-08 (Testing/Metering) — the four-brief build spree that completed the partner
platform's first real release surface. Unblocked by B2B-02 (Partner API & multi-tenant architecture,
done): `partner_sessions`, `partner_accounts`, and `webhook_dispatch_log` already exist and are
already live for every other billable/notification event type.

**ID collision, resolved.** This brief was first written as `B2B-08` on a fresh read of this file and
the feature-briefs directory that showed no `B2B-08` anywhere; the sibling testing/metering brief
(dispatched in parallel, by design) independently claimed the same ID roughly 3 seconds earlier, on
the same fresh read. Per this brief's own stated tie-break rule — whichever brief was written second
renumbers — this brief renamed itself to `B2B-09`. `B2B-08` stays the testing/metering brief, full
stop.

Grounded in `docs/reference-vendor-api-integrations.md` §6–§8's exact `file:line`-cited technical gap
analysis, plus additional direct verification this brief performed itself beyond what that reference
doc covered:
- **Confirmed root cause**: Hume's `chat_ended` webhook (`app/api/webhooks/hume/route.ts`) has only
  ever resolved a chat against the legacy `sessions` table. The partner session flow writes only to
  `partner_sessions`, which had no link back to `sessions` at all. Extraction had never once run, for
  any partner-dispatched session, since the partner flow first shipped.
- **Confirmed, not assumed, that `hume_native_config_archives.session_id` is also hard-FK'd to
  `sessions(id)`** — a structural finding the reference doc itself didn't cover. This rules out any
  archive-first transcript path for partner sessions; every partner extraction will always have to
  live-fetch from Hume directly, never from a pre-archived config.
- **Confirmed the fix is cheap, not a redesign**: the chat_id needed to resolve this is already being
  received and silently discarded client-side. `PartnerRenderClient.tsx`'s `onConnect` handler ignores
  the argument that `lib/voice/hume-adapter.ts:154` already passes it. `WalkthroughClient.tsx` already
  captures the identical signal for Clio's own direct sessions via a proven, existing route pattern —
  this brief reuses that pattern rather than inventing a new one.

## What Arun Said
From `docs/brainstorm-partner-signup-integration.md`, Decisions 5–6 — Arun's direct correction of an
earlier framing that had assumed action items and glitches, like psychology, would be keyword-only:

> "Action items and glitches need not be keywords, only the psychology be keywords. You also need a
> way to read the glitches and reflected in a dashboard so we can automatically identify the root
> cause and fix it."

Two requirements follow directly from this, and neither is negotiable in how the BA scopes the spec:
1. Action items and glitches are delivered at full detail (text/description), not reduced to
   keywords. Psychology is the one exception — keywords only, never full sentences, never a verbatim
   quote from the user.
2. A dashboard must exist for Clio's own internal use, so that glitch patterns can be read across
   sessions and partners to identify and fix root causes — not just delivered one-off to partners via
   webhook and otherwise unseen.

## The Problem Being Solved
Two distinct problems, both real and both blocking:

1. **The extraction pipeline partners are told exists does not exist for them.** Every partner
   session ends, Hume fires `chat_ended`, and the webhook handler looks the chat up in `sessions` —
   finds nothing, because partner sessions never wrote there — and silently drops it. No transcript
   extraction, no action items, no glitches, no psychology signal has ever been produced for a single
   partner-dispatched session. This has been true since the partner flow first shipped and nobody
   caught it, because nothing was failing loudly — it was failing silently, by omission.
2. **Clio has no way to see its own quality problems at scale.** Even once extraction is fixed and
   glitches are being captured per session, there is no internal view that aggregates them —
   no way to notice that a particular glitch type is spiking for a particular partner, or spiking
   platform-wide, without reading individual session transcripts one at a time. Arun asked for this
   directly: a dashboard to read glitches in aggregate and identify root causes, not a promise that
   the data merely exists somewhere.

## What Success Looks Like
A BA spec exists that, once built, means:

1. **Every partner session's Hume `chat_id` is captured and linked.** `PartnerRenderClient.tsx`'s
   `onConnect` handler stops discarding the chat_id it already receives and instead persists it
   against the `partner_sessions` row, via a new best-effort capture route mirroring the existing
   `/api/hume-native/session-chat-id` pattern exactly.
2. **`chat_ended` resolves partner sessions, not just legacy ones.** When the existing `sessions`
   lookup comes back empty, the webhook handler falls back to a `partner_sessions` lookup by
   `hume_chat_id` before giving up. A miss on both is still a no-op, not an error — this must never
   regress the existing legacy-session path.
3. **A new, partner-specific extraction pipeline exists — not a bolt-on to the existing one.** The
   existing `session_action_items` table and `extractActionItemsForSession()`/`getHumeSessionDetails()`
   functions are hard-FK'd to `sessions(id)` and carry Config-archive assumptions that don't hold for
   `partner_sessions`. Rather than forcing a source-table branch into code that two other features
   already depend on working exactly as it does today, this brief specifies a new, smaller partner-
   specific orchestration function against a new table. The two genuinely shared, table-agnostic
   primitives (`formatTranscriptLines()`, `callClaudeForExtraction()`) are reused as-is; the
   currently-private `fetchAllTranscriptEvents()` helper is exported rather than having Hume's Chat
   History pagination duplicated a third time.
4. **One Anthropic call produces all three outputs per session**, per Arun's exact spec above: action
   items (full detail), glitches (full detail), psychology (keywords only). Delivered to partners via
   a new `session.insights_ready` webhook event, following the same signed-delivery, retry-with-
   backoff mechanism every other event type already uses.
5. **A fast path plus a backstop sweep**, mirroring the existing action-item extractor's own
   reliability shape exactly — this pipeline does not get a lower reliability bar than the one it's
   modeled on just because it's new.
6. **An internal-only glitch dashboard exists at `/dashboard/admin/glitches`**, following the
   `/dashboard/admin/clients` precedent (Clerk-gated, any signed-in user — the same boundary that
   precedent already established, not partner-facing, not a new auth pattern). Scoped as v1: a simple
   sortable/filterable table of individual glitches plus one aggregate summary view (by type, by
   partner, over time) so a pattern is visible without reading transcripts one at a time. This
   directly answers what Arun asked for — visibility into root causes — without overbuilding.

## Known Constraints
- **Psychology stays keyword-only. Action items and glitches do not.** This is Arun's explicit
  correction, not a BA judgment call — do not re-collapse action items or glitches into keywords for
  consistency with psychology's shape.
- **`CORE_OBJECTIVES.md`'s Non-Negotiable Data Boundary holds**: "Clio computes signal. Clio never
  becomes the system of record for partner or end-user data." Full-detail action items and glitches
  are session content, which is exactly the category this boundary is written to restrict — see the
  escalation below for how this brief resolves the resulting tension rather than ignoring it.
- **No sub-tenant billing or visibility complexity** — this brief doesn't touch billing at all; it
  rides the same `webhook_dispatch_log` delivery mechanism B2B-02 already built without altering its
  guarantees for any other event type.
- **Do not generalize the existing `sessions`-table extractor to serve two tables.** The existing
  `extractActionItemsForSession()`, `getHumeSessionDetails()`, and `session_action_items` table keep
  serving Clio's own direct sessions exactly as they do today, unmodified in shape or behavior.

## The Escalation
**Genuine data-governance escalation, not a delay tactic — one open question blocked BA dispatch.**

Reliable webhook delivery for `session.insights_ready` needs to work the same way every other event
type already does: retry-with-backoff against a durably stored payload until delivery succeeds. But
the payload here is full-detail action items and glitches — session content, not an opaque usage
number — and `CORE_OBJECTIVES.md`'s Non-Negotiable Data Boundary (approved two days earlier as part of
B2B-01) plus B2B-02's own `webhook_dispatch_log` design comment ("NEVER logged to this or any table")
both restrict exactly this for session content. Building reliable retry delivery for this event type,
as specified, meant revising the practical meaning of a data-governance statement Arun had personally
approved that same week — for enterprise partners where that promise gets tested by a real security
review. Not a call the CEO makes unilaterally.

Three options were laid out:

- **Option A — Bounded retention (recommended).** A new table (`partner_session_insights`) holds the
  full-detail action items, glitches, and psychology keywords for a fixed window after extraction —
  30 days — after which a daily purge job permanently reduces glitches to type-only and nulls out
  action items and psychology keywords entirely. Webhook retries and the internal dashboard both read
  from this table during the window; after purge, the dashboard still has aggregate/type-level signal
  for pattern detection, but the full-detail text is gone. This satisfies reliable delivery without
  making Clio an indefinite system of record for session content.
- **Option B — Fully ephemeral, no retry.** Never persist full-detail content at all; attempt delivery
  once, live, and drop it if the partner endpoint doesn't accept it. Cleanest against the Data
  Boundary, but breaks the reliability guarantee every other webhook event type already has, and any
  partner endpoint downtime at the moment of delivery means permanent, silent data loss with no
  recovery path.
- **Option C — Persist indefinitely.** Simplest to build, most reliable for delivery — and a direct,
  unambiguous violation of the Data Boundary's "never becomes the system of record" principle for
  exactly the kind of content it was written to restrict.

**Arun's answer: Option A.** Bounded retention, 30-day purge window on full-detail fields, glitch
type/partner/date retained longer at reduced granularity for the dashboard's aggregate view. Everything
else in this brief — the extraction mechanism, the webhook payload shape, the dashboard design — was
already fully specified and did not change shape under any of the three options; only the retention
mechanism for the BA's spec turned on this answer.

## What's Explicitly Not In Scope
- **The Attendee webhook signature bypass.** Found separately, tracked as its own backlog item — not
  pulled into this brief even though it touches the same `app/api/webhooks/*` surface area.
- **The payment-guardrail gap** (dispatching a real, billable bot before a funding check). Already
  scoped into B2B-06, not duplicated here.
- **AI-assisted glitch clustering.** The dashboard is a v1 sortable/filterable table plus an aggregate
  summary — deliberately not automated pattern clustering, since no precedent exists yet for this kind
  of internal analytics screen to build clustering against. A justified v2, not a v1 requirement.
- **A partner-session equivalent of the nightly Hume Config archive job.** Partner extraction always
  live-fetches from Hume directly (see the archive-FK finding above) — there is no partner-session
  archive to build a nightly job around.
- **Any change to the existing `sessions`-table extractor, `session_action_items`, or
  `hume_native_config_archives`.** These continue serving Clio's own direct sessions exactly as they
  do today.

## Approval note
The completed Requirement Document was reviewed against this brief before build, per the standing
CEO → BA → Dev gate. That review caught a real, build-blocking bug before any code shipped: the spec's
outbound reference payload for `session.insights_ready` hardcoded `test_mode: false` regardless of the
session's actual mode, and its caller never fetched or threaded the real value through either of its
two call sites (the extraction-success path and the extraction-failure path). This is the same bug
class B2B-08 independently found and fixed at a different call site the same day (`handleSessionEnd()`'s
`recordBillableEvent()` calls, architecture.md §15.6) — a partner integration filtering or routing on
`test_mode` would have silently misclassified every test-mode session's insights event as live. Flagged
back for correction rather than approved as-is.

The spec was corrected (v1.1): `test_mode` now flows from `partner_sessions` through both call sites of
`recordInsightsReadyEvent()` into the actual outbound payload. With that fix verified, the spec was
approved for build. `tsc --noEmit` clean, test suite passing, migration `078` applied. Shipped alongside
B2B-06/07/08 in commit `2d3b3d0` (2026-07-15) — governance working as intended, catching a real defect
before it reached a partner integration, not overhead for its own sake.
