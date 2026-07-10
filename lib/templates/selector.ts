/**
 * Rule-based template selector.
 * Maps subtopic titles to the most appropriate template type using keyword matching.
 * When a templateHint (from the LLM's visual_spec) is provided and valid, it takes
 * priority over keyword matching — the LLM knows the content shape, the title does not.
 *
 * SCREEN-01: selectTemplate() is only ever called for REAL subtopics (position
 * 'first'/'middle'/'last' among the N real subtopics). The SessionOverview and
 * SessionSummary sections (sections[0] and sections[N+1]) are constructed
 * directly with type: 'SessionOverview' / 'SessionSummary' at the point
 * `sections` is assembled — they never pass through this function.
 */

import type { TemplateName } from './types'
import { isTemplateApprovedForProduction } from './approval'

// RTV-04 Req #15 — templates that require Arun's explicit sign-off (Gate B)
// before they may ever be selected for a real, live session. Checked in
// selectApprovedTemplate() below; the plain selectTemplate() stays pure/sync
// and unaware of approval state, so existing pure callers/tests are
// unaffected.
const APPROVAL_GATED_TEMPLATES = new Set<TemplateName>(['Heatmap', 'Overlay'])

// All valid template names — used to validate templateHint before trusting it.
const VALID_TEMPLATE_NAMES = new Set<string>([
  'TopicHero', 'ConceptDefinition', 'StepFlow', 'ComparisonTable', 'TwoByTwoMatrix',
  'FrameworkCard', 'ProsCons', 'CaseStudy', 'StatCallout', 'Timeline', 'ConceptMap',
  'QuoteCallout', 'KeyTakeaway', 'QuestionAnswer', 'ActionPlan', 'Funnel', 'Flowchart',
  'Hierarchy', 'ChevronProcess', 'NarrativeCard', 'DefinitionTriptych', 'HorizontalDecision',
  'AnswerSpotlight',
  // RTV-04: two genuinely new template types (Heatmap, Overlay). Added here with
  // identical priority order to every existing type — templateHint (LLM,
  // first-priority) takes precedence, narrow keyword-regex is the fallback below.
  'Heatmap', 'Overlay',
])

/**
 * Selects the best template for a subtopic based on its title, position, and optional LLM hint.
 *
 * @param subtopicTitle - The title of the subtopic
 * @param position - Whether this is the first, middle, or last section
 * @param templateHint - Optional hint from the LLM's visual_spec.template_hint (takes priority over keyword matching)
 * @returns The appropriate TemplateName
 */
