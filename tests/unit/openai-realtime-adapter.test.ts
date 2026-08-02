import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { OpenAIRealtimeAdapter, type OpenAIRealtimeAdapterConfig } from '@/lib/voice/openai-realtime-adapter'
import { OPENAI_REALTIME_TOOLS } from '@/lib/voice/openai-realtime-tools'

const adapterSource = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/openai-realtime-adapter.ts'), 'utf8')

/**
 * B2B-61 Part A — unit tests for OpenAIRealtimeAdapter's pure/testable logic, following the
 * same convention as tests/unit/voice-adapters.test.ts (HumeAdapter's own onSpeakVerified
 * suite): construct the adapter directly (bypassing the static `create()` / openConnection(),
 * which requires a real browser WebSocket/AudioContext/MediaStream), and exercise its private
 * `handleMessage` directly via a cast, since these tests target message-handling and tool-call
 * dispatch logic that never touches those browser-only APIs.
 */

function makeConfig(overrides: Partial<OpenAIRealtimeAdapterConfig> = {}): OpenAIRealtimeAdapterConfig {
  return {
    ephemeralToken: 'test-ephemeral-token',
    model: 'gpt-realtime-2.1',
    instructions: 'You are a test assistant.',
    userId: 'user-123',
    mediaStream: {} as MediaStream,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
    onModeChange: vi.fn(),
    onMessage: vi.fn(),
    tools: {},
    ...overrides,
  }
}

function makeAdapter(overrides: Partial<OpenAIRealtimeAdapterConfig> = {}) {
  return new OpenAIRealtimeAdapter(makeConfig(overrides))
}

