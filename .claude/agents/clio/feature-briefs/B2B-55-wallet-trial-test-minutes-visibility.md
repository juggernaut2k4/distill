# Feature Brief: B2B-55 — Expose Free-Trial / Test-Minutes Balance on the Partner Wallet API

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-30

## What Arun Said

From the compiled webhook-payload field review, on what a reseller actually needs to see: "i think
that info [test_mode] is not needed to the reseller for every session in this transaction. for a
reseller he is interested to know, out of my free 20 minutes how many i consumed, if i paid for
minutes then how much i consumed now from that pool etc."

## The Problem Being Solved

This is a real, confirmed gap, not a re-reading of an existing field. `GET /api/partner/v1/wallet`
(`app/api/partner/v1/wallet/route.ts`) already exists and returns `balance_usd`, burn rate by event
type, and projected days-remaining — but it does not expose the free-trial-minutes /
purchased-test-minutes breakdown, even though the underlying data already exists on `partner_wallets`
(columns added by migration `077_b2b08_testing_metering.sql`, B2B-08). A reseller asking "how much of
my free allowance is left, and how much of my paid test-block pool is left" has no way to answer that
today via the API — exactly the gap Arun described.

## What Success Looks Like

A reseller calling `GET /api/partner/v1/wallet` sees, alongside the existing USD fields, their
free-trial-minutes consumption/remaining and their purchased test-block-minutes balance — the same
"how much of my pool is left" visibility Arun described, delivered on the endpoint that already owns
this kind of balance/consumption reporting.

## Facts Already Confirmed (BA Should Not Need to Re-Derive These)

- **Source columns**, both on `partner_wallets`, added by migration 077 (B2B-08):
  - `trial_minutes_used` NUMERIC — lifetime, once-ever free-trial minutes consumed. Never reset.
    Capped at `20.00` **inside the `consume_trial_and_test_minutes()` Postgres RPC** (`LEAST(20.00,
    ...)`), not by a DB `CHECK` constraint and not by any named constant elsewhere in the codebase.
  - `test_minutes_balance` NUMERIC — purchased 2-hour-test-block minutes remaining, structurally
    separate from `balance_usd`. Floored at 0 by the same RPC.
- **The "20" cap is a bare literal, duplicated nowhere else in TypeScript.** BA must decide how the new
  wallet-route code represents `trial_minutes_remaining`: (a) hardcode `20` again with an explicit
  comment cross-referencing migration 077 so a future cap change is a known two-place edit, or (b) a
  more durable shared-constant approach. Weigh implementation effort against how likely the cap is to
  change before deciding — CEO has no strong preference, flagging the tradeoff for BA to resolve.
- **Do not confuse this with the separate "20 free demo minutes" mechanism** (`credit_demo_minutes_balance`,
  migration `100_b2b39_demo_passcodes_and_billing.sql`, B2B-39). That grants
  `partner_wallets.demo_minutes_balance` automatically to `channel_partner` self-client accounts at
  signup, for the internal passcode-gated demo/showcase tool — a completely different mechanism from a
  real reseller's own B2B-08 trial allowance. The two numbers happen to coincide at 20, which makes
  them easy to conflate; they are not the same field, same purpose, or same account type. Arun's quote
  ("out of my free 20 minutes") reads as the B2B-08 real-reseller trial mechanism — BA should confirm
  this reading explicitly before building, precisely because of the coincidental-number risk.
- **Recommended field names** (not final, BA's call, but should match this response's existing
  snake_case-mirrors-DB-column convention, e.g. `balance_usd` mirrors its own column directly):
  `trial_minutes_used`, `trial_minutes_remaining` (computed: `max(0, 20 - trial_minutes_used)`),
  `test_minutes_balance`.
- **Recommend extending the existing endpoint, not a new one.** `GET /api/partner/v1/wallet` already
  assembles a `partner_wallets` row plus computed projections behind `requirePartnerApiKey(request,
  'reads')` auth and the same rate-limit class — adding these fields is a natural, low-risk extension
  of an endpoint that already owns "balance and consumption reporting" as its purpose, not a new
  surface area.
- **Docs impact**: the reseller developer docs' "Billing explained" section
  (`app/(with-clerk)/dashboard/configurator/docs/DocsClient.tsx`, backed by prose/tables in
  `app/(with-clerk)/dashboard/configurator/api/content.ts`) currently only describes the USD wallet
  mechanism (prepaid balance, plan tiers, top-ups, burn rate). It has no mention of trial or test
  minutes at all today. This section should be updated in the same change to describe the new fields —
  otherwise the docs page becomes incomplete the moment this ships.
- **Scope-verification flag for BA**: direct code read shows `POST /api/partner/v1/sessions`
  (`app/api/partner/v1/sessions/route.ts` ~line 269) reads `trial_minutes_used`/`test_minutes_balance`
  unconditionally when gating a new session dispatch, regardless of `account_kind` — suggesting the
  B2B-08 trial mechanism already applies uniformly to any `partner_accounts` row, not just demo/internal
  ones. BA should verify this against the full B2B-08 spec (`docs/specs/B2B-08-requirement-document.md`)
  before finalizing scope — a wallet response field is only valuable if it's genuinely non-zero/relevant
  for a real reseller account in practice, not only for Clio's own internal test account.

## Known Constraints

- Read-only addition to an existing GET endpoint — no new write paths, no schema changes (migration
  077 already applied and live).
- Must stay scoped to the calling partner's own account only, matching this endpoint's existing
  "never any field derived from another partner's data" convention.
- Do not touch the B2B-39 demo-minutes mechanism (`demo_minutes_balance`,
  `/api/channel-partner/demo-access`, `/api/admin/demo-access`) — genuinely out of scope, different
  feature, different audience.

## Questions for BA

1. Final field names/response shape (recommendation given above).
2. Whether `trial_minutes_remaining`'s "20" should be a hardcoded literal (with a cross-reference
   comment) or a shared constant — and if the latter, where it should live.
3. Whether the developer-docs "Billing explained" update ships in the same PR (CEO recommends yes,
   since this is a documented public API contract and the docs page should never trail the live
   response shape).
4. Confirm the B2B-08 trial mechanism genuinely applies to real (non-demo) partner accounts today, per
   the scope-verification flag above — if it turns out to be effectively dead for real partners in
   current practice, flag back to CEO before finalizing the spec, since that would change the
   feature's actual value proposition.

## Gate

Full CEO → BA → Dev chain applies — this is a genuine product-shape addition to a documented external
API contract (new reseller-visible fields, new docs content), not a pure technical fix.
