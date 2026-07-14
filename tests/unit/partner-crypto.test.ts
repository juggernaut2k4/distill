import { describe, it, expect, beforeEach, vi } from 'vitest'
import { encryptOutboundToken, decryptOutboundToken, generateSigningSecret } from '@/lib/partner/crypto'

describe('partner/crypto', () => {
  beforeEach(() => {
    vi.stubEnv('PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY', 'PLACEHOLDER_ENCRYPTION_KEY')
  })

  it('round-trips a plaintext token through encrypt/decrypt', () => {
    const plaintext = 'partner-supplied-secret-token-123'
    const ciphertext = encryptOutboundToken(plaintext)
    expect(decryptOutboundToken(ciphertext)).toBe(plaintext)
  })

  it('never stores the plaintext value in the ciphertext output', () => {
    const plaintext = 'super-secret-value-should-not-appear'
    const ciphertext = encryptOutboundToken(plaintext)
    expect(ciphertext).not.toContain(plaintext)
  })

  it('produces different ciphertext for the same plaintext on repeated calls (random IV)', () => {
    const plaintext = 'same-value'
    const a = encryptOutboundToken(plaintext)
    const b = encryptOutboundToken(plaintext)
    expect(a).not.toBe(b)
    expect(decryptOutboundToken(a)).toBe(plaintext)
    expect(decryptOutboundToken(b)).toBe(plaintext)
  })

  it('decryptOutboundToken returns null (never throws) for malformed input', () => {
    expect(decryptOutboundToken('not-valid-ciphertext')).toBeNull()
    expect(decryptOutboundToken('v1:only:two:parts:toomany')).toBeNull()
    expect(decryptOutboundToken(null)).toBeNull()
    expect(decryptOutboundToken(undefined)).toBeNull()
  })

  it('generateSigningSecret produces a distinct, prefixed secret each call', () => {
    const a = generateSigningSecret()
    const b = generateSigningSecret()
    expect(a).toMatch(/^clio_whsec_[a-f0-9]{48}$/)
    expect(a).not.toBe(b)
  })
})