function feedMessage(adapter: OpenAIRealtimeAdapter, msg: Record<string, unknown>) {
  return (adapter as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage(msg)
}

/** Installs a fake `ws` with a spyable `.send()` (and a no-op `.close()`, needed by endSession())
 *  directly onto the private field, mirroring how these tests bypass openConnection() entirely —
 *  no real WebSocket construction needed. */
function installFakeSocket(adapter: OpenAIRealtimeAdapter) {
  const send = vi.fn()
  const close = vi.fn()
  ;(adapter as unknown as { ws: { send: typeof send; close: typeof close; readyState: number } }).ws = { send, close, readyState: 1 }
  return send
}

describe('OPENAI_REALTIME_TOOLS shape', () => {
  it('defines exactly show_visual, record_verification_result, advance_tab, and end_session as flat function tools', () => {
    // 2026-08-02 — B2B items 6/7 added record_verification_result, the code-enforced
    // "ready to advance" signal that gates advance_tab (see docs/2026-08-02-farewell-narration-findings.md §6).
    expect(OPENAI_REALTIME_TOOLS.map((t) => t.name)).toEqual(['show_visual', 'record_verification_result', 'advance_tab', 'end_session'])
    for (const tool of OPENAI_REALTIME_TOOLS) {
      expect(tool.type).toBe('function')
      expect(tool.parameters.type).toBe('object')
      // Flat shape confirmed against OpenAI's own Realtime docs during this build — NOT the
      // Chat-Completions-style nested { type:'function', function: {...} } shape.
      expect(tool).not.toHaveProperty('function')
    }
  })

  it('advance_tab and end_session take no required parameters', () => {
    const advanceTab = OPENAI_REALTIME_TOOLS.find((t) => t.name === 'advance_tab')!
    const endSession = OPENAI_REALTIME_TOOLS.find((t) => t.name === 'end_session')!
    expect(advanceTab.parameters.required).toEqual([])
    expect(endSession.parameters.required).toEqual([])
  })

  it("record_verification_result requires a result param, constrained to the three valid outcomes", () => {
    const tool = OPENAI_REALTIME_TOOLS.find((t) => t.name === 'record_verification_result')!
    expect(tool.parameters.required).toEqual(['result'])
    expect(tool.parameters.properties.result.enum).toEqual(['correct', 'incorrect', 'garbled'])
  })

  it('show_visual exposes section_index and topic_title, matching PartnerRenderClient.resolveSectionIndex', () => {
    const showVisual = OPENAI_REALTIME_TOOLS.find((t) => t.name === 'show_visual')!
    expect(Object.keys(showVisual.parameters.properties).sort()).toEqual(['section_index', 'topic_title'])
  })
})

describe('OpenAIRealtimeAdapter.onSpeakVerified (mirrors HumeAdapter AC-D5)', () => {
  it('does NOT fire after session.updated alone', async () => {
    const adapter = makeAdapter()
    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    await feedMessage(adapter, { type: 'session.updated', session: { id: 'sess-1' } })

    expect(callback).not.toHaveBeenCalled()
  })

  it('does NOT fire on a response.output_audio.delta alone if session.updated never arrived', async () => {
    const adapter = makeAdapter()
    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    await feedMessage(adapter, { type: 'response.output_audio.delta', delta: 'AAAA' })

    expect(callback).not.toHaveBeenCalled()
  })

  it('fires only after session.updated + first response.output_audio.delta', async () => {
    const adapter = makeAdapter()
    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    await feedMessage(adapter, { type: 'session.updated', session: { id: 'sess-1' } })
    expect(callback).not.toHaveBeenCalled()

    await feedMessage(adapter, { type: 'response.output_audio.delta', delta: 'AAAA' })
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('fires exactly once even across multiple audio deltas', async () => {
    const adapter = makeAdapter()
    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    await feedMessage(adapter, { type: 'session.updated', session: { id: 'sess-1' } })
    await feedMessage(adapter, { type: 'response.output_audio.delta', delta: 'AAAA' })
    await feedMessage(adapter, { type: 'response.output_audio.delta', delta: 'BBBB' })

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('fires immediately for a late subscriber if verification already happened', async () => {
    const adapter = makeAdapter()
    await feedMessage(adapter, { type: 'session.updated', session: { id: 'sess-1' } })
    await feedMessage(adapter, { type: 'response.output_audio.delta', delta: 'AAAA' })

    const lateCallback = vi.fn()
    adapter.onSpeakVerified(lateCallback)

    expect(lateCallback).toHaveBeenCalledTimes(1)
  })

  it('a bare session.created (no session.updated) does not itself connect or verify', async () => {
    const adapter = makeAdapter()
    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    await feedMessage(adapter, { type: 'session.created', session: { id: 'sess-1' } })
    await feedMessage(adapter, { type: 'response.output_audio.delta', delta: 'AAAA' })

    expect(callback).not.toHaveBeenCalled()
  })
})

describe('OpenAIRealtimeAdapter tool-call dispatch (response.output_item.done)', () => {
  it('executes the matching tool handler with parsed arguments and sends function_call_output + response.create', async () => {
    const handler = vi.fn().mockResolvedValue('Advanced.')
    const adapter = makeAdapter({ tools: { advance_tab: handler } })
    const send = installFakeSocket(adapter)

    await feedMessage(adapter, {
      type: 'response.output_item.done',
      item: { type: 'function_call', name: 'advance_tab', call_id: 'call-1', arguments: '{}' },
    })

    expect(handler).toHaveBeenCalledWith({})
    expect(send).toHaveBeenCalledTimes(2)
    const firstPayload = JSON.parse(send.mock.calls[0][0] as string)
    expect(firstPayload).toEqual({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call-1', output: 'Advanced.' },
    })
    const secondPayload = JSON.parse(send.mock.calls[1][0] as string)
    expect(secondPayload).toEqual({ type: 'response.create' })
  })

  /**
   * 2026-08-02 — root-cause fix for live session 98be7c6d-c316-4bc2-a2ff-fe45adcdd434: prompting
   * the model to continue after it has already decided to end the call serves no purpose and only
   * opens another race window against endSession()'s teardown. end_session is the one tool that
   * must NOT trigger the continuation response.create every other tool still needs.
   */
  it('sends function_call_output but does NOT send a continuation response.create for end_session', async () => {
    const handler = vi.fn().mockResolvedValue('Session ended.')
    const adapter = makeAdapter({ tools: { end_session: handler } })
    const send = installFakeSocket(adapter)

    await feedMessage(adapter, {
      type: 'response.output_item.done',
      item: { type: 'function_call', name: 'end_session', call_id: 'call-end', arguments: '{}' },
    })

    expect(handler).toHaveBeenCalledWith({})
    expect(send).toHaveBeenCalledTimes(1)
    const onlyPayload = JSON.parse(send.mock.calls[0][0] as string)
    expect(onlyPayload).toEqual({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call-end', output: 'Session ended.' },
    })
  })

  it('parses stringified arguments and passes them through to the handler', async () => {
    const handler = vi.fn().mockResolvedValue('Visual is now showing.')
    const adapter = makeAdapter({ tools: { show_visual: handler } })
    installFakeSocket(adapter)

    await feedMessage(adapter, {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        name: 'show_visual',
        call_id: 'call-2',
        arguments: JSON.stringify({ section_index: 3, topic_title: 'Pricing' }),
      },
    })

    expect(handler).toHaveBeenCalledWith({ section_index: 3, topic_title: 'Pricing' })
  })

  it('falls back to "Tool execution failed." if the handler throws, without crashing', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'))
    const adapter = makeAdapter({ tools: { end_session: handler } })
    const send = installFakeSocket(adapter)

    await feedMessage(adapter, {
      type: 'response.output_item.done',
      item: { type: 'function_call', name: 'end_session', call_id: 'call-3', arguments: '{}' },
    })

    const firstPayload = JSON.parse(send.mock.calls[0][0] as string)
    expect(firstPayload.item.output).toBe('Tool execution failed.')
  })

  it('does nothing for a non-function_call output item', async () => {
    const adapter = makeAdapter()
    const send = installFakeSocket(adapter)

    await feedMessage(adapter, {
      type: 'response.output_item.done',
      item: { type: 'message', id: 'item-1' },
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('warns and still returns a default result string when no handler is registered for the tool name', async () => {
    const adapter = makeAdapter({ tools: {} })
    const send = installFakeSocket(adapter)

    await feedMessage(adapter, {
      type: 'response.output_item.done',
      item: { type: 'function_call', name: 'unknown_tool', call_id: 'call-4', arguments: '{}' },
    })

    const firstPayload = JSON.parse(send.mock.calls[0][0] as string)
    expect(firstPayload.item.output).toBe('Tool executed.')
  })
})

describe('OpenAIRealtimeAdapter interruption (input_audio_buffer.speech_started)', () => {
  it('clears the queued (not-yet-played) audio queue and reports listening mode', async () => {
    const onModeChange = vi.fn()
    const adapter = makeAdapter({ onModeChange })

    // Push something into the private audio queue directly, mirroring how these tests reach
    // into private state elsewhere in this file — avoids needing a real AudioContext.
    ;(adapter as unknown as { audioQueue: Uint8Array[] }).audioQueue = [new Uint8Array([1, 2, 3])]
    ;(adapter as unknown as { isPlaying: boolean }).isPlaying = true

    await feedMessage(adapter, { type: 'input_audio_buffer.speech_started' })

    expect((adapter as unknown as { audioQueue: Uint8Array[] }).audioQueue).toEqual([])
    expect((adapter as unknown as { isPlaying: boolean }).isPlaying).toBe(false)
    expect(onModeChange).toHaveBeenCalledWith('listening')
  })
})

describe('OpenAIRealtimeAdapter error handling', () => {
  it('forwards a provider error event message to onError', async () => {
    const onError = vi.fn()
    const adapter = makeAdapter({ onError })

    await feedMessage(adapter, { type: 'error', error: { message: 'Something went wrong' } })

    expect(onError).toHaveBeenCalledWith('Something went wrong')
  })

  it('falls back to a default message if the error event has none', async () => {
    const onError = vi.fn()
    const adapter = makeAdapter({ onError })

    await feedMessage(adapter, { type: 'error', error: {} })

    expect(onError).toHaveBeenCalledWith('OpenAI Realtime error')
  })
})

describe('OpenAIRealtimeAdapter transcript events', () => {
  it('reports assistant transcript via onMessage with source "ai"', async () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage })

    await feedMessage(adapter, { type: 'response.output_audio_transcript.done', transcript: 'Hello there.' })

    expect(onMessage).toHaveBeenCalledWith('Hello there.', 'ai')
  })

  it('reports user transcript via onMessage with source "user"', async () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage })

    await feedMessage(adapter, { type: 'conversation.item.input_audio_transcription.completed', transcript: 'What is my score?' })

    expect(onMessage).toHaveBeenCalledWith('What is my score?', 'user')
  })
})

/**
 * 2026-08-01 — 'playback_complete' transcriptGateMode, the toggleable experiment for the
 * premature-page-advance investigation (docs/b2b-pivot-status.md's B2B-59/60 backlog entry).
 * `flushPendingAiTranscriptIfDrained()` is exercised directly (reaching into private state, same
 * convention as the interruption suite above) since it's the real "audio finished playing" signal
 * drainQueue() calls — no real AudioContext needed to test the gating logic itself.
 */
function getPrivate<T>(adapter: OpenAIRealtimeAdapter, key: string): T {
  return (adapter as unknown as Record<string, T>)[key]
}

function setPrivate(adapter: OpenAIRealtimeAdapter, key: string, value: unknown): void {
  ;(adapter as unknown as Record<string, unknown>)[key] = value
}

function flushIfDrained(adapter: OpenAIRealtimeAdapter): void {
  ;(adapter as unknown as { flushPendingAiTranscriptIfDrained: () => void }).flushPendingAiTranscriptIfDrained()
}

describe('OpenAIRealtimeAdapter transcriptGateMode (2026-08-01 experiment toggle)', () => {
  it('defaults to immediate behavior when transcriptGateMode is omitted — no regression to existing sessions', async () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage })
    setPrivate(adapter, 'isPlaying', true) // audio still "playing" — immediate mode ignores this entirely

    await feedMessage(adapter, { type: 'response.output_audio_transcript.done', transcript: 'Immediate by default.' })

    expect(onMessage).toHaveBeenCalledWith('Immediate by default.', 'ai')
    expect(getPrivate(adapter, 'pendingAiTranscript')).toBeNull()
  })

  it('immediate mode fires right away even with transcriptGateMode explicitly set to "immediate"', async () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage, transcriptGateMode: 'immediate' })
    setPrivate(adapter, 'isPlaying', true)

    await feedMessage(adapter, { type: 'response.output_audio_transcript.done', transcript: 'Still immediate.' })

    expect(onMessage).toHaveBeenCalledWith('Still immediate.', 'ai')
  })

  it('playback_complete mode defers onMessage while audio is still playing', async () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage, transcriptGateMode: 'playback_complete' })
    setPrivate(adapter, 'isPlaying', true)

    await feedMessage(adapter, { type: 'response.output_audio_transcript.done', transcript: 'Wait for it.' })

    expect(onMessage).not.toHaveBeenCalled()
    expect(getPrivate(adapter, 'pendingAiTranscript')).toBe('Wait for it.')
  })

  it('playback_complete mode defers while chunks are still queued, even if not currently mid-chunk', async () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage, transcriptGateMode: 'playback_complete' })
    setPrivate(adapter, 'isPlaying', false)
    setPrivate(adapter, 'audioQueue', [new Uint8Array([1, 2, 3])])

    await feedMessage(adapter, { type: 'response.output_audio_transcript.done', transcript: 'Still queued.' })

    expect(onMessage).not.toHaveBeenCalled()
    expect(getPrivate(adapter, 'pendingAiTranscript')).toBe('Still queued.')
  })

  it('playback_complete mode fires immediately if the queue is already fully drained when the transcript arrives', async () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage, transcriptGateMode: 'playback_complete' })
    // isPlaying: false, audioQueue: [] — default state, matches "nothing left to play"

    await feedMessage(adapter, { type: 'response.output_audio_transcript.done', transcript: 'Already caught up.' })

    expect(onMessage).toHaveBeenCalledWith('Already caught up.', 'ai')
    expect(getPrivate(adapter, 'pendingAiTranscript')).toBeNull()
  })

  it('flushes the deferred transcript exactly when the playback queue actually drains', async () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage, transcriptGateMode: 'playback_complete' })
    setPrivate(adapter, 'isPlaying', true)

    await feedMessage(adapter, { type: 'response.output_audio_transcript.done', transcript: 'Deferred text.' })
    expect(onMessage).not.toHaveBeenCalled()

    flushIfDrained(adapter) // the real "drainQueue() hit its empty base case" signal
    expect(onMessage).toHaveBeenCalledWith('Deferred text.', 'ai')
    expect(getPrivate(adapter, 'pendingAiTranscript')).toBeNull()
  })

  it('flushing is a no-op when nothing is pending (safe to call unconditionally from drainQueue)', () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage, transcriptGateMode: 'playback_complete' })

    flushIfDrained(adapter)

    expect(onMessage).not.toHaveBeenCalled()
  })

  it('an interruption (input_audio_buffer.speech_started) discards a pending transcript rather than eventually firing it', async () => {
    const onMessage = vi.fn()
    const adapter = makeAdapter({ onMessage, transcriptGateMode: 'playback_complete' })
    setPrivate(adapter, 'isPlaying', true)

    await feedMessage(adapter, { type: 'response.output_audio_transcript.done', transcript: 'Interrupted mid-flight.' })
    expect(getPrivate(adapter, 'pendingAiTranscript')).toBe('Interrupted mid-flight.')

    await feedMessage(adapter, { type: 'input_audio_buffer.speech_started' })
    expect(getPrivate(adapter, 'pendingAiTranscript')).toBeNull()

    // Simulates the in-flight chunk's onended firing afterward and calling drainQueue(), which
    // hits the (now-cleared) empty base case and calls flushPendingAiTranscriptIfDrained() again.
    flushIfDrained(adapter)
    expect(onMessage).not.toHaveBeenCalled()
  })
})

