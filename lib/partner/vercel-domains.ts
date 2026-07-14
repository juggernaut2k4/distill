import { Vercel } from '@vercel/sdk'

/**
 * B2B-05 — Vercel Domains API wrapper (Requirement Doc Section 4.B.4/4.B.5/
 * 4.B.6, architecture.md §14.3). Every function here follows `lib/stripe.ts`'s
 * `isPlaceholder` guard convention exactly: if `VERCEL_API_TOKEN` or
 * `VERCEL_PROJECT_ID` is a `PLACEHOLDER_` value, the function logs
 * `console.log('[MOCK]', ...)` with what it would have sent and returns a
 * realistic mock response instead of making a network call. Uses the official
 * `@vercel/sdk` package exclusively — never a raw unauthenticated `fetch`.
 *
 * Implementation note (deviation from architecture.md §14.3's literal path
 * for `checkDomainVerification`): architecture.md cites
 * `GET /v9/projects/{id}/domains/{domain}/config` returning `{ verified }`.
 * The real Vercel API's `.../config` endpoint (the SDK's
 * `domains.getDomainConfig()`) returns `{ configuredBy, misconfigured, ... }`
 * — it has no `verified` field at all. The endpoint that actually returns
 * `{ verified, verification }` (the exact shape this module's callers and the
 * Requirement Doc's `GET .../domain` / `POST .../recheck` contracts need) is
 * `GET /v9/projects/{idOrName}/domains/{domain}` — the SDK's
 * `projects.getProjectDomain()`. This function calls that instead so the
 * returned shape matches the documented contract; the *behavior* (recheck
 * verification status for a domain already added to the project) is
 * identical, only the specific Vercel endpoint used differs from the doc's
 * literal citation. Flagged in the B2B-05 build report.
 */

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID

const isPlaceholder =
  !VERCEL_API_TOKEN ||
  VERCEL_API_TOKEN.startsWith('PLACEHOLDER_') ||
  !VERCEL_PROJECT_ID ||
  VERCEL_PROJECT_ID.startsWith('PLACEHOLDER_')

const vercelClient = isPlaceholder
  ? null
  : new Vercel({ bearerToken: VERCEL_API_TOKEN! })

export interface VercelVerificationRecord {
  type: string
  domain: string
  value: string
  reason: string
}

function mockVerificationRecord(domain: string): VercelVerificationRecord {
  return {
    type: 'CNAME',
    domain,
    value: 'cname.vercel-dns.com',
    reason: 'CNAME Record (mocked — no VERCEL_API_TOKEN configured)',
  }
}

function teamParams(): { teamId?: string } {
  return VERCEL_TEAM_ID && !VERCEL_TEAM_ID.startsWith('PLACEHOLDER_') ? { teamId: VERCEL_TEAM_ID } : {}
}

/** Best-effort extraction of Vercel's own error message from a thrown SDK error. */
function extractVercelErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // The SDK's VercelError carries the raw response body as `.body` (JSON string).
    const body = (err as { body?: string }).body
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } }
        if (parsed.error?.message) return parsed.error.message
      } catch {
        // fall through to err.message
      }
    }
    return err.message
  }
  return 'Unknown error from Vercel.'
}

export type AddDomainResult =
  | { ok: true; verified: boolean; verification: VercelVerificationRecord[] | null }
  | { ok: false; errorMessage: string }

/**
 * Add a domain to Clio's Vercel project (Requirement Doc Section 4.B.4,
 * architecture.md §14.3). `POST /v10/projects/{VERCEL_PROJECT_ID}/domains`.
 */
export async function addDomainToProject(domain: string): Promise<AddDomainResult> {
  if (isPlaceholder || !vercelClient) {
    console.log('[MOCK] addDomainToProject', { domain, projectId: VERCEL_PROJECT_ID })
    return { ok: true, verified: false, verification: [mockVerificationRecord(domain)] }
  }

  try {
    const result = await vercelClient.projects.addProjectDomain({
      idOrName: VERCEL_PROJECT_ID!,
      ...teamParams(),
      requestBody: { name: domain },
    })
    return {
      ok: true,
      verified: result.verified,
      verification: result.verification?.length ? result.verification : null,
    }
  } catch (err) {
    console.error('[partner/vercel-domains] addDomainToProject failed:', err instanceof Error ? err.message : err)
    return { ok: false, errorMessage: extractVercelErrorMessage(err) }
  }
}

export interface CheckVerificationResult {
  verified: boolean
  verification: VercelVerificationRecord[] | null
}

// Test-convenience only (architecture.md §14.3): after a fixed number of
// mock recheck calls for the same domain, flip to verified:true so the
// "verified" screen state can be exercised locally without a real Vercel
// token. Gated identically to every other mock stub — only runs when
// VERCEL_API_TOKEN/VERCEL_PROJECT_ID are PLACEHOLDER_ values, never in
// production. Not a product behavior.
const mockRecheckCounts = new Map<string, number>()
const MOCK_VERIFY_AFTER_CALLS = 3

/**
 * Check whether a previously-added domain is now verified (Requirement Doc
 * Section 4.B.5, architecture.md §14.3's "Check verification status").
 */
export async function checkDomainVerification(domain: string): Promise<CheckVerificationResult> {
  if (isPlaceholder || !vercelClient) {
    const count = (mockRecheckCounts.get(domain) ?? 0) + 1
    mockRecheckCounts.set(domain, count)
    console.log('[MOCK] checkDomainVerification', { domain, projectId: VERCEL_PROJECT_ID, call: count })
    if (count >= MOCK_VERIFY_AFTER_CALLS) {
      return { verified: true, verification: null }
    }
    return { verified: false, verification: [mockVerificationRecord(domain)] }
  }

  try {
    const result = await vercelClient.projects.getProjectDomain({
      idOrName: VERCEL_PROJECT_ID!,
      domain,
      ...teamParams(),
    })
    return {
      verified: result.verified,
      verification: result.verified ? null : (result.verification?.length ? result.verification : null),
    }
  } catch (err) {
    // Transient check failure is never user-facing (Requirement Doc Section
    // 8) — logged, caller keeps the existing pending_verification state.
    console.error('[partner/vercel-domains] checkDomainVerification failed:', err instanceof Error ? err.message : err)
    return { verified: false, verification: null }
  }
}

/**
 * Remove a domain from Clio's Vercel project (Requirement Doc Section 4.B.6/
 * 5.B.4/8). Always resolves `{ ok: true }` from the caller's point of view —
 * a 404 (already gone) or any thrown error is logged, never surfaced as a
 * failure, so the partner's removal intent is never blocked by an upstream
 * outcome.
 */
export async function removeDomainFromProject(domain: string): Promise<{ ok: true }> {
  if (isPlaceholder || !vercelClient) {
    console.log('[MOCK] removeDomainFromProject', { domain, projectId: VERCEL_PROJECT_ID })
    mockRecheckCounts.delete(domain)
    return { ok: true }
  }

  try {
    await vercelClient.projects.removeProjectDomain({
      idOrName: VERCEL_PROJECT_ID!,
      domain,
      ...teamParams(),
    })
  } catch (err) {
    // 404 (already not registered) or any other error — both logged, both
    // treated as success (Requirement Doc Section 5.B.4/8).
    console.error('[partner/vercel-domains] removeDomainFromProject failed (treated as success):', err instanceof Error ? err.message : err)
  }
  return { ok: true }
}
