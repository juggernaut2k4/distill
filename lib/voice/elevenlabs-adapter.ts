import { Conversation } from '@elevenlabs/client'
import type { VoiceConversation } from '@elevenlabs/client'
import type { VoiceSessionAdapter } from './adapter'

/**
 * B2B-75 (docs/specs/B2B-75-requirement-document.md §6.6) — ElevenLabs Conversational-AI voice
 * adapter. WIDGET CHANNEL ONLY.
 *
 * Implements `VoiceSessionAdapter` (lib/voice/adapter.ts) at the same bar as `HumeAdapter` and
 * `OpenAIRealtimeAdapter`. Neither of those two files is modified by this build — this extends the
 * three-provider pattern, it does not refactor it. `app/(with-clerk)/partner-render/**` (the
 * meeting-bot channel) never constructs this adapter and is untouched (Known Constraint C1).
 *
 * TRANSPORT: WebRTC, via a server-minted, single-use conversation token from
 * `app/api/elevenlabs-token/route.ts`. `connectionType` is passed EXPLICITLY even though the SDK
 * would infer it from the presence of `conversationToken`, so a future change to ElevenLabs'
 * inference rules can never silently switch our transport (§6.4). The WebSocket signed-URL path
 * remains a documented one-field fallback: swap `conversationToken` for `signedUrl` and
 * `'webrtc'` for `'websocket'` — nothing else in this file changes.
 *
 * THE ONE THING OVERRIDDEN: `overrides.agent.prompt.prompt`, and nothing else (Known Constraint
 * C3). Voice, model, TTS settings, first message, language, knowledge base and tool ids all stay
 * exactly as Arun's base agent has them configured. This is not merely "unnecessary to send" —
 * ElevenLabs THROWS when an override arrives for a field whose Security-tab toggle is off, so each
 * extra field would be an additional way to break every session.
 *
 * WHY NOT THE OLD ADAPTER: `git show 7a0020a^:lib/voice/elevenlabs-adapter.ts` (93 lines, deleted
 * 2026-07-13) built its `onSpeakVerified` billing signal on an `isOpen()` poll — it fired on
 * socket-open alone. That is below the bar `lib/voice/adapter.ts` documents today ("a REAL, working
 * voice connection capable of producing audio... must NOT fire on... a merely-attempted
 * connection") and below what both live adapters do (Hume: `chat_metadata` + first speaking event;
 * OpenAI: `session.updated` + first audio delta). The old logic's SHAPE is reused; its THRESHOLD is
 * not — see `onSpeakVerified()` below.
 *
 * THREE DELIBERATE NON-IMPLEMENTATIONS, each because the SDK exposes no honest signal (§6.6.4):
 *   - `getOutputAnalyser()` — `@elevenlabs/client` owns its own playback graph and exposes no
 *     `AnalyserNode`. Returning a synthetic one wired to nothing would be a decorative signal,
 *     which this codebase bans. Replaced by the real `getOutputFrequencyData()` accessor below.
 *   - A reconnect loop — Hume and OpenAI each run one because each owns its raw `WebSocket`. This
 *     SDK owns its transport; a second loop on top would fight it.
 *   - `onUserSpeechStarted` — not exposed as a browser-client callback at all (`vad_score` exists
 *     at the raw protocol level only). Consequence, stated plainly: the widget's post-tool-call
 *     nudge is no longer cancelled by the PARTICIPANT starting to speak; it is still cancelled by
 *     the MODEL starting to speak, via `onModeChange`.
 *
 * TWO SDK FACTS VERIFIED AGAINST `@elevenlabs/client@1.17.0`'s OWN SOURCE, NOT RECALLED:
 *   - `MessagePayload` carries BOTH `source` (`'user' | 'ai'`) and `role` (`'user' | 'agent'`).
 *     This adapter must forward `source` — see `onMessage` below for the silent-data-loss trap
 *     reading `role` would cause.
 *   - `onError` carries THREE different classes of problem, two of which are tool-level and not
 *     connection-level. See `handleError()` for the discrimination this makes mandatory.
 */

