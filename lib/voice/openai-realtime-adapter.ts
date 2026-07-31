import type { VoiceSessionAdapter } from './adapter'

/**
 * B2B-61 Part A — OpenAI Realtime voice adapter (alternate provider, Hume remains default).
 *
 * ============================================================================================
 * SPIKE STATUS — READ BEFORE TRUSTING THIS FILE IN PRODUCTION
 * ============================================================================================
 * The brief for this build (.claude/agents/clio/feature-briefs/
 * B2B-61-openai-realtime-voice-adapter-and-admin-toggle.md) makes a live connectivity spike the
 * mandatory first gate before writing this file, specifically to confirm — against a real
 * WebSocket, not documentation — the actual audio frame format/sample rate, tool-call event
 * shapes, and interruption event shapes.
 *
 * `OPENAI_REALTIME_API_KEY` was NOT set in this build environment (confirmed via `env | grep
 * OPENAI` before starting — nothing found). A real spike could not be performed. What follows
 * instead: every event name, payload shape, and connection mechanism below was cross-checked
 * against OpenAI's OWN CURRENT documentation, fetched live during this build on 2026-07-31
 * (developers.openai.com/api/docs/guides/realtime-websocket, realtime-conversations,
 * realtime-vad — not training-data recollection). Specifically confirmed from those live pages:
 *   - WS URL:        wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1  (literal example
 *                     from the docs page)
 *   - Browser auth:  subprotocols array ["realtime", "openai-insecure-api-key.<token>",
 *                     "openai-beta.realtime-v1"] — browsers cannot set a WebSocket Authorization
 *                     header, so this subprotocol mechanism is the documented workaround.
 *   - Audio format:  audio/pcm, 24000 Hz, confirmed in the session.update example.
 *   - Tool shape:    flat { type: 'function', name, description, parameters } (NOT the nested
 *                     Chat-Completions-style { type:'function', function:{...} } shape).
 *   - Function-call flow: response.output_item.done (item.type === 'function_call') is where the
 *                     call is executed, per OpenAI's own docs text: "the function is executed in
 *                     the response.output_item.done event." Result sent back via
 *                     conversation.item.create (type: function_call_output), followed by an
 *                     explicit response.create to resume the model's turn.
 *   - Interrupt:      turn_detection.interrupt_response is a real, documented field; exact
 *                     end-to-end truncation mechanics on the wire were NOT confirmed (the VAD
 *                     guide page describes the config field but not the full event sequence).
 *
 * NOT independently confirmed against a live account (best-documented-effort only, matching
 * training-era Realtime API conventions plus what the fetched pages did show): the exact
 * `session.created` vs `session.updated` firing order/timing, `response.output_audio_transcript
 * .delta/.done` naming for assistant speech transcript, `conversation.item.input_audio
 * _transcription.completed` for user speech transcript, and the precise client_secret response
 * envelope from POST /v1/realtime/client_secrets (see app/api/openai-realtime-token/route.ts's
 * own doc comment — it defensively parses two possible response shapes for this reason).
 *
 * Every `onmessage` branch below degrades harmlessly (falls through to `default: break`,
 * mirroring HumeAdapter's own try/catch-and-ignore parse discipline) if an assumed event name
 * turns out to be wrong — this adapter will not crash on an unexpected event, but a wrong
 * assumption could mean a real signal (e.g. a transcript, or a tool call) is silently missed.
 * **Before this adapter is used for any real partner session, run one real live-call test round
 * and diff actual received event names against the list above** — this is the deferred spike,
 * not a substitute for it.
 * ============================================================================================
 *
 * Interface contract: implements VoiceSessionAdapter (lib/voice/adapter.ts) to the same bar
 * HumeAdapter (lib/voice/hume-adapter.ts) does — reconnect/backoff shape, tool-call handler
 * dispatch, and onSpeakVerified's "real, verified, speaking-capable connection, never on a
 * merely-attempted one" billing-integrity requirement are all deliberately mirrored from there,
 * not reinvented. hume-adapter.ts itself was not modified by this change.
 */

