# Expose Free-Trial / Test-Minutes Balance on the Partner Wallet API — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-30

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code, every load-bearing claim in
the CEO brief
(`.claude/agents/clio/feature-briefs/B2B-55-wallet-trial-test-minutes-visibility.md`) was re-checked
directly against source, not assumed:

- **`GET /api/partner/v1/wallet`** (`app/api/partner/v1/wallet/route.ts`) — confirmed: reads one
  `partner_wallets` row via `.maybeSingle()` (lines 58-62, columns `balance_usd,
  reference_topup_amount_usd, low_balance_alert_fired_at, next_billing_date, created_at, updated_at` —
  **`trial_minutes_used`/`test_minutes_balance` are not in this select list today**), computes burn
  rate/projection, and returns a flat JSON object (lines 101-111). Auth: `requirePartnerApiKey(request,
  'reads')` (line 53), same rate-limit class as `GET /api/partner/v1/usage` per the file's own header
  comment.
- **Source columns**, confirmed by direct read of `supabase/migrations/077_b2b08_testing_metering.sql`:
  - `partner_wallets.trial_minutes_used NUMERIC(10,2) NOT NULL DEFAULT 0` (line 22), `CHECK
    (trial_minutes_used >= 0)` (lines 23-25) — no upper-bound `CHECK`, confirming the CEO brief's claim
    that the 20-minute cap is enforced only inside the RPC, not the schema.
  - `partner_wallets.test_minutes_balance NUMERIC(10,2) NOT NULL DEFAULT 0` (line 27), same
    non-negative-only `CHECK` (lines 28-30).
  - `consume_trial_and_test_minutes(p_partner_account_id, p_minutes)` RPC (lines 66-87): the literal
    `20.00` appears twice inside the `UPDATE` statement (lines 76, 77, 81) — confirmed the only place in
    the entire codebase that actually enforces the cap. Column comments (lines 89-90) independently
    confirm the same semantics the CEO brief states: `trial_minutes_used` is "lifetime, once-ever...
    Never reset"; `test_minutes_balance` is "purchased 2-hour-test-block minutes remaining, structurally
    separate from `balance_usd`."
  - `credit_test_minutes_balance(p_partner_account_id, p_minutes)` RPC (lines 52-64) — confirmed this is
    how `test_minutes_balance` is funded (a purchase), lazy-creating the wallet row on first credit via
    `ON CONFLICT (partner_account_id) DO UPDATE`.
- **The bare-literal-20 risk, confirmed independently found in a second location**: `app/api/partner/v1/
  sessions/route.ts` line 297: `const availableMinutes = Math.max(0, 20 - trialMinutesUsed) +
  testMinutesBalance` — a second, unrelated hardcoded `20` in TypeScript, doing the exact same
  "remaining = cap − used" computation this brief needs to expose. Confirmed: **zero existing shared
  constant** for this value anywhere in `lib/` today (checked `lib/billing/*.ts` and `lib/partner/*.ts`
  file listings — no `trial-minutes`-named file or exported constant exists). This directly confirms the
  CEO brief's flagged risk and resolves BA Question 2 below.
