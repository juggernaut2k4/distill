import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { updateProfileAfterSession } from '@/lib/learning/user-profile'

/**
 * Fires on distill/session.completed — updates the user's cross-domain
 * learning profile using Claude to synthesise session data.
 * Non-blocking: runs after the session ends, does not affect the live experience.
 */
export const updateLearningProfile = inngest.createFunction(
  {
    id: 'update-learning-profile',
    name: 'Update User Learning Profile',
    retries: 2,
    triggers: [{ event: 'distill/session.completed' }],
  },
  async ({ event, step }) => {
    const { userId, sessionId, domain, topicTitle, sessionSentiment } = event.data as {
      userId: string
      sessionId: string
      domain: string
      topicTitle: string
      sessionSentiment: string
    }

    // Fetch unresolved questions asked during this session
    const questionsAsked = await step.run('fetch-session-questions', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase
        .from('user_session_context')
        .select('unresolved_questions')
        .eq('user_id', userId)
        .maybeSingle()

      if (!data?.unresolved_questions) return []

      const all = data.unresolved_questions as Array<{ question: string; sessionId: string }>
      return all
        .filter((q) => q.sessionId === sessionId)
        .map((q) => q.question)
    })

    await step.run('update-profile', async () => {
      await updateProfileAfterSession({
        userId,
        sessionId,
        domain,
        topicTitle,
        questionsAsked: questionsAsked as string[],
        sessionSentiment: sessionSentiment ?? 'neutral',
      })
    })

    return { userId, sessionId, questionsUpdated: (questionsAsked as string[]).length }
  }
)
