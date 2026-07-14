import crypto from 'crypto'

/**
 * B2B-02 — HMAC-SHA256 signing for outbound usage webhooks.
 *
 * Mirrors Stripe's header format exactly (architecture.md Section 7.2):
 *   Clio-Signature: t=<unix_ts>,v1=<hex_hmac>
 *   hex_hmac = HMAC-SHA256(signing_secret, `${t}.${raw_body}`)
 *
 * Same discipline as `stripe.webhooks.constructEvent` per CLAUDE.md — uses
 * Node's built-in `crypto`, not a new dependency. `verifyClioSignature` is the
 * reference implementation of what a partner is expected to run on their own
 * side (documented in architecture.md Section 7.2); it also gives this
 * codebase's own test suite a way to prove the signature genuinely covers the
 * body (Section 7's HMAC tamper-detection acceptance test) without needing a
 * real partner endpoint.
 */

const HEADER_NAME = 'Clio-Signature'
const DEFAULT_TOLERANCE_SECONDS = 5 * 60 // 5-minute replay window, per architecture.md Section 7.2

/** Computes the raw hex HMAC-SHA256 for a given timestamp + body, using the partner's signing secret. */
export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

/** Builds the full `Clio-Signature` header value for an outbound webhook request. */
export function buildSignatureHeader(secret: string, rawBody: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, rawBody)}`
}

export { HEADER_NAME as CLIO_SIGNATURE_HEADER }

interface ParsedSignatureHeader {
  timestamp: number
  signature: string
}

function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const [k, v] = kv.split('=')
      return [k?.trim(), v?.trim()]
    })
  )
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1 || !/^\d+$/.test(t)) return null
  return { timestamp: Number(t), signature: v1 }
}

/**
 * Verifies a `Clio-Signature` header against a raw body and shared secret.
 * This is the partner-side pattern documented in architecture.md Section 7.2
 * (HMAC recompute + constant-time compare + timestamp tolerance window,
 * rejecting anything older as a potential replay). Returns a discriminated
 * result so callers/tests can distinguish "signature mismatch" from "stale
 * timestamp" from "malformed header" — all are rejections, but the reason
 * matters for the acceptance tests.
 */
export function verifySignature(
  secret: string,
  rawBody: string,
  header: string,
  options?: { toleranceSeconds?: number; now?: number }
): { valid: true } | { valid: false; reason: 'malformed_header' | 'signature_mismatch' | 'timestamp_too_old' } {
  const parsed = parseSignatureHeader(header)
  if (!parsed) return { valid: false, reason: 'malformed_header' }

  const tolerance = options?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  const now = options?.now ?? Math.floor(Date.now() / 1000)

  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { valid: false, reason: 'timestamp_too_old' }
  }

  const expected = computeSignature(secret, parsed.timestamp, rawBody)
  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(parsed.signature, 'hex')

  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'signature_mismatch' }
  }

  return { valid: true }
}
