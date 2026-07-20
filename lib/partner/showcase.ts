import { createSupabaseAdminClient } from '@/lib/supabase'
import { selectTemplate } from '@/lib/templates/selector'
import { generateTemplateData } from '@/lib/templates/generator'
import type { TemplateSection, TemplateName } from '@/lib/templates/types'

/**
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §0 point 4, §6.3/§6.4).
 * Demo-only pipeline for the private channel-partner "Showcase" tab —
 * deliberately NOT `lib/partner/content-generation.ts`, which is the real
 * partner-content pipeline. Showcase's grouping call and its mock/prompt
 * shape must not live beside or be confused with production logic.
 *
 * Same `isPlaceholder` `ANTHROPIC_API_KEY` guard convention as
 * `buildPartnerOutline` (content-generation.ts) and `generateTemplateData`
 * (templates/generator.ts), copied verbatim.
 */

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

export interface ShowcaseContentInput {
  title: string | null
  subtitle: string | null
  contentToExplain: string | null
}

/**
 * Groups the saved Showcase Content into 2-3 topic titles. Demo-only, model
 * `claude-sonnet-4-6` (matches `buildPartnerOutline`'s existing choice).
 */
export async function groupShowcaseContentIntoTopics(input: ShowcaseContentInput): Promise<string[]> {
  const body = [input.title, input.subtitle, input.contentToExplain].filter(Boolean).join('\n\n')

  if (isPlaceholder) {
    // Deterministic mock: naive paragraph/sentence split into up to 3 short titles.
    const chunks = body.split(/\n\n+/).filter((c) => c.trim().length > 0).slice(0, 3)
    if (chunks.length >= 2) return chunks.map((c) => c.trim().slice(0, 60))
    return ['Overview', 'How It Works', 'Getting Started'].slice(0, Math.max(2, Math.min(3, chunks.length || 2)))
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `You are grouping a piece of content into 2-3 distinct topics for a product demo.
Content:
"""
${body.slice(0, 5000)}
"""
Return ONLY a JSON array of 2 or 3 short topic title strings (max 8 words each), no markdown, no
explanation, e.g. ["Topic one title", "Topic two title", "Topic three title"]. Titles must be
distinct facets of the content above, ordered as they'd naturally be presented in a walkthrough.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  const raw = textBlock && 'text' in textBlock ? textBlock.text : '[]'
  const parsed = JSON.parse(raw.replace(/^```json\s*|```\s*$/g, ''))
  const titles = Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  return titles.slice(0, 3).length >= 2 ? titles.slice(0, 3) : ['Overview', 'How It Works']
}

/**
 * Appends newly grouped topics after the current max `position` for this
 * Content row — never deletes existing rows (requirement doc §9 Edge Case:
 * "Regenerating topics never deletes anything").
 */
export async function regenerateShowcaseTopics(
  partnerAccountId: string,
  showcaseContentId: string,
  input: ShowcaseContentInput
): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const titles = await groupShowcaseContentIntoTopics(input)

  const { data: existing } = await supabase
    .from('partner_showcase_topics')
    .select('position')
    .eq('showcase_content_id', showcaseContentId)
    .order('position', { ascending: false })
    .limit(1)

  const startPosition = ((existing?.[0]?.position as number | undefined) ?? -1) + 1

  await supabase.from('partner_showcase_topics').insert(
    titles.map((title, i) => ({
      showcase_content_id: showcaseContentId,
      partner_account_id: partnerAccountId,
      title,
      position: startPosition + i,
    }))
  )
}

/**
 * B2B-31 (requirement doc §0 point 5). Pure, non-LLM. `generateTemplateData`'s
 * `contentSpec` block is silently skipped when `contentSpec.items.length === 0`
 * (`lib/templates/generator.ts` ~line 1130: `contentSpec && contentSpec.items.length > 0`)
 * — a naive `{ summary: excerpt, items: [] }` pass-through would make the LLM
 * ignore Arun's excerpt entirely. This derives a non-empty `items[]` via
 * simple sentence/line splitting so the excerpt actually reaches the
 * generation prompt.
 */
export function deriveContentSpecFromExcerpt(
  topicTitle: string,
  excerpt: string
): { headline: string; items: string[]; so_what: string; summary: string } {
  const items = excerpt
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 5)
  const safeItems = items.length > 0 ? items : [excerpt.trim().slice(0, 200)]
  return {
    headline: topicTitle,
    items: safeItems,
    so_what: `Understanding ${topicTitle} matters for how you evaluate Clio.`,
    summary: excerpt,
  }
}

/**
 * Runs the real template pipeline for one Showcase topic — same functions
 * `runPartnerContentGeneration` (content-generation.ts) uses for real
 * partner content, minus `buildPartnerOutline`/`generateTrainingScript` (no
 * session/narration script needed here — the canvas is the whole
 * deliverable). `selectTemplate(topicTitle, 'middle')` (never `'first'`/
 * `'last'`) matches `runPartnerContentGeneration`'s own call — Showcase has
 * no structural first/last concept. No `templateHint` is passed (no
 * `buildPartnerOutline` step exists here to produce one).
 */
export async function generateShowcaseVisualization(
  topicTitle: string,
  contentTitle: string,
  excerpt: string,
  visualizationId: string
): Promise<TemplateSection> {
  const userContext = { role: 'partner end user', industry: 'general', maturity: 'intermediate' as const }
  const templateType: TemplateName = selectTemplate(topicTitle, 'middle')
  const contentSpec = deriveContentSpecFromExcerpt(topicTitle, excerpt)
  const data = await generateTemplateData(templateType, topicTitle, contentTitle, userContext, undefined, contentSpec)

  return {
    id: visualizationId,
    type: templateType,
    data,
    meta: { subtopicTitle: topicTitle, sessionTitle: contentTitle, userRole: userContext.role, userIndustry: userContext.industry },
    status: 'ready',
  } as TemplateSection
}
