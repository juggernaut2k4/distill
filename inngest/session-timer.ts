import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { forceEndSession } from '@/lib/session-billing'

/**
 * Server-side session timer — enforces session duration regardless of client state.
 * Triggered when a session starts; cancelled when the session ends (manually or via bot disconnect).
 *
 * Steps (Hume Custom-LLM branch — unchanged):
 *  1. Sleep (durationMins - 1) minutes
 *  2. Write a 1-minute warning to pending_transcript → Clio reads it via poll and wraps up
 *  3. Sleep 1 final minute
 *  4. Force-end: delete bot, clear walkthrough_state, deduct minutes (computed from the
 *     billing audit log — AUTOGEN-01 Part D, Edge Case D3), mark session completed
 *
 * HUME-NATIVE-01 (Graceful Session End) — additive Hume-native branch:
 * when the session was provisioned via provisionNativeConfig
 * (sessions.hume_native_enabled = true), a separate, longer-lead-time nudge
 * step runs instead of the pending_transcript warning above (see
 * docs/specs/HUME-NATIVE-01-graceful-session-end-requirement-doc.md).
 * The final force-end backstop (steps below) is shared, unmodified, by both
 * branches — it is the sole safety net regardless of which branch ran.
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

    // HUME-NATIVE-01 — branch by voice_provider/native-mode. Read once, up
    // front, so the rest of this job can pick the correct pre-cutoff step
    // without a second DB read. Any failure here (e.g. Supabase error) is
    // treated as "not a Hume-native session" — falls through to the existing,
    // unmodified Custom-LLM branch, which is always a safe default.
    const isHumeNative = await step.run('check-hume-native-mode', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase
        .from('sessions')
        .select('hume_native_enabled')
        .eq('id', sessionId)
        .maybeSingle()
      return data?.hume_native_enabled === true
    })

    if (isHumeNative) {
      // ── HUME-NATIVE-01 branch — 2-minute lead time (vs 1 minute for the
      // existing Custom-LLM path), to account for Hume EVI's own
      // end-of-conversation detection latency after Clio's goodbye. Mirrors
      // the existing `durationMins > 1` conditional structure with an
      // adjusted threshold (Section 9, Edge Cases): for very short sessions
      // (durationMins <= 2) skip the pre-nudge sleep entirely and set the
      // flag immediately, so the nudge still gets a chance to fire before
      // the shared backstop below.
      if (durationMins > 2) {
        await step.sleep('wait-before-hume-wrapup-nudge', `${durationMins - 2}m`)
      }

      await step.run('send-hume-wrapup-nudge', async () => {
        const supabase = createSupabaseAdminClient()

        const { data: session } = await supabase
          .from('sessions')
          .select('status')
          .eq('id', sessionId)
          .maybeSingle()

        if (session?.status === 'completed') {
          console.log(`[session-timer] Session ${sessionId} already ended — skipping Hume wrap-up nudge`)
          return
        }

        // New, Hume-specific field — deliberately not pending_transcript
        // (that field is only meaningfully consumed by the Custom-LLM branch
        // below; see module doc comment and the requirement doc, Section 6).
        // Cleared back to false by the client once sent (or once
        // a retry has been attempted and given up on) via the existing PATCH
        // /api/walkthrough-state/[userId] pattern.
        await supabase
          .from('walkthrough_state')
          .update({ hume_wrapup_nudge_pending: true })
          .eq('user_id', userId)

        console.log(`[session-timer] Hume wrap-up nudge flag set for session ${sessionId}`)
      })

      // Grace period before the shared backstop fires — widened to match the
      // 2-minute lead time above (vs the existing 1-minute Custom-LLM grace
      // window), giving Clio's goodbye + Hume EVI's own hang-up detection
      // time to complete before the backstop force-ends the session.
      await step.sleep('wait-final-hume-grace-period', '2m')
    } else {
      // ── Existing Hume Custom-LLM branch — completely unmodified by this
      // feature.

      // Wait until 1 minute before the session ends
      if (durationMins > 1) {
        await step.sleep('wait-before-warning', `${durationMins - 1}m`)
      }

      // Send 1-minute warning — written to pending_transcript so Clio picks it up on the
      // next poll cycle and begins wrapping up naturally.
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
    }

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
