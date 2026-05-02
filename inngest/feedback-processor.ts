import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/delivery/sms'

/**
 * Feedback processor — triggered by 'distill/feedback.received' event.
 * Updates delivery log, adjusts feedback weights, calculates AI Readiness Score.
 */
export const feedbackProcessor = inngest.createFunction(
  {
    id: 'feedback-processor',
    name: 'Process User Feedback',
    retries: 3,
    triggers: [{ event: 'distill/feedback.received' }],
  },
  async ({ event, step }) => {
    const { userId, deliveryLogId, feedback } = event.data as {
      userId: string
      deliveryLogId: string
      feedback: 'positive' | 'negative'
    }

    const supabase = createSupabaseAdminClient()

    // Step 1: Update delivery_log with feedback
    await step.run('update-delivery-log', async () => {
      await supabase
        .from('delivery_log')
        .update({ feedback })
        .eq('id', deliveryLogId)
    })

    // Step 2: Get the content item tags for this delivery
    await step.run('update-feedback-weights', async () => {
      const { data: delivery } = await supabase
        .from('delivery_log')
        .select('content_item_id, content_items(role_tags, industry_tags, maturity_tags, worry_tags)')
        .eq('id', deliveryLogId)
        .single()

      if (!delivery?.content_items) return

      const rawCI = Array.isArray(delivery.content_items)
        ? delivery.content_items[0]
        : delivery.content_items
      const contentItem = rawCI as unknown as {
        role_tags: string[]
        industry_tags: string[]
        maturity_tags: string[]
        worry_tags: string[]
      }

      const allTags = [
        ...(contentItem.role_tags ?? []),
        ...(contentItem.industry_tags ?? []),
        ...(contentItem.maturity_tags ?? []),
        ...(contentItem.worry_tags ?? []),
      ]

      const weightDelta = feedback === 'positive' ? 1.0 : -0.5

      for (const tag of allTags) {
        // Upsert feedback weight for each tag
        await supabase.from('feedback_weights').upsert(
          {
            user_id: userId,
            tag,
            weight: weightDelta,
          },
          {
            onConflict: 'user_id,tag',
          }
        )

        // Increment/decrement the weight
        await supabase.rpc('increment_feedback_weight', {
          p_user_id: userId,
          p_tag: tag,
          p_delta: weightDelta,
        })
      }
    })

    // Step 3: Check for consecutive negative responses (recalibration trigger)
    const needsRecalibration = await step.run('check-recalibration', async () => {
      const { data: recent } = await supabase
        .from('delivery_log')
        .select('feedback')
        .eq('user_id', userId)
        .not('feedback', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(10)

      if (!recent || recent.length < 5) return false

      // Count consecutive negatives from most recent
      let consecutiveNegatives = 0
      for (const entry of recent) {
        if (entry.feedback === 'negative') {
          consecutiveNegatives++
        } else {
          break
        }
      }

      return consecutiveNegatives >= 5
    })

    if (needsRecalibration) {
      await step.run('trigger-recalibration', async () => {
        await supabase
          .from('users')
          .update({ needs_recalibration: true })
          .eq('id', userId)

        // Send recalibration SMS
        const { data: user } = await supabase
          .from('users')
          .select('phone, twilio_number_assigned')
          .eq('id', userId)
          .single()

        if (user?.phone && user.twilio_number_assigned) {
          await sendSMS(
            user.phone,
            user.twilio_number_assigned,
            'We\'re recalibrating your Distill plan to better match your needs. Your next insight will be different. — Distill'
          )
        }
      })
    }

    // Step 4: Calculate AI Readiness Score if eligible
    await step.run('calculate-readiness-score', async () => {
      const { data: user } = await supabase
        .from('users')
        .select('onboarded_at, streak_days')
        .eq('id', userId)
        .single()

      if (!user) return

      const daysSinceOnboarding = Math.floor(
        (Date.now() - new Date(user.onboarded_at).getTime()) / (1000 * 60 * 60 * 24)
      )

      if (daysSinceOnboarding < 7) return // Not eligible yet

      // Count total feedbacks
      const { data: feedbacks } = await supabase
        .from('delivery_log')
        .select('feedback')
        .eq('user_id', userId)
        .not('feedback', 'is', null)

      if (!feedbacks || feedbacks.length < 5) return // Need at least 5 feedbacks

      const positiveFeedbacks = feedbacks.filter((f: { feedback: string }) => f.feedback === 'positive').length
      const totalFeedbacks = feedbacks.length
      const streakDays = user.streak_days ?? 0

      // Score formula: (positive_feedbacks / total_feedbacks) * 60 + (streak_days / 30) * 40
      const rawScore =
        (positiveFeedbacks / totalFeedbacks) * 60 +
        (Math.min(streakDays, 30) / 30) * 40

      const score = Math.round(Math.min(100, Math.max(0, rawScore)))

      await supabase
        .from('users')
        .update({ ai_readiness_score: score })
        .eq('id', userId)
    })

    return { processed: true, userId, feedback }
  }
)
