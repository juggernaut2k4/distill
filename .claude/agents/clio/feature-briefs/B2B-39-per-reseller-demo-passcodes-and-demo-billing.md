# Feature Brief: B2B-39 — Per-Reseller Demo Passcodes + Demo Billing

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 — unblocks live testing tonight (the single shared demo account's 20-minute trial is
already exhausted) and is a real self-serve billing surface, but is not a data-foundation blocker for
anything else the way B2B-38 is
Date: 2026-07-27

## What Arun Said

Relayed via the Orchestrator from Arun's own direct conversation tonight — the same live-testing
session that surfaced B2B-38, but a distinct ask. Requirements transcribed verbatim/near-verbatim,
not expanded:

**Why this exists at all:** every demo dispatch today bills against one fixed shared account, and
that account's 20-minute trial ran out mid-testing tonight, blocking further work. Arun's fix: "every
reseller who registers gets a passcode... the passcode is what identifies which account to bill for
that demo session."

**On regeneration:** the reseller (or admin) can regenerate their own passcode from their dashboard.
"the old passcode becomes immediately obsolete... an already running demo session... is not
retroactively affected."

**On the write-once display convention, confirmed to apply uniformly:** "the passcode is shown
exactly once, at generation... and is never retrievable/re-displayed after that... there is no 'view
current passcode' capability anywhere, ever, for anyone including the account owner themselves."

**On today's shared passcode:** it becomes the admin's (Arun's) own passcode, with the same
regenerate capability, replacing the manual `vercel env add DEMO_MEETING_PASSCODE` workflow.

**On scope:** "direct partners need not show the demo to anyone they directly implement so only admin
and resellers need to show demo."

**On demo billing being its own dimension:** "demo top-up is a separate option" from the existing
general wallet top-up — not the same balance as a reseller's real production API usage.

**On the free allowance:** 20 free demo minutes on registration, "matching the existing 20-minute
number used elsewhere," but tracked separately.

**On the near-exhaustion reminder:** "remind them to buy extra minutes when they are nearing
exhaustion. we have defined the rules already" — reuse whatever notification pattern already exists,
don't design new rules.

**On top-up tiers and pricing:** 15 min / 30 min / 1 hr / ... up to 10 hr, purchasable by both admin
and resellers from their own dashboard, separate from the general wallet top-up flow. "now set some
prices approx based on the current spent but later we can finetune the prices with actual
calculation" — explicit authorization for provisional placeholder pricing now.

## The Problem Being Solved

Verified against live code before writing this brief, not assumed:

- The public `/demo/[slug]` "Learn with AI" tool is gated by exactly one shared secret,
  `DEMO_MEETING_PASSCODE`, checked via constant-time comparison in `lib/demo/passcode.ts`'s
  `verifyDemoPasscode()`. It has no notion of *who* entered it — only whether the string matches.
- Every dispatch (`app/api/demo/[slug]/dispatch/route.ts`) calls the real, unmodified
  `POST /api/partner/v1/sessions` authenticated as one fixed account, "Clio Internal — Public Demo"
  (`partner_accounts.id = 30d40f51-5d6e-49e9-bdda-519b7d70e13a`, `account_kind = 'partner'`,
  confirmed live per `docs/specs/B2B-34-requirement-document.md` §5 row 5), via the server-only
  `DEMO_PARTNER_API_KEY` env var. There is no way today for a dispatch to bill anywhere else.
- That account's B2B-08 trial gate (`partner_wallets.trial_minutes_used`, 20-minute free allowance,
  then requiring a real `$1.80`/120-minute test-block purchase via
  `app/api/admin/billing/test-block/route.ts` + `createTestBlockCheckoutSession()` in `lib/stripe.ts`)
  is the same mechanism a real partner's test-mode API key uses. Tonight, live-testing exhausted this
  one account's 20 minutes, which is what surfaced this whole feature — the fix has to be per-reseller
  identity, not just "add more minutes to the shared account."
