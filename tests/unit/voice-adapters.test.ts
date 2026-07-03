import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ElevenLabsAdapter } from '@/lib/voice/elevenlabs-adapter'
import { HumeAdapter, type HumeAdapterConfig } from '@/lib/voice/hume-adapter'

/**
 * AUTOGEN-01 Part D — AC-D5: both the ElevenLabs and Hume voice adapters must
 * only fire onSpeakVerified after their respective real readiness signal, never
 * earlier (e.g. never on a mere connection attempt / metadata-only event).
 */

describe('ElevenLabsAdapter.onSpeakVerified (AC-D5)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeConversation(isOpen: () => boolean) {
    return { isOpen } as unknown as import('@11labs/client').Conversation
  }

  it('fires immediately when the underlying connection is already open', () => {
    const conversation = makeConversation(() => true)
    const adapter = new ElevenLabsAdapter(conversation)

    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire while the connection is still closed, and fires once it opens', () => {
    let open = false
    const conversation = makeConversation(() => open)
    const adapter = new ElevenLabsAdapter(conversation)

    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    // Not open yet — must not have fired on registration alone.
    expect(callback).not.toHaveBeenCalled()

    // Still not open after some polling ticks.
    vi.advanceTimersByTime(600)
    expect(callback).not.toHaveBeenCalled()

    // Connection opens — next poll tick should fire exactly once.
    open = true
    vi.advanceTimersByTime(200)
    expect(callback).toHaveBeenCalledTimes(1)

    // Further polling ticks must not re-fire it.
    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('never fires if the connection never opens (AC-D3: zero billed minutes for that attempt)', () => {
    const conversation = makeConversation(() => false)
    const adapter = new ElevenLabsAdapter(conversation)

    const callback = vi.fn()
    adapter.onSpeakVerified(callback)

    // Exhaust the internal 10s timeout.
    vi.advanceTimersByTime(11_000)

    expect(callback).not.toHaveBeenCalled()
  })
})

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
