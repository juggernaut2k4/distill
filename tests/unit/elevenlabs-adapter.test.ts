import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * B2B-75 (docs/specs/B2B-75-requirement-document.md §13.1) — unit coverage for the ElevenLabs
 * widget voice provider, against a mocked `@elevenlabs/client` and a mocked Supabase client.
 *
 * Everything here is provable WITHOUT a real ElevenLabs API key, which is the whole point: per
 * §13.0 the build/verify split leaves only the live call and the key entry with Arun, and NO
 * automated test is skipped or marked pending on the grounds that a key is unavailable.
 *
 * Scope note: §10.A's Files-Changed list is exhaustive and names exactly two new test files, so
 * §13.1's `provider-config` and `widget-elevenlabs-prompt-rules` cases live here alongside the
 * adapter's rather than in extra files the approved list does not contain. Every assertion §13.1
 * calls for is present.
 */

// ─── @elevenlabs/client mock ──────────────────────────────────────────────────────────────────

type StartSessionOptions = Record<string, unknown> & {
  onConnect?: (props: { conversationId: string }) => void
  onDisconnect?: (details: unknown) => void
  onError?: (message: string, context?: unknown) => void
  onMessage?: (payload: { message: string; source: string; role: string }) => void
  onModeChange?: (props: { mode: 'speaking' | 'listening' }) => void
  onStatusChange?: (props: { status: string }) => void
  onCanSendFeedbackChange?: (props: { canSendFeedback: boolean }) => void
  clientTools?: Record<string, (params: Record<string, unknown>) => Promise<string>>
}

const sdk = {
  lastOptions: null as StartSessionOptions | null,
  startSessionCalls: 0,
  startSessionThrows: null as Error | null,
  endSessionRejects: false,
  frequencyDataThrows: false,
}

const conversationMock = {
  endSession: vi.fn(async () => {
    if (sdk.endSessionRejects) throw new Error('teardown blew up')
  }),
  setVolume: vi.fn(),
  setMicMuted: vi.fn(),
  sendContextualUpdate: vi.fn(),
  sendFeedback: vi.fn(),
  getOutputByteFrequencyData: vi.fn(() => {
    if (sdk.frequencyDataThrows) throw new Error('no playback graph yet')
    return new Uint8Array([10, 20, 30])
  }),
}

vi.mock('@elevenlabs/client', () => ({
  Conversation: {
    startSession: vi.fn(async (options: StartSessionOptions) => {
      sdk.startSessionCalls += 1
      sdk.lastOptions = options
      if (sdk.startSessionThrows) throw sdk.startSessionThrows
      return conversationMock
    }),
  },
}))

// ─── Supabase mock (for the provider-config helpers) ──────────────────────────────────────────

const dbState = {
  row: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
  throws: false,
}

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => {
    if (dbState.throws) throw new Error('supabase unavailable')
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: dbState.row, error: dbState.error })),
          })),
        })),
      })),
    }
  }),
}))

// ─── Shared adapter helpers ───────────────────────────────────────────────────────────────────

const INSTRUCTIONS = 'You are Clio. SESSION CONTENT: page one is about context windows.'

interface Captured {
  connects: string[]
  disconnects: number
  errors: string[]
  modes: string[]
  messages: { text: string; source: string }[]
  diagnostics: { label: string; detail: Record<string, unknown> }[]
  reportedErrors: string[]
}

function makeConfig(tools?: Record<string, (params: Record<string, unknown>) => Promise<string>>) {
  const captured: Captured = {
    connects: [],
    disconnects: 0,
    errors: [],
    modes: [],
    messages: [],
    diagnostics: [],
    reportedErrors: [],
  }
  const config = {
    conversationToken: 'conv_token_abc123',
    instructions: INSTRUCTIONS,
    userId: 'session-ref-1',
    onConnect: (id: string) => captured.connects.push(id),
    onDisconnect: () => { captured.disconnects += 1 },
    onError: (message: string) => captured.errors.push(message),
    onModeChange: (mode: 'listening' | 'speaking') => captured.modes.push(mode),
    onMessage: (text: string, source: 'user' | 'ai') => captured.messages.push({ text, source }),
    tools: tools ?? {
      show_visual: async () => 'Visual is showing.',
      advance_tab: async () => 'Advanced.',
      end_session: async () => 'Session ended.',
    },
    onDiagnostic: (label: string, detail: Record<string, unknown>) => captured.diagnostics.push({ label, detail }),
    reportError: (message: string) => captured.reportedErrors.push(message),
  }
  return { config, captured }
}

