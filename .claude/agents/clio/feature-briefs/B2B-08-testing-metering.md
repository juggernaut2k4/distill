# Feature Brief: B2B-08 — Testing / Metering
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-15

> **RECONSTRUCTED 2026-07-15** — original lost to a concurrent-agent git-stash collision during the
> parallel B2B-06/07/08/09 build spree; rebuilt from `architecture.md` §15, `docs/b2b-pivot-status.md`'s
> Live Status table (B2B-08 and B2B-09 rows) and Changelog (2026-07-15 entries, including the loss/
> recovery note), `docs/brainstorm-partner-signup-integration.md` as cited verbatim in those sources
> (the file itself was never committed to this repo and is not separately recoverable — every quote
> below is reproduced exactly as it appears, attributed, in the tracker's own record of that session),
> and the shipped code's own comments (`inngest/partner-trial-cutoff.ts`, `lib/stripe.ts`'s
> `createTestBlockCheckoutSession`, `app/api/partner/v1/sessions/route.ts`'s test-mode gate branch,
> `lib/partner/live-render.ts`'s `handleSessionEnd()`). Content matches the historical record to the
> best available evidence. Nothing below re-decides anything — every resolution restates what was
> already resolved and shipped; this document exists to restore the "why" behind code and schema that
> are themselves fully intact and already committed.

## Series context
Dispatched off the same `docs/brainstorm-partner-signup-integration.md` session that also produced
B2B-06 v2 (partner provisioning) and B2B-07 (developer portal) — the next free ID after B2B-05 closed
the original five-brief pivot sequence. `B2B-08` was independently claimed by two briefs written
roughly simultaneously off fresh reads of `docs/b2b-pivot-status.md` that both (correctly, at the time)
showed no `B2B-08` in use; per this brief's own stated tie-break rule, whichever was written second
renumbers — this brief keeps `B2B-08`, the sibling session-delivery/glitch-dashboard brief became
`B2B-09`. Depends on B2B-02 (partner API/multi-tenant architecture, done — `partner_accounts`,
`partner_sessions`, `usage_events` all exist) and B2B-04 (billing/metering, done — this brief is a
schema and mechanism dependency of B2B-04, not a rebuild of it: it extends `partner_wallets`,
`wallet_ledger`, and `usage_events` additively, reusing `credit_wallet_balance`/`decrement_wallet_balance`'s
exact RPC pattern and `applyWalletDecrement()`'s existing `test_mode` skip rather than replacing any of
it). Explicitly does **not** block on and does not wait for B2B-06 — the two briefs are orthogonal by
activation condition, not sequenced (see "Known Constraints" below).

Grounded in, read in full before writing this brief: `docs/brainstorm-partner-signup-integration.md`
item 3 and its "Resolved during follow-up discussion" addendum, `docs/reference-vendor-api-integrations.md`
§7/§8, `docs/specs/B2B-04-requirement-document.md`, migration `075` (`partner_wallets`, `wallet_ledger`,
`usage_events` extensions, the `credit_wallet_balance`/`decrement_wallet_balance` RPCs), `lib/partner/
session-init.ts`, `app/api/partner/v1/sessions/route.ts`, and `B2B-06-partner-provisioning.md` v2 (for
the funding-guardrail orthogonality check).

**Confirmed by direct code read, not assumed from the brainstorm doc alone:** `dispatchMeetingBot()`
does not branch on `test_mode` today. A `test`-mode API key dispatch is *already* a real, unbounded,
unmetered Attendee+Hume bot, at real cost to Clio, forever, with zero cap — independently
cross-confirmed by the sibling B2B-07 brief's own pre-condition note. This reframes the brief correctly:
it bounds an already-live cost-exposure gap, it does not build a testing mechanism from nothing.

## What Arun Said
From the partner-signup-integration brainstorm session, as recorded verbatim in
`docs/b2b-pivot-status.md`'s Changelog:

> "We can give them 20 minutes of free bot usage for testing then they can pay for 2 hours every time
> to continue testing."

Follow-up, when asked directly whether this costs Clio real money to provide:

> "That cost is on us. We will send real bot."

Both statements are taken as literal product requirements, not suggestions: the trial is a real bot
(not a stub/simulated response), the 20-minute allowance is free to the partner and paid for by Clio,
and continued testing beyond that allowance is a real paid purchase in fixed 2-hour blocks, not a
metered pay-as-you-go rate.

## The Problem Being Solved
Two problems, one brief:

1. **An unbounded cost-exposure gap that already exists in production.** `dispatchMeetingBot()` sends a
   real Attendee bot with a real Hume voice session for any API key, live or test, with no cap and no
   metering. A partner (or anyone with a leaked test key) can currently run unlimited free sessions at
   Clio's real vendor cost, indefinitely. This is a live gap, not a hypothetical one.
2. **No implementation of the testing model Arun described for partner onboarding.** Partners need a
   way to try Clio with a real bot, for free, before committing — but that trial has to be bounded, and
   continued testing past the free allowance has to become a real, billable transaction that does not
   corrupt Clio's actual revenue reporting or get confused with a partner's live production usage.

## What Success Looks Like
A BA spec exists that, once built, means:

1. Every `partner_account_id` gets a lifetime, once-ever 20-minute free trial allowance for `test`-mode
   bot sessions — not a per-session reset. Tracked on a new `partner_wallets.trial_minutes_used` column.
2. When a test-mode session hits its allowance boundary mid-session, the bot is actually, forcibly
   removed from the meeting by a real server-side job — not a client-side check the partner's own
   integration could ignore or fail to enforce. This is the mechanism that actually bounds Clio's cost,
   not just a UI nicety.
3. Once the free allowance is exhausted, a partner can purchase a 2-hour block of continued test usage
   as a real, one-time Stripe charge. That purchase funds a dedicated test-usage balance, structurally
   separate from the partner's real production wallet balance, so test spend never shows up as revenue
   and never corrupts the admin page's real-revenue reporting.
4. The block price is a real, derived number, not invented for this brief: 120 minutes at the existing
   seeded COGS-placeholder voice-minute rate, same placeholder labeling discipline as everywhere else in
   the billing system.
5. `test_mode`'s existing meaning is preserved exactly as-is everywhere it's already relied upon
   ("never billed to the partner, permanently") — but Clio internally needs to know when a `test_mode`
   event actually cost real vendor money (which, per item 1 above, it always does), so that signal has
   to exist somewhere without touching or reinterpreting `test_mode` itself.
6. This mechanism and B2B-06's separate funding guardrail (which blocks unfunded accounts from
   dispatching a **live**-mode bot) must not conflict, duplicate effort, or create a build-order
   dependency between the two briefs.

