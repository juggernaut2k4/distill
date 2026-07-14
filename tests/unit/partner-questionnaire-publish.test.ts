import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-03 Requirement Doc Section 6.1/8 — publish enforces (a) >=1 question
 * required (422 no_questions) and (b) the single-published-per-partner
 * invariant (siblings demoted to draft in the same operation).
 */

interface QuestionnaireRow {
  id: string
  partner_account_id: string
  status: 'draft' | 'published'
  schema: unknown[]
}

let rows: QuestionnaireRow[] = []

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((_c1: string, partnerAccountId: string) => ({
          eq: vi.fn((_c2: string, id: string) => ({
            maybeSingle: async () => ({ data: rows.find((r) => r.partner_account_id === partnerAccountId && r.id === id) ?? null }),
          })),
        })),
      })),
      update: vi.fn((patch: Partial<QuestionnaireRow>) => ({
        eq: vi.fn((_c1: string, partnerAccountId: string) => ({
          eq: vi.fn((_c2: string, statusOrId: string) => ({
            neq: vi.fn((_c3: string, excludeId: string) => {
              rows = rows.map((r) =>
                r.partner_account_id === partnerAccountId && r.status === statusOrId && r.id !== excludeId ? { ...r, ...patch } : r
              )
              return Promise.resolve({ error: null })
            }),
            select: vi.fn(() => ({
              single: async () => {
                const target = rows.find((r) => r.partner_account_id === partnerAccountId && r.id === statusOrId)
                if (!target) return { data: null, error: { message: 'not found' } }
                Object.assign(target, patch)
                return { data: target, error: null }
              },
            })),
          })),
        })),
      })),
    })),
  })),
}))

import { publishQuestionnaire } from '@/lib/partner/questionnaire'

describe('publishQuestionnaire', () => {
  beforeEach(() => {
    rows = [
      { id: 'q-empty', partner_account_id: 'p1', status: 'draft', schema: [] },
      { id: 'q-with-questions', partner_account_id: 'p1', status: 'draft', schema: [{ id: 'q1' }] },
      { id: 'q-already-published', partner_account_id: 'p1', status: 'published', schema: [{ id: 'q1' }] },
      { id: 'q-other-partner', partner_account_id: 'p2', status: 'published', schema: [{ id: 'q1' }] },
    ]
  })

  it('rejects with no_questions when the target has zero questions', async () => {
    const result = await publishQuestionnaire('p1', 'q-empty')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('no_questions')
  })

  it('publishing one questionnaire demotes any other published sibling for the SAME partner only', async () => {
    await publishQuestionnaire('p1', 'q-with-questions')

    const target = rows.find((r) => r.id === 'q-with-questions')
    const previouslyPublished = rows.find((r) => r.id === 'q-already-published')
    const otherPartner = rows.find((r) => r.id === 'q-other-partner')

    expect(target?.status).toBe('published')
    expect(previouslyPublished?.status).toBe('draft') // demoted
    expect(otherPartner?.status).toBe('published') // untouched — different partner_account_id
  })

  it('returns not_found for a questionnaire id that does not belong to this partner', async () => {
    const result = await publishQuestionnaire('p1', 'q-other-partner')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_found')
  })
})
