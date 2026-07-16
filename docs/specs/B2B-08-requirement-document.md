# B2B-08 — Testing / Metering
# Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-07-16

> **RECONSTRUCTED 2026-07-15/16** — original lost to a concurrent-agent git-stash collision during the
> parallel B2B-06/07/08/09 build spree on 2026-07-15. Rebuilt primarily from the shipped, live code
> (not just prose) — cross-verified against `inngest/partner-trial-cutoff.ts`, `lib/stripe.ts`, and
> `app/api/partner/v1/sessions/route.ts` directly, not assumed from `architecture.md`'s summary alone.
> Content matches both the historical record (the CEO Feature Brief, reconstructed at
> `.claude/agents/clio/feature-briefs/B2B-08-testing-metering.md`) and the actual as-built system, with
> **one verified exception** called out explicitly rather than glossed over: see "Verification Note —
> One Confirmed Gap" immediately below. This is a reconstruction of a document that was already CEO-
> approved and built, not a re-decision of anything in it — every resolution below restates what was
> already resolved and shipped.

## Verification Note — One Confirmed Gap (read before the rest of this document)

Per this reconstruction's own instruction to verify directly against the live, shipped code rather than
architecture.md's prose summary, one discrepancy was found and is documented honestly rather than
silently reconciled:

`architecture.md` §15.2 and the CEO brief's Approval Note both describe **one new route**,
`POST /api/admin/billing/test-block`, as part of the shipped surface. Direct code read (`grep`-confirmed,
`app/api/admin/billing/` directory listing) shows this route file **does not exist** — only
`clients/route.ts`, `checkout/route.ts`, `subscription/route.ts`, and `invoice/route.ts` are present under
`app/api/admin/billing/`. Everything the route would call **is** live and correct:
`createTestBlockCheckoutSession()` (`lib/stripe.ts:241-279`) is fully implemented, exactly as
`architecture.md` §15.3 documents it, and the Stripe webhook's `test_block_purchase` completion branch
(`app/api/webhooks/stripe/route.ts:142-195`) is fully implemented and correctly wired to
`credit_test_minutes_balance()`. But `createTestBlockCheckoutSession()` is not called from anywhere in
`app/` — it is presently dead code, reachable by no live HTTP endpoint. No admin UI button, page, or
component reference to a "test block" purchase flow was found either (`grep`-confirmed across
`app/dashboard` and `components/`).

**Practical effect:** the free 20-minute trial allowance, its real server-side cutoff enforcement, and the
`test_minutes_balance` consumption/accounting mechanism are all fully live today (Sections 4.A–4.C, 5.1–5.5
below describe real, working behavior). The *purchase* leg of "pay for a 2-hour block to continue testing"
(Section 4.D, 5.6 below) is fully built at the function and webhook-completion layer but has no live
trigger — a partner (or Clio admin) cannot today actually initiate that Stripe Checkout session through
any shipped surface. This document describes the purchase mechanism as designed and as it will behave the
moment the missing route is added (its request/response contract is fully determined by the existing,
unmodified `createTestBlockCheckoutSession()` signature and the `requirePartnerAdmin()` auth pattern every
sibling `/api/admin/billing/*` route already uses) — Section 12 lists wiring `POST
/api/admin/billing/test-block` as an outstanding, not-yet-shipped dependency, not a design gap.

This finding does not reopen Section 11 — it is not a product ambiguity requiring Arun's input; it is a
one-file, mechanical wiring gap against an already-fully-specified contract, flagged per the standing
"surface findings rather than silently resolve or bury them" discipline (`docs/specs/
B2B-06-requirement-document.md` Section 11 precedent).

