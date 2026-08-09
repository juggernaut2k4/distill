import { createSupabaseAdminClient } from '@/lib/supabase'
import { decryptOutboundToken } from '@/lib/partner/crypto'
import type { StoredTranscriptTurn } from './openai-realtime-transcript-store'

const SINGLETON_ID = '00000000-0000-0000-0000-000000000001'

interface ElevenLabsTranscriptTurn {
  role?: 'user' | 'agent' | string
  time_in_call_secs?: number
  message?: string | null
}

interface ElevenLabsConversationResponse {
  status?: string
  transcript?: ElevenLabsTranscriptTurn[]
}

/**
 * B2B-76 §1.4 — item 4: native ElevenLabs post-call transcript fetch.
 *
 * A DISCLOSED, DELIBERATE REVERSAL of B2B-75 §6.9's original decision, which explicitly considered
 * and rejected `GET /v1/convai/conversations/{conversation_id}` in favour of the existing Redis
 * live-capture path (lib/voice/openai-realtime-transcript-store.ts, B2B-63), for two stated reasons:
 * the post-call availability delay couldn't be verified, and live capture was already proven. Arun
 * asked for the native fetch directly in B2B-76 — that overrides the prior call, but the original
 * risk (unverified availability delay) is carried forward here, not silently dropped: this function
 * bounds its own wait and NEVER blocks extraction on the native fetch indefinitely (see below).
 *
 * ADDITIVE, not a replacement — inngest/partner-session-insights-extractor.ts's ElevenLabs branch
 * calls this FIRST and falls back to the proven Redis live-capture path if it returns null. The
 * widget's live pill/diagnostics (a different consumer entirely, still in-call) keep reading Redis
 * unconditionally — this module is only ever invoked post-session, from the extractor.
 *
 * Confirmed shape (elevenlabs-docs, live-doc-verified this session — B2B-76 §0/§1.4):
 * `GET https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}`, header `xi-api-key`
 * (inferred-by-pattern from every sibling convai endpoint, not page-verbatim for this specific
 * endpoint — noted honestly, not overclaimed, matching app/api/elevenlabs-token/route.ts's own
 * convention for the same header). Response includes `transcript` (array of
 * `{ role: 'user'|'agent', time_in_call_secs, message, ... }`) plus `status`, `has_audio`, etc.
 *
 * Credential handling mirrors app/api/elevenlabs-token/route.ts EXACTLY — same singleton row
 * (`system_voice_config.elevenlabs_api_key_ciphertext`), same `decryptOutboundToken()` call. No
 * second decryption path is introduced.
 */

/**
 * 2026-08-09 — TEMPORARY, one-off debug helper for the same `debug-widget-session` route as
 * `fetchElevenLabsNativeTranscript`. Fetches the RAW conversation record and returns
 * `conversation_initiation_client_data.conversation_config_override.agent.prompt.prompt` — the
 * actual per-session prompt text this codebase sent via `overrides.agent.prompt.prompt` at
 * `Conversation.startSession()` time (elevenlabs-adapter.ts), as ElevenLabs itself recorded it.
 * Distinct from `fetchElevenLabsNativeTranscript`, which only reads `transcript`/`status` — this is
 * the one field neither that function nor any other code path in this app currently exposes. Single
 * attempt, no retry loop (unlike the transcript fetch): this is an on-demand manual lookup, not part
 * of the automated post-call extraction pipeline. NEVER THROWS — returns null on any failure.
 */
export async function fetchElevenLabsConversationPromptOverride(conversationId: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient()

  const { data, error } = await supabase
    .from('system_voice_config')
    .select('elevenlabs_api_key_ciphertext')
    .eq('id', SINGLETON_ID)
    .maybeSingle()

  if (error || !data) return null

  const ciphertext = (data as { elevenlabs_api_key_ciphertext: string | null }).elevenlabs_api_key_ciphertext
  const apiKey = decryptOutboundToken(ciphertext)
  if (!apiKey) return null

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'GET', headers: { 'xi-api-key': apiKey }, cache: 'no-store' }
    )
    if (!res.ok) return null

    const parsed = (await res.json().catch(() => null)) as {
      conversation_initiation_client_data?: {
        conversation_config_override?: { agent?: { prompt?: { prompt?: string | null } } }
      }
    } | null

    return parsed?.conversation_initiation_client_data?.conversation_config_override?.agent?.prompt?.prompt ?? null
  } catch {
    return null
  }
}

