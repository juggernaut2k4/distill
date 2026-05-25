/**
 * Profile-keyed content cache.
 * Any user with the same (role, domain, proficiency, topic, subtopic) gets the
 * same pre-generated, AI-validated content — no redundant generation.
 */

import { createSupabaseAdminClient } from '@/lib/supabase'
import { buildProfileKey } from './taxonomy'
import type { TemplateSection } from '@/lib/templates/types'

export interface ProfileCacheKey {
  role: string
  domain: string
  proficiency: string
  topicSlug: string
  subtopicSlug: string
}

export interface CachedSectionRow {
  id: string
  profile_key: string
  section_data: TemplateSection
  template_type: string
  overflow_validated: boolean
  generated_at: string
}

// ─── READ ─────────────────────────────────────────────────────────────────────

/**
 * Returns cached content for a profile+topic+subtopic combination, or null
 * if no cache entry exists or the entry has expired.
 */
export async function getCachedSection(
  key: ProfileCacheKey
): Promise<TemplateSection | null> {
  const supabase = createSupabaseAdminClient()
  const profileKey = buildProfileKey(key.role, key.domain, key.proficiency)

  const { data } = await supabase
    .from('content_profile_cache')
    .select('section_data, expires_at')
    .eq('profile_key', profileKey)
    .eq('topic_slug', key.topicSlug)
    .eq('subtopic_slug', key.subtopicSlug)
    .maybeSingle()

  if (!data) return null

  // Treat expired entries as a miss so fresh content is generated
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null

  return data.section_data as TemplateSection
}

/**
 * Batch fetch — returns a map of subtopicSlug → TemplateSection for
 * all subtopics in a session that already have cached content.
 */
export async function getCachedSectionsBatch(
  role: string,
  domain: string,
  proficiency: string,
  topicSlug: string,
  subtopicSlugs: string[]
): Promise<Map<string, TemplateSection>> {
  const supabase = createSupabaseAdminClient()
  const profileKey = buildProfileKey(role, domain, proficiency)

  const { data } = await supabase
    .from('content_profile_cache')
    .select('subtopic_slug, section_data, expires_at')
    .eq('profile_key', profileKey)
    .eq('topic_slug', topicSlug)
    .in('subtopic_slug', subtopicSlugs)

  const result = new Map<string, TemplateSection>()
  const now = new Date()
  for (const row of data ?? []) {
    if (row.expires_at && new Date(row.expires_at) < now) continue
    result.set(row.subtopic_slug, row.section_data as TemplateSection)
  }
  return result
}

// ─── WRITE ────────────────────────────────────────────────────────────────────

/**
 * Saves a generated and validated section to the profile cache.
 * Uses upsert so re-generating a profile updates the cached version.
 */
export async function saveCachedSection(
  key: ProfileCacheKey,
  section: TemplateSection,
  options?: { overflowValidated?: boolean; qaScore?: number; validationNotes?: string }
): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const profileKey = buildProfileKey(key.role, key.domain, key.proficiency)

  await supabase
    .from('content_profile_cache')
    .upsert(
      {
        profile_key:        profileKey,
        role:               key.role,
        domain:             key.domain,
        proficiency:        key.proficiency,
        topic_slug:         key.topicSlug,
        subtopic_slug:      key.subtopicSlug,
        section_data:       section,
        template_type:      section.type,
        overflow_validated: options?.overflowValidated ?? false,
        qa_score:           options?.qaScore ?? null,
        validation_notes:   options?.validationNotes ?? null,
        generated_at:       new Date().toISOString(),
        expires_at:         new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'profile_key,topic_slug,subtopic_slug' }
    )
}

/**
 * Marks a cached section as overflow-validated after server-side word-count
 * check passes.
 */
export async function markSectionValidated(
  key: ProfileCacheKey,
  notes?: string
): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const profileKey = buildProfileKey(key.role, key.domain, key.proficiency)

  await supabase
    .from('content_profile_cache')
    .update({ overflow_validated: true, validation_notes: notes ?? 'passed word-count check' })
    .eq('profile_key', profileKey)
    .eq('topic_slug', key.topicSlug)
    .eq('subtopic_slug', key.subtopicSlug)
}

// ─── INVALIDATION ─────────────────────────────────────────────────────────────

/**
 * Deletes all cached sections for a profile — used when proficiency changes
 * or the user explicitly requests fresh content.
 */
export async function invalidateProfileCache(
  role: string,
  domain: string,
  proficiency: string
): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const profileKey = buildProfileKey(role, domain, proficiency)

  await supabase
    .from('content_profile_cache')
    .delete()
    .eq('profile_key', profileKey)
}

// ─── STATS ────────────────────────────────────────────────────────────────────

/**
 * Returns cache coverage for a topic — useful for pre-session validation
 * to know which subtopics still need generation.
 */
export async function getCacheStats(
  role: string,
  domain: string,
  proficiency: string,
  topicSlug: string,
  subtopicSlugs: string[]
): Promise<{ cached: string[]; missing: string[] }> {
  const cached = await getCachedSectionsBatch(role, domain, proficiency, topicSlug, subtopicSlugs)
  return {
    cached:  subtopicSlugs.filter((s) => cached.has(s)),
    missing: subtopicSlugs.filter((s) => !cached.has(s)),
  }
}
