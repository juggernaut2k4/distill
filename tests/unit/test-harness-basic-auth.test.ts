import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { checkTestHarnessBasicAuth } from '@/lib/test-harness/basic-auth'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 5, AT-2).
 */

function requestWithAuthHeader(header: string | null): NextRequest {
  const headers = new Headers()
  if (header !== null) headers.set('authorization', header)
  return new NextRequest('https://test.hello-clio.com/test-harness', { headers })
}

function basicHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

describe('checkTestHarnessBasicAuth', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    process.env.TEST_HARNESS_BASIC_AUTH_USER = 'arun'
    process.env.TEST_HARNESS_BASIC_AUTH_PASSWORD = 'correct-horse-battery-staple'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('401s with WWW-Authenticate when no Authorization header is present', () => {
    const result = checkTestHarnessBasicAuth(requestWithAuthHeader(null))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.challengeResponse.status).toBe(401)
      expect(result.challengeResponse.headers.get('WWW-Authenticate')).toContain('Basic')
    }
  })

  it('401s with an incorrect password', () => {
    const result = checkTestHarnessBasicAuth(requestWithAuthHeader(basicHeader('arun', 'wrong-password')))
    expect(result.ok).toBe(false)
  })

  it('401s with an incorrect username', () => {
    const result = checkTestHarnessBasicAuth(requestWithAuthHeader(basicHeader('someone-else', 'correct-horse-battery-staple')))
    expect(result.ok).toBe(false)
  })

  it('401s a malformed (non-Basic) Authorization header', () => {
    const result = checkTestHarnessBasicAuth(requestWithAuthHeader('Bearer some-token'))
    expect(result.ok).toBe(false)
  })

  it('succeeds with the correct credentials', () => {
    const result = checkTestHarnessBasicAuth(requestWithAuthHeader(basicHeader('arun', 'correct-horse-battery-staple')))
    expect(result.ok).toBe(true)
  })

  it('fails closed when the env vars are unset, even with a header present', () => {
    delete process.env.TEST_HARNESS_BASIC_AUTH_USER
    delete process.env.TEST_HARNESS_BASIC_AUTH_PASSWORD
    const result = checkTestHarnessBasicAuth(requestWithAuthHeader(basicHeader('arun', 'correct-horse-battery-staple')))
    expect(result.ok).toBe(false)
  })
})
