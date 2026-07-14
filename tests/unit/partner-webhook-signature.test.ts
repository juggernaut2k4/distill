import { describe, it, expect } from 'vitest'
import { buildSignatureHeader, verifySignature, computeSignature } from '@/lib/partner/webhook-signature'

/**
 * B2B-02 acceptance tests (docs/specs/B2B-02-requirement-document.md Section
 * 7): the HMAC genuinely covers the body (tamper detection), and a stale
 * timestamp is rejected as a potential replay.
 */

const SECRET = 'test-signing-secret'

describe('partner/webhook-signature', () => {
  it('a freshly signed payload verifies successfully', () => {
    const body = JSON.stringify({ event_type: 'usage.voice_minute', quantity: 1.5 })
    const header = buildSignatureHeader(SECRET, body)
    const result = verifySignature(SECRET, body, header)
    expect(result.valid).toBe(true)
  })

  it('rejects a tampered body — signature does not match after modification (proves the HMAC genuinely covers the body)', () => {
    const originalBody = JSON.stringify({ event_type: 'usage.voice_minute', quantity: 1.5 })
    const header = buildSignatureHeader(SECRET, originalBody)

    const tamperedBody = JSON.stringify({ event_type: 'usage.voice_minute', quantity: 999 })
    const result = verifySignature(SECRET, tamperedBody, header)

    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('signature_mismatch')
  })

  it('rejects a signature computed with the wrong secret', () => {
    const body = JSON.stringify({ event_type: 'session.completed' })
    const header = buildSignatureHeader('wrong-secret', body)
    const result = verifySignature(SECRET, body, header)
    expect(result.valid).toBe(false)
  })

  it('rejects a timestamp older than the 5-minute tolerance window (replay protection)', () => {
    const body = JSON.stringify({ event_type: 'usage.llm_generation_call', quantity: 1 })
    const sixMinutesAgo = Math.floor(Date.now() / 1000) - 6 * 60
    const header = buildSignatureHeader(SECRET, body, sixMinutesAgo)

    const result = verifySignature(SECRET, body, header)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('timestamp_too_old')
  })

  it('accepts a timestamp within the tolerance window', () => {
    const body = JSON.stringify({ event_type: 'usage.voice_minute', quantity: 2 })
    const twoMinutesAgo = Math.floor(Date.now() / 1000) - 2 * 60
    const header = buildSignatureHeader(SECRET, body, twoMinutesAgo)

    const result = verifySignature(SECRET, body, header)
    expect(result.valid).toBe(true)
  })

  it('rejects a malformed header', () => {
    const result = verifySignature(SECRET, '{}', 'not-a-valid-header')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('malformed_header')
  })

  it('computeSignature is deterministic for identical inputs', () => {
    const a = computeSignature(SECRET, 1000, 'body')
    const b = computeSignature(SECRET, 1000, 'body')
    expect(a).toBe(b)
  })
})
