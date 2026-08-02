import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

/**
 * 2026-08-02 — a narrow, code-level backstop for the record_verification_result/advance_tab
 * silence family of bugs. Three live test calls in one night each hit some version of "the model
 * goes quiet right after one of these two tool calls resolves" — rule 10 (turn-continuation),
 * rule 4's phrase-banning, and rule 4's natural-acknowledgment rewrite all targeted this at the
 * prompt level, with real but incomplete effect each time. Per the CEO agent's own recommendation
 * after reading the third transcript: prompt instructions for turn-taking in a realtime voice model
 * are probabilistic, not guaranteed, so add a mechanical floor under this exact window, in addition
 * to (never instead of) the prompt fixes.
 *
 * Deliberately separate from the pre-existing, now-disabled general silence-after-any-turn timer
 * (silenceTimeoutRef/armSilenceTimer), which caused a real false positive on an ordinary
 * conversational pause and was disabled for exactly that reason. This new timer only ever arms in
 * the few seconds immediately after record_verification_result or advance_tab resolve — the one
 * place rule 10 says a continuation is structurally, not just conversationally, owed — never as a
 * general per-turn timer, so it should not reproduce the same false-positive failure mode.
 *
 * PartnerRenderClient.tsx is a client component with browser/WebRTC dependencies that isn't
 * practically unit-testable via direct import/render. Following this codebase's existing convention
 * for this exact situation (see tests/unit/b2b58-show-visual-no-advance.test.ts), this suite asserts
 * against the raw source text instead.
 */

const clientSrcRaw = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'
  ),
  'utf8'
)
const normalized = clientSrcRaw.replace(/\s+/g, ' ')

describe('2026-08-02 — scoped post-tool-call recovery nudge (record_verification_result/advance_tab silence backstop)', () => {
  it('declares a separate ref/timer from the general (disabled) silence timer', () => {
    expect(clientSrcRaw).toContain('postToolNudgeTimeoutRef')
    expect(clientSrcRaw).toContain('silenceTimeoutRef')
    // Genuinely separate mechanisms, not aliases of each other.
    expect(clientSrcRaw.indexOf('postToolNudgeTimeoutRef')).not.toBe(clientSrcRaw.indexOf('silenceTimeoutRef'))
  })

  it('arms with a short (well under the old 12s general-timer) threshold', () => {
    expect(normalized).toContain('POST_TOOL_NUDGE_MS = 7000')
  })

  it('calls adapter.triggerRecoveryNudge via the same optional-chaining pattern as waitForPlaybackCaughtUp (safe no-op for Hume)', () => {
    expect(normalized).toContain('adapterRef.current?.triggerRecoveryNudge?.(')
  })

  it('the nudge instruction tells the model to continue per rule 10, not to acknowledge or explain the nudge itself', () => {
    expect(normalized).toContain('Per rule 10, a tool call never')
    expect(normalized).toContain('Do not acknowledge this')
    expect(normalized).toContain('message or explain yourself')
  })

  it('armPostToolNudge() is called at the top of recordVerificationResult, before any outcome branch — every outcome requires a continuation, not just a successful one', () => {
    const fnStart = clientSrcRaw.indexOf('const recordVerificationResult = async')
    const fnEnd = clientSrcRaw.indexOf('const inlineTools = {', fnStart)
    const fnBody = clientSrcRaw.slice(fnStart, fnEnd)
    const armIdx = fnBody.indexOf('armPostToolNudge()')
    const firstBranchIdx = fnBody.indexOf("if (result === 'correct')")
    expect(armIdx).toBeGreaterThan(-1)
    expect(firstBranchIdx).toBeGreaterThan(-1)
    expect(armIdx).toBeLessThan(firstBranchIdx)
  })

  it('armPostToolNudge() is called in both inlineTools.advance_tab and templateTools.advance_tab, before the premature-call gate check', () => {
    const inlineToolsStart = clientSrcRaw.indexOf('const inlineTools = {')
    const templateToolsStart = clientSrcRaw.indexOf('const templateTools = {')
    const inlineAdvanceTabStart = clientSrcRaw.indexOf('advance_tab: async () => {', inlineToolsStart)
    const inlineAdvanceTabEnd = clientSrcRaw.indexOf('end_session: async () => {', inlineAdvanceTabStart)
    const inlineBlock = clientSrcRaw.slice(inlineAdvanceTabStart, inlineAdvanceTabEnd)
    expect(inlineBlock.indexOf('armPostToolNudge()')).toBeGreaterThan(-1)
    expect(inlineBlock.indexOf('armPostToolNudge()')).toBeLessThan(inlineBlock.indexOf('unresolved'))

    const templateAdvanceTabStart = clientSrcRaw.indexOf('advance_tab: async () => {', templateToolsStart)
    const templateBlock = clientSrcRaw.slice(templateAdvanceTabStart, templateAdvanceTabStart + 800)
    expect(templateBlock.indexOf('armPostToolNudge()')).toBeGreaterThan(-1)
    expect(templateBlock.indexOf('armPostToolNudge()')).toBeLessThan(templateBlock.indexOf('unresolved'))
  })

  it('is disarmed the instant assistant audio starts (onModeChange -> speaking), on real user speech, and on disconnect/error — never left armed after any of those', () => {
    expect(normalized).toContain("else { clearSilenceTimer(); clearPostToolNudge() }")
    expect(normalized).toContain('onUserSpeechStarted: () => { clearSilenceTimer(); clearPostToolNudge() }')
    expect(normalized).toContain("onDisconnect: () => { setStatus('ended'); clearSilenceTimer(); clearPostToolNudge() }")
    expect(normalized).toContain('clearSilenceTimer() clearPostToolNudge() },')
  })

  it('is cleared on component unmount, alongside the other timeout refs', () => {
    const cleanupStart = clientSrcRaw.indexOf('return () => {\n      cancelled = true')
    const cleanupEnd = clientSrcRaw.indexOf('}, [])', cleanupStart)
    const cleanupBlock = clientSrcRaw.slice(cleanupStart, cleanupEnd)
    expect(cleanupBlock).toContain('postToolNudgeTimeoutRef.current')
    expect(cleanupBlock).toContain('silenceTimeoutRef.current')
  })
})
