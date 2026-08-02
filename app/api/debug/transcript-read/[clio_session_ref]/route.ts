import { NextRequest, NextResponse } from 'next/server'
import { getStoredTranscriptTurns } from '@/lib/voice/openai-realtime-transcript-store'
import { getStoredDiagnosticEvents } from '@/lib/voice/openai-realtime-diagnostic-store'
import { getPartnerSession, resolveLiveSessionRender } from '@/lib/partner/live-render'

// TEMP DEBUG ROUTE — 2026-08-02. Arun ran a test call after the v8 prompt fixes (four fixed rule-4
// patterns, advance_tab/rule-8 ordering fix, explicit teach-the-new-topic instruction) and the
// scoped recovery-nudge backstop, and reported: subtopic 1 went fine, then it said "let's wrap this
// up and then we will forward," the page transitioned, but it went silent afterward — specifically
// on a CORRECT answer (wrong answers work as expected). Reading the transcript, diagnostics, and
// real assembled prompt to see exactly what happened. Remove after review.
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
