import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { handleSessionEnd } from '@/lib/partner/live-render'
import { clampDurationMinutes } from '@/lib/partner/attendee-timing'

/**
 * B2B-50 §6.6-6.7 — fired when active_participant_count transitions to 0. Deliberately NOT an
 * instant end: per the CEO brief's own explicit caution ("don't end a session because one of
 * several participants left"), a hard immediate cutoff on a momentary reconnect blip (Wi-Fi drop,
 * Meet's own rejoin flow) would be a worse failure mode than a short delay. 90s mirrors the same
 * order of magnitude as partner-live-cutoff.ts's own 60s wrap-up-runway and the observed 45-70s
 * Attendee-webhook fallback latency this brief is otherwise trying to beat — conservative on
 * purpose for this one mechanism only, unlike the "within a few seconds" bar the other 3 paths
 * now meet via the handleSessionEnd() choke point.
 *
 * See docs/specs/B2B-50-requirement-document.md §6.7 and AT-9/AT-10/AT-11.
 */
export const partnerParticipantsEmptyDebounce = inngest.createFunction(
  {
    id: 'partner-participants-empty-debounce',
    name: 'Partner Session — All Participants Left Debounce',
    triggers: [{ event: 'clio/partner-session.participants-empty' }],
    concurrency: { key: 'event.data.clioSessionRef', limit: 1 },
    retries: 1,
  },
  async ({ event, step }: {
    event: { data: { clioSessionRef: string; partnerAccountId: string } }
    step: { sleep: (id: string, duration: string) => Promise<void>; run: <T>(id: string, fn: () => Promise<T>) => Promise<T> }
  }) => {
    const { clioSessionRef, partnerAccountId } = event.data

    await step.sleep('debounce-wait', '90s')

    const stillEmpty = await step.run('recheck-still-empty', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase
        .from('partner_sessions')
        .select('status, active_participant_count, provider_bot_id, test_mode, attendee_joined_at, updated_at')
        .eq('id', clioSessionRef)
        .maybeSingle()
      if (!data) return null
      if (data.status === 'completed' || data.status === 'failed') return null // already ended some other way
      if ((data.active_participant_count as number) > 0) return null // someone rejoined — abort
      return data as {
        provider_bot_id: string | null
        test_mode: boolean
        attendee_joined_at: string | null
        updated_at: string
      }
    })

    if (!stillEmpty) return // no-op: rejoined, or already ended via another path

    const durationMinutes = await step.run('compute-duration', async () => {
      const base = stillEmpty.attendee_joined_at ?? stillEmpty.updated_at
      return clampDurationMinutes(Date.now() - new Date(base).getTime())
    })

    await step.run('end-session', async () => {
      await handleSessionEnd(
        clioSessionRef,
        partnerAccountId,
        durationMinutes,
        Boolean(stillEmpty.test_mode),
        stillEmpty.provider_bot_id,
        'completed',
        'wall_clock_fallback',
        'all_participants_left',
      )
    })
  },
)
