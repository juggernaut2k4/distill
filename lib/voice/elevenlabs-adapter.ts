import type { Conversation } from '@11labs/client'
import type { VoiceSessionAdapter } from './adapter'

export class ElevenLabsAdapter implements VoiceSessionAdapter {
  private conversation: Conversation
  private speakVerifiedCallback: (() => void) | null = null
  private speakVerifiedFired = false
  private speakVerifiedPollTimer: ReturnType<typeof setInterval> | null = null
  private speakVerifiedTimeoutTimer: ReturnType<typeof setTimeout> | null = null

  constructor(conversation: Conversation) {
    this.conversation = conversation
  }

  injectContext(text: string): void {
    this.conversation.sendContextualUpdate(text)
  }

  endSession(): Promise<void> {
    return this.conversation.endSession()
  }

  setVolume(volume: number): void {
    this.conversation.setVolume({ volume })
  }

  setMicMuted(muted: boolean): void {
    this.conversation.setMicMuted(muted)
  }

  getInputVolume(): number {
    return this.conversation.getInputVolume()
  }

  getOutputVolume(): number {
    return this.conversation.getOutputVolume()
  }

  sendFeedback(like: boolean): void {
    this.conversation.sendFeedback(like)
  }

  getId(): string {
    return this.conversation.getId()
  }

  isOpen(): boolean {
    return this.conversation.isOpen()
  }

  /**
   * AUTOGEN-01 Part D — fires `callback` exactly once, the first time `isOpen()`
   * is confirmed true. This adapter is only ever constructed after
   * `Conversation.startSession()` has resolved (i.e. after the SDK's own onopen
   * has already fired), so `isOpen()` is normally already true by the time this
   * is called. A brief poll handles the rare race where the underlying
   * WebSocket's open transition hasn't been reflected yet; it gives up after 10s
   * without ever calling the callback if the connection never confirms open —
   * this deliberately produces zero billed minutes for that attempt (AC-D3),
   * it never fires on a mere connection attempt.
   */
  onSpeakVerified(callback: () => void): void {
    this.speakVerifiedCallback = callback
    this.checkAndFireSpeakVerified()
  }

  private checkAndFireSpeakVerified(): void {
    if (this.speakVerifiedFired) return

    if (this.isOpen()) {
      this.speakVerifiedFired = true
      this.clearSpeakVerifiedTimers()
      this.speakVerifiedCallback?.()
      return
    }

    if (!this.speakVerifiedPollTimer) {
      this.speakVerifiedPollTimer = setInterval(() => this.checkAndFireSpeakVerified(), 200)
      this.speakVerifiedTimeoutTimer = setTimeout(() => this.clearSpeakVerifiedTimers(), 10_000)
    }
  }

  private clearSpeakVerifiedTimers(): void {
    if (this.speakVerifiedPollTimer) {
      clearInterval(this.speakVerifiedPollTimer)
      this.speakVerifiedPollTimer = null
    }
    if (this.speakVerifiedTimeoutTimer) {
      clearTimeout(this.speakVerifiedTimeoutTimer)
      this.speakVerifiedTimeoutTimer = null
    }
  }
}
