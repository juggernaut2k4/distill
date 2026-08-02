import { NextRequest, NextResponse } from 'next/server'
import { getStoredTranscriptTurns } from '@/lib/voice/openai-realtime-transcript-store'
import { getStoredDiagnosticEvents } from '@/lib/voice/openai-realtime-diagnostic-store'

// TEMP DEBUG ROUTE — 2026-08-02. Arun reported the same issue after the onSpeakVerified fix
// (docs/2026-08-02-farewell-narration-findings.md §9). Reading both the transcript and the new
// temporary diagnostic events for this session. Read-only, requires the exact session UUID (not
// enumerable), no other data touched. Remove once this specific transcript has been reviewed.
export async function GET(_request: NextRequest, { params }: { params: { clio_session_ref: string } }) {
  const [turns, diagnostics] = await Promise.all([
    getStoredTranscriptTurns(params.clio_session_ref),
    getStoredDiagnosticEvents(params.clio_session_ref),
  ])
  return NextResponse.json({ turns, diagnostics })
}
