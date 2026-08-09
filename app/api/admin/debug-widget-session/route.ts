import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { getStoredTranscriptTurns } from '@/lib/voice/openai-realtime-transcript-store'
import { getStoredDiagnosticEvents } from '@/lib/voice/openai-realtime-diagnostic-store'
import { fetchElevenLabsConversationPromptOverride } from '@/lib/voice/elevenlabs-native-transcript'

/**
 * TEMPORARY — 2026-08-08, one-off manual read-back of the B2B-75 live test call's captured
 * transcript + diagnostics (Redis, 30-minute TTL). Read-only, reuses the existing
 * openai-realtime-transcript-store.ts / openai-realtime-diagnostic-store.ts stores unmodified —
 * no new Redis logic. Remove this route once the B2B-75 first-call review is done.
 *
 * Two accepted credentials, either is sufficient:
 *  - `requireSuperAdmin()` (Arun's own Clerk login), unchanged from the original version.
 *  - `x-admin-secret` header matching `ORCHESTRATOR_DEBUG_SECRET`, mirroring the exact
 *    `x-admin-secret`-vs-`ADMIN_SECRET` pattern already used by
 *    app/api/admin/delivery-health/route.ts and app/api/admin/clear-topic-cache/[topicId]/route.ts.
 *    A SEPARATE secret from the shared `ADMIN_SECRET` (not reused) — narrower blast radius, since
 *    this route is read-only debug data, not the shared operational-admin credential every other
 *    x-admin-secret route trusts. Self-minted (generated and written directly to the Vercel env by
 *    the orchestrator, never read back) precisely because Vercel's "Sensitive" env var flag makes
 *    existing secrets like `ADMIN_SECRET` write-only after the fact — this route needed a credential
 *    the orchestrator could actually authenticate with itself, not one only readable from a live
 *    Clerk browser session.
 */
function hasOrchestratorDebugSecret(request: NextRequest): boolean {
  const secret = process.env.ORCHESTRATOR_DEBUG_SECRET
  if (!secret) return false
  return request.headers.get('x-admin-secret') === secret
}

export async function GET(request: NextRequest) {
  if (!hasOrchestratorDebugSecret(request)) {
    const admin = await requireSuperAdmin()
    if (admin.error) return admin.error
  }

  const sessionRef = request.nextUrl.searchParams.get('session_ref')
  if (!sessionRef) {
    return NextResponse.json({ error: 'session_ref query param required' }, { status: 400 })
  }

  const conversationId = request.nextUrl.searchParams.get('elevenlabs_conversation_id')

  const [transcript, diagnostics, elevenlabsPromptOverride] = await Promise.all([
    getStoredTranscriptTurns(sessionRef),
    getStoredDiagnosticEvents(sessionRef),
    conversationId ? fetchElevenLabsConversationPromptOverride(conversationId) : Promise.resolve(null),
  ])

  return NextResponse.json({ sessionRef, transcript, diagnostics, elevenlabsPromptOverride })
}
