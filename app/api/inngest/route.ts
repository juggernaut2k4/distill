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
import { rtv03AccuracyEvaluator } from '@/inngest/rtv03-accuracy-evaluator'
import { scheduleSetupNudge } from '@/inngest/schedule-setup-nudge'
import { analyzeIceBreakerResponse } from '@/inngest/ice-breaker-analyzer'
import { adaptPlan } from '@/inngest/adapt-plan'
import { sessionTimerJob } from '@/inngest/session-timer'
import { voiceGapWatchdog } from '@/inngest/voice-gap-watchdog'
import { humeNativeNightlyCleanup } from '@/inngest/hume-native-nightly-cleanup'
import { templateFixGenerator } from '@/inngest/template-fix-generator'
import { humeActionItemExtractor, humeActionItemBackstopSweep } from '@/inngest/hume-action-item-extractor'
import { partnerWebhookDispatcher } from '@/inngest/partner-webhook-dispatcher'
import { partnerContentGeneration, partnerContentCleanup } from '@/inngest/partner-content-generation'
import { partnerTrialCutoffJob } from '@/inngest/partner-trial-cutoff'
import { partnerLiveCutoffJob } from '@/inngest/partner-live-cutoff'
import {
  partnerSessionInsightsExtractor,
  partnerSessionInsightsBackstopSweep,
  partnerSessionInsightsPurge,
} from '@/inngest/partner-session-insights-extractor'
import { partnerSignupReminder } from '@/inngest/partner-signup-reminder'
import { glitchInstancesPurge } from '@/inngest/glitch-instances-purge'

/**
 * POST /api/inngest
 * Serves all Inngest functions for registration and invocation.
 * Required by Inngest SDK to register functions with the Inngest platform.
 *
 * `abandonedOnboardingCleanup` (inngest/abandoned-onboarding-cleanup.ts) is
 * deliberately NOT registered here. It's B2C-era logic that fires on every
 * `clio/user.created` event — which the Clerk webhook emits for ALL Clerk
 * signups, partner accounts included — and deletes the Clerk user 75 minutes
 * later unless `users.subscription_status`/`stripe_customer_id` (B2C-only
 * columns partner accounts never populate) look "converted". Confirmed live
 * 2026-07-21: every partner test signup was silently deleted 75m after
 * creation, orphaning its populated partner_accounts/wallet/client data and
 * forcing a fresh blank account on next login. File left in place, not
 * deleted, pending a decision on whether any of it is worth salvaging.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [dailyDelivery, weeklyDigest, feedbackProcessor, sessionReminder, sessionMeetingSetup, sessionPlanGenerator, sessionAgendaEmail, trialExpiryJob, sessionContentPipeline, sessionContentCron, updateLearningProfile, catalogRefresh, curriculumQueueRegenerate, curriculumRecommendationAccepted, curriculumQueueCron, curriculumGenerator, sessionDesignerAuto, sessionQualityEvaluator, scheduleSetupNudge, analyzeIceBreakerResponse, adaptPlan, sessionTimerJob, voiceGapWatchdog, humeNativeNightlyCleanup, rtv03AccuracyEvaluator, templateFixGenerator, humeActionItemExtractor, humeActionItemBackstopSweep, partnerWebhookDispatcher, partnerContentGeneration, partnerContentCleanup, partnerTrialCutoffJob, partnerLiveCutoffJob, partnerSessionInsightsExtractor, partnerSessionInsightsBackstopSweep, partnerSessionInsightsPurge, partnerSignupReminder, glitchInstancesPurge],
})
