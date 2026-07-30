# Feature Brief: B2B-53 — Remove `hume_config_id` and `glitches` from reseller-facing `WebhookPayload`

From: CEO (Arun)
To: Orchestrator / Developer Agent (technical-fix path — see "Why no BA gate" below)
Priority: P1
Date: 2026-07-30

## What Arun Said

From the compiled webhook-payload field review (2026-07-30): "field is not required for the reseller
so this can be removed" (`hume_config_id`) and "think glitches field should not go to reseller at all.
remove this field. this goes only to internal clio, more specifically me
(hello.arunprakash83@gmail.com)." Both are fully confirmed, unambiguous removal instructions — no
product-shape interpretation required.

## The Problem Being Solved

`WebhookPayload` (`lib/partner/webhooks.ts`) — the wire contract for Clio's outbound
`session.completed` / `session.insights_ready` / `usage.*` webhooks — currently carries two fields
that have no reseller-facing purpose:

- `hume_config_id` — an internal Hume voice-config diagnostic identifier, never useful to a partner's
  own billing/reporting.
- `glitches` — session-quality-issue data (misunderstandings, repetition, derailment, etc.) that
  belongs exclusively to Clio's own internal quality tracking (`/dashboard/admin/glitches`), not to
  the reseller.

## What Success Looks Like

Neither field appears anywhere in a dispatched `WebhookPayload`, in the `WebhookPayload` TypeScript
interface, or in any payload the dispatch worker constructs (including the live-reconstructed
`session.insights_ready` body). Internal glitch tracking (`partner_session_insights.glitches` column,
`/api/admin/glitches/*` routes, `/dashboard/admin/glitches` page) is completely untouched — this is a
removal from the outbound wire contract only, not a removal of the underlying data or Clio's own
internal tooling.

## Why This Is a Technical-Fix Path, Not a Full BA Cycle

Both removals are: (a) explicitly and unambiguously instructed by Arun with no room for product-shape
interpretation, (b) purely subtractive (deleting fields, not adding or reshaping anything a reseller
sees), and (c) independently confirmed zero-risk against production (see Verification below). This
matches CLAUDE.md's existing "pure technical fix, no BA gate" carve-out. Compare to B2B-54/B2B-55
below, which do involve genuine product-shape judgment and go through the full BA cycle.

## Codebase Impact — Traced Directly, Not Assumed

**`lib/partner/webhooks.ts`** (the sole file that constructs `WebhookPayload`):
- Remove `glitches?: { type: string; description?: string }[] | null` from the `WebhookPayload`
  interface (currently line 57).
- Remove `hume_config_id?: string | null` from the `WebhookPayload` interface (currently line 73).
- `recordBillableEvent()`: remove the `humeConfigId` lookup/variable (currently lines 143, 155,
  sourced from the `partner_sessions.hume_config_id` select) and the `hume_config_id: humeConfigId,`
  line from the payload literal (currently line 175). This function never included `glitches` in its
  payload literal — no change needed there.
- `recordInsightsReadyEvent()`: remove `humeConfigId: string | null` from its params and the
  `hume_config_id: params.humeConfigId,` line from `referencePayload` (currently line 680). This
  function already omits `glitches`/`action_items`/`learner_insight` from the *stored* reference
  payload by design (reconstructed live at dispatch time) — no change needed there.
- `attemptDispatch()`: the `session.insights_ready` live-reconstruction branch currently does
  `.select('action_items, glitches, learner_insight')` against `partner_session_insights` and injects
  `glitches: (live?.glitches ...) ?? null` into `fullPayload` (currently lines 807-816). Remove
  `glitches` from both the select list and the `fullPayload` object — `action_items` and
  `learner_insight` are unaffected and stay exactly as they are.
- **Caller update**: `inngest/partner-session-insights-extractor.ts` has two call sites that currently
  pass `humeConfigId` into `recordInsightsReadyEvent()` (around lines 317 and 401, both already
  resolving `hume_config_id` off `partner_sessions`/`partner_session_insights` for this purpose).
  Developer must verify whether `humeConfigId` is used in that file for anything *other* than this
  webhook call before deciding whether to also drop the resolution logic there, or just stop passing
  it through — do not assume; check directly. (Separately, `hume_config_id` is written to
  `partner_sessions`/`partner_session_trace_logs`/`glitch_instances` for other, unrelated internal
  purposes in `lib/partner/live-render.ts`, `inngest/partner-session-trace-log.ts`, and
  `inngest/hume-native-nightly-cleanup.ts` — none of that is in scope here and none of it should be
  touched.)