describe('OpenAIRealtimeAdapter unknown/unexpected events', () => {
  it('never throws on an unrecognized event type', async () => {
    const adapter = makeAdapter()
    await expect(feedMessage(adapter, { type: 'some.future.event', foo: 'bar' })).resolves.toBeUndefined()
  })
})

describe('OpenAIRealtimeAdapter.sendWrapUpNudge', () => {
  it('sends a session.update with amended instructions and returns true when the socket is open', () => {
    const adapter = makeAdapter({ instructions: 'Base instructions.' })
    const send = installFakeSocket(adapter)

    const result = adapter.sendWrapUpNudge('Please wrap up soon.')

    expect(result).toBe(true)
    const payload = JSON.parse(send.mock.calls[0][0] as string)
    expect(payload.type).toBe('session.update')
    expect(payload.session.instructions).toContain('Base instructions.')
    expect(payload.session.instructions).toContain('Please wrap up soon.')
  })

  it('returns false when there is no open socket', () => {
    const adapter = makeAdapter()
    const result = adapter.sendWrapUpNudge('Please wrap up soon.')
    expect(result).toBe(false)
  })
})

describe('OpenAIRealtimeAdapter simple interface members', () => {
  it('getId returns empty string before any session is established', () => {
    const adapter = makeAdapter()
    expect(adapter.getId()).toBe('')
  })

  it('isOpen returns false before any connection is established', () => {
    const adapter = makeAdapter()
    expect(adapter.isOpen()).toBe(false)
  })

  it('setVolume clamps through to getOutputVolume', () => {
    const adapter = makeAdapter()
    adapter.setVolume(0.5)
    expect(adapter.getOutputVolume()).toBe(0.5)
  })

  it('getInputVolume always returns 0 (no provider API for this, matching HumeAdapter)', () => {
    const adapter = makeAdapter()
    expect(adapter.getInputVolume()).toBe(0)
  })
})

