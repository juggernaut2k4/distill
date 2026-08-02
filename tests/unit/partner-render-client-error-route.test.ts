import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-44 Fix 2 + Fix 3.
 *
 * Fix 2 — ClientErrorSchema's `source` enum widened to accept 'error-boundary' reports (posted by
 * lib/partner/live-render.ts's buildIframeDiagnosticShim()). Previously this value failed
 * `.safeParse()`, so the route returned before console.error() was ever reached — confirmed live,
 * Fix 4b (2026-07-27) had never actually logged anything.
 *
 * Fix 3 — a validated report now also gets a best-effort row in `glitch_instances` with
 * `glitch_type: 'technical_error'`, resolved via clio_session_ref -> partner_sessions.id (same
 * resolution pattern as every other meeting-bot-facing render route). The ordinal must never
 * collide with trigger-sourced rows (which start at 0 per session) or with an earlier
 * client-error row for the same session.
 */

const state = {
  sessionRow: null as { id: string; partner_account_id: string } | null,
  maxOrdinalRow: null as { ordinal: number } | null,
  insertError: null as { message: string } | null,
}

const glitchInstancesInserts: Record<string, unknown>[] = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve({ data: state.sessionRow ? [state.sessionRow] : [] })),
            })),
          })),
        }
      }
      if (table === 'glitch_instances') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve({ data: state.maxOrdinalRow ? [state.maxOrdinalRow] : [] })),
              })),
            })),
          })),
          insert: vi.fn((row: Record<string, unknown>) => {
            glitchInstancesInserts.push(row)
            return Promise.resolve({ error: state.insertError })
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })),
}))

import { POST, OPTIONS } from '@/app/api/partner/render/client-error/route'

function errorRequest(body: unknown) {
  return new NextRequest('https://hello-clio.com/api/partner/render/client-error', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const VALID_REF = '9e2a4f11-8b3c-4d21-9a77-1c8f2e5b6a90'

describe('POST /api/partner/render/client-error', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.sessionRow = { id: VALID_REF, partner_account_id: 'acct-1' }
    state.maxOrdinalRow = null
    state.insertError = null
    glitchInstancesInserts.length = 0
  })

  it('Fix 2: accepts source "error-boundary" and returns ok:true (previously rejected by the enum)', async () => {
    const res = await POST(
      errorRequest({ clio_session_ref: VALID_REF, message: 'Application error', source: 'error-boundary' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
  })

  it('still accepts the pre-existing source values', async () => {
    const res1 = await POST(errorRequest({ clio_session_ref: VALID_REF, message: 'boom', source: 'error' }))
    expect((await res1.json()).ok).toBe(true)
    const res2 = await POST(
      errorRequest({ clio_session_ref: VALID_REF, message: 'boom', source: 'unhandledrejection' })
    )
    expect((await res2.json()).ok).toBe(true)
  })

  // 2026-07-29 — B2B-47 follow-up: Clerk removal from /demo/** did not stop the crash (live-verified,
  // 3 distinct pages crashed in one session post-fix), so a real React error boundary
  // (app/(demo)/demo/_diagnostic-error-boundary.tsx) was added inside the demo pages themselves to
  // capture the actual Error/stack, reporting with this new source value. Widening this enum before
  // that value is ever sent is the exact lesson from B2B-45 — do not repeat the two-day silent-reject
  // window that source: 'error-boundary' sat in.
  it('accepts source "react-error-boundary" (a real React error boundary reporting the actual caught error) and returns ok:true', async () => {
    const res = await POST(
      errorRequest({ clio_session_ref: VALID_REF, message: 'Cannot read properties of undefined', stack: 'at Component (x.js:1:1)', source: 'react-error-boundary' })
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
  })

  it('rejects an unknown source value with ok:false, still 200', async () => {
    const res = await POST(errorRequest({ clio_session_ref: VALID_REF, message: 'boom', source: 'something-else' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: false })
    expect(glitchInstancesInserts).toHaveLength(0)
  })

  it('Fix 3: inserts a technical_error glitch_instances row resolved from clio_session_ref', async () => {
    await POST(
      errorRequest({ clio_session_ref: VALID_REF, message: 'Application error', stack: 'at foo()', source: 'error-boundary' })
    )
    expect(glitchInstancesInserts).toHaveLength(1)
    expect(glitchInstancesInserts[0]).toMatchObject({
      partner_session_id: VALID_REF,
      partner_account_id: 'acct-1',
      glitch_type: 'technical_error',
    })
    expect(String(glitchInstancesInserts[0].description)).toContain('Application error')
    expect(String(glitchInstancesInserts[0].description)).toContain('at foo()')
  })

  it('Fix 3: ordinal scheme never collides with trigger-sourced rows (which start at 0) — uses the high floor when no rows exist yet', async () => {
    state.maxOrdinalRow = null // no existing rows for this session
    await POST(errorRequest({ clio_session_ref: VALID_REF, message: 'boom', source: 'error' }))
    expect(glitchInstancesInserts[0].ordinal).toBeGreaterThanOrEqual(100000)
  })

  it('Fix 3: ordinal scheme never collides with an existing trigger-sourced row at a low ordinal (e.g. 3)', async () => {
    state.maxOrdinalRow = { ordinal: 3 } // a trigger-sourced conversational glitch already exists
    await POST(errorRequest({ clio_session_ref: VALID_REF, message: 'boom', source: 'error' }))
    expect(glitchInstancesInserts[0].ordinal).toBeGreaterThanOrEqual(100000)
    expect(glitchInstancesInserts[0].ordinal).not.toBe(3)
  })

  it('Fix 3: ordinal scheme never collides with an earlier client-error row for the same session (max+1 above the floor)', async () => {
    state.maxOrdinalRow = { ordinal: 100000 } // a prior client-error row already used the floor value
    await POST(errorRequest({ clio_session_ref: VALID_REF, message: 'boom', source: 'error' }))
    expect(glitchInstancesInserts[0].ordinal).toBe(100001)
  })

  it('Fix 3: best-effort — session lookup miss does not block the 200 response', async () => {
    state.sessionRow = null
    const res = await POST(errorRequest({ clio_session_ref: VALID_REF, message: 'boom', source: 'error' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(glitchInstancesInserts).toHaveLength(0)
  })

  it('Fix 3: best-effort — a failed insert does not block the 200 response', async () => {
    state.insertError = { message: 'insert failed' }
    const res = await POST(errorRequest({ clio_session_ref: VALID_REF, message: 'boom', source: 'error' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
  })

  // ─── B2B-45 — CORS headers, so the report actually reaches this route from the opaque-origin
  // sandboxed iframe (sandbox="allow-scripts", no allow-same-origin). Confirmed live: zero POST
  // requests ever reached this route in 2 hours despite 3 shipped diagnostic mitigations, because
  // the browser's preflight CORS check silently failed and blocked every real request client-side. ───

  it('B2B-45: OPTIONS preflight returns 204 with permissive CORS headers', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })

  it('B2B-45: successful POST response carries Access-Control-Allow-Origin', async () => {
    const res = await POST(errorRequest({ clio_session_ref: VALID_REF, message: 'boom', source: 'error' }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('B2B-45: the invalid-body {ok:false} response ALSO carries Access-Control-Allow-Origin — a malformed report must not silently fail the CORS check too', async () => {
    const res = await POST(errorRequest({ not: 'valid' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: false })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
