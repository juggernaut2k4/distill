import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Temporary debug endpoint — query Hume chat events to diagnose disconnections
// Usage: GET /api/debug/hume-chat?chat_id=<id>
// DELETE THIS FILE after debugging is complete.
export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('chat_id')
  if (!chatId) return NextResponse.json({ error: 'chat_id required' }, { status: 400 })

  const apiKey = process.env.HUME_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'HUME_API_KEY not set' }, { status: 500 })

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
