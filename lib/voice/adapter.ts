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

  /**
   * AUTOGEN-01 Part D — registers a callback fired exactly once, the moment this
   * adapter has confirmed a REAL, working voice connection capable of producing
   * audio. This is the billing-start signal — it must NOT fire on bot-join,
   * screen-share-start, or a merely-attempted (not yet confirmed) connection.
   *   ElevenLabs: fires when `isOpen()` is confirmed true (verified open transition).
   *   Hume:       fires only when BOTH `onConnect` (chat_metadata) has occurred AND
   *               the first successful assistant_message/speaking-mode event has
   *               occurred — `onConnect` alone is not sufficient proof Clio can speak.
   * If the connection never reaches this state, the callback is simply never called.
   */
  onSpeakVerified(callback: () => void): void
}
