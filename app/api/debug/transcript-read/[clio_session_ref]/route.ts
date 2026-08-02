import { NextRequest, NextResponse } from 'next/server'
import { getStoredTranscriptTurns } from '@/lib/voice/openai-realtime-transcript-store'
import { getStoredDiagnosticEvents } from '@/lib/voice/openai-realtime-diagnostic-store'

// TEMP DEBUG ROUTE — 2026-08-02. Arun ran a longer, more complete test call after disabling the
// silence timer and reported 6 new observations (double overview, silence at a page transition,
// generic non-response after answers, warm-up still not visibly working, missing per-topic
// summaries, freezing per page). Reading both the transcript and diagnostic events. Read-only,
// requires the exact session UUID (not enumerable). Remove once this session has been reviewed.
export async function GET(_request: NextRequest, { params }: { params: { clio_session_ref: string } }) {
  const [turns, diagnostics] = await Promise.all([
    getStoredTranscriptTurns(params.clio_session_ref),
    getStoredDiagnosticEvents(params.clio_session_ref),
  ])
  return NextResponse.json({ turns, diagnostics })
}
