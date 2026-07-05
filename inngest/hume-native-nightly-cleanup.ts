import { toZonedTime } from 'date-fns-tz'
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendAdminAlert } from '@/lib/delivery/email'

/**
 * HUME-NATIVE-01 Phase C — Nightly Hume Config archive + cleanup.
 *
 * Per docs/specs/HUME-NATIVE-01-phase-c-nightly-cleanup-requirement-doc.md.
 *
 * TIMEZONE CORRECTION APPLIED (per Arun, does not match the spec's literal
 * "CST" text): the requirement doc as written assumed "CST" meant a fixed
 * UTC-6 offset year-round, and derived a bare `0 6 * * *` UTC cron from that
 * assumption (12:00 AM CST = 06:00 UTC, only true in winter). Arun clarified
 * he actually means real Texas/Central *local* time (America/Chicago), which
 * is UTC-6 during CST (roughly Nov-Mar) and UTC-5 during CDT (roughly Mar-Nov)
 * under US daylight saving. A fixed `0 6 * * *` cron would fire at 1:00 AM
 * local time instead of midnight for about 8 months of the year — wrong by
 * design during CDT.
 *
 * Fix: this job's Inngest cron trigger uses Inngest's native `TZ=<IANA-zone>`
 * cron prefix (`TZ=America/Chicago 0 0 * * *`), which Inngest evaluates
 * against the real IANA timezone database entry for America/Chicago and
 * therefore fires at true local midnight every night of the year,
 * automatically shifting across the DST boundary — no hardcoded UTC offset
 * anywhere in the trigger itself. This is the first `TZ=`-prefixed cron in
 * this codebase; every other existing job uses a bare (UTC) cron because
 * their semantics didn't require local-time alignment. This one does, so it
 * uses the feature built for exactly this case rather than forcing the old
 * bare-UTC convention onto a requirement it doesn't fit.
 *
 * The in-code eligibility window (used only for defense-in-depth logging
 * clarity — the actual SQL filter is DST-agnostic, see below) is computed
 * with `date-fns-tz`'s `toZonedTime`, which resolves "now, expressed in
 * America/Chicago local time" correctly across the DST boundary — never a
 * hardcoded `-06:00`/`-05:00` literal.
 *
 * The eligibility window itself (Section 6.1 of the requirement doc) is
 * `ended_at < (NOW() - INTERVAL '1 hour')`, computed entirely in UTC via
 * Postgres `NOW()`. This condition needs NO timezone conversion at all —
 * "more than 1 hour before this run, in absolute time" is the same instant
 * regardless of what local clock is being displayed, so the DST correction
 * only affects *when the job fires* (the cron trigger), not the SQL
 * eligibility math, which was already correct and offset-agnostic as written
 * in the original spec.
 */
