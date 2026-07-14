import { inngest } from './client'
import { fetchDueDispatches, attemptDispatch } from '@/lib/partner/webhooks'

/**
 * B2B-02 — Usage webhook dispatch worker (architecture.md Section 7.2).
 *
 * Runs every minute, picks up `webhook_dispatch_log` rows that are
 * `pending` and due (never attempted, or past `next_retry_at`), and attempts
 * delivery to each partner's `{outbound_base_url}/webhooks/usage`. Per-item
 * error-tolerant — one partner's unreachable endpoint never blocks another's
 * delivery, matching the existing daily-delivery/session-meeting-setup
 * convention of "log error, continue" applied per row.
 */
export const partnerWebhookDispatcher = inngest.createFunction(
  {
    id: 'partner-webhook-dispatcher',
    name: 'Partner Webhook Dispatcher',
    retries: 1,
    triggers: [{ cron: '*/1 * * * *' }],
  },
  async ({ step }) => {
    const dueRows = await step.run('fetch-due-dispatches', async () => fetchDueDispatches(50))

    if (dueRows.length === 0) {
      return { delivered: 0, retrying: 0, exhausted: 0, skipped: 0 }
    }

    const outcomes = { delivered: 0, retrying: 0, exhausted: 0, skipped: 0 }

    for (const row of dueRows) {
      const outcome = await step.run(`dispatch-${row.id}`, async () => {
        try {
          return await attemptDispatch(row)
        } catch (err) {
          console.error(`[partner-webhook-dispatcher] Unexpected error dispatching ${row.id}:`, err)
          return 'retrying' as const
        }
      })

      if (outcome === 'delivered') outcomes.delivered++
      else if (outcome === 'exhausted') outcomes.exhausted++
      else if (outcome === 'skipped_no_endpoint') outcomes.skipped++
      else outcomes.retrying++
    }

    return outcomes
  }
)
