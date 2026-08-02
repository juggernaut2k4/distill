import { NextRequest, NextResponse } from 'next/server'
import { getStoredTranscriptTurns } from '@/lib/voice/openai-realtime-transcript-store'
import { getStoredDiagnosticEvents } from '@/lib/voice/openai-realtime-diagnostic-store'
import { getPartnerSession, resolveLiveSessionRender } from '@/lib/partner/live-render'

// TEMP DEBUG ROUTE — 2026-08-02. Arun ran another live test call after the rule 4/rule 10 filler
// fixes and the Fork 2 (participantName) fix shipped, and reported the model still freezes and
// goes silent after the advance_tab tool triggers. Reading the transcript, diagnostic events, and
// the real assembled prompt for this session to see exactly what happened. Read-only, requires the
// exact session UUID (not enumerable). Remove once this session has been reviewed.
export async function GET(_request: NextRequest, { params }: { params: { clio_session_ref: string } }) {
  const [turns, diagnostics] = await Promise.all([
    getStoredTranscriptTurns(params.clio_session_ref),
    getStoredDiagnosticEvents(params.clio_session_ref),
  ])

  let assembledOpenAIPrompt: string | null = null
  const session = await getPartnerSession(params.clio_session_ref)
  if (session) {
    const render = await resolveLiveSessionRender(session)
    if ('assembledOpenAIPrompt' in render) assembledOpenAIPrompt = render.assembledOpenAIPrompt
  }

  return NextResponse.json({ turns, diagnostics, assembledOpenAIPrompt })
}
