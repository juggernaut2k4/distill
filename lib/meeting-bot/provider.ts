import { recallProvider } from './recall'
import { attendeeProvider } from './attendee'
import { agentCallProvider } from './agentcall'
import type { MeetingBotProvider } from './types'

/**
 * Returns the active meeting bot provider based on MEETING_BOT_PROVIDER env var.
 *
 * MEETING_BOT_PROVIDER=attendee  → Attendee.dev (default as of the Recall→Attendee
 *                                   migration — Phase 1. Recall.ai code remains in
 *                                   place as a rollback safety net; see CLAUDE.md.)
 * MEETING_BOT_PROVIDER=recall    → Recall.ai (rollback option — set explicitly to revert)
 * MEETING_BOT_PROVIDER=agentcall → AgentCall (POC #2, stub)
 *
 * All providers share the same interface. Switching providers requires no code
 * changes — only the env var and provider-specific API key (ATTENDEE_API_KEY, etc).
 */
export function getMeetingBotProvider(): MeetingBotProvider {
  const name = process.env.MEETING_BOT_PROVIDER ?? 'attendee'
  switch (name) {
    case 'recall':     return recallProvider
    case 'agentcall':  return agentCallProvider
    default:           return attendeeProvider
  }
}
