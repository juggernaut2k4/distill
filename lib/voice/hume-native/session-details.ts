/**
 * HUME-NATIVE-01 — Config lifecycle consolidation: permanent, durable-first
 * read capability for "what were this session's exact Config details and
 * full transcript."
 *
 * Per docs/specs/HUME-NATIVE-01-config-lifecycle-consolidation-requirement-doc.md
 * Section 4.2. Archive-first, live-fallback: checks `sessions.hume_config_archived_at`
 * — if set, reads the durable copy from `hume_native_config_archives` (written by
 * inngest/hume-native-nightly-cleanup.ts before that job deletes the Hume-side
 * Config); if not yet archived, falls back to a live Hume API call, reusing the
 * exact fetch pattern already proven in config-provisioner.ts's
 * getExistingConfig() and the nightly job's transcript pagination loop.
 *
 * Read-only in both branches: never writes to hume_native_config_archives,
 * never sets hume_config_archived_at, never calls DELETE on any Hume Config.
 * Zero interaction with the nightly job's write path — purely a downstream
 * consumer of data the nightly job (or Hume itself) already has.
 */

import { createSupabaseAdminClient } from '@/lib/supabase'

const HUME_CONFIGS_URL = 'https://api.hume.ai/v0/evi/configs'
const HUME_CHATS_URL = 'https://api.hume.ai/v0/evi/chats'

export interface HumeSessionDetailsResult {
  sessionId: string
  source: 'archive' | 'live'
  configSnapshot: Record<string, unknown>
  transcriptEvents: unknown[]
  humeConfigId: string
  humeChatId: string
  archivedAt: string | null // ISO timestamp if source === 'archive', else null
}

export type HumeSessionDetailsError =
  | { code: 'session_not_found'; message: string }
  | { code: 'not_eligible_no_hume_ids'; message: string }
  | { code: 'live_fetch_failed'; message: string; humeStatus?: number }
  | { code: 'live_fetch_config_deleted'; message: string }

/**
 * Wraps a HumeSessionDetailsError so callers can catch a single typed error
 * class and read `.detail` for the structured code/message/humeStatus.
 */
export class HumeSessionDetailsLookupError extends Error {
  readonly detail: HumeSessionDetailsError

  constructor(detail: HumeSessionDetailsError) {
    super(detail.message)
    this.name = 'HumeSessionDetailsLookupError'
    this.detail = detail
  }
}

/**
 * Fetches one page of transcript events for a Hume chat, reusing the exact
 * pagination shape already proven in inngest/hume-native-nightly-cleanup.ts.
 * Extracted here as a small shared helper rather than duplicating the loop a
 * third time (per the requirement doc's Section 12 dependency note).
 */
async function fetchAllTranscriptEvents(apiKey: string, chatId: string): Promise<unknown[]> {
  const transcriptEvents: unknown[] = []
  let pageNumber = 0
  let hasMore = true

  while (hasMore) {
    const eventsRes = await fetch(
      `${HUME_CHATS_URL}/${chatId}/events?page_size=100&page_number=${pageNumber}`,
      {
        method: 'GET',
        headers: { 'X-Hume-Api-Key': apiKey },
      }
    )

    if (!eventsRes.ok) {
      const errBody = await eventsRes.text().catch(() => '(unreadable response body)')
      throw new HumeSessionDetailsLookupError({
        code: 'live_fetch_failed',
        message: `Failed to fetch transcript page ${pageNumber} for chat ${chatId}: status ${eventsRes.status}: ${errBody}`,
        humeStatus: eventsRes.status,
      })
    }

    const page = (await eventsRes.json()) as {
      events_page?: unknown[]
      page_number?: number
      total_pages?: number
    }

    const pageEvents = page.events_page ?? []
    transcriptEvents.push(...pageEvents)

    const totalPages = page.total_pages ?? 1
    pageNumber++
    hasMore = pageNumber < totalPages && pageEvents.length > 0
  }

  return transcriptEvents
}

/**
 * Returns the full Config details and transcript for a given session, sourced
 * from the durable archive if available, falling back to a live Hume API call
 * otherwise. Throws HumeSessionDetailsLookupError (wrapping one of the codes
 * in HumeSessionDetailsError) on failure — callers (including the route
 * wrapper) must catch and translate to their own response shape.
 */