async function createAdapter(tools?: Record<string, (params: Record<string, unknown>) => Promise<string>>) {
  const { ElevenLabsAdapter } = await import('@/lib/voice/elevenlabs-adapter')
  const { config, captured } = makeConfig(tools)
  const adapter = await ElevenLabsAdapter.create(config)
  const options = sdk.lastOptions!
  return { adapter, captured, options }
}

beforeEach(() => {
  vi.clearAllMocks()
  sdk.lastOptions = null
  sdk.startSessionCalls = 0
  sdk.startSessionThrows = null
  sdk.endSessionRejects = false
  sdk.frequencyDataThrows = false
  dbState.row = null
  dbState.error = null
  dbState.throws = false
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── §13.1 — the override payload (C3) ────────────────────────────────────────────────────────

describe('ElevenLabsAdapter — startSession options', () => {
  it('sends overrides EXACTLY equal to { agent: { prompt: { prompt: instructions } } } and nothing more', async () => {
    const { options } = await createAdapter()
    expect(options.overrides).toEqual({ agent: { prompt: { prompt: INSTRUCTIONS } } })
  })

  it('never sends tts, conversation, asr, llm, toolIds, knowledgeBase, firstMessage or language anywhere in the options', async () => {
    const { options } = await createAdapter()
    const serialized = JSON.stringify(options)
    for (const forbidden of ['tts', 'voiceId', 'asr', 'keywords', 'llm', 'toolIds', 'knowledgeBase', 'firstMessage', 'language', 'textOnly']) {
      expect(serialized).not.toContain(`"${forbidden}"`)
    }
  })

  it('does not include dynamicVariables at all (§6.5.1 — considered and deliberately rejected)', async () => {
    const { options } = await createAdapter()
    expect('dynamicVariables' in options).toBe(false)
  })

  it('AT-24: passes conversationToken + connectionType webrtc, with neither signedUrl nor agentId present', async () => {
    const { options } = await createAdapter()
    expect(options.conversationToken).toBe('conv_token_abc123')
    expect(options.connectionType).toBe('webrtc')
    expect('signedUrl' in options).toBe(false)
    expect('agentId' in options).toBe(false)
  })

  it('never puts an API key anywhere in the options object', async () => {
    const { options } = await createAdapter()
    const serialized = JSON.stringify(options)
    expect(serialized).not.toContain('xi-api-key')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('api_key')
  })

  it('passes the session ref through as userId so ElevenLabs-side records correlate to Clio sessions', async () => {
    const { options } = await createAdapter()
    expect(options.userId).toBe('session-ref-1')
  })

  it('emits el_error and el_override_rejected, then rethrows, when startSession itself fails during initiation', async () => {
    sdk.startSessionThrows = new Error('override for field system_prompt is not enabled')
    const { ElevenLabsAdapter } = await import('@/lib/voice/elevenlabs-adapter')
    const { config, captured } = makeConfig()
    await expect(ElevenLabsAdapter.create(config)).rejects.toThrow('override for field system_prompt is not enabled')
    expect(captured.diagnostics.map((d) => d.label)).toContain('el_error')
    expect(captured.diagnostics.map((d) => d.label)).toContain('el_override_rejected')
  })
})

// ─── §13.1 — AT-22, the source/role trap ──────────────────────────────────────────────────────

describe('ElevenLabsAdapter — onMessage', () => {
  it("AT-22: forwards the payload's `source`, never its `role`, when the two differ", async () => {
    const { captured, options } = await createAdapter()
    options.onMessage!({ message: 'Here is how context windows work.', source: 'ai', role: 'agent' })
    expect(captured.messages).toEqual([{ text: 'Here is how context windows work.', source: 'ai' }])
    // Forwarding `role` would send 'agent', which the capture route's Zod enum silently drops.
    expect(captured.messages[0].source).not.toBe('agent')
  })

  it('forwards user turns unchanged', async () => {
    const { captured, options } = await createAdapter()
    options.onMessage!({ message: 'Got it.', source: 'user', role: 'user' })
    expect(captured.messages).toEqual([{ text: 'Got it.', source: 'user' }])
  })
})

// ─── §13.1 — AT-23, error discrimination ──────────────────────────────────────────────────────

describe('ElevenLabsAdapter — onError discrimination (§6.6.6)', () => {
  it('AT-23: a tool-level error (context.clientToolName present) reports and diagnoses but never calls config.onError', async () => {
    const { captured, options } = await createAdapter()
    options.onError!('Client tool execution failed with following error: boom', { clientToolName: 'show_visual' })

    expect(captured.errors).toHaveLength(0)
    const toolDiag = captured.diagnostics.find((d) => d.label === 'el_tool_error')
    expect(toolDiag).toBeDefined()
    expect(toolDiag!.detail.toolName).toBe('show_visual')
    expect(captured.reportedErrors).toHaveLength(1)
    expect(captured.reportedErrors[0]).toContain('show_visual')
    expect(captured.diagnostics.some((d) => d.label === 'el_error')).toBe(false)
  })

  it('AT-23: an unregistered-tool error is also treated as tool-level, not connection-level', async () => {
    const { captured, options } = await createAdapter()
    options.onError!('Client tool with name mystery_tool is not defined on client', { clientToolName: 'mystery_tool' })
    expect(captured.errors).toHaveLength(0)
    expect(captured.diagnostics.some((d) => d.label === 'el_tool_error')).toBe(true)
  })

  it('AT-23: a genuine connection error (no clientToolName) DOES call config.onError and emits el_error', async () => {
    const { captured, options } = await createAdapter()
    options.onStatusChange!({ status: 'connected' })
    options.onError!('WebRTC transport closed unexpectedly')

    expect(captured.errors).toEqual(['WebRTC transport closed unexpectedly'])
    expect(captured.diagnostics.some((d) => d.label === 'el_error')).toBe(true)
    expect(captured.diagnostics.some((d) => d.label === 'el_tool_error')).toBe(false)
    // Not in the initiation window any more, so no override-rejection diagnostic.
    expect(captured.diagnostics.some((d) => d.label === 'el_override_rejected')).toBe(false)
  })
})

// ─── §13.1 — isOpen across all four Status values ─────────────────────────────────────────────

describe('ElevenLabsAdapter — isOpen()', () => {
  it('tracks all four Status values, with disconnecting reported as NOT open', async () => {
    const { adapter, options } = await createAdapter()
    expect(adapter.isOpen()).toBe(false)

    options.onStatusChange!({ status: 'connecting' })
    expect(adapter.isOpen()).toBe(false)

    options.onStatusChange!({ status: 'connected' })
    expect(adapter.isOpen()).toBe(true)

    options.onStatusChange!({ status: 'disconnecting' })
    expect(adapter.isOpen()).toBe(false)

    options.onStatusChange!({ status: 'connected' })
    options.onStatusChange!({ status: 'disconnected' })
    expect(adapter.isOpen()).toBe(false)
  })

  it('emits el_status_change for every transition', async () => {
    const { captured, options } = await createAdapter()
    options.onStatusChange!({ status: 'connecting' })
    options.onStatusChange!({ status: 'connected' })
    const statuses = captured.diagnostics.filter((d) => d.label === 'el_status_change').map((d) => d.detail.status)
    expect(statuses).toEqual(['connecting', 'connected'])
  })
})

// ─── §13.1 — onDisconnect payload flattening ──────────────────────────────────────────────────

describe('ElevenLabsAdapter — onDisconnect', () => {
  it('flattens all three DisconnectionDetails variants into el_disconnect with the correct reason', async () => {
    for (const details of [
      { reason: 'user' },
      { reason: 'agent', closeCode: 1000, closeReason: 'normal' },
      { reason: 'error', message: 'ice failed', context: { type: 'error' }, closeCode: 1006 },
    ]) {
      const { captured, options } = await createAdapter()
      options.onDisconnect!(details)
      const diag = captured.diagnostics.find((d) => d.label === 'el_disconnect')
      expect(diag).toBeDefined()
      expect(diag!.detail.reason).toBe(details.reason)
      expect(captured.disconnects).toBe(1)
    }
  })

  it('carries the failure message only on the error variant', async () => {
    const { captured, options } = await createAdapter()
    options.onDisconnect!({ reason: 'error', message: 'ice failed', context: { type: 'error' } })
    const diag = captured.diagnostics.find((d) => d.label === 'el_disconnect')!
    expect(diag.detail.message).toBe('ice failed')

    const second = await createAdapter()
    second.options.onDisconnect!({ reason: 'user' })
    const userDiag = second.captured.diagnostics.find((d) => d.label === 'el_disconnect')!
    expect(userDiag.detail.message).toBeUndefined()
  })
})

// ─── §13.1 — onSpeakVerified: the two-signal billing gate ─────────────────────────────────────

describe('ElevenLabsAdapter — onSpeakVerified()', () => {
  it('does NOT fire on onConnect alone', async () => {
    const { adapter, options } = await createAdapter()
    let fired = 0
    adapter.onSpeakVerified(() => { fired += 1 })
    options.onConnect!({ conversationId: 'conv_1' })
    expect(fired).toBe(0)
  })

  it('does NOT fire on onStatusChange("connected") alone', async () => {
    const { adapter, options } = await createAdapter()
    let fired = 0
    adapter.onSpeakVerified(() => { fired += 1 })
    options.onStatusChange!({ status: 'connected' })
    expect(fired).toBe(0)
  })

  it('fires once when onConnect then the first speaking mode change occur, in that order', async () => {
    const { adapter, options } = await createAdapter()
    let fired = 0
    adapter.onSpeakVerified(() => { fired += 1 })
    options.onConnect!({ conversationId: 'conv_1' })
    options.onModeChange!({ mode: 'speaking' })
    expect(fired).toBe(1)
    options.onModeChange!({ mode: 'listening' })
    options.onModeChange!({ mode: 'speaking' })
    expect(fired).toBe(1)
  })

  it('fires once in the reverse order too (speaking first, then onConnect)', async () => {
    const { adapter, options } = await createAdapter()
    let fired = 0
    adapter.onSpeakVerified(() => { fired += 1 })
    options.onModeChange!({ mode: 'speaking' })
    expect(fired).toBe(0)
    options.onConnect!({ conversationId: 'conv_1' })
    expect(fired).toBe(1)
  })

  it('fires immediately for a late subscriber when verification already happened', async () => {
    const { adapter, options } = await createAdapter()
    options.onConnect!({ conversationId: 'conv_1' })
    options.onModeChange!({ mode: 'speaking' })
    let fired = 0
    adapter.onSpeakVerified(() => { fired += 1 })
    expect(fired).toBe(1)
  })

  it('exposes the provider-assigned conversation id via getId()', async () => {
    const { adapter, options } = await createAdapter()
    options.onConnect!({ conversationId: 'conv_real_id' })
    expect(adapter.getId()).toBe('conv_real_id')
  })
})

// ─── §13.1 — waitForPlaybackCaughtUp, the explicitly-labelled proxy ───────────────────────────

describe('ElevenLabsAdapter — waitForPlaybackCaughtUp()', () => {
  it('resolves immediately when the tracked mode is not speaking', async () => {
    const { adapter } = await createAdapter()
    await expect(adapter.waitForPlaybackCaughtUp()).resolves.toBeUndefined()
  })

  it('resolves on the next mode change to listening when currently speaking', async () => {
    const { adapter, options } = await createAdapter()
    options.onModeChange!({ mode: 'speaking' })
    let resolved = false
    const pending = adapter.waitForPlaybackCaughtUp().then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    options.onModeChange!({ mode: 'listening' })
    await pending
    expect(resolved).toBe(true)
  })

  it("resolves within the 8000ms cap when 'listening' never arrives", async () => {
    // 2026-08-09 — raised from 3000ms to 8000ms (see MODE_WAIT_TIMEOUT_MS's own comment): a live
    // session showed 3000ms too tight for a realistic closing turn even when the wait logic works
    // correctly.
    vi.useFakeTimers()
    const { adapter, options } = await createAdapter()
    options.onModeChange!({ mode: 'speaking' })
    let resolved = false
    const pending = adapter.waitForPlaybackCaughtUp().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(7999)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await pending
    expect(resolved).toBe(true)
  })

  // 2026-08-09 — regression coverage for the real incident: a live session's mode reading was
  // already 'listening' from a PRIOR turn before the newest AI utterance's own speaking cycle had
  // been reported, so the old snapshot-only check resolved instantly and protected nothing — the
  // farewell got cut off. `lastModeChangeAt`/`lastAiMessageAt` staleness tracking fixes this.
  it("does NOT resolve immediately on a stale 'listening' reading that predates the newest AI message", async () => {
    const { adapter, options } = await createAdapter()
    options.onModeChange!({ mode: 'speaking' })
    options.onModeChange!({ mode: 'listening' }) // mode is now 'listening' — but this is about to go stale
    await new Promise((r) => setTimeout(r, 5)) // ensure a real timestamp gap before the next message
    options.onMessage!({ message: 'One more thing before we wrap up.', source: 'ai', role: 'agent' })

    let resolved = false
    const pending = adapter.waitForPlaybackCaughtUp().then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false) // must NOT trust the stale 'listening' snapshot

    options.onModeChange!({ mode: 'listening' }) // a genuinely fresh transition, after the message
    await pending
    expect(resolved).toBe(true)
  })

  it("DOES resolve immediately when the 'listening' reading is genuinely at or after the newest AI message", async () => {
    const { adapter, options } = await createAdapter()
    options.onMessage!({ message: 'Here is the summary.', source: 'ai', role: 'agent' })
    await new Promise((r) => setTimeout(r, 5))
    options.onModeChange!({ mode: 'speaking' })
    options.onModeChange!({ mode: 'listening' }) // fresh — happens after the message
    await expect(adapter.waitForPlaybackCaughtUp()).resolves.toBeUndefined()
  })
})

// ─── §13.1 — endSession and the goodbye-cutoff guard ──────────────────────────────────────────

describe('ElevenLabsAdapter — endSession()', () => {
  it('waits for the mode gate before calling the SDK endSession', async () => {
    const { adapter, options } = await createAdapter()
    options.onModeChange!({ mode: 'speaking' })
    const pending = adapter.endSession()
    await Promise.resolve()
    expect(conversationMock.endSession).not.toHaveBeenCalled()
    options.onModeChange!({ mode: 'listening' })
    await pending
    expect(conversationMock.endSession).toHaveBeenCalledTimes(1)
  })

  it('calls the SDK endSession straight away when not speaking', async () => {
    const { adapter } = await createAdapter()
    await adapter.endSession()
    expect(conversationMock.endSession).toHaveBeenCalledTimes(1)
  })

  it('never throws when the underlying call rejects (teardown is best-effort)', async () => {
    sdk.endSessionRejects = true
    const { adapter } = await createAdapter()
    await expect(adapter.endSession()).resolves.toBeUndefined()
  })

  it('reports itself closed afterwards', async () => {
    const { adapter, options } = await createAdapter()
    options.onStatusChange!({ status: 'connected' })
    await adapter.endSession()
    expect(adapter.isOpen()).toBe(false)
  })
})

// ─── §13.1 — tool mapping ─────────────────────────────────────────────────────────────────────

describe('ElevenLabsAdapter — client tools', () => {
  it('passes all three tools through to clientTools by name', async () => {
    const { options } = await createAdapter()
    expect(Object.keys(options.clientTools!).sort()).toEqual(['advance_tab', 'end_session', 'show_visual'])
  })

  it("propagates each handler's return string back as the tool result", async () => {
    const { options } = await createAdapter()
    await expect(options.clientTools!.show_visual({ section_index: 2 })).resolves.toBe('Visual is showing.')
    await expect(options.clientTools!.advance_tab({})).resolves.toBe('Advanced.')
    await expect(options.clientTools!.end_session({})).resolves.toBe('Session ended.')
  })

  it('emits a tool_call diagnostic with the same label and shape OpenAIRealtimeAdapter uses', async () => {
    const { captured, options } = await createAdapter()
    await options.clientTools!.show_visual({ topic_title: 'Context windows' })
    const diag = captured.diagnostics.find((d) => d.label === 'tool_call')
    expect(diag).toBeDefined()
    expect(diag!.detail).toEqual({
      name: 'show_visual',
      params: { topic_title: 'Context windows' },
      result: 'Visual is showing.',
    })
  })

  it('lets a throwing handler propagate to the SDK (which reports it via onError with a clientToolName)', async () => {
    const { options } = await createAdapter({
      show_visual: async () => { throw new Error('handler exploded') },
    })
    await expect(options.clientTools!.show_visual({})).rejects.toThrow('handler exploded')
  })
})

// ─── §13.1 — audio-level accessors ────────────────────────────────────────────────────────────

describe('ElevenLabsAdapter — output level accessors', () => {
  it('deliberately does NOT implement getOutputAnalyser', async () => {
    const { adapter } = await createAdapter()
    expect((adapter as { getOutputAnalyser?: unknown }).getOutputAnalyser).toBeUndefined()
  })

  it("returns the SDK's real frequency bytes from getOutputFrequencyData()", async () => {
    const { adapter } = await createAdapter()
    expect(Array.from(adapter.getOutputFrequencyData()!)).toEqual([10, 20, 30])
  })

  it('returns null rather than fabricating data when the SDK throws', async () => {
    sdk.frequencyDataThrows = true
    const { adapter } = await createAdapter()
    expect(adapter.getOutputFrequencyData()).toBeNull()
  })
})

// ─── §13.1 — remaining VoiceSessionAdapter members ────────────────────────────────────────────

describe('ElevenLabsAdapter — remaining interface members', () => {
  it('injectContext and both nudges use sendContextualUpdate, never sendUserMessage', async () => {
    const { adapter, options } = await createAdapter()
    options.onStatusChange!({ status: 'connected' })

    adapter.injectContext('extra context')
    expect(adapter.sendWrapUpNudge('wrap up now')).toBe(true)
    expect(adapter.triggerRecoveryNudge('time is up')).toBe(true)

    expect(conversationMock.sendContextualUpdate).toHaveBeenCalledTimes(3)
    expect((conversationMock as { sendUserMessage?: unknown }).sendUserMessage).toBeUndefined()
  })

  it('the nudges return false when the connection is not open', async () => {
    const { adapter } = await createAdapter()
    expect(adapter.sendWrapUpNudge('wrap up now')).toBe(false)
    expect(adapter.triggerRecoveryNudge('time is up')).toBe(false)
  })

  it('setVolume caches the value for getOutputVolume and forwards it to the SDK', async () => {
    const { adapter } = await createAdapter()
    expect(adapter.getOutputVolume()).toBe(1.0)
    adapter.setVolume(0.4)
    expect(conversationMock.setVolume).toHaveBeenCalledWith({ volume: 0.4 })
    expect(adapter.getOutputVolume()).toBe(0.4)
  })

  it('setMicMuted forwards to the SDK', async () => {
    const { adapter } = await createAdapter()
    adapter.setMicMuted(true)
    expect(conversationMock.setMicMuted).toHaveBeenCalledWith(true)
  })

  it('getInputVolume returns a constant 0 rather than a fabricated reading', async () => {
    const { adapter } = await createAdapter()
    expect(adapter.getInputVolume()).toBe(0)
  })

  it('sendFeedback no-ops until canSendFeedback is true, then forwards', async () => {
    const { adapter, options } = await createAdapter()
    adapter.sendFeedback(true)
    expect(conversationMock.sendFeedback).not.toHaveBeenCalled()

    options.onCanSendFeedbackChange!({ canSendFeedback: true })
    adapter.sendFeedback(true)
    expect(conversationMock.sendFeedback).toHaveBeenCalledWith(true)
  })

  it('emits el_mode_change for every mode transition and forwards it to the caller', async () => {
    const { captured, options } = await createAdapter()
    options.onModeChange!({ mode: 'speaking' })
    options.onModeChange!({ mode: 'listening' })
    expect(captured.modes).toEqual(['speaking', 'listening'])
    expect(captured.diagnostics.filter((d) => d.label === 'el_mode_change').map((d) => d.detail.mode)).toEqual([
      'speaking',
      'listening',
    ])
  })
})

// ─── §13.1 — provider-config helpers (D2's separation, asserted) ──────────────────────────────

describe('lib/voice/provider-config — getWidgetVoiceProvider()', () => {
  it('returns each of the three widget provider values', async () => {
    const { getWidgetVoiceProvider } = await import('@/lib/voice/provider-config')
    for (const provider of ['hume', 'openai_realtime', 'elevenlabs'] as const) {
      dbState.row = { widget_provider: provider }
      await expect(getWidgetVoiceProvider()).resolves.toBe(provider)
    }
  })

  it("fail-opens to 'hume' on a missing row", async () => {
    const { getWidgetVoiceProvider } = await import('@/lib/voice/provider-config')
    dbState.row = null
    await expect(getWidgetVoiceProvider()).resolves.toBe('hume')
  })

  it("fail-opens to 'hume' on a thrown error", async () => {
    const { getWidgetVoiceProvider } = await import('@/lib/voice/provider-config')
    dbState.throws = true
    await expect(getWidgetVoiceProvider()).resolves.toBe('hume')
  })

  it("fail-opens to 'hume' on an unrecognised stored value", async () => {
    const { getWidgetVoiceProvider } = await import('@/lib/voice/provider-config')
    dbState.row = { widget_provider: 'some_future_provider' }
    await expect(getWidgetVoiceProvider()).resolves.toBe('hume')
  })
})

describe('lib/voice/provider-config — getActiveVoiceProvider() is UNCHANGED (D2 regression guard)', () => {
  it("still returns only 'hume' or 'openai_realtime', never 'elevenlabs'", async () => {
    const { getActiveVoiceProvider } = await import('@/lib/voice/provider-config')

    dbState.row = { active_provider: 'openai_realtime' }
    await expect(getActiveVoiceProvider()).resolves.toBe('openai_realtime')

    dbState.row = { active_provider: 'hume' }
    await expect(getActiveVoiceProvider()).resolves.toBe('hume')

    // The critical assertion: even if 'elevenlabs' somehow reached active_provider, the inline /
    // meeting-bot channel must never be routed to it.
    dbState.row = { active_provider: 'elevenlabs' }
    await expect(getActiveVoiceProvider()).resolves.toBe('hume')

    dbState.row = null
    await expect(getActiveVoiceProvider()).resolves.toBe('hume')
  })
})

describe('lib/voice/provider-config — getElevenLabsAgentId()', () => {
  it('returns the stored plaintext agent id', async () => {
    const { getElevenLabsAgentId } = await import('@/lib/voice/provider-config')
    dbState.row = { elevenlabs_agent_id: 'agent_0701krp1ta48fswrff17ctb0520m' }
    await expect(getElevenLabsAgentId()).resolves.toBe('agent_0701krp1ta48fswrff17ctb0520m')
  })

  it('returns null on a missing row or a read error', async () => {
    const { getElevenLabsAgentId } = await import('@/lib/voice/provider-config')
    dbState.row = null
    await expect(getElevenLabsAgentId()).resolves.toBeNull()
    dbState.throws = true
    await expect(getElevenLabsAgentId()).resolves.toBeNull()
  })
})

// ─── §13.1 — the ElevenLabs prompt module ─────────────────────────────────────────────────────

describe('lib/voice/widget-elevenlabs-prompt-rules', () => {
  it('assembles without throwing on minimal input', async () => {
    const { assembleWidgetElevenLabsPrompt } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(() =>
      assembleWidgetElevenLabsPrompt({ profileContext: '', intentContext: '', sessionContent: '' })
    ).not.toThrow()
  })

  it('contains the session content and the participant name', async () => {
    const { assembleWidgetElevenLabsPrompt } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    const out = assembleWidgetElevenLabsPrompt({
      profileContext: '',
      intentContext: '',
      sessionContent: 'PAGE 1: Context windows are the working memory of a model.',
      participantName: 'Aryan',
    })
    expect(out).toContain('PAGE 1: Context windows are the working memory of a model.')
    expect(out).toContain('Aryan')
  })

  it('G-rule numbering is contiguous from G1 with no gaps', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    const numbers = Array.from(WIDGET_ELEVENLABS_PROMPT_TEMPLATE.matchAll(/^G(\d+)\. /gm)).map((m) => Number(m[1]))
    expect(numbers.length).toBeGreaterThan(0)
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1))
  })

  it('contains no reference to a G-rule number beyond the highest rule that exists (the §6.10 renumbering guard)', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    const declared = Array.from(WIDGET_ELEVENLABS_PROMPT_TEMPLATE.matchAll(/^G(\d+)\. /gm)).map((m) => Number(m[1]))
    const highest = Math.max(...declared)
    const referenced = Array.from(WIDGET_ELEVENLABS_PROMPT_TEMPLATE.matchAll(/\(G(\d+)\)/g)).map((m) => Number(m[1]))
    expect(referenced.length).toBeGreaterThan(0)
    for (const ref of referenced) {
      expect(ref).toBeLessThanOrEqual(highest)
      expect(declared).toContain(ref)
    }
  })

  it('drops the participant-has-gone-quiet rule (no ElevenLabs equivalent signal) while keeping the max-length rule', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).not.toContain('a note that the participant has gone quiet')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('reached its maximum length')
  })

  it('exports its own version constant, distinct from the OpenAI widget prompt', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_VERSION } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_VERSION).toBe('widget-el-v4')
  })

  it('G23 names the native silence-detection mechanism, distinct from G22\'s real note', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('G23. Unlike G22')
  })

  it('rule 3c requires two silences before ending the call, with a spoken check-in after the first', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('The first time silence (G23) fires with no real answer from them, say plainly that you did not hear their answer, and ask the question again.')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('If silence fires a second time with still no real answer')
  })

  it('rule 3g and rule 4c move on immediately on a single silence, without waiting further', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('If they say no, or if silence (G23) fires, that means move on — go to 3h immediately, without waiting any further.')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('If silence (G23) fires, treat that the same as a "no"')
  })

  it('instructs show_visual by title, never by number, for the opening page and topic transitions', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain("call show_visual with the first page's exact title — never a number")
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain("then call show_visual with that page's exact title — never a number")
  })

  it('rule 3 asks whether there are more questions on the topic before moving on', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('3f. Otherwise, once your reply is spoken, ask if they have any other questions on this topic')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('that means move on')
  })

  it('instructs the native end_call tool, not the custom end_session tool, for closing', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('end_call')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).not.toContain('end_session')
  })

  it('no longer instructs a separate advance_tab call — show_visual carries progress', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).not.toContain('advance_tab')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('moves your progress forward')
  })

  it('rule 4 asks whether there are more questions before returning to the taught page', async () => {
    const { WIDGET_ELEVENLABS_PROMPT_TEMPLATE } = await import('@/lib/voice/widget-elevenlabs-prompt-rules')
    expect(WIDGET_ELEVENLABS_PROMPT_TEMPLATE).toContain('ask if they have any other questions on this')
  })
})
