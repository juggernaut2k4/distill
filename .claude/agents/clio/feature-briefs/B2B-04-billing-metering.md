# Feature Brief: B2B-04 — Billing / Metering
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-13

## Series context
Fourth of five sequenced Feature Briefs for the B2C → B2B/B2B2C pivot (see
`docs/b2b-pivot-status.md` for the full dependency graph). Unblocked now that
B2B-02 (Partner API & multi-tenant architecture) has landed: `partner_accounts`,
`partner_api_keys`, `partner_sessions`, `webhook_dispatch_log`, and the
`usage_events` aggregating ledger (migration `072`, F-01 Resolution A, now the
unconditional code path) all already exist and are being written to for every
billable event. B2B-03 (Designer/Configurator, BA spec pending, not yet built)
extended `usage_events.event_type`'s CHECK constraint with 4 more
Designer-specific LLM-generation actions on top of B2B-02's original 4 — read
`supabase/migrations/074_b2b03_designer_configurator.sql` for the current full
list, don't assume only 2 event types exist.

Scope precisely — do **not** pull the following into this spec, even though
they touch adjacent surface area:
- **Real COGS numbers.** F-02 is explicitly deferred by Arun's own decision:
  "assume with older numbers, create a backlog to research against the new
  architecture and finalize the numbers." This brief specifies the billing
  *mechanism* — how a balance is charged, topped up, alerted on, and how burn
  rates are configured and versioned — using clearly-named placeholder rate
  constants sourced from the stale May-2026 figures already captured in
  `docs/b2b-pivot-status.md` F-02 (Recall.ai $0.0108/min, Claude Sonnet
  ~$0.0002/min, infra ~$0.004/min; ElevenLabs's $0.08/min line is dead, no
  Hume replacement rate exists yet). Do not have the BA or a developer invent
  new numbers, and do not silently substitute the newer Attendee pricing
  ($0.35–0.50/hr) for the stale Recall figure either — that substitution is
  exactly the "finalize against the new architecture" work Arun explicitly
  deferred to a follow-up research pass, not something to fold in here.
  Distinct from COGS entirely: the customer-facing burn *rate* (price) also
  needs a margin/markup over COGS — that number doesn't exist yet either and
  is part of the same deferred research, not something to invent now.
- **Designer/Configurator's own authoring UI** (questionnaire builder, topic
  toggles, AI-assisted template authoring) — that's B2B-03. Where a
  Designer action is billable, this brief only needs to confirm it fires a
  `usage_events` row via the mechanism B2B-02 already built; it does not touch
  that UI.
- **Subdomain provisioning, custom-domain verification, the Vercel Domains
  API, or Host-header tenant-resolution middleware** — that's B2B-05.
- **The onboarding wizard's step sequencing** (Questionnaire → Topics →
  Content → Visualization → Domain → **Payment method** → Go-live) — that's
  B2B-05 per `docs/brainstorm-b2b-platform-pivot.md` §7.6. This brief builds
  the payment-method-collection mechanism (a Stripe Checkout/Setup flow) the
  wizard's "Payment method" step would call into; it does not build the
  wizard shell itself.

Authoritative sources, read in full before starting:
- `CORE_OBJECTIVES.md` v2.0 — specifically Objective 6 ("Usage-metering hooks
  — every billable event... is API-observable, feeding both billing and the
  partner's own dashboard") and the Non-Negotiable Data Boundary section's
  note that F-01's eventual resolution "is a billing/dashboard implementation
  detail for later Feature Briefs" — this is that brief.
- `docs/brainstorm-b2b-platform-pivot.md` §7.1–7.6 in full, especially §7.2
  (internal admin page requirements — exact fields Arun asked for), §7.3
  (partner-facing dashboard), and §7.4 (pricing model — **DECIDED: Option B,
  single unified wallet**, with the enterprise-tiering recommendation Arun
  confirmed).
- `docs/b2b-pivot-status.md` — F-01 (RESOLVED, Option A, `usage_events` is the
  billing source of truth), F-02 (DEFERRED, stale-numbers-as-placeholder), and
  the B2B-04 row itself, which already lists "admin page" as part of this
  brief's scope in the tracker (see "Questions for BA" below for why I'm
  treating that as settled rather than re-opening it).
- `docs/specs/B2B-02-requirement-document.md` Section 6 ("F-01 Handling") and
  `architecture.md` Section 8 — both branches of F-01 were documented so
  B2B-04 could pick Resolution A cleanly; Resolution A is now the actual live
  state, not a hypothetical.
