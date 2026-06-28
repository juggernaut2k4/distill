export interface CreateBotResult {
  botId: string
}

export interface MeetingBotProvider {
  name: 'recall' | 'attendee' | 'agentcall'
  createBot(meetingUrl: string, userId: string, walkthroughUrl: string): Promise<CreateBotResult>
  deleteBot(botId: string): Promise<void>
}
