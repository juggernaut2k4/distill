/**
 * Session plan generation — pre-generates visual specs for all subtopics
 * before the session starts so diagrams render instantly during coaching.
 */

import { generateVisualSpec, reviewVisualSpec, type VisualSpec } from './session-ai'

export interface SessionPlanSubtopic {
  id: string
  title: string
  visual_spec: VisualSpec | null
  visual_status: 'pending' | 'ready' | 'failed'
  skipped?: boolean
}

export interface SessionPlan {
  topic_id: string
  topic_title: string
  subtopics: SessionPlanSubtopic[]
  plan_status: 'generating' | 'partial' | 'ready' | 'failed'
  generated_at: string
}

export function subtopicToId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 60)
}

async function generateSubtopicVisual(
  sub: SessionPlanSubtopic,
  userContext: { role: string; industry: string; maturity: string }
): Promise<SessionPlanSubtopic> {
  try {
    const spec = await generateVisualSpec(sub.id, sub.title, userContext, { width: 1280, height: 720 })
    const review = await reviewVisualSpec(spec)
    return { ...sub, visual_spec: review.revisedSpec ?? spec, visual_status: 'ready' }
  } catch (err) {
    console.error('[session-plan] Visual failed for subtopic:', sub.title, err)
    return { ...sub, visual_status: 'failed' }
  }
}

/**
 * Generates visual specs for all subtopics.
 * Generates the first subtopic first so the session can start immediately,
 * then generates the rest in parallel.
 * Returns updated subtopics after first visual is ready.
 */
export async function generateFirstSubtopicVisual(
  subtopicTitles: string[],
  userProfile: { role?: string | null; industry?: string | null; ai_maturity?: string | null }
): Promise<SessionPlanSubtopic[]> {
  const userContext = {
    role: userProfile.role ?? 'executive',
    industry: userProfile.industry ?? 'business',
    maturity: userProfile.ai_maturity ?? 'beginner',
  }

  const subtopics: SessionPlanSubtopic[] = subtopicTitles.map((title) => ({
    id: subtopicToId(title),
    title,
    visual_spec: null,
    visual_status: 'pending' as const,
  }))

  if (subtopics.length === 0) return subtopics

  const first = await generateSubtopicVisual(subtopics[0], userContext)
  return [first, ...subtopics.slice(1)]
}

/**
 * Generates visual specs for all remaining subtopics (index 1+) in parallel.
 * Call after generateFirstSubtopicVisual so the rest complete in background.
 */
export async function generateRemainingSubtopicVisuals(
  subtopics: SessionPlanSubtopic[],
  userProfile: { role?: string | null; industry?: string | null; ai_maturity?: string | null }
): Promise<SessionPlanSubtopic[]> {
  if (subtopics.length <= 1) return subtopics

  const userContext = {
    role: userProfile.role ?? 'executive',
    industry: userProfile.industry ?? 'business',
    maturity: userProfile.ai_maturity ?? 'beginner',
  }

  const remaining = await Promise.all(
    subtopics.slice(1).map((sub) =>
      sub.visual_status === 'ready' ? Promise.resolve(sub) : generateSubtopicVisual(sub, userContext)
    )
  )

  return [subtopics[0], ...remaining]
}

/**
 * Finds a pre-generated visual spec that matches the given topic title.
 * Used in generate-visual to skip Claude generation when a spec is already ready.
 */
export function findPreGeneratedVisual(
  plan: SessionPlan | null,
  topicTitle: string
): VisualSpec | null {
  if (!plan?.subtopics) return null

  const needle = topicTitle.toLowerCase()

  const match = plan.subtopics.find((sub) => {
    if (sub.visual_status !== 'ready' || !sub.visual_spec) return false
    const haystack = sub.title.toLowerCase()
    // Match if titles share 3+ consecutive words or one contains the other
    const needleWords = needle.split(' ').slice(0, 4).join(' ')
    return haystack.includes(needleWords) || needle.includes(haystack.split(' ').slice(0, 4).join(' '))
  })

  return match?.visual_spec ?? null
}

export function buildInitialPlan(
  topicId: string,
  topicTitle: string,
  subtopicTitles: string[]
): SessionPlan {
  return {
    topic_id: topicId,
    topic_title: topicTitle,
    subtopics: subtopicTitles.map((title) => ({
      id: subtopicToId(title),
      title,
      visual_spec: null,
      visual_status: 'pending',
    })),
    plan_status: 'generating',
    generated_at: new Date().toISOString(),
  }
}
