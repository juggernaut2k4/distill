import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * POST /api/partner/render/session-chat-id
 *
 * architecture.md Section 16.3 / B2B-09 Requirement Doc Section 4.B.1 —
 * captures the real Hume `chat_id` the instant a partner session's live
 * voice connection is established (`PartnerRenderClient.tsx`'s `onConnect`
 * handler) and persists it onto `partner_sessions.hume_chat_id`.
 *
 * No Clerk session and no partner API key are available to this call site
 * (same trust boundary as the sibling `end-session` route: it runs inside
 * the meeting-bot's headless browser) — validated only by the opaque
 * `clio_session_ref` itself resolving to a real `partner_sessions` row.
 *
 * Best-effort by design: this route ALWAYS returns 200, never blocks or
 * delays the connect flow. `app/api/webhooks/hume/route.ts`'s
 * `chat_ended` handler falls back to matching on `hume_chat_id` against
 * `partner_sessions`, so a missed write here is recoverable via the
 * 30-minute backstop sweep (`inngest/partner-session-insights-extractor.ts`).
 */

const CaptureSchema = z.object({
  clio_session_ref: z.string().uuid(),
  hume_chat_id: z.string().min(1),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CaptureSchema.safeParse(body)
  if (!parsed.success) {
    // Best-effort — never blocks connect flow (Requirement Doc §4.B.1).
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('partner_sessions')
    .update({ hume_chat_id: parsed.data.hume_chat_id })
    .eq('id', parsed.data.clio_session_ref)

  if (error) {
    console.warn('[partner/render/session-chat-id] Failed to persist hume_chat_id:', error.message)
    return NextResponse.json({ ok: false })
  }

  return NextResponse.json({ ok: true })
}
