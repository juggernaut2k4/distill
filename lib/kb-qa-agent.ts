/**
 * Knowledge Base QA Agent.
 *
 * Reviews TemplateSection content and layout by reading the actual renderer
 * component source code — no screenshot needed. Claude reads the Tailwind
 * classes and HTML structure, cross-references the section JSON data, and
 * reasons about rendering issues (overflow, array limits, contrast, etc.)
 *
 * After reviewing a topic's sections, synthesizes recurring patterns into
 * candidate rules that can be approved and injected into the generation prompt.
 */

import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import type { TemplateSection } from './templates/types'

const MODEL = 'claude-sonnet-4-6'

// ─── RENDERER FILE MAP ────────────────────────────────────────────────────────

const RENDERER_PATH: Record<string, string> = {
  TopicHero:          'components/templates/renderers/TopicHero.tsx',
  ConceptDefinition:  'components/templates/renderers/ConceptDefinition.tsx',
  ComparisonTable:    'components/templates/renderers/ComparisonTable.tsx',
  StepFlow:           'components/templates/renderers/StepFlow.tsx',
  ProsCons:           'components/templates/renderers/ProsCons.tsx',
  CaseStudy:          'components/templates/renderers/CaseStudy.tsx',
  KeyTakeaway:        'components/templates/renderers/KeyTakeaway.tsx',
  QuestionAnswer:     'components/templates/renderers/QuestionAnswer.tsx',
}

