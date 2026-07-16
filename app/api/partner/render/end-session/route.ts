import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getPartnerSession, handleSessionEnd } from '@/lib/partner/live-render'

/**
 * POST /api/partner/render/end-session
 *
 * architecture.md Section 12.6 step 9 — called once, client-side, by
 * `/partner-render/[clio_session_ref]`'s voice-session component on
 * disconnect/unmount. No Clerk session and no partner API key are available
 * to this call site (it runs inside the meeting-bot's headless browser,
 * exactly like the existing public `/api/walkthrough-state/*` polling
 * route) — validated only by the opaque `clio_session_ref` itself resolving
 * to a real `partner_sessions` row, the same trust boundary the render page
 * itself already uses (session-init.ts's documented precedent: "opaque bot
 * metadata only, never an identity check").
 */

const EndSessionSchema = z.object({
  clio_session_ref: z.string().uuid(),
  duration_minutes: z.number().min(0).max(600).default(0),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = EndSessionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const session = await getPartnerSession(parsed.data.clio_session_ref)
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  await handleSessionEnd(session.id, session.partnerAccountId, parsed.data.duration_minutes, session.testMode)

  return NextResponse.json({ ok: true })
}