const FETCH_ATTEMPTS = 3
// Delay BEFORE attempt 2 and attempt 3, respectively. The post-call availability delay is
// unverified anywhere in ElevenLabs' docs (B2B-76 §0) — this is a bounded, conservative guess, not
// a documented number. Deliberately short: this runs synchronously inside the single
// `step.run('extract-partner-insights', ...)` step that wraps the whole extraction
// (inngest/partner-session-insights-extractor.ts), so a long inner wait would just make that one
// step run longer, not retry more sanely — bounding it keeps the added latency modest (≤6s) and
// guarantees a Redis fallback is always still reachable within Inngest's own function timeout.
const RETRY_DELAY_MS = [2000, 4000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetches and normalizes ElevenLabs' native post-call transcript for one conversation.
 *
 * NEVER THROWS. Every failure mode (credentials not configured, decryption failure, network error,
 * non-2xx response, transcript not yet present after all attempts) returns `null` so the caller can
 * fall back to Redis. This is deliberate: the caller wraps the ENTIRE extraction pipeline in one
 * Inngest step, so a throw here would trigger Inngest's own step-level retry (the extractor
 * functions are `retries: 3`) on top of this function's own internal retry loop — two retry layers
 * stacking unpredictably. Bounding the retry here and returning null keeps exactly one retry
 * policy in play for this concern.
 */
export async function fetchElevenLabsNativeTranscript(conversationId: string): Promise<StoredTranscriptTurn[] | null> {
  const supabase = createSupabaseAdminClient()

  const { data, error } = await supabase
    .from('system_voice_config')
    .select('elevenlabs_api_key_ciphertext')
    .eq('id', SINGLETON_ID)
    .maybeSingle()

  if (error || !data) {
    console.error('[elevenlabs-native-transcript] Could not read system_voice_config — falling back to Redis:', error?.message)
    return null
  }

  const ciphertext = (data as { elevenlabs_api_key_ciphertext: string | null }).elevenlabs_api_key_ciphertext
  if (!ciphertext) {
    console.error('[elevenlabs-native-transcript] ElevenLabs credentials not configured — falling back to Redis')
    return null
  }

  const apiKey = decryptOutboundToken(ciphertext)
  if (!apiKey) {
    console.error('[elevenlabs-native-transcript] Stored ElevenLabs credential could not be decrypted — falling back to Redis')
    return null
  }

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS[attempt - 1])

    let res: Response
    try {
      res = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
        { method: 'GET', headers: { 'xi-api-key': apiKey }, cache: 'no-store' }
      )
    } catch (err) {
      console.error(
        `[elevenlabs-native-transcript] Attempt ${attempt + 1}/${FETCH_ATTEMPTS} request failed for conversation ${conversationId}:`,
        err instanceof Error ? err.message : err
      )
      continue
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(
        `[elevenlabs-native-transcript] Attempt ${attempt + 1}/${FETCH_ATTEMPTS} non-2xx for conversation ${conversationId}:`,
        res.status, body
      )
      continue
    }

    const parsed = (await res.json().catch(() => null)) as ElevenLabsConversationResponse | null
    const rawTranscript = parsed?.transcript

    if (!Array.isArray(rawTranscript) || rawTranscript.length === 0) {
      console.log(
        `[elevenlabs-native-transcript] Attempt ${attempt + 1}/${FETCH_ATTEMPTS}: transcript not yet available for conversation ${conversationId} (status=${parsed?.status ?? 'unknown'})`
      )
      continue
    }

    const turns: StoredTranscriptTurn[] = rawTranscript
      .map((t, i) => ({
        source: (t.role === 'user' ? 'user' : 'ai') as 'user' | 'ai',
        text: (t.message ?? '').trim(),
        at: typeof t.time_in_call_secs === 'number' ? t.time_in_call_secs * 1000 : i,
      }))
      .filter((t) => t.text.length > 0)

    if (turns.length === 0) {
      // Transcript array present but every turn had empty/whitespace-only text (e.g. tool-call-only
      // turns) — treat as "not usable content" and let the loop's own exhaustion path fall back to
      // Redis rather than returning an empty array that would be indistinguishable from "call had no
      // speech at all" further downstream.
      console.log(`[elevenlabs-native-transcript] Attempt ${attempt + 1}/${FETCH_ATTEMPTS}: transcript present but no usable turns for conversation ${conversationId}`)
      continue
    }

    return turns
  }

  console.error(`[elevenlabs-native-transcript] All ${FETCH_ATTEMPTS} attempts exhausted for conversation ${conversationId} — falling back to Redis`)
  return null
}
