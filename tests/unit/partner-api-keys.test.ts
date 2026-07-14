import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey, looksLikePartnerApiKey } from '@/lib/partner/api-keys'

describe('partner/api-keys — generateApiKey', () => {
  it('generates a live key matching the clio_live_sk_... format', () => {
    const { key, keyPrefix, keyHash } = generateApiKey('live')
    expect(key).toMatch(/^clio_live_sk_[a-f0-9]{48}$/)
    expect(keyPrefix).toBe(key.slice(0, 20))
    expect(keyHash).toBe(hashApiKey(key))
  })

  it('generates a test key matching the clio_test_sk_... format', () => {
    const { key } = generateApiKey('test')
    expect(key).toMatch(/^clio_test_sk_[a-f0-9]{48}$/)
  })

  it('never returns the same key twice', () => {
    const a = generateApiKey('live')
    const b = generateApiKey('live')
    expect(a.key).not.toBe(b.key)
    expect(a.keyHash).not.toBe(b.keyHash)
  })

  it('hashApiKey is deterministic for the same input', () => {
    const { key } = generateApiKey('live')
    expect(hashApiKey(key)).toBe(hashApiKey(key))
  })
})

describe('partner/api-keys — looksLikePartnerApiKey', () => {
  it('accepts a well-formed generated key', () => {
    expect(looksLikePartnerApiKey(generateApiKey('live').key)).toBe(true)
    expect(looksLikePartnerApiKey(generateApiKey('test').key)).toBe(true)
  })

  it('rejects malformed values', () => {
    expect(looksLikePartnerApiKey('')).toBe(false)
    expect(looksLikePartnerApiKey('not-a-key')).toBe(false)
    expect(looksLikePartnerApiKey('clio_live_sk_tooshort')).toBe(false)
    expect(looksLikePartnerApiKey('sk_live_stripestylekey')).toBe(false)
    expect(looksLikePartnerApiKey('clio_prod_sk_' + 'a'.repeat(48))).toBe(false)
  })
})