export interface OpenAIRealtimeAdapterConfig {
  /** Ephemeral client token minted by app/api/openai-realtime-token/route.ts. */
  ephemeralToken: string
  /** Realtime model id, e.g. 'gpt-realtime-2.1'. */
  model: string
  /**
   * System instructions for this session. Unlike Hume (whose native-mode instructions are
   * pre-provisioned server-side into a Hume-hosted config, referenced only by `configId` —
   * see lib/voice/hume-native/config-provisioner.ts), OpenAI Realtime has no equivalent
   * hosted-config concept: instructions must be sent directly in `session.update`. Wiring this
   * adapter up to the SAME real, per-session assembled prompt Hume's native mode uses
   * (lib/voice/hume-native/prompt-template.ts's assembleHumeNativePrompt output) is explicitly
   * OUT OF SCOPE for this Part A build — the 7 enumerated build steps in the B2B-61 brief cover
   * the adapter, token route, tool schemas, and the provider-selection seam only, not rewiring
   * the parent server component to compute and pass real session content for a second provider.
   * Callers today (see the seam in PartnerRenderClient.tsx) must pass an explicit instructions
   * string; there is no silent default baked in here, so it's obvious at the call site that this
   * still needs real content wiring before an OpenAI-provider session can teach real material.
   */
  instructions: string
  /** Session ref, used only for logging/reporting parity with Hume's `userId`. */
  userId: string
  mediaStream: MediaStream
  onConnect: (sessionId: string) => void
  onDisconnect: () => void
  onError: (message: string) => void
  onModeChange: (mode: 'listening' | 'speaking') => void
  onMessage: (text: string, source: 'user' | 'ai') => void
  tools: Record<string, (params: Record<string, unknown>) => Promise<string>>
  /** Mirrors HumeAdapterConfig.reportError — optional diagnostic hook for otherwise-silent
   *  WS failure paths (ws.onerror, onclose's give-up branch). */
  reportError?: (message: string) => void
}

/** Tool defs are imported by the caller (PartnerRenderClient.tsx) and passed in via session
 *  config assembled inside this adapter — re-exported here for convenience so callers building
 *  their own session.update payload elsewhere (tests, future callers) share one source of truth. */
export { OPENAI_REALTIME_TOOLS } from './openai-realtime-tools'
import { OPENAI_REALTIME_TOOLS } from './openai-realtime-tools'

const OUTPUT_SAMPLE_RATE = 24000
const INPUT_SAMPLE_RATE = 24000

export class OpenAIRealtimeAdapter implements VoiceSessionAdapter {
  private ws: WebSocket | null = null
  private sessionId = ''
  private audioCtx: AudioContext | null = null
  private gainNode: GainNode | null = null
  private outputVol = 1.0
  private config: OpenAIRealtimeAdapterConfig
  private connected = false
  private intentionalClose = false
  private reconnectAttempts = 0

  // Mirrors HumeAdapter's bounded-retry resilience shape (B2B-52) — not a response to any
  // OpenAI-specific incident, just consistency with the sibling adapter's proven policy.
  private static readonly MAX_RECONNECT = 5
  private static readonly MAX_RECONNECT_DELAY_MS = 8000

  // Manual PCM16 mic capture graph — see startMicCapture()/stopMicCapture() doc comments for why
  // this is real new code (Hume's browser adapter uses MediaRecorder + self-contained
  // opus/webm chunks; OpenAI Realtime requires headerless raw PCM16 chunks assembled by hand).
  private micSource: MediaStreamAudioSourceNode | null = null
  private micProcessor: ScriptProcessorNode | null = null
  private micSilentGain: GainNode | null = null

