import { inngest } from './client'
import { runPartnerContentGeneration, deleteExpiredContentItems } from '@/lib/partner/content-generation'

/**
 * B2B-03 — Content generation pipeline dispatch (Requirement Doc Section
 * 4.A.3/6.3). Triggered by `POST /api/admin/configurator/content/generate`
 * (fire-and-forget `inngest.send`) so the API route can return immediately
 * with the `generating` row (Section 4.A.3's "appears immediately" UI
 * contract) while the multi-step LLM pipeline runs in the background — the
 * same "generate in background before approval, display only after"
 * discipline this codebase already follows elsewhere.
 */
export const partnerContentGeneration = inngest.createFunction(
  {
    id: 'partner-content-generation',
    name: 'Partner Content Generation',
    retries: 2,
    triggers: [{ event: 'distill/partner-content.generate' }],
  },
  async ({ event, step }) => {
    const { partnerAccountId, itemId, partnerTopicRef } = event.data as {
      partnerAccountId: string
      itemId: string
      partnerTopicRef: string
    }

    await step.run('generate-content', async () => {
      await runPartnerContentGeneration(partnerAccountId, itemId, partnerTopicRef)
    })

    return { itemId }
  }
)

/**
 * B2B-03 — Daily cleanup of expired `partner_content_items` drafts
 * (architecture.md Section 12.4). Reuses this codebase's existing Inngest
 * cron pattern (e.g. `hume-native-nightly-cleanup`) — never a new
 * infrastructure shape.
 */
export const partnerContentCleanup = inngest.createFunction(
  { id: 'partner-content-cleanup', name: 'Partner Content Draft Cleanup', retries: 1, triggers: [{ cron: '0 4 * * *' }] },
  async ({ step }) => {
    const deleted = await step.run('delete-expired', async () => deleteExpiredContentItems())
    return { deleted }
  }
)
