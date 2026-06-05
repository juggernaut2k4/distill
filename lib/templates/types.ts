/**
 * Template type system for the Distill session visualization.
 * Each template is a full-screen section in the vertical stack layout.
 * The discriminated union ensures TypeScript knows the data shape from the type field.
 */

// ─── META ─────────────────────────────────────────────────────────────────────

export interface TemplateMeta {
  subtopicTitle: string
  sessionTitle: string
  userRole: string
  userIndustry: string
}

// ─── TEMPLATE DATA TYPES ──────────────────────────────────────────────────────

export interface TopicHeroData {
  topic_name: string
  key_question: string
  key_takeaways: string[]   // 2-3 concrete outcomes the reader will leave with
  so_what_preview: string   // one-line payoff personalised to role
  why_now?: string          // optional urgency/relevance hook
}

export interface ConceptDefinitionData {
  term: string
  category: string
  one_line: string
  plain_english: string
  real_world_example: {
    company: string
    what_they_did: string
    result: string
  }
  common_misconception: string
  so_what: string
}

export interface StepFlowData {
  title: string
  context: string
  steps: Array<{
    number: number
    title: string
    description: string
    what_to_watch_for?: string
    time_estimate?: string
  }>
  outcome: string
  so_what: string
}

export interface ComparisonTableData {
  title: string
  context: string
  options: Array<{
    name: string
    tagline: string
    best_for: string
  }>
  criteria: Array<{
    label: string
    description?: string
    values: string[]
    winner_index?: number
  }>
  verdict: string
  so_what: string
}

export interface TwoByTwoMatrixData {
  title: string
  context: string
  x_axis: {
    label: string
    low_label: string
    high_label: string
  }
  y_axis: {
    label: string
    low_label: string
    high_label: string
  }
  quadrants: Array<{
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    name: string
    color: string
    description: string
    examples: string[]
  }>
  where_most_executives_are?: string
  so_what: string
}

export interface FrameworkCardData {
  framework_name: string
  coined_by?: string
  purpose: string
  components: Array<{
    letter?: string
    name: string
    description: string
    executive_question: string
  }>
  when_to_use: string
  when_not_to_use: string
  so_what: string
}

export interface ProsConsData {
  title: string
  context: string
  topic: string
  pros: Array<{
    title: string
    description: string
    evidence?: string
  }>
  cons: Array<{
    title: string
    description: string
    mitigation?: string
  }>
  verdict: string
  so_what: string
}

export interface CaseStudyData {
  company: string
  industry: string
  company_size?: string
  challenge: string
  ai_solution: string
  results: Array<{
    metric: string
    value: string
    timeframe?: string
  }>
  key_lesson: string
  what_they_got_right: string
  what_they_got_wrong?: string
  so_what_for_you: string
}

export interface StatCalloutData {
  headline_stat: string
  unit: string
  context: string
  source?: string
  why_it_matters: string
  supporting_stats: Array<{
    stat: string
    label: string
  }>
  so_what: string
}

export interface TimelineData {
  title: string
  context: string
  events: Array<{
    year: string
    title: string
    description: string
    significance: 'low' | 'medium' | 'high'
    color?: string
  }>
  where_we_are_now: string
  so_what: string
}

export interface ConceptMapData {
  title: string
  central_concept: string
  nodes: Array<{
    id: string
    label: string
    description: string
    category: string
    color: string
  }>
  edges: Array<{
    from: string
    to: string
    relationship: string
  }>
  so_what: string
}

export interface QuoteCalloutData {
  quote: string
  attribution?: string
  context: string
  so_what: string
}

export interface KeyTakeawayData {
  topic: string
  insights: Array<{
    insight: string
    implication: string
  }>
  one_thing_to_remember: string
  action_for_you: string
  next_topic_preview?: string
}

export interface QuestionAnswerData {
  question: string
  direct_answer: string
  analogy?: string
  example?: string
  important_nuance?: string
  so_what: string
  returning_to: string
}

export interface ActionPlanData {
  session_topic: string
  key_takeaways: Array<{
    takeaway: string
    why_it_matters: string
  }>
  immediate_actions: Array<{
    action: string
    timeline: string
    difficulty: 'easy' | 'medium' | 'hard'
  }>
  questions_to_ask_your_team: string[]
  watch_out_for: string[]
  next_session_preview?: string
}

export interface FunnelData {
  title: string
  context: string
  stages: Array<{
    name: string
    description: string
    what_gets_filtered_out: string
    decision_criteria: string
  }>
  what_makes_it_through: string
  so_what: string
}

export interface FlowchartData {
  title: string
  context: string
  nodes: Array<{
    id: string
    type: 'start' | 'decision' | 'action' | 'end'
    label: string
    detail?: string
  }>
  edges: Array<{
    from: string
    to: string
    label?: string
  }>
  so_what: string
}

