import type { MeetingBotProvider, CreateBotResult } from './types'
import { redactAuditTokenFromUrl } from '../session-billing'

const BASE_URL = 'https://app.attendee.dev/api/v1'

function headers(): Record<string, string> {
  return {
    'Authorization': `Token ${process.env.ATTENDEE_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  }
}

export const attendeeProvider: MeetingBotProvider = {
  name: 'attendee',

  async createBot(meetingUrl: string, userId: string, walkthroughUrl: string, _sessionId?: string): Promise<CreateBotResult> {
    const key = process.env.ATTENDEE_API_KEY
    if (!key || key.startsWith('PLACEHOLDER')) {
      const mockBotId = `mock-attendee-${Date.now()}`
      // SECURITY: walkthroughUrl carries the audit token as a query param — never log it raw.
      console.log('[MOCK ATTENDEE] createBot', { meetingUrl, userId, walkthroughUrl: redactAuditTokenFromUrl(walkthroughUrl), mockBotId })
      return { botId: mockBotId }
    }

    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/attendee/webhook`

    return createBotBrowserMode(meetingUrl, userId, walkthroughUrl, webhookUrl)
  },

  async deleteBot(botId: string): Promise<void> {
    const key = process.env.ATTENDEE_API_KEY
    if (!key || key.startsWith('PLACEHOLDER')) {
      console.log('[MOCK ATTENDEE] deleteBot', { botId })
      return
    }

    const res = await fetch(`${BASE_URL}/bots/${botId}/leave`, {
      method: 'POST',
      headers: headers(),
    })

    if (!res.ok && res.status !== 404) {
      const body = await res.text()
      throw new Error(`Attendee.dev deleteBot failed: ${res.status} ${body}`)
    }
  },
}

// ─── Browser mode (current, default) ─────────────────────────────────────────
// Attendee loads walkthroughUrl in headless Chromium. WalkthroughClient runs
// the live Hume EVI voice session in that browser tab; the bot's mic/speaker
// carry Hume's audio directly into the meeting.

async function createBotBrowserMode(
  meetingUrl: string,
  userId: string,
  walkthroughUrl: string,
  webhookUrl: string,
): Promise<CreateBotResult> {
  const res = await fetch(`${BASE_URL}/bots`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: 'Clio',
      voice_agent_settings: { url: walkthroughUrl },
      webhooks: [{
        url: webhookUrl,
        triggers: ['bot.state_change', 'transcript.update', 'participant_events.join_leave'],
      }],
      metadata: { user_id: userId },
      deduplication_key: `${userId}-${Date.now()}`,
      transcription_settings: { meeting_closed_captions: {} },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Attendee.dev createBot (browser) failed: ${res.status} ${body}`)
  }

  const data = await res.json() as { id: string }
  return { botId: data.id }
}
