import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-11 — tests for lib/partner/prompt-config.ts. See
 * docs/specs/B2B-11-requirement-document.md Section 7 for the exact
 * acceptance-test list this file implements (partial-merge upsert contract,
 * field validation rejection, malformed-row read handling, cross-partner
 * isolation, default join-greeting wording constraints).
 */

const state: {
  rows: Record<string, Record<string, unknown>>
} = { rows: {} }

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table !== 'partner_prompt_config') throw new Error(`Unexpected table: ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, partnerAccountId: string) => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: state.rows[partnerAccountId] ?? null })),
          })),
        })),
        upsert: vi.fn((row: Record<string, unknown>) => {
          state.rows[row.partner_account_id as string] = row
          return {
            select: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: row, error: null })),
            })),
          }
        }),
      }
    }),
  })),
}))

import {
  getPromptConfig,
  upsertPromptConfig,
  isValidDualModeField,
  isValidInstructionText,
  CLIO_DEFAULT_PROMPT_CONFIG,
  DEFAULT_JOIN_GREETING,
} from '@/lib/partner/prompt-config'

describe('lib/partner/prompt-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.rows = {}
  })

  describe('validators', () => {
    it('isValidDualModeField accepts a well-formed {mode, text} and rejects malformed shapes', () => {
      expect(isValidDualModeField({ mode: 'literal', text: 'hello' })).toBe(true)
      expect(isValidDualModeField({ mode: 'instruction', text: 'hello' })).toBe(true)
      expect(isValidDualModeField({ mode: 'bogus', text: 'hello' })).toBe(false)
      expect(isValidDualModeField({ mode: 'literal', text: '' })).toBe(false)
      expect(isValidDualModeField({ mode: 'literal', text: 'x'.repeat(501) })).toBe(false)
      expect(isValidDualModeField({ text: 'no mode' })).toBe(false)
      expect(isValidDualModeField('a plain string')).toBe(false)
      expect(isValidDualModeField(null)).toBe(false)
    })

    it('isValidInstructionText enforces 1-500 chars and rejects non-strings', () => {
      expect(isValidInstructionText('valid')).toBe(true)
      expect(isValidInstructionText('')).toBe(false)
      expect(isValidInstructionText('x'.repeat(500))).toBe(true)
      expect(isValidInstructionText('x'.repeat(501))).toBe(false)
      expect(isValidInstructionText({ mode: 'literal', text: 'x' })).toBe(false)
    })
  })

  describe('getPromptConfig', () => {
    it('returns CLIO_DEFAULT_PROMPT_CONFIG when no row exists', async () => {
      const config = await getPromptConfig('partner-a')
      expect(config).toEqual(CLIO_DEFAULT_PROMPT_CONFIG)
    })

    it('treats a malformed stored field as unset (never throws), while other valid fields on the same row still render', async () => {
      state.rows['partner-a'] = {
        partner_account_id: 'partner-a',
        tone_persona: { mode: 'not-a-real-mode', text: 'broken' }, // malformed
        deferral_phrasing: { mode: 'literal', text: 'Good deferral text.' }, // valid
        closing_confirmation_question: null,
        goodbye_line: null,
        join_greeting: null,
        verification_question_style: null,
        inter_section_recap_style: null,
      }

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config = await getPromptConfig('partner-a')
      warnSpy.mockRestore()

      expect(config.tonePersona).toBeNull()
      expect(config.deferralPhrasing).toEqual({ mode: 'literal', text: 'Good deferral text.' })
    })
  })

  describe('upsertPromptConfig — partial-merge contract', () => {
    it('a key entirely absent from patch leaves the existing stored value unchanged', async () => {
      state.rows['partner-a'] = {
        partner_account_id: 'partner-a',
        tone_persona: { mode: 'literal', text: 'Existing tone.' },
        deferral_phrasing: null,
        closing_confirmation_question: null,
        goodbye_line: null,
        join_greeting: null,
        verification_question_style: null,
        inter_section_recap_style: null,
      }

      const result = await upsertPromptConfig('partner-a', {
        deferralPhrasing: { mode: 'instruction', text: 'New deferral guidance.' },
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.tonePersona).toEqual({ mode: 'literal', text: 'Existing tone.' }) // unchanged
        expect(result.data.deferralPhrasing).toEqual({ mode: 'instruction', text: 'New deferral guidance.' })
      }
    })

    it('a key present with value null clears that field back to default', async () => {
      state.rows['partner-a'] = {
        partner_account_id: 'partner-a',
        tone_persona: { mode: 'literal', text: 'Existing tone.' },
        deferral_phrasing: null,
        closing_confirmation_question: null,
        goodbye_line: null,
        join_greeting: null,
        verification_question_style: null,
        inter_section_recap_style: null,
      }

      const result = await upsertPromptConfig('partner-a', { tonePersona: null })

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.tonePersona).toBeNull()
    })

    it('rejects the entire write (no partial write) when any single field is invalid', async () => {
      state.rows['partner-a'] = {
        partner_account_id: 'partner-a',
        tone_persona: null,
        deferral_phrasing: null,
        closing_confirmation_question: null,
        goodbye_line: null,
        join_greeting: null,
        verification_question_style: null,
        inter_section_recap_style: null,
      }

      const result = await upsertPromptConfig('partner-a', {
        deferralPhrasing: { mode: 'literal', text: 'Valid text.' },
        goodbyeLine: { mode: 'bogus-mode' as never, text: 'Invalid.' },
      })

      expect(result).toEqual({ ok: false, error: 'invalid_prompt_field' })
      // No write occurred — stored row unchanged.
      expect(state.rows['partner-a'].deferral_phrasing).toBeNull()
    })

    it('verification_question_style and inter_section_recap_style reject a {mode, text} object shape (instruction-only, no literal mode by design)', async () => {
      const result = await upsertPromptConfig('partner-a', {
        verificationQuestionStyle: { mode: 'literal', text: 'Not allowed' } as unknown as string,
      })
      expect(result).toEqual({ ok: false, error: 'invalid_prompt_field' })
    })
  })

  describe('cross-partner isolation', () => {
    it('reads for Partner A never return Partner B\'s configured fields', async () => {
      state.rows['partner-a'] = {
        partner_account_id: 'partner-a',
        tone_persona: { mode: 'literal', text: 'Partner A tone.' },
        deferral_phrasing: null, closing_confirmation_question: null, goodbye_line: null,
        join_greeting: null, verification_question_style: null, inter_section_recap_style: null,
      }
      state.rows['partner-b'] = {
        partner_account_id: 'partner-b',
        tone_persona: { mode: 'literal', text: 'Partner B tone.' },
        deferral_phrasing: null, closing_confirmation_question: null, goodbye_line: null,
        join_greeting: null, verification_question_style: null, inter_section_recap_style: null,
      }

      const configA = await getPromptConfig('partner-a')
      const configB = await getPromptConfig('partner-b')

      expect(configA.tonePersona?.text).toBe('Partner A tone.')
      expect(configB.tonePersona?.text).toBe('Partner B tone.')
    })
  })

  describe('DEFAULT_JOIN_GREETING', () => {
    it('contains no reference to Arun, no unprompted literal "Clio", and no B2C-specific framing', () => {
      const text = DEFAULT_JOIN_GREETING.text.toLowerCase()
      expect(text).not.toContain('arun')
      expect(text).not.toContain('clio')
      expect(DEFAULT_JOIN_GREETING.mode).toBe('instruction')
      expect(DEFAULT_JOIN_GREETING.text).toContain('{firstName}')
    })
  })
})
