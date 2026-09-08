# Feature Brief: B2B-57a — Demo Performance Tab: Real `usage.voice_minute` Field/Value Table

From: CEO (Arun)
To: Developer Agent (no BA gate — see Governance Call)
Priority: P2
Date: 2026-07-30

---

## What Arun Said

"you can place real values. if the session is a demo topic then populate these fields in the
performance tab, if the session is a real session passed by the reseller then it has to be sent to
reseller api and lives in reseller dashboard." This brief covers the first half only — the demo-topic
case. The reseller-dashboard half is B2B-57b (separate brief, needs a BA spec).

---

## The Problem Being Solved

`lib/partner/webhooks.ts`'s `WebhookPayload` interface already carries real `usage.voice_minute` event
fields (`event_id`, `clio_session_ref`, `partner_reference`, `quantity`, `unit`, `generation_type`,
`live_mode`/`test_mode`, timestamps, etc. — confirmed present in the file). `webhook_dispatch_log` has
real rows today for the "Clio Internal — Public Demo" account (the only account currently generating
`usage.voice_minute` events), even though no account has `outbound_base_url` populated yet so nothing
has actually gone out over the wire. That real data exists but is invisible anywhere in the product —
including on the one screen built specifically to show a demo session's own data back to whoever is
looking at it, the Performance tab.

---

## What Success Looks Like

The Performance tab at `app/(demo)/demo/[slug]/DemoTopicClient.tsx` gets one additional set of rows
showing that demo session's own `usage.voice_minute` webhook_dispatch_log entry, using the exact same
Field/Value row idiom already shipped there (`PerfScalarCell`, `PerfListCell`, `PerfTableRow` —
confirmed live today, rendering Duration / Action items / Summary / Topics of interest as of B2B-51/
B2B-34). This is additive rows on an existing, already-approved table — not a new section, tab, or
visual treatment.

**Exact fields to add** (CEO-specified, so the dev agent implements literally rather than choosing):

| Field label | Source (`WebhookPayload`) |
|---|---|
| Minutes billed | `quantity` + `unit` (e.g. "4.2 minutes") |
| Generation type | `generation_type` |
| Mode | derived from `live_mode`/`test_mode` — display "Live" or "Test" |
| Event ID | `event_id` |
| Recorded at | the event's timestamp field (`occurred_at` or equivalent — use whatever the row actually stores) |

Use `PerfScalarCell` for each (all are single values, not lists). Label the new block "Usage" or
"Billing" (dev's call on the exact sub-heading, consistent with how the tab already groups Duration
separately from the learner-insight fields) — this cosmetic label choice does not need to come back for
approval.

---

## Known Constraints

- Query the specific `webhook_dispatch_log` row(s) for this demo session's `usage.voice_minute` event —
  keyed by `clio_session_ref` matching the demo session, same join pattern the extractor/webhook code
  already uses elsewhere in `lib/partner/webhooks.ts`.
- If no `usage.voice_minute` row exists yet for this session (e.g. session still in progress, or the
  event hasn't dispatched), fall back to the tab's existing empty/pending-state treatment
  (`perfEmptyHeadingStyle` pattern already in the file) — do not show blank or fabricated values.
- Demo-only. Do not touch real (non-demo) reseller session rendering — that's B2B-57b's screen, and it's
  a different surface entirely (partner's own dashboard, not the demo page).
- No new API route needed if `app/api/demo/[slug]/performance/route.ts` can be extended to also select
  the `webhook_dispatch_log` row; if that's awkward, a small additive field on the existing
  `PerformanceResponse` contract is fine — do not invent a second fetch/endpoint pattern for one field
  group.

---

## Governance Call

**No BA Requirement Document needed — approved for immediate build.** This is a literal extension of
an already-approved, already-shipped UI pattern (the Field/Value table from B2B-51) with a new,
CEO-specified field list and a real, already-existing data source. No new screen, no new IA, no
open-ended content decision left to the developer.

## Questions for BA

None — no BA involvement required.
