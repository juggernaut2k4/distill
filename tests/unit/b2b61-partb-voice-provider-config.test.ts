import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-61 Part B (docs/specs/B2B-61-requirement-document.md §13). Tests for
 * lib/voice/provider-config.ts's getActiveVoiceProvider() — the server-side read called from
 * app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx. Covers the fail-open-to-'hume'
 * behavior mandated by §9's edge case (missing row / read error should not throw or block session
 * render, mirroring humeConfigId's own fail-open-to-null posture elsewhere in
 * resolveLiveSessionRender).
 */

const state = {
  row: null as { active_provider: string } | null,
  error: null as { message: string } | null,
  throwOnCreate: false,
}

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => {
    if (state.throwOnCreate) throw new Error('supabase client init failed')
    return {
      from: vi.fn((table: string) => {
        if (table === 'system_voice_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: state.row, error: state.error })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table in mock: ${table}`)
      }),
    }
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.row = null
  state.error = null
  state.throwOnCreate = false
})

describe('getActiveVoiceProvider()', () => {
  it('returns "hume" when the row says hume', async () => {
    state.row = { active_provider: 'hume' }
    const { getActiveVoiceProvider } = await import('@/lib/voice/provider-config')
    await expect(getActiveVoiceProvider()).resolves.toBe('hume')
  })

  it('returns "openai_realtime" when the row says openai_realtime', async () => {
    state.row = { active_provider: 'openai_realtime' }
    const { getActiveVoiceProvider } = await import('@/lib/voice/provider-config')
    await expect(getActiveVoiceProvider()).resolves.toBe('openai_realtime')
  })

  it('falls back to "hume" without throwing when the row is missing (§9 edge case)', async () => {
    state.row = null
    const { getActiveVoiceProvider } = await import('@/lib/voice/provider-config')
    await expect(getActiveVoiceProvider()).resolves.toBe('hume')
  })

  it('falls back to "hume" without throwing when the read errors', async () => {
    state.error = { message: 'db unreachable' }
    const { getActiveVoiceProvider } = await import('@/lib/voice/provider-config')
    await expect(getActiveVoiceProvider()).resolves.toBe('hume')
  })

  it('falls back to "hume" without throwing when the Supabase client itself throws', async () => {
    state.throwOnCreate = true
    const { getActiveVoiceProvider } = await import('@/lib/voice/provider-config')
    await expect(getActiveVoiceProvider()).resolves.toBe('hume')
  })

  it('falls back to "hume" for any unexpected stored value, defense-in-depth against a bad row', async () => {
    state.row = { active_provider: 'something-unexpected' }
    const { getActiveVoiceProvider } = await import('@/lib/voice/provider-config')
    await expect(getActiveVoiceProvider()).resolves.toBe('hume')
  })
})
