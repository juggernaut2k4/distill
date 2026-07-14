import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateTrainingScript } from '@/lib/content/script-generator'
import { generateTemplateData } from '@/lib/templates/generator'
import { selectTemplate } from '@/lib/templates/selector'
import type { SubSessionOutline } from '@/lib/content/session-content-generator'
import type { TemplateSection, TemplateName } from '@/lib/templates/types'
import { pushPartnerContent } from './render-data'
import { recordBillableEvent } from './webhooks'

/**
 * B2B-03 — Content generation (Requirement Doc Section 6.3, architecture.md
 * Section 12.4).
 *
 * `lib/content/generator.ts` + `lib/content/personalizer.ts` (the retired B2C
 * daily-tip pipeline) are NOT the reuse target — confirmed by reading both in
 * full; they are keyed to `users`/`delivery_log`/`content_items`, all retired
 * B2C schema. The correct reuse target is the session-content pipeline:
 * `lib/content/session-content-generator.ts` (SubSessionOutline shape) →
 * `lib/content/script-generator.ts` (`generateTrainingScript`, reused
 * verbatim) → `lib/templates/generator.ts` + `lib/templates/selector.ts`
 * (`generateTemplateData`/`selectTemplate`, reused verbatim).
 *
 * New plumbing (this module): today's pipeline's first stage
 * (`generateSessionContentOutline`) is keyed to `session_id`/`topic_id`/Clerk
 * `user_id` and reads prior-session history for "never repeat material"
 * logic — none of which exists for a partner-authored `partner_topic_ref`
 * with no session/user history. `buildPartnerOutline` below is this
 * document's new, partner-scoped replacement for that first stage only —
 * it produces the same `SubSessionOutline` shape but with `builds_on: []`
 * and no continuity lookups, consistent with Objective 2 (continuity is a
 * live, profile-driven narration concern, not a generation-time one).
 */

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/**
 * New, partner-scoped replacement for `generateSessionContentOutline`'s
 * first-stage output — no session/user history, no continuity logic
 * (Section 6.3). Uses the same mock/LLM-fallback convention as the rest of
 * this codebase's generators (`isPlaceholder` guard).
 */
