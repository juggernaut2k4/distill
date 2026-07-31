/**
 * VoiceSessionAdapter — provider-agnostic interface for a live voice session.
 *
 * Hume:     backed by HumeAdapter (lib/voice/hume-adapter.ts), a direct
 *           per-session WebRTC/mediaStream WebSocket connection.
 * Deepgram: backed by DeepgramAdapter stub (POC only, CTX-01 build)
 */
export interface VoiceSessionAdapter {
  /** Inject additional context text mid-session without restarting it.
   *  Hume:     intentionally a no-op — Hume rejects session_settings.system_prompt
   *            (E0716) whenever a custom LLM is configured; context is delivered
   *            server-side via the custom LLM endpoint instead.
   *  Deepgram: sends UpdateInstructions WebSocket message (stub in this build)
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
   *   Hume: fires only when BOTH `onConnect` (chat_metadata) has occurred AND
   *         the first successful assistant_message/speaking-mode event has
   *         occurred — `onConnect` alone is not sufficient proof Clio can speak.
   * If the connection never reaches this state, the callback is simply never called.
   */
  onSpeakVerified(callback: () => void): void

  /**
   * B2B-61 Part A — optional, provider-agnostic extension point for a one-time, near-end
   * wrap-up/join-greeting nudge delivered over an already-open connection, without restarting
   * the session. Added here (rather than left as a Hume-only method) so PartnerRenderClient.tsx's
   * join-greeting and wrap-up-nudge polls — which call this through a ref typed as
   * `VoiceSessionAdapter`, not `HumeAdapter` — work unchanged regardless of which adapter is
   * active. Optional because not every adapter necessarily supports a live nudge; callers must
   * use optional chaining (`adapter?.sendWrapUpNudge?.(text)`).
   *   Hume:   pre-existing method, unchanged (see hume-adapter.ts's own HUME-NATIVE-01 doc
   *           comment for why this must stay a separate method from injectContext()).
   *   OpenAI: sends an updated `session.update` with amended instructions — OpenAI's Realtime
   *           API does not reject mid-session instruction updates the way Hume rejects
   *           `session_settings.system_prompt` under a Custom-LLM config (E0716), so this is a
   *           real, functional implementation there, not a no-op.
   * @returns true if the send was attempted without throwing and the connection was open;
   *   false otherwise. Callers are responsible for their own single-retry-then-give-up policy.
   */
  sendWrapUpNudge?(instructionText: string): boolean
}
