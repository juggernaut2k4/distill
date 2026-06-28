import type { MeetingBotProvider, CreateBotResult } from './types'

const BASE_URL = 'https://app.attendee.dev/api/v1'

function headers(): Record<string, string> {
  return {
    'Authorization': `Token ${process.env.ATTENDEE_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  }
}

export const attendeeProvider: MeetingBotProvider = {
  name: 'attendee',

  async createBot(meetingUrl: string, userId: string, walkthroughUrl: string): Promise<CreateBotResult> {
    const key = process.env.ATTENDEE_API_KEY
    if (!key || key.startsWith('PLACEHOLDER')) {
      const mockBotId = `mock-attendee-${Date.now()}`
      console.log('[MOCK ATTENDEE] createBot', { meetingUrl, userId, walkthroughUrl, mockBotId })
      return { botId: mockBotId }
    }

    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/attendee/webhook`

    const res = await fetch(`${BASE_URL}/bots`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: 'Clio',
        // voice_agent_settings.url points Attendee to the same walkthrough page
        // that Recall.ai uses — Attendee loads it in headless Chromium and routes
        // meeting audio through the page's mic/speaker. ElevenLabs runs identically.
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
      throw new Error(`Attendee.dev createBot failed: ${res.status} ${body}`)
    }

    const data = await res.json() as { id: string }
    return { botId: data.id }
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
