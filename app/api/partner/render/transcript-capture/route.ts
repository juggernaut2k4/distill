import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { appendTranscriptTurn } from '@/lib/voice/openai-realtime-transcript-store'

/**
 * POST /api/partner/render/transcript-capture
 *
 * B2B-63 (docs/specs/B2B-63-requirement-document.md §6). Mirrors
 * app/api/partner/render/session-chat-id/route.ts's exact trust boundary: no Clerk session, no
 * partner API key — this runs inside the meeting bot's headless browser, same precedent as every
 * other client-side partner-render call site. Always returns 200 — never blocks or delays the
 * live call.
 */

const CaptureSchema = z.object({
  clio_session_ref: z.string().uuid(),
  source: z.enum(['user', 'ai']),
  text: z.string().min(1).max(5000),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CaptureSchema.safeParse(body)
  if (!parsed.success) {
    // Best-effort — never blocks the live call, mirrors session-chat-id's own contract exactly.
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  await appendTranscriptTurn(parsed.data.clio_session_ref, parsed.data.source, parsed.data.text)
  return NextResponse.json({ ok: true })
}
