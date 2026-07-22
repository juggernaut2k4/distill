import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 5, §6.6, AT-2).
 *
 * HTTP Basic Auth check for the internal test harness — deliberately lighter than B2B-31's
 * Clerk-allowlist pattern (see requirement doc §0 point 5 for the explicit trade-off note): this
 * is a single-user, internal tool with no partner account, no admin-invite concept, and exactly
 * one intended user, so a shared-credential Basic Auth check checked in `middleware.ts` is
 * proportionate. Constant-time compared (`crypto.timingSafeEqual`, length-padded so the comparison
 * never leaks timing information about the credential's length) — never a plain `===`.
 */

export type TestHarnessAuthResult = { ok: true } | { ok: false; challengeResponse: NextResponse }

/** Constant-time string comparison, padded to equal length first so length itself leaks nothing. */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8')
  const bBuf = Buffer.from(b, 'utf-8')
  const maxLen = Math.max(aBuf.length, bBuf.length, 1)
  const aPadded = Buffer.concat([aBuf], maxLen)
  const bPadded = Buffer.concat([bBuf], maxLen)
  // crypto.timingSafeEqual requires equal-length buffers; both are padded to maxLen above.
  const bytesEqual = crypto.timingSafeEqual(aPadded, bPadded)
  return bytesEqual && aBuf.length === bBuf.length
}

function challenge(): NextResponse {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Clio Test Harness"' },
  })
}

/**
 * Checks the request's `Authorization: Basic <base64>` header against
 * `TEST_HARNESS_BASIC_AUTH_USER` / `TEST_HARNESS_BASIC_AUTH_PASSWORD`. A missing/malformed header,
 * or unset env vars (fail closed — never silently open), returns a 401 challenge response with
 * `WWW-Authenticate: Basic`, which makes every browser show its native credential prompt.
 */
export function checkTestHarnessBasicAuth(request: NextRequest): TestHarnessAuthResult {
  const expectedUser = process.env.TEST_HARNESS_BASIC_AUTH_USER ?? ''
  const expectedPassword = process.env.TEST_HARNESS_BASIC_AUTH_PASSWORD ?? ''

  // Fail closed: if either credential is unconfigured, never treat any request as authenticated.
  if (expectedUser.length === 0 || expectedPassword.length === 0) {
    return { ok: false, challengeResponse: challenge() }
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const match = authHeader.match(/^Basic\s+(.+)$/i)
  if (!match) {
    return { ok: false, challengeResponse: challenge() }
  }

  let decoded: string
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf-8')
  } catch {
    return { ok: false, challengeResponse: challenge() }
  }

  const separatorIndex = decoded.indexOf(':')
  if (separatorIndex === -1) {
    return { ok: false, challengeResponse: challenge() }
  }

  const suppliedUser = decoded.slice(0, separatorIndex)
  const suppliedPassword = decoded.slice(separatorIndex + 1)

  const ok = timingSafeEqualStrings(suppliedUser, expectedUser) && timingSafeEqualStrings(suppliedPassword, expectedPassword)

  return ok ? { ok: true } : { ok: false, challengeResponse: challenge() }
}