function readRendererCode(templateType: string): string {
  const relative = RENDERER_PATH[templateType]
  if (!relative) return '(no dedicated renderer — falls back to GenericTemplate)'
  try {
    return fs.readFileSync(path.join(process.cwd(), relative), 'utf-8')
  } catch {
    return '(renderer file could not be read)'
  }
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface ContentIssue {
  field: string
  issue: string
  severity: 'low' | 'medium' | 'high'
  fix: string
}

export interface LayoutIssue {
  location: string
  issue: string
  severity: 'low' | 'medium' | 'high'
  data_fix: string
  component_fix: string | null
}

export interface SectionQAResult {
  subtopic_slug: string
  subtopic_title: string
  template_type: string
  overall_score: number
  summary: string
  content_issues: ContentIssue[]
  layout_issues: LayoutIssue[]
}

export interface RuleCandidate {
  rule_text: string
  justification: string
  evidence: Array<{ section: string; quote: string }>
  category: 'content' | 'layout' | 'data_structure'
}

// ─── SECTION REVIEW ───────────────────────────────────────────────────────────

async function reviewOneSection(
  section: TemplateSection,
  subtopicTitle: string,
  subtopicSlug: string,
  anthropic: Anthropic,
  approvedRules: string[]
): Promise<SectionQAResult> {
  const rendererCode = readRendererCode(section.type)

  const rulesBlock = approvedRules.length > 0
    ? `\nAPPROVED RULES TO CHECK AGAINST:\n${approvedRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : ''

  const systemPrompt = `You are a senior UX engineer and content quality auditor for a premium AI coaching platform used by C-suite executives. You review AI-generated infographic sections before they are shown to users.

You receive:
1. The React/Tailwind renderer component — tells you the visual structure, fixed heights, grid columns, and how each data field maps to UI elements
2. The section data JSON — the actual content being rendered

REVIEW DIMENSIONS:

CONTENT QUALITY (score heavily):
- Is every "so_what" genuinely role-specific? It must start with "As a [role]" and give a concrete action, not platitudes
- Are company names real, well-known brands? Never "a major retailer" or "a global bank"
- Are statistics specific with sources? Never vague like "studies show"
- Is language executive-appropriate? Direct, no jargon, no fluff
- Is the content immediately useful to the reader, or just interesting?

LAYOUT & OVERFLOW (use the renderer code to reason about this):
- Will any text field overflow its container? Check Tailwind fixed heights vs content length
- Are arrays within safe item limits for the grid/list layout in the renderer?
- Do fixed-height containers have enough room for the data provided?
- Are there Tailwind classes like h-[N]px or max-h-[N]px that could clip content?
- Check every array field: how many items does the renderer support vs how many are provided?${rulesBlock}

Return ONLY valid JSON:
{
  "overall_score": number (1-10),
  "summary": string (max 2 sentences),
  "content_issues": [
    { "field": string, "issue": string, "severity": "low"|"medium"|"high", "fix": string }
  ],
  "layout_issues": [
    { "location": string, "issue": string, "severity": "low"|"medium"|"high", "data_fix": string, "component_fix": string|null }
  ]
}`

  const userPrompt = `Template type: ${section.type}
Subtopic: "${subtopicTitle}"

─── RENDERER COMPONENT CODE ───
${rendererCode}

─── SECTION DATA ───
${JSON.stringify(section.data, null, 2)}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(cleaned)

  return {
    subtopic_slug: subtopicSlug,
    subtopic_title: subtopicTitle,
    template_type: section.type,
    overall_score: parsed.overall_score ?? 5,
    summary: parsed.summary ?? '',
    content_issues: parsed.content_issues ?? [],
    layout_issues: parsed.layout_issues ?? [],
  }
}

// ─── RULE SYNTHESIS ───────────────────────────────────────────────────────────

async function synthesizeRuleCandidates(
  results: SectionQAResult[],
  anthropic: Anthropic,
  existingRuleTexts: string[]
): Promise<RuleCandidate[]> {
  const digest = results.map((r) => ({
    section: r.subtopic_title,
    type: r.template_type,
    score: r.overall_score,
    content_issues: r.content_issues,
    layout_issues: r.layout_issues,
  }))

  const existingBlock = existingRuleTexts.length > 0
    ? `\nEXISTING RULES — do not duplicate:\n${existingRuleTexts.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : ''

  const systemPrompt = `You are a quality systems architect. You analyse a set of AI content review results and extract patterns of recurring issues into permanent generation rules.

These rules will be injected into the Claude generation prompt and must prevent the same mistakes from appearing again.

Effective rules are:
- Specific and testable (not "be more specific" — instead: "Every so_what field must start with 'As a [role],' and name one concrete action the executive should take within 30 days")
- Phrased as instructions to the generator, not descriptions of problems
- Addressing root causes visible in the JSON data, not surface symptoms
- Scoped to a template type if the issue is template-specific${existingBlock}

Only generate a rule if the issue appears in 2+ sections OR is severe (score ≤ 4 from this issue alone).
Quality over quantity — 3 excellent rules beat 10 vague ones.

Return ONLY a valid JSON array:
[
  {
    "rule_text": string,
    "justification": string (why this pattern hurts the executive reader — be specific),
    "evidence": [{ "section": string, "quote": string }],
    "category": "content"|"layout"|"data_structure"
  }
]`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `QA results from ${results.length} sections:\n${JSON.stringify(digest, null, 2)}`,
    }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : '[]'
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  return JSON.parse(cleaned) as RuleCandidate[]
}

// ─── RULE REFINEMENT ─────────────────────────────────────────────────────────

/**
 * Takes a pending rule + user's suggestion and produces a strengthened version.
 */
export async function refineRuleWithSuggestion(
  ruleText: string,
  justification: string,
  userSuggestion: string
): Promise<string> {
  const isPlaceholder = !process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

  if (isPlaceholder) {
    return `${ruleText} [Refined: ${userSuggestion}]`
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: `You refine AI generation rules by incorporating human expert feedback. Return ONLY the refined rule text — a single clear instruction sentence or two. Do not include explanation.`,
    messages: [{
      role: 'user',
      content: `Original rule:\n"${ruleText}"\n\nJustification:\n${justification}\n\nUser's suggestion to improve it:\n${userSuggestion}\n\nProduce a single refined rule that incorporates the suggestion and is stronger than the original.`,
    }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : ruleText
  return raw.trim().replace(/^["']|["']$/g, '')
}

// ─── MAIN ENTRY POINT ────────────────────────────────────────────────────────

export async function runQAOnTopic(
  topicId: string,
  sections: Array<{
    subtopic_slug: string
    subtopic_title: string
    section_data: TemplateSection
  }>,
  approvedRules: string[],
  existingRuleTexts: string[]
): Promise<{ results: SectionQAResult[]; candidates: RuleCandidate[] }> {
  const isPlaceholder = !process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

  if (isPlaceholder) {
    throw new Error('ANTHROPIC_API_KEY is not configured.')
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Review all sections in parallel — independent of each other
  const results = await Promise.all(
    sections.map(async (s) => {
      try {
        return await reviewOneSection(
          s.section_data,
          s.subtopic_title,
          s.subtopic_slug,
          anthropic,
          approvedRules
        )
      } catch (err) {
        console.error('[kb-qa] Section review failed:', s.subtopic_slug, err)
        return null
      }
    })
  )

  const validResults = results.filter((r): r is SectionQAResult => r !== null)

  // Synthesize candidate rules from patterns across sections
  let candidates: RuleCandidate[] = []
  if (validResults.length >= 2) {
    try {
      candidates = await synthesizeRuleCandidates(validResults, anthropic, existingRuleTexts)
    } catch (err) {
      console.error('[kb-qa] Rule synthesis failed:', err)
    }
  }

  return { results: validResults, candidates }
}
