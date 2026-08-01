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
 * VERIFIED LIVE 2026-07-31 once OPENAI_REALTIME_API_KEY became available in this environment.
 * `data.client_secret.value` / `data.client_secret.expires_at` is the real shape OpenAI returns —
 * the top-level `data.value`/`data.expires_at` fallback below was never needed live but is left in
 * place as a harmless defensive fallback.
 *
 * BUG FOUND AND FIXED BY THE LIVE SPIKE: the outbound `fetch()` below originally had no explicit
 * `cache` option. Next.js's fetch Data Cache was silently caching this POST to OpenAI, so repeated
 * calls to this route within a short window returned the IDENTICAL client_secret (confirmed: 4
 * consecutive calls spanning 2+ minutes returned the same `ek_...` token and expires_at). Since
 * OpenAI's ephemeral tokens are single-use (`ephemeral_token_already_used` on a second WS connect
 * attempt), this meant any connection attempt — successful or failed — could silently burn the
 * token that every other caller would then also receive, breaking real session starts for up to
 * the token's ~10min lifetime. Fixed by adding `cache: 'no-store'` below; re-verified live
 * (3 consecutive calls after the fix returned 3 distinct tokens).
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
    cache: 'no-store',
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
