import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAIRealtimeAdapter, type OpenAIRealtimeAdapterConfig } from '@/lib/voice/openai-realtime-adapter'

/**
 * 2026-08-03 — coverage for the new ws_error/ws_close onDiagnostic reporting added after a live
 * test call showed several 30-65s dead-air gaps with zero events of any kind, alongside the
 * participant's own report of audio flickering/interruptions. Previously a WS close/reconnect was
 * only visible via console/reportError (Vercel logs, not correlated against the same per-session
 * timeline as tool_call/transcript events) — these tests confirm it now also reaches onDiagnostic.
 *
 * Follows the same "install minimal globalThis mocks, drive openConnection()/ws.onclose/onerror
 * directly" convention as tests/unit/b2b52-hume-reconnect-tolerance.test.ts, since
 * tests/unit/openai-realtime-adapter.test.ts deliberately bypasses openConnection() and cannot
 * cover this (its own header comment explains why).
 */

type Handler = ((event: unknown) => void) | null

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: Handler = null
  onerror: Handler = null
  onclose: Handler = null
  onmessage: Handler = null
  readyState = 0
  url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(_data: string) {
    /* no-op */
  }

  close() {
    /* no-op */
  }

  triggerError() {
    this.onerror?.({})
  }

  triggerClose(code: number, reason = '') {
    this.onclose?.({ code, reason })
  }

  triggerOpen() {
    this.readyState = 1
    this.onopen?.({})
  }
}

class MockAudioContext {
  destination = {}
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn() }
  }
  createMediaStreamSource(_stream: unknown) {
    return { connect: vi.fn(), disconnect: vi.fn() }
  }
  createScriptProcessor(_bufferSize: number, _in: number, _out: number) {
    return { onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn() }
  }
  close() {
    return Promise.resolve()
  }
}

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
    onDiagnostic: vi.fn(),
    tools: {},
    reportError: vi.fn(),
    ...overrides,
  }
}

type AdapterInternals = {
  openConnection: () => Promise<void>
}

function makeAdapter(config: OpenAIRealtimeAdapterConfig) {
  const adapter = new OpenAIRealtimeAdapter(config)
  return { adapter, internals: adapter as unknown as AdapterInternals }
}

function latestWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

describe('OpenAIRealtimeAdapter connection-level diagnostics — 2026-08-03', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket
    ;(globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext
  })

  it('reports ws_error with phase "connecting" when onerror fires before open', () => {
    const config = makeConfig()
    const { internals } = makeAdapter(config)

    internals.openConnection().catch(() => { /* expected */ })
    latestWs().triggerError()

    expect(config.onDiagnostic).toHaveBeenCalledWith('ws_error', { phase: 'connecting' })
  })

  it('reports ws_error with phase "connected" when onerror fires after a successful open', () => {
    const config = makeConfig()
    const { internals } = makeAdapter(config)

    internals.openConnection().catch(() => { /* not expected to reject here, but guard anyway */ })
    latestWs().triggerOpen()
    latestWs().triggerError()

    expect(config.onDiagnostic).toHaveBeenCalledWith('ws_error', { phase: 'connected' })
  })

  it('reports ws_close with willReconnect: true and the scheduled delay on a retryable close', () => {
    const config = makeConfig()
    const { internals } = makeAdapter(config)

    internals.openConnection().catch(() => { /* expected */ })
    latestWs().triggerClose(1006, 'abnormal closure')

    expect(config.onDiagnostic).toHaveBeenCalledWith('ws_close', {
      code: 1006,
      reason: 'abnormal closure',
      intentional: false,
      willReconnect: true,
      reconnectAttempt: 1,
      delayMs: 1000,
    })
  })

  it('reports ws_close with willReconnect: false on an auth/policy close (code 1008)', () => {
    const config = makeConfig()
    const { internals } = makeAdapter(config)

    internals.openConnection().catch(() => { /* expected */ })
    latestWs().triggerClose(1008, 'policy violation')

    expect(config.onDiagnostic).toHaveBeenCalledWith('ws_close', {
      code: 1008,
      reason: 'policy violation',
      intentional: false,
      willReconnect: false,
      reconnectAttempts: 0,
    })
  })

  it('reports ws_close with intentional: true when the adapter itself initiated the close', async () => {
    const config = makeConfig()
    const { adapter, internals } = makeAdapter(config)

    internals.openConnection().catch(() => { /* not expected here, but guard anyway */ })
    latestWs().triggerOpen()

    const endPromise = adapter.endSession()
    latestWs().triggerClose(1000, '')
    await endPromise

    expect(config.onDiagnostic).toHaveBeenCalledWith('ws_close', {
      code: 1000,
      reason: null,
      intentional: true,
    })
  })
})
