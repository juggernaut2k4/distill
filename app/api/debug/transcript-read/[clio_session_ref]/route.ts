import { NextRequest, NextResponse } from 'next/server'
import { getStoredTranscriptTurns } from '@/lib/voice/openai-realtime-transcript-store'
import { getStoredDiagnosticEvents } from '@/lib/voice/openai-realtime-diagnostic-store'
import { getPartnerSession, resolveLiveSessionRender } from '@/lib/partner/live-render'

// TEMP DEBUG ROUTE — 2026-08-02. Arun ran the first live test call after tonight's v5 prompt
// rewrite (rule titles, bracketed turn-continuation markers, new rule 10) and the adapter race
// fix, and reported 2 issues: (1) didn't greet him by name and introduced itself as "AI Coach"
// rather than "Clio"; (2) after answering a verification question, it says something generic
// ("yes will look about that") and goes silent instead of acknowledging/encouraging on the answer
// content first. Reading the transcript, diagnostic events, AND the real assembled OpenAI prompt
// actually used for this session to see exactly what instruction was live at that moment and what
// the model actually said. Read-only, requires the exact session UUID (not enumerable). Remove
// once this session has been reviewed.
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
