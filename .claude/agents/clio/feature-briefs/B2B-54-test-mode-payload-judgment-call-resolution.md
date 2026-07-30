# Feature Brief: B2B-54 — `test_mode` on `WebhookPayload`: CEO Resolution (Decision Record, No Build)

From: CEO (Arun)
To: Orchestrator — filed for the record, not routed to BA or Dev
Priority: P2 (decision record only)
Date: 2026-07-30

## What Arun Said

Across the compiled discussion: "i am not worried about test_mode field name but the values have to
be either live or demo right? ... i feel test_mode seems kind of non-prod so i need to sound something
more final or prod like" — then, on learning it's genuinely just a Stripe-style test/live-key
indicator: "i think that info is not needed to the reseller for every session in this transaction. for
a reseller he is interested to know, out of my free 20 minutes how many i consumed, if i paid for
minutes then how much i consumed now from that pool etc." This was explicitly delegated to the CEO
role as a judgment call, to be resolved with documented reasoning rather than bounced back to Arun.

## Resolution: KEEP `test_mode` on `WebhookPayload`. Do not remove it.

This is a deliberate disagreement with a literal reading of Arun's stated conclusion, reasoned through
below and flagged clearly so it's trivial to override.

## Reasoning

Arun's conclusion addresses one question — "is a live-vs-test-key indicator something a reseller wants
to *see and think about* on every session?" — and correctly answers no, that's not useful surfaced
information. But `test_mode` on `WebhookPayload` doesn't exist to answer that question. Direct code
read of `lib/partner/webhooks.ts` shows what it actually does:

1. `recordBillableEvent()` inserts a `webhook_dispatch_log` row **unconditionally**, regardless of
   `testMode` — test-mode events are not held back or filtered before dispatch. Only the *billing*
   step (`applyWalletDecrement()`) is skipped for `testMode: true` (`if (params.testMode) return`).
2. This means test-mode-originated events (from Clio's own internal test-block feature, trial-cutoff
   verification, admin test sessions, etc. — all real, ongoing mechanisms per B2B-08/migration 077) DO
   flow through the same outbound webhook pipeline to a partner's real configured endpoint, once one
   exists, exactly the same as a genuine paid session.
3. The field's own existing doc comment in the code is explicit about why it's there: "required to
   satisfy the Section 9 edge case ('test-mode usage webhook is marked such that a partner's own
   billing logic can filter it out')." That is a real, load-bearing mechanical function — a filter key
   — not a display value.
4. If `test_mode` were removed from the wire payload entirely, a reseller who ever receives a
   test-mode-originated event (plausible any time Clio's own team runs test/demo sessions against a
   real `partner_account_id`) has **no way to exclude it from their own downstream billing or usage
   reconciliation**. That is a genuine functional regression, not a cosmetic one — and one a reseller
   would have no way to work around after the fact, since the information would simply be gone from
   the wire.

Arun's own words weren't wrong about what he was evaluating — a raw "live/demo key" boolean genuinely
isn't interesting for a reseller to look at. But that's not the field's job. Its job is quieter and
still necessary: letting the receiving side tell a real event from a Clio-internal test one. Removing
it doesn't make the payload better-designed for what Arun actually wants (balance/consumption
visibility) — it just removes a partner's only filtering mechanism, while the real gap he identified is
better and fully addressed by a different, purpose-built feature (B2B-55, below).

## What Was NOT Touched

- `test_mode` as an **internal** field (billing-exclusion gating in `applyWalletDecrement()`, the
  `partner_sessions.test_mode` column, the B2B-08 trial/test-minutes mechanism, every other internal
  call site) — untouched regardless of this payload-level question; it was never in scope for removal
  there. Confirmed via grep: `test_mode` appears in 16+ files across dispatch routes, Inngest jobs, and
  tests, almost all of which are internal gating logic entirely independent of this wire-contract
  question.
- `WEBHOOK_DOC.payloadFields` (the reseller docs field list) — `test_mode` is already correctly listed
  there today; since it's being kept, no docs change results from this decision.

## Reversibility

If Arun still wants it gone after reading this, it's the same one-line interface-field removal as
B2B-53, plus a one-line `WEBHOOK_DOC.payloadFields` edit to match — trivially reversible, not a
structural decision. Flagging this disagreement explicitly rather than silently deciding, per the
brief's own instruction to make the reasoning easy to override.

## Status

No code changes. No BA spec required — this is a "keep as-is" resolution, not a build.
