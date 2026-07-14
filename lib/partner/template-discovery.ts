import { createSupabaseAdminClient } from '@/lib/supabase'
import type { TemplateName } from '@/lib/templates/types'
import { recordBillableEvent } from './webhooks'
import { getPreferenceMeter } from './preference'
import { getComponentConfig } from './theme'

/**
 * B2B-03 — AI-assisted authoring (Requirement Doc Section 6.5): free-text
 * template discovery, component-slot derivation (Section 12.5), and the
 * per-request confidence signal. All Confidence computation is ephemeral —
 * never stored (Section 6.5).
 */

export type Confidence = 'high' | 'medium' | 'low'

/**
 * Fixed per-template component slot set (Section 12.5) — derived from each
 * template's own `*Data` interface's structural sub-elements, the same
 * method RTV-04 used. Non-exhaustive templates fall back to an empty slot
 * list (no Level C configuration available for that template yet, Level A/B
 * still apply).
 */
export const COMPONENT_SLOTS_BY_TEMPLATE: Partial<Record<TemplateName, string[]>> = {
  Heatmap: ['cell', 'legend'],
  Overlay: ['zone_marker', 'connector', 'callout_card'],
  ComparisonTable: ['row', 'column_header', 'cell'],
  Flowchart: ['node', 'edge'],
  HorizontalDecision: ['node', 'edge'],
  StepFlow: ['step_card', 'connector'],
  ChevronProcess: ['step_card', 'connector'],
  TwoByTwoMatrix: ['quadrant', 'axis_label'],
  Timeline: ['milestone', 'connector'],
  ConceptMap: ['node', 'edge'],
  Hierarchy: ['node', 'connector'],
  Funnel: ['stage'],
  ActionPlan: ['action_item'],
  ProsCons: ['column'],
  FrameworkCard: ['pillar'],
  CaseStudy: ['metric'],
  NarrativeCard: ['panel'],
  DefinitionTriptych: ['panel'],
  AnswerSpotlight: ['panel'],
}

export function componentSlotsForTemplate(templateName: string): string[] {
  return COMPONENT_SLOTS_BY_TEMPLATE[templateName as TemplateName] ?? []
}

/** Canonical description used both for the discovery-matching heuristic and (Screen state 4) the shown match reasoning. */
const CANONICAL_DESCRIPTIONS: Partial<Record<TemplateName, string>> = {
  Heatmap: 'graduated intensity across a small grid, high medium low, maturity grid, color-coded cells',
  Overlay: 'one whole thing broken into a few labeled zones or parts, where something fits, annotated diagram',
  ComparisonTable: 'compare multiple items side by side across shared criteria, versus, tool landscape',
  TwoByTwoMatrix: 'plot items across two axes into four quadrants, prioritization, strategy, evaluation',
  StepFlow: 'a sequence of steps in a process, how-to, implementation walkthrough',
  ChevronProcess: 'a linear pipeline or funnel of stages, filtering, selection process',
  Flowchart: 'branching decision logic, if-then paths, workflow routing',
  HorizontalDecision: 'a single branching decision point with two or more paths',
  Hierarchy: 'a tree or taxonomy of categories and subcategories, org structure, breakdown',
  ConceptMap: 'a web of related concepts and how they connect, ecosystem, landscape',
  Timeline: 'a chronological sequence of events or milestones, history, evolution, journey',
  Funnel: 'a narrowing pipeline of stages, conversion, selection funnel',
  FrameworkCard: 'a named framework or mental model with a few pillars',
  ProsCons: 'two-column tradeoff comparison, benefits versus risks',
  CaseStudy: 'a real-world example with outcome metrics, how a company did something',
  NarrativeCard: 'a story-driven example told in prose with a highlighted outcome',
  StatCallout: 'one or two headline statistics with supporting context',
  ActionPlan: 'a checklist of concrete next actions',
  DefinitionTriptych: 'three-part definition or overview of a concept',
  AnswerSpotlight: 'a single question and its direct answer, FAQ style',
  KeyTakeaway: 'a single closing summary statement',
  TopicHero: 'a full-screen title and framing question for a new topic',
  ConceptDefinition: 'a formal definition of a single term with an example',
  QuestionAnswer: 'a question paired with a short answer',
  QuoteCallout: 'a highlighted quotation',
}

interface DiscoveryCandidate {
  templateName: string
  displayName: string
  score: number
  confidence: Confidence
  reasoning: string
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  )
}

/**
 * Bounded, deterministic keyword-overlap heuristic (Section 6.5) — NOT a
 * second LLM call, so this stays fast and cheap. Jaccard-style overlap
 * between the partner's free-text tokens and a candidate's
 * (description + template name) tokens, in [0, 1].
 */
