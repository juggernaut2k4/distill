import type { VoiceSessionAdapter } from './adapter'
import { DeepgramAdapter } from './deepgram-adapter'

export type { VoiceSessionAdapter } from './adapter'
export { DeepgramAdapter } from './deepgram-adapter'
export { HumeAdapter } from './hume-adapter'
export type { HumeAdapterConfig } from './hume-adapter'

// Hume is not instantiated through this factory — WalkthroughClient.tsx
// constructs it directly via `HumeAdapter.create(config)` since it needs a
// richer, provider-specific config object (accessToken, configId, tools,
// event callbacks, etc.) rather than a single pre-built connection object.
// This factory remains for the Deepgram POC path only (currently unused —
// no caller passes 'deepgram' today), kept for that build's future use.
export function createVoiceAdapter(provider: 'deepgram'): VoiceSessionAdapter {
  if (provider === 'deepgram') {
    return new DeepgramAdapter()
  }
  throw new Error(`Unsupported voice provider: ${provider as string}`)
}
