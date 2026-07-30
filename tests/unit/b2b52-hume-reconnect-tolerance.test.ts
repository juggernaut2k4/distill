import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HumeAdapter, type HumeAdapterConfig } from '@/lib/voice/hume-adapter'

/**
 * B2B-52 — coverage for the widened Hume WS reconnect tolerance:
 * MAX_RECONNECT 3→5, backoff delay capped at MAX_RECONNECT_DELAY_MS (8000ms).
 * See docs/specs/B2B-52-requirement-document.md §13 for the full test plan
 * this file implements (AT-1 through AT-7).
 *
 * This is the first test to drive HumeAdapter's actual openConnection()/
 * ws.onclose/ws.onerror retry path end-to-end — voice-adapters.test.ts
 * deliberately bypasses openConnection() per its own header comment, so it
 * cannot cover this. vitest.config.ts runs environment: 'node' (no browser
 * WebSocket/AudioContext/MediaRecorder globals), so this file installs
 * minimal mocks on globalThis before each test and restores them afterward.
 * Follows the same "construct directly, reach into private internals via a
 * typed cast" convention as voice-adapters.test.ts, and the
 * vi.useFakeTimers() pattern from session-billing-hume-retry.test.ts to
 * assert exact setTimeout delay values without real waits.
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

  // Test-only helpers driving the handlers HumeAdapter installs.
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
  close() {
    return Promise.resolve()
  }
}

class MockMediaRecorder {
  static isTypeSupported() {
    return true
  }
  ondataavailable: ((e: unknown) => void) | null = null
  constructor(_stream: unknown, _opts: unknown) {
    /* no-op */
  }
  start(_timesliceMs: number) {
    /* no-op */
  }
  stop() {
    /* no-op */
  }
}

function makeConfig(): HumeAdapterConfig {
  return {
    accessToken: 'test-token',
    configId: 'test-config',
    userId: 'user-123',
    mediaStream: {} as MediaStream,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
    onModeChange: vi.fn(),
    onMessage: vi.fn(),
    tools: {},
    reportError: vi.fn(),
  } as HumeAdapterConfig
}

// openConnection/reconnectAttempts are private — cast to access directly,
// exactly as voice-adapters.test.ts does for handleMessage.
type AdapterInternals = {
  openConnection: () => Promise<void>
  reconnectAttempts: number
}

function makeAdapter(config: HumeAdapterConfig) {
  const adapter = new HumeAdapter(config)
  return { adapter, internals: adapter as unknown as AdapterInternals }
}

function latestWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

describe('HumeAdapter reconnect tolerance — B2B-52', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket
    ;(globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext
    ;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = MockMediaRecorder
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext
    delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder
  })

  it('AT-7: MAX_RECONNECT is 5 and MAX_RECONNECT_DELAY_MS is 8000', () => {
    const statics = HumeAdapter as unknown as {
      MAX_RECONNECT: number
      MAX_RECONNECT_DELAY_MS: number
    }
    expect(statics.MAX_RECONNECT).toBe(5)
    expect(statics.MAX_RECONNECT_DELAY_MS).toBe(8000)
  })

  it('AT-1/AT-2/AT-5/AT-6: 5 retries at delays 1000/2000/4000/8000/8000, then give-up fires once with unchanged callback shapes', async () => {
    const config = makeConfig()
    const { internals } = makeAdapter(config)

    internals.openConnection().catch(() => {
      /* expected — this connection attempt never opens in this scenario */
    })

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const observedDelays: number[] = []

    // Drive 5 failed attempts that each schedule a retry (onerror fires
    // before open on every attempt — AT-5 — then onclose(1006) schedules
    // the next attempt at the expected backoff delay — AT-2).
    for (let i = 0; i < 5; i++) {
      const ws = latestWs()
      setTimeoutSpy.mockClear()

      ws.triggerError()
      expect(config.reportError).toHaveBeenLastCalledWith(
        'Hume WebSocket onerror (during connect, before open — no close code available yet)'
      )

      ws.triggerClose(1006, '')

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
      const delay = setTimeoutSpy.mock.calls[0][1] as number
      observedDelays.push(delay)

      await vi.advanceTimersByTimeAsync(delay)
    }

    expect(observedDelays).toEqual([1000, 2000, 4000, 8000, 8000])
    expect(internals.reconnectAttempts).toBe(5)

    // The 6th connection attempt (created by the 5th retry) also fails —
    // this is the failure that exhausts the widened budget and triggers
    // give-up, with reconnectAttempts already at 5 (the give-up check runs
    // before any further increment).
    const finalWs = latestWs()
    setTimeoutSpy.mockClear()
    finalWs.triggerError()
    finalWs.triggerClose(1006, '')

    // No further retry scheduled.
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(internals.reconnectAttempts).toBe(5)

    // Give-up branch fires exactly once, with unchanged message/argument shapes.
    expect(config.reportError).toHaveBeenCalledWith(
      'Hume EVI WebSocket closed — code 1006, reason: no reason given'
    )
    expect(config.onError).toHaveBeenCalledTimes(1)
    expect(config.onError).toHaveBeenCalledWith('Hume EVI WebSocket disconnected: no reason given (code 1006)')
    expect(config.onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('AT-3: recovers on the 3rd attempt (2 failures then success) — resets reconnectAttempts to 0, no give-up callbacks fire', async () => {
    const config = makeConfig()
    const { internals } = makeAdapter(config)

    internals.openConnection().catch(() => {
      /* expected — first attempt fails in this scenario */
    })

    // Attempt 1 fails.
    latestWs().triggerClose(1006, '')
    expect(internals.reconnectAttempts).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)

    // Attempt 2 fails.
    latestWs().triggerClose(1006, '')
    expect(internals.reconnectAttempts).toBe(2)
    await vi.advanceTimersByTimeAsync(2000)

    // Attempt 3 succeeds.
    latestWs().triggerOpen()

    expect(internals.reconnectAttempts).toBe(0)
    expect(config.reportError).not.toHaveBeenCalledWith(expect.stringContaining('WebSocket closed'))
    expect(config.onError).not.toHaveBeenCalled()
    expect(config.onDisconnect).not.toHaveBeenCalled()
  })

  it('AT-4: code 1008 on the very first attempt gives up immediately — no retry, no setTimeout call', () => {
    const config = makeConfig()
    const { internals } = makeAdapter(config)

    internals.openConnection().catch(() => {
      /* expected — this attempt fails via 1008 */
    })

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    setTimeoutSpy.mockClear()

    latestWs().triggerClose(1008, 'policy violation')

    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(internals.reconnectAttempts).toBe(0)
    expect(config.reportError).toHaveBeenCalledWith(
      'Hume EVI WebSocket closed — code 1008, reason: policy violation'
    )
    expect(config.onError).toHaveBeenCalledTimes(1)
    expect(config.onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('AT-4 (edge case, §9): code 1008 on a later attempt (not just the first) still gives up immediately, regardless of remaining budget', async () => {
    const config = makeConfig()
    const { internals } = makeAdapter(config)

    internals.openConnection().catch(() => {
      /* expected */
    })

    // Attempt 1 fails with a retryable code.
    latestWs().triggerClose(1006, '')
    expect(internals.reconnectAttempts).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)

    // Attempt 2 fails with 1008 — must short-circuit even though only
    // 1 of 5 retries has been used.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    setTimeoutSpy.mockClear()
    latestWs().triggerClose(1008, 'auth error')

    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(internals.reconnectAttempts).toBe(1)
    expect(config.onDisconnect).toHaveBeenCalledTimes(1)
  })
})
