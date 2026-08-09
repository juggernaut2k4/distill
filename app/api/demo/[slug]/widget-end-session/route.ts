import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * POST /api/demo/[slug]/widget-end-session
 *
 * 2026-08-09 — same-origin proxy for DemoTopicClient.tsx's "End session" button and its
 * automatic tab-close beacon. Mirrors widget-dispatch/route.ts's own upstream-proxy pattern
 * exactly (same `apiBaseUrl` env var + fallback, same server-to-server fetch shape).
 *
 * WHY THIS EXISTS: the demo page is served on the test-harness host (test.hello-clio.com), a
 * different origin from the real `/api/partner/render/end-session` route (main app domain). A
 * browser-side fetch straight to that route — whether relative (resolves to the wrong host,
 * 404s) or absolute (resolves to the right host, but is then a cross-origin request that route
 * has no CORS headers for, and gets blocked before the request is even sent) — cannot work from
 * this page. Both failure modes were confirmed live in production before writing this route.
 * A same-origin proxy sidesteps the problem entirely: the BROWSER only ever talks to this
 * same-origin route, and the actual cross-domain call happens server-to-server, which is never
 * subject to CORS.
 */

const EndSessionSchema = z.object({
  clio_session_ref: z.string().uuid(),
  duration_minutes: z.number().min(0).max(600).default(0),
})

export async function POST(request: NextRequest) {
  const requestBody = await request.json().catch(() => null)
  const parsed = EndSessionSchema.safeParse(requestBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const apiBaseUrl = process.env.DEMO_PARTNER_API_BASE_URL ?? 'https://www.hello-clio.com'

  try {
    const upstream = await fetch(`${apiBaseUrl}/api/partner/render/end-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    })
    const upstreamBody = await upstream.json().catch(() => ({}))
    return NextResponse.json(upstreamBody, { status: upstream.status })
  } catch (err) {
    console.error('[demo/widget-end-session] Network error calling /api/partner/render/end-session:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'end_session_failed' }, { status: 502 })
  }
}
