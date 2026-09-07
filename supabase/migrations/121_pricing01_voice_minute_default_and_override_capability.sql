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
