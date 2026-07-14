import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'

/**
 * B2B-02 — Session-initiation contract (architecture.md Section 4).
 *
 * Calls the existing, vendor-agnostic `getMeetingBotProvider().createBot()`
 * exactly as `inngest/session-meeting-setup.ts` and
 * `app/api/admin/test-session/route.ts` already do — unmodified interface,
 * per the task brief's explicit instruction not to touch `createBot()`
 * itself. `partner_sessions.id` (== `clio_session_ref`) is passed in the
 * `userId` parameter slot, confirmed safe by architecture.md Section 11
 * (opaque bot metadata only, never an identity check inside the provider).
 *
 * `provider_bot_id` / `provider_name` are stored for internal diagnostics
 * only and must never be returned from any partner-facing API response.
 */

/** Strips known meeting-bot vendor identifiers from an error message before it can ever reach a partner response (Section 8's "redacted of any vendor-identifying string" requirement). */
export function redactVendorIdentifiers(message: string): string {
  return message
    .replace(/attendee\.dev/gi, '[meeting-bot-provider]')
    .replace(/\battendee\b/gi, '[meeting-bot-provider]')
    .replace(/\brecall\.ai\b/gi, '[meeting-bot-provider]')
    .replace(/\brecall\b/gi, '[meeting-bot-provider]')
    .replace(/\bagentcall\b/gi, '[meeting-bot-provider]')
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('meeting-bot dispatch timed out')), ms)),
  ])
}

export interface DispatchBotResult {
  status: 'bot_active' | 'bot_dispatch_failed'
  error?: string
}

/**
 * Dispatches the meeting bot for a `partner_sessions` row and updates the row
 * with the outcome. Never throws — a vendor failure or timeout resolves to
 * `bot_dispatch_failed` with a redacted error message, per Section 8: "the
 * partner's own call succeeded; the downstream dispatch is what failed."
 */
export async function dispatchMeetingBot(params: {
  clioSessionRef: string
  meetingUrl: string
  renderUrl: string
}): Promise<DispatchBotResult> {
  const supabase = createSupabaseAdminClient()
  const provider = getMeetingBotProvider()

  try {
    const { botId } = await withTimeout(
      provider.createBot(params.meetingUrl, params.clioSessionRef, params.renderUrl, params.clioSessionRef),
      20_000 // 15-30s range per Section 8's "Loading/slow-network state" guidance
    )

    await supabase
      .from('partner_sessions')
      .update({ status: 'bot_active', provider_bot_id: botId, provider_name: provider.name })
      .eq('id', params.clioSessionRef)

    return { status: 'bot_active' }
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : 'Unknown meeting-bot dispatch error'
    const redacted = redactVendorIdentifiers(rawMessage)

    await supabase
      .from('partner_sessions')
      .update({ status: 'bot_dispatch_failed', error_message: redacted })
      .eq('id', params.clioSessionRef)

    return { status: 'bot_dispatch_failed', error: redacted }
  }
}
