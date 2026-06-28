/**
 * VoiceSessionAdapter — provider-agnostic interface for a live voice session.
 *
 * ElevenLabs: backed by Conversation from @11labs/client
 * Deepgram:   backed by DeepgramAdapter stub (POC only, CTX-01 build)
 */
export interface VoiceSessionAdapter {
  /** Inject additional context text mid-session without restarting it.
   *  ElevenLabs: calls conversation.sendContextualUpdate(text)
   *  Deepgram:   sends UpdateInstructions WebSocket message (stub in this build)
   */
  injectContext(text: string): void

  /** End the voice session cleanly. */
  endSession(): Promise<void>

  /** Set speaker output volume (0.0 – 1.0). */
  setVolume(volume: number): void

  /** Mute or unmute the user's microphone input. */
  setMicMuted(muted: boolean): void

  /** Returns the current input (microphone) volume level. */
  getInputVolume(): number

  /** Returns the current output (speaker) volume level. */
  getOutputVolume(): number

  /** Send a thumbs-up or thumbs-down feedback signal to the provider. */
  sendFeedback(like: boolean): void

  /** Returns the provider-assigned session/conversation ID. */
  getId(): string

  /** Returns true if the underlying connection is currently open. */
  isOpen(): boolean
}