## Known Constraints
- **Real bot, not simulated.** Per Arun's own words, the trial dispatches an actual Attendee+Hume bot,
  not a mock or reduced-fidelity experience. This is a deliberate cost Clio accepts to make the trial
  meaningful.
- **Lifetime allowance, not per-session.** A per-session reset would leave the exploitable shape of the
  existing unbounded gap fully intact — this is the reason for tracking cumulative usage on
  `partner_account_id`, not resetting per test session.
- **Enforcement must be real and server-side.** An end-of-natural-session-only check is insufficient —
  it does not actually bound Clio's exposure if a test session simply runs long. The cutoff has to be an
  active, server-initiated removal of the bot at the allowance boundary.
- **Test spend must never touch `balance_usd`.** Two independent, code-confirmed reasons: (a)
  `applyWalletDecrement()` already unconditionally skips wallet mutation for `test_mode=true` events, so
  routing test spend through the production balance path wouldn't even work as written; (b) even if it
  did, conflating test spend into `balance_usd` would corrupt the admin page's real-revenue reporting
  that B2B-04 built specifically to be trustworthy.
- **No new dollar figures invented.** Per F-02's standing deferral (`docs/b2b-pivot-status.md`), the
  block price must derive from the existing seeded placeholder rate, carrying the same
  `cogs_placeholder_2026_05_no_margin` label — not a newly estimated number.
- **`test_mode` keeps its existing meaning, unmodified.** It still means "never billed to the partner,
  permanently." Any new signal needed for Clio's internal cost visibility must be additive, not a
  reinterpretation of what `test_mode` already means everywhere else it's read.
- **Orthogonal to, not sequenced with, B2B-06.** This brief's enforcement gate fires only for
  `test`-mode keys; B2B-06's funding guardrail fires only for `live`-mode keys. Neither brief blocks on
  the other's build order.