- `supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql`,
  `072_b2b02_usage_events_resolution_a.sql`, and
  `074_b2b03_designer_configurator.sql` — read the actual `usage_events`,
  `partner_accounts`, and `webhook_dispatch_log` schemas directly rather than
  assuming their shape. Note in particular: `partner_accounts` today has no
  billing-related columns at all (no Stripe customer reference, no tier, no
  contract fields) — this brief is genuinely new schema territory, not an
  extension of something partially built.
- `lib/stripe.ts` (current state) — this is B2C-era code: flat per-plan
  subscription checkout (`getPlanFromPriceId`, `createCheckoutSession` against
  `STRIPE_STARTER_MONTHLY_PRICE_ID`-style env vars, `createSubscriptionIntent`
  with a fixed trial). None of this shape survives under usage-based billing.
  The BA should treat this file as needing a substantial rework, not an
  extension — but the webhook-signature-verification pattern
  (`constructWebhookEvent`) is reusable infrastructure, not B2C-specific.
- `app/dashboard/admin/templates/page.tsx` — the existing precedent for a
  Clerk-authenticated, cross-partner internal admin page (RTV-04's template
  approval tool). The internal admin page this brief specifies
  (`/dashboard/admin/clients` per §7.2's recommendation) should follow this
  existing pattern, not invent a new one.
- `app/api/partner/v1/usage/route.ts` — the existing partner-facing usage
  read endpoint (`GET /api/partner/v1/usage`, cursor-paginated, reads
  `usage_events`). This brief extends what a partner can see (wallet balance,
  burn-rate/days-remaining) — read the existing implementation before
  deciding whether to extend this route or add a new one.

## What Arun Said
Captured across the original brainstorm session (§7.2–§7.4) and the
task-specific instruction that produced this brief:

1. **Single unified credit wallet, not the originally-proposed dual-pool
   split.** One purchase, one balance, metered at different published burn
   rates per product (per-voice-minute rate, per-LLM-generation-call rate).
   Partners prepay for whatever they use; no upfront allocation decision
   required from them. This is Option B from §7.4, explicitly decided over
   Arun's own original dual-pool framing ("$20 → $15 voice / $5 AI") because
   dual pools risk stranded credit.
2. **Internal admin page** (§7.2, Arun's own words): "One admin page to
   track, per client: revenue, minutes and LLM/AI usage, whether they're
   trending toward exhausting either pool soon, next billing date, whether a
   card is on file, and payment type. Explicitly not payment details — Stripe
   owns that."
3. **Partner-facing usage dashboard** (§7.3): each partner sees their own
   balance/usage only, sent via the same signed-webhook mechanism B2B-02
   already built, correlated to an opaque reference — never end-user
   identity.
4. **Enterprise tiering by commitment size and support level, not feature
   gating** — every partner gets the identical API surface (Objective 6, "one
   flexible API"). Self-serve (no minimum, standard rate, card via Stripe,
   pay-as-you-go) → mid-market (monthly minimum unlocks a volume discount,
   still self-serve) → enterprise (annual contract, negotiated discount,
   invoicing/ACH option in addition to card, dedicated contact, assisted
   SSO/custom-domain setup).
5. **F-01 resolved to Resolution A** (see `docs/b2b-pivot-status.md`): Clio's
   own `usage_events` ledger is the billing source of truth. This brief reads
   from it; it does not re-derive billing numbers via live round-trips to
   partner APIs.
6. **F-02 (real COGS) explicitly deferred**, in Arun's own words: "at this
   point assume with older numbers, create a backlog to research against the
   new architecture and finalize the numbers. we can do that once the
   solution is complete." This brief must not block on that research landing.

## The Problem Being Solved
Today there is no way for Clio to charge a partner for usage at all. The
`usage_events` ledger (B2B-02) faithfully records every billable action — but
nothing reads it into a balance, nothing decrements a balance as usage
accrues, nothing tells a partner or Clio when a balance is running low, and
`lib/stripe.ts` still assumes the retired B2C flat-subscription model
(fixed monthly plan tiers, not usage-metered prepaid credit). Two dashboards
Arun explicitly asked for — his own cross-partner operational view, and each
partner's own usage view — don't exist. Until this brief lands, B2B-02 and
B2B-03 can technically emit and record usage, but Clio has no mechanism to
turn that into revenue or give Arun visibility into account health.

## What Success Looks Like
A BA spec exists that, once built, means:

1. **A single unified credit wallet exists per `partner_account_id`.** One
   balance (a credit-unit or dollar-denominated number — BA's call, document
   the choice), no upfront pool split. Every `usage_events` row of any
   `event_type` decrements the wallet at that event type's currently
   effective, independently configured burn rate. (`usage_events` already
   differentiates 8 sub-types post-B2B-03, not just "voice" and "LLM" — the
   spec should key rates by `event_type`, a superset of the two rate
   categories Arun named, not force everything into one blended
   "LLM-generation" rate. This is a technical/data-modeling decision within
   BA authority, not a product question — it costs nothing extra to build
   correctly now and avoids a rate-table refactor later.)
2. **Burn rates are versioned, not a single mutable row.** Since F-02's real
   numbers will eventually replace the placeholder ones, a rate change must
   never silently reprice already-recorded historical usage — each
   `usage_events` row (or the invoice/statement computed from it) must be
   able to cite the rate that was actually in effect when the event occurred.
   Placeholder rate constants must be named to make clear they are COGS-era
   placeholders pending F-02, not final priced rates (which additionally need
   a margin/markup over COGS — also deferred, also not to be invented here).
3. **Wallets are funded via Stripe, using primitives Stripe actually supports
   well for a prepaid-balance model** — not shoehorned into Stripe's native
   metered/usage-based subscription billing, which bills in arrears on a
   fixed cycle and doesn't fit "partners prepay for whatever they use, no
   upfront allocation." Recommended shape, BA to confirm/refine:
   - **Self-serve top-ups**: Stripe Checkout, one-time payment, card only,
     credits the wallet on `checkout.session.completed`.
   - **Mid-market monthly minimum**: a Stripe Subscription whose fixed
     monthly charge auto-credits the wallet each cycle (an "auto-recharge"
     subscription funding the same wallet, not a metered-billing
     subscription), plus the volume discount applied at the burn-rate level
     for that account.
   - **Enterprise**: Stripe Invoicing, ACH or card, wallet credited on
     invoice payment; negotiated discount applied the same way as
     mid-market's, at the rate-table level per account.
   All three funding paths land in the same one wallet balance and burn at
   the same metered rates — the tiering differs in *how the wallet gets
   funded and at what discount*, never in what the API can do (Objective 6).
4. **Low-balance alerting exists.** Arun informally referenced 80% in earlier
   brainstorming — treat that as the working threshold (it's Arun's own
   stated number, just not yet formally re-confirmed; I'm not escalating this
   to re-ask him, see "Questions for BA"). The BA has full authority over the
   exact mechanism: which channel(s) (dashboard banner, email via the
   existing Resend integration, webhook event, or a combination), whether it
   fires once per threshold-crossing or repeats, and how it re-arms after a
   top-up brings the balance back above threshold. Spec it concretely enough
   to be testable — not left as prose.
5. **The internal admin page exists** at `/dashboard/admin/clients` (Clerk-
   authenticated, following the existing `/dashboard/admin/templates`
   pattern), showing per partner: name/tier/contract status, revenue
   (lifetime + current period), wallet balance, a burn-rate projection
   (days-until-exhausted, computed from recent usage velocity, sortable so
   at-risk accounts surface without manual checking), next billing date (from
   the relevant Stripe object for that account's funding mechanism), and
   payment method on file (yes/no + card brand/last4 + payment type — sourced
   from Stripe's PaymentMethod object by reference, never raw card data, per
   Arun's own explicit "not payment details, Stripe owns that").
6. **The partner-facing usage dashboard exists**, extending or sitting
   alongside the existing `GET /api/partner/v1/usage` contract: each
   partner's own wallet balance, burn-rate/days-remaining, and usage history
   — their own data only, never cross-partner. BA to determine whether this
   extends the existing endpoint's response shape or adds a sibling endpoint;
   either way it must not change `GET /api/partner/v1/usage`'s existing
   response contract in a way that breaks an already-live B2B-02 consumer
   without a clear compatibility note.
7. **The `usage_events` idempotency gap is closed before this brief goes
   live.** `architecture.md` flagged "no idempotency guard yet on the ledger
   insert itself, currently moot since no real call sites exist." Once this
   brief makes `usage_events` the direct input to real balance decrements,
   that gap stops being moot — a duplicate insert now directly costs a
   partner money. Spec an idempotency mechanism mirroring
   `webhook_dispatch_log`'s existing unique-index pattern
   (`partner_account_id, event_type, clio_session_ref, payload_hash`-shaped).
8. **`lib/stripe.ts` is reworked, not extended.** The B2C-era
   plan-tier/checkout functions do not survive as-is; the webhook-signature-
   verification pattern does. Spec the new functions this brief needs
   (wallet top-up checkout, subscription-based auto-recharge, invoicing,
   webhook handling for all of the above) as a clean replacement.

## Known Constraints
- **No feature gating by tier.** Every partner gets the identical API
  surface regardless of self-serve/mid-market/enterprise tier — tiering is
  commitment size, support level, and discount only (Objective 6, confirmed
  decision, not open for reinterpretation).
- **Data boundary holds.** This brief reads/writes wallet balances, rate
  configuration, and billing metadata — it must never become a place where
  end-user identity or partner content/profile payloads get persisted. The
  wallet and rate tables are Clio's own billing state, not a new
  system-of-record exception to `CORE_OBJECTIVES.md`'s data boundary.
- **Never invent real dollar figures.** Every rate constant must be clearly
  named as a placeholder pending F-02's deferred research backlog item. If
  the BA needs a number to write acceptance tests against, use the stale
  figures already on record in `docs/b2b-pivot-status.md` F-02 — do not
  research or estimate new ones.
- **Test-mode events stay excluded.** `usage_events.test_mode = TRUE` rows
  (test-key-originated) are already hard-filtered from `GET
  /api/partner/v1/usage`'s billing-relevant aggregations per B2B-02 — this
  brief's wallet-decrement logic must preserve that exclusion, not
  reintroduce test traffic into real balances.
- **No sub-tenant billing complexity.** Per `CORE_OBJECTIVES.md`, Clio sees
  only a single rollup usage/billing line per top-level `partner_account_id`
  — a partner's own downstream sub-tenants (e.g. Capgemini → Hartford) are
  entirely the partner's own concern, never separately billed or visible to
  Clio.

## Questions for BA
Two items were flagged to me as potentially needing escalation to Arun. I
resolved both myself with enough confidence that I'm not sending them up —
documented here so the BA (and anyone reviewing this brief later) can see the
reasoning rather than treating them as silently settled:

1. **Low-balance alert threshold (80%)** — not yet a formally re-confirmed
   number, but it is Arun's own stated figure from earlier brainstorming, not
   an invented one. I'm directing the BA to use it as the working default
   rather than re-asking Arun to restate something he already said. What
   genuinely is open, and is within BA authority: the exact alerting
   mechanism (channel, frequency, re-arm behavior) — spec that concretely.
2. **Is the internal admin dashboard in scope for B2B-04, or a separate
   brief?** Resolved: **in scope, here.** Reasoning: (a) the pivot's own
   5-brief dependency graph (`docs/b2b-pivot-status.md`) has no later brief
   that could own it — B2B-05 is domain/white-label infra, unrelated; (b) the
   dashboard's own required fields (revenue, wallet balance, burn-rate
   projection, next billing date, payment method) are entirely billing-
   derived data that cannot exist before this brief's wallet/rate/Stripe
   mechanism is built, so deferring it would just mean building it as an
   awkward follow-on to this same brief later; (c) the pivot tracker's own
   B2B-04 row already lists "admin page" as part of this brief's scope. I
   don't see a credible alternative home for it, so I'm not escalating this
   either — build it here.

If, in the course of writing the full spec, the BA finds a genuine fork I
haven't anticipated (e.g. Stripe's actual API behavior doesn't cleanly
support one of the three funding paths as I've sketched them above, or the
rate-versioning requirement conflicts with something already built), escalate
that specific finding back to me rather than resolving it silently — per the
standing rule, Section 11 must be empty before this goes to build, and I'd
rather see a real fork than have it guessed away.

## Approval note
I've read `CORE_OBJECTIVES.md` v2.0 (Objective 6 and the Data Boundary
section specifically), `docs/brainstorm-b2b-platform-pivot.md` §7.1–7.6 and
§8 in full, `docs/b2b-pivot-status.md`'s current Live Status table (F-01, F-02,
and the B2B-04 row), `docs/specs/B2B-02-requirement-document.md` Section 6,
`architecture.md` Section 8's F-01 branch documentation, the actual
`usage_events`/`partner_accounts`/`webhook_dispatch_log` schemas across
migrations `071`, `072`, and `074`, the existing `GET /api/partner/v1/usage`
route, the existing `/dashboard/admin/templates` admin-page precedent, and the
current (B2C-era) `lib/stripe.ts` before writing this brief.

I'm confident in both items I resolved without escalating (the 80% threshold
and the admin-dashboard scope question) — reasoning given above for both. I
found no genuine product-level ambiguity in this brief beyond what's already
correctly deferred (F-02's real numbers, which Arun himself explicitly
pushed to a later research pass). I will review the completed Requirement
Document against this brief, and specifically verify: (a) no feature gating
by tier anywhere in the spec, (b) rate versioning is real and testable, not
just described, (c) the `usage_events` idempotency gap is actually closed,
and (d) `lib/stripe.ts`'s replacement doesn't quietly reintroduce a flat-plan
subscription shape — before approving it for build.
