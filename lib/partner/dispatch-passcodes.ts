import crypto from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-78 (docs/specs/B2B-78-requirement-document.md §6.4). Per-sales-partner-client passcode
 * generation, hashing, and dispatch-time resolution — mirrors `lib/demo/passcode-accounts.ts`'s
 * proven B2B-39 shape exactly, scoped one level finer: one active passcode per
 * (partner_account_id, client_id) pairing rather than per partner_account_id alone.
 *
 * Format, alphabet, and hashing discipline are byte-identical to the demo passcode's own design
 * (same 31-symbol unambiguous alphabet, same 10-character length, same hyphen-after-4th-char
 * cosmetic display, same SHA-256-of-normalized-candidate persistence) — no reason to diverge from
 * an already-proven format for a structurally identical credential.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 31 symbols — excludes O, I, L, 0, 1
const PASSCODE_LENGTH = 10
const PREFIX_LENGTH = 4

export interface GeneratedDispatchPasscode {
  /** Plaintext, e.g. "XK7P-4QRT9M" — shown to the caller exactly once. Never persisted. */
  passcode: string
  /** SHA-256 hex digest of the passcode with hyphen stripped — the only persisted form. */
  passcodeHash: string
  /** First 4 chars, display-safe only. */
  passcodePrefix: string
}

export interface ResolvedDispatchPasscode {
  /** dispatch_passcodes.partner_account_id — the sales-partner. */
  partnerAccountId: string
  /** dispatch_passcodes.client_id — which client this passcode is for. */
  clientId: string
}

/** Generates a new plaintext passcode and its persisted (hash-only) form. Never logs the plaintext. */
export function generateDispatchPasscode(): GeneratedDispatchPasscode {
  let raw = ''
  for (let i = 0; i < PASSCODE_LENGTH; i++) {
    raw += ALPHABET[crypto.randomInt(0, ALPHABET.length)]
  }
  const passcode = `${raw.slice(0, PREFIX_LENGTH)}-${raw.slice(PREFIX_LENGTH)}`
  return {
    passcode,
    passcodeHash: hashDispatchPasscode(passcode),
    passcodePrefix: raw.slice(0, PREFIX_LENGTH),
  }
}

/**
 * Normalizes a hand-typed/submitted candidate (strips whitespace and hyphens, uppercases) then
 * SHA-256 hex-digests it, so "XK7P4QRT9M" / "xk7p-4qrt9m" / "XK7P 4QRT9M" all resolve identically.
 */
export function hashDispatchPasscode(candidate: string): string {
  const normalized = candidate.replace(/[\s-]/g, '').toUpperCase()
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

/**
 * Single indexed lookup: `dispatch_passcodes WHERE passcode_hash = ... AND revoked_at IS NULL`.
 * Returns the sales-partner + client identity to reserve against, or `null` if no active passcode
 * matches. Used by `POST /api/partner/v1/bot-dispatch`.
 */
export async function resolveDispatchPasscode(candidate: string): Promise<ResolvedDispatchPasscode | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('dispatch_passcodes')
    .select('partner_account_id, client_id')
    .eq('passcode_hash', hashDispatchPasscode(candidate))
    .is('revoked_at', null)
    .maybeSingle()

  if (!data) return null
  return { partnerAccountId: data.partner_account_id as string, clientId: data.client_id as string }
}
