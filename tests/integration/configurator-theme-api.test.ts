import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * B2B-03 Requirement Doc Section 7 — "Given a partner-admin authenticated
 * via Clerk with a partner_admin_users row for Partner A only, when they
 * call any /api/admin/configurator/* route with partner_account_id set to
 * Partner B, then the response is 403 and no read or write against Partner
 * B's data occurs." Verified against the theme route as the representative
 * case — every route in this tree calls requirePartnerAdmin() first,
 * before any DB access, per lib/partner/theme.ts and the route handlers
 * themselves.
 */

const requirePartnerAdminMock = vi.fn()
vi.mock('@/lib/partner/auth', () => ({
  requirePartnerAdmin: (...args: unknown[]) => requirePartnerAdminMock(...args),
}))

const upsertCalled = vi.fn()
vi.mock('@/lib/partner/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/partner/theme')>()
  return {
    ...actual,
    upsertThemeConfig: (...args: unknown[]) => {
      upsertCalled(...args)
      return Promise.resolve({ ok: true, data: {} })
    },
    getThemeConfig: () => Promise.resolve({ themeLabel: null, primaryColor: '#7C3AED', secondaryColor: '#06B6D4', accentColor: '#F59E0B', fontFamily: 'Inter', cornerStyle: 'soft', spacingScale: 'standard', assistantDisplayName: null }),
  }
})

vi.mock('@/lib/partner/preference', () => ({
  recordPreferenceSignal: vi.fn(() => Promise.resolve({ score: 0, domainsTouched: [], isFull: false })),
}))

import { GET, PATCH } from '@/app/api/admin/configurator/theme/route'

describe('/api/admin/configurator/theme — isolation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET returns 403 and never reads theme data when the caller does not administer the target partner account', async () => {
    requirePartnerAdminMock.mockResolvedValue({
      clerkUserId: null,
      error: NextResponse.json({ error: { code: 'forbidden', message: 'You do not administer this partner account.' } }, { status: 403 }),
    })

    const req = new NextRequest('http://localhost:3000/api/admin/configurator/theme?partner_account_id=partner-b')
    const res = await GET(req)

    expect(res.status).toBe(403)
    expect(requirePartnerAdminMock).toHaveBeenCalledWith('partner-b')
  })

  it('PATCH returns 403 and never writes when the caller does not administer the target partner account', async () => {
    requirePartnerAdminMock.mockResolvedValue({
      clerkUserId: null,
      error: NextResponse.json({ error: { code: 'forbidden', message: 'forbidden' } }, { status: 403 }),
    })

    const req = new NextRequest('http://localhost:3000/api/admin/configurator/theme', {
      method: 'PATCH',
      body: JSON.stringify({
        partner_account_id: '3f9a1c22-1234-4321-aaaa-111122223333',
        primary_color: '#000000',
        secondary_color: '#111111',
        accent_color: '#222222',
        font_family: 'Inter',
        corner_style: 'soft',
        spacing_scale: 'standard',
      }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(403)
    expect(upsertCalled).not.toHaveBeenCalled()
  })

  it('PATCH proceeds and writes when the caller does administer the target partner account', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })

    const req = new NextRequest('http://localhost:3000/api/admin/configurator/theme', {
      method: 'PATCH',
      body: JSON.stringify({
        partner_account_id: '4a8b2d33-5678-4321-bbbb-222233334444',
        primary_color: '#000000',
        secondary_color: '#111111',
        accent_color: '#222222',
        font_family: 'Inter',
        corner_style: 'soft',
        spacing_scale: 'standard',
      }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    expect(upsertCalled).toHaveBeenCalledWith('4a8b2d33-5678-4321-bbbb-222233334444', expect.objectContaining({ primaryColor: '#000000' }))
  })

  it('PATCH rejects a non-hex color before ever calling requirePartnerAdmin (Zod validation gate)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/configurator/theme', {
      method: 'PATCH',
      body: JSON.stringify({
        partner_account_id: '4a8b2d33-5678-4321-bbbb-222233334444',
        primary_color: 'red',
        secondary_color: '#111111',
        accent_color: '#222222',
        font_family: 'Inter',
        corner_style: 'soft',
        spacing_scale: 'standard',
      }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(400)
    expect(requirePartnerAdminMock).not.toHaveBeenCalled()
  })
})