export interface ElevenLabsAdapterConfig {
  /** Server-minted WebRTC conversation token from app/api/elevenlabs-token/route.ts.
   *  The raw API key is NEVER passed to the browser and never appears in this interface.
   *  (WebSocket fallback: replace with `signedUrl: string` — see §6.4.) */
  conversationToken: string
  /** The fully-assembled, widget-only ElevenLabs prompt (lib/voice/widget-elevenlabs-prompt-rules.ts),
   *  computed server-side in widget-render/page.tsx. Sent as overrides.agent.prompt.prompt. */
  instructions: string
  /** Session ref — logging/reporting parity with Hume's and OpenAI's `userId`. */
  userId: string
  onConnect: (sessionId: string) => void
  onDisconnect: () => void
  onError: (message: string) => void
  onModeChange: (mode: 'listening' | 'speaking') => void
  onMessage: (text: string, source: 'user' | 'ai') => void
  tools: Record<string, (params: Record<string, unknown>) => Promise<string>>
  /** Same optional diagnostic hook shape OpenAIRealtimeAdapter already uses, so
   *  WidgetRenderClient's existing voice-diagnostic-capture plumbing is reused unchanged. */
  onDiagnostic?: (label: string, detail: Record<string, unknown>) => void
  reportError?: (message: string) => void
}

/** 2026-08-09 — raised from the original 3000ms (and brought in line with OpenAI's own 8000ms for
 *  the same class of wait) after a live session showed a ~33-word closing summary genuinely needs
 *  10-14s to speak aloud; 3000ms was too tight for a realistic closing turn even when the wait
 *  logic below worked perfectly. Used by `waitForPlaybackCaughtUp()` (show_visual/advance_tab —
 *  worst case is a slightly delayed page move). `endSession()` uses its own, longer
 *  `END_SESSION_WAIT_TIMEOUT_MS` below, since a premature hangup is a strictly worse failure than a
 *  few extra seconds of silence before the call actually ends. */
const MODE_WAIT_TIMEOUT_MS = 8000

/** 2026-08-09 — end_session's own bound, longer than MODE_WAIT_TIMEOUT_MS. The closing turn is
 *  frequently a full-session summary plus a farewell line, the longest single utterance in a
 *  session by design — it needs more headroom than a mid-session page-advance wait, and cutting the
 *  farewell off (the original bug this fixes) is a worse outcome than a longer pause before the
 *  call actually ends. */
const END_SESSION_WAIT_TIMEOUT_MS = 15000

export class ElevenLabsAdapter implements VoiceSessionAdapter {
  private conversation: VoiceConversation | null = null
  private readonly config: ElevenLabsAdapterConfig

  private conversationId = ''
  /** `@elevenlabs/client` does expose an `isOpen()` of its own, but this adapter tracks the flag
   *  locally off `onStatusChange` so that `'disconnecting'` is handled explicitly — `Status` has
   *  FOUR values, and a session mid-teardown must not report itself open to the join-greeting poll
   *  (WidgetRenderClient's `adapter?.isOpen()` gate). */
  private connected = false
  private mode: 'listening' | 'speaking' = 'listening'
  /** 2026-08-09 — epoch ms of the last `onModeChange` and the last AI `onMessage`, used to detect a
   *  STALE mode reading — see `waitForListening()`'s own doc comment for the exact failure this
   *  fixes (a live session where `mode` was already 'listening' from a PRIOR turn before the
   *  farewell utterance's own speaking cycle had even started, so the wait resolved instantly and
   *  protected nothing). */
  private lastModeChangeAt = 0
  private lastAiMessageAt = 0
  private outputVol = 1.0
  private canSendFeedbackFlag = false
  private intentionalClose = false

  /** Two-signal speak verification — see `onSpeakVerified()`. */
  private hasConversationId = false
  private hasSpokenOnce = false
  private speakVerifiedFired = false
  private speakVerifiedCallback: (() => void) | null = null

  /** Resolvers waiting on the next `onModeChange -> 'listening'`. */
  private listeningWaiters = new Set<() => void>()

  /** True from construction until the connection is established. A connection-level error inside
   *  this window is the window in which a REJECTED PROMPT OVERRIDE would surface (§8), so it gets
   *  an additional `el_override_rejected` diagnostic — emitted IN ADDITION TO `el_error`, never
   *  instead of it. */
  private initiating = true

  private constructor(config: ElevenLabsAdapterConfig) {
    this.config = config
  }

