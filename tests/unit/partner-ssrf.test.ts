import { describe, it, expect } from 'vitest'
import { assertUrlSafe, isBlockedIp } from '@/lib/partner/ssrf'

describe('B2B-19 SSRF gate', () => {
  // AT-SSRF-1 — scheme + internal/metadata host rejection.
  it('rejects non-https schemes', async () => {
    expect((await assertUrlSafe('http://example.com/page')).ok).toBe(false)
    expect((await assertUrlSafe('file:///etc/passwd')).ok).toBe(false)
    expect((await assertUrlSafe('data:text/html,<h1>x</h1>')).ok).toBe(false)
    expect((await assertUrlSafe('ftp://example.com')).ok).toBe(false)
  })

  it('rejects literal internal / loopback / link-local / metadata IPs', async () => {
    expect((await assertUrlSafe('https://169.254.169.254/latest/meta-data')).ok).toBe(false) // cloud metadata
    expect((await assertUrlSafe('https://127.0.0.1/x')).ok).toBe(false)
    expect((await assertUrlSafe('https://10.0.0.5/x')).ok).toBe(false)
    expect((await assertUrlSafe('https://192.168.1.1/x')).ok).toBe(false)
    expect((await assertUrlSafe('https://172.16.0.1/x')).ok).toBe(false)
    expect((await assertUrlSafe('https://[::1]/x')).ok).toBe(false)
    expect((await assertUrlSafe('https://0.0.0.0/x')).ok).toBe(false)
  })

  it('rejects localhost and internal host suffixes', async () => {
    expect((await assertUrlSafe('https://localhost/x')).ok).toBe(false)
    expect((await assertUrlSafe('https://db.internal/x')).ok).toBe(false)
    expect((await assertUrlSafe('https://service.local/x')).ok).toBe(false)
  })

  it('allows an https URL to a literal public IP', async () => {
    expect((await assertUrlSafe('https://93.184.216.34/page')).ok).toBe(true)
  })

  it('isBlockedIp classifies ranges correctly', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true)
    expect(isBlockedIp('127.0.0.1')).toBe(true)
    expect(isBlockedIp('10.255.255.255')).toBe(true)
    expect(isBlockedIp('172.31.0.1')).toBe(true)
    expect(isBlockedIp('192.168.0.1')).toBe(true)
    expect(isBlockedIp('::1')).toBe(true)
    expect(isBlockedIp('fe80::1')).toBe(true)
    expect(isBlockedIp('fc00::1')).toBe(true)
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true) // IPv4-mapped loopback
    expect(isBlockedIp('93.184.216.34')).toBe(false)
    expect(isBlockedIp('8.8.8.8')).toBe(false)
    expect(isBlockedIp('not-an-ip')).toBe(true) // fail closed
  })
})
