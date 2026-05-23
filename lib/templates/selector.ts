/**
 * Rule-based template selector.
 * Maps subtopic titles to the most appropriate template type using keyword matching.
 */

import type { TemplateName } from './types'

/**
 * Selects the best template for a subtopic based on its title and position.
 *
 * @param subtopicTitle - The title of the subtopic
 * @param position - Whether this is the first, middle, or last section
 * @returns The appropriate TemplateName
 */
export function selectTemplate(
  subtopicTitle: string,
  position: 'first' | 'middle' | 'last'
): TemplateName {
  if (position === 'first') return 'TopicHero'
  if (position === 'last') return 'KeyTakeaway'

  const t = subtopicTitle.toLowerCase()

  // Definition / overview
  if (/what is|introduction to|understanding|overview of/.test(t)) {
    return 'ConceptDefinition'
  }

  // Comparison
  if (/\bvs\b|versus|compare|difference between/.test(t)) {
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
    return 'CaseStudy'
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
    return 'Flowchart'
  }

  // Hierarchy / taxonomy / tree / structure
  if (/hierarch|taxonomy|tree|categor|breakdown|structure|organis|organizat/.test(t)) {
    return 'Hierarchy'
  }

  // Funnel / pipeline / selection
  if (/funnel|pipeline|filter|select|screen/.test(t)) {
    return 'Funnel'
  }

  // Default
  return 'ConceptDefinition'
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
