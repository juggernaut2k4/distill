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

  async createBot(meetingUrl: string, userId: string, walkthroughUrl: string, sessionId?: string): Promise<CreateBotResult> {
    const key = process.env.ATTENDEE_API_KEY
    if (!key || key.startsWith('PLACEHOLDER')) {
      const mockBotId = `mock-attendee-${Date.now()}`
      // SECURITY: walkthroughUrl carries the audit token as a query param — never log it raw.
      console.log('[MOCK ATTENDEE] createBot', { meetingUrl, userId, walkthroughUrl: redactAuditTokenFromUrl(walkthroughUrl), mockBotId })
      return { botId: mockBotId }
    }

    const audioMode = process.env.MEETING_BOT_AUDIO_MODE ?? 'browser'
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/attendee/webhook`

    if (audioMode === 'relay') {
      return createBotRelayMode(meetingUrl, userId, walkthroughUrl, sessionId ?? '', webhookUrl)
    }

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

// ─── Relay mode (AUD-01) — NON-FUNCTIONAL as of the ElevenLabs removal ────────
// Attendee streams raw PCM16 audio directly to a relay WebSocket server at
// AUDIO_RELAY_WS_URL. That server (server.ts + lib/voice/relay-handler.ts) was
// an ElevenLabs-only implementation and has been deleted — there is currently
// no backend listening on AUDIO_RELAY_WS_URL, and no Hume-compatible relay
// server has been built to replace it. This function is left in place (Attendee
// integration scaffolding is otherwise generic) but MEETING_BOT_AUDIO_MODE=relay
// will fail/hang until a new relay server is implemented. Not reachable via the
// default config (MEETING_BOT_PROVIDER=recall, MEETING_BOT_AUDIO_MODE=browser).

async function createBotRelayMode(
  meetingUrl: string,
  userId: string,
  walkthroughUrl: string,
  sessionId: string,
  webhookUrl: string,
): Promise<CreateBotResult> {
  const relayBaseUrl = process.env.AUDIO_RELAY_WS_URL
  if (!relayBaseUrl) {
    throw new Error('AUDIO_RELAY_WS_URL must be set when MEETING_BOT_AUDIO_MODE=relay')
  }

  const relayUrl = `${relayBaseUrl}?userId=${encodeURIComponent(userId)}&sessionId=${encodeURIComponent(sessionId)}`

  const res = await fetch(`${BASE_URL}/bots`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: 'Clio',
      // Hybrid mode: bot loads the walkthrough page for screen sharing,
      // AND streams raw PCM16 audio to the relay for low-latency voice.
      // See the NON-FUNCTIONAL note above this function — there is currently
      // no relay backend to receive this audio stream.
      voice_agent_settings: { url: walkthroughUrl },
      websocket_settings: {
        audio: {
          url: relayUrl,
          sample_rate: 16000,
        },
      },
      // transcript.update omitted — STT was intended to run from the audio stream directly
      webhooks: [{
        url: webhookUrl,
        triggers: ['bot.state_change', 'participant_events.join_leave'],
      }],
      metadata: { user_id: userId, session_id: sessionId },
      deduplication_key: `${userId}-${Date.now()}`,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Attendee.dev createBot (relay) failed: ${res.status} ${body}`)
  }

  const data = await res.json() as { id: string }
  return { botId: data.id }
}
