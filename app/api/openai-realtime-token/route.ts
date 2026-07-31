import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store' }

// B2B-61 Part A — model id confirmed live in OpenAI's current Realtime docs
// (developers.openai.com/api/docs/guides/realtime-websocket, fetched during this build:
// example WS URL is literally "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1").
// Overridable via env so a model bump never needs a code deploy.
const DEFAULT_MODEL = 'gpt-realtime-2.1'

/**
 * B2B-61 Part A — structural twin of app/api/hume-token/route.ts: server-minted,
 * short-lived auth, NO_CACHE, typed error responses, secrets from process.env only.
 *
 * UNVERIFIED AGAINST A LIVE ACCOUNT — no OPENAI_REALTIME_API_KEY was available in this build
 * environment (confirmed via `env | grep OPENAI` before starting: not set). The mandatory
 * connectivity spike this brief calls for (docs/... — see B2B-61 brief §"Spike first") could
 * NOT be performed for real. The request/response shape below is assembled from OpenAI's own
 * current documentation (developers.openai.com/api/reference/resources/realtime/subresources/
 * sessions/methods/create, and the "Ephemeral Tokens" community/docs material describing
 * POST /v1/realtime/client_secrets) but has NOT been confirmed against a real HTTP call. Before
 * this route is used for a real session, mint one real token by hand (`curl` against this route
 * with a real key set) and confirm the response actually contains `client_secret.value` /
 * `client_secret.expires_at` in the shape assumed below — adjust the parsing below if not.
 *
 * Normalized response shape ({ accessToken, expiresIn }) deliberately matches
 * app/api/hume-token/route.ts's response shape exactly, so both providers' token routes are
 * interchangeable from the client adapter's point of view.
 */
export async function GET() {
  const apiKey = process.env.OPENAI_REALTIME_API_KEY

  if (!apiKey) {
    console.error('[openai-realtime-token] Missing OPENAI_REALTIME_API_KEY')
    return NextResponse.json({ error: 'OpenAI Realtime credentials not configured' }, { status: 500, headers: NO_CACHE })
  }

  const model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_MODEL

  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session: { type: 'realtime', model } }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('[openai-realtime-token] OpenAI client_secret request failed:', res.status, body)
    return NextResponse.json({ error: 'Failed to obtain OpenAI Realtime access token' }, { status: 502, headers: NO_CACHE })
  }

  const data = (await res.json()) as {
    client_secret?: { value?: string; expires_at?: number }
    // Defensive fallback: at least one documented description of this endpoint's response places
    // `value`/`expires_at` at the top level rather than nested under `client_secret`. Handle both
    // shapes rather than assuming — see the UNVERIFIED note above.
    value?: string
    expires_at?: number
  }

  const accessToken = data.client_secret?.value ?? data.value
  const expiresAt = data.client_secret?.expires_at ?? data.expires_at

  if (!accessToken) {
    console.error('[openai-realtime-token] Unexpected response shape from OpenAI client_secrets endpoint:', JSON.stringify(data))
    return NextResponse.json({ error: 'Unexpected response from OpenAI Realtime token endpoint' }, { status: 502, headers: NO_CACHE })
  }

  const expiresIn = typeof expiresAt === 'number' ? Math.max(0, expiresAt - Math.floor(Date.now() / 1000)) : 60

  return NextResponse.json({ accessToken, expiresIn, model }, { headers: NO_CACHE })
}
