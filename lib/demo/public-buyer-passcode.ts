import crypto from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * DEMO-PASSCODE-01 (docs/specs/DEMO-PASSCODE-01-requirement-document.md §6.3). Passcode
 * generation/hashing/resolution for the public $10 demo-passcode buyer model.
 *
 * Deliberately its own file, never merged into `lib/demo/passcode-accounts.ts` — the two models
 * must stay structurally separate; a public buyer's table has no `partner_account_id` at all, so a
 * shared function signature would need to fake one. Mirrors that file's hashing/generation
 * *discipline* only (format, SHA-256-hash-at-rest, plaintext-shown-once), not its code.
 *
 * Same 31-symbol unambiguous alphanumeric alphabet / 10-char / XXXX-XXXXXX format as
 * lib/demo/passcode-accounts.ts's generateDemoPasscode() — mirrors that file's format discipline,
 * not its code.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 31 symbols — excludes O, I, L, 0, 1
const PASSCODE_LENGTH = 10
const PREFIX_LENGTH = 4

export interface GeneratedPublicDemoPasscode {
  /** Plaintext, e.g. "XK7P-4QRT9M" — returned to the caller exactly once. Never persisted. */
  passcode: string
  /** SHA-256 hex digest of the passcode WITH hyphen stripped — only persisted form. */
  passcodeHash: string
  /** First 4 chars, display-safe only. */
  passcodePrefix: string
}

/**
 * Generates a new plaintext public-buyer demo passcode and its persisted (hash-only) form. Never
 * logs the plaintext. crypto.randomInt-based, per B2B-39's own format.
 */
export function generatePublicDemoPasscode(): GeneratedPublicDemoPasscode {
  let raw = ''
  for (let i = 0; i < PASSCODE_LENGTH; i++) {
    raw += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
  }
  const passcode = `${raw.slice(0, PREFIX_LENGTH)}-${raw.slice(PREFIX_LENGTH)}`
  return {
    passcode,
    passcodeHash: hashPublicDemoPasscode(passcode),
    passcodePrefix: raw.slice(0, PREFIX_LENGTH),
  }
}

/**
 * Same normalization as hashDemoPasscode() — strips whitespace/hyphens, uppercases, SHA-256 hex.
 */
export function hashPublicDemoPasscode(candidate: string): string {
  const normalized = candidate.replace(/[\s-]/g, '').toUpperCase()
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

export interface ResolvedPublicDemoPasscode {
  id: string
  buyerEmail: string
  usesRemaining: number
}

/**
 * Read-only lookup: `public_demo_passcodes WHERE passcode_hash = hashPublicDemoPasscode(candidate)
 * AND uses_remaining > 0`. Returns null both for "no such passcode" and "passcode exists but is
 * already fully spent" — deliberately indistinguishable to the caller, matching this feature's own
 * fail-closed, non-leaking error posture (§8). Used only by the widget-dispatch route, as the SECOND
 * resolution attempt after resolveDemoPasscodeToAccount() (the B2B-39 reseller model) returns null.
 */
export async function resolvePublicDemoPasscode(candidate: string): Promise<ResolvedPublicDemoPasscode | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('public_demo_passcodes')
    .select('id, buyer_email, uses_remaining')
    .eq('passcode_hash', hashPublicDemoPasscode(candidate))
    .gt('uses_remaining', 0)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id as string,
    buyerEmail: data.buyer_email as string,
    usesRemaining: data.uses_remaining as number,
  }
}

/**
 * Atomically decrements uses_remaining by 1, floored at 0 by the WHERE clause (never goes negative):
 * `UPDATE public_demo_passcodes SET uses_remaining = uses_remaining - 1 WHERE id = $1 AND
 * uses_remaining > 0 RETURNING uses_remaining`. Returns the new uses_remaining, or null if the row
 * was already at 0 (a race — see §9). Called ONLY after a successful upstream widget-session dispatch
 * (§6.6 step 3) — a passcode's use is spent by a session that actually happened, not merely by
 * passing the auth check.
 *
 * Supabase-js has no native "column = column - 1" update expression, so the atomic decrement is
 * expressed as a Postgres RPC (`consume_public_demo_passcode_use`, defined alongside the two new
 * tables in supabase/migrations/119_demo_passcode01_public_buyer_passcodes.sql), mirroring this
 * codebase's own existing pattern for every other atomic balance mutation (e.g.
 * credit_wallet_balance, credit_test_minutes_balance in lib/stripe.ts's callers).
 */
export async function consumePublicDemoPasscodeUse(passcodeId: string): Promise<number | null> {
  const supabase = createSupabaseAdminClient()
  const { data: newUsesRemaining, error } = await supabase.rpc('consume_public_demo_passcode_use', {
    p_passcode_id: passcodeId,
  })

  if (error) {
    console.error('[public-buyer-passcode] consumePublicDemoPasscodeUse RPC failed:', error.message)
    return null
  }

  return newUsesRemaining === null || newUsesRemaining === undefined ? null : (newUsesRemaining as number)
}
