import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendWeeklyDigest } from '@/lib/delivery/email'
import type { ContentItem } from '@/lib/content/taxonomy'

/**
 * Weekly digest email job.
 * Cron: 0 8 * * 0 (Sundays 8AM UTC)
 * Sends a digest of the top 5 content items from the past 7 days to all Starter+ users.
 */
export const weeklyDigest = inngest.createFunction(
  {
    id: 'weekly-digest',
    name: 'Weekly Digest Email',
    retries: 2,
    triggers: [{ cron: '0 8 * * 0' }],
  },
  async ({ step }) => {
    const supabase = createSupabaseAdminClient()

    const users = await step.run('fetch-digest-users', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, role, industry, ai_maturity, plan_tier')
        .in('plan_tier', ['starter', 'pro', 'executive'])
        .eq('subscription_status', 'active')
        .or('delivery_paused.is.null,delivery_paused.eq.false')

      if (error) throw new Error(`Fetch users error: ${error.message}`)
      return data ?? []
    })

    let sent = 0
    let errors = 0
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    for (const user of users) {
      await step.run(`digest-user-${user.id}`, async () => {
        try {
          // Fetch top 5 deliveries from the past 7 days (positive feedback first, then recency)
          const { data: recentDeliveries } = await supabase
            .from('delivery_log')
            .select('content_item_id, feedback, sent_at')
            .eq('user_id', user.id)
            .gte('sent_at', sevenDaysAgo)
            .order('feedback', { ascending: false, nullsFirst: false })
            .order('sent_at', { ascending: false })
            .limit(5)

          if (!recentDeliveries || recentDeliveries.length === 0) return

          // Fetch the actual content items
          const contentIds = Array.from(new Set(recentDeliveries.map((d: { content_item_id: string }) => d.content_item_id)))
          const { data: contentItems } = await supabase
            .from('content_items')
            .select('id, type, body_text')
            .in('id', contentIds)

          if (!contentItems || contentItems.length === 0) return

          const items: ContentItem[] = contentItems.map((item: {
            id: string
            type: string
            body_text: string
          }) => ({
            id: item.id,
            type: item.type as ContentItem['type'],
            body_text: item.body_text,
            role_tags: [],
            industry_tags: [],
            maturity_tags: [],
            worry_tags: [],
            created_at: '',
          }))

          const result = await sendWeeklyDigest(
            {
              id: user.id,
              email: user.email ?? '',
              role: user.role ?? '',
              industry: user.industry ?? '',
              ai_maturity: user.ai_maturity ?? '',
            },
            items
          )

          if (result.success) {
            // Log digest delivery
            const supabaseInner = createSupabaseAdminClient()
            await supabaseInner.from('delivery_log').insert({
              user_id: user.id,
              content_item_id: contentIds[0], // Reference first item
              channel: 'email',
              sent_at: new Date().toISOString(),
              feedback: null,
            })
            sent++
          }
        } catch (err) {
          console.error(`[weekly-digest] Error for user ${user.id}:`, err)
          errors++
        }
      })
    }

    return { sent, errors }
  }
)
