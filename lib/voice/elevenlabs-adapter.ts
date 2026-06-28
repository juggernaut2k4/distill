import type { Conversation } from '@11labs/client'
import type { VoiceSessionAdapter } from './adapter'

export class ElevenLabsAdapter implements VoiceSessionAdapter {
  private conversation: Conversation

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
}
