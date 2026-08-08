import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { getStoredTranscriptTurns } from '@/lib/voice/openai-realtime-transcript-store'
import { getStoredDiagnosticEvents } from '@/lib/voice/openai-realtime-diagnostic-store'

/**
 * TEMPORARY — 2026-08-08, one-off manual read-back of the B2B-75 live test call's captured
 * transcript + diagnostics (Redis, 30-minute TTL). Read-only, reuses the existing
 * openai-realtime-transcript-store.ts / openai-realtime-diagnostic-store.ts stores unmodified —
 * no new Redis logic. `requireSuperAdmin()`-gated, same as every other route under app/api/admin/.
 * Remove this route once the B2B-75 first-call review is done.
 */
export async function GET(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const sessionRef = request.nextUrl.searchParams.get('session_ref')
  if (!sessionRef) {
    return NextResponse.json({ error: 'session_ref query param required' }, { status: 400 })
  }

  const [transcript, diagnostics] = await Promise.all([
    getStoredTranscriptTurns(sessionRef),
    getStoredDiagnosticEvents(sessionRef),
  ])

  return NextResponse.json({ sessionRef, transcript, diagnostics })
}