---

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-08-testing-metering.md` (reconstructed
2026-07-15 — read in full, including its own reconstruction banner).

Authoritative source material (all read in full or by direct code inspection):
`docs/brainstorm-partner-signup-integration.md` item 3 and its "Resolved during follow-up discussion"
addendum (as quoted verbatim in the CEO brief and `docs/b2b-pivot-status.md`'s Changelog — the brainstorm
file itself is not separately recoverable), `docs/reference-vendor-api-integrations.md` §7/§8,
`docs/specs/B2B-04-requirement-document.md` (the billing/metering engine this document extends
additively), `docs/specs/B2B-06-requirement-document.md` (structural/format template, and the source of
the confirmed orthogonality/positive-interaction finding cited below), `architecture.md` §15 (the full,
intact technical spec — schema DDL, RPC bodies, exact route/job code), `supabase/migrations/
077_b2b08_testing_metering.sql` (the exact, applied schema — read directly), `inngest/
partner-trial-cutoff.ts` (read directly, in full), `lib/stripe.ts`'s `createTestBlockCheckoutSession`
(read directly), `app/api/partner/v1/sessions/route.ts` lines 79–133 (the live trial-gate branch, read
directly), `app/api/webhooks/stripe/route.ts` lines 140–195 (the live `test_block_purchase` completion
branch, read directly), `lib/partner/live-render.ts`'s `handleSessionEnd()` (read directly, confirming
`testMode` now threads through correctly), `app/api/inngest/route.ts` (confirming `partnerTrialCutoffJob`
is registered), `tests/integration/partner-sessions-api.test.ts` (the live test coverage that exercises
this mechanism's default-wallet-state behavior — read directly; no dedicated `partner-trial-cutoff.test.ts`
or `test-block`-specific unit test file exists in the repo as of this reconstruction, confirmed by search).

Companion artifact this document cross-references, not modifies: `architecture.md` §15 (exact schema DDL,
RPC bodies, and route/job code a developer would implement against — already applied for everything except
the one gap named above).

Migration already applied (not produced by this reconstruction): `supabase/migrations/
077_b2b08_testing_metering.sql`, project `nqxlpcshouboplhnuvrh`.

---

## Template Adaptation Note

Like B2B-06, this brief is not one screen-by-screen consumer feature — it is a bounded-cost mechanism
with no dedicated user-facing screen at all (Section 10). The CEO brief's own framing is "a testing/
metering mechanism," not a UI feature, so Section 4/5 below describe **server-side flows and API
contracts**, not wireframed screens — the one place a human ever sees this mechanism's output directly is
the `402 trial_exhausted` JSON error body a partner's own developer sees in their own tooling, exactly the
same "the API response itself is the wireframe" convention `B2B-06-requirement-document.md` Section 5.A
already established for its own funding-guardrail surface.

---

## 1. Purpose

Before this mechanism existed, `dispatchMeetingBot()` (`lib/partner/session-init.ts`) did not branch on
`test_mode` at all — confirmed by direct code read, not assumed. Any `test`-mode partner API key,
including one that leaked or belonged to an account never intended to run real sessions, could dispatch a
real, live Attendee meeting bot with a real Hume voice session, with no cap, no time limit, and no cost
tracking, indefinitely. This was a live, unbounded cost-exposure gap in production, not a hypothetical
one — every `test`-mode session already cost Clio real vendor money with zero mechanism to bound it.

Separately, Arun's own stated product requirement for partner onboarding — "We can give them 20 minutes
of free bot usage for testing then they can pay for 2 hours every time to continue testing... That cost
is on us. We will send real bot." — had no implementation. Partners had no sanctioned way to try Clio
with a real bot before committing, and Clio had no way to bound what that trial cost.

**What failure looks like without this document:** the unbounded cost-exposure gap remains open
indefinitely — any test-mode key, leaked or not, can run unlimited free real-bot sessions at Clio's
expense forever, with no mechanism to ever convert a partner's continued testing into a real, billable,
separately-tracked transaction that doesn't corrupt the admin page's real-revenue reporting (`B2B-04`'s
`balance_usd`).

## 2. User Story

**Story 1 — A prospective partner's own developer, testing Clio for the first time**
As a partner integrating with Clio's API using a `test`-mode credential,
I want to dispatch a real, functioning meeting bot for free, up to a reasonable allowance,
So that I can validate my own integration against real behavior before committing to a paid relationship.

**Story 2 — The same partner developer, after exhausting the free allowance**
As a partner who has used up my account's lifetime free trial minutes,
I want a clear, immediate signal that my allowance is exhausted and a way to continue testing,
So that I am not silently blocked or confused about why my next session request failed.

**Story 3 — Clio's own backend (the session-dispatch code path itself)**
As the code that is about to dispatch a real, billable meeting bot for a `test`-mode request,
I want to check the account's remaining trial-plus-purchased-test minutes before dispatching, and force
the bot to leave the meeting the instant that allowance is exhausted mid-session,
So that Clio's real vendor cost for test-mode usage is always bounded, never open-ended, regardless of
whether the partner's own client behaves correctly.

**Story 4 — Clio's own backend (the billing/admin-reporting code path)**
As the code that maintains the admin page's real-revenue reporting,
I want test-mode spend to be structurally impossible to mix into `balance_usd` or the revenue figures
computed from it,
So that a partner's free trial or paid test-block purchase never corrupts what the admin page reports as
real revenue.

**Story 5 — A future partner-facing purchase flow (not yet wired to a live endpoint — see Verification
Note)**
As a partner who has exhausted their free trial allowance,
I want to purchase a fixed-price 2-hour block of continued test usage,
So that I can keep testing without my spend ever being confused with production usage.

## 3. Trigger / Entry Point

- **Trial-gate check**: triggered internally, synchronously, inside the existing
  `POST /api/partner/v1/sessions` handler (`app/api/partner/v1/sessions/route.ts:82-133`) — not a new
  externally-reachable route. Fires only when `auth.mode === 'test'`, between the existing
  `partner_sessions` insert and the existing `dispatchMeetingBot()` call. The `auth.mode === 'live'`
  branch (B2B-06's funding guardrail) is untouched and unreachable from this code path — confirmed by
  direct code read of the same file, lines 135 onward.
- **Mid-session forced cutoff**: triggered internally by the `clio/partner-trial.started` Inngest event,
  emitted (fire-and-forget) by the trial-gate check above immediately after a successful bot dispatch
  (`app/api/partner/v1/sessions/route.ts:112-122`). Consumed by `inngest/partner-trial-cutoff.ts`'s
  `partnerTrialCutoffJob`, registered in `app/api/inngest/route.ts` (confirmed present in the
  `functions: [...]` array).
- **Normal session end (cutoff-job cancellation + minute consumption)**: triggered by
  `POST /api/partner/render/end-session`, which calls `handleSessionEnd()`
  (`lib/partner/live-render.ts:196-246`). For a `test_mode` session, this emits `clio/partner-trial.ended`
  (cancelling the pending cutoff job via its `cancelOn` config) and calls `consume_trial_and_test_minutes`
  with the session's actual elapsed duration.
- **Test-block purchase initiation**: per the Verification Note above, **no live trigger exists today**.
  The intended trigger, fully determined by the existing `createTestBlockCheckoutSession()` signature and
  every sibling `/api/admin/billing/*` route's established pattern, is `POST /api/admin/billing/test-block`
  — Clerk-authenticated, `requirePartnerAdmin(partner_account_id)` (the same authorization pattern
  `POST /api/admin/billing/checkout` already uses, `lib/partner/auth.ts:213-234`), no `state` beyond a
  `partner_admin_users` row for the target account.
- **Test-block purchase completion**: triggered by Stripe's `checkout.session.completed` webhook event
  reaching `POST /api/webhooks/stripe`, filtered on `session.metadata?.purpose === 'test_block_purchase'`
  (`app/api/webhooks/stripe/route.ts:142`). This leg is fully live and correctly wired — it will fire
  correctly the moment any Checkout session with that exact metadata shape completes, regardless of how
  the Checkout session was created (i.e., it does not itself depend on the missing route existing; a
  manually-created Checkout session with the right metadata would also complete correctly).

## 4. Screen / Flow Description

There is no Clio-rendered UI screen anywhere in this mechanism (Section 10) — every state below is a
server-side flow or an API response a partner's own code observes.

### 4.A Trial-gate check — `POST /api/partner/v1/sessions`, `test`-mode requests only

Exact, live logic (`app/api/partner/v1/sessions/route.ts:82-108`):

1. After the `partner_sessions` row is inserted (`status: 'requested'`), if `auth.mode === 'test'`, read
   `trial_minutes_used` and `test_minutes_balance` from `partner_wallets` for `auth.partnerAccountId`
   (`.maybeSingle()` — no row is a valid, expected state for a brand-new account, treated as
   `trial_minutes_used = 0, test_minutes_balance = 0`, i.e. a fresh, full 20-minute allowance).
2. Compute `availableMinutes = Math.max(0, 20 - trialMinutesUsed) + testMinutesBalance`.
3. **If `availableMinutes <= 0`**: update the just-inserted `partner_sessions` row to
   `status: 'failed', end_reason: 'trial_exhausted'`, and return `402` with the exact body in Section 4.A.1
   below. `dispatchMeetingBot()` is never called — zero vendor cost incurred on this path.
4. **If `availableMinutes > 0`**: call `dispatchMeetingBot()` exactly as the `live`-mode path does. If the
   dispatch succeeds (`status: 'bot_active'` and a `botId` is present), fire-and-forget emit
   `clio/partner-trial.started` with `{ clioSessionRef, partnerAccountId, providerBotId: dispatchResult.botId,
   availableMinutes }` to Inngest (a `.catch()` logs, never blocks the response). Return `201` with
   `{ clio_session_ref, status, render_url, ...(error if present) }` — the identical response shape the
   `live`-mode path already returns, so this mechanism is transparent to the response contract.

**4.A.1 — Exhausted-allowance response (the literal "wireframe" of this surface, per Section 5.A's
convention):**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": {
    "code": "trial_exhausted",
    "message": "Free testing allowance used. Purchase a 2-hour test block to continue."
  }
}
```

### 4.B Mid-session forced cutoff — `inngest/partner-trial-cutoff.ts`

Exact, live logic (`partnerTrialCutoffJob`, triggered by `clio/partner-trial.started`,
`cancelOn: [{ event: 'clio/partner-trial.ended', match: 'data.clioSessionRef' }]`,
`concurrency: { key: 'event.data.clioSessionRef', limit: 1 }`, `retries: 1`):

1. `step.sleep('wait-for-available-minutes', '${availableMinutes}m')` — sleeps for exactly the minutes the
   trial-gate check computed the account had available at dispatch time (not a re-computed figure).
2. `step.run('check-session-status', ...)` — reads `partner_sessions.status`; if already `completed` or
   `failed` (a race-safe second guard, since `cancelOn` should already have caught a normal end), the job
   returns as a no-op.
3. `step.run('leave-bot', ...)` — calls `getMeetingBotProvider().deleteBot(providerBotId)` inside a
   try/catch; a failure here is logged but non-fatal — the session is still force-ended by the following
   steps regardless of whether the vendor's leave call itself succeeded.
4. `step.run('consume-minutes', ...)` — calls the `consume_trial_and_test_minutes` RPC with the *full*
   `availableMinutes` figure (the session ran its entire allowance, by definition of having hit this
   cutoff), not a re-measured actual duration.
5. `step.run('mark-session-completed', ...)` — updates `partner_sessions` to
   `status: 'completed', ended_at: now(), end_reason: 'trial_limit_reached'`.
6. `step.run('record-billable-events', ...)` — calls `recordBillableEvent()` twice: once for
   `usage.voice_minute` (`quantity: availableMinutes, unit: 'minutes', testMode: true,
   isMeteredTestUsage: true`), once for `session.completed` (`testMode: true`) — mirroring
   `handleSessionEnd()`'s own two-call pattern exactly, so a partner's outbound webhook integration
   observes a forcibly-cutoff test session end exactly as it would a normal one.

**Deliberate design choice, confirmed by the code's own comment**: no graceful pre-cutoff warning/nudge
(unlike `session-timer.ts`'s two-phase warning for the legacy flow) — the meeting belongs to the partner,
not to Clio, so there is nothing for Clio to gracefully wrap up; a clean bot-leave at the exact boundary is
correct and sufficient.

### 4.C Normal session end — `handleSessionEnd()` (`lib/partner/live-render.ts:196-246`)

For every session end (test-mode or not), the function marks the row `completed` as before. **New,
test-mode-specific behavior:**

1. If `testMode` is true, fire-and-forget emit `clio/partner-trial.ended` with `{ clioSessionRef }` —
   this cancels any still-pending `partnerTrialCutoffJob` for this session via its `cancelOn` config, so a
   session that ends normally (before hitting its allowance boundary) never triggers a redundant forced
   cutoff.
2. If `durationMinutes > 0`, call `recordBillableEvent()` for `usage.voice_minute` with `testMode` and
   `isMeteredTestUsage: testMode` both threaded through correctly (this closes a pre-existing, in-scope
   adjacent bug — see "In-scope adjacent fix" below).
3. If `testMode` is true, call `consume_trial_and_test_minutes` with the session's **actual**
   `durationMinutes` (not `availableMinutes` — that figure is only meaningful on the forced-cutoff path,
   where the session is known to have run its full allowance). Wrapped in try/catch, non-fatal on failure,
   matching `recordBillableEvent()`'s own wallet-decrement-call failure discipline.
4. Calls `recordBillableEvent()` for `session.completed` with `testMode` threaded through, as before.

**In-scope adjacent fix, not a new feature (mirrors an established B2B-04 precedent of fixing an adjacent
gap found while touching the same code path):** prior to this document's changes, `handleSessionEnd()`
never read `partner_sessions.test_mode` and never passed a `testMode` argument to either
`recordBillableEvent()` call — every session-end billable event defaulted to `testMode: false` regardless
of the session's actual mode, meaning `applyWalletDecrement()`'s existing `test_mode` skip (B2B-04) was
never actually reachable from this call site for any partner session. `getPartnerSession()`
(same file, confirmed by direct code read) now selects `test_mode` and exposes it as `testMode: boolean`
on `PartnerSessionRow`; `POST /api/partner/render/end-session` passes `session.testMode` through as
`handleSessionEnd()`'s new fourth, required argument.

### 4.D Test-block purchase (designed, not yet live-triggerable — see Verification Note)

**Intended request**, fully determined by `createTestBlockCheckoutSession()`'s existing signature and the
sibling `POST /api/admin/billing/checkout` route's established contract shape:
```
POST /api/admin/billing/test-block
Content-Type: application/json

{ "partner_account_id": "uuid", "success_url": "string, optional", "cancel_url": "string, optional" }
```

**Intended response — 201:**
```
{ "checkout_url": "https://checkout.stripe.com/..." }
```
(mock mode: `{ "checkout_url": "https://<app-url>/dashboard?mock_test_block=1&partner_account_id=..." }`,
per `createTestBlockCheckoutSession()`'s existing `isPlaceholder`/`!stripeClient` guard, confirmed live in
`lib/stripe.ts:250-253`.)

**Intended response — 403**: no `partner_admin_users` row for the target account, matching every sibling
`/api/admin/billing/*` route's `requirePartnerAdmin()` pattern exactly.

**Completion (fully live today, independent of the missing initiation route)**: on
`checkout.session.completed` with `metadata.purpose === 'test_block_purchase'`
(`app/api/webhooks/stripe/route.ts:142-195`):
1. Idempotency check via `walletLedgerAlreadyRecorded(supabase, session.id, 'test_block_purchase')` — a
   redelivered webhook is a no-op.
2. `credit_test_minutes_balance(partnerAccountId, 120)` RPC call — credits exactly 120 minutes.
3. Reads the account's **current, unchanged** `balance_usd` (never independently recomputed) to satisfy
   `wallet_ledger`'s `resulting_balance_usd NOT NULL` requirement on every row type, since this row type
   never moves `balance_usd`.
4. Inserts one `wallet_ledger` row: `entry_type: 'test_block_purchase', delta_usd: 1.80,
   resulting_balance_usd: <current, unchanged>, resulting_test_minutes_balance: <new value>,
   stripe_object_id: session.id`.
5. If `session.customer` is a string, sets `partner_wallets.stripe_customer_id` (minimal — card
   brand/last4/type sync happens via the existing, unmodified `customer.updated`/`payment_method.attached`
   handlers, which already key off `stripe_customer_id` regardless of which funding path attached it).

## 5. Visual Examples

### 5.A The one real "screen state" — the 402 error body

Given Section 10 (no Clio-rendered UI exists anywhere in this mechanism), the literal, falsifiable
"wireframe" of this feature's only human-facing surface is the exact JSON shown in Section 4.A.1 above —
matching the convention already established for B2B-06's own funding-guardrail surface
(`docs/specs/B2B-06-requirement-document.md` Section 5.A).

### 5.B Sequence flows

**5.B.1 — Trial-gate happy path (allowance available, dispatch succeeds)**
```
Partner backend → POST /api/partner/v1/sessions (test-mode key)
  → requirePartnerApiKey() → auth.mode === 'test'
  → INSERT partner_sessions (status='requested', test_mode=true)
  → SELECT trial_minutes_used, test_minutes_balance FROM partner_wallets WHERE partner_account_id = X
    → no row → treated as 0, 0 (fresh 20-min allowance)
  → availableMinutes = max(0, 20 - trialMinutesUsed) + testMinutesBalance → e.g. 20
  → availableMinutes > 0 → dispatchMeetingBot() → { status: 'bot_active', botId }
  → emit clio/partner-trial.started { clioSessionRef, partnerAccountId, providerBotId, availableMinutes: 20 }
  → 201 { clio_session_ref, status: 'bot_active', render_url }
```

**5.B.2 — Trial-gate rejection (allowance exhausted)**
```
Partner backend → POST /api/partner/v1/sessions (test-mode key, account already at 20/20 trial +
  0 test_minutes_balance)
  → INSERT partner_sessions (status='requested')
  → SELECT partner_wallets → trial_minutes_used=20, test_minutes_balance=0
  → availableMinutes = max(0, 20-20) + 0 = 0
  → UPDATE partner_sessions SET status='failed', end_reason='trial_exhausted' WHERE id=clioSessionRef
  → 402 { error: { code: 'trial_exhausted', message: '...' } }   [dispatchMeetingBot() never called]
```

**5.B.3 — Mid-session forced cutoff**
```
clio/partner-trial.started { clioSessionRef, partnerAccountId, providerBotId, availableMinutes: 20 }
  → partnerTrialCutoffJob: step.sleep('wait-for-available-minutes', '20m')
  → [20 minutes elapse, session still running]
  → check-session-status: partner_sessions.status is still 'bot_active'/'requested' (not completed/failed)
  → leave-bot: getMeetingBotProvider().deleteBot(providerBotId)
  → consume-minutes: consume_trial_and_test_minutes(partnerAccountId, 20)
    → trial_minutes_used: 0→20 (capped 20.00), test_minutes_balance unchanged (0, nothing to draw from)
  → mark-session-completed: partner_sessions SET status='completed', end_reason='trial_limit_reached'
  → record-billable-events: recordBillableEvent(usage.voice_minute, qty=20, testMode=true,
    isMeteredTestUsage=true) + recordBillableEvent(session.completed, testMode=true)
```

**5.B.4 — Normal session end, before hitting the allowance boundary**
```
Partner's render client → POST /api/partner/render/end-session (durationMinutes: 8, session was test-mode)
  → handleSessionEnd(clioSessionRef, partnerAccountId, 8, testMode=true)
  → emit clio/partner-trial.ended { clioSessionRef }
    → cancels the pending partnerTrialCutoffJob for this clioSessionRef (cancelOn match)
  → recordBillableEvent(usage.voice_minute, qty=8, testMode=true, isMeteredTestUsage=true)
  → consume_trial_and_test_minutes(partnerAccountId, 8) → trial_minutes_used: 0→8
  → recordBillableEvent(session.completed, testMode=true)
  → partner_sessions SET status='completed', ended_at=now()   [end_reason stays NULL — ordinary end]
```

**5.B.5 — Drawing from `test_minutes_balance` after the trial is exhausted (mixed consumption)**
```
Account state: trial_minutes_used=20 (exhausted), test_minutes_balance=120 (one block purchased)
Partner backend → POST /api/partner/v1/sessions
  → availableMinutes = max(0, 20-20) + 120 = 120
  → dispatchMeetingBot() succeeds → emit clio/partner-trial.started { availableMinutes: 120 }
  → [session runs 45 minutes, ends normally]
  → handleSessionEnd(..., 45, testMode=true)
  → consume_trial_and_test_minutes(partnerAccountId, 45)
    → RPC first draws from the (already-exhausted) trial portion: LEAST(45, GREATEST(0, 20-20))=0
    → remainder 45 drawn from test_minutes_balance: 120 → 75
    → trial_minutes_used stays 20 (already capped), test_minutes_balance: 120→75
```

**5.B.6 — Test-block purchase, completion leg only (initiation route not yet live — Verification Note)**
```
[No live route exists to reach this state today; shown as designed, exercised via a manually-created
 Checkout session carrying the exact metadata shape, or once the missing route ships]

Stripe → checkout.session.completed { metadata: { partner_account_id, purpose: 'test_block_purchase' },
  customer: 'cus_...', id: 'cs_...' }
  → POST /api/webhooks/stripe
  → walletLedgerAlreadyRecorded(session.id, 'test_block_purchase') → false (first delivery)
  → credit_test_minutes_balance(partnerAccountId, 120) → test_minutes_balance: 0→120
  → SELECT balance_usd (unchanged, current value cited)
  → INSERT wallet_ledger { entry_type: 'test_block_purchase', delta_usd: 1.80,
    resulting_balance_usd: <unchanged>, resulting_test_minutes_balance: 120, stripe_object_id: session.id }
  → UPDATE partner_wallets SET stripe_customer_id = session.customer
```

## 6. Data Requirements

Full schema DDL and RPC bodies live in `supabase/migrations/077_b2b08_testing_metering.sql` (read
directly, confirmed applied) and `architecture.md` §15.1. Summarized, matching the applied migration
exactly:

**Modified table, `partner_wallets` (two new additive columns):**
- `trial_minutes_used NUMERIC(10,2) NOT NULL DEFAULT 0`, `CHECK (trial_minutes_used >= 0)` — lifetime,
  once-ever free-trial minutes consumed per `partner_account_id`. The 20.00 ceiling is enforced entirely
  at the RPC layer (`consume_trial_and_test_minutes`, via `LEAST(20.00, ...)`), deliberately not as a DB
  `CHECK` against the literal figure, so a future change to the allowance size needs no schema migration.
- `test_minutes_balance NUMERIC(10,2) NOT NULL DEFAULT 0`, `CHECK (test_minutes_balance >= 0)` — purchased
  test-block minutes remaining, structurally separate from `balance_usd`.

**Modified table, `usage_events` (one new additive column):**
- `is_metered_test_usage BOOLEAN NOT NULL DEFAULT FALSE` — Clio-internal-only cost-visibility signal,
  confirmed orthogonal to `test_mode` (unchanged meaning: still "never billed to the partner, permanently").
  Never read by any partner-facing response; never consulted by `applyWalletDecrement()`'s existing
  `test_mode` skip (confirmed by direct code read — the skip logic is untouched).

**Modified table, `partner_sessions` (one new additive column):**
- `end_reason TEXT`, `CHECK (end_reason IS NULL OR end_reason IN ('trial_limit_reached', 'trial_exhausted'))`
  — `NULL` for an ordinary session end (unchanged default), `'trial_limit_reached'` for a mid-session
  forced cutoff (lands on the existing `'completed'` status), `'trial_exhausted'` for a pre-dispatch
  rejection (lands on the existing `'failed'` status). No new `partner_sessions.status` enum value.
  (Note: B2B-06, built after this document, additively extends this same `CHECK` constraint to include a
  third value, `'funding_required'`, for its own unrelated live-mode guardrail — confirmed orthogonal by
  activation condition, not a conflict.)

**Modified table, `wallet_ledger` (one new `entry_type` value, one new nullable column):**
- `entry_type` `CHECK` gains `'test_block_purchase'` alongside the existing `'topup_checkout'`,
  `'topup_subscription_recharge'`, `'topup_invoice'`, `'usage_decrement'`, `'manual_adjustment'` values
  (constraint dropped and recreated, confirmed in the applied migration).
- `resulting_test_minutes_balance NUMERIC(10,2)` — nullable, set only for `test_block_purchase` rows,
  mirroring how `usage_events_id`/`billing_rate_version_id` are only set for `usage_decrement` rows.

**Two new RPCs** (exact bodies confirmed in the applied migration):
- `credit_test_minutes_balance(p_partner_account_id UUID, p_minutes NUMERIC) RETURNS NUMERIC` — atomic
  lazy-create-or-increment on `test_minutes_balance`, mirroring `credit_wallet_balance`'s exact pattern.
- `consume_trial_and_test_minutes(p_partner_account_id UUID, p_minutes NUMERIC) RETURNS
  TABLE(trial_minutes_used NUMERIC, test_minutes_balance NUMERIC)` — atomically consumes `p_minutes`,
  first from `trial_minutes_used` (capped at 20.00 lifetime), any remainder from `test_minutes_balance`
  (floored at 0). Called by the trial-cutoff Inngest job (with the full `availableMinutes`) and by
  `handleSessionEnd()` (with the actual `durationMinutes`) for test-mode sessions.

**Deliberately not wallet-ledger-logged**: `consume_trial_and_test_minutes` calls themselves. Per
`wallet_ledger`'s existing discipline (covering `balance_usd` credits/debits plus this document's one
addition, `test_block_purchase`, a real-money credit event), trial/test-minute *consumption* has no
`balance_usd` analog and is tracked entirely via `partner_wallets.trial_minutes_used`/`.test_minutes_balance`
plus `usage_events.is_metered_test_usage` rows — the same non-ledgered treatment `usage_events.billed =
false` rows already get for unrated event types.

**Read from the database:** `partner_wallets` (trial-gate check, `app/api/partner/v1/sessions/route.ts`),
`partner_sessions` (the cutoff job's race-safe status re-check).

**Written to the database:** `partner_sessions.status`/`.end_reason` (trial-exhausted rejection; forced-
cutoff completion), `partner_wallets.trial_minutes_used`/`.test_minutes_balance` (via both RPCs),
`usage_events` (via `recordBillableEvent()`, `is_metered_test_usage` set true for every test-mode-metered
row), `wallet_ledger` (one row per completed test-block purchase, once the initiation route ships).

**APIs called:** the meeting-bot provider's existing, unmodified `deleteBot()` (Attendee's
`POST /bots/{botId}/leave`, confirmed live in `lib/meeting-bot/attendee.ts`) — no new vendor call added;
Stripe Checkout (`mode: 'payment'`, ad-hoc `price_data` line item, `setup_future_usage: 'off_session'`) —
no new Stripe Price object, matching `createWalletTopupCheckoutSession`'s existing convention.

**localStorage/sessionStorage:** none — this mechanism has no client-side UI surface.

## 7. Success Criteria (Acceptance Tests)

The first four tests below are directly exercised by live code in `tests/integration/
partner-sessions-api.test.ts` (read directly — `walletMaybeSingleMock`'s own comments confirm it exists
specifically to cover this mechanism's default-wallet-state and gate-check behavior; the file also covers
B2B-06's later, orthogonal funding guardrail in the same test suite). The remaining tests are derived
directly from the live code's own logic and are not yet independently unit-tested as of this
reconstruction (no dedicated `partner-trial-cutoff.test.ts` exists in the repo, confirmed by search) —
each is phrased so a QA engineer can verify it directly against the shipped behavior.

✓ **(live-tested)** Given a `test`-mode partner API key with no existing `partner_wallets` row for its
account, when `POST /api/partner/v1/sessions` is called with a valid body, then the trial-gate check
treats the account as having a fresh 20-minute allowance (`trial_minutes_used=0, test_minutes_balance=0`
default), `dispatchMeetingBot()` is called, and the response is `201` with `status: 'bot_active'`.

✓ **(live-tested)** Given a `test`-mode partner API key, when `POST /api/partner/v1/sessions` succeeds,
then the inserted `partner_sessions` row has `test_mode: true` (verified: `insertedRows[0]` matches
`{ test_mode: true }` in the live test suite).

✓ **(live-tested)** Given a `live`-mode request, when `POST /api/partner/v1/sessions` is processed, then
B2B-06's funding guardrail (a structurally separate code branch) is evaluated and B2B-08's trial-gate
branch is never reached — confirmed by the live test `'never evaluates the funding guardrail for a
test-mode request, regardless of wallet funding state'`, which is this same file's converse proof: a
`test`-mode request with an unfunded wallet (`stripe_default_payment_method_id` never set) still succeeds
with `201` and `dispatchMock` is called — proving the two gates are activation-condition-disjoint in both
directions.

✓ **(live-tested)** Given the meeting-bot vendor call fails during dispatch, when a `test`-mode session
attempts dispatch after passing the trial-gate check, then the response is still `201` with
`status: 'bot_dispatch_failed'` (never a `5xx`), and the `partner_sessions` row remains queryable —
proving the trial-gate mechanism does not change the pre-existing vendor-failure handling contract it
sits in front of.

✓ Given a `partner_wallets` row where `trial_minutes_used = 20` and `test_minutes_balance = 0` (allowance
fully exhausted, no purchased block), when `POST /api/partner/v1/sessions` is called with a `test`-mode
key, then `availableMinutes` computes to `0`, the response is `402` with
`error.code: 'trial_exhausted'`, the `partner_sessions` row is updated to `status: 'failed',
end_reason: 'trial_exhausted'`, and `dispatchMeetingBot()` is never invoked (verified by asserting no
outbound call to the meeting-bot provider occurred for this request — matches the same "no unfunded/
disallowed account can ever dispatch a real bot" falsifiability standard `B2B-06-requirement-document.md`
Section 7 uses for its own guardrail).

✓ Given a `partner_wallets` row where `trial_minutes_used = 20` and `test_minutes_balance = 120` (trial
exhausted, one block purchased), when `POST /api/partner/v1/sessions` is called, then `availableMinutes`
computes to `120`, dispatch proceeds, and the `clio/partner-trial.started` event carries
`availableMinutes: 120` — proving the allowance correctly draws from `test_minutes_balance` once the
lifetime trial portion is exhausted.

✓ Given a dispatched test-mode session with `availableMinutes: N`, when `N` minutes elapse without the
session ending normally, then `partnerTrialCutoffJob`'s `step.sleep` resolves, `getMeetingBotProvider().
deleteBot(providerBotId)` is called, `partner_sessions` is updated to `status: 'completed',
end_reason: 'trial_limit_reached'`, and `consume_trial_and_test_minutes` is called with exactly `N` (not
a re-measured actual duration) — the literal mechanism that bounds Clio's real cost exposure for a
test-mode session that runs past its allowance.

✓ Given a dispatched test-mode session that ends normally (via `POST /api/partner/render/end-session`)
before its allowance boundary, when `handleSessionEnd()` runs, then it emits `clio/partner-trial.ended`
for the session's `clioSessionRef`, which cancels the pending `partnerTrialCutoffJob` (via its `cancelOn`
config) — proving a normally-ended test session never triggers a redundant forced cutoff.

✓ Given a normally-ended test-mode session with `durationMinutes: 8`, when `handleSessionEnd()` runs,
then `recordBillableEvent()` for `usage.voice_minute` is called with `testMode: true,
isMeteredTestUsage: true` (not the pre-fix default of `testMode: false` — the in-scope adjacent fix,
Section 4.C), and `consume_trial_and_test_minutes` is called with the actual `8`, not any other figure.

✓ Given any `usage_events` row produced by either the forced-cutoff path or a normal test-mode session
end, when the row is inspected, then `test_mode = true` (unchanged meaning, never billed to the partner)
and `is_metered_test_usage = true` (the new, additive, Clio-internal-only signal that this specific event
incurred real vendor cost) — both flags present simultaneously, neither reinterpreting the other.

✓ Given a completed Stripe Checkout session with `metadata.purpose = 'test_block_purchase'` and
`metadata.partner_account_id` set, when the `checkout.session.completed` webhook is processed, then
`credit_test_minutes_balance` is called with `p_minutes: 120`, exactly one `wallet_ledger` row is inserted
with `entry_type: 'test_block_purchase', delta_usd: 1.80`, and `partner_wallets.balance_usd` is
unchanged — proving test-block spend never touches the production wallet balance the admin page's
real-revenue reporting depends on.

✓ Given the same Checkout session's webhook is redelivered (Stripe's own at-least-once delivery
guarantee), when `POST /api/webhooks/stripe` processes it a second time, then
`walletLedgerAlreadyRecorded(session.id, 'test_block_purchase')` returns `true` and no second
`test_minutes_balance` credit or `wallet_ledger` row is created — idempotent, matching every other Stripe
webhook branch's existing discipline.

## 8. Error States

| Failure | User-visible behavior | Clio-side behavior |
|---|---|---|
| `POST /api/partner/v1/sessions`, `test`-mode, allowance exhausted (`availableMinutes <= 0`) | `402 { error: { code: 'trial_exhausted', message: 'Free testing allowance used. Purchase a 2-hour test block to continue.' } }` | `partner_sessions.status='failed', end_reason='trial_exhausted'`; `dispatchMeetingBot()` never called, zero vendor cost incurred |
| `POST /api/partner/v1/sessions`, `test`-mode, `partner_wallets` read fails (transient DB error) | Not explicitly special-cased in the live code — `wallet` resolves to whatever the query returns on error, and a `null`/failed read is treated identically to "no row" (fresh 20-minute allowance) | Fails **open** on this specific read (the inverse of B2B-06's own funding-guardrail read, which fails closed) — an ambiguous read here defaults to granting the smallest possible allowance (a fresh trial), not to blocking dispatch; a narrow, accepted asymmetry versus B2B-06's own stricter failure mode, since this mechanism's stakes (bounded, capped trial minutes) are lower than an unbounded live-mode dispatch |
| `partnerTrialCutoffJob`'s `getMeetingBotProvider().deleteBot()` call fails | N/A (server-side) | Logged, non-fatal — the session is still marked `completed`/`trial_limit_reached` and minutes are still consumed regardless of whether the vendor's own leave call succeeded; the bot may remain connected briefly if the vendor call itself failed, an accepted residual risk (see architecture.md §15.5's own named risk-acceptance note) |
| `clio/partner-trial.started` event fails to send (fire-and-forget `.catch()`) | N/A | Logged only; the cutoff job never runs for this session — accepted residual risk, explicitly named in `architecture.md` §15.5 as mirroring the identical, already-accepted risk shape `session-timer.ts` carries for the legacy session flow. No secondary watchdog exists for this specific gap. |
| `checkout.session.completed` for `test_block_purchase` missing `partner_account_id` in metadata | N/A (Stripe-to-Clio call) | Logged (`console.warn`), no DB write, `break` — matches the existing `wallet_topup` branch's own missing-metadata handling exactly |
| `credit_test_minutes_balance` RPC fails | N/A | Logged (`console.error`), no `wallet_ledger` row written, `break` — the Checkout session's payment succeeded but the credit did not land; no automatic retry beyond Stripe's own webhook redelivery (which will re-attempt the same idempotency-checked branch) |
| `POST /api/admin/billing/test-block` — **route does not exist** | N/A — no live endpoint to call; a request to this path returns Next.js's standard 404 | See Verification Note — this is the one confirmed gap in this reconstruction, not a designed error state |

## 9. Edge Cases

- **A brand-new self-serve or manually-provisioned partner account with no `partner_wallets` row at all,
  making its first-ever `test`-mode session request**: fully supported — treated identically to an
  account with an existing row showing `trial_minutes_used=0, test_minutes_balance=0`, i.e. a fresh
  20-minute allowance (Section 4.A step 1, confirmed by direct code read of the `.maybeSingle()` +
  `wallet ? Number(...) : 0` fallback pattern).
- **A test-mode session that is dispatched, then the account's trial is separately exhausted by a
  *different*, concurrent session before this one's cutoff timer fires**: not specially handled — each
  session's cutoff job operates on its own `availableMinutes` figure captured at its own dispatch time;
  two concurrent test-mode sessions from the same account could together consume more than 20 minutes of
  trial allowance in the same wall-clock window before either cutoff fires, since the gate check at
  dispatch time only reads the wallet state as of that moment, not a live, cross-session-aware lock. This
  is a narrow, accepted timing gap (concurrent test-mode sessions are not the primary use case Arun
  described), not a defect this document claims to solve.
- **A session hits its cutoff exactly as it would have ended normally anyway (a natural end and the forced
  cutoff racing)**: `cancelOn` (keyed on `data.clioSessionRef`) and the job's own `check-session-status`
  re-read together make this race-safe — whichever of "normal end" or "forced cutoff" lands first wins;
  the other becomes a no-op (either `cancelOn` prevents the job from running at all, or its own status
  check catches an already-`completed`/`failed` row).
- **A partner never purchases a test block and simply stops testing once the trial is exhausted**: fully
  supported, the expected/default outcome — `trial_exhausted` is a terminal, permanent state for that
  account's free allowance (never resets); nothing in this mechanism nudges or forces a purchase.
- **Historical test-mode usage from before this mechanism existed**: explicitly out of scope
  (Section 10) — forward-only from this mechanism's launch, matching an existing declined-backfill
  precedent elsewhere in the billing system; no investigation or backfill into prior unmetered sessions.
- **Interaction with B2B-06's later funding guardrail**: confirmed orthogonal by activation condition,
  by direct code read of the same route file — this document's gate fires only inside
  `if (auth.mode === 'test')` (lines 82–133); B2B-06's guardrail fires only in the `auth.mode === 'live'`
  branch that begins immediately after (line 135 onward). Neither branch is reachable from the other's
  activation condition. One deliberate positive interaction, not a dependency: the (not-yet-live)
  test-block Checkout session uses `setup_future_usage: 'off_session'`, so a partner's first block
  purchase would also likely be the first time they attach a payment method — incidentally satisfying
  B2B-06's separate `stripe_default_payment_method_id` check for that account's later live-mode usage.

## 10. Out of Scope

- **Any Clio-rendered UI screen for this mechanism.** No partner-facing balance/allowance display, no
  Configurator screen for initiating a test-block purchase — the only partner-visible signal is the
  `402 trial_exhausted` error body itself (Section 5.A). A Configurator-side UI is a real follow-on gap,
  explicitly named for B2B-03 to pick up with its own spec, not built here.
- **`GET /api/partner/v1/wallet` extension.** Deliberately not extended with `trial_minutes_used`/
  `test_minutes_balance` fields — no partner-facing API surface for viewing trial/test-block state exists
  in this mechanism.
- **A graceful pre-cutoff warning to the partner's own integration.** The forced cutoff is a clean,
  unannounced bot-leave at the exact allowance boundary — no webhook, no warning event, no grace period.
- **A secondary watchdog for a failed or never-sent `clio/partner-trial.started` event.** Named explicitly
  as an accepted residual risk (Section 8), not built — mirrors the identical, already-accepted risk shape
  `session-timer.ts` carries for the legacy session flow.
- **Retroactive accounting for historical unmetered test-mode usage** predating this mechanism.
  Forward-only from launch.
- **The separate Attendee inbound-webhook signature bypass.** A real, pre-existing security gap, unrelated
  to testing/metering, tracked and fixed separately.
- **Any change to `test_mode`'s existing meaning.** It still means, everywhere it is already relied upon,
  "never billed to the partner, permanently." `is_metered_test_usage` is purely additive.
- **Any change to `balance_usd`, `billing_rate_versions`, or any of B2B-04's three existing production
  funding paths (top-up Checkout, mid-market auto-recharge, enterprise invoicing).** Untouched.
- **B2B-06's live-mode funding guardrail.** A separate, later, orthogonal mechanism — not built, modified,
  or duplicated by this document.
- **Wiring `POST /api/admin/billing/test-block`.** Per the Verification Note, this is not "out of scope"
  in the sense of a deliberate product exclusion — it is a confirmed, outstanding implementation gap
  against an already-fully-specified contract (Section 4.D), listed here for clarity that this document
  does not itself close it, and in Section 12 as an outstanding dependency.

## 11. Open Questions

None.

The Verification Note at the top of this document names one confirmed implementation gap (the missing
`POST /api/admin/billing/test-block` route) — this is not a product ambiguity requiring Arun's input, so
it does not belong in this section; it is a mechanical wiring task against a contract this document (and
the underlying, already-implemented `createTestBlockCheckoutSession()` function) fully determines. All
six items the CEO brief posed to the BA were resolved as CEO/BA-level technical judgment calls with
recorded reasoning (Section 2 stories, Section 4, Section 6), not escalated, and every resolution matches
what the live schema, RPCs, gate logic, and Inngest job actually do.

## 12. Dependencies

- **B2B-02** (done) — `partner_accounts`, `partner_sessions`, `usage_events`, `requirePartnerApiKey()`
  (`lib/partner/auth.ts`) — this document extends `usage_events`/`partner_sessions` additively and reuses
  the auth mechanism unmodified.
- **B2B-04** (done) — `partner_wallets`, `wallet_ledger`, `credit_wallet_balance`/`decrement_wallet_balance`
  RPCs (the exact atomic lazy-create pattern this document's two new RPCs mirror),
  `applyWalletDecrement()`'s existing `test_mode` skip (read, not modified) — this document is a schema
  and mechanism dependency of B2B-04, extending it additively, not rebuilding it.
- **`lib/meeting-bot/provider.ts` / `lib/meeting-bot/attendee.ts`** (done, pre-existing) — the vendor-
  agnostic `deleteBot()` interface the cutoff job calls; no new vendor call was added.
- **`inngest/session-timer.ts`** (done, pre-existing) — the structural precedent
  `partner-trial-cutoff.ts` is modeled on (sleep-then-force-end pattern, `cancelOn` usage), not a runtime
  dependency.
- **What this document unblocks**: B2B-06's own funding guardrail (built after this document, confirmed
  orthogonal to it by activation condition) and B2B-07's Developer Portal Playground (whose sessions-
  endpoint "Send" button was explicitly gated on this document resolving the previously-unbounded
  `test`-mode dispatch gap, per `docs/b2b-pivot-status.md`'s own B2B-07 row).
- **Outstanding, not yet shipped**: `POST /api/admin/billing/test-block` (Section 4.D, Verification
  Note) — the route file itself, following the exact `requirePartnerAdmin()` + Zod-validated-body pattern
  every sibling `/api/admin/billing/*` route already uses, calling the already-implemented,
  already-correct `createTestBlockCheckoutSession()`. No design work remains; this is implementation only.
