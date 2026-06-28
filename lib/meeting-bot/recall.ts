import { createBot as recallCreateBot, deleteBot as recallDeleteBot } from '@/lib/recall'
import type { MeetingBotProvider } from './types'

export const recallProvider: MeetingBotProvider = {
  name: 'recall',
  createBot: (meetingUrl, userId, walkthroughUrl, _sessionId) => recallCreateBot(meetingUrl, userId, walkthroughUrl),
  deleteBot: (botId) => recallDeleteBot(botId),
}
