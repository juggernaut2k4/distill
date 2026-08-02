import { NextRequest, NextResponse } from 'next/server'
import { getStoredTranscriptTurns } from '@/lib/voice/openai-realtime-transcript-store'

// TEMP DEBUG ROUTE — 2026-08-02. Arun asked to review the transcript of the OOP-fundamentals test
// call, verifying the B2B-68/B2B-69 single-document OpenAI prompt rebuild's farewell behavior. The
// raw transcript only exists transiently in Redis (30-min TTL, see
// lib/voice/openai-realtime-transcript-store.ts) since OpenAI Realtime has no post-hoc transcript
// API — there was no existing read path for it. Read-only, requires the exact session UUID (not
// enumerable), no other data touched. Remove once this specific transcript has been reviewed.
export async function GET(_request: NextRequest, { params }: { params: { clio_session_ref: string } }) {
  const turns = await getStoredTranscriptTurns(params.clio_session_ref)
  return NextResponse.json({ turns })
}
