import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShowcaseAccess } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateShowcaseVisualization } from '@/lib/partner/showcase'

/**
 * PATCH /api/channel-partner/showcase/visualizations/[topicId]
 *
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §6.6). Verifies the
 * topic belongs to the caller's own account (same ownership-check
 * convention as `requireChannelPartnerClientAccess` — indistinguishable
 * error whether the topic doesn't exist or isn't the caller's), runs the
 * real template pipeline (`generateShowcaseVisualization`), and upserts on
 * `showcase_topic_id` (unique constraint, migration 089). A topic can be
 * re-visualized any number of times — re-fetching the existing row's id
 * before generation keeps the render URL stable across re-saves (requirement
 * doc §9 Edge Case: "the render URL ... stays stable across re-saves").
 */

const PatchSchema = z.object({
  excerpt: z.string().min(1).max(4000),
  transitionTrigger: z.string().min(1).max(500),
})

export async function PATCH(request: NextRequest, { params }: { params: { topicId: string } }) {
  const access = await requireShowcaseAccess()
  if (access.error) return access.error

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const supabase = createSupabaseAdminClient()

  const { data: topic } = await supabase
    .from('partner_showcase_topics')
    .select('id, title, partner_account_id, showcase_content_id')
    .eq('id', params.topicId)
    .maybeSingle()

  if (!topic || topic.partner_account_id !== access.partnerAccountId) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Topic not found.' } }, { status: 404 })
  }

  const [{ data: content }, { data: existingViz }] = await Promise.all([
    supabase.from('partner_showcase_content').select('title').eq('id', topic.showcase_content_id).maybeSingle(),
    supabase.from('partner_showcase_visualizations').select('id').eq('showcase_topic_id', topic.id).maybeSingle(),
  ])

  // Reuse the existing row's id across re-saves so a previously-copied
  // render URL keeps working; a fresh UUID only on first-ever save.
  const visualizationId = (existingViz?.id as string | undefined) ?? crypto.randomUUID()

  let templateSection
  try {
    templateSection = await generateShowcaseVisualization(
      topic.title as string,
      (content?.title as string | null) ?? (topic.title as string),
      parsed.data.excerpt,
      visualizationId
    )
  } catch (err) {
    console.error('[channel-partner/showcase/visualizations] generation failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: { code: 'generation_failed', message: "Couldn't generate a visualization. Try again." } },
      { status: 500 }
    )
  }

  const { data: upserted, error } = await supabase
    .from('partner_showcase_visualizations')
    .upsert(
      {
        id: visualizationId,
        showcase_topic_id: topic.id,
        partner_account_id: access.partnerAccountId,
        excerpt_text: parsed.data.excerpt,
        transition_trigger: parsed.data.transitionTrigger,
        template_section: templateSection,
      },
      { onConflict: 'showcase_topic_id' }
    )
    .select('id')
    .single()

  if (error || !upserted) {
    console.error('[channel-partner/showcase/visualizations] upsert failed:', error?.message)
    return NextResponse.json(
      { error: { code: 'internal_error', message: "Couldn't generate a visualization. Try again." } },
      { status: 500 }
    )
  }

  return NextResponse.json({
    id: upserted.id as string,
    transitionTrigger: parsed.data.transitionTrigger,
    templateSection,
  })
}
