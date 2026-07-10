import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * RTV-04 — PATCH /api/templates/library/[templateName] auth-gating
 * (Section 7 acceptance tests / Section 8 error states).
 *
 * Mirrors the mocking approach already used elsewhere in this suite
 * (tests/integration/onboarding-api.test.ts mocks '@clerk/nextjs/server''s
 * auth() directly, since requireSessionAuth is a thin wrapper around it).
 */

let mockUserId: string | null = 'user-1'
let mockUserEmail: string | null = 'approver@example.com'
let capturedUpdatePayload: Record<string, unknown> | null = null

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(() => ({ userId: mockUserId })),
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({ data: mockUserEmail ? { email: mockUserEmail } : null, error: null })
              ),
            })),
          })),
        }
      }
      if (table === 'template_library') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            capturedUpdatePayload = payload
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(() =>
                    Promise.resolve({ data: { template_name: 'Heatmap', ...payload }, error: null })
                  ),
                })),
              })),
            }
          }),
        }
      }
      return { select: vi.fn(() => ({ data: null, error: null })) }
    }),
  })),
}))

import { PATCH } from '@/app/api/templates/library/[templateName]/route'

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/templates/library/Heatmap', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/templates/library/[templateName]', () => {
  const originalApproverEnv = process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL

  beforeEach(() => {
    mockUserId = 'user-1'
    mockUserEmail = 'approver@example.com'
    capturedUpdatePayload = null
    process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL = 'approver@example.com'
  })

  afterEach(() => {
    process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL = originalApproverEnv
  })

  it('returns 401 when the caller is not authenticated', async () => {
    mockUserId = null
    const res = await PATCH(makeRequest({ action: 'approve' }), { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(401)
    expect(capturedUpdatePayload).toBeNull()
  })

  it("returns 403 and makes no DB write when the caller's email does not match the configured approver", async () => {
    mockUserEmail = 'someone-else@example.com'
    const res = await PATCH(makeRequest({ action: 'approve' }), { params: { templateName: 'Heatmap' } })
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toMatch(/configured approver/i)
    expect(capturedUpdatePayload).toBeNull()
  })

  it('returns 403 for EVERYONE, including a matching email, when TEMPLATE_LIBRARY_APPROVER_EMAIL is unset (fail closed)', async () => {
    delete process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL
    mockUserEmail = 'approver@example.com' // would otherwise match
    const res = await PATCH(makeRequest({ action: 'approve' }), { params: { templateName: 'Heatmap' } })

    expect(res.status).toBe(403)
    expect(capturedUpdatePayload).toBeNull()
  })

  it('returns 400 on an invalid action (Zod validation failure) and status remains unchanged', async () => {
    const res = await PATCH(makeRequest({ action: 'delete_forever' }), { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(400)
    expect(capturedUpdatePayload).toBeNull()
  })

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/templates/library/Heatmap', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    })
    const res = await PATCH(req, { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(400)
  })

  it('approves successfully for the configured approver, setting reviewed_by from the session (never the request body)', async () => {
    const res = await PATCH(
      makeRequest({ action: 'approve', notes: 'Clean, on-brand.', reviewed_by: 'attacker@example.com' }),
      { params: { templateName: 'Heatmap' } }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(capturedUpdatePayload?.status).toBe('approved')
    expect(capturedUpdatePayload?.reviewed_by).toBe('approver@example.com') // from session, never the body
    expect(capturedUpdatePayload?.review_notes).toBe('Clean, on-brand.')
    expect(capturedUpdatePayload?.reviewed_at).toBeTruthy()
    expect(json.template.status).toBe('approved')
  })

  it('request_changes sets status=changes_requested with the provided notes', async () => {
    await PATCH(makeRequest({ action: 'request_changes', notes: 'Too cramped.' }), {
      params: { templateName: 'Overlay' },
    })
    expect(capturedUpdatePayload?.status).toBe('changes_requested')
    expect(capturedUpdatePayload?.review_notes).toBe('Too cramped.')
  })

  it('reset_to_pending clears reviewed_by/reviewed_at/review_notes back to null (Section 4.3 Screen state 4)', async () => {
    await PATCH(makeRequest({ action: 'reset_to_pending' }), { params: { templateName: 'Overlay' } })
    expect(capturedUpdatePayload?.status).toBe('pending_review')
    expect(capturedUpdatePayload?.reviewed_by).toBeNull()
    expect(capturedUpdatePayload?.reviewed_at).toBeNull()
    expect(capturedUpdatePayload?.review_notes).toBeNull()
  })
})
