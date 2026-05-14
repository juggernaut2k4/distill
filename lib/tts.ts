import { ElevenLabsClient } from 'elevenlabs'

// Sarah — warm, expressive, natural pacing. Great for coaching/teaching contexts.
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

const isPlaceholder =
  !process.env.ELEVENLABS_API_KEY ||
  process.env.ELEVENLABS_API_KEY.startsWith('PLACEHOLDER')

/**
 * Converts text to a base64-encoded MP3 using ElevenLabs.
 * Uses eleven_multilingual_v2 for maximum realism — natural pauses,
 * emotional inflection, and human-like rhythm.
 *
 * Supports natural phrasing hints via punctuation:
 *   — em-dash or comma → natural pause
 *   ... → longer pause / trailing thought
 *   ? → rising inflection
 */
export async function textToMp3Base64(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID
): Promise<string> {
  if (isPlaceholder) {
    console.log('[MOCK TTS] textToMp3Base64', { text: text.slice(0, 60) })
    // Return a 1-second silent MP3 (smallest valid MP3 header) for mock mode
    return 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA'
  }

  const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! })

  const stream = await client.textToSpeech.convert(voiceId, {
    text,
    model_id: 'eleven_multilingual_v2',
    output_format: 'mp3_44100_128',
    voice_settings: {
      stability: 0.4,       // lower = more expressive / emotional variation
      similarity_boost: 0.8, // high = stays true to voice character
      style: 0.35,           // adds stylistic expressiveness
      use_speaker_boost: true,
    },
  })

  // Collect readable stream → Buffer → base64
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('base64')
}
