import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { decryptOutboundToken } from '@/lib/partner/crypto'

export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store' }
const SINGLETON_ID = '00000000-0000-0000-0000-000000000001'

/**
 * B2B-75 (docs/specs/B2B-75-requirement-document.md §6.4) — mints a single-use WebRTC conversation
 * token for one widget-channel ElevenLabs session.
 *
 * Structural twin of app/api/hume-token/route.ts and app/api/openai-realtime-token/route.ts:
 * `dynamic = 'force-dynamic'`, `Cache-Control: no-store` on every response, typed error envelopes,
 * and secrets never in an error message or a response body.
 *
 * ONE STRUCTURAL DIFFERENCE, stated because it is genuinely new: this is the first token route
 * whose credential comes from the DATABASE rather than `process.env`. Per Known Constraint C4 the
 * ElevenLabs API key is entered in the admin dashboard, not baked into an env var, so switching
 * providers never needs a redeploy. It is stored encrypted-and-retrievable (AES-256-GCM, via
 * lib/partner/crypto.ts) because Clio must REPLAY it outward to ElevenLabs — an outbound
 * credential, never a hashed one. It is decrypted in exactly one place: right here, server-side.
 *
 * WHY `cache: 'no-store'` ON THE OUTBOUND FETCH IS MANDATORY AND NON-NEGOTIABLE:
 * app/api/openai-realtime-token/route.ts carries a documented, live-diagnosed bug (its own comment,
 * lines 22-30) where Next.js's fetch Data Cache silently served the IDENTICAL token to every caller
 * for the token's lifetime — 4 consecutive calls spanning 2+ minutes returned the same single-use
 * token. The exposure here is STRICTLY WORSE than that: ElevenLabs' response also carries a
 * `conversation_id`, so a cached response would hand concurrent participants not just a shared
 * credential but a shared conversation IDENTITY — which would corrupt the per-session
 * `hume_chat_id` write and, through it, transcript retrieval and insight extraction. Do not remove
 * this option.
 *
 * TOKEN EXPIRY IS UNDOCUMENTED FOR THIS ENDPOINT, AND THIS DESIGN IS BUILT NOT TO CARE.
 * The widely-quoted 15-minute figure belongs to the SIGNED-URL / WebSocket endpoint
 * (/v1/convai/conversation/get-signed-url), not to /v1/convai/conversation/token, whose API
 * reference states no duration at all; several third-party sources conflate the two. This route
 * therefore asserts no TTL. Containment: the token is minted immediately before each connect, used
 * exactly once, and never stored, cached, reused, pre-minted or refreshed. If the real expiry is
 * seconds, the mint-to-use gap is a single client round trip on the same page load; if it is hours,
 * the token still never leaves the browser that requested it and is discarded on unload. The
 * unknown only becomes load-bearing if a future change wants to pre-mint or reuse a token — at
 * which point the TTL must be established first.
 *
 * DOCUMENTED FALLBACK — WebSocket signed URL, two changes and no structural work: call
 * `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=...` (same
 * `xi-api-key` header, same `cache: 'no-store'`) and return `{ signedUrl: body.signed_url, agentId }`,
 * then pass `signedUrl` + `connectionType: 'websocket'` in lib/voice/elevenlabs-adapter.ts. Nothing
 * else changes — not the overrides, not the tools, not the callbacks, not WidgetRenderClient.
 *
 * On the `xi-api-key` header: it is taken verbatim from ElevenLabs' own server-side example for
 * this endpoint and matches the sibling signed-URL endpoint and every other convai endpoint. It is
 * an inference from examples rather than a doc-stated requirement — labelled honestly here rather
 * than overclaimed. We send it regardless, so nothing depends on resolving the ambiguity.
 */
export async function GET() {
  let apiKeyCiphertext: string | null = null
  let agentId: string | null = null

  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('system_voice_config')
      .select('elevenlabs_api_key_ciphertext, elevenlabs_agent_id')
      .eq('id', SINGLETON_ID)
      .maybeSingle()

    if (error || !data) {
      console.error('[elevenlabs-token] ElevenLabs credentials not configured')
      return NextResponse.json({ error: 'ElevenLabs credentials not configured' }, { status: 500, headers: NO_CACHE })
    }

    const row = data as { elevenlabs_api_key_ciphertext: string | null; elevenlabs_agent_id: string | null }
    apiKeyCiphertext = row.elevenlabs_api_key_ciphertext
    agentId = row.elevenlabs_agent_id
  } catch (err) {
    console.error('[elevenlabs-token] Failed to read voice config:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'ElevenLabs credentials not configured' }, { status: 500, headers: NO_CACHE })
  }

  if (!apiKeyCiphertext || !agentId) {
    // Deliberately logs neither the ciphertext nor the agent id's absence in a way that could be
    // confused with a key value.
    console.error('[elevenlabs-token] ElevenLabs credentials not configured')
    return NextResponse.json({ error: 'ElevenLabs credentials not configured' }, { status: 500, headers: NO_CACHE })
  }

  const apiKey = decryptOutboundToken(apiKeyCiphertext)
  if (!apiKey) {
    // decryptOutboundToken returns null (never throws) on corrupt ciphertext or a changed
    // PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY. No part of the ciphertext or plaintext is logged.
    console.error('[elevenlabs-token] Stored ElevenLabs credential could not be decrypted')
    return NextResponse.json({ error: 'ElevenLabs credentials could not be read' }, { status: 500, headers: NO_CACHE })
  }

  let res: Response
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      { method: 'GET', headers: { 'xi-api-key': apiKey }, cache: 'no-store' }
    )
  } catch (err) {
    console.error('[elevenlabs-token] Conversation-token request failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to obtain ElevenLabs conversation token' }, { status: 502, headers: NO_CACHE })
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // The response body from ElevenLabs is logged for diagnosis; the key never is.
    console.error('[elevenlabs-token] ElevenLabs conversation-token request failed:', res.status, body)
    return NextResponse.json({ error: 'Failed to obtain ElevenLabs conversation token' }, { status: 502, headers: NO_CACHE })
  }

  const data = (await res.json().catch(() => null)) as { token?: string; conversation_id?: string } | null

  if (!data?.token) {
    console.error('[elevenlabs-token] Unexpected response shape from ElevenLabs conversation-token endpoint')
    return NextResponse.json(
      { error: 'Unexpected response from ElevenLabs conversation-token endpoint' },
      { status: 502, headers: NO_CACHE }
    )
  }

  // `conversation_id` is deliberately NOT returned. The adapter receives the authoritative
  // conversation id from the SDK's own onConnect({ conversationId }); returning a second source of
  // the same identity would invite the two to drift. The API key is never part of any response, in
  // any branch.
  return NextResponse.json({ conversationToken: data.token, agentId }, { headers: NO_CACHE })
}