- `partner_wallets.trial_minutes_used` / `test_minutes_balance` (migration `077_b2b08_testing_metering.sql`)
  are real-API test/trial minutes, shared across every test-mode session a partner or reseller's real
  API key authenticates. Arun was explicit these must stay structurally separate from a new
  demo-minutes balance — a reseller using the demo tool must not burn their real API trial minutes,
  and vice versa.
- `partner_accounts.account_kind` (migration `086_b2b26_sales_partner_entity.sql`) is `'partner'`
  (direct partner or a sales-partner's own client) or `'channel_partner'` (a sales-partner/reseller's
  own account row — user-visible copy always says "sales-partner"). This is the exact axis Arun's
  scope rule ("only admin and resellers need to show demo") maps onto: `channel_partner`-kind accounts
  plus the admin/internal sentinel, never plain `'partner'`-kind (direct partner) accounts.
- The codebase already has exactly the notification pattern Arun referred to as "we have defined the
  rules already": `sendLowBalanceAlertEmail()` (`lib/delivery/email.ts:525-578`), fired from
  `checkLowBalanceAndAlert()` in `lib/partner/webhooks.ts:428-475`. Pattern: compare current balance
  against `partner_wallets.reference_topup_amount_usd` (the amount of the last top-up); once balance
  drops to ≤20% of that reference (i.e., 80% consumed), fire once via a compare-and-set on a
  `*_alert_fired_at` timestamp column (race-safe — only the request that flips it from `NULL` sends the
  alert), re-armed only when a new top-up lands. This is the concrete mechanism to replicate for demo
  minutes, per Arun's instruction to reuse rather than reinvent.
- Precedent for a reusable API-key-style secret already exists: `lib/partner/api-keys.ts` —
  `crypto.randomBytes` generation, SHA-256 hash is the only form ever persisted, plaintext returned to
  the caller exactly once at issuance. This is the shape to mirror for passcodes, adjusted for the fact
  that a passcode is hand-typed by a demo visitor (not copy-pasted like an API key), so it needs to
  stay short/typable rather than a 48-hex-char string.
- The reseller-facing dashboard already exists at `app/dashboard/channel-partner/*` (`settings`,
  `clients`, `team`, and the *unrelated* `showcase` — B2B-31/32's private content-authoring/preview
  tool, not this feature; do not confuse the two). The admin-facing equivalent is
  `app/dashboard/admin/sales-partners/*`. These are the natural homes for the new "regenerate passcode"
  / "buy demo minutes" UI, though the BA should confirm exact placement.

## What Success Looks Like

