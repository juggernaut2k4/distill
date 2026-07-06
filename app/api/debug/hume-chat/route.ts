import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Fetch a Hume EVI config document by id.
 */
async function fetchConfig(apiKey: string, configId: string) {
  const res = await fetch(`https://api.hume.ai/v0/evi/configs/${configId}`, {
    headers: { 'X-Hume-Api-Key': apiKey },
  })
  const body = res.ok ? await res.json() : { error: await res.text(), status: res.status }
  return { ok: res.ok, body }
}

// Internal live-diagnostic utility for chat-event/base-config inspection.
// Narrowed per docs/specs/HUME-NATIVE-01-config-lifecycle-consolidation-requirement-doc.md
// Section 3.3: the explicit-config-id lookup + diff-against-base capability
// (formerly ?configId=<id> and ?configId=<id>&diff=1) has been removed from
// this file — it is fully superseded by getHumeSessionDetails()
// (lib/voice/hume-native/session-details.ts, exposed at
// /api/internal/hume-native/session-details?sessionId=<uuid>), which is a
// strict superset (archive-first/live-fallback, transcript included,
// session-id-based rather than requiring a raw config id).
//
// This file's remaining scope is permanent and intentional: ad-hoc,
// unarchived live diagnostics that have nothing to do with archived session
// data (chat-event inspection, base-config live state, recent-chats
// listing) — not a "delete me" debug scratchpad.
// Usage:
//   GET /api/debug/hume-chat?chat_id=<id>
//   GET /api/debug/hume-chat?config=1     (base config from NEXT_PUBLIC_HUME_CONFIG_ID)
//   GET /api/debug/hume-chat               (no params — lists recent chats)
export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('chat_id')
  const wantConfig = request.nextUrl.searchParams.get('config')
  const apiKey = process.env.HUME_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'HUME_API_KEY not set' }, { status: 500 })

  // Fetch the live config document itself — proves the actual tools/language_model
  // state of the config_id currently referenced by NEXT_PUBLIC_HUME_CONFIG_ID,
  // rather than trusting the dashboard UI or assuming it matches.
  if (wantConfig) {
    const configId = process.env.NEXT_PUBLIC_HUME_CONFIG_ID
    if (!configId) return NextResponse.json({ error: 'NEXT_PUBLIC_HUME_CONFIG_ID not set' }, { status: 500 })
    const { body } = await fetchConfig(apiKey, configId)
    return NextResponse.json({ configId, envConfigIdRaw: process.env.NEXT_PUBLIC_HUME_CONFIG_ID, result: body })
  }

  // No chat_id given — list recent chats instead, so a failed connection
  // that never reached chat_metadata (no chat_id ever assigned) can still
  // be diagnosed. Sorted newest first by Hume's API.
  if (!chatId) {
    const configId = process.env.NEXT_PUBLIC_HUME_CONFIG_ID
    const listRes = await fetch(
      `https://api.hume.ai/v0/evi/chats?page_size=5&ascending_order=false${configId ? `&config_id=${configId}` : ''}`,
      { headers: { 'X-Hume-Api-Key': apiKey } }
    )
    const list = listRes.ok ? await listRes.json() : { error: await listRes.text() }
    return NextResponse.json({ recent_chats: list })
  }

  const [chatRes, eventsRes] = await Promise.all([
    fetch(`https://api.hume.ai/v0/evi/chats/${chatId}`, {
      headers: { 'X-Hume-Api-Key': apiKey },
    }),
    fetch(`https://api.hume.ai/v0/evi/chats/${chatId}/events?page_size=50`, {
      headers: { 'X-Hume-Api-Key': apiKey },
    }),
  ])

  const chat = await chatRes.json()
  const events = eventsRes.ok ? await eventsRes.json() : { error: await eventsRes.text() }

  return NextResponse.json({ chat, events })
}
