import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * B2B-65 (docs/specs/B2B-65-requirement-document.md §6.5/§7). Tests for
 * GET/PATCH /api/admin/demo-performance-config — structurally mirrors
 * tests/unit/b2b61-partb-voice-config-api.test.ts's own convention for this codebase's
 * single-singleton admin config routes.
 */

const state = {
  superAdminError: null as NextResponse | null,
  row: { append_enabled: true, updated_at: '2026-08-01T00:00:00.000Z' } as
    | { append_enabled: boolean; updated_at: string }
    | null,
  selectError: null as { message: string } | null,
  updateError: null as { message: string } | null,
}

const updateCalls: { patch: Record<string, unknown> }[] = []

vi.mock('@/lib/internal-admin/auth', () => ({
  requireSuperAdmin: vi.fn(() =>
    Promise.resolve(
      state.superAdminError
        ? { role: null, clerkUserId: null, internalAdminUserId: null, scopedPartnerAccountIds: null, error: state.superAdminError }
        : { role: 'super_admin', clerkUserId: 'clerk-admin-1', internalAdminUserId: 'internal-1', scopedPartnerAccountIds: null, error: null }
    )
  ),
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'system_demo_performance_config') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.row, error: state.selectError })),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => {
            updateCalls.push({ patch })
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(() =>
                    Promise.resolve(
                      state.updateError
                        ? { data: null, error: state.updateError }
                        : { data: { append_enabled: patch.append_enabled, updated_at: '2026-08-01T01:00:00.000Z' }, error: null }
                    )
                  ),
                })),
              })),
            }
          }),
        }
      }
      throw new Error(`Unexpected table in mock: ${table}`)
    }),
  })),
}))

function makeRequest(body: unknown) {
  return { json: () => Promise.resolve(body) } as unknown as Parameters<
    typeof import('@/app/api/admin/demo-performance-config/route').PATCH
  >[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  state.superAdminError = null
  state.row = { append_enabled: true, updated_at: '2026-08-01T00:00:00.000Z' }
  state.selectError = null
  state.updateError = null
  updateCalls.length = 0
})

describe('GET /api/admin/demo-performance-config', () => {
  it('returns append_enabled and updated_at reflecting the current row', async () => {
    const { GET } = await import('@/app/api/admin/demo-performance-config/route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ append_enabled: true, updated_at: '2026-08-01T00:00:00.000Z' })
  })

  it('propagates the 403 from requireSuperAdmin unchanged', async () => {
    state.superAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { GET } = await import('@/app/api/admin/demo-performance-config/route')
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('500s with a generic message when the row is missing', async () => {
    state.row = null
    const { GET } = await import('@/app/api/admin/demo-performance-config/route')
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/admin/demo-performance-config', () => {
  it('400s on a non-boolean body with a Zod-shaped error envelope, never touching the DB', async () => {
    const { PATCH } = await import('@/app/api/admin/demo-performance-config/route')
    const res = await PATCH(makeRequest({ append_enabled: 'yes' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(body.details).toBeDefined()
    expect(updateCalls).toHaveLength(0)
  })

  it('200s and persists append_enabled: false (pausing)', async () => {
    const { PATCH } = await import('@/app/api/admin/demo-performance-config/route')
    const res = await PATCH(makeRequest({ append_enabled: false }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ append_enabled: false, updated_at: '2026-08-01T01:00:00.000Z' })
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].patch).toEqual({ append_enabled: false })
  })

  it('200s and persists append_enabled: true (resuming)', async () => {
    const { PATCH } = await import('@/app/api/admin/demo-performance-config/route')
    const res = await PATCH(makeRequest({ append_enabled: true }))
    expect(res.status).toBe(200)
    expect(updateCalls).toHaveLength(1)
  })

  it('propagates the 403 from requireSuperAdmin unchanged, never touching the DB', async () => {
    state.superAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { PATCH } = await import('@/app/api/admin/demo-performance-config/route')
    const res = await PATCH(makeRequest({ append_enabled: false }))
    expect(res.status).toBe(403)
    expect(updateCalls).toHaveLength(0)
  })

  it('500s with a generic message on unexpected DB failure, never leaking DB error detail', async () => {
    state.updateError = { message: 'connection to database node dropped: internal-secret-detail' }
    const { PATCH } = await import('@/app/api/admin/demo-performance-config/route')
    const res = await PATCH(makeRequest({ append_enabled: false }))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe('Failed to save.')
    expect(JSON.stringify(body)).not.toContain('internal-secret-detail')
  })
})
