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
let mockCurrentFixState = 'none'
let mockCurrentStatus = 'approved'
let capturedFixLogInsert: Record<string, unknown> | null = null

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(() => ({ userId: mockUserId })),
}))

vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn(() => Promise.resolve()) },
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
          // TMPL-01 — used by the pre-approve fix_state guard check.
          // TMPL-03 — the same select/eq/maybeSingle chain is reused by the
          // pre-reopen status guard check (route.ts only ever reads one
          // column per call in real life, but the mock returns both fields
          // unconditionally since it doesn't inspect the select() argument).
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: { fix_state: mockCurrentFixState, status: mockCurrentStatus },
                  error: null,
                })
              ),
            })),
          })),
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
      if (table === 'template_fix_log') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            capturedFixLogInsert = row
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      if (table === 'internal_admin_users') {
        // B2B-21 — backs the requireSuperAdmin() gate now layered on top of
        // requireSessionAuth/isConfiguredApprover (see route.ts). This suite
        // tests the pre-existing approver logic, not the new gate, so every
        // signed-in mockUserId resolves to an active super-admin — a
        // pass-through, not a new behavior under test here.
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              neq: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: mockUserId
                      ? { id: 'internal-admin-1', clerk_user_id: mockUserId, role: 'super_admin', status: 'active', email: mockUserEmail }
                      : null,
                    error: null,
                  })
                ),
              })),
            })),
          })),
        }
      }
      return { select: vi.fn(() => ({ data: null, error: null })) }
    }),
  })),
}))

