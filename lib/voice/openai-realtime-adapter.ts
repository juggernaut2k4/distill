import type { VoiceSessionAdapter } from './adapter'

/**
 * B2B-61 Part A — OpenAI Realtime voice adapter (alternate provider, Hume remains default).
 *
 * ============================================================================================
 * SPIKE STATUS — updated 2026-07-31 after a REAL live connectivity spike
 * ============================================================================================
 * `OPENAI_REALTIME_API_KEY` became available in this environment (added to Vercel Production +
 * Preview) after this file was first written from documentation alone. The mandatory spike was
 * then actually run: a real ephemeral token minted via the live production
 * /api/openai-realtime-token route, a real WebSocket opened directly against
 * wss://api.openai.com/v1/realtime, real session.update / response.create / tool-call /
 * synthetic-barge-in round trips observed end to end (3 separate live runs). Findings:
 *
 *   CONFIRMED CORRECT, exactly as this file assumed:
 *   - Audio format: audio/pcm, 24000 Hz, both directions — echoed back verbatim in
 *     session.updated.
 *   - Tool shape: flat { type: 'function', name, description, parameters } — echoed back
 *     verbatim.
 *   - Function-call flow: response.output_item.done (item.type === 'function_call', with
 *     .name/.call_id/.arguments) is genuinely where the completed call lands; a live tool-result
 *     round trip (conversation.item.create type:'function_call_output' + explicit
 *     response.create) was sent back and the model correctly resumed speaking, referencing the
 *     result.
 *   - response.output_audio.delta (base64 PCM16 chunks) and response.output_audio_transcript.done
 *     (assistant transcript) fire with exactly these names/shapes.
 *   - session.created fires before session.updated, as this file's handleMessage assumed.
 *   - input_audio_buffer.speech_started fires (confirmed by streaming synthetic audio mid-response)
 *     with the exact type name this file's barge-in branch listens for.
 *
 *   CONFIRMED WRONG, fixed and re-verified live before OPENAI_REALTIME_ADAPTER_AVAILABLE was
 *   flipped to true (see lib/voice/provider-availability.ts):
 *   - The 'openai-beta.realtime-v1' WS subprotocol (originally the 3rd entry in `protocols` below)
 *     is REMOVED — it triggered an immediate, connection-killing server error under the current
 *     GA API: { error: { code: 'beta_api_shape_disabled', message: "The Realtime Beta API is no
 *     longer supported. Please use /v1/realtime for the GA API." } }, WS closed code 4000. The
 *     2-entry protocol list below (['realtime', 'openai-insecure-api-key.<token>']) is what was
 *     actually re-verified working live.
 *
 *   STILL NOT independently observed live (lower risk, not exercised by this spike): the exact
 *   `conversation.item.input_audio_transcription.completed` event for user speech transcript
 *   (no real speech audio was available to send from this headless environment — only synthetic
 *   noise, which triggered speech_started but not a transcribable utterance), and the full
 *   server-side response-truncation wire sequence on a genuine mid-sentence interruption (the
 *   speech_started event itself — which is all this adapter's own barge-in branch depends on —
 *   was confirmed; deeper truncation mechanics were not).
 *
 * Every `onmessage` branch below still degrades harmlessly (falls through to `default: break`)
 * if an event name turns out to be wrong for a case not covered above.
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
  /**
   * 2026-08-01 — experiment toggle for the premature-page-advance investigation (see
   * docs/b2b-pivot-status.md's B2B-59/60 backlog entry). Default `'immediate'` reproduces today's
   * exact, unchanged behavior byte-for-byte: `onMessage('ai', ...)` fires the instant
   * `response.output_audio_transcript.done` arrives, regardless of whether this response's audio
   * has actually finished playing back. `'playback_complete'` defers that call until the audio
   * queue has actually drained (see `flushPendingAiTranscriptIfDrained()`), so the phrase-match
   * driving page transitions only evaluates against audio the participant has actually heard.
   * Deliberately a config field (not a module-level env read inside this file) so callers control
   * it explicitly and it stays trivially revertible — set `transcriptGateMode: 'immediate'` (or
   * simply omit it) to fall back to current behavior instantly, no adapter changes needed.
   */
  transcriptGateMode?: 'immediate' | 'playback_complete'
  /** Session ref, used only for logging/reporting parity with Hume's `userId`. */
  userId: string
  mediaStream: MediaStream
  onConnect: (sessionId: string) => void
  onDisconnect: () => void
  onError: (message: string) => void
  onModeChange: (mode: 'listening' | 'speaking') => void
  /**
   * B2B item 6 (2026-08-02) — fires on every `input_audio_buffer.speech_started` (OpenAI's own
   * server-side VAD confirming the participant actually started speaking), independent of
   * `onModeChange`. Lets the client measure "she asked a direct question and got total silence"
   * off a real signal instead of guessing — optional so this stays OpenAI-only (Hume has never
   * needed this and isn't wired for it).
   */
  onUserSpeechStarted?: () => void
  /**
   * TEMPORARY — 2026-08-02, diagnosing issues #2/#3 in
   * docs/2026-08-02-farewell-narration-findings.md §8/§9. Fires for two cases that are otherwise
   * silently dropped: (1) an empty/failed `conversation.item.input_audio_transcription.completed`
   * (the model may still have received and acted on the underlying audio via semantic_vad even
   * when transcription fails — see this event's own handler below), and (2) any Realtime event
   * type not otherwise handled by this adapter (falls through to `default: break` today), so a
   * live test call can show exactly what happened frame-by-frame. Remove once those issues are
   * resolved and no longer need live diagnosis.
   */
  onDiagnostic?: (label: string, detail: Record<string, unknown>) => void
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
  // B2B item 3 (2026-08-02) — connect-time warm-up: fade the very first audio chunk in from
  // silence instead of starting at full volume the instant the connection catches up, so voice
  // doesn't feel like it's "racing" in. One-shot — every chunk after the first plays at the
  // normal, unramped volume.
  private hasFadedInFirstChunk = false
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

  // 2026-08-01 — Arun: "Marin needs to start speaking once joined the call. currently it waits for
  // user to start the conversation." Root cause: unlike Hume's EVI (which auto-initiates on
  // connect), OpenAI's Realtime API never generates a turn on its own — it only responds to user
  // audio or an explicit `response.create`. This adapter sent session.update then just started
  // listening, so the assembled prompt's own rule 1 ("Open the session warmly...") never actually
  // got a turn to execute. Fires exactly once per adapter instance (first confirmed
  // session.updated ack only, never on a reconnect mid-session — see the session.updated case in
  // handleMessage() for where this now actually sends) — reconnecting should resume silently, not
  // have Clio re-greet/restart, mirroring the join-greeting flow's own "do not restart" framing
  // (app/api/partner/render/join-greeting/[clio_session_ref]/route.ts).
  private hasTriggeredInitialResponse = false

  // 2026-08-01 — 'playback_complete' gate mode's held-back transcript, waiting for the audio queue
  // to actually drain before onMessage fires. Null whenever nothing is pending. Single-slot by
  // design: this adapter only ever has one response in flight at a time (mirrors
  // currentResponseSpeaking's own single-active-response assumption) — a second transcript.done
  // arriving while one is still pending would indicate that assumption broke, so it's logged
  // rather than silently overwritten.
  private pendingAiTranscript: string | null = null

  // 2026-08-02 — root-cause fix for the missing/cut-off farewell found in live session
  // 98be7c6d-c316-4bc2-a2ff-fe45adcdd434 (OpenAI Realtime, partner_reference 'claude-ai'):
  // waitForPlaybackToFinish() (endSession()'s existing gate) only reflects audio bytes that have
  // ALREADY ARRIVED and been locally queued — it has no way to know the server is still
  // mid-generating further content (e.g. the spoken-goodbye message item) for the SAME response
  // that contains the end_session tool call, if that tool call's item happens to complete before
  // the message item's audio has even started streaming. Investigation evidence: the session
  // ended cleanly (no WS error, no crash, billed 6.26 min), but the transcript-capture store
  // (Redis, via lib/voice/openai-realtime-transcript-store.ts) never received the closing AI turn
  // even though extraction ran 11 seconds after the session ended — too long a window for an
  // in-flight fetch() to still be pending, meaning the onMessage('ai', ...) call that would have
  // triggered that fetch() never happened at all: the underlying
  // response.output_audio_transcript.done event for that item never arrived before the socket was
  // closed. `responseInFlight` closes that gap: true from 'response.created' (a new response has
  // started server-side) until 'response.done' (the ENTIRE response — every output item, not just
  // the one whose own done event we react to for tool dispatch — has finished). endSession() now
  // waits for this to clear, in addition to the existing local-queue drain, before closing
  // anything, so it can no longer close the socket while the server is still sending content
  // (audio and/or its transcript) for the response the goodbye belongs to. Degrades safely to
  // today's exact existing behavior if 'response.created' unexpectedly never fires for some
  // session (responseInFlight simply stays false, so this new wait is a no-op) — this cannot make
  // teardown timing worse than it already was, only better.
  private responseInFlight = false
  private responseDoneWaiters: Array<() => void> = []

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
      // mechanism is OpenAI's own documented workaround for browser/client connections.
      // B2B-61 live connectivity spike (2026-07-31, real WS against a real minted token) CONFIRMED
      // this two-entry list connects and accepts session.update. The originally-built third entry,
      // 'openai-beta.realtime-v1', was REMOVED after the spike showed it triggers an immediate,
      // connection-killing server error on the current GA API:
      //   { type: 'error', error: { code: 'beta_api_shape_disabled',
      //     message: 'The Realtime Beta API is no longer supported. Please use /v1/realtime for
      //     the GA API.' } }  — WS closes with code 4000.
      // Do not re-add that subprotocol.
      const protocols = [
        'realtime',
        `openai-insecure-api-key.${this.config.ephemeralToken}`,
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
                // Chosen 2026-07-31 per Arun: the more natural/energetic of the two
                // gpt-realtime-native voices — better fit for an energetic, educational
                // teaching persona than the legacy 'alloy'/'verse' voices.
                voice: 'marin',
                // 2026-08-01 (round 2) — per Arun, after live-testing 0.9: reset to the 1.0
                // baseline. The warmth/slowness he's after is being pursued through the persona
                // instructions (lib/voice/openai-realtime-persona.ts's Pacing/Emotion sections)
                // instead of this deterministic playback-rate lever — a flat rate multiplier makes
                // every word uniformly slower/robotic, whereas the desired effect (pausing after
                // key points, slowing for complex ideas, staying natural elsewhere) needs to vary
                // within a sentence, which only prompt-level pacing guidance can do.
                speed: 1.0,
              },
            },
            tools: OPENAI_REALTIME_TOOLS,
            tool_choice: 'auto',
          },
        }))

        // 2026-08-01 (round 2) — Arun, live test: Marin greeted but skipped the mandated
        // icebreaker/agenda opening (prompt-template.ts rule 1). Root cause: `response.create` was
        // sent here, in the same synchronous tick as `session.update`, without waiting for the
        // server to actually apply it. OpenAI's own session.update is asynchronous — the live spike
        // (see top-of-file SPIKE STATUS) observed it only gets confirmed later via a `session.updated`
        // event. Firing response.create before that ack risks the model generating its first turn
        // against not-yet-bound (or default/blank) instructions, silently skipping rule 1's mandatory
        // opening content. Moved to the `session.updated` case in handleMessage() below, so the
        // first turn only ever generates once the server has actually confirmed instructions landed.
        this.startMicCapture()
        if (!resolved) { resolved = true; resolve() }
      }

      this.ws.onerror = () => {
        if (!resolved) {
          resolved = true
          this.config.reportError?.('OpenAI Realtime WebSocket onerror (during connect, before open)')
          this.config.onDiagnostic?.('ws_error', { phase: 'connecting' })
          reject(new Error('OpenAI Realtime WebSocket connection failed'))
        } else {
          this.config.reportError?.('OpenAI Realtime WebSocket onerror (after open)')
          this.config.onDiagnostic?.('ws_error', { phase: 'connected' })
          this.config.onError('OpenAI Realtime connection error')
        }
      }

      // 2026-08-03 — closes the "was this a real connection problem or a model-behavior stall"
      // gap flagged after a live test call showed several 30-65s stretches with zero events of any
      // kind, alongside the participant's own report of audio flickering/interruptions. Every
      // branch below now also reports to onDiagnostic (the same per-session store tool_call/
      // transcript events land in), not just console/reportError, so a WS close/reconnect shows up
      // directly on the same timeline as everything else instead of requiring a separate log lookup.
      this.ws.onclose = (event) => {
        this.connected = false
        this.stopMicCapture()

        if (this.intentionalClose) {
          this.config.onDiagnostic?.('ws_close', { code: event.code, reason: event.reason || null, intentional: true })
          this.config.onDisconnect()
          return
        }

        // Auth/policy error (code 1008, matching HumeAdapter's own special-case) — retrying
        // won't help; also give up once the bounded retry budget is exhausted.
        if (event.code === 1008 || this.reconnectAttempts >= OpenAIRealtimeAdapter.MAX_RECONNECT) {
          const reason = event.reason || 'no reason given'
          console.error(`[OpenAIRealtimeAdapter] WS closed (code ${event.code}) — reason: ${reason}`)
          this.config.reportError?.(`OpenAI Realtime WebSocket closed — code ${event.code}, reason: ${reason}`)
          this.config.onDiagnostic?.('ws_close', {
            code: event.code,
            reason,
            intentional: false,
            willReconnect: false,
            reconnectAttempts: this.reconnectAttempts,
          })
          this.config.onError(`OpenAI Realtime WebSocket disconnected: ${reason} (code ${event.code})`)
          this.config.onDisconnect()
          return
        }

        this.reconnectAttempts++
        const delay = Math.min(Math.pow(2, this.reconnectAttempts - 1) * 1000, OpenAIRealtimeAdapter.MAX_RECONNECT_DELAY_MS)
        console.warn(`[OpenAIRealtimeAdapter] WS closed (code ${event.code}, reason: ${event.reason || 'none'}) — reconnect attempt ${this.reconnectAttempts}/${OpenAIRealtimeAdapter.MAX_RECONNECT} in ${delay}ms`)
        this.config.onDiagnostic?.('ws_close', {
          code: event.code,
          reason: event.reason || null,
          intentional: false,
          willReconnect: true,
          reconnectAttempt: this.reconnectAttempts,
          delayMs: delay,
        })
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

          // 2026-08-01 (round 2) — see the onopen doc comment above: fires Clio's first turn only
          // now that the server has actually confirmed instructions landed, exactly once per
          // adapter instance (never on a reconnect mid-session, matching the original intent).
          if (!this.hasTriggeredInitialResponse) {
            this.hasTriggeredInitialResponse = true
            this.ws?.send(JSON.stringify({ type: 'response.create' }))
          }
        }
        break
      }

      // 2026-08-02 — see responseInFlight's doc comment above. Standard OpenAI Realtime response
      // lifecycle event marking a new response has started server-side (paired with 'response.done'
      // below, which this adapter already relied on before this fix).
      //
      // 2026-08-03 — now also reported via onDiagnostic: this event was previously invisible in the
      // per-session diagnostic timeline (it's a named case, so it never fell through to the
      // `default: unhandled_event` branch either) — meaning "did the server actually start
      // generating a response after this tool call, or did the request silently go nowhere" could
      // not be answered from stored data. Logging it closes that gap.
      case 'response.created':
        this.responseInFlight = true
        this.config.onDiagnostic?.('response_created', {})
        break

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
        this.config.onUserSpeechStarted?.()
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
        if (!text) break

        // 2026-08-01 — 'immediate' (default, omitted config) is byte-for-byte today's existing
        // behavior: fire right away regardless of playback state. 'playback_complete' only defers
        // when there's actually audio still queued/playing for this response — if playback has
        // already caught up (queue empty) by the time the transcript arrives, there's nothing to
        // gain by waiting, so it still fires immediately in that case too.
        if (this.config.transcriptGateMode === 'playback_complete' && (this.isPlaying || this.audioQueue.length > 0)) {
          if (this.pendingAiTranscript !== null) {
            console.warn('[OpenAIRealtimeAdapter] pendingAiTranscript overwritten before it was flushed — a second response.output_audio_transcript.done arrived while one was still pending playback drain.')
          }
          this.pendingAiTranscript = text
          break
        }

        this.config.onMessage(text, 'ai')
        break
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const text = (msg.transcript as string | undefined) ?? ''
        if (text) {
          this.config.onMessage(text, 'user')
        } else {
          // 2026-08-02 — TEMPORARY diagnostic: this event fired but produced no usable transcript.
          // The model may still have heard and acted on the underlying audio (semantic_vad doesn't
          // require transcription to succeed) — this case was previously silently dropped.
          this.config.onDiagnostic?.('empty_user_transcription', { rawTranscript: msg.transcript ?? null })
        }
        break
      }

      case 'response.done': {
        this.currentResponseSpeaking = false
        this.config.onModeChange('listening')
        this.responseInFlight = false
        this.resolveResponseDoneWaiters()
        // 2026-08-03 — see 'response.created' above: same visibility gap, same fix. `status` (e.g.
        // 'completed', 'cancelled', 'failed', 'incomplete') is the actual server-side outcome of
        // this response — a 'failed'/'incomplete' status here, with no further model turn following
        // it, would directly confirm a server-side generation failure rather than a model
        // choosing to stay silent.
        const response = msg.response as { status?: string; status_details?: unknown } | undefined
        this.config.onDiagnostic?.('response_done', { status: response?.status ?? null, statusDetails: response?.status_details ?? null })
        break
      }

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

        // 2026-08-02 — closes a real diagnostic gap found while investigating the correct-answer
        // silence bug: the previous diagnostic capture only logged event TYPES for unhandled events,
        // never the actual tool call arguments or return values, so "did record_verification_result
        // really get called with 'correct', and what did advance_tab actually return" could only be
        // inferred from the surrounding transcript, never confirmed directly. Logs both for every
        // tool call (not just these two) so the next live test call gives a direct answer instead of
        // an inference.
        this.config.onDiagnostic?.('tool_call', { name: item.name, params, result })

        this.ws?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: item.call_id, output: result },
        }))
        // Explicit resume — unlike Hume, sending a tool result does not implicitly prompt OpenAI
        // to continue speaking; a fresh response.create is required (confirmed live in OpenAI's
        // own docs during this build).
        //
        // 2026-08-02 — end_session is the one exception: the model has already decided the call is
        // over, so prompting it to generate yet more content here serves no product purpose and
        // only opens a second, unnecessary window for endSession()'s teardown to race against
        // still-generating audio. Every other tool (advance_tab, show_visual) still needs this
        // explicit resume exactly as before.
        //
        // 2026-08-02 (later same day) — found while investigating live reports of the model going
        // silent right after advance_tab/record_verification_result: this response.create fires the
        // instant the tool-call ITEM completes, but per OpenAI's own event ordering,
        // response.output_item.done for a function-call item always precedes response.done for the
        // SAME response — meaning responseInFlight is still true here, and the response that just
        // produced this tool call has not yet been confirmed closed server-side. Requesting a new
        // response while one may still be active server-side risks the request being rejected
        // (surfaced only as a console-logged 'error' event, nothing user-visible, no retry) — the
        // model then never continues, and the call goes silent. This is the exact same class of bug
        // already found and fixed in endSession() below (see that method's doc comment) — asking the
        // server for something before confirming the prior operation actually finished — just at a
        // different call site. Fix: wait for this response to be confirmed done first.
        if (item.name !== 'end_session') {
          await this.waitForResponseDone()
          this.ws?.send(JSON.stringify({ type: 'response.create' }))
        }
        break
      }

      case 'error': {
        const err = msg.error as { message?: string; code?: string; type?: string } | undefined
        const errMsg = err?.message ?? 'OpenAI Realtime error'
        console.error('[OpenAIRealtimeAdapter] error:', errMsg)
        // 2026-08-03 — this is the actual OpenAI Realtime protocol-level error event (e.g. a
        // rejected response.create sent while one was already in flight — see the doc comment on
        // the response.create call below this switch for a real, previously-suspected instance of
        // exactly that). Previously only reached onError (surfaced to the UI as a generic status,
        // not persisted to the per-session diagnostic timeline) — now also logged here so it lines
        // up directly against the transcript/tool_call timeline for the next live test call.
        this.config.onDiagnostic?.('realtime_error', { message: errMsg, code: err?.code ?? null, errorType: err?.type ?? null })
        this.config.onError(errMsg)
        break
      }

      default:
        // 2026-08-02 — TEMPORARY diagnostic: surfaces any event type this adapter doesn't
        // otherwise act on (e.g. input_audio_buffer.speech_stopped, .committed) so a live test
        // call shows what actually happened during a mystery gap, instead of it vanishing silently.
        this.config.onDiagnostic?.('unhandled_event', { type })
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
      this.flushPendingAiTranscriptIfDrained()
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
      if (this.gainNode && !this.hasFadedInFirstChunk) {
        this.hasFadedInFirstChunk = true
        const now = this.audioCtx.currentTime
        this.gainNode.gain.cancelScheduledValues(now)
        this.gainNode.gain.setValueAtTime(0, now)
        this.gainNode.gain.linearRampToValueAtTime(this.outputVol, now + 0.3)
      }
      src.onended = () => void this.drainQueue()
      src.start()
    } catch {
      await this.drainQueue()
    }
  }

  /**
   * 2026-08-01 — 'playback_complete' gate mode's flush point. Called every time the playback
   * queue actually empties (drainQueue()'s own base case — the real "audio has finished playing"
   * signal, not just "transcript text arrived"). A no-op when nothing is pending, so it's always
   * safe to call unconditionally from drainQueue(). Split into its own method (rather than inlined)
   * so it's directly unit-testable without needing a real AudioContext/AudioBufferSourceNode.
   */
  private flushPendingAiTranscriptIfDrained() {
    if (this.pendingAiTranscript === null) return
    const text = this.pendingAiTranscript
    this.pendingAiTranscript = null
    this.config.onMessage(text, 'ai')
  }

  // Matches HumeAdapter's clearAudioQueue() exactly: drops queued-but-not-yet-started chunks,
  // does not stop audio already mid-flight. Same interruption contract, not reinterpreted.
  //
  // 2026-08-01 — also discards (never fires) any pendingAiTranscript. An interruption means the
  // participant started talking over Clio mid-response — the phrase-match this transcript was
  // being held for was never actually heard in full, so firing it later (once whatever chunk is
  // still mid-flight eventually calls drainQueue() again and hits the now-empty queue) would
  // trigger a page advance off audio that was cut short. Only meaningful under
  // transcriptGateMode: 'playback_complete' — a no-op otherwise, since pendingAiTranscript is
  // never set in 'immediate' mode.
  private clearAudioQueue() {
    this.audioQueue = []
    this.isPlaying = false
    this.pendingAiTranscript = null
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

  /**
   * B2B item 6 (2026-08-02) — silence-after-a-turn safety net. Unlike sendWrapUpNudge (amends
   * session instructions for the model's own next natural turn, no immediate effect),
   * this forces an immediate response: a system-role conversation item followed by an explicit
   * response.create, so the model proactively speaks up (e.g. the graceful audio-issue closing)
   * instead of continuing to wait on a participant who may not be there.
   */
  triggerRecoveryNudge(instructionText: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: instructionText }] },
      }))
      this.ws.send(JSON.stringify({ type: 'response.create' }))
      return true
    } catch (err) {
      console.warn('[OpenAIRealtimeAdapter] triggerRecoveryNudge failed:', err)
      return false
    }
  }

  /**
   * 2026-08-01 — Arun: "only after it greets [says goodbye] should [end_session] trigger."
   * Root cause found: the shared prompt's own rule 8/13 already tell Clio to speak a goodbye and
   * call end_session "immediately after, in the same turn" — but this method used to tear down
   * audio synchronously the instant the tool call resolved, via clearAudioQueue() (drops
   * not-yet-started chunks) followed immediately by audioCtx.close() (which stops ALL audio
   * rendering, including whatever chunk was already mid-playback, contrary to clearAudioQueue's
   * own "does not stop audio already mid-flight" doc comment — audioCtx.close() overrode that).
   * Net effect: Clio's spoken goodbye was getting cut off mid-sentence, or never finishing, every
   * time — end_session was tearing down audio output before the goodbye had actually finished
   * PLAYING, even though the model had already finished GENERATING it.
   *
   * Fix: no longer clears the queue — waits for it to drain naturally (waitForPlaybackToFinish())
   * before closing anything, so the goodbye (or whatever was queued) plays out in full first.
   * Bounded by a timeout so a stuck/never-draining queue can't hang teardown indefinitely.
   */
  async endSession(): Promise<void> {
    this.intentionalClose = true
    this.stopMicCapture()
    // 2026-08-02 — wait for the server to confirm the ENTIRE response containing the goodbye (and
    // the end_session call) has actually finished generating — see responseInFlight's doc comment
    // above for the exact gap this closes — THEN wait for whatever arrived to finish playing
    // locally, exactly as before.
    await this.waitForResponseDone()
    await this.waitForPlaybackToFinish()
    this.ws?.close()
    try { await this.audioCtx?.close() } catch { /* noop */ }
  }

  /** See responseInFlight's doc comment above. Resolves immediately if no response is in flight. */
  private waitForResponseDone(timeoutMs = 8000): Promise<void> {
    if (!this.responseInFlight) return Promise.resolve()
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      this.responseDoneWaiters.push(finish)
      setTimeout(finish, timeoutMs)
    })
  }

  private resolveResponseDoneWaiters(): void {
    const waiters = this.responseDoneWaiters
    this.responseDoneWaiters = []
    for (const resolve of waiters) resolve()
  }

  /**
   * B2B-61 round 3 — VoiceSessionAdapter.waitForPlaybackCaughtUp() implementation. Same underlying
   * mechanism endSession()'s goodbye fix already relies on (waitForPlaybackToFinish()), exposed
   * publicly so PartnerRenderClient.tsx's advance_tab tool handler can await actual local playback
   * before executing a tool-call-triggered page move — closing the gap where the model's tool call
   * could arrive before the corresponding audio has actually finished playing.
   */
  waitForPlaybackCaughtUp(): Promise<void> {
    return this.waitForPlaybackToFinish()
  }

  /** See endSession()'s doc comment. Resolves immediately if nothing is queued/playing. */
  private waitForPlaybackToFinish(timeoutMs = 8000): Promise<void> {
    if (!this.isPlaying && this.audioQueue.length === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const start = Date.now()
      const check = () => {
        if ((!this.isPlaying && this.audioQueue.length === 0) || Date.now() - start > timeoutMs) {
          resolve()
          return
        }
        setTimeout(check, 100)
      }
      check()
    })
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
