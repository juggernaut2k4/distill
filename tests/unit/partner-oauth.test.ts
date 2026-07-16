import { describe, it, expect } from 'vitest'
import crypto from 'crypto'

/**
 * B2B-06 — unit tests for lib/partner/oauth.ts (client generation, secret
 * hashing, hand-rolled HS256 JWT sign/verify). See
 * docs/specs/B2B-06-requirement-document.md Section 7 acceptance criteria.
 */

import {
  generateOAuthClient,
  hashClientSecret,
  looksLikeOAuthAccessToken,
  signAccessToken,
  verifyAccessToken,
} from '@/lib/partner/oauth'

describe('generateOAuthClient', () => {
  it('generates a client_id/client_secret pair with the correct hash relationship', () => {
    const generated = generateOAuthClient('test')
    expect(generated.clientId).toMatch(/^clio_client_[a-f0-9]{32}$/)
    expect(generated.clientSecret).toMatch(/^clio_secret_[a-f0-9]{48}$/)
    expect(generated.clientSecretHash).toBe(hashClientSecret(generated.clientSecret))
  })

  it('never produces the same client_id/client_secret twice', () => {
    const a = generateOAuthClient('live')
    const b = generateOAuthClient('live')
    expect(a.clientId).not.toBe(b.clientId)
    expect(a.clientSecret).not.toBe(b.clientSecret)
  })
})

describe('looksLikeOAuthAccessToken', () => {
  it('accepts a well-formed 3-segment JWT shape', () => {
    expect(looksLikeOAuthAccessToken('aaa.bbb.ccc')).toBe(true)
  })

  it('rejects a static-API-key-shaped value', () => {
    expect(looksLikeOAuthAccessToken('clio_live_sk_abc123')).toBe(false)
  })

  it('rejects a malformed/garbage value', () => {
    expect(looksLikeOAuthAccessToken('not-a-token')).toBe(false)
    expect(looksLikeOAuthAccessToken('a.b')).toBe(false)
  })
})

describe('signAccessToken / verifyAccessToken', () => {
  it('signs a well-formed 3-segment JWT with the correct claims and a 3600s TTL', () => {
    const { token, expiresIn } = signAccessToken('clio_client_abc', 'acct-1', 'live')
    expect(token.split('.')).toHaveLength(3)
    expect(expiresIn).toBe(3600)

    const result = verifyAccessToken(token)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.claims.sub).toBe('clio_client_abc')
      expect(result.claims.partner_account_id).toBe('acct-1')
      expect(result.claims.mode).toBe('live')
      expect(result.claims.exp - result.claims.iat).toBe(3600)
    }
  })

  it('rejects a token with a tampered signature', () => {
    const { token } = signAccessToken('clio_client_abc', 'acct-1', 'live')
    const tampered = token.slice(0, -4) + 'XXXX'
    expect(verifyAccessToken(tampered).valid).toBe(false)
  })

  it('rejects a malformed (non-3-segment) token', () => {
    expect(verifyAccessToken('not-a-jwt').valid).toBe(false)
  })

  it('rejects an expired token', () => {
    // Forge a token with an exp in the past, signed the same way signAccessToken would.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const claims = Buffer.from(
      JSON.stringify({ sub: 'clio_client_abc', partner_account_id: 'acct-1', mode: 'live', iat: 0, exp: 1, jti: 'x' })
    ).toString('base64url')
    const signature = crypto
      .createHmac('sha256', 'clio-dev-only-fallback-oauth-signing-key')
      .update(`${header}.${claims}`)
      .digest('base64url')
    const expiredToken = `${header}.${claims}.${signature}`

    expect(verifyAccessToken(expiredToken).valid).toBe(false)
  })
})