- **The trial-vs-demo-minutes conflation question — resolved with certainty, two genuinely separate
  pools, not one pool under two names.** Confirmed by direct read of both mechanisms:
  - **B2B-08 trial/test pool** (`trial_minutes_used`/`test_minutes_balance`, migration 077): consumed by
    `consume_trial_and_test_minutes()`, gated in `POST /api/partner/v1/sessions` at line 266 by `if
    (auth.mode === 'test')` — i.e. triggered by which **API key mode** (`clio_test_sk_...` vs
    `clio_live_sk_...`) was used to call the real, external partner API, **not** by `account_kind`. This
    check runs unconditionally for any `partner_accounts` row calling with a test-mode key, confirming
    the CEO brief's scope-verification flag: this is a live, real mechanism that applies to any real
    reseller, not only internal/demo accounts. A card-on-file check (`stripe_default_payment_method_id`,
    lines 273-293, B2B-27) is a separate, independent prerequisite checked *before* the trial-minutes
    math — noted in §9 below since it affects how a reseller should interpret a nonzero
    `trial_minutes_remaining`.
  - **B2B-39 demo pool** (`demo_minutes_balance`, migration `100_b2b39_demo_passcodes_and_billing.sql`,
    confirmed by grep: separate column, line 63; separate RPCs `credit_demo_minutes_balance`/
    `consume_demo_minutes`, lines 84-118; separate `resulting_demo_minutes_balance` ledger column, line
    155). Confirmed by direct read of `lib/partner/signup.ts` lines 120-138: `credit_demo_minutes_balance`
    is called **only** inside the `if (resolvedAccountKind === 'channel_partner')` branch (line 103) of
    `createOrClaimPartnerAccount()`, granting exactly 20 minutes once, automatically, at signup, for the
    internal passcode-gated demo/showcase tool (per this project's memory note on B2B-31: "private
    demo/API-integration-test tool"). This is a completely different column, different RPC pair,
    different gating route (`/api/channel-partner/demo-access`, confirmed untouched by this brief), and
    different consumer (an internal Clio tool, not a reseller's own external API traffic).
  - **Verdict**: Arun's quote ("out of my free 20 minutes how many i consumed, if i paid for minutes
    then how much i consumed now from that pool") reads as, and is confirmed by code to be, the **B2B-08
    real-reseller trial/test-block mechanism** — the one actually exercised by a reseller's own API
    traffic through `POST /api/partner/v1/sessions`. The B2B-39 demo pool is out of scope, per the CEO
    brief's explicit instruction, and this document does not touch `demo_minutes_balance`,
    `credit_demo_minutes_balance`, `consume_demo_minutes`, `/api/channel-partner/demo-access`, or
    `/api/admin/demo-access` anywhere.
- **Docs impact, confirmed by direct read**: `app/(with-clerk)/dashboard/configurator/api/content.ts`
  lines 126-149 defines the `wallet` endpoint doc entry (`exampleResponse`, `responseNotes`) consumed by
  `app/(with-clerk)/dashboard/configurator/docs/DocsClient.tsx`'s "Billing explained" prose section
  (anchor `#billing`, lines 436-500). Confirmed: today's prose (lines 440-499) covers only `balance_usd`
  funding/burn-rate/payment-problems — zero mention of trial or test minutes anywhere in either file.
  Confirmed existing terminology to reuse for consistency: `content.ts` line 67 already describes the
  `sessions` endpoint's `402` response as `'trial_exhausted (test-mode keys only, once the free
  20-minute allowance is used up)'` — this document's new docs copy reuses "test-mode keys" and "free
  20-minute allowance" verbatim rather than inventing new phrasing for the same concept.
- **No existing test file for this route**: confirmed by search — `tests/**/*wallet*` matches nothing.
  The closest established convention is `tests/integration/partner-usage-api.test.ts` (mocks
  `@/lib/partner/auth`'s `requirePartnerApiKey` and `@/lib/supabase`'s `createSupabaseAdminClient`,
  constructs a chainable/thenable Postgrest query-builder mock, imports the route's `GET` directly and
  calls it with a `NextRequest`) — §13 follows this exact pattern.

All CEO brief claims held up under independent re-verification. No corrections needed.

## 1. Purpose

`GET /api/partner/v1/wallet` already answers "how much of my prepaid USD balance is left, and how fast
am I burning it" — but a reseller currently has no API-visible way to answer the parallel question for
their **free trial allowance and purchased test-block minutes**: "how much of my free 20-minute trial
have I used, and how much paid test-block time do I have left." That data already exists on
`partner_wallets` (`trial_minutes_used`, `test_minutes_balance`, migration 077) and already gates real
API behavior (`POST /api/partner/v1/sessions` returns `402 trial_exhausted` once it runs out) — but is
completely invisible to the reseller until they hit that 402. This is the exact gap Arun described.

Failure without this: a reseller integrating against the test-mode API has no way to proactively check
their remaining trial/test allowance before dispatching a session — they only discover it's exhausted
when a real dispatch call fails with `402`, and even then the error response carries no numeric
breakdown of what was consumed or what remains.

## 2. User Story

As **a reseller (partner_accounts, any account_kind) calling the Clio API with a test-mode API key**,
I want to see, in the same wallet response I already use to check my production balance, exactly how
many of my free trial minutes I've used, how many remain, and how many purchased test-block minutes I
have left,
so that I can plan my testing/integration work without guessing, and know in advance (rather than
discovering via a failed dispatch) whether I need to purchase a test block to keep testing.

As **Arun**,
I want this addition to be purely additive to an endpoint that already owns balance/consumption
reporting, using the exact same source-of-truth RPC-enforced cap the real dispatch gate already uses, so
that the number a reseller sees here can never drift from the number that actually governs whether their
next test dispatch succeeds.

## 3. Trigger / Entry Point

No new route, no new trigger. Same entry point as today: `GET /api/partner/v1/wallet`, authenticated via
`requirePartnerApiKey(request, 'reads')` (unchanged — no new auth logic, no new rate-limit class; reuses
the existing `'reads'` class). Any partner account with a valid API key (test or live mode — this field
set is returned regardless of which mode key was used to call `/wallet` itself, since it reports the
account's own state, not a per-request mode) can call this today; behavior is unchanged.

## 4. Screen / Flow Description

No screen/flow change — this is a pure API response addition, not a UI feature. Per the dispatch
instruction, no dashboard/admin page is touched. The only "flow" affected is: a reseller's own external
code calling `GET /api/partner/v1/wallet` now receives 4 additional JSON fields in the response body
(§6), and the public developer docs page describing this endpoint (`/dashboard/configurator/docs`,
`#billing` anchor) gains one new explanatory subsection (§6.4).

## 5. Visual Examples

Not applicable — no UI/visual surface. Per `CLAUDE.md`'s standing responsive-by-default rule: this
change touches zero `.tsx` layout/markup with visual/interactive surface (the one `.tsx` file touched,
`DocsClient.tsx`, only gains additional text content inside an already-existing, already-responsive
`Card`/prose block using the file's own existing style constants — no new layout structure), so it does
not trigger that rule's "any future work that touches a screen" obligation.

## 6. Data Requirements

### 6.1 New shared constant (resolves BA Question 2 — the CEO brief's tradeoff, decided)

**Decision: create a shared constant, not a second hardcoded literal.**

New file: `lib/billing/trial-minutes.ts`

```ts
/**
 * B2B-55 (docs/specs/B2B-55-requirement-document.md §6.1) — single TypeScript source of truth for
 * the free-trial-minutes lifetime cap.
 *
 * IMPORTANT: this constant does NOT enforce the cap. The actual enforcement authority is the
 * `consume_trial_and_test_minutes()` Postgres RPC (supabase/migrations/077_b2b08_testing_metering.sql,
 * `LEAST(20.00, ...)`, appears twice in that function body) — a Postgres function body cannot import a
 * TypeScript constant. If the cap ever changes, BOTH the RPC's two `20.00` literals AND this constant
 * must be updated together in the same change; this constant exists only to give every TypeScript call
 * site (currently: the /sessions trial gate and the /wallet reporting endpoint) one shared value instead
 * of two independently-drifting literals, which is the smaller, real risk this brief was asked to close.
 */
export const TRIAL_MINUTES_LIFETIME_CAP = 20
```

Rationale for creating the constant over a hardcode-with-comment: the CEO brief itself already found a
**second** pre-existing hardcoded `20` in TypeScript (`app/api/partner/v1/sessions/route.ts` line 297,
confirmed §0) before this brief added a third call site. Two independent TS call sites computing the
same "cap − used" value is exactly the silent-drift risk described in the dispatch instruction — a
comment-only approach would still leave two numbers to keep in sync by hand at every future change. A
one-line constant costs nothing and removes that risk entirely for the TypeScript layer (the DB-RPC side
remains a manual-sync concern regardless of approach, since RPCs cannot import TS — documented in the
constant's own comment above so a future cap change is not silently incomplete).

**In-scope, minimal refactor**: `app/api/partner/v1/sessions/route.ts` line 297 changes from
`const availableMinutes = Math.max(0, 20 - trialMinutesUsed) + testMinutesBalance` to
`const availableMinutes = Math.max(0, TRIAL_MINUTES_LIFETIME_CAP - trialMinutesUsed) + testMinutesBalance`
(plus the corresponding import). **This is a value-neutral substitution — `TRIAL_MINUTES_LIFETIME_CAP`
equals `20`, so this changes zero runtime behavior.** It is included because leaving that call site as a
bare literal while introducing a shared constant next to it would recreate the exact two-place-drift risk
this section exists to close. Nothing else in `sessions/route.ts` changes — no other line, no other
logic, no schema, no new write path.

### 6.2 New response fields on `GET /api/partner/v1/wallet`

Four new top-level fields, inserted after `low_balance_alert_active` and before `burn_rate_by_event_type`
in the response body (placement rationale: these are balance-shape scalars like the three fields above
them, not burn-rate/projection data like the fields below them):

| Field | Type | Source | Computation |
|---|---|---|---|
| `trial_minutes_used` | `number` | `partner_wallets.trial_minutes_used` | Direct column read: `wallet?.trial_minutes_used != null ? Number(wallet.trial_minutes_used) : 0` — same null-safe pattern this file already uses for `balance_usd` (line 64). |
| `trial_minutes_remaining` | `number` | Derived | `Math.max(0, TRIAL_MINUTES_LIFETIME_CAP - trial_minutes_used)` — same formula as `sessions/route.ts` line 297's trial component, now sharing the constant from §6.1. |
| `trial_minutes_cap` | `number` | `TRIAL_MINUTES_LIFETIME_CAP` (§6.1) | Constant, not a DB read. **Added beyond the CEO brief's 3 recommended fields** (justification below). |
| `test_minutes_balance` | `number` | `partner_wallets.test_minutes_balance` | Direct column read, same null-safe pattern: `wallet?.test_minutes_balance != null ? Number(wallet.test_minutes_balance) : 0`. |

**Why `trial_minutes_cap` is added beyond the CEO brief's recommendation**: the CEO brief recommended
only `trial_minutes_used`/`trial_minutes_remaining`/`test_minutes_balance`. Adding `trial_minutes_cap`
directly extends the same anti-drift principle from §6.1 outward to API consumers: without it, a
reseller building their own dashboard against this endpoint would have to hardcode `20` on *their* side
to show "X of 20 used" — recreating, one layer further out, the exact bare-literal risk this brief exists
to close on Clio's own side. Exposing the cap as a field means a future cap change requires zero
reseller-side code change to stay accurate. This is a response-shape decision explicitly left to BA's
judgment by the CEO brief ("not final, BA's call"), stays purely additive, and required no additional
data source (same constant from §6.1).

Required select-list change in `app/api/partner/v1/wallet/route.ts` line 60: add
`trial_minutes_used, test_minutes_balance` to the existing `.select(...)` column list (currently
`'balance_usd, reference_topup_amount_usd, low_balance_alert_fired_at, next_billing_date, created_at,
updated_at'`). No other query changes — same table, same `.eq('partner_account_id',
auth.partnerAccountId).maybeSingle()` filter (already scopes to the caller's own account only, satisfying
the "never any field derived from another partner's data" convention with no new code needed).

### 6.3 Edge case: no wallet row / never-trialed account

Per `.maybeSingle()` (route.ts line 58-62), `wallet` is `null` for a `partner_account_id` with no
`partner_wallets` row at all — this happens for any account that has never had `credit_wallet_balance`,
`credit_test_minutes_balance`, or `consume_trial_and_test_minutes` run against it (all three lazy-create
the row on first call; confirmed via `ON CONFLICT (partner_account_id) DO ...` in migration 077 §0).

**Decision: default to `0`, not `null`, for both `trial_minutes_used` and `test_minutes_balance` — same
convention already established by this exact file for `balance_usd` (line 64).** This makes
`trial_minutes_remaining` correctly resolve to the full `trial_minutes_cap` (20) for a never-trialed
account — which is the accurate answer: they have not used any of their allowance yet, so all of it is
available. This requires no special-case branching beyond the existing null-safe `Number(...)` pattern
already used for every other numeric field in this response.

This also covers the CEO brief's other named scenario — a reseller who signed up before this mechanism
existed, or whose grant path failed non-blockingly — identically: a `partner_wallets` row that exists but
was created only by, say, a live-mode `credit_wallet_balance` call (never touching the trial columns)
still has `trial_minutes_used = 0`/`test_minutes_balance = 0` by the columns' own `NOT NULL DEFAULT 0`
(migration 077 §0), so the same `Number(...)` read returns `0` either way — no `wallet === null` vs.
`wallet.trial_minutes_used === null` distinction to handle. **Note**: unlike the B2B-39 demo-minutes
mechanism, there is no "grant" step for the B2B-08 trial mechanism to fail at signup — `trial_minutes_used`
starts at `0` by column default for every account from creation, so there is no non-blocking-grant-failure
edge case analogous to `credit_demo_minutes_balance`'s try/catch in `lib/partner/signup.ts` to account for
here.

### 6.4 Existing fields: no adjustment needed

Purely additive — confirmed by migration 077's own header comment (§0): "Does NOT touch `balance_usd`...
structurally separate from the production wallet balance." No existing field (`balance_usd`,
`reference_topup_amount_usd`, `low_balance_alert_active`, `burn_rate_by_event_type`,
`avg_daily_burn_usd`, `projected_days_remaining`, `days_remaining_null_reason`, `next_billing_date`,
`updated_at`) changes type, meaning, or computation as a result of this change.

### 6.5 Docs update (ships in the same change, per CEO brief recommendation)

Two files, both confirmed read in §0:

**`app/(with-clerk)/dashboard/configurator/api/content.ts`** — the `wallet` endpoint entry (currently
lines 126-149):
- `exampleResponse` gains the 4 new fields at the same position specified in §6.2, with realistic example
  values: `trial_minutes_used: 6.5, trial_minutes_remaining: 13.5, trial_minutes_cap: 20,
  test_minutes_balance: 0` (illustrates a partially-used trial with no test block purchased yet — the
  most common real state for an actively-testing reseller).
- `responseNotes` gains one new line: `'trial_minutes_used/trial_minutes_remaining/test_minutes_balance
  are test-mode-only concepts (they gate POST /api/partner/v1/sessions when called with a test-mode API
  key) but are always present in this response regardless of which key mode you call /wallet with —
  they simply read 0 used / full cap remaining for an account that has never dispatched a test-mode
  session.'`

**`app/(with-clerk)/dashboard/configurator/docs/DocsClient.tsx`** — new subsection inserted inside the
existing "Billing explained" `Card` (id="billing", lines 436-500), positioned after the existing "What a
metered event costs" subsection (currently ending line 485) and before "Payment problems & low balance"
(currently starting line 487) — trial/test-block testing is conceptually a distinct topic from
live-metered billing, but belongs in the same card since it's the same `#billing` anchor and same
endpoint. New subsection, using this file's existing `subHeadingStyle`/`bodyStyle`/`monoInline`
constants (same pattern as every other subsection in this card — no new styles introduced):

```
Subheading: "Free trial & test minutes"
Body: "Every partner account gets a one-time, lifetime 20-minute free trial allowance for sessions
dispatched with a test-mode API key — separate from, and never drawn from, your production wallet
balance above. Once the trial allowance is used up, you can purchase a 2-hour test block to keep
testing. Both are reported on this same endpoint: trial_minutes_used, trial_minutes_remaining,
trial_minutes_cap, and test_minutes_balance. This only governs test-mode key traffic — it has no effect
on live-mode sessions or your production balance."
```

(Exact copy is illustrative — final wording at implementation time should stay within this scope: two
short paragraphs, reusing "test-mode keys" and "free 20-minute allowance" terminology already established
in `content.ts` line 67, per §0.)

## 7. Success Criteria (Acceptance Tests)

✓ AT-1: Given a `partner_wallets` row exists for the calling account with `trial_minutes_used = 6.5` and
`test_minutes_balance = 0`, when `GET /api/partner/v1/wallet` is called with a valid API key, then the
response includes `trial_minutes_used: 6.5`, `trial_minutes_remaining: 13.5`, `trial_minutes_cap: 20`,
and `test_minutes_balance: 0`.

✓ AT-2: Given a `partner_wallets` row exists with `trial_minutes_used = 20` (fully exhausted) and
`test_minutes_balance = 45.25`, when the endpoint is called, then `trial_minutes_remaining: 0` (never
negative) and `test_minutes_balance: 45.25`.

✓ AT-3: Given no `partner_wallets` row exists at all for the calling account (`.maybeSingle()` returns
`null`), when the endpoint is called, then the response includes `trial_minutes_used: 0`,
`trial_minutes_remaining: 20`, `trial_minutes_cap: 20`, `test_minutes_balance: 0` — same null-safe
defaulting the endpoint already applies to `balance_usd` today.

✓ AT-4: Given auth fails (`requirePartnerApiKey` returns an error), when the endpoint is called, then the
auth error response is returned unchanged and `partner_wallets` is never queried — confirming no new auth
path was introduced (existing behavior, re-asserted after this change).

✓ AT-5: Given a valid request, when the response is inspected, then every existing field
(`balance_usd`, `reference_topup_amount_usd`, `low_balance_alert_active`, `burn_rate_by_event_type`,
`avg_daily_burn_usd`, `projected_days_remaining`, `days_remaining_null_reason`, `next_billing_date`,
`updated_at`) is present with unchanged computation — confirming this change is purely additive.

✓ AT-6: Given `lib/billing/trial-minutes.ts`'s `TRIAL_MINUTES_LIFETIME_CAP`, when
`app/api/partner/v1/sessions/route.ts`'s trial-gate logic (line ~297) is inspected, then it imports and
uses the same constant instead of a bare `20` literal, and its computed `availableMinutes` value for a
given `trialMinutesUsed`/`testMinutesBalance` pair is unchanged from before this refactor (same test
inputs/outputs as any existing coverage of that gate) — confirming the §6.1 refactor is behavior-neutral.

✓ AT-7: Given `trial_minutes_used` and `test_minutes_balance` are added to the wallet route's Supabase
`.select(...)` call, when the query is inspected, then it still filters on
`.eq('partner_account_id', auth.partnerAccountId)` only — confirming no cross-partner data exposure was
introduced.

## 8. Error States

No new error states. This change adds fields to an existing `200` response only — it does not add any
new failure mode. The existing "no explicit 4xx handling beyond auth — a DB read failure surfaces as a
generic, unstructured 500" behavior (already documented in `content.ts` line 145) is unchanged: a
`partner_wallets` select failure today already silently falls through to `wallet == null` (the code
doesn't check `error` on that query at all, confirmed at route.ts lines 58-62) and returns defaults, not
a 500 — this is pre-existing behavior, not something this change alters or should alter (out of scope:
hardening that query's error handling is unrelated to this brief).

## 9. Edge Cases

- **Never-trialed account** — §6.3, AT-3.
- **Fully exhausted trial, no test block purchased** — `trial_minutes_remaining: 0`,
  `test_minutes_balance: 0`; a reseller reading this response can tell they need to purchase a test
  block, matching the `402 trial_exhausted` they'd get from `POST /sessions` (AT-2's exhausted-trial
  half).
- **Nonzero `trial_minutes_remaining` but no card on file** — confirmed (§0) the `sessions` route checks
  `stripe_default_payment_method_id` *before* the trial-minutes math (lines 273-293) and returns
  `402 card_required` regardless of remaining allowance. A reseller could see `trial_minutes_remaining:
  20` on `/wallet` and still get `402 card_required` on their next `/sessions` call — this is existing,
  unchanged behavior (B2B-27), not something this brief resolves, but worth noting precisely so nobody
  mistakes a nonzero `trial_minutes_remaining` as a guarantee the next test dispatch will succeed. No
  spec change follows from this — it is a pre-existing, independent gate this brief does not touch or
  need to surface as a new field (out of scope: `stripe_default_payment_method_id` presence is not part
  of this brief's requested fields).
- **Fractional minutes** (e.g. `trial_minutes_used: 6.5`) — `NUMERIC(10,2)` columns can hold non-integer
  values (a session that ran 6.5 minutes); `Number(...)` conversion preserves the decimal, matching how
  `balance_usd` already handles fractional USD amounts today.
- **Account with `test_minutes_balance` but zero `trial_minutes_used`** — a reseller who purchased a test
  block without ever dispatching a trial-covered session; both fields report independently and
  correctly with no interaction (`trial_minutes_remaining: 20`, `test_minutes_balance: <purchased
  amount>`) since the two pools are structurally independent columns.
- **Calling `/wallet` with a live-mode API key** — the endpoint doesn't branch on key mode at all today
  (confirmed: `auth.mode` is never read in `route.ts`), so trial/test fields are returned identically
  regardless of which mode key was used to call `/wallet` itself — only `POST /sessions`'s *gating*
  behavior is mode-conditional (§0), not this reporting endpoint. Documented explicitly in the new
  `responseNotes` line (§6.5) to avoid a reseller assuming these fields are test-mode-key-only to *read*.
- **Mobile vs. desktop** — not applicable; pure API response, no UI surface (§5).

## 10. Out of Scope

- **The B2B-39 demo-minutes mechanism** (`demo_minutes_balance`, `credit_demo_minutes_balance`,
  `consume_demo_minutes`, `/api/channel-partner/demo-access`, `/api/admin/demo-access`) — confirmed
  genuinely separate (§0), untouched by this brief, per the CEO brief's explicit exclusion.
  `lib/partner/signup.ts` is not modified by this brief (its demo-minutes grant block, lines 120-138, is
  read-only reference material for §0's investigation, not an edit target).
- **A combined "total testing minutes remaining" field** (trial + test-block summed into one number) —
  considered and rejected: Arun's own quote asks for each pool separately ("how many i consumed, **if i
  paid for minutes** then how much... from that pool" — explicitly distinguishing the two), and
  `sessions/route.ts`'s internal `availableMinutes` sum (§0) is gating logic, not necessarily a fact a
  reseller needs pre-summed for them. A reseller can trivially sum the two exposed fields themselves if
  they want a combined figure.
- **Exposing `stripe_default_payment_method_id` presence or the `card_required` gate as a new field** —
  a real, independent prerequisite (§9) but not part of what Arun asked for or what the CEO brief scoped;
  would be a separate, distinct feature addition.
- **Any change to `POST /api/partner/v1/sessions`'s actual gating behavior, response codes, or error
  bodies** — the only change to that file is the value-neutral constant substitution at line 297 (§6.1,
  AT-6); the 402 `trial_exhausted`/`card_required` logic, status codes, and error message shapes are
  byte-for-byte unchanged.
- **Any change to `wallet_ledger`, `resulting_test_minutes_balance`, or exposing test-block purchase
  history** — only the current-balance columns are surfaced, not ledger/history rows; no new query
  against `wallet_ledger` is introduced.
- **`lib/partner/live-render.ts`'s `isFirstPartyDemoPageUrl()`/`resolveInlineSessionRender()` and
  `PartnerRenderClient.tsx`'s `sourceUrl` iframe branch** — confirmed nowhere near any file this brief
  touches, per the dispatch instruction's explicit protection.
- **New write paths, new schema, new migration** — migration 077 is already applied and live; this brief
  reads existing columns only.
- **New rate-limit class or new auth logic** — reuses the existing `requirePartnerApiKey(request,
  'reads')` call and its existing rate-limit class unchanged.

## 11. Open Questions

None. All 4 of the CEO brief's "Questions for BA" are resolved above with concrete, reasoned decisions:

1. Final field names/response shape — §6.2 (`trial_minutes_used`, `trial_minutes_remaining`,
   `trial_minutes_cap` [added beyond the CEO's 3 recommended fields, justified], `test_minutes_balance`).
2. Hardcoded literal vs. shared constant for "20" — §6.1 (shared constant, `lib/billing/trial-minutes.ts`,
   `TRIAL_MINUTES_LIFETIME_CAP`, also applied to the pre-existing `sessions/route.ts` literal to close
   the drift risk at both existing TS call sites, not just the new one).
3. Whether the docs update ships in the same change — §6.5 (yes, per CEO recommendation; exact files and
   insertion points identified: `content.ts` lines 126-149, `DocsClient.tsx` between lines 485-487).
4. Whether the B2B-08 trial mechanism genuinely applies to real (non-demo) partner accounts today — §0
   (confirmed yes: gated on API key mode via `auth.mode === 'test'`, not `account_kind`; applies to any
   real reseller calling with a test-mode key, not only internal/demo accounts — the feature's value
   proposition holds).

## 12. Dependencies

- **No new libraries, no new vendor, no new environment variables.**
- **No schema/migration change** — migration 077 already applied and live (per CEO brief's Known
  Constraints); this brief only adds columns to an existing `SELECT` list.
- **Depends on** `consume_trial_and_test_minutes()` and `credit_test_minutes_balance()` (migration 077)
  continuing to be the sole writers of `trial_minutes_used`/`test_minutes_balance` — this brief adds no
  new writer, only a new reader.
- **New internal dependency introduced by this brief**: `app/api/partner/v1/sessions/route.ts` gains an
  import of `TRIAL_MINUTES_LIFETIME_CAP` from the new `lib/billing/trial-minutes.ts` (§6.1) — a
  same-change, value-neutral refactor, not a sequencing dependency (both changes ship together).
- **No dependency on or interaction with** the B2B-39 demo-minutes mechanism, `docs/specs/
  B2B-52-requirement-document.md` (Hume retry tolerance, unrelated), or any other in-flight brief —
  independently shippable.

## 13. Test Plan

New integration test file: `tests/integration/partner-wallet-api.test.ts`, following the established
convention already used by `tests/integration/partner-usage-api.test.ts` (confirmed by direct read, §0):
mock `@/lib/partner/auth`'s `requirePartnerApiKey` via `vi.fn()`, mock `@/lib/supabase`'s
`createSupabaseAdminClient` returning a `.from(table)` dispatcher, import `GET` directly from
`@/app/api/partner/v1/wallet/route`, and call it with a constructed `NextRequest`. This route's existing
`.maybeSingle()` calls (`partner_wallets`, `billing_rate_versions`) need a chainable mock resolving `{
data, error }` on await — same shape as `partner-usage-api.test.ts`'s `makeQueryBuilder` helper, reused
or adapted directly rather than reinvented.

- **Covers AT-1 through AT-7**:
  - Mock `partner_wallets` select to return `{ trial_minutes_used: 6.5, test_minutes_balance: 0, ... }`;
    assert the 4 new response fields (AT-1).
  - Mock `trial_minutes_used: 20`; assert `trial_minutes_remaining: 0`, never negative (AT-2).
  - Mock `.maybeSingle()` to return `{ data: null, error: null }`; assert all 4 new fields default
    correctly (`0`/`20`/`20`/`0`) (AT-3).
  - Reuse `partner-usage-api.test.ts`'s existing auth-failure pattern: mock `requirePartnerApiKey` to
    return an error response; assert it's returned unchanged and no `partner_wallets` query mock is
    invoked (AT-4).
  - Assert every pre-existing field name/value from a full mock response is still present and unchanged
    (AT-5).
  - A focused unit assertion (can live in the same file or a small addition to an existing
    `sessions`-route test file, whichever this repo's existing test organization favors at
    implementation time) importing `TRIAL_MINUTES_LIFETIME_CAP` directly and confirming it equals `20`,
    plus confirming `sessions/route.ts`'s trial-gate math produces identical `availableMinutes` values
    before/after the refactor for a fixed set of `(trialMinutesUsed, testMinutesBalance)` inputs (AT-6).
  - Assert the mocked `.eq('partner_account_id', ...)` call argument matches `auth.partnerAccountId` from
    the mocked auth result, confirming no cross-partner query path was introduced (AT-7).
- **No E2E test needed** — this is a deterministic, fully mockable data-read-and-compute change with no
  UI surface (§5) and no timing/async-retry complexity (unlike B2B-52's WebSocket retry logic); unit/
  integration coverage following this repo's existing convention for this exact route family is
  sufficient and consistent with how `partner-usage-api.test.ts` and `partner-sessions-api.test.ts` are
  each tested today (no E2E counterpart for either).
