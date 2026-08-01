import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * B2B-61 Part C (2026-07-31) — closes the gap OpenAIRealtimeAdapterConfig.instructions'
 * own doc comment flagged as explicitly out of scope for Part A: real, per-session content
 * wiring for the OpenAI Realtime provider. Reuses the exact same assembled prompt Hume's
 * native mode already gets (lib/voice/hume-native/prompt-template.ts's assembleHumeNativePrompt
 * output, computed in lib/partner/live-render.ts) rather than authoring anything new — the
 * template contains no Hume-specific mechanics or branding, so no per-provider rewriting of the
 * prompt text itself was needed.
 *
 * Source-text assertions, following the same convention as tests/unit/b2b61-partb-wiring.test.ts
 * for the two server-component files that can't be live-imported under this repo's node-environment
 * vitest config.
 */

const liveRenderSource = fs.readFileSync(path.resolve(__dirname, '../../lib/partner/live-render.ts'), 'utf8')
const pageSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx'),
  'utf8'
)
const clientSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'),
  'utf8'
)
const adapterSource = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/openai-realtime-adapter.ts'), 'utf8')

describe('B2B-61 Part C — live-render.ts returns the assembled prompt for both content modes', () => {
  it('LiveRenderResult declares assembledPrompt on both the template and inline "ok" variants', () => {
    const typeMatch = liveRenderSource.match(/export type LiveRenderResult =[\s\S]*?\n\n/)
    expect(typeMatch).not.toBeNull()
    const occurrences = typeMatch![0].match(/assembledPrompt: string \| null/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('resolveLiveSessionRender (template mode) sets and returns assembledPrompt', () => {
    expect(liveRenderSource).toContain('assembledPrompt = prompt')
    // B2B-62 added conversationLanguage after assembledPrompt in the return statement, so this no
    // longer requires assembledPrompt to be the last property before the closing brace.
    expect(liveRenderSource).toMatch(/mode: 'template',[\s\S]*?assembledPrompt,/)
  })

  it('resolveInlineSessionRender (inline mode) sets and returns assembledPrompt', () => {
    expect(liveRenderSource).toMatch(/mode: 'inline',[\s\S]*?assembledPrompt,/)
  })
})

describe('B2B-61 Part C — page.tsx threads voiceInstructions through to both call sites', () => {
  it('passes voiceInstructions={result.assembledPrompt} at both call sites (inline and template mode)', () => {
    const occurrences = pageSource.match(/voiceInstructions=\{result\.assembledPrompt\}/g) ?? []
    expect(occurrences).toHaveLength(2)
  })
})

describe('B2B-61 Part C — PartnerRenderClient.tsx uses real content for the OpenAI provider', () => {
  it('PartnerRenderClientProps declares voiceInstructions: string | null', () => {
    const interfaceMatch = clientSource.match(/export interface PartnerRenderClientProps \{[\s\S]*?\n\}/)
    expect(interfaceMatch).not.toBeNull()
    expect(interfaceMatch![0]).toMatch(/voiceInstructions:\s*string\s*\|\s*null/)
  })

  it('the component destructures voiceInstructions from props', () => {
    const destructureMatch = clientSource.match(/export default function PartnerRenderClient\(\{([\s\S]*?)\}:\s*PartnerRenderClientProps\)/)
    expect(destructureMatch).not.toBeNull()
    expect(destructureMatch![1]).toMatch(/voiceInstructions,?/)
  })

  it('OpenAIRealtimeAdapter.create() is given voiceInstructions, falling back to the placeholder only when null', () => {
    expect(clientSource).toMatch(/voiceInstructions\s*\?\?/)
  })
})

describe('B2B-61 Part C — voice selection', () => {
  it('openai-realtime-adapter.ts requests the "marin" voice, not the placeholder "alloy"', () => {
    expect(adapterSource).not.toContain("voice: 'alloy'")
    expect(adapterSource).toContain("voice: 'marin'")
  })

  it('requests a 30% slowdown (speed: 0.7) per Arun\'s 2026-08-01 request', () => {
    expect(adapterSource).toContain('speed: 0.7')
  })
})

describe('B2B-61 Part C — OpenAI voice delivery persona (2026-08-01, Arun\'s exact wording)', () => {
  const personaSource = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/openai-realtime-persona.ts'), 'utf8')

  it('imports OPENAI_VOICE_PERSONA_INSTRUCTIONS from its own dedicated module', () => {
    expect(clientSource).toContain("import { OPENAI_VOICE_PERSONA_INSTRUCTIONS } from '@/lib/voice/openai-realtime-persona'")
  })

  it('prepends the persona instructions ahead of the real session content in the OpenAI instructions field', () => {
    expect(clientSource).toMatch(/instructions:\s*\n\s*`\$\{OPENAI_VOICE_PERSONA_INSTRUCTIONS\}\\n\\n\$\{/)
  })

  it('the persona module contains every section of Arun\'s exact wording, verbatim', () => {
    expect(personaSource).toContain('Accent/Affect: Warm, cheerful, energetic, and welcoming')
    expect(personaSource).toContain('Tone: Encouraging, educational, and conversational.')
    expect(personaSource).toContain('Pacing: Steady and engaging. Slow down for complex ideas')
    expect(personaSource).toContain('Emotion: Genuinely excited, positive, and supportive.')
    expect(personaSource).toContain('Pronunciation: Speak clearly and articulate important terminology')
    expect(personaSource).toContain('Teaching Style: Break information into clear, manageable steps.')
    expect(personaSource).toContain('Personality Affect: Friendly, approachable, uplifting, and confidently knowledgeable.')
    expect(personaSource).toContain('Interaction Style: Encourage participation and curiosity.')
    expect(personaSource).toContain('Overall Experience: Create a warm and engaging learning environment')
  })

  it('is never referenced by hume-adapter.ts or the shared prompt template (OpenAI-only, does not affect Hume)', () => {
    const humeAdapterSource = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/hume-adapter.ts'), 'utf8')
    const promptTemplateSource = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/hume-native/prompt-template.ts'), 'utf8')
    expect(humeAdapterSource).not.toContain('OPENAI_VOICE_PERSONA_INSTRUCTIONS')
    expect(promptTemplateSource).not.toContain('OPENAI_VOICE_PERSONA_INSTRUCTIONS')
  })
})