  /**
   * §6.6.2. Opens the conversation. Throws if `startSession` throws — the caller
   * (WidgetRenderClient's `connect()`) already wraps this in a try/catch that produces the existing
   * `status: 'error'` + content-still-readable degradation, so a rejected override, a bad token, or
   * a network failure all surface the same visible way (AT-15, AT-16).
   */
  static async create(config: ElevenLabsAdapterConfig): Promise<ElevenLabsAdapter> {
    const adapter = new ElevenLabsAdapter(config)
    await adapter.start()
    return adapter
  }

  private async start(): Promise<void> {
    try {
      // `Conversation.startSession`'s return type is a TextConversation|VoiceConversation union
      // because `textOnly` is deliberately NOT set (§6.6.2 lists it among the BaseSessionConfig
      // fields this build leaves alone). Every session here is a voice session — a WebRTC
      // conversation token with real mic capture — so the union is narrowed here rather than by
      // setting a config field the spec explicitly excludes.
      const conversation = (await Conversation.startSession({
        conversationToken: this.config.conversationToken,
        // Explicit, never inference-dependent (§6.4).
        connectionType: 'webrtc' as const,
        // EXACTLY this and nothing else (Known Constraint C3, §6.5). Do not add `llm`, `toolIds`,
        // `knowledgeBase`, `firstMessage`, `language`, or any `tts`/`asr`/`conversation` field.
        overrides: {
          agent: {
            prompt: { prompt: this.config.instructions },
          },
        },
        clientTools: this.buildClientTools(),
        // A real field on BaseSessionConfig — correlates ElevenLabs-side conversation records back
        // to Clio sessions.
        userId: this.config.userId,
        onConnect: ({ conversationId }: { conversationId: string }) => this.handleConnect(conversationId),
        onDisconnect: (details) => this.handleDisconnect(details),
        onError: (message: string, context?: unknown) => this.handleError(message, context),
        onMessage: (payload) => this.handleMessage(payload),
        onModeChange: ({ mode }: { mode: 'speaking' | 'listening' }) => this.handleModeChange(mode),
        onStatusChange: ({ status }) => this.handleStatusChange(status),
        onCanSendFeedbackChange: ({ canSendFeedback }: { canSendFeedback: boolean }) => {
          this.canSendFeedbackFlag = canSendFeedback
        },
      })) as VoiceConversation

      this.conversation = conversation
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.config.onDiagnostic?.('el_error', { message })
      if (this.initiating) this.config.onDiagnostic?.('el_override_rejected', { message })
      this.initiating = false
      throw err
    }
  }

  // ─── Tool wiring (§6.6.3) ──────────────────────────────────────────────────────────────────────

  /**
   * `config.tools` is already exactly the shape `clientTools` expects, so this is a
   * pass-through with one addition: each call emits the same `tool_call` diagnostic label and shape
   * `OpenAIRealtimeAdapter` already emits, so the per-session diagnostic timeline reads identically
   * across providers.
   *
   * Each handler's return string is handed back to the agent as the tool result — the same contract
   * Hume and OpenAI already honour, which is why the widget's handlers already return
   * 'Visual is showing.' / 'Advanced.' / 'Session ended.'.
   *
   * A handler that THROWS is deliberately left to propagate into the SDK, which reports it through
   * `onError` with a `clientToolName` AND sends `is_error: true` back over the wire so the agent
   * itself is told. See `handleError()`.
   */
  private buildClientTools(): Record<string, (params: Record<string, unknown>) => Promise<string>> {
    const wrapped: Record<string, (params: Record<string, unknown>) => Promise<string>> = {}
    for (const [name, handler] of Object.entries(this.config.tools)) {
      wrapped[name] = async (params: Record<string, unknown>) => {
        const safeParams = params ?? {}
        const result = await handler(safeParams)
        this.config.onDiagnostic?.('tool_call', { name, params: safeParams, result })
        return result
      }
    }
    return wrapped
  }

  // ─── SDK callback handlers ─────────────────────────────────────────────────────────────────────

  private handleConnect(conversationId: string): void {
    this.initiating = false
    this.conversationId = conversationId
    this.hasConversationId = Boolean(conversationId)
    this.maybeFireSpeakVerified()
    this.config.onConnect(conversationId)
  }

