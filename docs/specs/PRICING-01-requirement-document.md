# PRICING-01 — Usage Pricing ($0.30/min) + Admin-Only Per-Partner Discount
# Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-09-06

Source Feature Brief: `docs/specs/PRICING-01-feature-brief.md` (Approved 2026-09-06).
Prior art read in full: `supabase/migrations/075_b2b04_billing_metering.sql`, `lib/partner/webhooks.ts`
(`resolveEffectiveRate`, `applyWalletDecrement`, `recordBillableEvent`), `lib/billing/plan-tiers.ts`,
`app/(with-clerk)/dashboard/configurator/PaymentConfigClient.tsx`, `app/api/partner/v1/wallet/route.ts`,
`app/(with-clerk)/dashboard/admin/sales-partners/[id]/SalesPartnerDetailClient.tsx` +
`app/api/admin/sales-partners/[id]/route.ts`, `lib/internal-admin/auth.ts` (`requireSuperAdmin`),
`app/api/admin/billing/checkout/route.ts` (Zod/error-envelope pattern to mirror),
`app/(with-clerk)/dashboard/configurator/DashboardPanel.tsx` + `_billing-health.ts` +
`_shared.tsx`'s `BillingHealth` type (existing partner-facing wallet snapshot — confirmed no page
renders a per-minute rate to a partner today).

---

## 0. Headline finding — this is two additive rows in an already-built rate table, plus one small display addition

`billing_rate_versions` (migration 075) and its resolution mechanism (`resolveEffectiveRate()` /
`applyWalletDecrement()`, `lib/partner/webhooks.ts`) already implement everything this brief needs: a
platform-default rate per `event_type`, an optional partner-specific override that wins when present,
versioned so historical `usage_events` rows keep citing the rate genuinely in effect at `occurred_at`.
**Confirmed directly in the CEO brief and re-verified by reading the migration:** the only `voice_minute`
row on record today is the platform-default placeholder, `rate_basis = 'cogs_placeholder_2026_05_no_margin'`,
`rate_usd = 0.01500000`. This document does not touch that mechanism's code at all — it (a) writes, but
does not apply, the migration that closes that placeholder row and opens the real `$0.30` default row, (b)
adds new admin-only API routes + UI that write a second kind of row into the exact same table (a
partner-specific override, `partner_account_id` non-null), and (c) replaces `PaymentConfigClient.tsx`'s
flat-dollar `TOPUP_PRESETS_USD` with a new `MINUTE_BUNDLES` catalog file, mirroring `lib/billing/plan-tiers.ts`'s
existing `PLAN_TIERS` pattern exactly. **Confirmed: no partner-facing page today renders a per-minute rate at
all** — `GET /api/partner/v1/wallet` already resolves and returns `burn_rate_by_event_type` (including the
override-aware `voice_minute` rate) to a partner calling their own API, but the only page that reads
partner-account financial data in the dashboard UI (`DashboardPanel.tsx`'s `WalletArea`, driven by
`_billing-health.ts`) shows balance and next-billing-date only. This document specifies the minimal addition
to that existing card, not a new page.

---

## 1. Purpose

Clio has no real, margin-bearing price for voice-minute usage today — every partner without an override is
billed at cost, with zero margin. This document turns Arun's cost analysis (real ElevenLabs usage data,
$0.10/min conservative cost baseline, 66.7% margin at $0.30/min) into the live default rate, replaces the
top-up flow's arbitrary flat-dollar presets with named, minute-labeled bundles at that real price, and adds
the one missing lever Arun needs for negotiated enterprise deals: a per-partner discounted rate, settable
only from the existing super-admin Sales Partner detail screen, invisible everywhere else except to the
discounted partner's own view of their own effective rate.