export async function getHumeSessionDetails(
  sessionId: string
): Promise<HumeSessionDetailsResult> {
  const supabase = createSupabaseAdminClient()

  // Step 1: look up the session's Hume identifiers + archive status.
  const sessionResult = await supabase
    .from('sessions')
    .select('id, hume_native_config_id, hume_chat_id, hume_config_archived_at')
    .eq('id', sessionId)
    .maybeSingle()

  if (sessionResult.error) {
    throw new HumeSessionDetailsLookupError({
      code: 'session_not_found',
      message: `Failed to look up session ${sessionId}: ${sessionResult.error.message}`,
    })
  }

  const session = sessionResult.data as
    | {
        id: string
        hume_native_config_id: string | null
        hume_chat_id: string | null
        hume_config_archived_at: string | null
      }
    | null

  if (!session) {
    throw new HumeSessionDetailsLookupError({
      code: 'session_not_found',
      message: `No session with id ${sessionId}`,
    })
  }

  // Step 2: eligibility precondition (same one the nightly job's own
  // eligibility query relies on — reused for consistency, not reinvented).
  if (!session.hume_native_config_id || !session.hume_chat_id) {
    throw new HumeSessionDetailsLookupError({
      code: 'not_eligible_no_hume_ids',
      message: `Session ${sessionId} has no Hume config/chat id — native mode was never provisioned or never connected`,
    })
  }

  const humeConfigId = session.hume_native_config_id
  const humeChatId = session.hume_chat_id

  // Step 3: archive-first — if the nightly job has already processed this
  // session, read the durable copy and never touch the live Hume API.
  if (session.hume_config_archived_at) {
    const archiveResult = await supabase
      .from('hume_native_config_archives')
      .select('config_snapshot, transcript_events, hume_config_id, hume_chat_id, archived_at')
      .eq('session_id', sessionId)
      .order('archived_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (archiveResult.error) {
      throw new HumeSessionDetailsLookupError({
        code: 'live_fetch_failed',
        message: `Failed to read archive row for session ${sessionId}: ${archiveResult.error.message}`,
      })
    }

    if (archiveResult.data) {
      const archive = archiveResult.data as {
        config_snapshot: Record<string, unknown>
        transcript_events: unknown[]
        hume_config_id: string
        hume_chat_id: string
        archived_at: string
      }

      return {
        sessionId,
        source: 'archive',
        configSnapshot: archive.config_snapshot,
        transcriptEvents: archive.transcript_events,
        humeConfigId: archive.hume_config_id,
        humeChatId: archive.hume_chat_id,
        archivedAt: archive.archived_at,
      }
    }

    // Defensive fallback: hume_config_archived_at was set but no archive row
    // exists (should never happen given the nightly job's insert-before-mark
    // ordering). Fall through to the live path rather than erroring, since
    // the live Config may still exist.
    console.warn(
      `[hume-native/session-details] hume_config_archived_at set for session ${sessionId} but no archive row found — falling back to live fetch`
    )
  }

  // Step 4: live fallback.
  const apiKey = process.env.HUME_API_KEY
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
    throw new HumeSessionDetailsLookupError({
      code: 'live_fetch_failed',
      message: 'HUME_API_KEY is not configured — cannot perform live fallback fetch',
    })
  }

  const configRes = await fetch(`${HUME_CONFIGS_URL}/${humeConfigId}`, {
    method: 'GET',
    headers: { 'X-Hume-Api-Key': apiKey },
  })

  if (configRes.status === 404) {
    throw new HumeSessionDetailsLookupError({
      code: 'live_fetch_config_deleted',
      message: `Config ${humeConfigId} not found on Hume and no archive exists for session ${sessionId} — data is unavailable`,
    })
  }

  if (!configRes.ok) {
    const errBody = await configRes.text().catch(() => '(unreadable response body)')
    throw new HumeSessionDetailsLookupError({
      code: 'live_fetch_failed',
      message: `Failed to fetch live Config ${humeConfigId} for session ${sessionId}: status ${configRes.status}: ${errBody}`,
      humeStatus: configRes.status,
    })
  }

  const configSnapshot = (await configRes.json()) as Record<string, unknown>

  const transcriptEvents = await fetchAllTranscriptEvents(apiKey, humeChatId)

  return {
    sessionId,
    source: 'live',
    configSnapshot,
    transcriptEvents,
    humeConfigId,
    humeChatId,
    archivedAt: null,
  }
}
