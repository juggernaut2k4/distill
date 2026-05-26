/**
 * Recall.ai API client for creating and managing meeting bots.
 * Mock mode activates automatically when RECALL_AI_API_KEY is a PLACEHOLDER.
 * Audio output uses ElevenLabs TTS → base64 MP3 → Recall.ai output_audio endpoint.
 *
 * Transcript provider:
 *   RECALL_TRANSCRIPT_PROVIDER=recall   (default) — Recall.ai streaming ASR
 *   RECALL_TRANSCRIPT_PROVIDER=deepgram — Deepgram Nova-2 via Recall.ai native integration.
 *     Recall.ai routes audio to Deepgram on our behalf; transcripts still arrive via
 *     the same transcript.data webhook — nothing downstream changes.
 *     Requires DEEPGRAM_API_KEY env var.
 *     Revert: set RECALL_TRANSCRIPT_PROVIDER=recall in Vercel dashboard (no deploy needed).
 */
import { textToMp3Base64 } from './tts'

const RECALL_REGION = process.env.RECALL_AI_REGION ?? 'us-west-2'
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`

const isPlaceholder =
  !process.env.RECALL_AI_API_KEY ||
  process.env.RECALL_AI_API_KEY.startsWith('PLACEHOLDER')

const transcriptProvider = process.env.RECALL_TRANSCRIPT_PROVIDER ?? 'recall'

function recallHeaders(): Record<string, string> {
  return {
    Authorization: `Token ${process.env.RECALL_AI_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

export interface CreateBotResult {
  botId: string
}

/**
 * Creates a Recall.ai bot that joins the given meeting URL,
 * shares its screen as the walkthroughUrl, and enables real-time transcription.
 */
export async function createBot(
  meetingUrl: string,
  userId: string,
  walkthroughUrl: string
): Promise<CreateBotResult> {
  if (isPlaceholder) {
    const mockBotId = `mock-bot-${userId}-${Date.now()}`
    console.log('[MOCK RECALL] createBot called', { meetingUrl, userId, walkthroughUrl, mockBotId })
    return { botId: mockBotId }
  }

  const res = await fetch(`${RECALL_BASE}/bot`, {
    method: 'POST',
    headers: recallHeaders(),
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: 'Clio AI Coach',
      // web_4_core required for Output Media to properly capture audio from the webpage
      // and relay it to meeting participants. Default "web" variant drops audio.
      variant: {
        google_meet: 'web_4_core',
        zoom: 'web_4_core',
        microsoft_teams: 'web_4_core',
      },
      output_media: {
        camera: {
          kind: 'webpage',
          config: {
            url: walkthroughUrl,
          },
        },
      },
      recording_config: {
        transcript: {
          provider: transcriptProvider === 'deepgram'
            ? {
                // Deepgram Nova-2 via Recall.ai native integration.
                // API key is configured in Recall.ai dashboard (Settings → Integrations → Deepgram),
                // NOT passed inline — Recall.ai rejects requests with api_key in this field.
                // Transcripts still arrive via the same transcript.data webhook.
                deepgram: {
                  language: 'en',
                  model: 'nova-2',
                },
              }
            : {
                // Default: Recall.ai built-in streaming ASR.
                // Default mode fires on natural speech boundaries — 1-2 events per utterance.
                // prioritize_low_latency fires every 100-300ms causing cascade (8+ LLM calls
                // per sentence, 6+ second response delay). Default mode + client debounce
                // achieves the same <3s round-trip without the cascade.
                recallai_streaming: {
                  language_code: 'en',
                },
              },
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            // userId embedded so transcript.data events can be matched —
            // Recall.ai realtime_endpoints payloads don't include bot_id
            url: `${process.env.NEXT_PUBLIC_APP_URL}/api/recall/webhook?userId=${userId}`,
            events: ['transcript.data'],
          },
        ],
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Recall.ai createBot failed: ${res.status} ${body}`)
  }

  const data = (await res.json()) as { id: string }
  return { botId: data.id }
}

/**
 * Removes a bot from the meeting and cleans up the Recall.ai session.
 */
export async function deleteBot(botId: string): Promise<void> {
  if (isPlaceholder) {
    console.log('[MOCK RECALL] deleteBot called', { botId })
    return
  }

  // Recall.ai us-east-1 returns 405 on DELETE — use the leave endpoint instead
  const res = await fetch(`${RECALL_BASE}/bot/${botId}/leave`, {
    method: 'POST',
    headers: recallHeaders(),
  })

  if (!res.ok && res.status !== 404) {
    const body = await res.text()
    throw new Error(`Recall.ai deleteBot failed: ${res.status} ${body}`)
  }
}

/**
 * Converts text to ElevenLabs audio and plays it through the bot in the meeting.
 * Uses output_audio endpoint (us-east-1 compatible) — speak_text is not available.
 */
export async function speakText(botId: string, text: string): Promise<void> {
  if (isPlaceholder) {
    console.log('[MOCK RECALL] speakText called', { botId, text })
    return
  }

  try {
    const b64 = await textToMp3Base64(text)

    const res = await fetch(`${RECALL_BASE}/bot/${botId}/output_audio/`, {
      method: 'POST',
      headers: recallHeaders(),
      body: JSON.stringify({ kind: 'mp3', b64_data: b64 }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Recall.ai output_audio failed: ${res.status} ${body}`)
    }
  } catch (err) {
    // Non-fatal — log and continue
    console.error('speakText error:', err)
  }
}

/**
 * Retrieves the current status of a bot.
 */
export async function getBotStatus(botId: string): Promise<string> {
  if (isPlaceholder) {
    console.log('[MOCK RECALL] getBotStatus called', { botId })
    return 'in_call_not_recording'
  }

  const res = await fetch(`${RECALL_BASE}/bot/${botId}`, {
    method: 'GET',
    headers: recallHeaders(),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Recall.ai getBotStatus failed: ${res.status} ${body}`)
  }

  const data = (await res.json()) as { status: { code: string } }
  return data.status?.code ?? 'unknown'
}
