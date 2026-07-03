// POC STUB — Deepgram Voice Agent not implemented.
// Out of scope for CTX-01 build.

import type { VoiceSessionAdapter } from './adapter'

export class DeepgramAdapter implements VoiceSessionAdapter {
  injectContext(text: string): void {
    console.log('[DeepgramAdapter STUB] injectContext called:', text.slice(0, 60))
  }

  endSession(): Promise<void> {
    console.log('[DeepgramAdapter STUB] endSession called')
    return Promise.resolve()
  }

  setVolume(volume: number): void {
    console.log('[DeepgramAdapter STUB] setVolume called:', volume)
  }

  setMicMuted(muted: boolean): void {
    console.log('[DeepgramAdapter STUB] setMicMuted called:', muted)
  }

  getInputVolume(): number {
    console.log('[DeepgramAdapter STUB] getInputVolume called')
    return 0
  }

  getOutputVolume(): number {
    console.log('[DeepgramAdapter STUB] getOutputVolume called')
    return 0
  }

  sendFeedback(like: boolean): void {
    console.log('[DeepgramAdapter STUB] sendFeedback called:', like)
  }

  getId(): string {
    console.log('[DeepgramAdapter STUB] getId called')
    return 'deepgram-stub'
  }

  isOpen(): boolean {
    console.log('[DeepgramAdapter STUB] isOpen called')
    return false
  }

  onSpeakVerified(_callback: () => void): void {
    console.log('[DeepgramAdapter STUB] onSpeakVerified registered — stub never fires it')
  }
}
