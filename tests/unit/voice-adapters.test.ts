import { describe, it, expect, vi } from 'vitest'
import { HumeAdapter, type HumeAdapterConfig } from '@/lib/voice/hume-adapter'

/**
 * AUTOGEN-01 Part D — AC-D5: the Hume voice adapter must only fire
 * onSpeakVerified after its real readiness signal, never earlier (e.g. never
 * on a mere connection attempt / metadata-only event).
 */

describe('HumeAdapter.onSpeakVerified (AC-D5)', () => {
  function makeAdapter() {
    // Constructed directly (bypassing the static `create()` / openConnection(),
    // which requires a real WebSocket/AudioContext/MediaRecorder) — the fields
    // under test (handleMessage, onSpeakVerified) never touch those.
    const config = {
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
    } as HumeAdapterConfig
    return new HumeAdapter(config)
  }

  // handleMessage is private — cast to access it directly for these unit tests,
  // exactly as documented on this task: exercise the adapter's message-handling
  // logic without needing a live WebSocket.
  function feedMessage(adapter: HumeAdapter, msg: Record<string, unknown>) {
    return (adapter as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage(msg)
  }

  it('does NOT fire onSpeakVerified after chat_metadata alone', async () => {
    const adapter = makeAdapter()
    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    await feedMessage(adapter, { type: 'chat_metadata', chat_id: 'chat-1' })

    expect(callback).not.toHaveBeenCalled()
  })

  it('fires onSpeakVerified only after chat_metadata + assistant_message', async () => {
    const adapter = makeAdapter()
    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    await feedMessage(adapter, { type: 'chat_metadata', chat_id: 'chat-1' })
    expect(callback).not.toHaveBeenCalled()

    await feedMessage(adapter, { type: 'assistant_message', message: { content: 'Hello there' } })
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire on assistant_message alone if chat_metadata never arrived', async () => {
    const adapter = makeAdapter()
    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    await feedMessage(adapter, { type: 'assistant_message', message: { content: 'Hello there' } })

    expect(callback).not.toHaveBeenCalled()
  })

  it('fires exactly once even across multiple assistant_message events', async () => {
    const adapter = makeAdapter()
    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    await feedMessage(adapter, { type: 'chat_metadata', chat_id: 'chat-1' })
    await feedMessage(adapter, { type: 'assistant_message', message: { content: 'First' } })
    await feedMessage(adapter, { type: 'assistant_message', message: { content: 'Second' } })

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('fires immediately for a late subscriber if verification already happened', async () => {
    const adapter = makeAdapter()
    await feedMessage(adapter, { type: 'chat_metadata', chat_id: 'chat-1' })
    await feedMessage(adapter, { type: 'assistant_message', message: { content: 'Hello' } })

    const lateCallback = vi.fn()
    adapter.onSpeakVerified(lateCallback)

    expect(lateCallback).toHaveBeenCalledTimes(1)
  })
})
