import { describe, it, expect } from 'vitest'
import { validateQuestion, validateQuestionnaireSchema } from '@/lib/partner/questionnaire'

/** B2B-03 Requirement Doc Section 4.A.1 — exact builder constraints. */

describe('validateQuestion', () => {
  it('accepts a valid multiple_choice question', () => {
    expect(
      validateQuestion({ id: 'q1', text: "What's your role?", type: 'multiple_choice', options: ['VP', 'Manager'], required: true })
    ).toBe(true)
  })

  it('accepts a valid short_text question with no options', () => {
    expect(validateQuestion({ id: 'q1', text: 'Tell us more', type: 'short_text', required: false })).toBe(true)
  })

  it('rejects text over 200 chars', () => {
    expect(validateQuestion({ id: 'q1', text: 'x'.repeat(201), type: 'short_text', required: true })).toBe(false)
  })

  it('rejects multiple_choice with fewer than 2 options', () => {
    expect(validateQuestion({ id: 'q1', text: 'Role?', type: 'multiple_choice', options: ['Only one'], required: true })).toBe(false)
  })

  it('rejects multiple_choice with more than 8 options', () => {
    expect(
      validateQuestion({
        id: 'q1',
        text: 'Role?',
        type: 'multiple_choice',
        options: Array.from({ length: 9 }, (_, i) => `Option ${i}`),
        required: true,
      })
    ).toBe(false)
  })

  it('rejects an option over 60 chars', () => {
    expect(validateQuestion({ id: 'q1', text: 'Role?', type: 'multiple_choice', options: ['ok', 'y'.repeat(61)], required: true })).toBe(false)
  })

  it('rejects an unknown question type', () => {
    expect(validateQuestion({ id: 'q1', text: 'Role?', type: 'ranking', required: true })).toBe(false)
  })
})

describe('validateQuestionnaireSchema', () => {
  it('accepts an empty array (a questionnaire with no questions yet is a valid draft state)', () => {
    expect(validateQuestionnaireSchema([])).toBe(true)
  })

  it('rejects if any single question is invalid', () => {
    expect(
      validateQuestionnaireSchema([
        { id: 'q1', text: 'Valid?', type: 'yes_no', required: true },
        { id: 'q2', text: '', type: 'short_text', required: true },
      ])
    ).toBe(false)
  })
})