  private handleDisconnect(details: {
    reason: 'error' | 'agent' | 'user'
    message?: string
    closeCode?: number
    closeReason?: string
  }): void {
    this.connected = false
    this.initiating = false
    // The DisconnectionDetails discriminated union flattened. `reason` is the useful part:
    // 'user' (participant ended), 'agent' (Clio ended — the normal end_session path), 'error' (a
    // real failure, which additionally carries `message`). Strictly better than a boolean
    // "intentional" flag, and it comes free from the SDK.
    this.config.onDiagnostic?.('el_disconnect', {
      reason: details?.reason,
      closeCode: details?.closeCode,
      closeReason: details?.closeReason,
      message: details?.reason === 'error' ? details.message : undefined,
      intentionalClose: this.intentionalClose,
    })
    this.resolveListeningWaiters()
    this.config.onDisconnect()
  }

  /**
   * §6.6.6 — THE TRAP. `@elevenlabs/client` routes three different classes of problem through this
   * one callback (all three verified in the SDK's own `BaseConversation.ts`):
   *   1. Fatal connection/protocol errors.
   *   2. A client tool the agent called that is NOT REGISTERED —
   *      `onError("Client tool with name X is not defined on client", { clientToolName })`.
   *   3. A registered client tool whose handler THREW —
   *      `onError("Client tool execution failed with following error: ...", { clientToolName })`.
   *
   * WidgetRenderClient's shared `onError` handler flips the WHOLE session into the error state —
   * red "Disconnected" pill, "Voice connection issue" toast. Passing cases 2 and 3 through it would
   * make a single transient tool fault, on a perfectly healthy connection, present as a broken
   * session while Clio carries on talking normally.
   *
   * This is NOT swallowing the error: it still reaches `reportError` (the same client-error sink
   * both existing adapters use) and the per-session diagnostic timeline, and the SDK independently
   * sends `is_error: true` back to the agent on both tool paths regardless — so the model is always
   * told. The discrimination affects only what the PARTICIPANT'S SCREEN does.
   */
  private handleError(message: string, context?: unknown): void {
    const toolName = (context as { clientToolName?: string } | undefined)?.clientToolName
    if (toolName) {
      this.config.onDiagnostic?.('el_tool_error', { toolName, message })
      this.config.reportError?.(`ElevenLabs client tool error (${toolName}): ${message}`)
      return
    }

    this.config.onDiagnostic?.('el_error', { message })
    if (this.initiating) {
      // The initiation window — where a rejected prompt override surfaces (§8). Emitted IN ADDITION
      // TO el_error, never instead of it.
      this.config.onDiagnostic?.('el_override_rejected', { message })
    }
    this.config.onError(message)
  }

  /**
   * `MessagePayload` carries TWO speaker fields with DIFFERENT vocabularies: `source` is
   * `'user' | 'ai'`, `role` is `'user' | 'agent'`. This codebase's `onMessage` signature and
   * `/api/partner/render/transcript-capture`'s Zod enum are both `'user' | 'ai'`.
   *
   * Reading `role` would send `'agent'` to that route, fail its Zod validation, and — because that
   * route returns `200 { ok: false }` on validation failure BY DESIGN, so it can never block a live
   * call — SILENTLY DROP EVERY ONE OF CLIO'S TURNS from the transcript, leaving insight extraction
   * to run against user turns only. Asserted by a unit test (AT-22).
   */
  private handleMessage(payload: { message: string; source: 'user' | 'ai'; role?: string }): void {
    if (payload.source === 'ai') this.lastAiMessageAt = Date.now()
    this.config.onMessage(payload.message, payload.source)
  }

  private handleModeChange(mode: 'speaking' | 'listening'): void {
    this.mode = mode
    this.lastModeChangeAt = Date.now()
    this.config.onDiagnostic?.('el_mode_change', { mode })
    if (mode === 'speaking') {
      this.hasSpokenOnce = true
      this.maybeFireSpeakVerified()
    } else {
      this.resolveListeningWaiters()
    }
    this.config.onModeChange(mode)
  }

  private handleStatusChange(status: 'disconnected' | 'connecting' | 'connected' | 'disconnecting'): void {
    // Status has FOUR values. 'disconnecting' is a normal teardown step, not an open connection.
    this.connected = status === 'connected'
    if (status === 'connected') this.initiating = false
    this.config.onDiagnostic?.('el_status_change', { status })
  }

  // ─── Speak verification (billing-start signal) ────────────────────────────────────────────────

  private maybeFireSpeakVerified(): void {
    if (this.speakVerifiedFired) return
    if (!this.hasConversationId || !this.hasSpokenOnce) return
    this.speakVerifiedFired = true
    const cb = this.speakVerifiedCallback
    this.speakVerifiedCallback = null
    cb?.()
  }

