import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * TMPL-01 — POST /api/templates/library/[templateName]/nudge
 * (requirement doc Section 4.3/6/7/8).
 *
 * Mirrors the mocking approach already used in
 * tests/integration/template-library-api.test.ts.
 */

let mockUserId: string | null = 'user-1'
let mockUserEmail: string | null = 'approver@example.com'
let mockCurrentRow: { fix_state: string; fix_attempt_count: number; fix_cycle_id: string | null } | null = {
  fix_state: 'failed',
  fix_attempt_count: 5,
  fix_cycle_id: 'cycle-1',
}
let capturedUpdatePayload: Record<string, unknown> | null = null
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
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: mockCurrentRow, error: null })),
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
      return { select: vi.fn(() => ({ data: null, error: null })) }
    }),
  })),
}))

import { POST } from '@/app/api/templates/library/[templateName]/nudge/route'
import { inngest } from '@/inngest/client'

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/templates/library/Heatmap/nudge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/templates/library/[templateName]/nudge', () => {
  const originalApproverEnv = process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL

  beforeEach(() => {
    mockUserId = 'user-1'
    mockUserEmail = 'approver@example.com'
    mockCurrentRow = { fix_state: 'failed', fix_attempt_count: 5, fix_cycle_id: 'cycle-1' }
    capturedUpdatePayload = null
    capturedFixLogInsert = null
    vi.mocked(inngest.send).mockClear()
    process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL = 'approver@example.com'
  })

  afterEach(() => {
    process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL = originalApproverEnv
  })

  it('returns 401 when the caller is not authenticated', async () => {
    mockUserId = null
    const res = await POST(makeRequest({ action: 'status_check' }), { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(401)
  })

  it("returns 403 and starts no new cycle when the caller's email does not match the configured approver", async () => {
    mockUserEmail = 'someone-else@example.com'
    const res = await POST(makeRequest({ action: 'force_retrigger' }), { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(403)
    expect(capturedUpdatePayload).toBeNull()
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('returns 403 for EVERYONE, including a matching email, when TEMPLATE_LIBRARY_APPROVER_EMAIL is unset (fail closed)', async () => {
    delete process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL
    mockUserEmail = 'approver@example.com' // would otherwise match
    const res = await POST(makeRequest({ action: 'force_retrigger' }), { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(403)
    expect(capturedUpdatePayload).toBeNull()
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('returns 400 for a template that does not participate in the fix loop', async () => {
    const res = await POST(makeRequest({ action: 'status_check' }), { params: { templateName: 'CaseStudy' } })
    expect(res.status).toBe(400)
  })

  it('returns 400 on a malformed body (Zod validation failure)', async () => {
    const res = await POST(makeRequest({ action: 'delete_everything' }), { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(400)
  })

  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/templates/library/Heatmap/nudge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    })
    const res = await POST(req, { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(400)
  })

  it('status_check logs a nudge event with the actor email and current state, with no other side effects', async () => {
    mockCurrentRow = { fix_state: 'generating', fix_attempt_count: 3, fix_cycle_id: 'cycle-9' }
    const res = await POST(makeRequest({ action: 'status_check' }), { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(200)

    expect(capturedFixLogInsert?.event_type).toBe('nudge_status_check')
    expect(capturedFixLogInsert?.actor).toBe('approver@example.com')
    expect(capturedFixLogInsert?.fix_cycle_id).toBe('cycle-9')
    expect(String(capturedFixLogInsert?.message)).toMatch(/approver@example\.com/)

    // No mutating update and no new fix cycle triggered
    expect(capturedUpdatePayload).toBeNull()
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('force_retrigger on a failed cycle starts a new attempt immediately, uncapped by the 5-attempt automatic limit', async () => {
    mockCurrentRow = { fix_state: 'failed', fix_attempt_count: 5, fix_cycle_id: 'cycle-1' }
    const res = await POST(makeRequest({ action: 'force_retrigger' }), { params: { templateName: 'Heatmap' } })
    expect(res.status).toBe(200)

    // Continues incrementing rather than resetting to 0 (Section 4.2/6)
    expect(capturedUpdatePayload?.fix_attempt_count).toBe(6)
    expect(capturedUpdatePayload?.fix_state).toBe('generating')
    expect(capturedUpdatePayload?.fix_cycle_id).not.toBe('cycle-1')
    expect(capturedUpdatePayload?.fix_failure_reason).toBeNull()

    expect(capturedFixLogInsert?.event_type).toBe('nudge_force_retrigger')
    expect(capturedFixLogInsert?.actor).toBe('approver@example.com')
    expect(capturedFixLogInsert?.fix_cycle_id).toBe(capturedUpdatePayload?.fix_cycle_id)

    expect(inngest.send).toHaveBeenCalledTimes(1)
    expect(inngest.send).toHaveBeenCalledWith({
      name: 'clio/template.fix_requested',
      data: {
        templateName: 'Heatmap',
        notes: '',
        fixCycleId: capturedUpdatePayload?.fix_cycle_id,
        forceRetrigger: true,
      },
    })
  })

  it('force_retrigger assigns a fix_cycle_id different from any in-flight cycle (supersedes it)', async () => {
    mockCurrentRow = { fix_state: 'generating', fix_attempt_count: 2, fix_cycle_id: 'cycle-in-flight' }
    await POST(makeRequest({ action: 'force_retrigger' }), { params: { templateName: 'Heatmap' } })
    expect(capturedUpdatePayload?.fix_cycle_id).not.toBe('cycle-in-flight')
    expect(capturedUpdatePayload?.fix_attempt_count).toBe(3)
  })
})
