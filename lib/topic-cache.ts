/**
 * Topic content cache — persists generated TemplateSection data per topic+subtopic+industry+role.
 * Separate rows per user context: Financial Services ≠ Retail, even for the same subtopic.
 *
 * Cache key: (topic_id, subtopic_slug, industry, role)
 * Generic fallback: rows with industry='' and role='' (pre-migration content or shared content).
 * Lookup order: exact match (industry+role) first → generic fallback ('') second.
 */

import { createSupabaseAdminClient } from './supabase'
import type { TemplateSection, TemplateName } from './templates/types'

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

function patchMeta(section: TemplateSection, userContext?: { role: string; industry: string }): TemplateSection {
  if (!userContext) return section
  return {
    ...section,
    meta: { ...section.meta, userRole: userContext.role, userIndustry: userContext.industry },
  } as TemplateSection
}

/**
 * Returns cached TemplateSection for a given topic+subtopic+industry+role, or null on miss/expiry.
 * Lookup order: exact (industry+role) match → generic ('') fallback for shared content.
 */
export async function getCachedSection(
  topicId: string,
  subtopicSlug: string,
  userContext?: { role: string; industry: string }
): Promise<TemplateSection | null> {
  try {
    const supabase = createSupabaseAdminClient()
    const now = new Date().toISOString()

    const industry = userContext?.industry ?? ''
    const role = userContext?.role ?? ''

    // 1. Exact match for this user's industry + role
    if (industry && role) {
      const { data: exact } = await supabase
        .from('topic_content_cache')
        .select('id, section_data, use_count')
        .eq('topic_id', topicId)
        .eq('subtopic_slug', subtopicSlug)
        .eq('industry', industry)
        .eq('role', role)
        .gt('expires_at', now)
        .maybeSingle()

      if (exact) {
        supabase.from('topic_content_cache').update({ use_count: exact.use_count + 1 }).eq('id', exact.id).then(() => {})
        return patchMeta(exact.section_data as TemplateSection, userContext)
      }
    }

    // 2. Generic fallback: shared content cached without a specific industry/role context
    const { data: generic } = await supabase
      .from('topic_content_cache')
      .select('id, section_data, use_count')
      .eq('topic_id', topicId)
      .eq('subtopic_slug', subtopicSlug)
      .eq('industry', '')
      .eq('role', '')
      .gt('expires_at', now)
      .maybeSingle()

    if (!generic) return null

    supabase.from('topic_content_cache').update({ use_count: generic.use_count + 1 }).eq('id', generic.id).then(() => {})
    return patchMeta(generic.section_data as TemplateSection, userContext)
  } catch {
    return null
  }
}

/**
 * Writes a generated TemplateSection to the cache with the appropriate TTL.
 * Keyed by (topic_id, subtopic_slug, industry, role) — '' for shared/generic rows.
 */
export async function setCachedSection(
  topicId: string,
  subtopicSlug: string,
  subtopicTitle: string,
  section: TemplateSection,
  userContext?: { role: string; industry: string }
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
          topic_id:       topicId,
          subtopic_slug:  subtopicSlug,
          subtopic_title: subtopicTitle,
          template_type:  section.type,
          section_data:   section,
          industry:       userContext?.industry ?? '',
          role:           userContext?.role ?? '',
          generated_at:   new Date().toISOString(),
          expires_at:     expiresAt.toISOString(),
          use_count:      1,
        },
        { onConflict: 'topic_id,subtopic_slug,industry,role' }
      )
  } catch (err) {
    console.warn('[topic-cache] Cache write failed (non-fatal):', err)
  }
}