**What failure looks like without this document:** Clio continues selling voice minutes at cost with no
margin indefinitely (every partner, including partners paying full self-serve price, is being undercharged
relative to the business's own cost-plus-margin decision), and Arun has no way to grant a negotiated
volume discount to a real enterprise deal without hand-editing the database — which is precisely the
"never silently change the live rate via direct DB write" outcome the Known Constraints forbid for the
*default* rate and this document must not accidentally reproduce for the *override* rate either (see §6.3's
API-only write path).

## 2. User Story

**Story 1 — Arun granting a negotiated discount**
As the super-admin,
I want to set a specific sales-partner's per-minute voice rate to a custom, lower value from that
partner's existing detail screen,
So that a negotiated volume deal is honored automatically on every future usage event, with no manual
billing intervention and no separate billing path to maintain.

**Story 2 — A self-serve partner buying minutes**
As a partner topping up my wallet,
I want to see clearly labeled minute bundles (how many minutes, what they cost) instead of guessing at an
arbitrary dollar amount,
So that I can reason about how far my top-up will actually take me.

**Story 3 — A discounted partner checking what they're paying**
As a partner who has been granted a negotiated rate,
I want to see my own actual effective per-minute rate somewhere in my dashboard,
So that I can verify I'm being billed correctly, without ever being told a discount mechanism exists or
being able to request one myself.

## 3. Trigger / Entry Point

- **Migration (not auto-applied — see §6.2):** closes the current open platform-default `voice_minute` row
  in `billing_rate_versions` and opens a new one at `rate_usd = 0.30`.
- **`GET /api/admin/sales-partners/[id]/rate`** — page load of the new "Voice rate" block on the existing
  Sales Partner detail screen (`/dashboard/admin/sales-partners/[id]`), `requireSuperAdmin()`-gated.
- **`PUT /api/admin/sales-partners/[id]/rate`** — Arun sets or changes that partner's override rate, from
  the same block.
- **`DELETE /api/admin/sales-partners/[id]/rate`** — Arun clears an override back to the standard rate.
- **Partner top-up flow (`PaymentConfigClient.tsx`, "Pay as you go" card):** page load renders the four
  `MINUTE_BUNDLES` preset buttons in place of `TOPUP_PRESETS_USD`; clicking one starts the existing
  `startCheckout()` → `POST /api/admin/billing/checkout` flow, unchanged, with the bundle's dollar amount.
- **Partner dashboard load (`DashboardPanel.tsx`'s `WalletArea`):** the existing server-side
  `getBillingHealth()` call additionally resolves and returns that partner's own effective `voice_minute`
  rate for display.
- All admin routes require an active Clerk session resolving to `role: 'super_admin'` via
  `requireSuperAdmin()` (`lib/internal-admin/auth.ts`) — identical gate to every other route under
  `app/api/admin/`. No `internal_staff` role may access the rate-override routes (see §9).

## 4. Screen / Flow Description

### 4.A — Admin: Sales Partner detail screen, new "Voice rate" block

Location: `SalesPartnerDetailClient.tsx`, a new card inserted **between the existing "Usage" card and the
existing "Team" card** (i.e., directly after the Usage minutes/breakdown card, before Team) — usage and
rate are both usage-economics information, most naturally read together; Team and the placeholder "Legal
agreement" card stay last, unchanged, per the file's existing bottom-to-top ordering of "engagement
data → org data → contract data."

**State 1 — no override set (standard rate)**
```
┌──────────────────────────────────────────────────────────────┐
│  Voice rate                                                    │
│                                                                 │
│  $0.30/min — standard rate                                     │
│                                                                 │
│  [ Set custom rate ]                                           │
└──────────────────────────────────────────────────────────────┘
```
"Set custom rate" is a text button (same visual weight as the file's other text-link buttons, e.g. "All
sales-partners"). Clicking it reveals an inline input row directly below the current-rate line (no modal,
no navigation — matches this project's established no-confirm-dialog, inline-expansion convention already
used for the Domain-removal warning in B2B-79 §4):
```
┌──────────────────────────────────────────────────────────────┐
│  Voice rate                                                    │
│                                                                 │
│  $0.30/min — standard rate                                     │
│                                                                 │
│  $ [ 0.25              ] /min      [ Save ]   [ Cancel ]       │
│  Standard rate is $0.30/min. Enter a lower negotiated rate.    │
└──────────────────────────────────────────────────────────────┘
```
Input is a numeric field (`type="number"`, `step="0.0001"`), `$` prefix positioned exactly like the existing
custom top-up amount field in `PaymentConfigClient.tsx` (absolute-positioned `$` at `left: 10`). Client-side
validation: value must be `> 0` and `< 0.30` (a "discount" that is not actually a discount is rejected
client-side with an inline message "Enter a rate below the standard $0.30/min." — mirrors
`PaymentConfigClient.tsx`'s existing `showAmountError` inline-message pattern) — this is a technical
input-sanity guardrail, not a new pricing policy; the server independently re-validates (§6.3). "Save" is
disabled while the input is invalid or a request is in flight (same `busy`-state discipline as
`PaymentConfigClient.tsx`).

**State 2 — override active**
```
┌──────────────────────────────────────────────────────────────┐
│  Voice rate                                                    │
│                                                                 │
│  $0.25/min — custom rate (standard is $0.30/min)                │
│  Set 2026-09-06                                                │
│                                                                 │
│  [ Change rate ]                          [ Clear override ]   │
└──────────────────────────────────────────────────────────────┘
```
"Set {date}" reads `billing_rate_versions.effective_from` of that partner's currently-open override row,
formatted with this file's existing `formatDate()` helper (already defined in `SalesPartnerDetailClient.tsx`
for the "Signed up {date}" line — reused verbatim, not reinvented). "Change rate" reveals the same inline
input row as State 1 (pre-filled with the current override value), pre-selected on focus. "Clear override"
requires no confirm dialog (same no-modal convention) but shows inline text next to the button while a
request is in flight: "Clearing…" then reverts to State 1 on success.

**State 3 — save confirmation**
On a successful `PUT`, the input row collapses immediately and the card re-renders as State 2 (or State 1,
for a clear) with a small inline success line appended for 3 seconds, then removed:
```
  ✓ Rate updated.
```
Styled identically to this codebase's other transient inline-success patterns (green `#10B981` text, no
toast/banner component — none exists in this admin surface today, and this project's standing UX rule is to
reuse existing patterns rather than invent new interaction paradigms for one screen, exactly as B2B-79 §4
reasoned for its own remove-domain warning).

**Error state:** a failed `PUT`/`DELETE` (network error or a non-2xx response) shows an inline red
(`#EF4444`) message below the input, matching `PaymentConfigClient.tsx`'s `returnMessage`/`cardReturnMessage`
styling exactly: "Couldn't save. Try again." The input row stays open (not collapsed) so Arun doesn't lose
the value he typed.

### 4.B — Partner top-up flow: `MINUTE_BUNDLES` replace `TOPUP_PRESETS_USD`

Same UI slot in `PaymentConfigClient.tsx`'s "Pay as you go" card (currently the row of `$50 / $100 / $250 /
$500` preset buttons at lines 292–310). Replaced with four preset buttons, one per bundle, each showing
minutes and price on two lines within the same `SecondaryButton`:
```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  500 minutes │ │ 1,500 minutes│ │ 5,000 minutes│ │10,000 minutes│
│    $150      │ │    $450      │ │   $1,500     │ │   $3,000     │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```
Exact button label text (single accessible string, e.g. `aria-label`/visible text): `"500 minutes — $150"`,
`"1,500 minutes — $450"`, `"5,000 minutes — $1,500"`, `"10,000 minutes — $3,000"` (en-dash separator,
comma-formatted minute counts via the same `toLocaleString('en-US')` this file's `formatUsd()` already uses).
Clicking a bundle button calls the existing `onPresetClick(amount)` unchanged (it already just sets
`topupAmount`/`selectedPreset` from a number) — passed the bundle's `priceUsd`, not its minute count. The
existing selected/unselected border-highlight styling (`selectedPreset === amount`) is unchanged.

**Custom amount field: kept, unchanged, per the Known Constraints' explicit default.** It remains directly
below the four bundle buttons, same label ("Or enter a custom amount"), same `$20`–`$50,000` bounds, same
validation — this is the general-purpose top-up path (not bundle-specific) and nothing in this brief gives a
reason to remove it.

### 4.C — Partner dashboard: effective rate visibility

Location: `DashboardPanel.tsx`'s existing `WalletArea` card (the "Wallet" card showing `$X.XX available` /
"Next billing {date}"). One new line appended below the balance line, above the "Manage billing →" link, in
both the funded and no-wallet-yet states:
```
┌─────────────────────────────┐
│  Wallet                      │
│                               │
│  $842.50 available           │
│  Next billing Oct 1, 2026    │
│  $0.30/min for voice          │
│                               │
│  Manage billing →            │
└─────────────────────────────┘
```
For a partner with an override: `$0.25/min for voice` — the plain effective number only, exactly as a
standard-rate partner sees theirs, **never** any additional word, badge, or styling implying a discount was
granted (no "special rate," no highlight color, no asterisk) — per the Feature Brief's explicit instruction
that the mechanism must never be "visibly advertised as an available option" and must show only "their own
effective number, same as any partner would see their own standard rate." Same text size/color
(`text-xs text-[#94A3B8]`) as the existing "Next billing {date}" line — no visual distinction between a
standard-rate partner's line and a discounted partner's line.

For the "No wallet yet" state (`billingHealth.balance_usd === null`), the rate line is **not** shown — a
partner with no wallet has no meaningful "for voice" context yet, and showing a rate before they've funded
anything risks reading as a price quote/offer rather than a factual billing detail. It appears starting the
first time the wallet exists (balance_usd is a real number, including `0`).

## 5. Visual Examples

All states are given as literal wireframes in §4 above, per this project's standard.

## 6. Data Requirements

### 6.1 — `MINUTE_BUNDLES` catalog (new file: `lib/billing/minute-bundles.ts`)

Mirrors `lib/billing/plan-tiers.ts`'s `PlanTier`/`PLAN_TIERS` pattern exactly — one typed array, single
source of truth, so price and minute-label can never drift apart. Real, non-placeholder figures (unlike
`PLAN_TIERS`, which is explicitly still placeholder per its own header comment — this file is not).

```typescript
export type MinuteBundleKey = 'starter' | 'growth' | 'pro' | 'scale'

export interface MinuteBundle {
  key: MinuteBundleKey
  displayName: string
  minutes: number
  priceUsd: number
}

export const MINUTE_BUNDLES: MinuteBundle[] = [
  { key: 'starter', displayName: 'Starter', minutes: 500,    priceUsd: 150 },
  { key: 'growth',  displayName: 'Growth',  minutes: 1500,   priceUsd: 450 },
  { key: 'pro',     displayName: 'Pro',     minutes: 5000,   priceUsd: 1500 },
  { key: 'scale',   displayName: 'Scale',   minutes: 10000,  priceUsd: 3000 },
]

/** Formats a bundle's button label, e.g. "500 minutes — $150". */
export function formatBundleLabel(bundle: MinuteBundle): string {
  return `${bundle.minutes.toLocaleString('en-US')} minutes — $${bundle.priceUsd.toLocaleString('en-US')}`
}
```
`PaymentConfigClient.tsx` line 28's `const TOPUP_PRESETS_USD = [50, 100, 250, 500]` is deleted; the render
block at lines 292–310 imports `MINUTE_BUNDLES`/`formatBundleLabel` from this new file and maps over
`MINUTE_BUNDLES` instead, calling `onPresetClick(bundle.priceUsd)` per button, using `formatBundleLabel(bundle)`
as the button's visible text (replacing the current `${amount}` text), and comparing `selectedPreset ===
bundle.priceUsd` for the highlight state (unchanged comparison logic — `selectedPreset` already stores a
dollar amount, and it continues to).

### 6.2 — Migration SQL (written now, NOT applied to the live database — see Known Constraints)

New file: `supabase/migrations/121_pricing01_voice_minute_default_and_override_capability.sql` (next
sequential number after `120_waitlistinvite01_source_waitlist_id.sql`). Follows migration 075's own
documented versioning discipline exactly: never mutate a `billing_rate_versions` row in place — close the
currently-open platform-default `voice_minute` row (`effective_to = NOW()`), then insert a new one.

```sql
-- PRICING-01 — real $0.30/min default voice-minute rate, replacing the
-- cost-basis-only placeholder seeded by migration 075. See
-- docs/specs/PRICING-01-requirement-document.md Section 6.2.
--
-- NOT AUTO-APPLIED. This migration is written and reviewed here per the
-- Feature Brief's explicit instruction but is not run against the live
-- database without Arun's separate, explicit go-ahead — it changes what
-- every partner without an override is actually billed on every future
-- voice-minute event.

-- Close the currently-open platform-default row (never mutated in place —
-- migration 075's own documented discipline).
UPDATE billing_rate_versions
SET effective_to = NOW()
WHERE partner_account_id IS NULL
  AND event_type = 'voice_minute'
  AND effective_to IS NULL;

-- Open the real, margin-bearing default rate. $0.30/min = 66.7% margin over
-- the $0.10/min conservative cost baseline (90-day real ElevenLabs usage:
-- $24.39 / 294 min ≈ $0.083–$0.10/min), per the CEO Feature Brief's cost
-- analysis. rate_basis documents the actual pricing decision, not a
-- placeholder label — this is real, live pricing.
INSERT INTO billing_rate_versions (partner_account_id, event_type, unit, rate_usd, rate_basis, effective_from)
VALUES (NULL, 'voice_minute', 'minute', 0.30000000, 'usage_pricing_2026_09_margin_66pct_v1', NOW());
```
No schema changes — `billing_rate_versions`, `partner_wallets`, and `usage_events` are structurally
untouched; this migration only writes rows. The per-partner override capability needs no schema change
either (migration 075's `partner_account_id` column and its unique-open-row index already support it) — this
migration file's only job is the default-rate row change; §6.3's admin routes write override rows using the
existing schema as-is, no migration required for that half of this brief.

### 6.3 — New admin API routes: `app/api/admin/sales-partners/[id]/rate/route.ts`

One file, three methods, `requireSuperAdmin()` on all three (mirrors `app/api/admin/sales-partners/[id]/route.ts`'s
exact gate — `internal_staff` is rejected with 403, not merely scope-checked, since a rate override is
account-financial data, not the scoped-viewing use case `requireInternalAdmin()` exists for). Every write
closes the currently-open row and inserts a new one — the table's own "never mutate in place" discipline,
identical to §6.2.

**`GET /api/admin/sales-partners/[id]/rate`**
```typescript
// Response 200
{
  standard_rate_usd: number        // the current platform-default voice_minute rate (0.30 once §6.2 is applied)
  override: {
    rate_usd: number
    effective_from: string          // ISO timestamp
  } | null                          // null = no override set, partner billed at standard_rate_usd
}
```
Re-verifies `account_kind = 'channel_partner'` before returning (same defense-in-depth as the existing
`GET /api/admin/sales-partners/[id]` route) — 404 if not found or wrong kind.

**`PUT /api/admin/sales-partners/[id]/rate`**
```typescript
const SetRateSchema = z.object({
  rate_usd: z.number().gt(0).lt(0.30),   // must be a genuine discount below the live standard rate
})
```
```typescript
// Response 200
{ rate_usd: number, effective_from: string }
```
Server-side re-validation independent of the client-side check in §4.A: rereads the current standard rate
from the platform-default open row at request time (never hardcodes `0.30`, so this route stays correct
automatically if the standard rate ever changes again in the future) and rejects with 422
`{ error: { code: 'rate_not_below_standard', message: 'Custom rate must be below the current standard rate ($X.XX/min).' } }`
if `rate_usd >= standard_rate_usd`. On a valid request: closes this partner's currently-open
`billing_rate_versions` override row for `event_type = 'voice_minute'` if one exists (`effective_to =
NOW()`), then inserts a new row (`partner_account_id = params.id`, `event_type = 'voice_minute'`, `unit =
'minute'`, `rate_usd`, `rate_basis = 'negotiated_override_admin_set'`, `effective_from = NOW()`) — both
writes in one transaction (Supabase RPC or sequential awaited calls guarded by the existing unique-open-row
index as the integrity backstop, matching this codebase's existing non-RPC-transaction convention elsewhere
in `lib/partner/webhooks.ts`).

**`DELETE /api/admin/sales-partners/[id]/rate`**
Closes the currently-open override row (`effective_to = NOW()`) if one exists; inserts no replacement row —
`resolveEffectiveRate()`'s existing fallback logic (no partner-specific row covering `occurredAt` → falls
through to the platform-default row) already handles "no override" correctly with zero code change to that
function. Response 204. If no override row exists to close, still returns 204 (idempotent — clearing an
already-clear override is not an error).

All three responses use this codebase's existing admin-route error envelope shape
(`{ error: { code, message } }` for the two non-2xx statuses defined above), matching
`app/api/admin/billing/checkout/route.ts`'s pattern.

### 6.4 — `SalesPartnerDetailClient.tsx` — new `voice_rate` field on the existing detail fetch

The existing `GET /api/admin/sales-partners/[id]` route (§ read above) is **not** modified to carry this
data — it stays scoped to clients/team/usage as today. The new "Voice rate" card (§4.A) makes its own
independent fetch to `GET /api/admin/sales-partners/[id]/rate` on mount, mirroring the existing component's
own `load()` pattern (separate `loading`/`loadError` local state for this card only) — an error loading the
rate must never block the Clients/Team/Usage cards from rendering, exactly the same fail-independently
discipline `usage.error` already established for the Usage card in this same file.

### 6.5 — Partner dashboard rate display (`_billing-health.ts` + `_shared.tsx`)

`BillingHealth` (`_shared.tsx`) gains one new field:
```typescript
export interface BillingHealth {
  state: BillingHealthState
  balance_usd: number | null
  next_billing_date: string | null
  voice_rate_usd: number | null   // NEW — this partner's own effective voice_minute rate; null only when balance_usd is also null (no wallet yet, §4.C)
}
```
`getBillingHealth()` (`_billing-health.ts`) adds one additional read after its existing `partner_wallets`
query, only when a wallet row was found: queries `billing_rate_versions` for this `partner_account_id` +
`event_type = 'voice_minute'` with `effective_to IS NULL`; if no partner-specific open row, falls back to
the platform-default open row (`partner_account_id IS NULL`) — the same two-step resolution
`resolveEffectiveRate()` already performs, reimplemented here as a direct read (not a call into
`resolveEffectiveRate()` itself, which takes an `occurredAt` and is designed for the billing-event hot path,
not a "what's true right now" dashboard read) for consistency with this file's existing direct-Supabase-read
style. Fail-open, matching this file's existing discipline: any error or no rate configured at all resolves
`voice_rate_usd: null`, never blocks the wallet balance from rendering.

## 7. Success Criteria (Acceptance Tests)

✓ Given the migration in §6.2 has been applied, when a partner with no override generates a voice-minute
usage event, then `applyWalletDecrement()` charges `quantity * 0.30`, unchanged code path.

✓ Given a super-admin sets a partner's override to `$0.20/min` via `PUT /api/admin/sales-partners/[id]/rate`,
when that partner's next voice-minute usage event is recorded, then `resolveEffectiveRate()` returns the
`$0.20` override row (unmodified function, existing partner-override-wins-over-default logic) and the wallet
is decremented at `$0.20/min`, not `$0.30/min`.

✓ Given a super-admin attempts to set an override at `$0.35/min` (above the standard rate), when the request
is submitted, then the server rejects with 422 `rate_not_below_standard` and no row is written.

✓ Given a super-admin clears an existing override via `DELETE`, when the next voice-minute usage event for
that partner is recorded, then it is billed at the platform-default rate (`$0.30/min` once §6.2 is applied),
confirming `resolveEffectiveRate()`'s existing fallback needs no code change.

✓ Given a partner's `usage_events` rows recorded before a rate change (default or override), when
`billing_rate_versions` is later changed again, then those historical rows' `amount_usd`/
`billing_rate_version_id` remain exactly as originally recorded — confirming this brief's new write paths
(§6.2, §6.3) don't disturb the existing "never mutate in place, historical rows keep citing their original
rate" guarantee, since both only ever `UPDATE effective_to` on the currently-open row and `INSERT` a new one,
identically to migration 075's own established pattern.

✓ Given no partner-facing or public page in this codebase today (`app/(with-clerk)/dashboard/**`, marketing
pages), when searched for any UI element offering to request, view as an option, or self-select a discount,
then none exists — the only two surfaces touching an override are the super-admin-gated `/rate` routes
(§6.3) and the discounted partner's own plain rate number (§4.C), which carries no language implying a
discount was granted.

✓ Given a partner viewing their own dashboard "Wallet" card, when they have a wallet but no override, then
they see `$0.30/min for voice`; given a partner with an override, they see their own override figure in
identical styling — no visual or textual distinction between the two cases.

✓ Given the four `MINUTE_BUNDLES` preset buttons on the "Pay as you go" card, when a partner clicks
"1,500 minutes — $450", then `topupAmount` is set to `450` and the existing `startCheckout()` flow proceeds
unchanged, creating a Stripe Checkout session for `$450`.

✓ Given the existing custom top-up amount field, when a partner enters `$75` (not matching any bundle), then
it behaves exactly as it does today — unaffected by this brief.

## 8. Error States

| Failure | Response / UI |
|---|---|
| `GET /rate` fails (network or 5xx) | Voice rate card shows inline red "Couldn't load rate. Try refreshing." — does not block Clients/Team/Usage cards |
| `PUT /rate` with `rate_usd >= standard_rate_usd` | 422 `rate_not_below_standard`; input row stays open with inline error, typed value preserved |
| `PUT /rate` with `rate_usd <= 0` or non-numeric | Zod validation failure, 422 `Validation failed`; same inline error treatment |
| `PUT`/`DELETE /rate` network failure | Inline red "Couldn't save. Try again."; input row (for PUT) stays open |
| Migration (§6.2) not yet applied | `resolveEffectiveRate()` continues resolving the placeholder `$0.015` default — no new failure mode, existing behavior, until Arun applies it |
| `_billing-health.ts`'s new rate lookup fails | `voice_rate_usd: null`; Wallet card simply omits the "$X/min for voice" line — balance/next-billing lines render normally (fail-open, matches existing convention) |
| Non-super-admin (including `internal_staff`) calls any `/rate` route | 403 `forbidden`, `requireSuperAdmin()`'s existing behavior, unmodified |

## 9. Edge Cases

- **`internal_staff` role must never manage rate overrides.** Confirmed by design choice in §6.3: these
  routes use `requireSuperAdmin()` (hard-rejects `internal_staff`), not `requireInternalAdmin()` (which
  would merely scope-check). A rate override is a pricing/financial decision, not an operational task
  `internal_staff` are scoped to handle elsewhere in this codebase.
- **A partner with no wallet yet (`balance_usd === null`) never sees a rate line** (§4.C) — avoids the rate
  reading as a price quote/offer before any funding relationship exists. The moment a wallet row exists
  (including a genuine `$0` balance), the rate line appears.
  Two nested Supabase reads per dashboard load (wallet, then rate) mirrors this file's existing single-read
  pattern one level deeper — acceptable given this page's existing read-heavy, cache-free convention; no new
  caching mechanism is introduced by this brief.
- **Setting an override, then later lowering the standard rate below it.** Example: standard is $0.30,
  partner override is $0.25 (a real discount at the time). Arun later changes the standard rate to $0.20 via
  a future, separate migration/process (out of scope for this brief's own routes, which only write the
  override side). The override row is untouched — `resolveEffectiveRate()`'s existing partner-row-wins logic
  means that partner is now billed *above* the new standard ($0.25 vs $0.20), the opposite of a discount.
  This brief does not add any automatic reconciliation for that scenario — it did not exist before this
  brief (the override mechanism is new) and is a known, accepted edge case of the versioned-rate design
  itself, not something PRICING-01 must additionally solve; Arun (or a future admin action) would need to
  independently review/clear stale overrides after any future standard-rate change. Flagged here for the
  record, not built.
- **Clearing an override that was never set.** `DELETE` finds no open partner-specific row to close;
  returns 204 anyway (§6.3) — idempotent, not an error.
- **Concurrent `PUT` calls for the same partner (e.g., two admin browser tabs).** The existing unique
  "at most one open-ended row per (partner_account_id, event_type)" index (migration 075) is the real
  integrity backstop — a second concurrent insert targeting an already-closed-then-reopened window is
  prevented at the DB layer; the API layer does not add its own additional locking beyond what that index
  already guarantees, consistent with how `billing_rate_versions` writes are handled everywhere else in this
  codebase (no additional application-level lock elsewhere either).
- **Migration 121 is written but not applied.** Every acceptance test above that depends on the real $0.30
  default (as opposed to the override mechanism, which works identically regardless of what the default
  currently is) is describing post-application behavior. Pre-application, the platform default remains
  `$0.015` and every non-overridden partner continues being billed at that placeholder rate — this is the
  explicit, deliberate state until Arun's separate go-ahead (Known Constraints).
- **Mobile / responsive.** The Voice rate card (§4.A) and the Wallet card's new rate line (§4.C) are both
  touched screens under the project's standing responsive rule — both reuse existing components
  (`SalesPartnerDetailClient.tsx`'s existing card pattern, already responsive via its `p-4 md:p-6` classes;
  `PaymentConfigClient.tsx`'s existing `flexWrap: 'wrap'` button row, which the four `MINUTE_BUNDLES`
  buttons inherit unchanged) rather than introducing new fixed-width layout, so no additional responsive
  work is needed beyond what those existing containers already provide.

## 10. Out of Scope

- Any change to `resolveEffectiveRate()`, `applyWalletDecrement()`, or `recordBillableEvent()` in
  `lib/partner/webhooks.ts` — this brief writes new rows into the table those functions already read; it
  does not modify the functions themselves.
- Any change to `plan_tiers_and_topups` (B2B-13) — `PLAN_TIERS`, `lib/billing/plan-tiers.ts`, and the
  recurring Plan-subscription checkout flow are completely untouched. `MINUTE_BUNDLES` is a structurally
  separate, parallel catalog for the pre-existing ad-hoc top-up mechanism only.
- Any real Stripe Price object creation — no `stripe.products.create`/`stripe.prices.create` call is added
  anywhere; the top-up flow already uses one-time Checkout Sessions built from a raw `amount_usd` (not a
  pre-created Stripe Price), so `MINUTE_BUNDLES` needs no Stripe-side object at all, unlike `PLAN_TIERS`'s
  env-var-referenced Price IDs.
- Rate overrides for any `event_type` other than `voice_minute` — the seven `llm_generation_*` event types
  are untouched; they remain unrated (`billed = false`) exactly as migration 075 left them, per that
  migration's own documented, deliberate scope boundary.
- Any UI, copy, or mechanism that lets a partner request, preview, or self-select a discount — explicitly
  forbidden by the Feature Brief; confirmed absent by design throughout §4 and §7's acceptance tests.
- Tax handling of any kind — Stripe Tax handles this separately at checkout, per the Feature Brief.
- Automatic reconciliation of an override against a future standard-rate change (§9) — flagged as a known
  edge case, not built.
- Applying migration 121 to the live database — written and reviewed here; application requires Arun's
  separate, explicit go-ahead per the Known Constraints.

## 11. Open Questions

None.

## 12. Files Changed

**New files:**
- `lib/billing/minute-bundles.ts` — `MINUTE_BUNDLES` catalog + `formatBundleLabel()` (§6.1).
- `supabase/migrations/121_pricing01_voice_minute_default_and_override_capability.sql` — written, not
  applied (§6.2).
- `app/api/admin/sales-partners/[id]/rate/route.ts` — `GET`/`PUT`/`DELETE` (§6.3).

**Modified files:**
- `app/(with-clerk)/dashboard/configurator/PaymentConfigClient.tsx` — delete `TOPUP_PRESETS_USD` (line 28);
  replace the preset-button render block (lines 292–310) with a `MINUTE_BUNDLES` map; custom-amount field
  unchanged (§6.1, §4.B).
- `app/(with-clerk)/dashboard/admin/sales-partners/[id]/SalesPartnerDetailClient.tsx` — new "Voice rate"
  card, inserted between the existing Usage and Team cards, with its own independent fetch/loading/error
  state (§4.A, §6.4).
- `app/(with-clerk)/dashboard/configurator/_shared.tsx` — `BillingHealth` interface gains `voice_rate_usd:
  number | null` (§6.5).
- `app/(with-clerk)/dashboard/configurator/_billing-health.ts` — `getBillingHealth()` adds the
  `billing_rate_versions` lookup and populates `voice_rate_usd` (§6.5).
- `app/(with-clerk)/dashboard/configurator/DashboardPanel.tsx` — `WalletArea` renders the new
  "$X.XX/min for voice" line (§4.C).

**Not modified (confirmed in scope investigation, listed so it isn't re-checked later):**
- `lib/partner/webhooks.ts` — `resolveEffectiveRate`/`applyWalletDecrement`/`recordBillableEvent` all reused
  as-is.
- `app/api/partner/v1/wallet/route.ts` — already returns override-aware `burn_rate_by_event_type` to a
  partner via their own API; no change needed for this brief's dashboard-UI display, which reads server-side
  via `_billing-health.ts` instead (existing pattern for that page, not this route).
- `lib/billing/plan-tiers.ts`, `PLAN_TIERS` — untouched, per Known Constraints.
- `app/api/admin/billing/checkout/route.ts` — unaffected; continues accepting any `amount_usd` in its
  existing `$20`–`$50,000` bounds regardless of whether it came from a bundle button or the custom field.
