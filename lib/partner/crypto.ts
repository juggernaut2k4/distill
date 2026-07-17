import crypto from 'crypto'

/**
 * B2B-02 — Encryption for `partner_accounts.outbound_auth_token_ciphertext`.
 *
 * The outbound auth token is a credential the PARTNER hands to Clio (never the
 * reverse — see architecture.md "Two Different Auth Directions"). Per the
 * migration's column comment: "Encrypted at rest at the application layer
 * before insert (never store plaintext)." Uses Node's built-in `crypto`
 * (AES-256-GCM) — no new dependency, matching CLAUDE.md's approved-libraries
 * rule.
 *
 * Key source: `PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY` env var (32+ chars,
 * scrypt-derived into a 256-bit key below so the raw env value never needs to
 * be exactly 32 bytes). If unset/placeholder, a fixed dev-only fallback secret
 * is used — tokens are still genuinely encrypted (never plaintext), just not
 * safe for real partner secrets until a real key is set in production. This
 * mirrors the codebase's existing PLACEHOLDER_ convention (e.g. lib/stripe.ts)
 * of never crashing in dev while never silently storing anything sensitive as
 * plaintext.
 */

const ALGO = 'aes-256-gcm'

function deriveKey(): Buffer {
  const secret = process.env.PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY
  const usable = secret && !secret.startsWith('PLACEHOLDER_') ? secret : 'clio-dev-only-fallback-key-do-not-use-in-prod'
  return crypto.scryptSync(usable, 'clio-partner-outbound-token-v1', 32)
}

/**
 * Encrypts a plaintext outbound auth token for storage in
 * `outbound_auth_token_ciphertext`. Output format: `v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>`.
 */
export function encryptOutboundToken(plaintext: string): string {
  const key = deriveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/** Decrypts a value produced by `encryptOutboundToken`. Returns null (never throws) on malformed/corrupt input. */
export function decryptOutboundToken(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null
  const parts = ciphertext.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') return null

  try {
    const [, ivHex, authTagHex, dataHex] = parts
    const key = deriveKey()
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()])
    return decrypted.toString('utf8')
  } catch (err) {
    console.error('[partner/crypto] Failed to decrypt outbound token:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * B2B-19 — Content-source credential encryption.
 *
 * These are deliberate aliases of `encryptOutboundToken`/`decryptOutboundToken`,
 * NOT a parallel implementation. Content-source credentials (a partner's Bearer
 * token, or an OAuth2 `{client_id, client_secret}` blob for the partner's own
 * server) are the same threat model as the outbound auth token: a credential
 * Clio must replay OUTWARD to authenticate to someone else's server, so it must
 * be encrypted-and-retrievable, never hashed (do NOT follow `hashApiKey`/
 * `hashClientSecret`, which are for one-way verifying INCOMING secrets Clio
 * never replays). Same AES-256-GCM path, same `PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY`,
 * same `v1:<iv>:<tag>:<data>` format, same null-on-corrupt-never-throws
 * contract (Requirement Doc Section 6.1, BA decision to reuse directly).
 */
export const encryptContentSourceCredential = encryptOutboundToken
export const decryptContentSourceCredential = decryptOutboundToken

/**
 * Generates a new Clio-issued webhook signing secret for a partner account —
 * "shown once in the future partner Configurator UI, like Stripe's whsec_..."
 * (architecture.md Section 1's `outbound_signing_secret` comment). Distinct
 * from the outbound auth token: this proves integrity of what Clio sent, it
 * does not authenticate Clio as a caller.
 */
export function generateSigningSecret(): string {
  return `clio_whsec_${crypto.randomBytes(24).toString('hex')}`
}
