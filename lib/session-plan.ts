/**
 * Session plan generation — pre-generates template sections for all subtopics
 * before the session starts so visuals render instantly during coaching.
 *
 * Cache layer: generated sections are stored in topic_content_cache so repeated
 * sessions on the same topic skip Claude entirely and serve from the database.
 */

import { selectTemplate } from './templates/selector'
import { generateTemplateData } from './templates/generator'
import { getCachedSection, setCachedSection } from './topic-cache'
import type { TemplateSection, TemplateMeta } from './templates/types'

export interface SessionPlanSubtopic {
  id: string
  title: string
  template_section: TemplateSection | null
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

async function generateSubtopicSection(
  sub: SessionPlanSubtopic,
  position: 'first' | 'middle' | 'last',
  sessionTitle: string,
  userContext: { role: string; industry: string; maturity: string },
  topicId: string,
  adjacentTopics?: { previous?: string; next?: string }
): Promise<SessionPlanSubtopic> {
  try {
    // Check cache before calling Claude
    const cached = await getCachedSection(topicId, sub.id, {
      role: userContext.role,
      industry: userContext.industry,
    })
    if (cached) {
      console.log('[session-plan] Cache hit:', topicId, sub.id)
      return { ...sub, template_section: cached, visual_status: 'ready' }
    }

    const templateType = selectTemplate(sub.title, position)
    const meta: TemplateMeta = {
      subtopicTitle: sub.title,
      sessionTitle,
      userRole: userContext.role,
      userIndustry: userContext.industry,
    }
    const data = await generateTemplateData(
      templateType,
      sub.title,
      sessionTitle,
      userContext,
      adjacentTopics
    )
    const section = { id: sub.id, type: templateType, data, meta, status: 'pending' as const } as TemplateSection

    // Write to cache async — don't block returning the section to the caller
    setCachedSection(topicId, sub.id, sub.title, section).catch(() => {})

    return { ...sub, template_section: section, visual_status: 'ready' }
  } catch (err) {
    console.error('[session-plan] Template generation failed for subtopic:', sub.title, err)
    return { ...sub, visual_status: 'failed' }
  }
}

/**
 * Generates the template section for the first subtopic only.
 * Returns updated subtopics with the first section ready, rest still pending.
 * Enables the session launch button as soon as the first section is ready.
 */
export async function generateFirstSubtopicVisual(
  subtopicTitles: string[],
  userProfile: { role?: string | null; industry?: string | null; ai_maturity?: string | null },
  sessionTitle = '',
  topicId = ''
): Promise<SessionPlanSubtopic[]> {
  const userContext = {
    role: userProfile.role ?? 'executive',
    industry: userProfile.industry ?? 'business',
    maturity: userProfile.ai_maturity ?? 'beginner',
  }

  const subtopics: SessionPlanSubtopic[] = subtopicTitles.map((title) => ({
    id: subtopicToId(title),
    title,
    template_section: null,
    visual_status: 'pending' as const,
  }))

  if (subtopics.length === 0) return subtopics

  const position = subtopics.length === 1 ? 'first' : 'first'
  const adjacentTopics = subtopics.length > 1 ? { next: subtopics[1].title } : undefined
  const first = await generateSubtopicSection(subtopics[0], position, sessionTitle, userContext, topicId, adjacentTopics)
  return [first, ...subtopics.slice(1)]
}

/**
 * Generates template sections for all remaining subtopics (index 1+) in parallel.
 * Call after generateFirstSubtopicVisual so the rest complete in background.
 */
export async function generateRemainingSubtopicVisuals(
  subtopics: SessionPlanSubtopic[],
  userProfile: { role?: string | null; industry?: string | null; ai_maturity?: string | null },
  sessionTitle = '',
  topicId = ''
): Promise<SessionPlanSubtopic[]> {
  if (subtopics.length <= 1) return subtopics

  const userContext = {
    role: userProfile.role ?? 'executive',
    industry: userProfile.industry ?? 'business',
    maturity: userProfile.ai_maturity ?? 'beginner',
  }

  const remaining = await Promise.all(
    subtopics.slice(1).map((sub, idx) => {
      if (sub.visual_status === 'ready') return Promise.resolve(sub)
      const absoluteIdx = idx + 1
      const position = absoluteIdx === subtopics.length - 1 ? 'last' : 'middle'
      const adjacentTopics = {
        previous: subtopics[absoluteIdx - 1]?.title,
        next: subtopics[absoluteIdx + 1]?.title,
      }
      return generateSubtopicSection(sub, position, sessionTitle, userContext, topicId, adjacentTopics)
    })
  )

  return [subtopics[0], ...remaining]
}

/**
 * Returns all ready TemplateSections from a session plan, in order.
 * Used to populate walkthrough_state.sections at session launch.
 */
export function getAllReadySections(plan: SessionPlan | null): TemplateSection[] {
  if (!plan?.subtopics) return []
  return plan.subtopics
    .filter((s) => s.visual_status === 'ready' && s.template_section)
    .map((s) => s.template_section!)
}

/**
 * Finds a pre-generated TemplateSection matching the given topic title.
 * Used to find a specific section by title during a live session.
 */
export function findPreGeneratedSection(
  plan: SessionPlan | null,
  topicTitle: string
): TemplateSection | null {
  if (!plan?.subtopics) return null
  const needle = topicTitle.toLowerCase()
  const match = plan.subtopics.find((sub) => {
    if (sub.visual_status !== 'ready' || !sub.template_section) return false
    const haystack = sub.title.toLowerCase()
    const needleWords = needle.split(' ').slice(0, 4).join(' ')
    return haystack.includes(needleWords) || needle.includes(haystack.split(' ').slice(0, 4).join(' '))
  })
  return match?.template_section ?? null
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
      template_section: null,
      visual_status: 'pending',
    })),
    plan_status: 'generating',
    generated_at: new Date().toISOString(),
  }
}
