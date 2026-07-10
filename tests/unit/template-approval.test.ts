import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * RTV-04 — Gate B helpers (lib/templates/approval.ts).
 * Covers the fail-closed email-match logic and isTemplateApprovedForProduction(),
 * the RTV-05 dependency (Section 12).
 */

let templateLibraryRow: { status: string } | null = null

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: templateLibraryRow, error: null })),
        })),
      })),
    })),
  })),
}))

import { isConfiguredApprover, isTemplateApprovedForProduction, _resetApproverWarningForTests } from '@/lib/templates/approval'

describe('isConfiguredApprover — fails closed (Section 8)', () => {
  const originalEnv = process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _resetApproverWarningForTests()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL = originalEnv
    warnSpy.mockRestore()
  })

  it('returns true when the email exactly matches the configured approver', () => {
    process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL = 'arun@example.com'
    expect(isConfiguredApprover('arun@example.com')).toBe(true)
  })

  it('returns false for a non-matching email', () => {
    process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL = 'arun@example.com'
    expect(isConfiguredApprover('someone-else@example.com')).toBe(false)
  })

  it('returns false for a null/undefined email even with a configured approver', () => {
    process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL = 'arun@example.com'
    expect(isConfiguredApprover(null)).toBe(false)
    expect(isConfiguredApprover(undefined)).toBe(false)
  })

  it('fails closed when the env var is unset — even for an email that would otherwise match', () => {
    delete process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL
    // No approver configured at all — "arun@example.com" can never pass.
    expect(isConfiguredApprover('arun@example.com')).toBe(false)
  })

  it('logs the misconfiguration warning exactly once per process lifetime, not once per call', () => {
    delete process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL
    isConfiguredApprover('a@example.com')
    isConfiguredApprover('b@example.com')
    isConfiguredApprover('c@example.com')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toMatch(/TEMPLATE_LIBRARY_APPROVER_EMAIL not configured/)
  })
})

describe('isTemplateApprovedForProduction', () => {
  beforeEach(() => {
    templateLibraryRow = null
  })

  it('returns true only when the row exists and status is approved', async () => {
    templateLibraryRow = { status: 'approved' }
    expect(await isTemplateApprovedForProduction('Heatmap')).toBe(true)
  })

  it('returns false when the row exists but is pending_review', async () => {
    templateLibraryRow = { status: 'pending_review' }
    expect(await isTemplateApprovedForProduction('Heatmap')).toBe(false)
  })

  it('returns false when the row exists but changes were requested', async () => {
    templateLibraryRow = { status: 'changes_requested' }
    expect(await isTemplateApprovedForProduction('Overlay')).toBe(false)
  })

  it('fails closed when no row exists at all (e.g. a future template type never seeded)', async () => {
    templateLibraryRow = null
    expect(await isTemplateApprovedForProduction('SomeFutureTemplate')).toBe(false)
  })
})
