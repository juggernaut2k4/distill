import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { assembleHumeNativePrompt } from '@/lib/voice/hume-native/prompt-template'
import { CreateSessionSchema } from '@/lib/partner/session-schema'

/**
 * B2B-62 (2026-08-01) — English content, spoken conversation in another language. Per Arun's
 * direct request to have this "built and ready by morning": a session-wide
 * `conversation_language` field (partner_sessions, migration 105) threaded through the shared
 * prompt assembly (lib/voice/hume-native/prompt-template.ts) for both providers, plus a
 * session-wide off switch for the B2B-59/60 transcript-watch cue (matchesSpokenPhrase/wordTokens
 * are ASCII-only — cannot correctly match accented-language transcripts), falling back to the
 * advance_tab tool call alone for any non-English session.
 *
 * To actually test this before a UI control exists: call POST /api/partner/v1/sessions directly
 * (Postman/curl) with `"language": "french"` in the body — the /demo/[slug] dispatch flow does not
 * yet expose a language field in its own UI.
 */

const BASE_PROMPT_INPUT = {
  profileContext: '',
  intentContext: '',
  sessionContent: 'Section 1 content here.',
}

describe('B2B-62 — buildLanguageInstruction via assembleHumeNativePrompt', () => {
  it('omitting conversationLanguage produces byte-identical output to not having the field at all', () => {
    const withField = assembleHumeNativePrompt({ ...BASE_PROMPT_INPUT, conversationLanguage: undefined })
    const withoutField = assembleHumeNativePrompt(BASE_PROMPT_INPUT)
    expect(withField).toBe(withoutField)
  })

  it('null and blank-string conversationLanguage both resolve to no instruction (English by omission)', () => {
    const withNull = assembleHumeNativePrompt({ ...BASE_PROMPT_INPUT, conversationLanguage: null })
    const withBlank = assembleHumeNativePrompt({ ...BASE_PROMPT_INPUT, conversationLanguage: '   ' })
    const withoutField = assembleHumeNativePrompt(BASE_PROMPT_INPUT)
    expect(withNull).toBe(withoutField)
    expect(withBlank).toBe(withoutField)
  })

  it('a real language adds a clear, title-cased instruction to conduct the session in that language', () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_PROMPT_INPUT, conversationLanguage: 'french' })
    expect(assembled).toContain('Conduct this entire live session in French.')
    expect(assembled).toContain('the reference material provided below in SESSION CONTENT is written in English')
    expect(assembled).toContain('never read it verbatim in English')
  })

  it('leaves no unresolved [LANGUAGE INSTRUCTION] placeholder in the output, with or without the field set', () => {
    expect(assembleHumeNativePrompt(BASE_PROMPT_INPUT)).not.toContain('[LANGUAGE INSTRUCTION]')
    expect(assembleHumeNativePrompt({ ...BASE_PROMPT_INPUT, conversationLanguage: 'spanish' })).not.toContain('[LANGUAGE INSTRUCTION]')
  })

  it('the language instruction lands early (within the tone-guidance zone), not buried after SESSION CONTENT', () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_PROMPT_INPUT, conversationLanguage: 'french' })
    const instructionIndex = assembled.indexOf('Conduct this entire live session in French.')
    const sessionContentIndex = assembled.indexOf('=== SESSION CONTENT ===')
    expect(instructionIndex).toBeGreaterThan(-1)
    expect(instructionIndex).toBeLessThan(sessionContentIndex)
  })
})

describe('B2B-62 — CreateSessionSchema accepts an optional language field', () => {
  const validBase = {
    meeting_url: 'https://meet.google.com/abc-defg-hij',
    content_ref: '11111111-1111-1111-1111-111111111111',
    end_user_name: 'Test User',
    reseller_id: '22222222-2222-2222-2222-222222222222',
  }

  it('accepts a valid language string', () => {
    const result = CreateSessionSchema.safeParse({ ...validBase, language: 'french' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.language).toBe('french')
  })

  it('is fully optional — a request with no language field is unaffected', () => {
    const result = CreateSessionSchema.safeParse(validBase)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.language).toBeUndefined()
  })

  it('rejects an empty-string language (must be non-empty when present)', () => {
    const result = CreateSessionSchema.safeParse({ ...validBase, language: '' })
    expect(result.success).toBe(false)
  })
})

describe('B2B-62 — live-render.ts / page.tsx / PartnerRenderClient.tsx wiring (source-text assertions)', () => {
  const liveRenderSource = fs.readFileSync(path.resolve(__dirname, '../../lib/partner/live-render.ts'), 'utf8')
  const pageSource = fs.readFileSync(
    path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx'),
    'utf8'
  )
  const clientSource = fs.readFileSync(
    path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'),
    'utf8'
  )

  it('PartnerSessionRow and both LiveRenderResult "ok" variants declare conversationLanguage: string | null', () => {
    const rowMatch = liveRenderSource.match(/export interface PartnerSessionRow \{[\s\S]*?\n\}/)
    expect(rowMatch).not.toBeNull()
    expect(rowMatch![0]).toContain('conversationLanguage: string | null')

    const typeMatch = liveRenderSource.match(/export type LiveRenderResult =[\s\S]*?\n\n/)
    expect(typeMatch).not.toBeNull()
    const occurrences = typeMatch![0].match(/conversationLanguage: string \| null/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('getPartnerSession selects and returns conversation_language', () => {
    expect(liveRenderSource).toContain('conversation_language')
    expect(liveRenderSource).toContain('conversationLanguage: (data.conversation_language as string | null) ?? null')
  })

  it('both assembleHumeNativePrompt call sites, and both new B2B-68 assembleOpenAIRealtimePrompt call sites, pass conversationLanguage through', () => {
    // B2B-68 (2026-08-02) added a second, independent prompt-assembly call (assembleOpenAIRealtimePrompt)
    // alongside each existing assembleHumeNativePrompt call — both resolver functions now pass
    // conversationLanguage to two call sites each, so 2 -> 4.
    const occurrences = liveRenderSource.match(/conversationLanguage: session\.conversationLanguage \?\? undefined/g) ?? []
    expect(occurrences).toHaveLength(4)
  })

  it('both return statements echo conversationLanguage back out', () => {
    const occurrences = liveRenderSource.match(/conversationLanguage: session\.conversationLanguage,/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('page.tsx passes conversationLanguage={result.conversationLanguage} at both call sites', () => {
    const occurrences = pageSource.match(/conversationLanguage=\{result\.conversationLanguage\}/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('PartnerRenderClientProps declares conversationLanguage: string | null and the component destructures it', () => {
    const interfaceMatch = clientSource.match(/export interface PartnerRenderClientProps \{[\s\S]*?\n\}/)
    expect(interfaceMatch).not.toBeNull()
    expect(interfaceMatch![0]).toMatch(/conversationLanguage:\s*string\s*\|\s*null/)

    const destructureMatch = clientSource.match(/export default function PartnerRenderClient\(\{([\s\S]*?)\}:\s*PartnerRenderClientProps\)/)
    expect(destructureMatch).not.toBeNull()
    expect(destructureMatch![1]).toMatch(/conversationLanguage,?/)
  })

  it('stage2EligibleRef is gated by isEnglishSession, forcing an all-false array for non-English sessions', () => {
    expect(clientSource).toContain('isInline && isEnglishSession ? computeStage2Eligibility(inlinePages!, \'\')')
    expect(clientSource).toContain("inlinePages!.map(() => false)")
  })
})