## Questions for BA
Six items were resolved as CEO/BA-level technical judgment calls, not escalated to Arun — each with the
reasoning recorded, not just the answer, so the BA (and anyone reviewing this later) can verify the
logic rather than treat these as silently settled:

1. **Should the allowance reset per session or track lifetime?** Resolved: lifetime, once-ever, tracked
   per `partner_account_id` on a new `partner_wallets.trial_minutes_used` column. A per-session reset
   would leave the exploitable shape of the existing unbounded gap intact — it would look bounded per
   session while remaining unbounded in aggregate.
2. **How is the allowance actually enforced mid-session, not just checked at the start?** Resolved: a
   real server-side forced cutoff via a new Inngest job, modeled on the existing `session-timer.ts`
   precedent but scoped to `partner_sessions`, calling the meeting-bot provider's existing outbound
   leave/remove call to pull the bot at the allowance boundary. Checking only at natural session-end was
   rejected as insufficient to actually bound Clio's cost exposure.
3. **How is the paid 2-hour block funded, and does it flow through the existing production wallet
   balance?** Resolved: a real, fixed-price one-time Stripe Checkout charge crediting a new, dedicated
   test-usage balance column, deliberately not routed through `balance_usd` — for the two code-confirmed
   reasons given under "Known Constraints" above.
4. **What is the block's price?** Resolved: derived, not invented — 120 minutes at the existing seeded
   voice-minute COGS-placeholder rate, carrying the same placeholder label already used everywhere else
   in the billing system, per F-02's deferral.
5. **Does `test_mode` need to change meaning to account for the fact that this usage actually costs
   Clio real money?** Resolved: no. `test_mode` keeps its existing, unmodified meaning. A new, purely
   additive, Clio-internal-only flag is added alongside it to signal that real vendor cost was incurred
   — resolving the exact tension this dispatch posed ("this DOES cost real money... needs careful
   design, not just reusing that flag as-is") without touching the flag every other part of the system
   already relies on.
6. **Does this conflict with or need to be sequenced against B2B-06's funding guardrail?** Resolved: no
   — confirmed orthogonal by activation condition. This brief's gate fires only for `test`-mode keys;
   B2B-06's fires only for `live`-mode keys. One deliberate positive interaction is worth naming (not a
   dependency): the block-purchase Checkout session is configured to save the payment method for future
   use, so a partner's first block purchase is likely also the first time they attach a payment method
   — which incidentally satisfies B2B-06's separate payment-method check for their later live-mode
   usage. Neither brief blocks on the other's build order.

Zero open questions remain for Arun. If the BA finds a genuine fork not anticipated here while writing
the full spec, escalate that specific finding back to the CEO rather than resolving it silently — per
the standing rule, Section 11 must be empty before this goes to build.

## Explicitly not in scope
Named here, not silently dropped:
- **The separate Attendee inbound-webhook signature bypass.** A real, pre-existing security gap, but
  unrelated to testing/metering — tracked and fixed separately.
- **A partner-facing Configurator UI for purchasing a test block.** Flagged as a real follow-on gap for
  B2B-03 to pick up with its own spec — not built here without one.
- **Retroactive accounting for historical unmetered test usage.** Forward-only from this brief's launch,
  matching F-01's own declined-backfill precedent — no investigation or backfill into prior sessions
  dispatched before this mechanism existed.

## Approval note
Reviewed against `architecture.md` §15 (the full technical implementation this brief's resolutions
produced) and `docs/b2b-pivot-status.md`'s Live Status and Changelog entries for B2B-08. All six
resolved items in "Questions for BA" above are reflected exactly in the shipped schema, RPCs, routes,
and Inngest job: lifetime allowance tracking (`partner_wallets.trial_minutes_used`), the real
server-side cutoff (`inngest/partner-trial-cutoff.ts`, calling the meeting-bot provider's `deleteBot()`),
the structurally separate `test_minutes_balance` funded via a real one-time Stripe charge
(`createTestBlockCheckoutSession`, `lib/stripe.ts`), the derived $1.80 rate carrying the
`cogs_placeholder_2026_05_no_margin` label, the additive `usage_events.is_metered_test_usage` flag
sitting alongside an unmodified `test_mode`, and confirmed orthogonality with B2B-06 by activation
condition. Zero open questions blocked this brief from proceeding to BA dispatch for the full
Requirement Document.
