import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * POST /api/partner/render/client-error
 *
 * 2026-07-27 — diagnostic-only sink for uncaught client-side errors inside
 * PartnerRenderClient.tsx (the meeting-bot's headless browser has no
 * accessible devtools console, so a crash there was previously undiagnosable
 * from server-side logs alone — found live when a real session showed
 * "Application error" on screen with no way to see the actual stack trace).
 *
 * Same trust boundary as the sibling render routes (no Clerk session, no
 * partner API key — validated only by the opaque clio_session_ref). Never
 * persisted to a table: this only console.errors so it surfaces in Vercel
 * runtime logs. Always returns 200 — must never itself throw or block.
 */

const ClientErrorSchema = z.object({
  clio_session_ref: z.string().uuid(),
  message: z.string().min(1).max(2000),
  stack: z.string().max(4000).optional(),
  source: z.enum(['error', 'unhandledrejection']),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = ClientErrorSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  console.error('[partner-render] client-side error report:', {
    clioSessionRef: parsed.data.clio_session_ref,
    source: parsed.data.source,
    message: parsed.data.message,
    stack: parsed.data.stack,
  })

  return NextResponse.json({ ok: true })
}
