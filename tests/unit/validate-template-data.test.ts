import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * RTV-04 Section 4.1, Layer 1 — validateTemplateData()'s retry-then-fallback
 * orchestration (lib/templates/generator.ts). The pure truncation/floor-check
 * logic itself is covered directly in tests/unit/container-budgets.test.ts;
 * this file covers the LLM-retry-once-then-mock-fallback behavior that only
 * lives in generator.ts (since it needs the Anthropic client).
 *
 * generator.ts computes `isPlaceholder`/`anthropic` once at module import
 * time from process.env.ANTHROPIC_API_KEY, so this file uses a dynamic
 * import inside beforeEach (after setting a real-looking key and mocking the
 * Anthropic SDK) rather than a static top-level import — a static import
 * would be resolved before the env var is set, leaving the module in
 * placeholder mode regardless.
 */

const createMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  // Must be a real function (not an arrow fn) so `new Anthropic(...)` in
  // generator.ts can construct it — vitest's mockImplementation requires a
  // constructible implementation when the mock is invoked with `new`.
  default: vi.fn().mockImplementation(function MockAnthropic() {
    return { messages: { create: createMock } }
  }),
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  })),
}))

describe('validateTemplateData — retry-then-fallback (LLM available)', () => {
  let mod: typeof import('@/lib/templates/generator')

  beforeEach(async () => {
    vi.resetModules()
    createMock.mockReset()
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-real-key-not-a-placeholder'
    mod = await import('@/lib/templates/generator')
  })

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  it('does not call the LLM at all when every budgeted field already clears its floor', async () => {
    const validData = mod.getMockData('QuoteCallout', 'x')
    const result = await mod.validateTemplateData('QuoteCallout', validData, 'x')

    expect(createMock).not.toHaveBeenCalled()
    expect(result).toEqual(validData)
  })

  it('retries exactly once when a field is under-floor, and uses the expanded value if the retry clears the floor', async () => {
    const base = mod.getMockData('QuoteCallout', 'x') as unknown as Record<string, unknown>
    const shortData = { ...base, so_what: 'Too short.' }
    const expanded = { ...shortData, so_what: 'As a CEO, this expanded so-what field is now long enough to comfortably clear the minimum floor for this field budget.' }

    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(expanded) }],
    })

    const result = await mod.validateTemplateData('QuoteCallout', shortData as never, 'x') as unknown as Record<string, unknown>

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(result.so_what).toContain('expanded so-what field')
  })

  it('falls back to mock data when the field is still under-floor after the one retry, and never retries a second time', async () => {
    const base = mod.getMockData('QuoteCallout', 'x') as unknown as Record<string, unknown>
    const shortData = { ...base, so_what: 'Too short.' }
    const stillShort = { ...shortData, so_what: 'Still short.' }

    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(stillShort) }],
    })

    const fallback = mod.getMockData('QuoteCallout', 'fallback-title')
    const result = await mod.validateTemplateData('QuoteCallout', shortData as never, 'fallback-title')

    expect(createMock).toHaveBeenCalledTimes(1) // exactly one retry, never a second
    expect(result).toEqual(fallback)
  })

  it('falls back to mock data (without throwing) when the retry call itself errors', async () => {
    const base = mod.getMockData('QuoteCallout', 'x') as unknown as Record<string, unknown>
    const shortData = { ...base, so_what: 'Too short.' }
    createMock.mockRejectedValueOnce(new Error('Anthropic API down'))

    const fallback = mod.getMockData('QuoteCallout', 'fallback-title')
    const result = await mod.validateTemplateData('QuoteCallout', shortData as never, 'fallback-title')

    expect(result).toEqual(fallback)
  })

  it('truncates an over-max field deterministically without ever calling the LLM', async () => {
    const base = mod.getMockData('QuoteCallout', 'x') as unknown as Record<string, unknown>
    const overlong = {
      ...base,
      quote: 'This first sentence is fine. ' + 'A'.repeat(400) + '. This trailing sentence pushes it well past the forty word budget for sure and should be cut.',
    }

    const result = await mod.validateTemplateData('QuoteCallout', overlong as never, 'x') as unknown as Record<string, unknown>

    expect(createMock).not.toHaveBeenCalled()
    expect((result.quote as string).length).toBeLessThanOrEqual(Math.round(40 * 6.5))
  })
})

describe('validateTemplateData — no LLM available (placeholder key)', () => {
  let mod: typeof import('@/lib/templates/generator')

  beforeEach(async () => {
    vi.resetModules()
    createMock.mockReset()
    process.env.ANTHROPIC_API_KEY = 'PLACEHOLDER_ANTHROPIC_API_KEY'
    mod = await import('@/lib/templates/generator')
  })

  it('falls back to mock data immediately (no retry attempt) when there is no LLM to retry with', async () => {
    const base = mod.getMockData('QuoteCallout', 'x') as unknown as Record<string, unknown>
    const shortData = { ...base, so_what: 'Too short.' }

    const fallback = mod.getMockData('QuoteCallout', 'fallback-title')
    const result = await mod.validateTemplateData('QuoteCallout', shortData as never, 'fallback-title')

    expect(createMock).not.toHaveBeenCalled()
    expect(result).toEqual(fallback)
  })
})
