import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * B2B-83 (2026-09-08) — B2B-82 built `openingGreeting` config, `assembleWidgetElevenLabsFirstMessage()`,
 * and `ElevenLabsAdapterConfig.firstMessage` support all correctly, in isolation, but never actually
 * wired the two call sites that were supposed to connect them: `widget-render/page.tsx` never called
 * the assembler, and `WidgetRenderClient.tsx`'s `ElevenLabsAdapter.create({...})` call never passed a
 * `firstMessage` field. So `overrides.agent.firstMessage` was always `undefined` for every real
 * session and ElevenLabs spoke its own static dashboard-configured line instead.
 *
 * Source-text assertions, following the same convention as
 * tests/unit/b2b61-partc-voice-content-wiring.test.ts for the sibling `partner-render` files — this
 * repo's Next.js server/client components in this directory tree are not live-importable under the
 * current node-environment vitest config, so their wiring is verified against their own source text
 * instead of via render/execution.
 */

const pageSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/widget-render/[clio_session_ref]/page.tsx'),
  'utf8'
)
const clientSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/widget-render/[clio_session_ref]/WidgetRenderClient.tsx'),
  'utf8'
)

describe('B2B-83 — page.tsx computes and threads elevenlabsFirstMessage', () => {
  it('imports assembleWidgetElevenLabsFirstMessage from the widget ElevenLabs prompt rules module', () => {
    expect(pageSource).toMatch(
      /import\s*\{[^}]*assembleWidgetElevenLabsFirstMessage[^}]*\}\s*from\s*'@\/lib\/voice\/widget-elevenlabs-prompt-rules'/
    )
  })

  it('computes elevenlabsFirstMessage only for the elevenlabs provider, mirroring the elevenlabsVoiceInstructions gating pattern', () => {
    expect(pageSource).toMatch(
      /const elevenlabsFirstMessage =\s*\n\s*voiceProvider === 'elevenlabs'\s*\n\s*\?\s*assembleWidgetElevenLabsFirstMessage\(/
    )
  })

  it('passes session.endUserName and theme.assistantDisplayName into the assembler, the same inputs the existing elevenlabsVoiceInstructions/promptInput computation already uses', () => {
    const callMatch = pageSource.match(/assembleWidgetElevenLabsFirstMessage\(\{[\s\S]*?\}\)/)
    expect(callMatch).not.toBeNull()
    expect(callMatch![0]).toContain('openingGreeting: promptConfig.openingGreeting')
    expect(callMatch![0]).toContain('session.endUserName')
    expect(callMatch![0]).toContain('theme.assistantDisplayName')
  })

  it('passes elevenlabsFirstMessage as a prop to WidgetRenderClient', () => {
    expect(pageSource).toMatch(/<WidgetRenderClient[\s\S]*?elevenlabsFirstMessage=\{elevenlabsFirstMessage\}[\s\S]*?\/>/)
  })
})

describe('B2B-83 — WidgetRenderClient.tsx receives and forwards elevenlabsFirstMessage to the adapter', () => {
  it('declares elevenlabsFirstMessage: string | null on WidgetRenderClientProps', () => {
    const interfaceMatch = clientSource.match(/export interface WidgetRenderClientProps \{[\s\S]*?\n\}/)
    expect(interfaceMatch).not.toBeNull()
    expect(interfaceMatch![0]).toMatch(/elevenlabsFirstMessage:\s*string\s*\|\s*null/)
  })

  it('destructures elevenlabsFirstMessage from props', () => {
    const destructureMatch = clientSource.match(/export default function WidgetRenderClient\(\{([\s\S]*?)\}: WidgetRenderClientProps\)/)
    expect(destructureMatch).not.toBeNull()
    expect(destructureMatch![1]).toMatch(/elevenlabsFirstMessage,?/)
  })

  it('passes firstMessage: elevenlabsFirstMessage ?? undefined to ElevenLabsAdapter.create(), alongside the existing instructions field', () => {
    const createCallMatch = clientSource.match(/adapter = await ElevenLabsAdapter\.create\(\{[\s\S]*?\}\)/)
    expect(createCallMatch).not.toBeNull()
    expect(createCallMatch![0]).toContain("instructions: elevenlabsVoiceInstructions ?? ''")
    expect(createCallMatch![0]).toContain('firstMessage: elevenlabsFirstMessage ?? undefined')
  })
})