- Every `channel_partner`-kind account gets a passcode generated automatically at registration. The
  admin (Clio's own owner) gets one too, replacing `DEMO_MEETING_PASSCODE`.
- At demo dispatch time, the entered passcode resolves server-side to the `partner_accounts.id` it
  belongs to — that account is billed, exactly the way an API key resolves to a `partner_account_id`
  today via `requirePartnerApiKey()`.
- The reseller (or admin) can regenerate their own passcode with one click from their dashboard. The
  old passcode stops working for new dispatches immediately; an already-dispatched/running demo bot
  session is unaffected.
- The passcode is displayed exactly once, at generation/regeneration time, for both admin and every
  reseller uniformly. No screen, table, or API response ever re-displays it afterward — the only
  recovery path is regenerating (which invalidates the old one).
- A new, separate demo-minutes balance exists per billable account (admin's sentinel account and every
  `channel_partner` account), structurally distinct from `trial_minutes_used`/`test_minutes_balance`.
  20 free minutes on registration (or on the admin's initial setup).
- Nearing exhaustion of demo minutes triggers a reminder, using the same 80%-consumed /
  compare-and-set-once-per-cycle / re-arm-on-new-top-up pattern `checkLowBalanceAndAlert()` already
  implements for the real wallet.
- A self-serve demo-minutes top-up flow exists on both the admin's and every reseller's own dashboard,
  separate from the general wallet top-up flow, offering a tiered ladder of purchasable blocks (15 min
  up to 10 hr), via Stripe Checkout following the `createTestBlockCheckoutSession()` pattern but
  parameterized across tiers instead of one fixed 120-minute block.
- Direct `partner`-kind accounts (excluding the admin sentinel and reseller-owned self-clients) get no
  passcode, no demo-minutes balance, and no demo access of any kind — this feature is entirely absent
  for them.

### Proposed demo-minutes top-up ladder (provisional placeholder pricing)

Arun explicitly authorized approximate pricing now, to be refined once real COGS data lands (per the
still-open F-02 item in `docs/b2b-pivot-status.md`). Scaled from the existing seeded
`voice_minute` platform-default rate underlying the real test-block price ($1.80 / 120 min =
$0.015/min, zero margin, `rate_basis='cogs_placeholder_2026_05_no_margin'`), with two adjustments: (1)
Stripe's real-world minimum card charge is $0.50 USD — the 15-minute tier is floored there rather than
priced at the raw per-minute rate; (2) a mild volume discount curve so larger blocks reward
commitment, anchored so the existing 2-hour/$1.80 real test-block price lands unchanged at the
2-hour demo tier for consistency:

| Tier | Minutes | Placeholder price | Effective $/min |
|---|---|---|---|
| 15 min | 15 | $0.50 | $0.033 (Stripe-minimum-floored) |
| 30 min | 30 | $0.75 | $0.025 |
| 1 hour | 60 | $1.25 | $0.021 |
| 2 hours | 120 | $1.80 | $0.015 (matches the existing real test-block rate exactly) |
| 3 hours | 180 | $2.50 | $0.014 |
| 5 hours | 300 | $4.00 | $0.013 |
| 10 hours | 600 | $7.50 | $0.0125 |

**Explicitly provisional** — BA should carry this table forward as the starting default but is not
required to treat it as final; flag clearly in the spec that these are placeholders pending real COGS
finalization, same posture as the existing F-02 backlog item.

## Known Constraints

- Scope is `account_kind = 'channel_partner'` and the admin/internal side only. Never extend to
  `account_kind = 'partner'` (direct partners) under any circumstance.
- Do not reuse or share `partner_wallets.trial_minutes_used` / `test_minutes_balance` for demo minutes
  — this must be a structurally separate balance/dimension.
- Do not build a "view current passcode" capability anywhere, for anyone, including the account owner.
  Regeneration is the only recovery path for a lost passcode.
- Reuse the existing low-balance-alert pattern (`checkLowBalanceAndAlert()` /
  `sendLowBalanceAlertEmail()`) for the near-exhaustion reminder rather than inventing new timing/
  channel/copy rules.
- Reuse the existing hashed-secret-at-rest / shown-once-at-issuance discipline
  (`lib/partner/api-keys.ts`) for how passcodes are stored, adapted for a short, hand-typeable format.
- Pricing is explicitly provisional/placeholder, not final — label it as such in the spec.
- Do not merge scope with B2B-38 (session traceability IDs) — cross-reference where genuinely
  relevant (see below) but keep this brief to passcodes + demo billing only.

## Cross-reference to B2B-38 (related, not merged)

B2B-38 adds a mandatory `reseller_id` + optional `reseller_unique_id` to the *real* partner session
API (`POST /api/partner/v1/sessions`) for cross-system traceability/dedup on partner-authenticated
traffic. B2B-39's demo dispatch route already calls that same real endpoint server-to-server
(`app/api/demo/[slug]/dispatch/route.ts`), authenticated today as the fixed "Clio Internal — Public
Demo" account. Once B2B-39 ships, the dispatch route will authenticate as *whichever* reseller's (or
the admin sentinel's) real API key the entered passcode resolves to (see Open Item 3 below) — meaning
that outbound call will need to also satisfy B2B-38's new mandatory `reseller_id` field once B2B-38
lands. **BA should note this dependency explicitly** (the exact sequencing — whichever of B2B-38/
B2B-39 ships second must account for the other's already-landed contract on that same outbound call —
is a BA design question, not resolved here) but must not fold B2B-38's traceability-ID scope into this
brief's requirement doc.

## Design Questions I'm Resolving With a Recommended Default (Arun did not specify these)

**1. Passcode format.** Not specified. A demo visitor hand-types this (unlike an API key, which is
copy-pasted), so it needs to stay short, while carrying enough entropy to matter now that it doubles
as a billing identifier — a meaningfully higher bar than today's single memorable shared word/phrase.
**Recommended default:** a 10-character passcode drawn from an unambiguous alphanumeric alphabet
(uppercase letters + digits, excluding visually confusable characters like `0`/`O`, `1`/`I`/`L`),
generated via `crypto.randomBytes`, displayed with a separator for readability (e.g. `XK7P-4QRT9M`
style). Only the SHA-256 hash is ever persisted, mirroring `lib/partner/api-keys.ts`'s
`hashApiKey()`. BA should confirm this exact format/length or propose an alternative with reasoning —
this is a genuine typability-vs-entropy tradeoff worth designing deliberately, not guessing past.

**2. How admin's own passcode is modeled.** **Recommended default: reuse the existing "Clio Internal —
Public Demo" `partner_accounts` row** (`id = 30d40f51-5d6e-49e9-bdda-519b7d70e13a`,
`account_kind = 'partner'`) as the billing target for the admin's passcode, rather than inventing a
new sentinel concept. This account already exists specifically to isolate demo billing from real
partner data (per B2B-33's migration `093_b2b33_demo_meeting_dispatch.sql` header comment), already
has its own API key (`DEMO_PARTNER_API_KEY`), and already has a resolvable `partner_account_id`
(`DEMO_PARTNER_ACCOUNT_ID` env var, used today by `app/api/demo/[slug]/performance/route.ts`). One
unified `demo_passcodes` table with a non-nullable `partner_account_id` foreign key — every row,
admin's included, points at a real `partner_accounts.id` — is simpler than a nullable-FK-plus-flag
design and requires no new invariant/trigger machinery. BA should confirm this or propose an
alternative with reasoning.

**3. Outbound auth for the dispatch route, once billing target is per-passcode.** Today
`app/api/demo/[slug]/dispatch/route.ts` always authenticates its server-to-server call to
`POST /api/partner/v1/sessions` with the fixed `DEMO_PARTNER_API_KEY`. Once the billing target is
resolved per-passcode, that single fixed key can no longer be correct for a reseller's passcode.
**Recommended default:** at dispatch time, after resolving the passcode to a `partner_account_id`,
look up that account's own real API key server-side (the same `partner_api_keys` table
`requirePartnerApiKey()` already reads, keyed by `partner_account_id` — likely a new lookup path, not
the existing bearer-token-parsing one, since the dispatch route has no bearer token from the browser)
and use it for the outbound call, rather than always using `DEMO_PARTNER_API_KEY`. This requires every
`channel_partner` account to already have a real API key minted (today: `POST /api/admin/partner-keys`,
a Clerk-authenticated admin action) before their demo passcode can function — BA should design what
happens if a reseller's passcode resolves but they have no API key yet (recommend: dispatch fails with
a clear internal-error-class response, logged; provisioning both together at registration is the
cleaner long-term fix and worth flagging as a design requirement, not just an edge case). BA should
confirm this approach or propose an alternative — this is the most structurally significant open
question in this brief.

