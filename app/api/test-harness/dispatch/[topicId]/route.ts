import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { assembleTestHarnessPayload, TestHarnessTopicNotFoundError } from '@/lib/test-harness/payload'

/**
 * POST /api/test-harness/dispatch/[topicId]
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 10a, §6.8, AT-13, AT-14). A thin,
 * same-process server-to-server proxy to the real, unmodified `POST /api/partner/v1/sessions` —
 * exactly as any external partner caller would call it (same headers, same body shape, same
 * Bearer-token auth) — using `TEST_HARNESS_PARTNER_API_KEY` (server-side only, never sent to the
 * browser). Relays that real endpoint's status code and body back verbatim (AT-13) so the harness's
 * UI shows exactly what the real pipeline said. Basic Auth already gates this route via
 * `middleware.ts` (it lives under `/api/test-harness/*`) — no separate auth check here.
 */

const DispatchBodySchema = z.object({ meeting_url: z.string().url() })

export async function POST(request: NextRequest, { params }: { params: { topicId: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = DispatchBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Enter a valid meeting URL.' }, details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  let payload
  try {
    payload = await assembleTestHarnessPayload(params.topicId, parsed.data.meeting_url)
  } catch (err) {
    if (err instanceof TestHarnessTopicNotFoundError) {
      return NextResponse.json({ error: { code: 'not_found', message: 'Topic not found.' } }, { status: 404 })
    }
    console.error('[test-harness/dispatch/:id] payload assembly failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'internal_error', message: "Couldn't prepare the payload. Try again." } }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

  let upstream: Response
  try {
    upstream = await fetch(`${appUrl}/api/partner/v1/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.TEST_HARNESS_PARTNER_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('[test-harness/dispatch/:id] upstream call failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: { code: 'upstream_unreachable', message: "Couldn't reach the session endpoint. Try again." } },
      { status: 502 }
    )
  }

  const upstreamBody = await upstream.json().catch(() => ({
    error: { code: 'unknown', message: 'Non-JSON response from the real endpoint.' },
  }))

  // Relay verbatim — status code AND body — so the harness's UI shows exactly what the real pipeline said.
  return NextResponse.json(upstreamBody, { status: upstream.status })
}
