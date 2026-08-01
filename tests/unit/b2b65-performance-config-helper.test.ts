import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-65 (docs/specs/B2B-65-requirement-document.md §6.3/§8). Tests for
 * lib/demo/performance-config.ts's getDemoPerformanceAppendEnabled() — the single read helper
 * the extractor consults at extraction-completion time. Fails open to `true` (the column's own
 * default) on any read error or missing row (§8) — never fails closed, since that would silently
 * and invisibly stop accumulation with no visible signal to Arun.
 */

const state = {
  data: { append_enabled: true } as { append_enabled: boolean } | null,
}

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'system_demo_performance_config') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: state.data, error: null })),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table in mock: ${table}`)
    }),
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.data = { append_enabled: true }
})

describe('getDemoPerformanceAppendEnabled', () => {
  it('returns true when the row says append_enabled: true', async () => {
    const { getDemoPerformanceAppendEnabled } = await import('@/lib/demo/performance-config')
    expect(await getDemoPerformanceAppendEnabled()).toBe(true)
  })

  it('returns false when the row says append_enabled: false', async () => {
    state.data = { append_enabled: false }
    const { getDemoPerformanceAppendEnabled } = await import('@/lib/demo/performance-config')
    expect(await getDemoPerformanceAppendEnabled()).toBe(false)
  })

  it('fails open to true when the row is missing (§8 — never fails closed/silent)', async () => {
    state.data = null
    const { getDemoPerformanceAppendEnabled } = await import('@/lib/demo/performance-config')
    expect(await getDemoPerformanceAppendEnabled()).toBe(true)
  })
})