  /**
   * AUTOGEN-01 Part D billing-start signal, at the bar `lib/voice/adapter.ts` documents. Fires
   * exactly once, and only when BOTH (a) `onConnect` has delivered a real ElevenLabs-assigned
   * conversation id AND (b) the first `onModeChange -> 'speaking'` has occurred. Never on a
   * merely-attempted connection, and never on `onStatusChange('connected')` alone. Fires
   * immediately for a late subscriber if verification already happened.
   */
  onSpeakVerified(callback: () => void): void {
    if (this.speakVerifiedFired) {
      callback()
      return
    }
    this.speakVerifiedCallback = callback
  }

  // ─── Bounded mode wait (the playback-completion PROXY) ────────────────────────────────────────

  private resolveListeningWaiters(): void {
    const waiters = Array.from(this.listeningWaiters)
    this.listeningWaiters.clear()
    for (const resolve of waiters) resolve()
  }

  private waitForListening(timeoutMs: number): Promise<void> {
    // 2026-08-09 — do not trust an already-'listening' mode reading if it predates the newest AI
    // utterance: it may be a STALE signal left over from a PRIOR turn, observed before THIS
    // utterance's own speaking cycle has even been reported — the exact failure class that let a
    // real farewell get cut off (see this method's callers' own doc comments for the incident).
    // Genuinely caught-up: mode is not 'speaking' AND that mode reading is at least as new as the
    // latest AI message. Anything else (currently speaking, or a stale/older listening reading)
    // must wait for a real, subsequent 'listening' transition instead of trusting the snapshot.
    const freshlyListening = this.mode !== 'speaking' && this.lastModeChangeAt >= this.lastAiMessageAt
    if (freshlyListening) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.listeningWaiters.delete(finish)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      this.listeningWaiters.add(finish)
    })
  }

  /**
   * B2B-61 round 3's optional extension point, implemented here as an EXPLICITLY-LABELLED PROXY,
   * not parity. ElevenLabs exposes no audio queue and no "playback finished" event; the nearest
   * real signal is `onModeChange -> 'listening'`, and the docs do not state whether that fires at
   * generation-complete or playback-complete. Bounded at 3s so the worst case is a slightly delayed
   * page move, never a stall.
   *
   * If it turns out to be generation-complete, behaviour is identical to Hume's today (which does
   * not implement this method at all) — so this is strictly no-worse-than-current, never worse.
   * REVERT PATH: delete this method. `WidgetRenderClient`'s `adapter?.waitForPlaybackCaughtUp?.()`
   * optional chaining makes its absence a real no-op with no other change. AT-11 exists to settle
   * this against a real session rather than assume it.
   */
  async waitForPlaybackCaughtUp(): Promise<void> {
    await this.waitForListening(MODE_WAIT_TIMEOUT_MS)
  }

  // ─── VoiceSessionAdapter — required members ───────────────────────────────────────────────────

  /** Real and functional here, unlike Hume (where it is a permanent no-op because Hume rejects
   *  `session_settings.system_prompt` under a Custom-LLM config). */
  injectContext(text: string): void {
    try {
      this.conversation?.sendContextualUpdate(text)
    } catch (err) {
      console.warn('[elevenlabs-adapter] sendContextualUpdate failed:', err instanceof Error ? err.message : err)
    }
  }

  /**
   * §6.6.5. Step 2 (the bounded mode wait) exists because this is a known, expensively-learned
   * failure class in this codebase: `OpenAIRealtimeAdapter.endSession()` carries a long comment
   * describing a real live session whose spoken goodbye was cut off mid-sentence because teardown
   * ran the instant the tool call resolved. The widget's `end_session` handler calls
   * `endSessionOnce()` immediately, so the same race exists here, and the mode wait is the only
   * real signal available to guard it.
   *
   * Never throws — teardown is best-effort, exactly as `WidgetRenderClient.endSessionOnce()`
   * already assumes.
   */
  async endSession(): Promise<void> {
    this.intentionalClose = true
    try {
      await this.waitForListening(END_SESSION_WAIT_TIMEOUT_MS)
      await this.conversation?.endSession()
    } catch (err) {
      console.warn('[elevenlabs-adapter] endSession failed (non-fatal):', err instanceof Error ? err.message : err)
    } finally {
      this.connected = false
      this.resolveListeningWaiters()
    }
  }

  setVolume(volume: number): void {
    this.outputVol = volume
    try {
      this.conversation?.setVolume({ volume })
    } catch (err) {
      console.warn('[elevenlabs-adapter] setVolume failed:', err instanceof Error ? err.message : err)
    }
  }

  setMicMuted(muted: boolean): void {
    try {
      this.conversation?.setMicMuted(muted)
    } catch (err) {
      console.warn('[elevenlabs-adapter] setMicMuted failed:', err instanceof Error ? err.message : err)
    }
  }

  /**
   * Returns 0, matching `OpenAIRealtimeAdapter.getInputVolume()`. Neither `WidgetRenderClient` nor
   * `PartnerRenderClient` calls this member — the level pills read the analyser / frequency data
   * instead — and returning a stale cached number would be a fabricated reading, so a constant 0 is
   * the honest choice.
   */
  getInputVolume(): number {
    return 0
  }

  /** The locally-tracked value set by `setVolume` (default 1.0) — same approach and same reason as
   *  `OpenAIRealtimeAdapter`. */
  getOutputVolume(): number {
    return this.outputVol
  }

  /**
   * A REAL implementation, unlike Hume's and OpenAI's no-ops, since ElevenLabs genuinely exposes
   * it. The SDK's signature is `sendFeedback(like: boolean | null, eventId?: number)`; this
   * interface member is `sendFeedback(like: boolean)`, so `like` passes through and `eventId` is
   * omitted (the SDK defaults it to its own `currentEventId`). The null-to-clear case is
   * unreachable through this interface — do not add a parameter for it.
   *
   * The SDK already guards internally (`if (!this.canSendFeedback) { console.warn(...); return }`),
   * so it no-ops rather than throwing; the `canSendFeedbackFlag` check here exists purely to avoid
   * a console warning on every no-op. No current call site invokes this member.
   */
  sendFeedback(like: boolean): void {
    if (!this.canSendFeedbackFlag) return
    try {
      this.conversation?.sendFeedback(like)
    } catch (err) {
      console.warn('[elevenlabs-adapter] sendFeedback failed:', err instanceof Error ? err.message : err)
    }
  }

  getId(): string {
    return this.conversationId
  }

  isOpen(): boolean {
    return this.connected
  }

  // ─── VoiceSessionAdapter — optional extension points ──────────────────────────────────────────

  /**
   * Real and correctly attributed. HONEST LIMITATION: unlike OpenAI's `session.update`,
   * `sendContextualUpdate` delivers the context but does NOT force the agent to take a turn — the
   * note lands and influences the agent's next NATURAL turn. `sendUserMessage()` WOULD force a turn
   * and is deliberately rejected: it is attributed to the participant, so the instruction text
   * would enter the conversation as the participant's own words and the model would react to it as
   * speech. That is worse than the delay.
   */
  sendWrapUpNudge(instructionText: string): boolean {
    return this.sendContextualNote(instructionText)
  }

  /**
   * Same mechanism and same honest limitation as `sendWrapUpNudge`. Affects the widget's idle
   * check-in and its 60-minute cap. Still strictly better than Hume, which does not implement this
   * method at all — so both mechanisms are complete no-ops on the current default provider today.
   * Note the IDLE nudge's own trigger is OpenAI-only, so in practice only the max-duration note
   * reaches this method on ElevenLabs.
   */
  triggerRecoveryNudge(instructionText: string): boolean {
    return this.sendContextualNote(instructionText)
  }

  private sendContextualNote(text: string): boolean {
    if (!this.connected || !this.conversation) return false
    try {
      this.conversation.sendContextualUpdate(text)
      return true
    } catch (err) {
      console.warn('[elevenlabs-adapter] contextual note failed:', err instanceof Error ? err.message : err)
      return false
    }
  }

  /**
   * B2B-75's new optional interface member (lib/voice/adapter.ts). `getOutputAnalyser()` is
   * deliberately NOT implemented on this adapter — `@elevenlabs/client` owns its playback graph and
   * exposes no `AnalyserNode` — so `WidgetRenderClient`'s level-sampling interval falls back to
   * this. Both carry the SAME real signal from the same real audio; this is an accessor difference,
   * not a fidelity difference, and neither is a decorative animation source.
   */
  getOutputFrequencyData(): Uint8Array | null {
    if (!this.conversation) return null
    try {
      return this.conversation.getOutputByteFrequencyData()
    } catch {
      return null
    }
  }
}