**`tests/unit/partner-webhooks.test.ts`**: contains dedicated AT-14 tests asserting
`hume_config_id`'s presence/value on the dispatched payload (confirmed at ~lines 525-619) and
assertions on `glitches` in the `session.insights_ready` live-reconstruction path. These must be
updated to match the new (smaller) payload shape — either deleted if the assertion is now
meaningless, or inverted to assert the field's absence, developer's judgment on which reads more
useful going forward.

**Confirmed NOT impacted** (checked directly, not assumed):
- `lib/partner/session-schema.ts` — zero references to `glitches`, `hume_config_id`, or `test_mode`.
  This file validates *inbound* `POST /api/partner/v1/sessions` request bodies, not the outbound
  webhook shape — no validation logic depends on these fields.
- `app/(with-clerk)/dashboard/configurator/docs/DocsClient.tsx` (the real reseller-facing developer
  docs) and its backing `WEBHOOK_DOC.payloadFields` constant
  (`app/(with-clerk)/dashboard/configurator/api/content.ts`) — neither `glitches` nor `hume_config_id`
  was ever listed in the documented field list (`WEBHOOK_DOC.payloadFields` currently only lists
  `event_id, event_type, clio_session_ref, partner_reference, quantity, unit, generation_type,
  occurred_at, dispatched_at, test_mode`). Removing these two fields requires **zero** docs changes.
  (Side finding, out of scope for this brief: that field list is already stale relative to the real
  `WebhookPayload` shape — it's missing `reseller_id`/`reseller_unique_id`/`end_client_id`/
  `extraction_status`/`action_items`/`learner_insight`, all added by later briefs. Logging this as a
  separate backlog item below, not fixing it here.)
- `architecture.md` Section 7.3 ("Webhook payload — exact shape") — this is the original B2B-02
  baseline shape and never included either field to begin with (every field added since, including
  `test_mode` itself, is documented inline in `webhooks.ts` as "additive beyond Section 7.3's literal
  shape"). No edit needed here either.
- The internal glitch surfaces — `app/api/admin/glitches/*`, `app/(with-clerk)/dashboard/admin/glitches/*`,
  `partner_session_insights.glitches` column, `lib/glitches/*` — all read from
  `partner_session_insights` directly, never from `WebhookPayload`. Fully unaffected.
- `app/(demo)/demo/[slug]/DemoTopicClient.tsx`'s B2B-51 Performance tab — confirmed by direct read: it
  fetches from `/api/demo/${slug}/performance`, a completely different route, reading only
  `duration_minutes`, `action_items`, and `learner_insight`. It never touches `WebhookPayload`,
  `glitches`, or `hume_config_id`. Zero impact, exactly as B2B-51 itself already established.

## Verification: Confirmed Zero Production Risk

Queried `webhook_dispatch_log` directly against the live Supabase project (`nqxlpcshouboplhnuvrh`):

```
delivery_status | count | distinct partner_accounts
pending         | 53    | 1
```

That single account is `Clio Internal — Public Demo` (`account_kind: partner`, `outbound_base_url:
NULL`). With no `outbound_base_url` configured, `attemptDispatch()` always returns
`skipped_no_endpoint` and leaves the row `pending` indefinitely — meaning **zero webhook payloads
have ever actually been delivered to any endpoint**, real reseller or otherwise. This removal carries
no risk of breaking a live integration because no live integration exists yet.

## Known Constraints

- Do not touch `partner_session_insights.glitches` (the DB column), the internal glitch dashboard, or
  any admin-facing glitch tooling — those stay exactly as they are; this is outbound-payload-only.
- Do not touch `test_mode` — that's B2B-54, a separate judgment call, resolved separately below.

## Open Question (Not Blocking, Not Resolved Here)

Arun's "goes only to internal clio, more specifically me" language leaves one genuinely open
sub-question: does he want an **active email alert** to hello.arunprakash83@gmail.com when a glitch
occurs, or is the existing internal glitch dashboard (which he already has owner access to) enough? No
new alerting infrastructure is being built as part of this brief — building unrequested notification
plumbing would be scope creep on an unconfirmed want. Logged in `docs/b2b-pivot-status.md` for Arun to
answer whenever he wants to pick it up; does not block this removal.

## Separately Logged (Not Part of This Brief)

`WEBHOOK_DOC.payloadFields` (the reseller developer-docs field list) is stale relative to the real
`WebhookPayload` shape — missing several fields added by B2B-09/B2B-34/B2B-38. Logged as a backlog
item; genuinely separate from this removal (removing two never-documented fields doesn't make an
already-incomplete list any more incomplete).

## Questions for BA

None — this is the technical-fix path, no BA spec required.