/**
 * 2026-08-01 — endSession() no longer tears down audio synchronously; it waits for any
 * queued/in-flight playback (e.g. Clio's own spoken goodbye) to actually finish before closing
 * anything. Root cause this fixes: the old clearAudioQueue()+audioCtx.close() sequence cut the
 * goodbye off mid-sentence every time, since audioCtx.close() stops audio already mid-flight too,
 * contrary to clearAudioQueue()'s own "does not stop audio already mid-flight" doc comment.
 */
describe('OpenAIRealtimeAdapter.endSession waits for playback to finish (2026-08-01)', () => {
  it('resolves immediately when nothing is queued or playing', async () => {
    const adapter = makeAdapter()
    installFakeSocket(adapter)
    await expect(adapter.endSession()).resolves.toBeUndefined()
  })

  it('does not resolve while audio is still playing, and resolves once it stops', async () => {
    vi.useFakeTimers()
    try {
      const adapter = makeAdapter()
      installFakeSocket(adapter)
      ;(adapter as unknown as { isPlaying: boolean }).isPlaying = true

      let resolved = false
      const promise = adapter.endSession().then(() => { resolved = true })

      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(false)

      ;(adapter as unknown as { isPlaying: boolean }).isPlaying = false
      await vi.advanceTimersByTimeAsync(200)
      await promise
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not resolve while chunks remain queued, even if not currently mid-chunk', async () => {
    vi.useFakeTimers()
    try {
      const adapter = makeAdapter()
      installFakeSocket(adapter)
      ;(adapter as unknown as { audioQueue: Uint8Array[] }).audioQueue = [new Uint8Array([1, 2, 3])]

      let resolved = false
      const promise = adapter.endSession().then(() => { resolved = true })

      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(false)

      ;(adapter as unknown as { audioQueue: Uint8Array[] }).audioQueue = []
      await vi.advanceTimersByTimeAsync(200)
      await promise
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after the bounded timeout rather than hanging forever on a stuck queue', async () => {
    vi.useFakeTimers()
    try {
      const adapter = makeAdapter()
      installFakeSocket(adapter)
      ;(adapter as unknown as { isPlaying: boolean }).isPlaying = true // never cleared — simulates a stuck state

      let resolved = false
      const promise = adapter.endSession().then(() => { resolved = true })

      await vi.advanceTimersByTimeAsync(8100)
      await promise
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('no longer drops queued chunks via clearAudioQueue() before closing (removed from endSession)', () => {
    // Source-level guard: endSession() itself must not call clearAudioQueue() anymore -- that was
    // the mechanism that discarded not-yet-started goodbye audio.
    const endSessionBody = adapterSource.slice(adapterSource.indexOf('async endSession('), adapterSource.indexOf('setVolume('))
    expect(endSessionBody).not.toContain('clearAudioQueue')
    expect(endSessionBody).toContain('waitForPlaybackToFinish')
  })
})

/**
 * 2026-08-02 — root-cause fix for the missing/cut-off farewell found in live session
 * 98be7c6d-c316-4bc2-a2ff-fe45adcdd434. waitForPlaybackToFinish() alone only reflects audio bytes
 * that have already arrived and been locally queued -- it has no way to know the server is still
 * mid-generating further content (e.g. the spoken-goodbye message item) for the SAME response that
 * contains the end_session tool call, if that tool call's item happens to complete before the
 * message item's audio has even started streaming. endSession() now also waits for the server to
 * confirm the whole response is done (response.created ... response.done) before closing anything.
 */
describe('OpenAIRealtimeAdapter.endSession waits for the whole server response to finish (2026-08-02)', () => {
  it('does not resolve while a response is in flight (response.created seen, no response.done yet)', async () => {
    vi.useFakeTimers()
    try {
      const adapter = makeAdapter()
      installFakeSocket(adapter)
      await feedMessage(adapter, { type: 'response.created' })

      let resolved = false
      const promise = adapter.endSession().then(() => { resolved = true })

      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(false)

      await feedMessage(adapter, { type: 'response.done' })
      await vi.advanceTimersByTimeAsync(0)
      await promise
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still waits for local playback to drain after the response itself is done', async () => {
    vi.useFakeTimers()
    try {
      const adapter = makeAdapter()
      installFakeSocket(adapter)
      await feedMessage(adapter, { type: 'response.created' })
      ;(adapter as unknown as { isPlaying: boolean }).isPlaying = true

      let resolved = false
      const promise = adapter.endSession().then(() => { resolved = true })

      await feedMessage(adapter, { type: 'response.done' })
      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(false) // response is done, but audio is still playing locally

      ;(adapter as unknown as { isPlaying: boolean }).isPlaying = false
      await vi.advanceTimersByTimeAsync(200)
      await promise
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves immediately when no response has ever started (safe default, no regression)', async () => {
    const adapter = makeAdapter()
    installFakeSocket(adapter)
    await expect(adapter.endSession()).resolves.toBeUndefined()
  })

  it('gives up after the bounded timeout rather than hanging forever if response.done never arrives', async () => {
    vi.useFakeTimers()
    try {
      const adapter = makeAdapter()
      installFakeSocket(adapter)
      await feedMessage(adapter, { type: 'response.created' }) // never followed by response.done

      let resolved = false
      const promise = adapter.endSession().then(() => { resolved = true })

      await vi.advanceTimersByTimeAsync(8100)
      await promise
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a second response.created after end_session (the now-skipped continuation would have caused this) does not permanently stick responseInFlight if response.done follows', async () => {
    const adapter = makeAdapter()
    await feedMessage(adapter, { type: 'response.created' })
    await feedMessage(adapter, { type: 'response.done' })
    expect(getPrivate(adapter, 'responseInFlight')).toBe(false)
  })
})

/**
 * B2B-61 round 3 — Arun: don't let a tool-call-triggered page transition get ahead of what's
 * actually been heard. waitForPlaybackCaughtUp() is the public VoiceSessionAdapter method
 * PartnerRenderClient.tsx's advance_tab handler now awaits before executing a move; it reuses the
 * exact same playback-tracking endSession()'s goodbye fix already relies on (waitForPlaybackToFinish),
 * so these tests mirror the describe block above exactly, calling the new public method directly.
 */
describe('OpenAIRealtimeAdapter.waitForPlaybackCaughtUp (2026-08-01, round 3)', () => {
  it('resolves immediately when nothing is queued or playing', async () => {
    const adapter = makeAdapter()
    await expect(adapter.waitForPlaybackCaughtUp()).resolves.toBeUndefined()
  })

  it('does not resolve while audio is still playing, and resolves once it stops', async () => {
    vi.useFakeTimers()
    try {
      const adapter = makeAdapter()
      ;(adapter as unknown as { isPlaying: boolean }).isPlaying = true

      let resolved = false
      const promise = adapter.waitForPlaybackCaughtUp().then(() => { resolved = true })

      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(false)

      ;(adapter as unknown as { isPlaying: boolean }).isPlaying = false
      await vi.advanceTimersByTimeAsync(200)
      await promise
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not resolve while chunks remain queued, even if not currently mid-chunk', async () => {
    vi.useFakeTimers()
    try {
      const adapter = makeAdapter()
      ;(adapter as unknown as { audioQueue: Uint8Array[] }).audioQueue = [new Uint8Array([1, 2, 3])]

      let resolved = false
      const promise = adapter.waitForPlaybackCaughtUp().then(() => { resolved = true })

      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(false)

      ;(adapter as unknown as { audioQueue: Uint8Array[] }).audioQueue = []
      await vi.advanceTimersByTimeAsync(200)
      await promise
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after the bounded timeout rather than hanging forever on a stuck queue', async () => {
    vi.useFakeTimers()
    try {
      const adapter = makeAdapter()
      ;(adapter as unknown as { isPlaying: boolean }).isPlaying = true // never cleared

      let resolved = false
      const promise = adapter.waitForPlaybackCaughtUp().then(() => { resolved = true })

      await vi.advanceTimersByTimeAsync(8100)
      await promise
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * 2026-08-01 — Marin never spoke first because OpenAI's Realtime API (unlike Hume's EVI) never
 * generates a turn on its own; it only responds to user audio or an explicit response.create.
 *
 * 2026-08-01 (round 2) — Arun's live test found the mandatory opening icebreaker/agenda (rule 1)
 * was getting skipped. Root cause: the original fix sent response.create from ws.onopen, in the
 * same synchronous tick as session.update, without waiting for the server to actually confirm it
 * landed — risking the model's first turn generating against not-yet-bound instructions. Moved to
 * fire only once session.updated actually arrives (handleMessage), so these are now real
 * behavioral tests via feedMessage()/installFakeSocket(), not just source-text assertions.
 */
describe('OpenAIRealtimeAdapter sends an initial response.create so Clio speaks first (2026-08-01, round 2: gated on session.updated)', () => {
  it('sends response.create the moment session.updated arrives, guarded by hasTriggeredInitialResponse', async () => {
    const adapter = makeAdapter()
    const send = installFakeSocket(adapter)

    await feedMessage(adapter, { type: 'session.updated', session: { id: 'sess-1' } })

    const payloads = send.mock.calls.map((call) => JSON.parse(call[0] as string))
    expect(payloads).toContainEqual({ type: 'response.create' })
  })

  it('does NOT send response.create on session.created alone (must wait for the actual session.updated ack)', async () => {
    const adapter = makeAdapter()
    const send = installFakeSocket(adapter)

    await feedMessage(adapter, { type: 'session.created', session: { id: 'sess-1' } })

    expect(send).not.toHaveBeenCalled()
  })

  it('fires only once even if session.updated arrives again (mirrors a mid-session reconnect, no re-greet)', async () => {
    const adapter = makeAdapter()
    const send = installFakeSocket(adapter)

    await feedMessage(adapter, { type: 'session.updated', session: { id: 'sess-1' } })
    const countAfterFirst = send.mock.calls.filter(
      (call) => JSON.parse(call[0] as string).type === 'response.create'
    ).length
    expect(countAfterFirst).toBe(1)

    await feedMessage(adapter, { type: 'session.updated', session: { id: 'sess-1' } })
    const countAfterSecond = send.mock.calls.filter(
      (call) => JSON.parse(call[0] as string).type === 'response.create'
    ).length
    expect(countAfterSecond).toBe(1)
  })

  it('the guard flag defaults to false and is a private instance field', () => {
    expect(adapterSource).toContain('private hasTriggeredInitialResponse = false')
  })

  it('response.create is no longer sent from inside ws.onopen (moved to the session.updated handler)', () => {
    const onOpenBody = adapterSource.slice(
      adapterSource.indexOf('this.ws.onopen = () => {'),
      adapterSource.indexOf('this.ws.onerror = () => {')
    )
    expect(onOpenBody).not.toContain("type: 'response.create'")
  })
})
