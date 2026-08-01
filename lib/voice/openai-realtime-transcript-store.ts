import { Redis } from '@upstash/redis'

/**
 * B2B-63 — live transcript capture for OpenAI Realtime sessions, since OpenAI has no post-hoc
 * transcript API at all. See docs/specs/B2B-63-requirement-document.md §6/§11 for full reasoning.
 */

const TRANSCRIPT_TTL_SECONDS = 60 * 60 * 24 // 24 hours — see Requirement Doc §11 Q3 for reasoning

export interface StoredTranscriptTurn {
  source: 'user' | 'ai'
  text: string
  at: number // server-side Date.now() at capture time, ms epoch — diagnostic only, not used for ordering
}

function transcriptKey(clioSessionRef: string): string {
  return `voice-transcript:${clioSessionRef}`
}

// 2026-08-01 — found while walking through Vercel Marketplace setup: @upstash/redis's own
// Redis.fromEnv() already falls back from UPSTASH_REDIS_REST_URL/TOKEN to KV_REST_API_URL/TOKEN
// (confirmed by direct read of node_modules/@upstash/redis/nodejs.js's fromEnv() implementation —
// "compatibility with Vercel KV and other platforms that may use different naming conventions").
// The actual Vercel Marketplace product for this ("Upstash for Redis", slug upstash/upstash-kv)
// provisions the KV_REST_API_URL/KV_REST_API_TOKEN names, not the UPSTASH_ ones. This guard must
// check the SAME two name pairs the SDK itself accepts, or a correctly-installed integration would
// still look like "missing credentials" here and silently stay in mock mode forever.
const resolvedUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const resolvedToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN

const isPlaceholder =
  !resolvedUrl || !resolvedToken || resolvedUrl.startsWith('PLACEHOLDER') || resolvedToken.startsWith('PLACEHOLDER')

const redis = isPlaceholder ? null : Redis.fromEnv()

/** Best-effort append — NEVER throws (Requirement Doc §11 Q5). Called from the
 *  transcript-capture API route, once per completed spoken turn. */
export async function appendTranscriptTurn(
  clioSessionRef: string,
  source: 'user' | 'ai',
  text: string
): Promise<void> {
  if (isPlaceholder || !redis) {
    console.log(`[MOCK openai-realtime-transcript-store] would append ${source} turn for session ${clioSessionRef}`)
    return
  }
  const turn: StoredTranscriptTurn = { source, text, at: Date.now() }
  try {
    const key = transcriptKey(clioSessionRef)
    await redis.pipeline().rpush(key, turn).expire(key, TRANSCRIPT_TTL_SECONDS).exec()
  } catch (err) {
    console.error(
      `[openai-realtime-transcript-store] Failed to append transcript turn for session ${clioSessionRef} (non-fatal):`,
      err instanceof Error ? err.message : err
    )
  }
}

/** Non-destructive read-back, in chronological order (list append order = spoken order).
 *  Returns [] if the key doesn't exist, credentials are placeholders, or the read fails —
 *  extraction's own empty-transcript branch (already exists for Hume) handles all three
 *  identically, so this function deliberately never throws for a missing/empty key. A genuine
 *  Redis-layer failure DOES throw, so Inngest's existing step-retry semantics apply exactly as
 *  they already do for a Hume API fetch failure — see Requirement Doc §8. */
export async function getStoredTranscriptTurns(clioSessionRef: string): Promise<StoredTranscriptTurn[]> {
  if (isPlaceholder || !redis) return []
  const raw = await redis.lrange<StoredTranscriptTurn>(transcriptKey(clioSessionRef), 0, -1)
  return raw ?? []
}

/** Best-effort delete after successful extraction — NEVER throws (Requirement Doc §11 Q3). */
export async function deleteStoredTranscript(clioSessionRef: string): Promise<void> {
  if (isPlaceholder || !redis) return
  try {
    await redis.del(transcriptKey(clioSessionRef))
  } catch (err) {
    console.error(
      `[openai-realtime-transcript-store] Failed to delete transcript for session ${clioSessionRef} (non-fatal, TTL will clean it up):`,
      err instanceof Error ? err.message : err
    )
  }
}

/** Mirrors formatTranscriptLines()'s exact speaker labels and blank-skip behavior
 *  (inngest/hume-action-item-extractor.ts lines 156-174), so downstream Claude-calling code
 *  (inngest/partner-session-insights-extractor.ts) sees byte-identical input shape regardless
 *  of which voice provider a session used. */
export function formatOpenAITranscriptLines(turns: StoredTranscriptTurn[]): string[] {
  const lines: string[] = []
  for (const turn of turns) {
    const text = turn.text?.trim()
    if (!text) continue
    const speaker = turn.source === 'user' ? 'User' : 'Clio'
    lines.push(`${speaker}: ${text}`)
  }
  return lines
}
