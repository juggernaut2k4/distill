import { NextRequest, NextResponse } from 'next/server'
import { ElevenLabsClient } from 'elevenlabs'

const VOICE_ID = 'QeKcckTBICc3UuWL7ETc' // Aria — warm, natural, hyper-realistic

const isPlaceholder =
  !process.env.ELEVENLABS_API_KEY ||
  process.env.ELEVENLABS_API_KEY.startsWith('PLACEHOLDER')

/**
 * POST /api/tts
 * Converts text to MP3 audio via ElevenLabs and returns it as audio/mpeg.
 * Called by WalkthroughClient inside the Recall.ai headless browser to produce
 * bot voice output — the bot captures playback and outputs it to the meeting.
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

  if (isPlaceholder) {
    // 1-second silent MP3 for mock/dev mode
    const silent = Buffer.from(
      'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhgCenp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6e//////////////////////////////////////////////////////////////////8AAAA5TGFNRTOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'base64'
    )
    return new NextResponse(silent, {
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  }

  try {
    const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! })

    const stream = await client.textToSpeech.convert(VOICE_ID, {
      text: text.trim(),
      model_id: 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.8,
        style: 0.35,
        use_speaker_boost: true,
      },
    })

    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const audio = Buffer.concat(chunks)

    return new NextResponse(audio, {
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  } catch (err) {
    console.error('[/api/tts] ElevenLabs error:', err)
    return NextResponse.json({ error: 'TTS generation failed' }, { status: 500 })
  }
}
