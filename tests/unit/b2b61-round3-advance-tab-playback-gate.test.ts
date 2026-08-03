import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * B2B-61 round 3 (2026-08-01) — Arun: "i dont want you to send the advance tab tool action unless
 * marin starts to give the summary... trigger the move only when the title of the next page title
 * is pronounced." Investigation confirmed the prompt-level instruction and the client's two-stage
 * transcript-watch already implement this — the one real gap was that the advance_tab TOOL-CALL
 * backup path could still execute a page move the instant the model finishes GENERATING the next
 * topic's name, without waiting for the corresponding audio to actually finish PLAYING locally.
 *
 * Fix: a new optional VoiceSessionAdapter method, waitForPlaybackCaughtUp(), awaited by both
 * advance_tab tool handlers in PartnerRenderClient.tsx before executing the move. Hume does not
 * implement it (adapter.ts's doc comment: deliberately optional, so Hume's existing, working
 * tool-call handling stays byte-for-byte unchanged) — `adapter?.waitForPlaybackCaughtUp?.()` is a
 * genuine no-op there via optional-chaining short-circuit.
 *
 * Source-text assertions, following the established b2b58/b2b59/b2b60 convention for this file
 * (PartnerRenderClient.tsx requires a real browser WebSocket/AudioContext/getUserMedia to exercise
 * directly, which this test file's own convention deliberately avoids).
 */

const clientSrcRaw = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'),
  'utf8'
)
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const clientSrc = stripComments(clientSrcRaw)

const adapterInterfaceSrc = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/adapter.ts'), 'utf8')
const openaiAdapterSrc = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/openai-realtime-adapter.ts'), 'utf8')
const humeAdapterSrc = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/hume-adapter.ts'), 'utf8')

describe('VoiceSessionAdapter.waitForPlaybackCaughtUp — optional extension point', () => {
  it('is declared as an optional method on the shared interface', () => {
    expect(adapterInterfaceSrc).toMatch(/waitForPlaybackCaughtUp\?\s*\(\)\s*:\s*Promise<void>/)
  })

  it('OpenAIRealtimeAdapter implements it, delegating to the existing playback-tracking mechanism', () => {
    expect(openaiAdapterSrc).toMatch(/waitForPlaybackCaughtUp\(\)\s*:\s*Promise<void>\s*\{\s*return this\.waitForPlaybackToFinish\(\)/)
  })

  it('HumeAdapter does NOT implement it — confirms this stays a genuine no-op there, zero change to Hume\'s existing tool-call handling', () => {
    expect(humeAdapterSrc).not.toContain('waitForPlaybackCaughtUp')
  })
})

describe('PartnerRenderClient.tsx — advance_tab handlers await waitForPlaybackCaughtUp before moving', () => {
  it('inlineTools.advance_tab awaits it before calling advanceOnTransition', () => {
    const start = clientSrcRaw.indexOf('advance_tab: async () => {') // first occurrence — inlineTools
    expect(start).toBeGreaterThan(-1)
    // Window sized generously to comfortably fit the handler body regardless of surrounding comments.
    const body = clientSrcRaw.slice(start, start + 2500)
    const awaitIdx = body.indexOf('await adapterRef.current?.waitForPlaybackCaughtUp?.()')
    const advanceIdx = body.indexOf('advanceOnTransition(marker)')
    expect(awaitIdx).toBeGreaterThan(-1)
    expect(advanceIdx).toBeGreaterThan(-1)
    expect(awaitIdx).toBeLessThan(advanceIdx)
  })

  it('templateTools.advance_tab awaits it before calling goToSection', () => {
    const firstOccurrence = clientSrcRaw.indexOf('advance_tab: async () => {')
    const start = clientSrcRaw.indexOf('advance_tab: async () => {', firstOccurrence + 1) // second occurrence — templateTools
    expect(start).toBeGreaterThan(-1)
    // Window sized generously to comfortably fit the handler body regardless of surrounding comments.
    const body = clientSrcRaw.slice(start, start + 1200)
    const awaitIdx = body.indexOf('await adapterRef.current?.waitForPlaybackCaughtUp?.()')
    const goToIdx = body.indexOf('goToSection(idx)')
    expect(awaitIdx).toBeGreaterThan(-1)
    expect(goToIdx).toBeGreaterThan(-1)
    expect(awaitIdx).toBeLessThan(goToIdx)
  })

  it('uses optional chaining on both the adapter ref and the method itself (never throws for an adapter that lacks it, e.g. Hume)', () => {
    const occurrences = clientSrc.match(/adapterRef\.current\?\.waitForPlaybackCaughtUp\?\.\(\)/g) ?? []
    expect(occurrences.length).toBe(2) // inline + template handlers
  })
})
