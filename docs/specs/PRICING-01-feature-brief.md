# PRICING-01 — Usage Pricing ($0.30/min) + Admin-Only Per-Partner Discount: Feature Brief

**Author:** CEO Agent
**Date:** 2026-09-06
**Status:** Approved — ready for BA spec
**From:** CEO (Arun, via orchestrator dispatch 2026-09-06)
**Priority:** P0

---

## What Arun Said

After a full cost/pricing analysis session (real ElevenLabs usage data cross-referenced against
Clio's own session logs — 90-day usage: $24.39 / 294 min ≈ $0.083–$0.10/min real cost, used
conservatively at $0.10/min as the pricing baseline; ElevenLabs is the sole active production voice
provider):

1. **Base pricing: $0.30/minute** — a 66.7% margin on the $0.10/min cost baseline. Sold as prepaid
   minute bundles, no setup fee (mandatory or optional):
   - Starter: 500 min → $150
   - Growth: 1,500 min → $450
   - Pro: 5,000 min → $1,500
   - Scale: 10,000 min → $3,000
   - All prices exclusive of tax — Stripe Tax handles tax at checkout separately; no tax logic to build.
2. **Admin-only per-partner discount override.** Super-admin needs to set a custom, discounted
   per-minute rate for a specific partner/sales-partner account (e.g., $0.25 or $0.20/min) for
   negotiated larger-volume deals. Settable only from an admin screen, modeled on the existing
   `requireSuperAdmin()` admin-page pattern. Arun's exact words: *"i dont want to list anywhere in
   the site. maybe that is a special feature for the admin alone."* The discount mechanism itself
   must never appear on any public pricing page or be self-serve-selectable by the partner, and
   should not be visibly advertised as an available option before it's actually granted. Once
   granted, the partner's own billing view should reflect what they're actually being charged.

---

## The Problem Being Solved

Clio has no defined, real (non-placeholder) usage price today. `billing_rate_versions` — the table
that already computes every dollar decremented from a partner's wallet on every voice-minute event
— currently carries only a placeholder rate (`rate_basis = 'cogs_placeholder_2026_05_no_margin'`,
i.e. cost with no margin). Nothing is sold at a real, margin-bearing price yet, and there's no way to
grant a negotiated discount to a specific enterprise/sales-partner deal without hand-editing the
database. This brief turns Arun's cost analysis into the actual live pricing mechanism and adds the
missing negotiated-discount lever.

---

## What Success Looks Like

- The platform-default `voice_minute` billing rate is $0.30/min — every partner without an override
  is billed at that rate on every real usage event, through the exact mechanism already computing
  bills today (`resolveEffectiveRate()` / `applyWalletDecrement()` in `lib/partner/webhooks.ts`).
- A partner's self-serve top-up flow shows the four named minute bundles (Starter/Growth/Pro/Scale)
  with both the price and the minute count, computed from one source-of-truth catalog file — not
  free-typed dollar amounts.
- From the existing admin Sales Partner detail screen, Arun can set (and later change) a specific
  partner's per-minute override rate. That partner is then billed at the override rate on every
  subsequent voice-minute event, automatically, via the same resolution mechanism — no separate
  billing path.
- The override is invisible everywhere except: (a) the admin screen that sets it, and (b) the
  specific partner's own billing/usage view, once granted, where it must show what they're actually
  paying.
- No regression to `plan_tiers_and_topups` (B2B-13)'s recurring Plan-subscription system, which is a
  structurally separate, already-shipped feature this brief does not touch.

---

## Known Constraints (binding)

- **Do not build a second billing/rate engine.** `billing_rate_versions` +
  `resolveEffectiveRate()` + `applyWalletDecrement()` (migration `075_b2b04_billing_metering.sql`,
  `lib/partner/webhooks.ts`) already implement exactly the semantics this brief needs: a
  platform-default rate per `event_type`, an optional partner-specific override that wins when
  present, versioned so historical `usage_events` rows keep citing the rate genuinely in effect at
  the time — never mutated in place. The $0.30 base price and the admin discount override are both
  **new rows in this existing table**, not new infrastructure. This is a technical/architecture
  decision the CEO agent is making directly, with evidence (see BA brief-input research below) —
  document it in the spec's Section on Technical Decisions rather than re-deriving it.