export async function buildPartnerOutline(partnerTopicRef: string): Promise<SubSessionOutline> {
  if (isPlaceholder) {
    return {
      subtopic_title: partnerTopicRef,
      subtopic_slug: slugify(partnerTopicRef),
      position: 'middle',
      content_summary: `An overview of ${partnerTopicRef}, generated for this partner's own end users.`,
      key_concepts: [`What ${partnerTopicRef} means in practice`, 'Common pitfalls', 'The decisions this affects'],
      builds_on: [],
      new_to_user: true,
      coaching_narrative: `Let's walk through ${partnerTopicRef}. This overview covers what it means in practice, the common pitfalls to avoid, and the decisions it affects — so you leave with a clear, actionable understanding, not just definitions.`,
      visual_spec: {
        headline: partnerTopicRef.split(' ').slice(0, 6).join(' '),
        items: [`What ${partnerTopicRef} means`, 'Common pitfalls', 'Key decisions'],
        template_hint: '',
        so_what: `Understanding this shapes how you approach ${partnerTopicRef} going forward.`,
      },
      checkpoint_question: `Where do you see the biggest gap on ${partnerTopicRef} today?`,
    }
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `Produce a JSON object (no markdown fences) describing a single learning subtopic titled "${partnerTopicRef}" for a partner's own end users. Shape:
{
  "content_summary": string (1-2 sentences),
  "key_concepts": string[] (3 items),
  "coaching_narrative": string (~250-300 words, spoken-style explanation),
  "visual_spec": { "headline": string (max 8 words), "items": string[] (3-5 items), "template_hint": string, "so_what": string (max 30 words) },
  "checkpoint_question": string
}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  const raw = textBlock && 'text' in textBlock ? textBlock.text : '{}'
  const parsed = JSON.parse(raw.replace(/^```json\s*|```\s*$/g, ''))

  return {
    subtopic_title: partnerTopicRef,
    subtopic_slug: slugify(partnerTopicRef),
    position: 'middle',
    content_summary: parsed.content_summary ?? '',
    key_concepts: parsed.key_concepts ?? [],
    builds_on: [],
    new_to_user: true,
    coaching_narrative: parsed.coaching_narrative ?? '',
    visual_spec: parsed.visual_spec ?? { headline: partnerTopicRef, items: [], template_hint: '', so_what: '' },
    checkpoint_question: parsed.checkpoint_question ?? '',
  }
}

// ─── Content source toggle (Section 4.A.3; gap-closing table, see migration 074) ──

export type ContentSource = 'clio_generated' | 'partner_supplied'

export async function getContentSource(partnerAccountId: string): Promise<ContentSource> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_content_config')
    .select('content_source')
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()
  return (data?.content_source as ContentSource | undefined) ?? 'clio_generated'
}

export async function setContentSource(partnerAccountId: string, contentSource: string): Promise<{ ok: true; data: ContentSource } | { ok: false; error: string }> {
  if (contentSource !== 'clio_generated' && contentSource !== 'partner_supplied') {
    return { ok: false, error: 'invalid_content_source' }
  }
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_content_config')
    .upsert({ partner_account_id: partnerAccountId, content_source: contentSource }, { onConflict: 'partner_account_id' })
    .select('content_source')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'upsert_failed' }
  return { ok: true, data: data.content_source as ContentSource }
}

export interface PartnerContentItem {
  id: string
  partnerAccountId: string
  partnerTopicRef: string
  status: 'generating' | 'ready_for_review' | 'approved' | 'rejected' | 'failed'
  draftPayload: unknown
  contentRef: string | null
  createdAt: string
  expiresAt: string
}

function rowToItem(row: Record<string, unknown>): PartnerContentItem {
  return {
    id: row.id as string,
    partnerAccountId: row.partner_account_id as string,
    partnerTopicRef: row.partner_topic_ref as string,
    status: row.status as PartnerContentItem['status'],
    draftPayload: row.draft_payload,
    contentRef: (row.content_ref as string | null) ?? null,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
  }
}

export async function listContentItems(partnerAccountId: string): Promise<PartnerContentItem[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_content_items')
    .select('*')
    .eq('partner_account_id', partnerAccountId)
    .order('created_at', { ascending: false })
  return (data ?? []).map(rowToItem)
}

export async function getContentItem(partnerAccountId: string, id: string): Promise<PartnerContentItem | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_content_items')
    .select('*')
    .eq('partner_account_id', partnerAccountId)
    .eq('id', id)
    .maybeSingle()
  return data ? rowToItem(data) : null
}

/** Creates the `generating` row. The actual pipeline run is dispatched separately (see inngest/partner-content-generation.ts) so this returns immediately, matching Section 4.A.3's "appears immediately with status GENERATING" UI contract. */
export async function createContentItem(partnerAccountId: string, partnerTopicRef: string): Promise<PartnerContentItem | null> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_content_items')
    .insert({ partner_account_id: partnerAccountId, partner_topic_ref: partnerTopicRef, status: 'generating' })
    .select('*')
    .single()

  if (error || !data) {
    console.error('[partner/content-generation] createContentItem failed:', error?.message)
    return null
  }
  return rowToItem(data)
}

export interface DraftPayload {
  outline: SubSessionOutline
  script: Awaited<ReturnType<typeof generateTrainingScript>>
  /**
   * One or more rendered template sections for this content item. This
   * pipeline currently generates exactly one subtopic (and therefore one
   * section) per `partner_topic_ref` — a deliberate scope simplification for
   * this pass, kept as an array so a future multi-subtopic-per-topic
   * pipeline (matching Section 4.A.3's "3 sections generated" wireframe) is
   * additive, not a payload-shape migration.
   */
  sections: TemplateSection[]
}

/**
 * Runs the full generation pipeline for one `partner_content_items` row:
 * outline -> script -> template data -> updates the row to
 * `ready_for_review` (or `failed`, Section 8) and fires the
 * `llm_generation_content` usage_events row on success only (Section 6.3;
 * no event for a failed generation, Section 8).
 */
export async function runPartnerContentGeneration(partnerAccountId: string, itemId: string, partnerTopicRef: string): Promise<void> {
  const supabase = createSupabaseAdminClient()

  try {
    const outline = await buildPartnerOutline(partnerTopicRef)

    const script = await generateTrainingScript(outline, { role: 'partner end user', industry: 'general', maturity: 'intermediate' })

    const templateType: TemplateName = selectTemplate(outline.subtopic_title, 'middle', outline.visual_spec.template_hint || undefined)
    const data = await generateTemplateData(
      templateType,
      outline.subtopic_title,
      partnerTopicRef,
      { role: 'partner end user', industry: 'general', maturity: 'intermediate' },
      undefined,
      {
        headline: outline.visual_spec.headline,
        items: outline.visual_spec.items,
        so_what: outline.visual_spec.so_what,
        summary: outline.content_summary,
      }
    )

    const section: TemplateSection = {
      id: `${itemId}-section`,
      type: templateType,
      data,
      meta: {
        subtopicTitle: outline.subtopic_title,
        sessionTitle: partnerTopicRef,
        userRole: 'partner end user',
        userIndustry: 'general',
      },
      status: 'ready',
    } as TemplateSection

    const draftPayload: DraftPayload = { outline, script, sections: [section] }

    await supabase
      .from('partner_content_items')
      .update({ status: 'ready_for_review', draft_payload: draftPayload })
      .eq('id', itemId)
      .eq('partner_account_id', partnerAccountId)

    // Section 6.3 — billable, generation-succeeded only.
    await recordBillableEvent({
      partnerAccountId,
      eventType: 'usage.llm_generation_call',
      generationType: 'content',
      quantity: 1,
      unit: 'calls',
    })
  } catch (err) {
    console.error('[partner/content-generation] Pipeline failed for item', itemId, err instanceof Error ? err.message : err)
    await supabase
      .from('partner_content_items')
      .update({ status: 'failed' })
      .eq('id', itemId)
      .eq('partner_account_id', partnerAccountId)
  }
}

export async function approveContentItem(
  partnerAccountId: string,
  id: string
): Promise<{ ok: true; contentRef: string } | { ok: false; error: string }> {
  const item = await getContentItem(partnerAccountId, id)
  if (!item) return { ok: false, error: 'not_found' }
  if (item.status !== 'ready_for_review') return { ok: false, error: 'not_ready_for_review' }

  const contentRef = crypto.randomUUID()
  const push = await pushPartnerContent(partnerAccountId, {
    contentRef,
    partnerTopicRef: item.partnerTopicRef,
    format: 'json',
    payload: JSON.stringify(item.draftPayload),
    version: 1,
  })

  if (!push.success) return { ok: false, error: push.error ?? 'push_failed' }

  const supabase = createSupabaseAdminClient()
  await supabase
    .from('partner_content_items')
    .update({ status: 'approved', content_ref: contentRef, draft_payload: null })
    .eq('id', id)
    .eq('partner_account_id', partnerAccountId)

  return { ok: true, contentRef }
}

export async function rejectContentItem(partnerAccountId: string, id: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('partner_content_items')
    .update({ status: 'rejected', draft_payload: null })
    .eq('id', id)
    .eq('partner_account_id', partnerAccountId)
  return !error
}

/** Inngest cron (architecture.md Section 12.4): hard-deletes expired rows regardless of status, except already-approved rows (already payload-NULL, kept as a lightweight historical index). */
export async function deleteExpiredContentItems(): Promise<number> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_content_items')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .neq('status', 'approved')
    .select('id')

  if (error) {
    console.error('[partner/content-generation] deleteExpiredContentItems failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}
