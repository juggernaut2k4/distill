import type { MeetingBotProvider } from './types'

export const agentCallProvider: MeetingBotProvider = {
  name: 'agentcall',

  async createBot(meetingUrl, userId, walkthroughUrl, _sessionId) {
    console.log('[AGENTCALL STUB] createBot — not yet implemented', { meetingUrl, userId, walkthroughUrl })
    throw new Error('AgentCall provider not yet implemented. Set MEETING_BOT_PROVIDER=recall or attendee.')
  },

  async deleteBot(botId) {
    console.log('[AGENTCALL STUB] deleteBot — not yet implemented', { botId })
  },
}
