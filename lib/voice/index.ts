import type { Conversation } from '@11labs/client'
import type { VoiceSessionAdapter } from './adapter'
import { ElevenLabsAdapter } from './elevenlabs-adapter'
import { DeepgramAdapter } from './deepgram-adapter'

export type { VoiceSessionAdapter } from './adapter'
export { ElevenLabsAdapter } from './elevenlabs-adapter'
export { DeepgramAdapter } from './deepgram-adapter'

export function createVoiceAdapter(
  provider: 'elevenlabs' | 'deepgram',
  conversation: Conversation | null
): VoiceSessionAdapter {
  if (provider === 'deepgram') {
    return new DeepgramAdapter()
  }
  if (!conversation) {
    throw new Error('ElevenLabsAdapter requires a Conversation instance')
  }
  return new ElevenLabsAdapter(conversation)
}
