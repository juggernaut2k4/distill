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
    expect(liveRenderSource).toMatch(/mode: 'template',[\s\S]*?assembledPrompt,\s*\n\s*\}/)
  })

  it('resolveInlineSessionRender (inline mode) sets and returns assembledPrompt', () => {
    expect(liveRenderSource).toMatch(/mode: 'inline',[\s\S]*?assembledPrompt,\s*\n\s*\}/)
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
    expect(clientSource).toMatch(/instructions:\s*\n\s*voiceInstructions\s*\?\?/)
  })
})

describe('B2B-61 Part C — voice selection', () => {
  it('openai-realtime-adapter.ts requests the "marin" voice, not the placeholder "alloy"', () => {
    expect(adapterSource).not.toContain("voice: 'alloy'")
    expect(adapterSource).toContain("voice: 'marin'")
  })
})