## Questions for BA

In addition to fully designing Open Items 1-3 above with concrete acceptance criteria:

1. Design the `demo_passcodes` table schema: `partner_account_id` (FK, non-null per Open Item 2's
   recommended default), `passcode_hash`, `created_at`, `revoked_at` (set, not deleted, when
   regenerated — for audit trail, mirroring how existing tables in this codebase prefer soft
   invalidation over hard delete where an audit trail has value), and how "the currently active
   passcode for this account" is queried efficiently (partial unique index on
   `(partner_account_id) WHERE revoked_at IS NULL`, or similar).
2. Design the demo-minutes balance: new column(s) on `partner_wallets` (e.g.
   `demo_minutes_balance`, mirroring `test_minutes_balance`'s shape) vs. a wholly separate table.
   State and justify the choice, keeping in mind this must never be conflated with
   `trial_minutes_used`/`test_minutes_balance` per Known Constraints.
3. Design the RPC(s) for crediting (top-up purchase, 20-minute registration grant) and consuming
   (at session-end, mirroring `consume_trial_and_test_minutes`'s shape) demo minutes atomically, and
   how session duration is attributed back to demo-minutes consumption specifically (vs. real
   trial/test minutes) given both paths ultimately call the same `POST /api/partner/v1/sessions`.
4. Design exactly how registration (a reseller signing up, and the admin's one-time initial setup)
   triggers both passcode generation and the 20-free-minute grant — same transaction, same
   provisioning step, or two independent steps. Reference the existing reseller registration/
   provisioning flow (`createClientForChannelPartner`-adjacent code, B2B-26) as the integration point.
5. Design the near-exhaustion reminder's exact reuse of `checkLowBalanceAndAlert()`'s pattern for the
   demo-minutes dimension — new sibling function vs. parameterizing the existing one, new email
   template vs. reusing `sendLowBalanceAlertEmail()`'s copy with demo-specific wording, and the
   equivalent of `reference_topup_amount_usd` for a minutes-based (not dollar-based) balance.
6. Design the tiered top-up purchase flow: new Stripe Checkout function parameterized by tier (vs.
   `createTestBlockCheckoutSession()`'s single fixed amount), the exact request/response shape for a
   new `/api/*/billing/demo-topup` -style route (admin and reseller variants, or one shared route
   with account-scoped auth), and confirm/refine the provisional pricing table above.
7. Design the regeneration flow precisely: the button's exact placement (reseller: likely
   `app/dashboard/channel-partner/settings`; admin: likely `app/dashboard/admin/sales-partners` or a
   new admin-settings surface — confirm), the one-time-reveal UI pattern (modal/banner shown once,
   with an explicit "I've saved this" acknowledgment before it can be dismissed — mirroring how API
   key issuance UIs typically force acknowledgment), and what happens to any demo session already
   mid-flight on the old passcode (Known Constraint: unaffected — confirm no code path re-checks the
   passcode after initial dispatch).
8. Design admin's own one-time initial-setup flow for provisioning their first passcode +
   20-minute grant (analogous to a reseller's registration, but there is no "registration" event for
   the admin/sentinel account — needs its own bootstrap step).
9. Confirm test coverage plan: passcode generation/regeneration (old passcode fails immediately after
   regen, new one works), passcode-to-billing-account resolution at dispatch, demo-minutes balance
   isolation from real trial/test minutes (a demo session never touches `trial_minutes_used`/
   `test_minutes_balance` and vice versa), 20-free-minutes grant on registration/admin bootstrap,
   near-exhaustion reminder firing once per depletion cycle and re-arming on top-up, tiered top-up
   checkout creating a session for each tier, `account_kind='partner'` accounts confirmed to have zero
   demo-passcode/demo-minutes access anywhere in the API or schema.

## What NOT to Do

- Do not merge this with B2B-38's scope — cross-reference only where genuinely relevant (above).
- Do not lock in the proposed tier pricing as final — clearly label it provisional per Arun's own
  instruction.
- Do not extend any part of this feature to direct (`account_kind='partner'`) accounts.
- Do not build any UI or API path that can re-display a passcode after its one-time reveal, for any
  account, including the admin's own.
