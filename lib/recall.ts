/**
 * Recall.ai API client for creating and managing meeting bots.
 * Mock mode activates automatically when RECALL_AI_API_KEY is a PLACEHOLDER.
 */

const RECALL_REGION = process.env.RECALL_AI_REGION ?? 'us-west-2'
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`

const isPlaceholder =
  !process.env.RECALL_AI_API_KEY ||
  process.env.RECALL_AI_API_KEY.startsWith('PLACEHOLDER')

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
      output_media: {
        kind: 'webpage',
        url: walkthroughUrl,
      },
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              mode: 'prioritize_low_latency',
              language_code: 'en',
            },
          },
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            url: `${process.env.NEXT_PUBLIC_APP_URL}/api/recall/webhook`,
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

  const res = await fetch(`${RECALL_BASE}/bot/${botId}`, {
    method: 'DELETE',
    headers: recallHeaders(),
  })

  if (!res.ok && res.status !== 404) {
    const body = await res.text()
    throw new Error(`Recall.ai deleteBot failed: ${res.status} ${body}`)
  }
}

/**
 * Sends text-to-speech audio through the bot's microphone in the meeting.
 */
export async function speakText(botId: string, text: string): Promise<void> {
  if (isPlaceholder) {
    console.log('[MOCK RECALL] speakText called', { botId, text })
    return
  }

  const res = await fetch(`${RECALL_BASE}/bot/${botId}/speak_text`, {
    method: 'POST',
    headers: recallHeaders(),
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`Recall.ai speakText failed: ${res.status} ${body}`)
    // Non-fatal — don't throw, just log
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