  // Manual PCM16 playback queue — analogous in shape to HumeAdapter's audioQueue/drainQueue, but
  // each queued chunk here is headerless raw PCM16 (must be manually converted to an AudioBuffer)
  // rather than a self-contained blob decodeAudioData() can decode directly.
  private audioQueue: Uint8Array[] = []
  private isPlaying = false

  // AUTOGEN-01-parity speak-verification state — see onSpeakVerified() doc comment. Mirrors
  // HumeAdapter's own two-signal (`hasReceivedChatMetadata` + first speaking event) requirement:
  // here, `hasSessionReady` (session.updated) + first real `response.output_audio.delta`.
  private hasSessionReady = false
  private speakVerifiedFired = false
  private speakVerifiedCallback: (() => void) | null = null

  // Per-response bookkeeping for the "first audio delta of a response = now speaking" signal.
  private currentResponseSpeaking = false

  constructor(config: OpenAIRealtimeAdapterConfig) {
    this.config = config
  }

  static async create(config: OpenAIRealtimeAdapterConfig): Promise<OpenAIRealtimeAdapter> {
    const adapter = new OpenAIRealtimeAdapter(config)
    await adapter.openConnection()
    return adapter
  }

  private openConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.config.model)}`
      // Browser WebSocket cannot set an Authorization header — this subprotocol-based auth
      // mechanism is OpenAI's own documented workaround for browser/client connections (confirmed
      // live against developers.openai.com/api/docs/guides/realtime-websocket during this build;
      // see the top-of-file spike-status comment). UNVERIFIED against a real live connection.
      const protocols = [
        'realtime',
        `openai-insecure-api-key.${this.config.ephemeralToken}`,
        'openai-beta.realtime-v1',
      ]

      let resolved = false

      try {
        this.ws = new WebSocket(url, protocols)
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to construct OpenAI Realtime WebSocket'))
        return
      }

      // Reuse a single AudioContext, at the API's required 24kHz, across reconnects — created
      // once, matching HumeAdapter's own reuse-across-reconnects pattern.
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE })
        this.gainNode = this.audioCtx.createGain()
        this.gainNode.gain.value = this.outputVol
        this.gainNode.connect(this.audioCtx.destination)
      }

      this.ws.onopen = () => {
        this.reconnectAttempts = 0

        this.ws?.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            model: this.config.model,
            output_modalities: ['audio'],
            instructions: this.config.instructions,
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: INPUT_SAMPLE_RATE },
                turn_detection: { type: 'semantic_vad', interrupt_response: true },
                transcription: { model: 'whisper-1' },
              },
              output: {
                format: { type: 'audio/pcm', rate: OUTPUT_SAMPLE_RATE },
                voice: 'alloy',
              },
            },
            tools: OPENAI_REALTIME_TOOLS,
            tool_choice: 'auto',
          },
        }))

        this.startMicCapture()
        if (!resolved) { resolved = true; resolve() }
      }

      this.ws.onerror = () => {
        if (!resolved) {
          resolved = true
          this.config.reportError?.('OpenAI Realtime WebSocket onerror (during connect, before open)')
          reject(new Error('OpenAI Realtime WebSocket connection failed'))
        } else {
          this.config.reportError?.('OpenAI Realtime WebSocket onerror (after open)')
          this.config.onError('OpenAI Realtime connection error')
        }
      }

      this.ws.onclose = (event) => {
        this.connected = false
        this.stopMicCapture()

        if (this.intentionalClose) {
          this.config.onDisconnect()
          return
        }

        // Auth/policy error (code 1008, matching HumeAdapter's own special-case) — retrying
        // won't help; also give up once the bounded retry budget is exhausted.
        if (event.code === 1008 || this.reconnectAttempts >= OpenAIRealtimeAdapter.MAX_RECONNECT) {
          const reason = event.reason || 'no reason given'
          console.error(`[OpenAIRealtimeAdapter] WS closed (code ${event.code}) — reason: ${reason}`)
          this.config.reportError?.(`OpenAI Realtime WebSocket closed — code ${event.code}, reason: ${reason}`)
          this.config.onError(`OpenAI Realtime WebSocket disconnected: ${reason} (code ${event.code})`)
          this.config.onDisconnect()
          return
        }

        this.reconnectAttempts++
        const delay = Math.min(Math.pow(2, this.reconnectAttempts - 1) * 1000, OpenAIRealtimeAdapter.MAX_RECONNECT_DELAY_MS)
        console.warn(`[OpenAIRealtimeAdapter] WS closed (code ${event.code}, reason: ${event.reason || 'none'}) — reconnect attempt ${this.reconnectAttempts}/${OpenAIRealtimeAdapter.MAX_RECONNECT} in ${delay}ms`)
        setTimeout(() => {
          this.openConnection().catch(() => { /* onclose handles further retries */ })
        }, delay)
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Record<string, unknown>
          void this.handleMessage(msg)
        } catch { /* ignore parse errors */ }
      }
    })
  }

  private async handleMessage(msg: Record<string, unknown>) {
    const type = msg.type as string

    switch (type) {
      // Server-assigned session identity. Confirmed our config landed — the closest analogue to
      // Hume's chat_metadata (a real, provider-acknowledged event, not just our own ws.onopen).
      case 'session.updated':
      case 'session.created': {
        const session = msg.session as { id?: string } | undefined
        if (session?.id) this.sessionId = session.id
        if (type === 'session.updated') {
          this.connected = true
          this.hasSessionReady = true
          this.config.onConnect(this.sessionId)
        }
        break
      }

      case 'input_audio_buffer.speech_started':
        // Barge-in: mirrors HumeAdapter's user_interruption — drop anything still queued for
        // playback (does not stop already-started audio mid-flight, matching Hume's exact same
        // non-destructive-to-in-flight-audio behavior) and report we're back in listening mode.
        // Server-side truncation of the in-progress model response is expected to happen
        // automatically via turn_detection.interrupt_response (see spike-status comment above —
        // NOT confirmed against a live connection).
        this.clearAudioQueue()
        this.currentResponseSpeaking = false
        this.config.onModeChange('listening')
        break

      case 'response.output_audio.delta': {
        const data = msg.delta as string | undefined
        if (!data) break

        // Billing-start signal lives here, gated only on real audio bytes having been received
        // from the provider — deliberately NOT additionally gated on local playback infrastructure
        // (this.audioCtx) being ready, so verification reflects the provider's confirmed audio
        // production, not this adapter's own local scheduling state. Mirrors HumeAdapter's
        // assistant_message-gated check exactly (chat_metadata + first speaking signal).
        if (!this.currentResponseSpeaking) {
          this.currentResponseSpeaking = true
          this.config.onModeChange('speaking')
          if (this.hasSessionReady && !this.speakVerifiedFired) {
            this.speakVerifiedFired = true
            this.speakVerifiedCallback?.()
          }
        }

        if (!this.audioCtx) break
        try {
          const raw = atob(data)
          const bytes = new Uint8Array(raw.length)
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
          await this.queueAudio(bytes)
        } catch { /* skip malformed audio */ }
        break
      }

      case 'response.output_audio_transcript.done': {
        const text = (msg.transcript as string | undefined) ?? ''
        if (text) this.config.onMessage(text, 'ai')
        break
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const text = (msg.transcript as string | undefined) ?? ''
        if (text) this.config.onMessage(text, 'user')
        break
      }

      case 'response.done':
        this.currentResponseSpeaking = false
        this.config.onModeChange('listening')
        break

      // Per OpenAI's own docs (confirmed live during this build): "Arguments streamed in the
      // response.function_call_arguments.delta event are accumulated and the function is
      // executed in the response.output_item.done event" — so the actual tool dispatch happens
      // below, keyed off the completed item, not off the deltas.
      case 'response.output_item.done': {
        const item = msg.item as
          | { type?: string; name?: string; call_id?: string; arguments?: string }
          | undefined
        if (item?.type !== 'function_call' || !item.name || !item.call_id) break

        let params: Record<string, unknown> = {}
        try { params = JSON.parse(item.arguments ?? '{}') } catch { /* noop */ }

        let result = 'Tool executed.'
        const handler = this.config.tools[item.name]
        if (handler) {
          try { result = await handler(params) } catch { result = 'Tool execution failed.' }
        } else {
          console.warn('[OpenAIRealtimeAdapter] No handler for tool:', item.name)
        }

        this.ws?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: item.call_id, output: result },
        }))
        // Explicit resume — unlike Hume, sending a tool result does not implicitly prompt OpenAI
        // to continue speaking; a fresh response.create is required (confirmed live in OpenAI's
        // own docs during this build).
        this.ws?.send(JSON.stringify({ type: 'response.create' }))
        break
      }

      case 'error': {
        const err = msg.error as { message?: string } | undefined
        const errMsg = err?.message ?? 'OpenAI Realtime error'
        console.error('[OpenAIRealtimeAdapter] error:', errMsg)
        this.config.onError(errMsg)
        break
      }

      default:
        break
    }
  }

  /**
   * Manual PCM16 mic capture — the substantial new work this adapter required (per the B2B-61
   * brief's own assessment): Hume's browser adapter hands MediaRecorder self-contained
   * opus/webm chunks; OpenAI Realtime instead requires headerless raw PCM16 @ 24kHz mono
   * little-endian chunks, base64-encoded, sent as `input_audio_buffer.append`.
   *
   * Uses ScriptProcessorNode rather than a separate AudioWorklet module — deprecated, but keeps
   * this adapter a single self-contained file with no separate worklet script to load/serve, and
   * remains supported in every browser this stack runs in today. A future migration to
   * AudioWorkletNode would not change this class's public interface.
   */
  private startMicCapture() {
    if (!this.config.mediaStream || !this.ws || !this.audioCtx) return

    const source = this.audioCtx.createMediaStreamSource(this.config.mediaStream)
    const bufferSize = 4096
    const processor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1)

    processor.onaudioprocess = (e) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return
      const input = e.inputBuffer.getChannelData(0)
      const pcm16 = new Int16Array(input.length)
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]))
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      const bytes = new Uint8Array(pcm16.buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: btoa(binary) }))
    }

    // ScriptProcessorNode only fires onaudioprocess while connected through to a destination in
    // some browsers — route through a zero-gain node so raw mic audio is never looped back out to
    // the speaker.
    const silentGain = this.audioCtx.createGain()
    silentGain.gain.value = 0
    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(this.audioCtx.destination)

    this.micSource = source
    this.micProcessor = processor
    this.micSilentGain = silentGain
  }

  private stopMicCapture() {
    try { this.micProcessor?.disconnect() } catch { /* noop */ }
    try { this.micSource?.disconnect() } catch { /* noop */ }
    try { this.micSilentGain?.disconnect() } catch { /* noop */ }
    this.micProcessor = null
    this.micSource = null
    this.micSilentGain = null
  }

  /**
   * Manual PCM16 playback — the receiving half of the same novel work as startMicCapture().
   * Each queued chunk is headerless raw PCM16 @ 24kHz mono; unlike HumeAdapter's
   * `audioCtx.decodeAudioData()` (works because Hume sends self-contained decodable chunks),
   * playback here requires manually converting Int16 samples to Float32 and building an
   * AudioBuffer by hand before scheduling it.
   */
  private async queueAudio(bytes: Uint8Array) {
    this.audioQueue.push(bytes)
    if (!this.isPlaying) await this.drainQueue()
  }

  private async drainQueue() {
    if (!this.audioCtx || this.audioQueue.length === 0) {
      this.isPlaying = false
      return
    }
    this.isPlaying = true
    const bytes = this.audioQueue.shift()!
    try {
      const sampleCount = Math.floor(bytes.byteLength / 2)
      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount)
      const float32 = new Float32Array(sampleCount)
      for (let i = 0; i < sampleCount; i++) {
        const v = int16[i]
        float32[i] = v < 0 ? v / 0x8000 : v / 0x7fff
      }
      const buffer = this.audioCtx.createBuffer(1, sampleCount, OUTPUT_SAMPLE_RATE)
      buffer.copyToChannel(float32, 0)
      const src = this.audioCtx.createBufferSource()
      src.buffer = buffer
      src.connect(this.gainNode ?? this.audioCtx.destination)
      src.onended = () => void this.drainQueue()
      src.start()
    } catch {
      await this.drainQueue()
    }
  }

  // Matches HumeAdapter's clearAudioQueue() exactly: drops queued-but-not-yet-started chunks,
  // does not stop audio already mid-flight. Same interruption contract, not reinterpreted.
  private clearAudioQueue() {
    this.audioQueue = []
    this.isPlaying = false
  }

  // ── VoiceSessionAdapter ───────────────────────────────────────────────────

  /**
   * Real, functional context injection (unlike Hume, where this is an intentional permanent
   * no-op due to Hume rejecting session_settings.system_prompt under a Custom-LLM config —
   * E0716). OpenAI Realtime does not reject mid-session conversation items. UNVERIFIED against a
   * live connection — see top-of-file spike-status comment; 'system' as a conversation item role
   * is a best-documented-effort assumption, not confirmed live.
   */
  injectContext(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] },
      }))
    } catch (err) {
      console.warn('[OpenAIRealtimeAdapter] injectContext failed:', err)
    }
  }

  /**
   * VoiceSessionAdapter's optional extension point (see adapter.ts doc comment) — real,
   * functional implementation here: amends the live session's instructions via `session.update`.
   * UNVERIFIED against a live connection whether a partial (instructions-only) session.update is
   * accepted mid-session without repeating other fields — see top-of-file spike-status comment.
   */
  sendWrapUpNudge(instructionText: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: `${this.config.instructions}\n\n${instructionText}`,
        },
      }))
      return true
    } catch (err) {
      console.warn('[OpenAIRealtimeAdapter] sendWrapUpNudge failed:', err)
      return false
    }
  }

  async endSession(): Promise<void> {
    this.intentionalClose = true
    this.stopMicCapture()
    this.clearAudioQueue()
    this.ws?.close()
    try { await this.audioCtx?.close() } catch { /* noop */ }
  }

  setVolume(volume: number): void {
    this.outputVol = volume
    if (this.gainNode) this.gainNode.gain.value = volume
  }

  setMicMuted(muted: boolean): void {
    for (const track of this.config.mediaStream.getAudioTracks()) {
      track.enabled = !muted
    }
  }

  getInputVolume(): number { return 0 }
  getOutputVolume(): number { return this.outputVol }
  // OpenAI Realtime doesn't expose a per-message feedback API either (same as Hume — see
  // HumeAdapter.sendFeedback's own comment).
  sendFeedback(_like: boolean): void { /* no-op, no provider API for this */ }
  getId(): string { return this.sessionId }
  isOpen(): boolean { return this.connected && this.ws?.readyState === WebSocket.OPEN }

  /**
   * Mirrors HumeAdapter.onSpeakVerified exactly: fires exactly once, only after BOTH a real
   * provider-confirmed session (session.updated) AND the first actual produced audio bytes
   * (first response.output_audio.delta) — never on connection-attempt alone. Fires immediately
   * for a late subscriber if verification already happened.
   */
  onSpeakVerified(callback: () => void): void {
    this.speakVerifiedCallback = callback
    if (this.speakVerifiedFired) callback()
  }
}
