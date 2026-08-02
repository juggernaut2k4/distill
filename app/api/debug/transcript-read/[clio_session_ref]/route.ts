import { NextRequest, NextResponse } from 'next/server'
import { getStoredTranscriptTurns } from '@/lib/voice/openai-realtime-transcript-store'

// TEMP DEBUG ROUTE — 2026-08-02. Arun ran the first live test call after tonight's items 3/4/5/6/7
// build and reported 3 issues (warm-up not working, icebreaker not waiting for a response, early
// disconnect before the overview). Reading the stored transcript to investigate whether the new
// silence-timer (item 6) is the cause. Read-only, requires the exact session UUID (not
// enumerable), no other data touched. Remove once this specific transcript has been reviewed.
export async function GET(_request: NextRequest, { params }: { params: { clio_session_ref: string } }) {
  const turns = await getStoredTranscriptTurns(params.clio_session_ref)
  return NextResponse.json({ turns })
}
