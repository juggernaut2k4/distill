import { recallProvider } from './recall'
import { attendeeProvider } from './attendee'
import { agentCallProvider } from './agentcall'
import type { MeetingBotProvider } from './types'

/**
 * Returns the active meeting bot provider based on MEETING_BOT_PROVIDER env var.
 *
 * MEETING_BOT_PROVIDER=recall    → Recall.ai (default)
 * MEETING_BOT_PROVIDER=attendee  → Attendee.dev (POC #1)
 * MEETING_BOT_PROVIDER=agentcall → AgentCall (POC #2, stub)
 *
 * All providers share the same interface. Switching providers requires no code
 * changes — only the env var and provider-specific API key (ATTENDEE_API_KEY, etc).
 */
export function getMeetingBotProvider(): MeetingBotProvider {
  const name = process.env.MEETING_BOT_PROVIDER ?? 'recall'
  switch (name) {
    case 'attendee':   return attendeeProvider
    case 'agentcall':  return agentCallProvider
    default:           return recallProvider
  }
}
