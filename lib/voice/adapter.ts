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

  /**
   * B2B-61 round 3 — optional extension point closing a page-transition timing gap Arun found:
   * the advance_tab tool call is a race-free-by-dedup BACKUP signal to the transcript-watch
   * (PartnerRenderClient.tsx's two-stage stage1Armed/next-title match, itself gated by
   * OpenAIRealtimeAdapter's transcriptGateMode: 'playback_complete'), but the tool call itself was
   * never gated on local audio-playback completion — the model can call it the instant it finishes
   * GENERATING the sentence naming the next topic, while the corresponding audio may still be
   * mid-flight through the local playback queue. Callers must await this (optional-chained, since
   * not every adapter needs it) immediately before actually executing a tool-call-triggered page
   * advance, so the visual move never gets ahead of what the participant has actually heard.
   *   Hume:   not implemented (undefined) — Hume has never exhibited this specific gap, and this is
   *           deliberately NOT a required interface member so Hume's existing, working tool-call
   *           handling stays byte-for-byte unchanged; `adapter?.waitForPlaybackCaughtUp?.()` is a
   *           real no-op here (resolves immediately via optional chaining short-circuiting).
   *   OpenAI: resolves once the local audio queue has actually drained (reuses the same playback
   *           tracking endSession()'s goodbye fix already relies on), bounded by a timeout so a
   *           stuck/never-draining queue can't hang a transition indefinitely.
   */
  waitForPlaybackCaughtUp?(): Promise<void>

  /**
   * B2B item 6 (2026-08-02) — optional extension point for the silence-after-a-turn safety net:
   * injects a system-role instruction and immediately prompts a fresh response, so the model can
   * proactively say something (e.g. the graceful audio-issue closing) instead of waiting for the
   * participant, who may not be there. Unlike sendWrapUpNudge (which amends session instructions
   * for the model's own next natural turn) this forces an immediate response.
   *   Hume:   not implemented (undefined) — this silence-detection feature is OpenAI-only (built
   *           on `onUserSpeechStarted`, itself OpenAI-only); `adapter?.triggerRecoveryNudge?.()` is
   *           a real no-op here via optional chaining.
   *   OpenAI: sends a system-role conversation.item.create followed by an explicit response.create.
   * @returns true if the send was attempted without throwing and the connection was open.
   */
  triggerRecoveryNudge?(instructionText: string): boolean

  /**
   * B2B-73 — optional extension point for a live, real bot-speaking amplitude signal (the
   * "bot pill" in WidgetRenderClient.tsx). Both adapters already build a private
   * gainNode -> destination playback graph; this exposes an AnalyserNode spliced into that
   * same chain so a caller can read real frequency/time-domain data while audio plays, without
   * any decorative/fake animation. Optional, additive, same pattern as sendWrapUpNudge/
   * waitForPlaybackCaughtUp/triggerRecoveryNudge above — PartnerRenderClient.tsx's existing
   * `adapter?.method?.()` call sites are unaffected since it never calls a method that doesn't
   * exist for it.
   *   Hume:   implemented — same gainNode chain, analyser spliced in identically.
   *   OpenAI: implemented — same gainNode chain, analyser spliced in identically.
   * @returns the AnalyserNode, or null if the adapter's AudioContext isn't ready yet.
   */
  getOutputAnalyser?(): AnalyserNode | null
}