import { PATCH } from '@/app/api/templates/library/[templateName]/route'
import { inngest } from '@/inngest/client'

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
    mockCurrentFixState = 'none'
    mockCurrentStatus = 'approved'
    capturedFixLogInsert = null
    vi.mocked(inngest.send).mockClear()
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

  it('reset_to_pending also resets fix_state to none (TMPL-01 Section 6)', async () => {
    await PATCH(makeRequest({ action: 'reset_to_pending' }), { params: { templateName: 'Overlay' } })
    expect(capturedUpdatePayload?.fix_state).toBe('none')
  })

  // ─── TMPL-01: automated feedback -> LLM fix -> re-review loop ───────────────

  describe('TMPL-01 — automated fix loop extension', () => {
    it('request_changes on Heatmap sets fix_state=generating, resets attempt count, assigns a fix_cycle_id, logs feedback_received, and fires clio/template.fix_requested', async () => {
      const res = await PATCH(makeRequest({ action: 'request_changes', notes: 'Cells feel too dense.' }), {
        params: { templateName: 'Heatmap' },
      })
      expect(res.status).toBe(200)

      expect(capturedUpdatePayload?.status).toBe('changes_requested')
      expect(capturedUpdatePayload?.fix_state).toBe('generating')
      expect(capturedUpdatePayload?.fix_attempt_count).toBe(0)
      expect(capturedUpdatePayload?.fix_changes_summary).toBeNull()
      expect(capturedUpdatePayload?.fix_failure_reason).toBeNull()
      expect(typeof capturedUpdatePayload?.fix_cycle_id).toBe('string')
      expect((capturedUpdatePayload?.fix_cycle_id as string).length).toBeGreaterThan(0)

      expect(capturedFixLogInsert?.event_type).toBe('feedback_received')
      expect(capturedFixLogInsert?.template_name).toBe('Heatmap')
      expect(capturedFixLogInsert?.fix_cycle_id).toBe(capturedUpdatePayload?.fix_cycle_id)

      expect(inngest.send).toHaveBeenCalledTimes(1)
      expect(inngest.send).toHaveBeenCalledWith({
        name: 'clio/template.fix_requested',
        data: {
          templateName: 'Heatmap',
          notes: 'Cells feel too dense.',
          fixCycleId: capturedUpdatePayload?.fix_cycle_id,
        },
      })
    })

    it('request_changes on a non-fix-loop template (e.g. CaseStudy) behaves exactly as RTV-04 built it — no fix_state, no log row, no event (Section 9)', async () => {
      await PATCH(makeRequest({ action: 'request_changes', notes: 'Too generic.' }), {
        params: { templateName: 'CaseStudy' },
      })

      expect(capturedUpdatePayload?.status).toBe('changes_requested')
      expect(capturedUpdatePayload?.fix_state).toBeUndefined()
      expect(capturedUpdatePayload?.fix_cycle_id).toBeUndefined()
      expect(capturedFixLogInsert).toBeNull()
      expect(inngest.send).not.toHaveBeenCalled()
    })

    it('rejects approve with 400 and makes no status-changing update when fix_state is "generating" (Section 4.2/7 — server-side guard, not just a hidden button)', async () => {
      mockCurrentFixState = 'generating'
      const res = await PATCH(makeRequest({ action: 'approve' }), { params: { templateName: 'Heatmap' } })
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toMatch(/automated fix/i)
      expect(capturedUpdatePayload).toBeNull()
    })

    it('rejects approve with 400 when fix_state is "failed"', async () => {
      mockCurrentFixState = 'failed'
      const res = await PATCH(makeRequest({ action: 'approve' }), { params: { templateName: 'Overlay' } })
      expect(res.status).toBe(400)
      expect(capturedUpdatePayload).toBeNull()
    })

    it('allows approve when fix_state is "none"', async () => {
      mockCurrentFixState = 'none'
      const res = await PATCH(makeRequest({ action: 'approve' }), { params: { templateName: 'Heatmap' } })
      expect(res.status).toBe(200)
      expect(capturedUpdatePayload?.status).toBe('approved')
    })
  })

  // ─── TMPL-03: reopen an already-approved template for additional feedback ──

  describe('TMPL-03 — reopen_for_review', () => {
    it('succeeds when the current status is approved, moving it back to pending_review and clearing review/fix-summary metadata', async () => {
      mockCurrentStatus = 'approved'
      const res = await PATCH(makeRequest({ action: 'reopen_for_review' }), {
        params: { templateName: 'Heatmap' },
      })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(capturedUpdatePayload?.status).toBe('pending_review')
      expect(capturedUpdatePayload?.reviewed_by).toBeNull()
      expect(capturedUpdatePayload?.reviewed_at).toBeNull()
      expect(capturedUpdatePayload?.review_notes).toBeNull()
      expect(capturedUpdatePayload?.fix_state).toBe('none')
      expect(capturedUpdatePayload?.fix_changes_summary).toBeNull()
      expect(capturedUpdatePayload?.fix_failure_reason).toBeNull()
      expect(json.template.status).toBe('pending_review')
    })

    it.each(['pending_review', 'changes_requested'])(
      'returns 400 and makes no column changes when the current status is %s (not approved)',
      async (currentStatus) => {
        mockCurrentStatus = currentStatus
        const res = await PATCH(makeRequest({ action: 'reopen_for_review' }), {
          params: { templateName: 'Heatmap' },
        })
        const json = await res.json()

        expect(res.status).toBe(400)
        expect(json.error).toMatch(/not currently approved/i)
        expect(capturedUpdatePayload).toBeNull()
      }
    )

    it('the update payload never includes style_overrides, sample_data, container_spec, fix_cycle_id, or fix_attempt_count', async () => {
      mockCurrentStatus = 'approved'
      await PATCH(makeRequest({ action: 'reopen_for_review' }), { params: { templateName: 'Heatmap' } })

      expect(capturedUpdatePayload).not.toBeNull()
      expect(Object.prototype.hasOwnProperty.call(capturedUpdatePayload, 'style_overrides')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(capturedUpdatePayload, 'sample_data')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(capturedUpdatePayload, 'container_spec')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(capturedUpdatePayload, 'fix_cycle_id')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(capturedUpdatePayload, 'fix_attempt_count')).toBe(false)
    })

    it("returns 403 and makes no DB write when the caller is not the configured approver, and status remains approved", async () => {
      mockUserEmail = 'someone-else@example.com'
      mockCurrentStatus = 'approved'
      const res = await PATCH(makeRequest({ action: 'reopen_for_review' }), {
        params: { templateName: 'Heatmap' },
      })
      const json = await res.json()

      expect(res.status).toBe(403)
      expect(json.error).toMatch(/configured approver/i)
      expect(capturedUpdatePayload).toBeNull()
    })

    it('returns 403 for EVERYONE, including a matching email, when TEMPLATE_LIBRARY_APPROVER_EMAIL is unset (fail closed)', async () => {
      delete process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL
      mockUserEmail = 'approver@example.com' // would otherwise match
      mockCurrentStatus = 'approved'
      const res = await PATCH(makeRequest({ action: 'reopen_for_review' }), {
        params: { templateName: 'Heatmap' },
      })

      expect(res.status).toBe(403)
      expect(capturedUpdatePayload).toBeNull()
    })
  })
})
