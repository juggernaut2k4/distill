import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getUserContentPlan } from '@/lib/content/personalizer'
import { sendDailyEmail } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'

/**
 * Daily content delivery job.
 * Cron: 0 7 * * * (7AM UTC — user timezone handling done at delivery level)
 * Fetches all active users and sends their personalized daily insight.
 */
export const dailyDelivery = inngest.createFunction(
  {
    id: 'daily-delivery',
    name: 'Daily Content Delivery',
    retries: 3,
    triggers: [{ cron: '0 7 * * *' }],
  },
  async ({ step }) => {
    const supabase = createSupabaseAdminClient()

    // Fetch all active users not paused
    const users = await step.run('fetch-active-users', async () => {
      const result = await supabase
        .from('users')
        .select('id, email, phone, role, industry, ai_maturity, delivery_preference, plan_tier, twilio_number_assigned')
        .eq('subscription_status', 'active')
        .neq('plan_tier', 'free')
        .or('delivery_paused.is.null,delivery_paused.eq.false')

      if (result.error) {
        throw new Error(`Failed to fetch users: ${result.error.message}`)
      }

      return result.data ?? []
    })

    if (!users || users.length === 0) {
      console.log('[daily-delivery] No active users to deliver to')
      return { delivered: 0, errors: 0 }
    }

    let delivered = 0
    let errors = 0

    // Process in batches of 50
    const BATCH_SIZE = 50
    const batches = []
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      batches.push(users.slice(i, i + BATCH_SIZE))
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]

      await step.run(`process-batch-${batchIndex}`, async () => {
        for (const user of batch) {
          try {
            // Generate personalized content
            const contentPlan = await getUserContentPlan(user.id)

            const deliveryLogEntries: Array<{
              user_id: string
              content_item_id: string
              channel: string
              sent_at: string
              feedback: null
            }> = []

            // Send email if preference includes email
            if (
              user.delivery_preference === 'email' ||
              user.delivery_preference === 'both'
            ) {
              const emailResult = await sendDailyEmail(
                {
                  id: user.id,
                  email: user.email ?? '',
                  role: user.role ?? '',
                  industry: user.industry ?? '',
                  ai_maturity: user.ai_maturity ?? '',
                },
                {
                  id: contentPlan.contentItemId,
                  body_text: contentPlan.emailContent,
                  type: contentPlan.contentType,
                }
              )

              if (emailResult.success) {
                deliveryLogEntries.push({
                  user_id: user.id,
                  content_item_id: contentPlan.contentItemId,
                  channel: 'email',
                  sent_at: new Date().toISOString(),
                  feedback: null,
                })
                delivered++
              }
            }

            // Send SMS if preference includes sms AND plan is pro or executive
            if (
              (user.delivery_preference === 'sms' || user.delivery_preference === 'both') &&
              (user.plan_tier === 'pro' || user.plan_tier === 'executive') &&
              user.twilio_number_assigned &&
              user.phone
            ) {
              const fromNumber = user.twilio_number_assigned
              const smsBody = `${contentPlan.smsContent}\n\nReply Y if useful, N if not — Clio`

              const smsResult = await sendSMS(user.phone, fromNumber, smsBody)

              if (smsResult.success) {
                deliveryLogEntries.push({
                  user_id: user.id,
                  content_item_id: contentPlan.contentItemId,
                  channel: 'sms',
                  sent_at: new Date().toISOString(),
                  feedback: null,
                })
                delivered++
              }
            }

            // Log all deliveries to delivery_log
            if (deliveryLogEntries.length > 0) {
              const supabaseInner = createSupabaseAdminClient()
              await supabaseInner.from('delivery_log').insert(deliveryLogEntries)
            }
          } catch (err) {
            console.error(`[daily-delivery] Error for user ${user.id}:`, err)
            errors++
            // Continue to next user — never fail the whole batch
          }
        }
      })
    }

    console.log(`[daily-delivery] Complete: ${delivered} delivered, ${errors} errors`)
    return { delivered, errors }
  }
)
