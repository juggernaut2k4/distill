/**
 * Topic content cache — persists generated TemplateSection data per topic+subtopic
 * so sessions on the same topic serve instantly from DB instead of calling Claude.
 *
 * Cache key: (topic_id, subtopic_slug)  — shared across all users.
 * Meta patching: userRole/userIndustry are updated to match the current user on
 * cache hits so display context stays accurate even though data is shared.
 */

import { createSupabaseAdminClient } from './supabase'
import type { TemplateSection, TemplateName } from './templates/types'

// Time-sensitive templates (stats, timelines, case studies) expire in 14–21 days.
// Conceptual templates (frameworks, definitions, step flows) last 60 days.
const TTL_DAYS: Partial<Record<TemplateName, number>> = {
  StatCallout:  14,
  Timeline:     14,
  CaseStudy:    21,
  TopicHero:    30,
  KeyTakeaway:  30,
  ActionPlan:   30,
  QuoteCallout: 30,
}
const DEFAULT_TTL_DAYS = 60

function getTtlDays(type: TemplateName): number {
  return TTL_DAYS[type] ?? DEFAULT_TTL_DAYS
}

/**
 * Returns the cached TemplateSection for a given topic+subtopic, or null on miss/expiry.
 * Patches meta.userRole/userIndustry to the current user so display labels are accurate.
 */
export async function getCachedSection(
  topicId: string,
  subtopicSlug: string,
  userContext?: { role: string; industry: string }
): Promise<TemplateSection | null> {
  try {
    const supabase = createSupabaseAdminClient()
    const { data } = await supabase
      .from('topic_content_cache')
      .select('id, section_data, use_count')
      .eq('topic_id', topicId)
      .eq('subtopic_slug', subtopicSlug)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (!data) return null

    // Bump use_count without blocking the caller
    supabase
      .from('topic_content_cache')
      .update({ use_count: data.use_count + 1 })
      .eq('id', data.id)
      .then(() => {})

    const section = data.section_data as TemplateSection

    // Patch meta so the current user's role/industry appears in display context
    if (userContext) {
      return {
        ...section,
        meta: {
          ...section.meta,
          userRole: userContext.role,
          userIndustry: userContext.industry,
        },
      } as TemplateSection
    }

    return section
  } catch {
    // Cache read failures are non-fatal — generation will proceed normally
    return null
  }
}

/**
 * Writes a generated TemplateSection to the cache with the appropriate TTL.
 * Uses upsert so concurrent session launches for the same topic don't conflict.
 */
export async function setCachedSection(
  topicId: string,
  subtopicSlug: string,
  subtopicTitle: string,
  section: TemplateSection
): Promise<void> {
  try {
    const ttlDays = getTtlDays(section.type)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + ttlDays)

    const supabase = createSupabaseAdminClient()
    await supabase
      .from('topic_content_cache')
      .upsert(
        {
          topic_id:      topicId,
          subtopic_slug: subtopicSlug,
          subtopic_title: subtopicTitle,
          template_type: section.type,
          section_data:  section,
          generated_at:  new Date().toISOString(),
          expires_at:    expiresAt.toISOString(),
          use_count:     1,
        },
        { onConflict: 'topic_id,subtopic_slug' }
      )
  } catch (err) {
    // Non-fatal — content was already generated and returned to caller
    console.warn('[topic-cache] Cache write failed (non-fatal):', err)
  }
}