export function selectTemplate(
  subtopicTitle: string,
  position: 'first' | 'middle' | 'last',
  templateHint?: string
): TemplateName {
  // Position always wins for first/last — these are structural anchors.
  if (position === 'first') return 'TopicHero'
  if (position === 'last') return 'KeyTakeaway'

  // LLM hint takes priority: the model knows the content shape; the title does not.
  if (templateHint && VALID_TEMPLATE_NAMES.has(templateHint)) {
    return templateHint as TemplateName
  }

  const t = subtopicTitle.toLowerCase()

  // Definition / overview
  if (/what is|introduction to|understanding|overview of/.test(t)) {
    return 'DefinitionTriptych'
  }

  // Comparison / tool landscape — extended to catch model-name and product comparisons
  // that use "and" / "or" / comma-separated names instead of "vs".
  if (/\bvs\b|versus|compare|difference between|top tools|tools compared|platforms compared|platform comparison|tool landscape|model tiers|model comparison|claude model|sonnet.*haiku|haiku.*opus|gpt.*claude|gemini.*claude/.test(t)) {
    return 'ComparisonTable'
  }
  // Three-or-more named items in one title (e.g. "Sonnet, Haiku and Opus")
  if (/[a-z]+,\s*[a-z]+\s+(and|or)\s+[a-z]+/.test(t)) {
    return 'ComparisonTable'
  }

  // Process / how-to
  if (/how to|step|process|implementing|building/.test(t)) {
    return 'StepFlow'
  }

  // Framework / model
  if (/framework|model|approach|methodology/.test(t)) {
    return 'FrameworkCard'
  }

  // Pros/Cons / decision
  if (/risk|benefit|pros|cons|should we|trade/.test(t)) {
    return 'ProsCons'
  }

  // Case study
  if (/case study|example|how [a-z]+ (used|built|deployed|scaled|implemented)/.test(t)) {
    return 'NarrativeCard'
  }

  // Statistics / data
  if (/statistic|data|market|growth|%|billion|trillion/.test(t)) {
    return 'StatCallout'
  }

  // History / evolution
  if (/history|evolution|timeline|journey/.test(t)) {
    return 'Timeline'
  }

  // Ecosystem / map
  if (/ecosystem|landscape|map|relationship/.test(t)) {
    return 'ConceptMap'
  }

  // Strategy / prioritisation / evaluation
  if (/strateg|priorit|evaluat|assess/.test(t)) {
    return 'TwoByTwoMatrix'
  }

  // Flowchart / decision / branching logic
  if (/flow|decision|if.*then|branch|route|path|workflow/.test(t)) {
    return 'HorizontalDecision'
  }

  // Question / FAQ / answer
  if (/\?$|^why |^what |^how does|^when should|^is it|faq|question/.test(t)) {
    return 'AnswerSpotlight'
  }

  // Hierarchy / taxonomy / tree / structure
  if (/hierarch|taxonomy|tree|categor|breakdown|structure|organis|organizat/.test(t)) {
    return 'Hierarchy'
  }

  // Funnel / pipeline / selection
  if (/funnel|pipeline|filter|select|screen/.test(t)) {
    return 'ChevronProcess'
  }

  // RTV-04: Heatmap — graduated intensity across a small grid (narrow, so it
  // never shadows the existing TwoByTwoMatrix/ComparisonTable keyword rules above).
  if (/heat ?map|maturity grid|intensity (grid|map)/.test(t)) {
    return 'Heatmap'
  }

  // RTV-04: Overlay — one whole thing broken into a few labeled zones/parts.
  if (/overlay|zones? of|where (does|do|.+) fit(s)? (in|into)/.test(t)) {
    return 'Overlay'
  }

  // Default
  return 'DefinitionTriptych'
}

/**
 * RTV-04 Req #15 — the gated entry point real session pipelines must call
 * instead of selectTemplate() directly. Identical selection logic, except:
 * if the result is an approval-gated template (Heatmap, Overlay) that has not
 * been approved in template_library yet, falls back to 'DefinitionTriptych'
 * — the same default a pre-RTV-04 build would have produced for that topic,
 * since these two branches did not exist before RTV-04 and a templateHint of
 * 'Heatmap'/'Overlay' would previously have been rejected as invalid.
 *
 * This is what actually enforces "no live generative drawing" for unapproved
 * templates — isTemplateApprovedForProduction() alone is inert until a call
 * site checks it, and this is that call site.
 */
export async function selectApprovedTemplate(
  subtopicTitle: string,
  position: 'first' | 'middle' | 'last',
  templateHint?: string
): Promise<TemplateName> {
  const selected = selectTemplate(subtopicTitle, position, templateHint)
  if (!APPROVAL_GATED_TEMPLATES.has(selected)) return selected

  const approved = await isTemplateApprovedForProduction(selected)
  return approved ? selected : 'DefinitionTriptych'
}

/**
 * Maps an array of subtopic titles to template names, correctly assigning
 * 'first' and 'last' positions.
 *
 * @param subtopicTitles - Ordered list of subtopic titles for the session
 * @returns Ordered list of TemplateName values
 */
export function selectTemplatesForSubtopics(subtopicTitles: string[]): TemplateName[] {
  if (subtopicTitles.length === 0) return []
  if (subtopicTitles.length === 1) return [selectTemplate(subtopicTitles[0], 'first')]

  return subtopicTitles.map((title, index) => {
    const position =
      index === 0 ? 'first' : index === subtopicTitles.length - 1 ? 'last' : 'middle'
    return selectTemplate(title, position)
  })
}
