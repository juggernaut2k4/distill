import type { VoiceSessionAdapter } from './adapter'

export interface HumeAdapterConfig {
  accessToken: string
  configId: string
  userId: string
  mediaStream: MediaStream
  onConnect: (sessionId: string) => void
  onDisconnect: () => void
  onError: (message: string) => void
  onModeChange: (mode: 'listening' | 'speaking') => void
  onMessage: (text: string, source: 'user' | 'ai') => void
  tools: Record<string, (params: Record<string, unknown>) => Promise<string>>
}

export class HumeAdapter implements VoiceSessionAdapter {
  private ws: WebSocket | null = null
  private sessionId = ''
  private audioCtx: AudioContext | null = null
  private gainNode: GainNode | null = null
  private mediaRecorder: MediaRecorder | null = null
  private audioQueue: ArrayBuffer[] = []
  private isPlaying = false
  private connected = false
  private outputVol = 1.0
  private config: HumeAdapterConfig
  private intentionalClose = false
  private reconnectAttempts = 0
  private static readonly MAX_RECONNECT = 3

  constructor(config: HumeAdapterConfig) {
    this.config = config
  }

  static async create(config: HumeAdapterConfig): Promise<HumeAdapter> {
    const adapter = new HumeAdapter(config)
    await adapter.openConnection()
    return adapter
  }

  private openConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.hume.ai/v0/evi/chat?access_token=${this.config.accessToken}&config_id=${this.config.configId}&evi_version=3&custom_session_id=${encodeURIComponent(this.config.userId)}`
      this.ws = new WebSocket(url)

      // Reuse existing AudioContext across reconnects — only create once
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext()
        this.gainNode = this.audioCtx.createGain()
        this.gainNode.gain.value = this.outputVol
        this.gainNode.connect(this.audioCtx.destination)
      }

      let resolved = false

      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        this.startMicCapture()
        if (!resolved) { resolved = true; resolve() }
      }

      this.ws.onerror = () => {
        if (!resolved) { resolved = true; reject(new Error('Hume WebSocket connection failed')) }
        else { this.config.onError('Hume connection error') }
      }

      this.ws.onclose = (event) => {
        this.connected = false
        this.stopMicCapture()

        if (this.intentionalClose) {
          this.config.onDisconnect()
          return
        }

        // Auth/policy error (code 1008) — retrying won't help
        if (event.code === 1008 || this.reconnectAttempts >= HumeAdapter.MAX_RECONNECT) {
          this.config.onError('Hume EVI WebSocket disconnected and could not reconnect')
          this.config.onDisconnect()
          return
        }

        // Exponential backoff: 1 s → 2 s → 4 s
        this.reconnectAttempts++
        const delay = Math.pow(2, this.reconnectAttempts - 1) * 1000
        console.warn(`[HumeAdapter] WS closed (code ${event.code}) — reconnect attempt ${this.reconnectAttempts}/${HumeAdapter.MAX_RECONNECT} in ${delay}ms`)
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
      case 'chat_metadata':
        this.sessionId = (msg.chat_id as string) ?? ''
        this.connected = true
        this.config.onConnect(this.sessionId)
        break

      case 'audio_output': {
        const data = msg.data as string | undefined
        if (!data || !this.audioCtx) break
        try {
          const raw = atob(data)
          const bytes = new Uint8Array(raw.length)
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
          await this.queueAudio(bytes.buffer)
        } catch { /* skip malformed audio */ }
        break
      }

      case 'assistant_message': {
        this.config.onModeChange('speaking')
        const msgObj = msg.message as { content?: string } | undefined
        const text = msgObj?.content ?? ''
        if (text) this.config.onMessage(text, 'ai')
        break
      }

      case 'assistant_end':
        this.config.onModeChange('listening')
        break

      case 'user_message': {
        const msgObj = msg.message as { content?: string } | undefined
        const text = msgObj?.content ?? ''
        if (text) this.config.onMessage(text, 'user')
        break
      }

      case 'user_interruption':
        this.clearAudioQueue()
        this.config.onModeChange('listening')
        break

      case 'tool_call': {
        const toolName = (msg.name as string) ?? ''
        const toolCallId = (msg.tool_call_id as string) ?? ''
        let params: Record<string, unknown> = {}
        try { params = JSON.parse((msg.parameters as string) ?? '{}') } catch { /* noop */ }

        let result = 'Tool executed.'
        const handler = this.config.tools[toolName]
        if (handler) {
          try { result = await handler(params) } catch { result = 'Tool execution failed.' }
        } else {
          console.warn('[HumeAdapter] No handler for tool:', toolName)
        }

        this.ws?.send(JSON.stringify({
          type: 'tool_response',
          tool_call_id: toolCallId,
          content: result,
        }))
        break
      }

      case 'error': {
        const errMsg = (msg.message as string) ?? 'Hume error'
        console.error('[HumeAdapter] error:', errMsg)
        this.config.onError(errMsg)
        break
      }

      default:
        break
    }
  }

  private startMicCapture() {
    if (!this.config.mediaStream || !this.ws) return
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    const recorder = new MediaRecorder(this.config.mediaStream, { mimeType })
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0 || this.ws?.readyState !== WebSocket.OPEN) return
      void e.data.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf)
        let b64 = ''
        for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i])
        this.ws?.send(JSON.stringify({ type: 'audio_input', data: btoa(b64) }))
      })
    }
    recorder.start(100)
    this.mediaRecorder = recorder
  }

  private stopMicCapture() {
    try { this.mediaRecorder?.stop() } catch { /* noop */ }
    this.mediaRecorder = null
  }

  private async queueAudio(buffer: ArrayBuffer) {
    this.audioQueue.push(buffer)
    if (!this.isPlaying) await this.drainQueue()
  }

  private async drainQueue() {
    if (!this.audioCtx || this.audioQueue.length === 0) {
      this.isPlaying = false
      return
    }
    this.isPlaying = true
    const buf = this.audioQueue.shift()!
    try {
      const decoded = await this.audioCtx.decodeAudioData(buf)
      const src = this.audioCtx.createBufferSource()
      src.buffer = decoded
      src.connect(this.gainNode ?? this.audioCtx.destination)
      src.onended = () => void this.drainQueue()
      src.start()
    } catch {
      await this.drainQueue()
    }
  }

  private clearAudioQueue() {
    this.audioQueue = []
    this.isPlaying = false
  }

  // ── VoiceSessionAdapter ───────────────────────────────────────────────────

  // Hume rejects `session_settings.system_prompt` with E0716 (WS close 1008)
  // whenever a custom LLM is configured — which this app always uses for Hume.
  // Context is delivered server-side via the custom LLM endpoint instead, so
  // this is intentionally a no-op for every caller (keep-alive, show_visual
  // split-mode, reconnect) rather than gating each call site individually.
  injectContext(_text: string): void {
    return
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
  sendFeedback(_like: boolean): void { /* Hume EVI doesn't expose a per-message feedback API */ }
  getId(): string { return this.sessionId }
  isOpen(): boolean { return this.connected && this.ws?.readyState === WebSocket.OPEN }
}
