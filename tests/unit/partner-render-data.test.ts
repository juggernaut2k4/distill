import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-02 acceptance test (docs/specs/B2B-02-requirement-document.md Section
 * 7): "Given a partner account with profile_sync_enabled = false ... no HTTP
 * call to {outbound_base_url}/profile is made at any point in that session's
 * lifecycle" — verified here via a network-call assertion (global fetch spy),
 * not just documentation, against the render-time code path
 * (lib/partner/render-data.ts) this brief builds for B2B-03 to wire in.
 */

const mockMaybeSingle = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockMaybeSingle,
        })),
      })),
    })),
  })),
}))

import { pullPartnerProfile, pullPartnerContent } from '@/lib/partner/render-data'

describe('partner/render-data — pullPartnerProfile profile_sync_enabled gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('never calls fetch when profile_sync_enabled is false, even with a partner_end_user_ref present', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        outbound_base_url: 'https://partner.example.com/api',
        outbound_auth_token_ciphertext: null,
        profile_sync_enabled: false,
      },
    })

    const result = await pullPartnerProfile('partner-1', 'hartford-employee-42')

    expect(result.status).toBe('disabled')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('calls fetch when profile_sync_enabled is true and a ref is present', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        outbound_base_url: 'https://partner.example.com/api',
        outbound_auth_token_ciphertext: null,
        profile_sync_enabled: true,
      },
    })
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ knowledge: {} }),
    })

    const result = await pullPartnerProfile('partner-1', 'hartford-employee-42')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [calledUrl] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(calledUrl)).toContain('/profile?partner_end_user_ref=hartford-employee-42')
    expect(result.status).toBe('ok')
  })

  it('treats a 404 from the partner as a legitimate "no profile yet" state, not an error', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        outbound_base_url: 'https://partner.example.com/api',
        outbound_auth_token_ciphertext: null,
        profile_sync_enabled: true,
      },
    })
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 404 })

    const result = await pullPartnerProfile('partner-1', 'brand-new-user')
    expect(result.status).toBe('unavailable')
  })

  it('never calls fetch when profile_sync_enabled is true but no partner_end_user_ref was supplied', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        outbound_base_url: 'https://partner.example.com/api',
        outbound_auth_token_ciphertext: null,
        profile_sync_enabled: true,
      },
    })

    const result = await pullPartnerProfile('partner-1', undefined)
    expect(result.status).toBe('no_ref')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('partner/render-data — pullPartnerContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('queries by content_ref when present', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { outbound_base_url: 'https://partner.example.com/api', outbound_auth_token_ciphertext: null, profile_sync_enabled: false },
    })
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ payload: '<p>hi</p>' }) })

    await pullPartnerContent('partner-1', { contentRef: 'c5e2f1a0-1234-4321-aaaa-111122223333' })

    const [calledUrl] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(calledUrl)).toContain('content_ref=c5e2f1a0')
  })

  it('returns not_configured when outbound_base_url is unset (first-ever session edge case)', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { outbound_base_url: null, outbound_auth_token_ciphertext: null, profile_sync_enabled: false },
    })

    const result = await pullPartnerContent('partner-1', { partnerTopicRef: 'ai-101' })
    expect(result.status).toBe('not_configured')
    expect(fetch).not.toHaveBeenCalled()
  })
})
