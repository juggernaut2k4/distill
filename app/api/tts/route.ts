import { NextRequest, NextResponse } from 'next/server'
import { textToMp3Base64 } from '@/lib/tts'

// Minimal valid silent MP3 — used as fallback if ElevenLabs fails
const SILENT_MP3_B64 =
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhgCenp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6e//////////////////////////////////////////////////////////////////8AAAA5TGFNRTOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

/**
 * POST /api/tts
 * Converts text to MP3 audio via ElevenLabs (Aria voice) and returns audio/mpeg.
 * Called by WalkthroughClient inside the Recall.ai headless browser — the bot
 * captures the audio playback and outputs it to the meeting participants.
 * Never returns 5xx — falls back to silent MP3 on ElevenLabs error.
 * Body: { text: string }
 */
export async function POST(request: NextRequest) {
  let text: string
  try {
    const body = await request.json()
    text = body?.text
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!text || typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  try {
    const b64 = await textToMp3Base64(text.trim())
    const audio = Buffer.from(b64, 'base64')
    return new NextResponse(audio, {
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  } catch (err) {
    console.error('[/api/tts] ElevenLabs error — returning silent fallback:', err)
    const silent = Buffer.from(SILENT_MP3_B64, 'base64')
    return new NextResponse(silent, {
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  }
}
