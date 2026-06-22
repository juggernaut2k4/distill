/**
 * Topic content cache — persists generated TemplateSection data per topic+subtopic+industry+role.
 * Separate rows per user context: Financial Services ≠ Retail, even for the same subtopic.
 *
 * Cache key: (topic_id, subtopic_slug, industry, role)
 * Generic fallback: rows with industry='' and role='' (pre-migration content or shared content).
 * Lookup order:
 *   1. Exact match (industry+role)
 *   2. Adaptation: find any existing real-context row → adapt via Claude for target context → save + return
 *   3. Generic fallback ('')
 */

import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from './supabase'
import type { TemplateSection, TemplateName } from './templates/types'

const _isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const _anthropic = _isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
 * Adapts an existing TemplateSection from one industry/role context to another using Claude.
 * Much cheaper than full regeneration — same template structure, only industry-specific
 * framing, examples, and so_what lines are rewritten.
 * Returns null if adaptation fails (caller falls through to generic or full generation).
 */
async function adaptSection(
  existing: TemplateSection,
  fromCtx: { role: string; industry: string },
  toCtx: { role: string; industry: string }
): Promise<TemplateSection | null> {
  if (!_anthropic) return null
  try {
    const response = await _anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system:
        'You are adapting structured educational content from one business context to another. ' +
        'Keep the same JSON structure and template type exactly. ' +
        'Only rewrite industry-specific examples, company names, metrics, and "so_what" lines ' +
        'to be relevant to the new industry and role. Conceptual accuracy must be preserved. ' +
        'Return ONLY valid JSON — no markdown, no explanation, no code fences.',
      messages: [
        {
          role: 'user',
          content:
            `Original content was written for: industry="${fromCtx.industry}", role="${fromCtx.role}".\n` +
            `Adapt it for: industry="${toCtx.industry}", role="${toCtx.role}".\n\n` +
            `JSON to adapt:\n${JSON.stringify(existing.data, null, 2)}`,
        },
      ],
    })

    const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
    const adaptedData = JSON.parse(raw)
    return {
      ...existing,
      data: adaptedData,
      meta: { ...existing.meta, userRole: toCtx.role, userIndustry: toCtx.industry },
    } as TemplateSection
  } catch (err) {
    console.warn('[topic-cache] Adaptation failed (non-fatal):', err)
    return null
  }
}

/**
 * Returns cached TemplateSection for a given topic+subtopic+industry+role, or null on miss/expiry.
 * Lookup order:
 *   1. Exact match (industry+role)
 *   2. Adaptation: any existing real-context row → Claude adapts it → saves new row → returns
 *   3. Generic fallback ('')
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

    // 2. Adaptation: find any existing real-context row and adapt it for this user's context.
    //    Skipped when industry/role are blank (no target context to adapt toward).
    if (industry && role) {
      const { data: donor } = await supabase
        .from('topic_content_cache')
        .select('id, section_data, subtopic_title, industry, role, use_count')
        .eq('topic_id', topicId)
        .eq('subtopic_slug', subtopicSlug)
        .gt('expires_at', now)
        .neq('industry', '') // only adapt from a real context, never from the generic ''
        .limit(1)
        .maybeSingle()

      if (donor) {
        const fromCtx = { role: donor.role as string, industry: donor.industry as string }
        const adapted = await adaptSection(donor.section_data as TemplateSection, fromCtx, { role, industry })
        if (adapted) {
          // Save adapted row for future hits on this context (async, non-blocking)
          setCachedSection(topicId, subtopicSlug, donor.subtopic_title as string, adapted, { role, industry }).catch(() => {})
          console.log(`[topic-cache] Adaptation hit: ${topicId}/${subtopicSlug} (${fromCtx.industry}/${fromCtx.role} → ${industry}/${role})`)
          return adapted
        }
      }
    }

    // 3. Generic fallback: shared content cached without a specific industry/role context
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
