import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { forceEndSession } from '@/lib/session-billing'

/**
 * AUTOGEN-01 Part D / Edge Case D2 / AC-D8 — voice-gap watchdog.
 *
 * Fired whenever a `gap_start` audit event is written (voice channel disconnected
 * mid-session, after billing had already started). Runs independently of client
 * state — if the bot's browser crashes entirely, this still force-ends the
 * session 30 seconds after the gap began, so unbilled bot-idle time and
 * Recall.ai bot-cost exposure are bounded (Section 6, Edge Case D2 rationale:
 * Hume's own internal reconnect exhausts in ~7s; 30s gives ~4x headroom for
 * jitter/slower reconnects across both providers).
 *
 * Cancelled if a matching `gap_end` (successful reconnect) or the session's own
 * `clio/session.ended` (explicit end) fires first — in either case nothing here
 * needs to run.
 */
export const voiceGapWatchdog = inngest.createFunction(
  {
    id: 'voice-gap-watchdog',
    name: 'Voice Gap Watchdog',
    triggers: [{ event: 'distill/voice.gap.started' }],
    cancelOn: [
      { event: 'distill/voice.gap.ended', match: 'data.sessionId' },
      { event: 'clio/session.ended', match: 'data.sessionId' },
    ],
    concurrency: { key: 'event.data.sessionId', limit: 1 },
    retries: 1,
  },
  async ({ event, step }: {
    event: { data: { userId: string; sessionId: string; gapStartedAt: string } }
    step: {
      sleep: (id: string, duration: string) => Promise<void>
      run: <T>(id: string, fn: () => Promise<T>) => Promise<T>
    }
  }) => {
    const { userId, sessionId, gapStartedAt } = event.data

    // AC-D8: 30 continuous seconds with no successful reconnect force-ends the session.
    await step.sleep('wait-30s-gap-threshold', '30s')

    await step.run('force-end-on-unresolved-gap', async () => {
      const supabase = createSupabaseAdminClient()

      const { data: session } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle()

      if (!session || session.status === 'completed') {
        console.log(`[voice-gap-watchdog] Session ${sessionId} already ended — skipping`)
        return
      }

      // Defense in depth: if a gap_end was written for this exact gap after we were
      // scheduled (race between the event firing and cancelOn registering), don't
      // force-end. cancelOn should already have caught this in the normal case.
      const { data: gapEndRows } = await supabase
        .from('session_billing_audit_log')
        .select('occurred_at')
        .eq('session_id', sessionId)
        .eq('event_type', 'gap_end')
        .gte('occurred_at', gapStartedAt)
        .limit(1)

      if (gapEndRows && gapEndRows.length > 0) {
        console.log(`[voice-gap-watchdog] Gap for session ${sessionId} already resolved — skipping force-end`)
        return
      }

      console.warn(`[voice-gap-watchdog] Session ${sessionId} — 30s+ unresolved voice gap, force-ending`)
      const result = await forceEndSession({ userId, sessionId })
      if (result.skipped) {
        console.log(`[voice-gap-watchdog] Session ${sessionId} already ended — skipping force-end`)
      } else {
        console.log(`[voice-gap-watchdog] Force-ended session ${sessionId} — ${result.minutesUsed} minutes deducted`)
      }
    })
  },
)
