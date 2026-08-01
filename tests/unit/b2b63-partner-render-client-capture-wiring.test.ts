import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * B2B-63 (docs/specs/B2B-63-requirement-document.md §13) — source-text assertions for
 * PartnerRenderClient.tsx's sharedCallbacks.onMessage wrapper, which cannot be live-imported under
 * this repo's node-environment vitest config (same convention as tests/unit/b2b61-partb-wiring.test.ts).
 */

const clientSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'),
  'utf8'
)

describe('B2B-63 — sharedCallbacks.onMessage wraps (not replaces) the existing per-mode closure', () => {
  it('calls the existing per-mode onMessage closure first, unconditionally, in every case', () => {
    const wrapperMatch = clientSource.match(/onMessage: \(text: string, source: 'user' \| 'ai'\) => \{([\s\S]*?)\n\s{10}\},/)
    expect(wrapperMatch).not.toBeNull()
    const body = wrapperMatch![1]
    // The existing closure call must appear BEFORE the new capture gate, unconditionally.
    const existingCallIndex = body.indexOf('onMessage(text, source)')
    const gateIndex = body.indexOf('isInline && voiceProvider')
    expect(existingCallIndex).toBeGreaterThan(-1)
    expect(gateIndex).toBeGreaterThan(existingCallIndex)
  })

  it('gates the new capture call on isInline && voiceProvider === \'openai_realtime\' && non-blank text', () => {
    expect(clientSource).toContain("if (isInline && voiceProvider === 'openai_realtime' && text.trim())")
  })

  it('posts to /api/partner/render/transcript-capture with clio_session_ref, source, and text', () => {
    expect(clientSource).toContain("fetch('/api/partner/render/transcript-capture'")
    expect(clientSource).toContain('body: JSON.stringify({ clio_session_ref: clioSessionRef, source, text })')
  })

  it('uses keepalive: true and a swallowed .catch(), mirroring reportClientError\'s fire-and-forget pattern', () => {
    const wrapperMatch = clientSource.match(/onMessage: \(text: string, source: 'user' \| 'ai'\) => \{([\s\S]*?)\n\s{10}\},/)
    expect(wrapperMatch).not.toBeNull()
    expect(wrapperMatch![1]).toContain('keepalive: true')
    expect(wrapperMatch![1]).toContain('.catch(() => {})')
  })

  it('does not add a new prop — clioSessionRef, isInline, and voiceProvider are all already in scope', () => {
    // Structural guard: this wrapper lives inside connect(), not in PartnerRenderClientProps.
    const propsInterfaceMatch = clientSource.match(/export interface PartnerRenderClientProps \{[\s\S]*?\n\}/)
    expect(propsInterfaceMatch).not.toBeNull()
    expect(propsInterfaceMatch![0]).not.toContain('onCapture')
    expect(propsInterfaceMatch![0]).not.toContain('transcriptCapture')
  })
})
