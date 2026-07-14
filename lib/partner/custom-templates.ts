import { createSupabaseAdminClient } from '@/lib/supabase'
import { recordBillableEvent } from './webhooks'

/**
 * B2B-03 — Wholly-new partner-authored template types (Requirement Doc
 * Section 6.4, Section 11 Q1 CEO resolution 2026-07-13; architecture.md
 * Section 12.1/12.6).
 *
 * Generation-safety boundary (Section 6.4, independent of the
 * approval-chain question): `skeleton_schema` is constrained to the same
 * typed, enum-constrained, regex-validated primitives Level A/B/C already
 * enforce — fixed enums for layout/style/motion, `^#[0-9A-Fa-f]{6}$` hex
 * validation for any color, plain-text labels with no markup/code
 * characters. Never raw CSS, HTML/markup, or executable code, whether
 * supplied in the partner's free text or emitted by the LLM. A payload
 * failing this validation is rejected outright — never sanitized and
 * rendered, never persisted, no usage_events row fires (Section 7/8).
 */

const LAYOUTS = new Set(['grid', 'list', 'timeline', 'comparison', 'flow'])
const STYLE_MODES = new Set(['fill', 'outline', 'neon'])
const MOTIONS = new Set(['none', 'fade', 'stagger', 'slide'])
const HEX_RE = /^#[0-9A-Fa-f]{6}$/
// Plain-text label: letters, numbers, spaces, and a narrow set of punctuation
// only — explicitly excludes <, >, {, }, ;, and backslash, the characters
// that would allow markup/code injection if this string were ever
// interpolated into HTML/CSS by a future renderer.
const SAFE_LABEL_RE = /^[A-Za-z0-9 ,.'"!?()&%/-]{1,60}$/
const SAFE_SLOT_ID_RE = /^[a-z][a-z0-9_]{0,39}$/

export interface CustomTemplateSlot {
  slot_id: string
  label: string
  style_mode: 'fill' | 'outline' | 'neon'
  motion: 'none' | 'fade' | 'stagger' | 'slide'
}

export interface CustomTemplateSkeleton {
  layout: 'grid' | 'list' | 'timeline' | 'comparison' | 'flow'
  slots: CustomTemplateSlot[]
  primary_color?: string
  accent_color?: string
}

/**
 * The generation-safety validator (Section 6.4/7/8). Structural JSON only —
 * rejects anything with unknown keys, out-of-enum values, malformed colors,
 * or label text containing markup/code-injection characters. Never throws;
 * returns a boolean so callers can reject-and-report cleanly.
 */
export function validateSkeletonSchema(value: unknown): value is CustomTemplateSkeleton {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const schema = value as Record<string, unknown>

  const allowedKeys = new Set(['layout', 'slots', 'primary_color', 'accent_color'])
  if (!Object.keys(schema).every((k) => allowedKeys.has(k))) return false

  if (typeof schema.layout !== 'string' || !LAYOUTS.has(schema.layout)) return false

  if (!Array.isArray(schema.slots) || schema.slots.length < 1 || schema.slots.length > 6) return false
  for (const slot of schema.slots) {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return false
    const s = slot as Record<string, unknown>
    const slotKeys = new Set(['slot_id', 'label', 'style_mode', 'motion'])
    if (!Object.keys(s).every((k) => slotKeys.has(k))) return false
    if (typeof s.slot_id !== 'string' || !SAFE_SLOT_ID_RE.test(s.slot_id)) return false
    if (typeof s.label !== 'string' || !SAFE_LABEL_RE.test(s.label)) return false
    if (typeof s.style_mode !== 'string' || !STYLE_MODES.has(s.style_mode)) return false
    if (typeof s.motion !== 'string' || !MOTIONS.has(s.motion)) return false
  }

  if (schema.primary_color !== undefined && (typeof schema.primary_color !== 'string' || !HEX_RE.test(schema.primary_color))) return false
  if (schema.accent_color !== undefined && (typeof schema.accent_color !== 'string' || !HEX_RE.test(schema.accent_color))) return false

  return true
}

const isPlaceholder = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

/**
 * Generates a net-new skeleton from a partner's free-text description
 * (Screen state 5's `[Generate a new template]`, or an equivalent
 * skeleton-authoring path — `source` distinguishes the two). Returns
 * `{ valid: false }` if the generated payload fails
 * `validateSkeletonSchema` — the caller must not persist anything or fire a
 * usage_events row in that case (Section 7/8).
 */
export async function generateCustomTemplateSkeleton(
  freeTextDescription: string
): Promise<{ valid: true; skeleton: CustomTemplateSkeleton } | { valid: false }> {
  if (isPlaceholder) {
    // Mock — deterministic, always valid, mirrors this codebase's
    // isPlaceholder mock convention elsewhere.
    const skeleton: CustomTemplateSkeleton = {
      layout: 'grid',
      slots: [
        { slot_id: 'primary', label: 'Primary panel', style_mode: 'fill', motion: 'fade' },
        { slot_id: 'secondary', label: 'Secondary panel', style_mode: 'outline', motion: 'none' },
      ],
      primary_color: '#7C3AED',
      accent_color: '#06B6D4',
    }
    return { valid: true, skeleton }
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const prompt = `A partner wants a new visualization template described as: "${freeTextDescription}"

Respond with ONLY a JSON object (no markdown fences, no prose) matching exactly this shape:
{
  "layout": one of "grid" | "list" | "timeline" | "comparison" | "flow",
  "slots": array of 1-6 objects, each { "slot_id": lowercase_snake_case identifier (max 40 chars), "label": short plain-text label (max 60 chars, letters/numbers/spaces/basic punctuation only, NO html or code), "style_mode": one of "fill"|"outline"|"neon", "motion": one of "none"|"fade"|"stagger"|"slide" },
  "primary_color": optional 6-digit hex color like "#7C3AED",
  "accent_color": optional 6-digit hex color like "#06B6D4"
}
Do not include any other keys. Do not include CSS, HTML, or code in any field.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    const raw = textBlock && 'text' in textBlock ? textBlock.text : '{}'
    const parsed = JSON.parse(raw.replace(/^```json\s*|```\s*$/g, '').trim())

    if (!validateSkeletonSchema(parsed)) return { valid: false }
    return { valid: true, skeleton: parsed }
  } catch (err) {
    console.error('[partner/custom-templates] generateCustomTemplateSkeleton failed:', err instanceof Error ? err.message : err)
    return { valid: false }
  }
}

export interface PartnerCustomTemplate {
  id: string
  partnerAccountId: string
  templateLabel: string
  skeletonSchema: CustomTemplateSkeleton
  status: 'pending_review' | 'live'
  source: 'free_text_generated' | 'skeleton_generated'
  confirmedAt: string | null
}

function rowToCustomTemplate(row: Record<string, unknown>): PartnerCustomTemplate {
  return {
    id: row.id as string,
    partnerAccountId: row.partner_account_id as string,
    templateLabel: row.template_label as string,
    skeletonSchema: row.skeleton_schema as CustomTemplateSkeleton,
    status: row.status as PartnerCustomTemplate['status'],
    source: row.source as PartnerCustomTemplate['source'],
    confirmedAt: (row.confirmed_at as string | null) ?? null,
  }
}

/**
 * Persists a validated skeleton as `pending_review` and fires the
 * `llm_generation_new_template` usage_events row (Section 6.4 — only for a
 * successful, persisted generation; a safety-validation failure never
 * reaches this function).
 */
export async function createPendingCustomTemplate(
  partnerAccountId: string,
  templateLabel: string,
  skeleton: CustomTemplateSkeleton,
  source: 'free_text_generated' | 'skeleton_generated'
): Promise<{ ok: true; data: PartnerCustomTemplate } | { ok: false; error: string }> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_custom_templates')
    .insert({
      partner_account_id: partnerAccountId,
      template_label: templateLabel,
      skeleton_schema: skeleton,
      status: 'pending_review',
      source,
    })
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'insert_failed' }

  await recordBillableEvent({
    partnerAccountId,
    eventType: 'usage.llm_generation_call',
    generationType: 'new_template',
    quantity: 1,
    unit: 'calls',
  })

  return { ok: true, data: rowToCustomTemplate(data) }
}

export async function listCustomTemplates(partnerAccountId: string): Promise<PartnerCustomTemplate[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_custom_templates')
    .select('*')
    .eq('partner_account_id', partnerAccountId)
    .order('created_at', { ascending: false })
  return (data ?? []).map(rowToCustomTemplate)
}

/**
 * The partner-admin's own explicit `[Confirm & make live]` click (Section
 * 6.4/11 Q1) — no Clio-side check, no second-approver requirement, by
 * design. Any admin who already passed `requirePartnerAdmin()` for this
 * partner account may confirm.
 */
export async function confirmCustomTemplate(
  partnerAccountId: string,
  id: string
): Promise<{ ok: true; data: PartnerCustomTemplate } | { ok: false; error: string }> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_custom_templates')
    .update({ status: 'live', confirmed_at: new Date().toISOString() })
    .eq('partner_account_id', partnerAccountId)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }
  return { ok: true, data: rowToCustomTemplate(data) }
}

/**
 * Render-time integration (architecture.md Section 12.6's "known gap,
 * flagged not assumed" — the one piece of real design work Section 11 Q1's
 * resolution explicitly left open, not invented there).
 *
 * DESIGN DECISION (documented here per the task's request to flag it
 * clearly): `selectTemplate()` itself (lib/templates/selector.ts) stays
 * completely unmodified, per the Requirement Doc's own explicit instruction
 * ("reused verbatim, unmodified" — Objective 3's "decided once, never
 * re-decided live" guarantee). Rather than teaching that pure, general
 * function about a specific partner's custom templates, this module adds a
 * separate, partner-aware lookup that callers (the live-session render path)
 * consult FIRST, falling back to the standard `selectTemplate()` result when
 * no partner-owned candidate matches:
 *
 *   1. If the pulled content's `template_hint` (or the subtopic title, as a
 *      looser fallback) case-insensitively matches a `live`
 *      `partner_custom_templates.template_label` for this partner, that
 *      custom template is the selection — returned as a `{ kind: 'custom' }`
 *      result carrying its own `skeleton_schema` for the render page to lay
 *      out generically (grid/list/timeline/comparison/flow, per the
 *      generation-safety-constrained shape above).
 *   2. Otherwise, delegates to the standard `selectTemplate()` and returns
 *      `{ kind: 'library' }`.
 *
 * This keeps the isolation guarantee intact (the lookup is always scoped to
 * one `partnerAccountId`, so Partner A's custom templates can never be
 * selected for Partner B's session) and keeps `pending_review` rows
 * structurally ineligible (the query below filters `status = 'live'`
 * unconditionally — there is no code path that reads a `pending_review` row
 * from this function).
 */
export async function selectPartnerTemplate(
  partnerAccountId: string,
  subtopicTitle: string,
  position: 'first' | 'middle' | 'last',
  templateHint?: string
): Promise<{ kind: 'custom'; template: PartnerCustomTemplate } | { kind: 'library'; templateName: string }> {
  const { selectTemplate } = await import('@/lib/templates/selector')

  if (position !== 'middle') {
    return { kind: 'library', templateName: selectTemplate(subtopicTitle, position, templateHint) }
  }

  const candidateLabel = (templateHint || subtopicTitle).toLowerCase().trim()
  if (candidateLabel) {
    const supabase = createSupabaseAdminClient()
    const { data } = await supabase
      .from('partner_custom_templates')
      .select('*')
      .eq('partner_account_id', partnerAccountId)
      .eq('status', 'live')

    const match = (data ?? []).find((row) => (row.template_label as string).toLowerCase().trim() === candidateLabel)
    if (match) return { kind: 'custom', template: rowToCustomTemplate(match) }
  }

  return { kind: 'library', templateName: selectTemplate(subtopicTitle, position, templateHint) }
}
