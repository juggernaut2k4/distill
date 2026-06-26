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
 *
 * Also exports runAutomatedQA() — a pure string-based rule engine that checks
 * word count, "So what?" presence, jargon, and sentence count. Runs before
 * content is marked ready; never throws.
 */

import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import type { TemplateSection } from './templates/types'

const MODEL = 'claude-sonnet-4-6'

// ─── AUTOMATED QA — PURE STRING RULES ────────────────────────────────────────
// These run on every content save, before the AI-powered review, and never throw.

/**
 * Result shape returned by runAutomatedQA.
 * errors   — severity "error", block content from being marked ready
 * warnings — severity "warning", logged but do not block
 */
export interface AutomatedQAResult {
  passed: boolean
  errors: string[]
  warnings: string[]
  wordCount: number
  sentenceCount: number
  hasSoWhat: boolean
}

/** Forbidden phrases for jargon detection (Rule 3). */
const JARGON_PHRASES: string[] = [
  'utilize',
  'synergy',
  'paradigm shift',
  'best-in-class',
  'game-changer',
  'game changer',
  'cutting-edge',
  'cutting edge',
  'state-of-the-art',
  'state of the art',
  'holistic approach',
]

/**
 * "leverage" is jargon only when used as a verb (e.g. "leverage AI").
 * As a noun ("use leverage") it is fine. We detect the verb form by looking
 * for the word in contexts that suggest verb usage: "leverage [a/the/our/your/AI/...]".
 */
function detectLeverageVerb(text: string): boolean {
  // Matches "leverage" followed by a determiner, pronoun, or typical direct-object starter
  return /\bleverages?\s+(?:a|an|the|our|your|their|its|this|that|these|those|[A-Z])/i.test(text)
}

/**
 * Count words by splitting on whitespace sequences.
 * Returns 0 for empty/whitespace-only strings.
 */
function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Count sentences by splitting on sentence-ending punctuation followed by whitespace
 * or end-of-string. Handles `. `, `! `, `? `, and trailing punctuation.
 */
function countSentences(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  // Split on sentence boundary: punctuation + space(s), or punctuation at end
  const parts = trimmed.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 0)
  return parts.length
}

/**
 * Check for a "So what?" sentence.
 * Accepts:
 *   - A sentence starting with "So what?" (any casing)
 *   - A sentence containing "so what" as a clause (e.g. "Here's the so what:")
 */
function hasSoWhatSentence(text: string): boolean {
  const lower = text.toLowerCase()
  // Direct "so what?" at the start of a sentence
  if (/(?:^|[.!?]\s+)so what\?/i.test(text)) return true
  // "so what" used as a distinct clause or introduced phrase
  if (/\bso what\b/i.test(lower)) return true
  return false
}

/**
 * Runs the automated quality rules against a content article text string.
 * Never throws — all errors are caught and returned as a failure result.
 *
 * Rule 1: "So what?" sentence present (error) — articles have no word-count ceiling
 * Rule 2: no jargon (warning)
 * Rule 3: ≥ 3 sentences (error)
 *
 * Note: the 80-word maximum was removed — content articles are cached and can be
 * as long as needed. The generation prompt controls quality; no ceiling is enforced here.
 */
export function runAutomatedQA(text: string): AutomatedQAResult {
  try {
    const errors: string[] = []
    const warnings: string[] = []

    const wordCount = countWords(text)
    const sentenceCount = countSentences(text)
    const hasSoWhat = hasSoWhatSentence(text)

    // Rule 1 — "So what?" sentence
    if (!hasSoWhat) {
      errors.push(
        `Missing 'So what?' sentence. Every insight must end with one sentence explaining what this means for the reader's specific role.`
      )
    }

    // Rule 2 — Jargon check (warning only)
    const foundJargon: string[] = []
    const lowerText = text.toLowerCase()
    for (const phrase of JARGON_PHRASES) {
      if (lowerText.includes(phrase)) {
        foundJargon.push(phrase)
      }
    }
    if (detectLeverageVerb(text)) {
      foundJargon.push('leverage (verb)')
    }
    if (foundJargon.length > 0) {
      warnings.push(
        `Jargon detected: ${foundJargon.join(', ')}. Rewrite in plain business English.`
      )
    }

    // Rule 3 — Minimum substance (≥ 3 sentences)
    if (sentenceCount < 3) {
      errors.push(
        `Content has only ${sentenceCount} sentence(s). An insight needs setup, evidence, and a So what? — at least 3 sentences.`
      )
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      wordCount,
      sentenceCount,
      hasSoWhat,
    }
  } catch (err) {
    // Safety net — QA must never crash the caller
    console.error('[runAutomatedQA] Unexpected error:', err)
    return {
      passed: false,
      errors: ['QA check failed to run due to an internal error.'],
      warnings: [],
      wordCount: 0,
      sentenceCount: 0,
      hasSoWhat: false,
    }
  }
}

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
