import type { CurriculumPlan, CurriculumSession, CurriculumTopic } from '@/lib/content/curriculum'
import { TOOL_CATALOG, getDomainLessons } from '@/lib/content/tool-catalog'

/**
 * Builds a CurriculumPlan from a set of selected lesson IDs.
 * Preserves domain → category → topic order.
 * Groups lessons into sessions of up to 5 lessons each,
 * keeping lessons from the same topic together.
 */
export function buildCurriculumFromSelection(selectedLessonIds: string[]): CurriculumPlan {
  if (selectedLessonIds.length === 0) {
    return { sessions: [], totalMinutes: 0, totalTopics: 0, generatedAt: new Date().toISOString() }
  }

  const idSet = new Set(selectedLessonIds)

  // Walk catalog in order, collecting (domainTitle, categoryTitle, topicTitle, lesson) tuples
  const ordered: Array<{ domainTitle: string; categoryTitle: string; topicTitle: string; lessonTitle: string; minutes: number }> = []

  for (const domain of TOOL_CATALOG) {
    for (const cat of domain.categories) {
      for (const topic of cat.topics) {
        for (const lesson of topic.lessons) {
          if (idSet.has(lesson.id)) {
            ordered.push({
              domainTitle: domain.title,
              categoryTitle: cat.title,
              topicTitle: topic.title,
              lessonTitle: lesson.title,
              minutes: lesson.estimatedMinutes,
            })
          }
        }
      }
    }
  }

  // Group into sessions of 5 lessons each
  const LESSONS_PER_SESSION = 5
  const sessionChunks: (typeof ordered)[] = []
  for (let i = 0; i < ordered.length; i += LESSONS_PER_SESSION) {
    sessionChunks.push(ordered.slice(i, i + LESSONS_PER_SESSION))
  }

  const sessions: CurriculumSession[] = sessionChunks.map((chunk, i) => {
    // Title: if all lessons from same category, use "Domain — Category"; else domain
    const allSameDomain = chunk.every((l) => l.domainTitle === chunk[0].domainTitle)
    const allSameCat = chunk.every((l) => l.categoryTitle === chunk[0].categoryTitle)
    const sessionTitle = allSameDomain
      ? allSameCat
        ? `${chunk[0].domainTitle} — ${chunk[0].categoryTitle}`
        : chunk[0].domainTitle
      : 'Mixed Topics'

    const estimatedMinutes = chunk.reduce((sum, l) => sum + l.minutes, 0)

    const topic: CurriculumTopic = {
      id: `session-topic-${i}`,
      title: sessionTitle,
      estimatedMinutes,
      difficulty: 'beginner',
      prerequisites: [],
      tags: [chunk[0].domainTitle],
      subtopics: chunk.map((l) => l.lessonTitle),
    }

    return {
      index: i + 1,
      title: sessionTitle,
      topics: [topic],
      estimatedMinutes,
    }
  })

  const totalMinutes = sessions.reduce((sum, s) => sum + s.estimatedMinutes, 0)

  return {
    sessions,
    totalMinutes,
    totalTopics: ordered.length,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Returns all lesson IDs for a given domain ID.
 */
export function getLessonIdsForDomain(domainId: string): string[] {
  const domain = TOOL_CATALOG.find((d) => d.id === domainId)
  if (!domain) return []
  return getDomainLessons(domain).map((l) => l.id)
}
