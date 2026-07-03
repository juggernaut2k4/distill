import type { MeetingBotProvider } from './types'
import { redactAuditTokenFromUrl } from '../session-billing'

export const agentCallProvider: MeetingBotProvider = {
  name: 'agentcall',

  async createBot(meetingUrl, userId, walkthroughUrl, _sessionId) {
    // SECURITY: walkthroughUrl carries the audit token as a query param — never log it raw.
    console.log('[AGENTCALL STUB] createBot — not yet implemented', { meetingUrl, userId, walkthroughUrl: redactAuditTokenFromUrl(walkthroughUrl) })
    throw new Error('AgentCall provider not yet implemented. Set MEETING_BOT_PROVIDER=recall or attendee.')
  },

  async deleteBot(botId) {
    console.log('[AGENTCALL STUB] deleteBot — not yet implemented', { botId })
  },
}
