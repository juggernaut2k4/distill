import crypto from 'crypto'

/**
 * B2B-02 — Partner API key generation & hashing.
 *
 * Format: `clio_live_sk_<48 hex chars>` / `clio_test_sk_<48 hex chars>`, matching
 * `partner_api_keys.mode` (docs/specs/B2B-02-requirement-document.md Section
 * "API key format"). Only `key_prefix` (first ~20 chars, display-safe) and
 * `key_hash` (SHA-256 hex digest of the full key) are ever stored — the
 * plaintext key is returned to the caller exactly once, at issuance, and never
 * persisted anywhere.
 */

export type PartnerApiKeyMode = 'test' | 'live'

export interface GeneratedApiKey {
  /** Full plaintext key. Shown to the caller exactly once — never store this value. */
  key: string
  /** First 20 chars of `key` — safe to display/log (e.g. "key ending in ...a1b2"). */
  keyPrefix: string
  /** SHA-256 hex digest of `key` — the only form ever persisted. */
  keyHash: string
}

/** Generates a new partner API key of the given mode. Never logs the plaintext value. */
export function generateApiKey(mode: PartnerApiKeyMode): GeneratedApiKey {
  const random = crypto.randomBytes(24).toString('hex') // 48 hex chars
  const key = `clio_${mode}_sk_${random}`
  return {
    key,
    keyPrefix: key.slice(0, 20),
    keyHash: hashApiKey(key),
  }
}

/** SHA-256 hex digest of a plaintext key — used both at issuance and at every auth lookup. */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

/** Basic shape check before attempting a hash lookup — avoids a DB round-trip for obviously-malformed input. */
export function looksLikePartnerApiKey(value: string): boolean {
  return /^clio_(live|test)_sk_[a-f0-9]{48}$/.test(value)
}
