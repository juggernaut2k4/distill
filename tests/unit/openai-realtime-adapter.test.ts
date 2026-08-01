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
  it('defines exactly show_visual, advance_tab, and end_session as flat function tools', () => {
    expect(OPENAI_REALTIME_TOOLS.map((t) => t.name)).toEqual(['show_visual', 'advance_tab', 'end_session'])
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
 * 2026-08-01 — Marin never spoke first because OpenAI's Realtime API (unlike Hume's EVI) never
 * generates a turn on its own; it only responds to user audio or an explicit response.create.
 * Source-text assertion since exercising ws.onopen requires openConnection()'s real
 * WebSocket/AudioContext construction, which this test file's own convention (see header comment)
 * deliberately avoids.
 */
describe('OpenAIRealtimeAdapter sends an initial response.create so Clio speaks first (2026-08-01)', () => {
  it('sends response.create, guarded by hasTriggeredInitialResponse, inside ws.onopen', () => {
    const onOpenBody = adapterSource.slice(
      adapterSource.indexOf('this.ws.onopen = () => {'),
      adapterSource.indexOf('this.ws.onerror = () => {')
    )
    expect(onOpenBody).toContain('hasTriggeredInitialResponse')
    expect(onOpenBody).toContain("type: 'response.create'")
  })

  it('the guard flag defaults to false and is a private instance field (fires once per adapter instance, including across reconnects)', () => {
    expect(adapterSource).toContain('private hasTriggeredInitialResponse = false')
  })
})
