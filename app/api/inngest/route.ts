import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { dailyDelivery } from '@/inngest/daily-delivery'
import { weeklyDigest } from '@/inngest/weekly-digest'
import { feedbackProcessor } from '@/inngest/feedback-processor'

/**
 * POST /api/inngest
 * Serves all Inngest functions for registration and invocation.
 * Required by Inngest SDK to register functions with the Inngest platform.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [dailyDelivery, weeklyDigest, feedbackProcessor],
})
