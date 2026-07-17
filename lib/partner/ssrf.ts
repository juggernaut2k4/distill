import dns from 'dns'
import net from 'net'

/**
 * B2B-19 — SSRF / untrusted-fetch discipline (Requirement Doc Section 6.4).
 *
 * Partner page URLs are partner-controlled inputs Clio's SERVER fetches. This
 * is the one deliberate, guarded exception to CLAUDE.md's "never fetch from
 * dynamically constructed endpoints" rule — the partner is a semi-trusted,
 * authenticated source, but the URL is still validated and the fetch is still
 * sandboxed. All checks here are mandatory, not optional:
 *
 *   1. Scheme allowlist — https only (no http/file/data/ftp/gopher/blob/...).
 *   2. Host safety — reject any host that resolves to a private / internal /
 *      link-local / loopback / cloud-metadata (169.254.169.254) address.
 *   3. No redirect to an unsafe host — manual redirect handling, re-validate
 *      each hop, cap depth.
 *   4. Size + time caps — AbortController timeout + max body size.
 *   5. Content-type enforcement — html must be text/html, image must be image/*.
 *
 * Never throws — every failure resolves to a defined `unavailable` result the
 * render path degrades to (mirrors pullPartnerContent's discipline).
 */

const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 15_000
const MAX_HTML_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

const BLOCKED_HOST_SUFFIXES = ['.internal', '.local', '.localhost']

/** Parses a dotted-quad IPv4 into its four octets, or null if malformed. */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((p) => Number(p))
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null
  return octets as [number, number, number, number]
}

/** True if an IPv4 address is in a private / loopback / link-local / metadata / reserved range. */
function isBlockedIpv4(ip: string): boolean {
  const octets = parseIpv4(ip)
  if (!octets) return true // unparseable → fail closed
  const [a, b] = octets
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10/8 private
  if (a === 127) return true // 127/8 loopback
  if (a === 169 && b === 254) return true // 169.254/16 link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12 private
  if (a === 192 && b === 168) return true // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true // 192.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 benchmarking
  if (a >= 224) return true // 224/4 multicast + 240/4 reserved
  return false
}

/** True if an IPv6 address is loopback / unspecified / ULA / link-local, or an IPv4-mapped blocked address. */
function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0] // strip any zone id
  if (lower === '::1' || lower === '::') return true // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible — extract and re-check as IPv4.
  const mapped = lower.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isBlockedIpv4(mapped[1])
  const firstHextet = lower.split(':')[0]
  const prefix = parseInt(firstHextet || '0', 16)
  if ((prefix & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((prefix & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  return false
}

/** True if a resolved IP literal (v4 or v6) must be blocked. Fails closed on anything unrecognized. */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) return isBlockedIpv4(ip)
  if (family === 6) return isBlockedIpv6(ip)
  return true // not a valid IP → fail closed
}

async function resolveAllIps(hostname: string): Promise<string[]> {
  const results = await dns.promises.lookup(hostname, { all: true })
  return results.map((r) => r.address)
}

export type UrlSafetyResult = { ok: true } | { ok: false; reason: string }

/**
 * Validates a single partner-supplied URL: https scheme + host resolves only to
 * public addresses. Async because it performs a DNS lookup. Never throws.
 * Used both at session initiation (Requirement Doc State B3) and per redirect hop.
 */
export async function assertUrlSafe(rawUrl: string): Promise<UrlSafetyResult> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'malformed URL' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: `scheme '${parsed.protocol}' not allowed (https only)` }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets

  if (hostname === 'localhost') return { ok: false, reason: 'localhost is not allowed' }
  if (BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { ok: false, reason: `internal host suffix not allowed` }
  }

  // If the host is a literal IP, check it directly (no DNS).
  if (net.isIP(hostname) !== 0) {
    return isBlockedIp(hostname) ? { ok: false, reason: 'host is an internal/reserved IP address' } : { ok: true }
  }

  // Otherwise resolve DNS and reject if ANY resolved address is blocked
  // (defends against DNS-rebinding to an internal address).
  try {
    const ips = await resolveAllIps(hostname)
    if (ips.length === 0) return { ok: false, reason: 'host did not resolve' }
    for (const ip of ips) {
      if (isBlockedIp(ip)) return { ok: false, reason: 'host resolves to an internal/reserved IP address' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'host did not resolve' }
  }
}

export type SafeFetchResult =
  | { status: 'ok'; contentType: string; body: Buffer }
  | { status: 'unavailable'; reason: string }

function maxBytesFor(mediaType: 'html' | 'image'): number {
  return mediaType === 'image' ? MAX_IMAGE_BYTES : MAX_HTML_BYTES
}

/** Reads a fetch Response body up to `maxBytes`, aborting past the cap. Never throws. */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.byteLength > maxBytes ? null : buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
}

/**
 * SSRF-guarded fetch of a single partner page. Manually follows redirects
 * (re-validating every hop's Location against assertUrlSafe), enforces the
 * size/time caps and the content-type for the declared media_type. Any failure
 * degrades to `{ status: 'unavailable' }` — never throws, never crashes the render.
 */
export async function safeFetchPartnerPage(
  initialUrl: string,
  headers: Record<string, string>,
  mediaType: 'html' | 'image'
): Promise<SafeFetchResult> {
  let url = initialUrl
  const maxBytes = maxBytesFor(mediaType)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safety = await assertUrlSafe(url)
    if (!safety.ok) return { status: 'unavailable', reason: safety.reason }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    let res: Response
    try {
      res = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'manual', // re-validate every hop ourselves
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      console.error('[partner/ssrf] fetch failed:', err instanceof Error ? err.message : err)
      return { status: 'unavailable', reason: 'fetch failed' }
    }
    clearTimeout(timeout)

    // Manual redirect handling — re-validate the next hop before following it.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return { status: 'unavailable', reason: 'redirect without location' }
      if (hop === MAX_REDIRECTS) return { status: 'unavailable', reason: 'too many redirects' }
      try {
        url = new URL(location, url).toString() // resolve relative redirects
      } catch {
        return { status: 'unavailable', reason: 'malformed redirect location' }
      }
      continue
    }

    if (!res.ok) return { status: 'unavailable', reason: `upstream returned ${res.status}` }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    if (mediaType === 'html' && !contentType.includes('text/html')) {
      return { status: 'unavailable', reason: `expected text/html, got '${contentType || 'none'}'` }
    }
    if (mediaType === 'image' && !contentType.startsWith('image/')) {
      return { status: 'unavailable', reason: `expected image/*, got '${contentType || 'none'}'` }
    }

    const body = await readCapped(res, maxBytes).catch(() => null)
    if (body === null) return { status: 'unavailable', reason: 'response exceeded size cap or read failed' }

    return { status: 'ok', contentType, body }
  }

  return { status: 'unavailable', reason: 'too many redirects' }
}
