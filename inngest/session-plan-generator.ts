import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  buildInitialPlan,
  generateFirstSubtopicVisual,
  generateRemainingSubtopicVisuals,
  type SessionPlan,
} from '@/lib/session-plan'

/**
 * Inngest background function: generates visual specs for all session subtopics.
 * Triggered immediately when a session is scheduled.
 *
 * Step 1: Generate first subtopic visual (priority — enables instant session start)
 * Step 2: Generate remaining subtopics in parallel
 *
 * If user joins the session after step 1 completes, the first visual renders instantly.
 * The rest continue generating in the background and are ready when Clio reaches them.
 */
export const sessionPlanGenerator = inngest.createFunction(
  {
    id: 'session-plan-generator',
    retries: 2,
    triggers: [{ event: 'distill/session.scheduled' }],
  },
  async ({ event, step }: { event: { data: { sessionId: string; topicId: string; topicTitle: string; subtopics: string[]; userId: string } }; step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const { sessionId, topicId, topicTitle, subtopics, userId } = event.data

    const supabase = createSupabaseAdminClient()

    // Mark plan as generating immediately so the UI shows progress
    await step.run('mark-generating', async () => {
      const initialPlan = buildInitialPlan(topicId, topicTitle, subtopics)
      await supabase
        .from('sessions')
        .update({ session_plan: initialPlan })
        .eq('id', sessionId)
    })

    // Fetch user profile for visual personalisation
    const userProfile = await step.run('fetch-user-profile', async () => {
      const { data } = await supabase
        .from('users')
        .select('role, industry, ai_maturity')
        .eq('id', userId)
        .single()
      return data ?? {}
    })

    // Generate first subtopic visual — priority so session can start immediately
    const subtopicsAfterFirst = await step.run('generate-first-visual', async () => {
      return generateFirstSubtopicVisual(subtopics, userProfile)
    })

    // Persist first visual so the session page can render it immediately
    await step.run('store-first-visual', async () => {
      const partialPlan: SessionPlan = {
        topic_id: topicId,
        topic_title: topicTitle,
        subtopics: subtopicsAfterFirst,
        plan_status: 'partial',
        generated_at: new Date().toISOString(),
      }
      await supabase
        .from('sessions')
        .update({ session_plan: partialPlan })
        .eq('id', sessionId)
    })

    // Generate remaining subtopics in parallel
    const allSubtopics = await step.run('generate-remaining-visuals', async () => {
      return generateRemainingSubtopicVisuals(subtopicsAfterFirst, userProfile)
    })

    // Store the complete plan
    await step.run('store-complete-plan', async () => {
      const allReady = allSubtopics.every((s) => s.visual_status === 'ready')
      const completePlan: SessionPlan = {
        topic_id: topicId,
        topic_title: topicTitle,
        subtopics: allSubtopics,
        plan_status: allReady ? 'ready' : 'partial',
        generated_at: new Date().toISOString(),
      }
      await supabase
        .from('sessions')
        .update({ session_plan: completePlan })
        .eq('id', sessionId)
    })

    const readyCount = allSubtopics.filter((s) => s.visual_status === 'ready').length
    console.log(`[session-plan-generator] Session ${sessionId}: ${readyCount}/${allSubtopics.length} visuals ready`)
    return { sessionId, readyCount, total: allSubtopics.length }
  }
)
