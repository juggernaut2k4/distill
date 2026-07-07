/**
 * CONTENT-02 — single source of truth for "is this session's generated
 * content actually ready to teach from."
 *
 * Background: `sessions.content_status` can be written to `'ready'` by more
 * than one code path (the standard pipeline's Step H, the LIVE_CONDUCTOR_ENABLED
 * branch, and app/api/hume-native/provision-config/route.ts's self-heal path).
 * One of those paths (provision-config) was found writing `content_status:
 * 'ready'` BEFORE its own completeness check ran, with no rollback on failure —
 * this let a real session end up marked "ready" with zero usable content.
 *
 * verifyContentReadiness() is the ONLY function permitted to determine whether
 * a session's generated content is real enough to mark content_status =
 * 'ready'. It must be called immediately before every write of
 * content_status: 'ready', in the same function/request that performs that
 * write — never cached, never trusted from a prior check.
 *
 * HARD RULE: any future call site that writes content_status: 'ready' must
 * call verifyContentReadiness() immediately before that write, in the same
 * function. Do not add a fourth call site without wiring this in — the three
 * existing call sites (session-content-pipeline.ts Step H, its LIVE-01
 * branch, and provision-config/route.ts) all do this; see the one-line
 * comment pointing back to this file at each of them.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LiveConductorContent } from './live-conductor-content'

export interface ContentReadinessResult {
  ready: boolean
  reason?: string
  topicContentCacheRows?: number
  liveConductorTabs?: number
}

/**
 * A session is ready if EITHER:
 *   - topic_content_cache has at least 1 row for topic_id = sessionId
 *     (the standard pipeline path), OR
 *   - live_conductor_content.tabs is a non-empty array with every tab
 *     containing a non-empty article.subtopic_title and at least one
 *     non-empty prose field under article.sections (the live-conductor path).
 *
 * A session is NOT ready if neither condition holds. This function never
 * infers readiness from content_status itself — that would be circular.
 * DB query failures are always treated as "not ready," never as "ready."
 */
export async function verifyContentReadiness(
  supabase: SupabaseClient,
  sessionId: string,
  liveConductorContent?: LiveConductorContent | null
): Promise<ContentReadinessResult> {
  const { count, error: countError } = await supabase
    .from('topic_content_cache')
    .select('id', { count: 'exact', head: true })
    .eq('topic_id', sessionId)

  if (countError) {
    return {
      ready: false,
      reason: `topic_content_cache count query failed for session ${sessionId}: ${countError.message}`,
    }
  }

  const topicContentCacheRows = count ?? 0
  if (topicContentCacheRows > 0) {
    return { ready: true, topicContentCacheRows }
  }

  // Fall back to the live-conductor branch of the check.
  const tabs = liveConductorContent?.tabs ?? []
  const liveConductorTabs = tabs.length

  if (liveConductorTabs === 0) {
    return {
      ready: false,
      reason: `No topic_content_cache rows for session ${sessionId} and no live_conductor_content tabs provided`,
      topicContentCacheRows,
      liveConductorTabs,
    }
  }

  const everyTabHasContent = tabs.every((tab) => {
    const subtopicTitle = tab?.article?.subtopic_title
    if (typeof subtopicTitle !== 'string' || subtopicTitle.trim().length === 0) return false

    const sections = tab?.article?.sections
    if (!sections) return false

    const hasNonEmptyProse = Object.values(sections).some((value) => {
      if (typeof value === 'string') return value.trim().length > 0
      if (Array.isArray(value)) return value.some((v) => typeof v === 'string' && v.trim().length > 0)
      return false
    })

    return hasNonEmptyProse
  })

  if (!everyTabHasContent) {
    return {
      ready: false,
      reason: `live_conductor_content.tabs present (${liveConductorTabs}) for session ${sessionId} but at least one tab is missing subtopic_title or has no non-empty article.sections prose`,
      topicContentCacheRows,
      liveConductorTabs,
    }
  }

  return { ready: true, topicContentCacheRows, liveConductorTabs }
}
