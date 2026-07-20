import { NextResponse } from 'next/server'
import { requireShowcaseAccess } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { regenerateShowcaseTopics } from '@/lib/partner/showcase'

/**
 * GET/POST /api/channel-partner/showcase/topics
 *
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §6.6). GET returns
 * `{ topics: [{ id, title, position, visualization: {...} | null }] }` — two
 * simple queries (topics, then their visualizations) merged in JS rather
 * than a single embedded-join query, matching this codebase's usual
 * route-file style. POST calls `regenerateShowcaseTopics` (auto-fired by the
 * client on first visit with zero topics, or explicitly via "Regenerate
 * topics") — 422 if no Content row exists yet (AT-7: client never fires this
 * call in that state; this check is defensive-only on the server).
 */

interface VisualizationRow {
  id: string
  showcase_topic_id: string
  excerpt_text: string
  transition_trigger: string
  template_section: unknown
}

export async function GET() {
  const access = await requireShowcaseAccess()
  if (access.error) return access.error

  const supabase = createSupabaseAdminClient()
  const { data: topicRows } = await supabase
    .from('partner_showcase_topics')
    .select('id, title, position')
    .eq('partner_account_id', access.partnerAccountId)
    .order('position', { ascending: true })

  const topics = topicRows ?? []
  const topicIds = topics.map((t) => t.id as string)

  const visualizationsByTopicId = new Map<string, VisualizationRow>()
  if (topicIds.length > 0) {
    const { data: vizRows } = await supabase
      .from('partner_showcase_visualizations')
      .select('id, showcase_topic_id, excerpt_text, transition_trigger, template_section')
      .in('showcase_topic_id', topicIds)
    for (const v of (vizRows ?? []) as VisualizationRow[]) {
      visualizationsByTopicId.set(v.showcase_topic_id, v)
    }
  }

  return NextResponse.json({
    topics: topics.map((t) => {
      const viz = visualizationsByTopicId.get(t.id as string)
      return {
        id: t.id,
        title: t.title,
        position: t.position,
        visualization: viz
          ? {
              id: viz.id,
              excerptText: viz.excerpt_text,
              transitionTrigger: viz.transition_trigger,
              templateSection: viz.template_section,
            }
          : null,
      }
    }),
  })
}

export async function POST() {
  const access = await requireShowcaseAccess()
  if (access.error) return access.error

  const supabase = createSupabaseAdminClient()
  const { data: content } = await supabase
    .from('partner_showcase_content')
    .select('id, title, subtitle, content_to_explain')
    .eq('partner_account_id', access.partnerAccountId)
    .maybeSingle()

  if (!content) {
    return NextResponse.json({ error: { code: 'content_required', message: 'Save some Content first.' } }, { status: 422 })
  }

  try {
    await regenerateShowcaseTopics(access.partnerAccountId, content.id as string, {
      title: (content.title as string | null) ?? null,
      subtitle: (content.subtitle as string | null) ?? null,
      contentToExplain: (content.content_to_explain as string | null) ?? null,
    })
  } catch (err) {
    console.error('[channel-partner/showcase/topics] grouping failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: { code: 'grouping_failed', message: "Couldn't group your content into topics. Try again." } },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
