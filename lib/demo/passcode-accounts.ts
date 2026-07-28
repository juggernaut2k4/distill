import crypto from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §6.4). Per-account demo passcode generation,
 * hashing, and dispatch-time resolution. Originally kept in a wholly separate file from
 * `lib/demo/passcode.ts` — that file was deleted as of B2B-42 (docs/specs/B2B-42-requirement-document.md
 * §6.2), once its `verifyDemoPasscode()` (the single shared `DEMO_MEETING_PASSCODE` env var) lost its
 * one remaining caller (the Meeting tab's Save action, which B2B-42 moved onto this file's
 * `resolveDemoPasscodeToAccount()` instead). The Save action's use is gate-only — it never reads
 * `resolved.partnerAccountId` or `resolved.passcodeId` — so this remains a read-only resolution
 * helper with no billing side effect of its own; billing attribution is still written solely by the
 * dispatch route via `demo_dispatches` at dispatch time (§6.9 below, unchanged by B2B-42).
 *
 * Format: 10 characters from a 31-symbol unambiguous alphanumeric alphabet — uppercase A-Z minus
 * {O, I, L} (23 letters) plus digits 0-9 minus {0, 1} (8 digits) = 31 symbols. Generated via
 * `crypto.randomInt(0, 31)` per character (uniform, no modulo-bias risk). Displayed/typed as
 * `XXXX-XXXXXX` (hyphen after the 4th character, purely cosmetic — stripped before hashing/
 * comparison, so a visitor typing it with or without the hyphen both work). Entropy: 31^10 ≈
 * 8.2×10^14.
 *
 * Only the SHA-256 hash (of the hyphen-stripped, uppercased candidate) is ever persisted, mirroring
 * `lib/partner/api-keys.ts`'s `hashApiKey()` discipline — the plaintext is returned to the caller
 * exactly once, at generation/regeneration.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 31 symbols — excludes O, I, L, 0, 1
const PASSCODE_LENGTH = 10
const PREFIX_LENGTH = 4

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §6.4/§6.5, Open Item 2 confirmed) — the "Clio
 * Internal — Public Demo" sentinel `partner_accounts.id`, reused as the admin's own demo-billing
 * target. Hardcoded, not env-var-sourced — admin has no "registration" event to discover it from, and
 * the requirement doc is explicit there is no discovery step for either admin API route. Same literal
 * the migration's one-time 20-minute bootstrap grant uses. (`DEMO_PARTNER_ACCOUNT_ID`, the env var
 * `app/api/demo/[slug]/dispatch/route.ts` and `app/api/demo/[slug]/performance/route.ts` already use,
 * identifies the same row in production — kept as a separate env-var-sourced value there for that
 * pre-existing route's own reasons; this constant is this feature's own, deliberately
 * environment-independent source of truth for "the admin sentinel account".)
 */
export const DEMO_ADMIN_PARTNER_ACCOUNT_ID = '30d40f51-5d6e-49e9-bdda-519b7d70e13a'

export interface GeneratedDemoPasscode {
  /** Plaintext, e.g. "XK7P-4QRT9M" — shown to the caller exactly once. Never persisted. */
  passcode: string
  /** SHA-256 hex digest of the passcode with hyphen stripped — the only persisted form. */
  passcodeHash: string
  /** First 4 chars, display-safe only — used for admin-facing diagnostics, never re-shown as a "starts with" UI. */
  passcodePrefix: string
}

export interface ResolvedDemoPasscode {
  /** demo_passcodes.partner_account_id — the account to bill for this demo session. */
  partnerAccountId: string
  /** demo_passcodes.id — which passcode row was used, for the demo_dispatches audit column. */
  passcodeId: string
}

/** Generates a new plaintext demo passcode and its persisted (hash-only) form. Never logs the plaintext. */
export function generateDemoPasscode(): GeneratedDemoPasscode {
  let raw = ''
  for (let i = 0; i < PASSCODE_LENGTH; i++) {
    raw += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
  }
  const passcode = `${raw.slice(0, PREFIX_LENGTH)}-${raw.slice(PREFIX_LENGTH)}`
  return {
    passcode,
    passcodeHash: hashDemoPasscode(passcode),
    passcodePrefix: raw.slice(0, PREFIX_LENGTH),
  }
}

/**
 * Normalizes a hand-typed candidate (strips whitespace and hyphens, uppercases) then SHA-256
 * hex-digests it — so "XK7P4QRT9M" / "xk7p-4qrt9m" / "XK7P 4QRT9M" all resolve identically.
 */
export function hashDemoPasscode(candidate: string): string {
  const normalized = candidate.replace(/[\s-]/g, '').toUpperCase()
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

/**
 * Single indexed lookup: `demo_passcodes WHERE passcode_hash = hashDemoPasscode(candidate) AND
 * revoked_at IS NULL`. Returns the billing account id AND the passcode row id (needed by the
 * dispatch route to populate `demo_dispatches.demo_passcode_id` — §6.9 point 4) or `null` if no
 * active passcode matches. Used by both the dispatch route (which additionally reads
 * `partnerAccountId`/`passcodeId` for billing attribution) and, as of B2B-42, the Meeting tab's Save
 * action (gate-only — the resolved account/passcode identity is never read or stored there).
 */
export async function resolveDemoPasscodeToAccount(candidate: string): Promise<ResolvedDemoPasscode | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('demo_passcodes')
    .select('id, partner_account_id')
    .eq('passcode_hash', hashDemoPasscode(candidate))
    .is('revoked_at', null)
    .maybeSingle()

  if (!data) return null
  return { partnerAccountId: data.partner_account_id as string, passcodeId: data.id as string }
}
