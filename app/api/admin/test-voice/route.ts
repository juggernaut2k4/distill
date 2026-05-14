import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { speakText } from '@/lib/recall'

/**
 * POST /api/admin/test-voice
 * Directly sends a TTS message through the bot — bypasses webhook pipeline.
 * Isolates whether ElevenLabs + output_audio is working independently.
 * Body: { botId, text? }
 */
export async function POST(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { botId, text } = await request.json() as { botId?: string; text?: string }
  if (!botId) return NextResponse.json({ error: 'botId required' }, { status: 400 })

  const message = text ?? "Hello! I'm Clio, your AI coach. If you can hear this, voice is working perfectly."

  try {
    await speakText(botId, message)
    return NextResponse.json({ ok: true, message })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}
