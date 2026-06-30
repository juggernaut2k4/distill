import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'

/**
 * Server-side session timer — enforces session duration regardless of client state.
 * Triggered when a session starts; cancelled when the session ends (manually or via bot disconnect).
 *
 * Steps:
 *  1. Sleep (durationMins - 1) minutes
 *  2. Write a 1-minute warning to pending_transcript → Clio reads it via poll and wraps up
 *  3. Sleep 1 final minute
 *  4. Force-end: delete bot, clear walkthrough_state, deduct minutes, mark session completed
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

    // Force-end the session if it hasn't already ended
    await step.run('force-end-session', async () => {
      const supabase = createSupabaseAdminClient()

      const [{ data: wsRow }, { data: session }, { data: userRow }] = await Promise.all([
        supabase.from('walkthrough_state').select('bot_id').eq('user_id', userId).maybeSingle(),
        supabase.from('sessions').select('started_at, duration_mins, status').eq('id', sessionId).single(),
        supabase.from('users').select('minutes_balance').eq('id', userId).single(),
      ])

      if (!session || session.status === 'completed') {
        console.log(`[session-timer] Session ${sessionId} already ended — skipping force-end`)
        return
      }

      // Delete bot if still in the meeting
      const botId = wsRow?.bot_id as string | null
      if (botId) {
        try {
          await getMeetingBotProvider().deleteBot(botId)
          console.log(`[session-timer] Bot ${botId} removed from meeting`)
        } catch (err) {
          console.error(`[session-timer] Bot deletion failed (non-fatal):`, err)
        }
      }

      // Clear walkthrough_state
      await supabase.from('walkthrough_state').update({
        bot_id: null,
        meeting_url: null,
        status: 'idle',
        visual_spec: null,
        topic_title: null,
        topic_id: null,
        sections: null,
        training_scripts: null,
        session_brief: null,
        topic_context: null,
        session_script: null,
        clio_session_context: null,
        current_section_index: 0,
        pending_transcript: null,
      }).eq('user_id', userId)

      // Calculate actual elapsed minutes, capped at current balance
      let minutesUsed = durationMins
      if (session.started_at) {
        const elapsedMs = Date.now() - new Date(session.started_at).getTime()
        minutesUsed = Math.max(1, Math.ceil(elapsedMs / (1000 * 60)))
      }
      minutesUsed = Math.min(minutesUsed, userRow?.minutes_balance ?? minutesUsed)

      const now = new Date().toISOString()
      await Promise.all([
        supabase.rpc('deduct_minutes', { p_user_id: userId, p_minutes: minutesUsed }),
        supabase.from('sessions').update({
          ended_at: now,
          status: 'completed',
          duration_mins: minutesUsed,
        }).eq('id', sessionId),
      ])

      console.log(`[session-timer] Force-ended session ${sessionId} — ${minutesUsed} minutes deducted`)
    })
  },
)