export function scoreTemplateMatch(freeText: string, templateName: string): number {
  const description = CANONICAL_DESCRIPTIONS[templateName as TemplateName] ?? templateName
  const candidateTokens = tokenize(`${templateName} ${description}`)
  const queryTokens = tokenize(freeText)

  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0

  let overlap = 0
  Array.from(queryTokens).forEach((token) => {
    if (candidateTokens.has(token)) overlap++
  })

  return overlap / Math.max(queryTokens.size, 1)
}

function confidenceFromScore(score: number): Confidence {
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  return 'low'
}

/**
 * Free-text discovery (Section 6.5, Screen states 4/5). Only scores
 * templates that are `template_library.status = 'approved'` (RTV-04 branch
 * (a) — same gate as Level B/C configuration itself, Section 6.4). Returns
 * candidates sorted by score descending. `bestMatch` is null (Screen state
 * 5 — "No match found") if no candidate clears the 0.4 threshold.
 */
export async function discoverTemplates(freeText: string): Promise<{ candidates: DiscoveryCandidate[]; bestMatch: DiscoveryCandidate | null }> {
  const supabase = createSupabaseAdminClient()
  const { data: approvedTemplates } = await supabase
    .from('template_library')
    .select('template_name, display_name')
    .eq('status', 'approved')

  const candidates: DiscoveryCandidate[] = (approvedTemplates ?? [])
    .map((row) => {
      const templateName = row.template_name as string
      const score = scoreTemplateMatch(freeText, templateName)
      return {
        templateName,
        displayName: row.display_name as string,
        score,
        confidence: confidenceFromScore(score),
        reasoning: CANONICAL_DESCRIPTIONS[templateName as TemplateName] ?? '',
      }
    })
    .sort((a, b) => b.score - a.score)

  const best = candidates[0]
  const bestMatch = best && best.score >= 0.4 ? best : null

  return { candidates: candidates.slice(0, 4), bestMatch }
}

/**
 * Skeleton-parameterization / sample-fill confidence (Section 6.5): `high`
 * if the partner has >=2 prior confirmed (unreverted >=24h — approximated
 * here by "any saved row exists", since the delayed-confirmation Inngest job
 * is what actually enforces the >=24h condition before a save counts toward
 * the preference meter at all) property choices for the same
 * `component_slot` type on any template; `medium` if 1; `low` if none.
 */
export async function sampleFillConfidence(partnerAccountId: string, templateName: string, componentSlot: string): Promise<Confidence> {
  const existing = await getComponentConfig(partnerAccountId, templateName, componentSlot)
  const meter = await getPreferenceMeter(partnerAccountId)

  if (existing && meter.domainsTouched.length >= 1) return 'high'
  if (existing) return 'medium'
  return 'low'
}

/**
 * Sample-fill (Section 4.A.4 Screen state 6, Section 6.5) — ephemeral,
 * AI-generated realistic sample data for the live preview pane only. Never
 * saved, never pushed anywhere; reuses the same generator
 * (`generateTemplateData`) and mock/LLM-fallback convention as the real
 * content-generation pipeline.
 */
export async function generateSampleFillData(
  partnerAccountId: string,
  templateName: string
): Promise<{ data: unknown; confidence: Confidence }> {
  const { generateTemplateData } = await import('@/lib/templates/generator')
  const slots = componentSlotsForTemplate(templateName)
  const confidence = slots.length > 0
    ? await sampleFillConfidence(partnerAccountId, templateName, slots[0])
    : 'low'

  const data = await generateTemplateData(
    templateName as TemplateName,
    `Sample content for ${templateName}`,
    'Configurator preview',
    { role: 'partner end user', industry: 'general', maturity: 'intermediate' }
  )

  return { data, confidence }
}

/** Fires the discovery usage_events row (event_type='llm_generation_discovery', Section 6.5) — only for a genuine match/no-match outcome that reaches the partner-admin, never billed for malformed input. Called by the API route after a real discovery run. */
export async function recordDiscoveryUsage(partnerAccountId: string): Promise<void> {
  await recordBillableEvent({
    partnerAccountId,
    eventType: 'usage.llm_generation_call',
    generationType: 'discovery',
    quantity: 1,
    unit: 'calls',
  })
}

/** Fires the sample-fill usage_events row (event_type='llm_generation_sample_fill', Section 6.5). */
export async function recordSampleFillUsage(partnerAccountId: string): Promise<void> {
  await recordBillableEvent({
    partnerAccountId,
    eventType: 'usage.llm_generation_call',
    generationType: 'sample_fill',
    quantity: 1,
    unit: 'calls',
  })
}

/** Fires the skeleton-parameterization usage_events row (event_type='llm_generation_skeleton', Section 6.5). */
export async function recordSkeletonUsage(partnerAccountId: string): Promise<void> {
  await recordBillableEvent({
    partnerAccountId,
    eventType: 'usage.llm_generation_call',
    generationType: 'skeleton',
    quantity: 1,
    unit: 'calls',
  })
}
