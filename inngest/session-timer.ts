import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { forceEndSession } from '@/lib/session-billing'

/**
 * Server-side session timer — enforces session duration regardless of client state.
 * Triggered when a session starts; cancelled when the session ends (manually or via bot disconnect).
 *
 * Steps:
 *  1. Sleep (durationMins - 1) minutes
 *  2. Write a 1-minute warning to pending_transcript → Clio reads it via poll and wraps up
 *  3. Sleep 1 final minute
 *  4. Force-end: delete bot, clear walkthrough_state, deduct minutes (computed from the
 *     billing audit log — AUTOGEN-01 Part D, Edge Case D3), mark session completed
 */
export const sessionTimerJob = inngest.createFunction(
  {
    id: 'session-timer',
    name: 'Session Timer',
    triggers: [{ event: 'clio/session.started' }],
    cancelOn: [{ event: 'clio/session.ended', match: 'data.sessionId' }],
    concurrency: { key: 'event.data.sessionId', limit: 1 },
    retries: 1,
  },
  async ({ event, step }: {
    event: { data: { userId: string; sessionId: string; durationMins: number } }
    step: {
      sleep: (id: string, duration: string) => Promise<void>
      run: <T>(id: string, fn: () => Promise<T>) => Promise<T>
    }
  }) => {
    const { userId, sessionId, durationMins } = event.data

    // Wait until 1 minute before the session ends
    if (durationMins > 1) {
      await step.sleep('wait-before-warning', `${durationMins - 1}m`)
    }

    // Send 1-minute warning — written to pending_transcript so Clio picks it up on the
    // next poll cycle and begins wrapping up naturally via ElevenLabs sendUserMessage.
    await step.run('send-time-warning', async () => {
      const supabase = createSupabaseAdminClient()

      const { data: session } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle()

      if (session?.status === 'completed') {
        console.log(`[session-timer] Session ${sessionId} already ended — skipping warning`)
        return
      }

      await supabase
        .from('walkthrough_state')
        .update({
          pending_transcript:
            '[SYSTEM] You have approximately 1 minute remaining in this session. Begin wrapping up naturally — briefly summarise the 2 most important takeaways, then say a warm goodbye and call end_session.',
        })
        .eq('user_id', userId)

      console.log(`[session-timer] 1-minute warning sent for session ${sessionId}`)
    })

    // Wait the final minute
    await step.sleep('wait-final-minute', '1m')

    // Force-end the session if it hasn't already ended. Shared with the voice-gap
    // watchdog (inngest/voice-gap-watchdog.ts) — both back stops must compute
    // minutes identically, strictly from the billing audit log.
    await step.run('force-end-session', async () => {
      const result = await forceEndSession({ userId, sessionId })
      if (result.skipped) {
        console.log(`[session-timer] Session ${sessionId} already ended — skipping force-end`)
      } else {
        console.log(`[session-timer] Force-ended session ${sessionId} — ${result.minutesUsed} minutes deducted`)
      }
    })
  },
)
