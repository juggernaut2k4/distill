import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * B2B-61 Part B (docs/specs/B2B-61-requirement-document.md §13). Tests for
 * GET/PATCH /api/admin/voice-config — the persisted admin toggle's API surface.
 * `requireSuperAdmin` and `OPENAI_REALTIME_ADAPTER_AVAILABLE` are mocked directly, mirroring
 * tests/unit/b2b39-demo-access-api.test.ts's convention for this codebase's admin routes.
 */

const state = {
  superAdminError: null as NextResponse | null,
  row: { active_provider: 'hume', updated_at: '2026-07-31T00:00:00.000Z' } as
    | { active_provider: string; updated_at: string }
    | null,
  selectError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  adapterAvailable: false,
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

vi.mock('@/lib/voice/provider-availability', () => ({
  get OPENAI_REALTIME_ADAPTER_AVAILABLE() {
    return state.adapterAvailable
  },
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'system_voice_config') {
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
                        : {
                            data: { active_provider: patch.active_provider, updated_at: '2026-07-31T01:00:00.000Z' },
                            error: null,
                          }
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
    typeof import('@/app/api/admin/voice-config/route').PATCH
  >[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  state.superAdminError = null
  state.row = { active_provider: 'hume', updated_at: '2026-07-31T00:00:00.000Z' }
  state.selectError = null
  state.updateError = null
  state.adapterAvailable = false
  updateCalls.length = 0
})

describe('GET /api/admin/voice-config', () => {
  it('returns active_provider, updated_at, and openai_realtime_available reflecting the current flag', async () => {
    const { GET } = await import('@/app/api/admin/voice-config/route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({
      active_provider: 'hume',
      updated_at: '2026-07-31T00:00:00.000Z',
      openai_realtime_available: false,
    })
  })

  it('openai_realtime_available reflects true when the flag is flipped', async () => {
    state.adapterAvailable = true
    const { GET } = await import('@/app/api/admin/voice-config/route')
    const res = await GET()
    const body = await res.json()
    expect(body.openai_realtime_available).toBe(true)
  })

  it('propagates the 403 from requireSuperAdmin unchanged', async () => {
    state.superAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { GET } = await import('@/app/api/admin/voice-config/route')
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('500s with a generic message when the row is missing (edge case §9)', async () => {
    state.row = null
    const { GET } = await import('@/app/api/admin/voice-config/route')
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/admin/voice-config', () => {
  it('400s on a malformed body with a Zod-shaped error envelope, never touching the DB', async () => {
    const { PATCH } = await import('@/app/api/admin/voice-config/route')
    const res = await PATCH(makeRequest({ active_provider: 'not-a-real-provider' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(body.details).toBeDefined()
    expect(updateCalls).toHaveLength(0)
  })

  it('400s + leaves the row unchanged when selecting openai_realtime while unavailable (defense-in-depth)', async () => {
    state.adapterAvailable = false
    const { PATCH } = await import('@/app/api/admin/voice-config/route')
    const res = await PATCH(makeRequest({ active_provider: 'openai_realtime' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('OpenAI Realtime is not yet available.')
    expect(updateCalls).toHaveLength(0)
  })

  it('200s and persists the update when openai_realtime is selected while available', async () => {
    state.adapterAvailable = true
    const { PATCH } = await import('@/app/api/admin/voice-config/route')
    const res = await PATCH(makeRequest({ active_provider: 'openai_realtime' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ active_provider: 'openai_realtime', updated_at: '2026-07-31T01:00:00.000Z' })
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].patch).toEqual({ active_provider: 'openai_realtime' })
  })

  it('200s and persists a valid hume selection', async () => {
    const { PATCH } = await import('@/app/api/admin/voice-config/route')
    const res = await PATCH(makeRequest({ active_provider: 'hume' }))
    expect(res.status).toBe(200)
    expect(updateCalls).toHaveLength(1)
  })

  it('propagates the 403 from requireSuperAdmin unchanged, never touching the DB', async () => {
    state.superAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { PATCH } = await import('@/app/api/admin/voice-config/route')
    const res = await PATCH(makeRequest({ active_provider: 'hume' }))
    expect(res.status).toBe(403)
    expect(updateCalls).toHaveLength(0)
  })

  it('500s with a generic message on unexpected DB failure, never leaking DB error detail', async () => {
    state.updateError = { message: 'connection to database node dropped: internal-secret-detail' }
    const { PATCH } = await import('@/app/api/admin/voice-config/route')
    const res = await PATCH(makeRequest({ active_provider: 'hume' }))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe('Failed to save.')
    expect(JSON.stringify(body)).not.toContain('internal-secret-detail')
  })
})
