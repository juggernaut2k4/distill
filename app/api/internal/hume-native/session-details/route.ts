import { NextRequest, NextResponse } from 'next/server'
import {
  getHumeSessionDetails,
  HumeSessionDetailsLookupError,
} from '@/lib/voice/hume-native/session-details'

export const dynamic = 'force-dynamic'

/**
 * Thin internal route wrapping getHumeSessionDetails() — the permanent,
 * durable-first read capability for a Hume-native session's Config details
 * and full transcript.
 *
 * Per docs/specs/HUME-NATIVE-01-config-lifecycle-consolidation-requirement-doc.md
 * Section 4.1. No auth gate (matches the existing app/api/debug/hume-chat/route.ts
 * precedent) — lives under /api/internal/ to signal "trusted server-side/
 * operator context only, not for browser/end-user traffic."
 *
 * GET /api/internal/hume-native/session-details?sessionId=<uuid>
 *
 * 200 -> HumeSessionDetailsResult (JSON). In the live-fallback branch, this
 *        can be a partial success: the Config fetch succeeded but the
 *        transcript fetch failed (e.g. stale/expired/never-started chat_id).
 *        In that case `transcriptEvents` is `[]` and `transcriptFetchError`
 *        is set on the body describing the transcript-specific failure —
 *        this is still a 200 since the requested Config data is present.
 * 400 -> { error: string }  (missing/malformed sessionId)
 * 404 -> { error: string }  (session_not_found, not_eligible_no_hume_ids)
 * 502 -> { error: string, humeStatus?: number }  (live_fetch_failed, live_fetch_config_deleted —
 *        both of these are Config-fetch failures; a transcript-only failure never reaches this path)
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing required query param: sessionId' }, { status: 400 })
  }

  try {
    const result = await getHumeSessionDetails(sessionId)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof HumeSessionDetailsLookupError) {
      const { code, message } = err.detail

      if (code === 'session_not_found' || code === 'not_eligible_no_hume_ids') {
        return NextResponse.json({ error: message }, { status: 404 })
      }

      // live_fetch_failed | live_fetch_config_deleted
      const humeStatus = 'humeStatus' in err.detail ? err.detail.humeStatus : undefined
      return NextResponse.json({ error: message, ...(humeStatus ? { humeStatus } : {}) }, { status: 502 })
    }

    // Unexpected/unclassified error — never crash uncaught.
    console.error('[api/internal/hume-native/session-details] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error looking up session details' }, { status: 500 })
  }
}
