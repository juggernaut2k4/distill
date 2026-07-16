import crypto from 'crypto'

/**
 * B2B-06 — OAuth2 Client Credentials (RFC 6749 §4.4) client generation, secret
 * hashing, and hand-rolled HS256 JWT sign/verify.
 *
 * Mirrors `lib/partner/api-keys.ts`'s exact shape for the generation/hash
 * half. No external JWT library — `package.json` has none, and this follows
 * the exact precedent `lib/partner/webhook-signature.ts` already set for
 * hand-rolled HMAC primitives on Node's built-in `crypto`, per CLAUDE.md's
 * no-new-dependency-without-justification rule.
 *
 * architecture.md §18.2, docs/specs/B2B-06-requirement-document.md Section 4.B.2.
 */

export type OAuthClientMode = 'test' | 'live'

export interface GeneratedOAuthClient {
  clientId: string
  /** Full plaintext secret. Shown to the caller exactly once — never store this value. */
  clientSecret: string
  clientSecretHash: string
}

/** Generates a new OAuth2 client_id/client_secret pair. Never logs the plaintext secret. */
export function generateOAuthClient(mode: OAuthClientMode): GeneratedOAuthClient {
  const clientId = `clio_client_${crypto.randomBytes(16).toString('hex')}`
  const clientSecret = `clio_secret_${crypto.randomBytes(24).toString('hex')}`
  return { clientId, clientSecret, clientSecretHash: hashClientSecret(clientSecret) }
}

/** SHA-256 hex digest of a plaintext client secret — the only form ever persisted. */
export function hashClientSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex')
}

/** 3-segment JWT shape check — cheap pre-filter before attempting signature verification. */
export function looksLikeOAuthAccessToken(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
}

export interface OAuthTokenClaims {
  sub: string // client_id
  partner_account_id: string
  mode: OAuthClientMode
  iat: number
  exp: number
  jti: string
}

const TOKEN_TTL_SECONDS = 3600 // 1 hour — BA technical judgment call, Requirement Doc Section 4.B.2

function deriveSigningSecret(): string {
  const secret = process.env.PARTNER_OAUTH_TOKEN_SIGNING_SECRET
  return secret && !secret.startsWith('PLACEHOLDER_') ? secret : 'clio-dev-only-fallback-oauth-signing-key'
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/** Signs a hand-rolled HS256 JWT. No external JWT library — see file header. */
export function signAccessToken(
  clientId: string,
  partnerAccountId: string,
  mode: OAuthClientMode
): { token: string; expiresIn: number } {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claims: OAuthTokenClaims = {
    sub: clientId,
    partner_account_id: partnerAccountId,
    mode,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
  }
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(claims))
  const signature = crypto
    .createHmac('sha256', deriveSigningSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url')
  return { token: `${encodedHeader}.${encodedPayload}.${signature}`, expiresIn: TOKEN_TTL_SECONDS }
}

/** Verifies signature + expiry only (stateless) — caller is responsible for the DB status checks (lib/partner/auth.ts). */
export function verifyAccessToken(token: string): { valid: true; claims: OAuthTokenClaims } | { valid: false } {
  const parts = token.split('.')
  if (parts.length !== 3) return { valid: false }
  const [encodedHeader, encodedPayload, signature] = parts

  const expectedSig = crypto
    .createHmac('sha256', deriveSigningSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url')

  const expectedBuf = Buffer.from(expectedSig)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false }
  }

  try {
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as OAuthTokenClaims
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return { valid: false }
    return { valid: true, claims }
  } catch {
    return { valid: false }
  }
}
