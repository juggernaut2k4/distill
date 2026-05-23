import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { dailyDelivery } from '@/inngest/daily-delivery'
import { weeklyDigest } from '@/inngest/weekly-digest'
import { feedbackProcessor } from '@/inngest/feedback-processor'
import { sessionReminder } from '@/inngest/session-reminder'
import { sessionMeetingSetup } from '@/inngest/session-meeting-setup'
import { sessionPlanGenerator } from '@/inngest/session-plan-generator'
import { sessionAgendaEmail } from '@/inngest/session-agenda-email'
import { trialExpiryJob } from '@/inngest/trial-expiry'
import { sessionContentPipeline } from '@/inngest/session-content-pipeline'

/**
 * POST /api/inngest
 * Serves all Inngest functions for registration and invocation.
 * Required by Inngest SDK to register functions with the Inngest platform.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [dailyDelivery, weeklyDigest, feedbackProcessor, sessionReminder, sessionMeetingSetup, sessionPlanGenerator, sessionAgendaEmail, trialExpiryJob, sessionContentPipeline],
})
