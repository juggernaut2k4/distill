import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { appendDiagnosticEvent } from '@/lib/voice/openai-realtime-diagnostic-store'

/**
 * POST /api/partner/render/voice-diagnostic-capture
 *
 * TEMPORARY — 2026-08-02, diagnosing issues #2/#3 in
 * docs/2026-08-02-farewell-narration-findings.md §8/§9 (a live test call showed no captured user
 * response right before an early, narrated-not-spoken close). Mirrors
 * transcript-capture/route.ts's exact trust boundary and always-200 contract. Remove this route
 * alongside lib/voice/openai-realtime-diagnostic-store.ts once those issues are resolved.
 */

const DiagnosticCaptureSchema = z.object({
  clio_session_ref: z.string().uuid(),
  label: z.string().min(1).max(200),
  detail: z.record(z.unknown()).optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = DiagnosticCaptureSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  await appendDiagnosticEvent(parsed.data.clio_session_ref, parsed.data.label, parsed.data.detail ?? {})
  return NextResponse.json({ ok: true })
}