export const humeNativeNightlyCleanup = inngest.createFunction(
  {
    id: 'hume-native-nightly-cleanup',
    name: 'Hume Native Nightly Config Archive + Cleanup',
    retries: 3,
    triggers: [{ cron: 'TZ=America/Chicago 0 0 * * *' }],
    onFailure: async ({ error, event }: { error: Error; event: { data: unknown } }) => {
      try {
        await sendAdminAlert({
          subject: 'hume-native-nightly-cleanup job failed after all retries',
          body: `The Hume native nightly cleanup Inngest job has exhausted all retries and failed.\n\nError: ${error.message}`,
          context: { errorStack: error.stack, eventData: event.data },
        })
      } catch (alertErr) {
        // Never let alert failure mask the original error
        console.error('[hume-native-cleanup:onFailure] Failed to send admin alert:', alertErr)
      }
    },
  },
  async ({ step }) => {
    const apiKey = process.env.HUME_API_KEY
    const isMockMode = !apiKey || apiKey.startsWith('PLACEHOLDER_')

    if (isMockMode) {
      console.log(
        '[MOCK] HUME_API_KEY not set — hume-native nightly cleanup will log intended actions but skip real Hume API calls'
      )
    }

    // Logged purely for operational visibility — confirms the DST-aware
    // trigger landed on the intended local wall-clock instant. Never used
    // for the actual eligibility filter (that's pure UTC math in SQL below).
    const nowChicago = toZonedTime(new Date(), 'America/Chicago')
    console.log(
      `[hume-native-cleanup] Run started. America/Chicago local time now: ${nowChicago.toISOString()} (informational only)`
    )

    const supabase = createSupabaseAdminClient()

    // Step: fetch-eligible-sessions (Section 6.1 of the requirement doc).
    // Pure UTC/absolute-time math — no timezone conversion needed here, only
    // the cron trigger above needed the DST correction.
    const eligibleSessions = await step.run('fetch-eligible-sessions', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

      const result = await supabase
        .from('sessions')
        .select('id, hume_native_config_id, hume_chat_id')
        .eq('hume_native_enabled', true)
        .not('hume_native_config_id', 'is', null)
        .not('hume_chat_id', 'is', null)
        .not('ended_at', 'is', null)
        .lt('ended_at', oneHourAgo)
        .is('hume_config_archived_at', null)
        .order('ended_at', { ascending: true })

      if (result.error) {
        throw new Error(`Failed to fetch eligible sessions: ${result.error.message}`)
      }

      return result.data ?? []
    })

    if (!eligibleSessions || eligibleSessions.length === 0) {
      console.log('[hume-native-cleanup] No eligible sessions')
      return { processed: 0, archived: 0, deleted: 0, errors: 0 }
    }

    let processed = 0
    let archived = 0
    let deleted = 0
    let errors = 0

    for (const session of eligibleSessions) {
      processed++

      await step.run(`archive-session-${session.id}`, async () => {
        try {
          const configId = session.hume_native_config_id as string
          const chatId = session.hume_chat_id as string

          if (isMockMode) {
            console.log(
              `[MOCK] [hume-native-cleanup] Would fetch config ${configId}, fetch transcript for chat ${chatId}, archive, then delete config for session ${session.id}`
            )
            const mockInsertResult = await supabase.from('hume_native_config_archives').insert({
              session_id: session.id,
              config_snapshot: { mock: true, note: 'HUME_API_KEY not configured — mock archive' },
              transcript_events: [{ mock: true, note: 'HUME_API_KEY not configured — mock archive' }],
              hume_config_id: configId,
              hume_chat_id: chatId,
              hume_config_deleted: true,
            })

            if (mockInsertResult.error) {
              throw new Error(`Mock archive insert failed: ${mockInsertResult.error.message}`)
            }

            const mockUpdateResult = await supabase
              .from('sessions')
              .update({ hume_config_archived_at: new Date().toISOString() })
              .eq('id', session.id)

            if (mockUpdateResult.error) {
              throw new Error(`Mock archived_at update failed: ${mockUpdateResult.error.message}`)
            }

            archived++
            deleted++
            return
          }

          // (a) Fetch Config details — full raw response body.
          const configRes = await fetch(`https://api.hume.ai/v0/evi/configs/${configId}`, {
            method: 'GET',
            headers: { 'X-Hume-Api-Key': apiKey as string },
          })

          if (configRes.status === 404) {
            // Fetch-time 404 is real data loss, not the delete-step's
            // benign 404 case — nothing left to archive for this session.
            // Treat as a session-level error so it's logged and retried.
            throw new Error(
              `Config ${configId} not found on Hume (404 at fetch time) — archive would be incomplete, cannot proceed for session ${session.id}`
            )
          }

          if (!configRes.ok) {
            const errBody = await configRes.text().catch(() => '(unreadable response body)')
            throw new Error(`Failed to fetch config ${configId}: ${configRes.status} ${errBody}`)
          }

          const configSnapshot = await configRes.json()

          // (b) Fetch full transcript, paginating until all pages retrieved.
          const transcriptEvents: unknown[] = []
          let pageNumber = 0
          let hasMore = true

          while (hasMore) {
            const eventsRes = await fetch(
              `https://api.hume.ai/v0/evi/chats/${chatId}/events?page_size=100&page_number=${pageNumber}`,
              {
                method: 'GET',
                headers: { 'X-Hume-Api-Key': apiKey as string },
              }
            )

            if (!eventsRes.ok) {
              const errBody = await eventsRes.text().catch(() => '(unreadable response body)')
              throw new Error(
                `Failed to fetch transcript page ${pageNumber} for chat ${chatId}: ${eventsRes.status} ${errBody}`
              )
            }

            const page = (await eventsRes.json()) as {
              events_page?: unknown[]
              page_number?: number
              total_pages?: number
            }

            const pageEvents = page.events_page ?? []
            transcriptEvents.push(...pageEvents)

            const totalPages = page.total_pages ?? 1
            pageNumber++
            hasMore = pageNumber < totalPages && pageEvents.length > 0
          }

          // (c) Insert archive row. DELETE must never be reached unless this
          // succeeds — archive-before-delete ordering enforced as a
          // straight-line code dependency, not a best-effort convention.
          const insertResult = await supabase.from('hume_native_config_archives').insert({
            session_id: session.id,
            config_snapshot: configSnapshot,
            transcript_events: transcriptEvents,
            hume_config_id: configId,
            hume_chat_id: chatId,
            hume_config_deleted: false,
          })

          if (insertResult.error) {
            throw new Error(`Archive insert failed for session ${session.id}: ${insertResult.error.message}`)
          }

          archived++

          // (d) Only after (c) succeeds: delete the Hume-side Config.
          const deleteRes = await fetch(`https://api.hume.ai/v0/evi/configs/${configId}`, {
            method: 'DELETE',
            headers: { 'X-Hume-Api-Key': apiKey as string },
          })

          let configDeleted = false

          if (deleteRes.status === 404) {
            // Non-fatal — already deleted, treated as success.
            configDeleted = true
          } else if (deleteRes.ok) {
            configDeleted = true
          } else {
            // Delete failed with a real error — archive already exists, but
            // do NOT mark hume_config_archived_at. Config remains live on
            // Hume's side; retried on next run (delete-only retry happens
            // naturally since the archive insert is harmless to repeat).
            const errBody = await deleteRes.text().catch(() => '(unreadable response body)')
            console.error(
              `[hume-native-cleanup] Delete failed for session ${session.id}, config ${configId}: ${deleteRes.status} ${errBody}`
            )
            errors++
            return
          }

          // Mark the archive row's deleted flag to reflect the outcome.
          await supabase
            .from('hume_native_config_archives')
            .update({ hume_config_deleted: configDeleted })
            .eq('session_id', session.id)
            .eq('hume_config_id', configId)

          // (e) Idempotency marker — only set once archive + delete attempt
          // (success or non-fatal 404) both completed.
          const updateResult = await supabase
            .from('sessions')
            .update({ hume_config_archived_at: new Date().toISOString() })
            .eq('id', session.id)

          if (updateResult.error) {
            throw new Error(
              `Failed to set hume_config_archived_at for session ${session.id}: ${updateResult.error.message}`
            )
          }

          deleted++
        } catch (err) {
          console.error(`[hume-native-cleanup] Error for session ${session.id}:`, err)
          errors++
          // Continue to next session — never fail the whole batch.
        }
      })
    }

    const summary = { processed, archived, deleted, errors }
    console.log('[hume-native-cleanup] Complete:', summary)
    return summary
  }
)
