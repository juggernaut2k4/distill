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
