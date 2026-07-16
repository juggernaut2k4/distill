import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * B2B-11 (Requirement Doc Section 5.4) — mirrors
 * tests/integration/configurator-theme-api.test.ts's isolation-gate pattern
 * for the new prompt-behavior admin route: every access is gated by
 * requirePartnerAdmin() before any DB read/write, and Zod validation runs
 * before requirePartnerAdmin() is ever called.
 */

const requirePartnerAdminMock = vi.fn()
vi.mock('@/lib/partner/auth', () => ({
  requirePartnerAdmin: (...args: unknown[]) => requirePartnerAdminMock(...args),
}))

const upsertCalled = vi.fn()
const getPromptConfigMock = vi.fn()
vi.mock('@/lib/partner/prompt-config', () => ({
  upsertPromptConfig: (...args: unknown[]) => {
    upsertCalled(...args)
    return Promise.resolve({ ok: true, data: {} })
  },
  getPromptConfig: (...args: unknown[]) => getPromptConfigMock(...args),
}))

import { GET, PATCH } from '@/app/api/admin/configurator/prompt-behavior/route'

describe('/api/admin/configurator/prompt-behavior — isolation gate + validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPromptConfigMock.mockResolvedValue({
      tonePersona: null, deferralPhrasing: null, closingConfirmationQuestion: null,
      goodbyeLine: null, joinGreeting: null, verificationQuestionStyle: null, interSectionRecapStyle: null,
    })
  })

  it('GET returns 403 and never reads config when the caller does not administer the target partner account', async () => {
    requirePartnerAdminMock.mockResolvedValue({
      clerkUserId: null,
      error: NextResponse.json({ error: { code: 'forbidden', message: 'forbidden' } }, { status: 403 }),
    })

    const req = new NextRequest('http://localhost:3000/api/admin/configurator/prompt-behavior?partner_account_id=partner-b')
    const res = await GET(req)

    expect(res.status).toBe(403)
    expect(getPromptConfigMock).not.toHaveBeenCalled()
  })

  it('PATCH returns 403 and never writes when the caller does not administer the target partner account', async () => {
    requirePartnerAdminMock.mockResolvedValue({
      clerkUserId: null,
      error: NextResponse.json({ error: { code: 'forbidden', message: 'forbidden' } }, { status: 403 }),
    })

    const req = new NextRequest('http://localhost:3000/api/admin/configurator/prompt-behavior', {
      method: 'PATCH',
      body: JSON.stringify({
        partner_account_id: '3f9a1c22-1234-4321-aaaa-111122223333',
        deferral_phrasing: { mode: 'literal', text: 'Let\'s cover that next time.' },
      }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(403)
    expect(upsertCalled).not.toHaveBeenCalled()
  })

  it('PATCH rejects an invalid dual-mode field before ever calling requirePartnerAdmin (Zod validation gate)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/configurator/prompt-behavior', {
      method: 'PATCH',
      body: JSON.stringify({
        partner_account_id: '3f9a1c22-1234-4321-aaaa-111122223333',
        goodbye_line: { mode: 'not-a-real-mode', text: 'x' },
      }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(400)
    expect(requirePartnerAdminMock).not.toHaveBeenCalled()
  })

  it('PATCH proceeds and writes only the fields present in the body, mapped from snake_case to camelCase', async () => {
    requirePartnerAdminMock.mockResolvedValue({ clerkUserId: 'admin-1', error: null })

    const req = new NextRequest('http://localhost:3000/api/admin/configurator/prompt-behavior', {
      method: 'PATCH',
      body: JSON.stringify({
        partner_account_id: '4a8b2d33-5678-4321-bbbb-222233334444',
        deferral_phrasing: { mode: 'literal', text: 'Let\'s cover that next time.' },
        verification_question_style: null, // explicit clear
      }),
    })
    const res = await PATCH(req)

    expect(res.status).toBe(200)
    expect(upsertCalled).toHaveBeenCalledWith(
      '4a8b2d33-5678-4321-bbbb-222233334444',
      expect.objectContaining({
        deferralPhrasing: { mode: 'literal', text: 'Let\'s cover that next time.' },
        verificationQuestionStyle: null,
      })
    )
    // Keys absent from the body must not appear in the patch at all.
    const patchArg = upsertCalled.mock.calls[0][1] as Record<string, unknown>
    expect('tonePersona' in patchArg).toBe(false)
    expect('goodbyeLine' in patchArg).toBe(false)
  })
})
