import { createBot as recallCreateBot, deleteBot as recallDeleteBot } from '@/lib/recall'
import type { MeetingBotProvider } from './types'

export const recallProvider: MeetingBotProvider = {
  name: 'recall',
  createBot: (meetingUrl, userId, walkthroughUrl, _sessionId, botDisplayName) => recallCreateBot(meetingUrl, userId, walkthroughUrl, botDisplayName),
  deleteBot: (botId) => recallDeleteBot(botId),
}
