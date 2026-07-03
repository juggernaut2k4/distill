import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Temporary debug endpoint — query Hume chat events to diagnose disconnections
// Usage: GET /api/debug/hume-chat?chat_id=<id>
// DELETE THIS FILE after debugging is complete.
export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('chat_id')
  const apiKey = process.env.HUME_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'HUME_API_KEY not set' }, { status: 500 })

  // No chat_id given — list recent chats instead, so a failed connection
  // that never reached chat_metadata (no chat_id ever assigned) can still
  // be diagnosed. Sorted newest first by Hume's API.
  if (!chatId) {
    const configId = process.env.NEXT_PUBLIC_HUME_CONFIG_ID
    const listRes = await fetch(
      `https://api.hume.ai/v0/evi/chats?page_size=10${configId ? `&config_id=${configId}` : ''}`,
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
