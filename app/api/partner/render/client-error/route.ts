import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'

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
 * partner API key — validated only by the opaque clio_session_ref).
 *
 * B2B-44 Fix 2 — widened `source` to accept 'error-boundary' reports (posted
 * by lib/partner/live-render.ts's buildIframeDiagnosticShim() when it detects
 * the Next.js error-boundary fallback text). Previously this value was
 * rejected by the Zod schema, so the `.safeParse()` failed and the route
 * returned before console.error() was ever reached — Fix 4b (2026-07-27) had
 * never actually logged anything.
 *
 * B2B-44 Fix 3 — in addition to the existing console.error (still the
 * primary, unconditional record — Vercel runtime logs), a validated report
 * now also gets a best-effort row in `glitch_instances` with
 * `glitch_type: 'technical_error'`, so it surfaces on the same internal
 * glitch dashboard (`/api/admin/glitches`) as conversational glitches — the
 * one durable, dashboarded location visible without shelling into Vercel
 * logs. This insert is entirely best-effort: any failure (session lookup,
 * insert error) is swallowed into console.error and never affects the
 * response below. Always returns 200 — must never itself throw or block.
 */

const ClientErrorSchema = z.object({
  clio_session_ref: z.string().uuid(),
  message: z.string().min(1).max(2000),
  stack: z.string().max(4000).optional(),
  // 2026-07-29 — widened for 'react-error-boundary' (a real React error boundary inside the demo
  // page reporting the actual caught Error, distinct from 'error-boundary''s DOM-text detection).
  // B2B-45's own lesson applies here too: this schema must be widened BEFORE the new source value is
  // ever sent, or .safeParse() silently rejects it exactly like the original 'error-boundary' value
  // was rejected for two days before B2B-44 Fix 2.
  //
  // B2B-49 — widened again for 'hume-adapter-error' (HumeAdapter's own ws.onerror/ws.onclose
  // failure paths, carrying the real Hume WS close code/reason) and 'hume-connect-error'
  // (PartnerRenderClient's connect() outer catch). Same lesson, same discipline: widened here in
  // the same change that starts sending these values, not after.
  // B2B-61 Part A — widened again for 'openai-realtime-adapter-error' (OpenAIRealtimeAdapter's
  // own ws.onerror/ws.onclose failure paths, mirroring 'hume-adapter-error' for the alternate
  // voice provider). Same lesson, same discipline as the B2B-49 note above.
  source: z.enum([
    'error',
    'unhandledrejection',
    'error-boundary',
    'react-error-boundary',
    'hume-adapter-error',
    'hume-connect-error',
    'openai-realtime-adapter-error',
  ]),
})

// B2B-44 Fix 3 — ordinal-collision-avoidance scheme for glitch_instances rows written by this
// route. glitch_instances has UNIQUE(partner_session_id, ordinal), and trigger-sourced rows
// (fanout_glitch_instances(), migration 082) always start at ordinal 0 and grow by small integers
// (one per conversational glitch in a session — never remotely close to this floor in practice).
// Client-error-sourced rows instead take max(existing ordinal for this session, FLOOR - 1) + 1,
// which guarantees: (a) never collides with a trigger-sourced row, since the result is always >=
// CLIENT_ERROR_ORDINAL_FLOOR, far above any realistic trigger-assigned ordinal; (b) never collides
// with an earlier client-error row for the same session, since it's always strictly greater than
// the current max. A race between two concurrent crash reports for the same session could still
// compute the same next value and collide on the UNIQUE constraint — acceptable here specifically
// because this insert is documented best-effort and swallows its own errors.
const CLIENT_ERROR_ORDINAL_FLOOR = 100000

async function tryRecordGlitchInstance(
  clioSessionRef: string,
  report: { message: string; stack?: string; source: string }
): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient()

    // clio_session_ref IS partner_sessions.id (same resolution pattern as every other
    // meeting-bot-facing render route — see lib/partner/live-render.ts's getPartnerSession()).
    const { data: session } = await supabase
      .from('partner_sessions')
      .select('id, partner_account_id')
      .eq('id', clioSessionRef)
      .maybeSingle()

    if (!session) {
      console.error('[partner-render] client-error: no partner_sessions row found for clio_session_ref, skipping glitch_instances insert', {
        clioSessionRef,
      })
      return
    }

    const { data: maxOrdinalRow } = await supabase
      .from('glitch_instances')
      .select('ordinal')
      .eq('partner_session_id', session.id)
      .order('ordinal', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextOrdinal = Math.max(
      CLIENT_ERROR_ORDINAL_FLOOR,
      ((maxOrdinalRow?.ordinal as number | undefined) ?? CLIENT_ERROR_ORDINAL_FLOOR - 1) + 1
    )

    const description = [`source: ${report.source}`, report.message, report.stack ? `stack: ${report.stack}` : null]
      .filter(Boolean)
      .join('\n')

    const { error } = await supabase.from('glitch_instances').insert({
      partner_session_id: session.id,
      partner_account_id: session.partner_account_id,
      glitch_type: 'technical_error',
      description,
      ordinal: nextOrdinal,
      extracted_at: new Date().toISOString(),
    })

    if (error) {
      console.error('[partner-render] client-error: glitch_instances insert failed (non-blocking):', error.message)
    }
  } catch (err) {
    console.error('[partner-render] client-error: tryRecordGlitchInstance threw (non-blocking):', err instanceof Error ? err.message : err)
  }
}

// B2B-45 — the reporting shim runs inside a sandboxed iframe with `sandbox="allow-scripts"` and no
// `allow-same-origin` (deliberate, AT-SSRF-3), so its fetch() carries an opaque `Origin: null`. Its
// POST body is `application/json`, which is not a CORS-simple content-type, so the browser preflights
// with OPTIONS before ever sending the real request. Next's default auto-OPTIONS response has no
// Access-Control-Allow-Origin, so the preflight was passing (204) while the browser silently dropped
// every real POST that followed — confirmed live: zero POSTs to this route in two hours despite three
// separate shipped diagnostic mitigations trying to send them. `*` (not a reflected `"null"`) is safe
// here specifically because this endpoint already has no trust boundary (no Clerk session, no partner
// API key, validated only by the opaque clio_session_ref) and the shim's fetch() sends no credentials.
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = ClientErrorSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 200, headers: CORS_HEADERS })
  }

  console.error('[partner-render] client-side error report:', {
    clioSessionRef: parsed.data.clio_session_ref,
    source: parsed.data.source,
    message: parsed.data.message,
    stack: parsed.data.stack,
  })

  await tryRecordGlitchInstance(parsed.data.clio_session_ref, {
    message: parsed.data.message,
    stack: parsed.data.stack,
    source: parsed.data.source,
  })

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
}
