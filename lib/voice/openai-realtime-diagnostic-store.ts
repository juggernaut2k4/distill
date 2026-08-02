import { Redis } from '@upstash/redis'

/**
 * TEMPORARY — 2026-08-02. Diagnosing why a live test call (session 2aede0c7...) showed no captured
 * user response right before an early, narrated-not-spoken close (see
 * docs/2026-08-02-farewell-narration-findings.md §8/§9). The CEO agent's root-cause read: the model
 * reasons over raw audio directly (semantic_vad), independent of whether transcription ever
 * completes — a brief/quiet utterance could be received and acted on while producing an EMPTY
 * `conversation.item.input_audio_transcription.completed` event, which today is silently dropped
 * (see openai-realtime-adapter.ts). This store captures that dropped case, plus any otherwise-
 * unhandled Realtime event type (e.g. `input_audio_buffer.speech_stopped`, `.committed`), for the
 * next live test call.
 *
 * Deliberately a SEPARATE Redis key/store from openai-realtime-transcript-store.ts — never mixed
 * into the real transcript, which feeds the extraction pipeline. Remove this whole file, its
 * capture route, and the onDiagnostic wiring once issues #2/#3 in the findings doc are resolved and
 * no longer need live diagnosis.
 */

const DIAGNOSTIC_TTL_SECONDS = 60 * 30 // matches the transcript store's own temporary debugging TTL

export interface StoredDiagnosticEvent {
  label: string
  detail: Record<string, unknown>
  at: number // server-side Date.now() at capture time, ms epoch
}

function diagnosticKey(clioSessionRef: string): string {
  return `voice-diagnostic:${clioSessionRef}`
}

const resolvedUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const resolvedToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
const isPlaceholder =
  !resolvedUrl || !resolvedToken || resolvedUrl.startsWith('PLACEHOLDER') || resolvedToken.startsWith('PLACEHOLDER')
const redis = isPlaceholder ? null : Redis.fromEnv()

/** Best-effort append — never throws, mirrors appendTranscriptTurn's own contract. */
export async function appendDiagnosticEvent(
  clioSessionRef: string,
  label: string,
  detail: Record<string, unknown>
): Promise<void> {
  if (isPlaceholder || !redis) {
    console.log(`[MOCK openai-realtime-diagnostic-store] would append "${label}" for session ${clioSessionRef}`)
    return
  }
  const event: StoredDiagnosticEvent = { label, detail, at: Date.now() }
  try {
    const key = diagnosticKey(clioSessionRef)
    await redis.pipeline().rpush(key, event).expire(key, DIAGNOSTIC_TTL_SECONDS).exec()
  } catch (err) {
    console.error(
      `[openai-realtime-diagnostic-store] Failed to append diagnostic event for session ${clioSessionRef} (non-fatal):`,
      err instanceof Error ? err.message : err
    )
  }
}

/** Non-destructive read-back, chronological order. Returns [] on any absence/failure. */
export async function getStoredDiagnosticEvents(clioSessionRef: string): Promise<StoredDiagnosticEvent[]> {
  if (isPlaceholder || !redis) return []
  const raw = await redis.lrange<StoredDiagnosticEvent>(diagnosticKey(clioSessionRef), 0, -1)
  return raw ?? []
}
