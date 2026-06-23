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
import { sessionContentCron } from '@/inngest/session-content-cron'
import { updateLearningProfile } from '@/inngest/update-learning-profile'
import { catalogRefresh } from '@/inngest/catalog-refresh'
import { curriculumQueueRegenerate } from '@/inngest/curriculum-queue-regenerate'
import { curriculumRecommendationAccepted } from '@/inngest/curriculum-recommendation-accepted'
import { curriculumQueueCron } from '@/inngest/curriculum-queue-cron'
import { curriculumGenerator } from '@/inngest/curriculum-generator'
import { sessionDesignerAuto } from '@/inngest/session-designer-auto'
import { sessionQualityEvaluator } from '@/inngest/session-quality-evaluator'
import { sessionContentAsync } from '@/inngest/session-content-async'
import { scheduleSetupNudge } from '@/inngest/schedule-setup-nudge'
import { analyzeIceBreakerResponse } from '@/inngest/ice-breaker-analyzer'

/**
 * POST /api/inngest
 * Serves all Inngest functions for registration and invocation.
 * Required by Inngest SDK to register functions with the Inngest platform.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [dailyDelivery, weeklyDigest, feedbackProcessor, sessionReminder, sessionMeetingSetup, sessionPlanGenerator, sessionAgendaEmail, trialExpiryJob, sessionContentPipeline, sessionContentCron, updateLearningProfile, catalogRefresh, curriculumQueueRegenerate, curriculumRecommendationAccepted, curriculumQueueCron, curriculumGenerator, sessionDesignerAuto, sessionQualityEvaluator, sessionContentAsync, scheduleSetupNudge, analyzeIceBreakerResponse],
})