export interface HierarchyNode {
  label: string
  detail?: string
  children?: HierarchyNode[]
}

export interface HierarchyData {
  title: string
  context: string
  root: HierarchyNode
  so_what: string
}

// ─── NEW TEMPLATE DATA TYPES ──────────────────────────────────────────────────

export interface ChevronProcessData {
  title: string
  context: string
  stages: Array<{
    name: string        // max 3 words
    description: string // 1-2 sentences
    key_action: string  // what the exec does here, 1 sentence
  }>                    // max 4 stages
  outcome: string       // what emerges at the end
  so_what: string
}

export interface NarrativeCardData {
  company: string
  industry: string
  challenge: string   // 1-2 sentences
  approach: string    // 1-2 sentences
  impact: string      // 1-2 sentences
  metrics: Array<{
    value: string     // e.g. "40%"
    label: string     // e.g. "cost reduction"
  }>                  // max 3
  lesson: string      // key takeaway 1 sentence
  so_what: string
}

export interface DefinitionTriptychData {
  term: string
  category: string
  what_it_is: string      // 2-3 sentences, plain English
  real_example: {
    company: string
    what: string          // 1-2 sentences
    result: string        // 1 sentence
  }
  common_myth: string     // "People think X. Actually Y." 1-2 sentences
  so_what: string
}

export interface HorizontalDecisionData {
  title: string
  context: string
  nodes: Array<{
    id: string
    label: string                        // max 6 words
    detail?: string | null               // 1 sentence
    type: 'start' | 'decision' | 'action' | 'end'
    branch_label?: string | null         // shown on arrow going down for decision nodes
    branch_outcome?: string | null       // text in the branch box below decision node
  }>                                     // max 4 nodes
  so_what: string
}

export interface AnswerSpotlightData {
  question: string
  direct_answer: string   // 2-3 sentences
  analogy?: string | null
  example?: string | null
  important_nuance?: string | null
  so_what: string
}

// ─── VISUALIZATION TAB MANIFEST ───────────────────────────────────────────────

export interface VisualizationTab {
  tab_id: string
  tab_index: number       // 1-based
  tab_name: string
  section: TemplateSection
  mapped_segments: string[]
}

export interface TabManifest {
  subtopic_slug: string
  tabs: VisualizationTab[]
}

// ─── SECTION STATUS ───────────────────────────────────────────────────────────

export type SectionStatus = 'pending' | 'ready' | 'active' | 'completed' | 'skipped' | 'inserted'

// ─── TEMPLATE NAME UNION ──────────────────────────────────────────────────────

export type TemplateName =
  | 'TopicHero'
  | 'ConceptDefinition'
  | 'StepFlow'
  | 'ComparisonTable'
  | 'TwoByTwoMatrix'
  | 'FrameworkCard'
  | 'ProsCons'
  | 'CaseStudy'
  | 'StatCallout'
  | 'Timeline'
  | 'ConceptMap'
  | 'QuoteCallout'
  | 'KeyTakeaway'
  | 'QuestionAnswer'
  | 'Flowchart'
  | 'Hierarchy'
  | 'ActionPlan'
  | 'Funnel'
  | 'ChevronProcess'
  | 'NarrativeCard'
  | 'DefinitionTriptych'
  | 'HorizontalDecision'
  | 'AnswerSpotlight'

// ─── DISCRIMINATED UNION ──────────────────────────────────────────────────────

export type TemplateSection =
  | { id: string; type: 'TopicHero'; data: TopicHeroData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'ConceptDefinition'; data: ConceptDefinitionData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'StepFlow'; data: StepFlowData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'ComparisonTable'; data: ComparisonTableData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'TwoByTwoMatrix'; data: TwoByTwoMatrixData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'FrameworkCard'; data: FrameworkCardData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'ProsCons'; data: ProsConsData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'CaseStudy'; data: CaseStudyData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'StatCallout'; data: StatCalloutData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'Timeline'; data: TimelineData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'ConceptMap'; data: ConceptMapData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'QuoteCallout'; data: QuoteCalloutData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'KeyTakeaway'; data: KeyTakeawayData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'QuestionAnswer'; data: QuestionAnswerData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'ActionPlan'; data: ActionPlanData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'Funnel'; data: FunnelData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'Flowchart'; data: FlowchartData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'Hierarchy'; data: HierarchyData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'ChevronProcess'; data: ChevronProcessData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'NarrativeCard'; data: NarrativeCardData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'DefinitionTriptych'; data: DefinitionTriptychData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'HorizontalDecision'; data: HorizontalDecisionData; meta: TemplateMeta; status: SectionStatus }
  | { id: string; type: 'AnswerSpotlight'; data: AnswerSpotlightData; meta: TemplateMeta; status: SectionStatus }
