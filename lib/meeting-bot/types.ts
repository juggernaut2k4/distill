export interface CreateBotResult {
  botId: string
}

export interface MeetingBotProvider {
  name: 'recall' | 'attendee' | 'agentcall'
  // botDisplayName — B2B item 5 (2026-08-02): the reseller-configurable assistant name
  // (partner_themes.assistant_display_name, already wired into the spoken voice persona via
  // lib/partner/live-render.ts's assistantName). Falls back to each provider's own default when
  // absent (undefined/null), so pre-existing callers (e.g. the retired B2C walkthrough path via
  // app/api/recall/bot/route.ts) keep working byte-for-byte unchanged.
  createBot(meetingUrl: string, userId: string, walkthroughUrl: string, sessionId?: string, botDisplayName?: string | null): Promise<CreateBotResult>
  deleteBot(botId: string): Promise<void>
}