- **Prepaid minute bundles are top-ups, not Plan-tier subscriptions.** They map onto the existing
  ad-hoc top-up flow (`funding_mechanism = 'checkout_topup'`, one-time Stripe Checkout session,
  `partner_wallets.balance_usd` credited) — the same mechanism behind
  `PaymentConfigClient.tsx`'s current `TOPUP_PRESETS_USD = [50, 100, 250, 500]`. They are NOT
  `plan_tiers_and_topups` (B2B-13)'s recurring monthly/annual Plan subscriptions
  (`lib/billing/plan-tiers.ts`, `PLAN_TIERS`) — that system stays exactly as-is, untouched, running
  in parallel. BA must confirm this in the spec and flag it as a decision, not silently merge the two.
- **The four minute bundles replace the current arbitrary flat-dollar presets**
  (`TOPUP_PRESETS_USD`) with a named, minute-labeled catalog — same UI slot, new content, driven by
  one new catalog file (mirror the existing `lib/billing/plan-tiers.ts` pattern: a single typed
  array `MINUTE_BUNDLES`, so price and minute-label can never drift apart). Custom/arbitrary top-up
  amount (the existing free-text $20–$50,000 entry) may remain — BA to decide whether it stays
  alongside the four named bundles or is removed; default to keeping it unless there's a clear
  reason not to (it's the general-purpose top-up path other flows may depend on).
- **Admin discount override UI location:** the existing admin Sales Partner detail screen
  (`app/(with-clerk)/dashboard/admin/sales-partners/[id]/SalesPartnerDetailClient.tsx` +
  `app/api/admin/sales-partners/[id]/route.ts`), gated by `requireSuperAdmin()` exactly like every
  other route under `app/api/admin/`. New admin API route(s) needed to read/write the
  partner-specific `billing_rate_versions` row for `event_type = 'voice_minute'` (close the
  currently-open row if one exists, insert a new one — mirrors the "never mutate in place"
  discipline already documented on that table).
- **Partner-facing rate visibility:** `GET /api/partner/v1/wallet` already resolves and returns the
  effective (override-aware) rate per event type to the partner via their own API
  (`app/api/partner/v1/wallet/route.ts`). BA must confirm whether any partner-facing dashboard page
  actually renders this field today, and if not, specify the minimal display needed so a
  discounted partner can see the rate they're actually paying (not the discount mechanism itself —
  just their own effective number, same as any partner would see their own standard rate).
- **No new Stripe Price objects in live Stripe** — this codebase's convention (see
  `lib/billing/plan-tiers.ts`'s own header comment, and the `DEMO-PASSCODE-01` precedent) is
  PLACEHOLDER env vars for price IDs, with Arun creating the real Stripe objects himself
  separately. Follow that pattern exactly.
- **Do not silently change the live default billing rate via a Supabase MCP write.** Write the
  migration SQL (versioned close-old/open-new, per the table's existing discipline) but do not
  apply it to the live database without Arun's explicit go-ahead in this same review pass — this
  changes what every partner without an override is actually billed. Flag it clearly for his
  review alongside the rest of the diff, same as the no-commit-without-asking rule.
- Zod validation on all new/changed API inputs. `requireSuperAdmin()` on every admin route. No
  hardcoded secrets. Responsive/mobile-friendly standing rule applies to any admin screen touched.

---

## Questions for BA

None outstanding for the BA to escalate — the two structural ambiguities (bundles vs. Plan-tiers;
where the admin override lives) are resolved above as binding constraints. The BA's job is to turn
these into a complete, literal 12-section requirement document: exact screen copy/layout for the
admin override control (current rate display, input, save, confirmation — no interpretation,
3+ lines with example per the standing UX rule), the exact new admin API request/response shapes
(Zod schemas), the exact `MINUTE_BUNDLES` catalog shape and where `TOPUP_PRESETS_USD` is replaced,
the exact migration SQL for the $0.30 default rate row, and the partner-facing rate-visibility
decision called out above. Section 11 (Open Questions) must be empty before this goes to
development — if the BA hits a genuine new ambiguity this brief didn't anticipate, escalate to CEO
before writing a guess into the spec.
