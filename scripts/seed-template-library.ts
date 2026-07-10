/**
 * RTV-04 — one-time (idempotent) seed for the `template_library` table.
 *
 * Seeds all 27 rows (25 already-live TemplateName values + the 2 new ones,
 * Heatmap + Overlay), every row at status='pending_review' with provenance
 * 'existing' | 'new'. Uses ON CONFLICT (template_name) DO NOTHING — safe to
 * re-run, never overwrites a human review decision already recorded by Arun.
 *
 * Sample data for the 23 content-bearing templates and the 2 new ones comes
 * directly from lib/templates/generator.ts's getMockData() — the same,
 * already-reviewed, interface-correct mock data used when ANTHROPIC_API_KEY
 * is a placeholder — so no shape is fabricated here. SessionOverview/
 * SessionSummary sample data is hand-built to match SessionOverviewData/
 * SessionSummaryData (lib/templates/types.ts) using the real, exported
 * buildOverviewTeachContent()/buildSummaryTeachContent() helpers from
 * lib/templates/session-bookends.ts for the `script.teach` field, plus the
 * fixed literal framing/closing/checkpoint/continue strings that module
 * defines (not LLM-generated, never fabricated here).
 *
 * Run with: npx tsx scripts/seed-template-library.ts
 * Reads SUPABASE credentials from the environment (see .env.local.example).
 *
 * NOT executed as part of this build — left for Arun/the orchestrator to run
 * after reviewing the migration (supabase/migrations/065_rtv04_template_library.sql).
 */

import { createClient } from '@supabase/supabase-js'
import { getMockData } from '@/lib/templates/generator'
import { getContainerSpecForTemplate } from '@/lib/templates/containerBudgets'
import { buildOverviewTeachContent, buildSummaryTeachContent } from '@/lib/templates/session-bookends'
import type { TemplateName } from '@/lib/templates/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// Generic, neutral sample subtopic title used only to fill getMockData()'s
// `${subtopicTitle}` interpolations for the 23 existing templates — the
// review screen shows Arun the rendered design, not this placeholder text.
const SAMPLE_SUBTOPIC_TITLE = 'AI Strategy Fundamentals'

const DISPLAY_NAMES: Record<TemplateName, string> = {
  TopicHero: 'Topic Hero',
  ConceptDefinition: 'Concept Definition',
  StepFlow: 'Step Flow',
  ComparisonTable: 'Comparison Table',
  TwoByTwoMatrix: '2x2 Matrix',
  FrameworkCard: 'Framework Card',
  ProsCons: 'Pros & Cons',
  CaseStudy: 'Case Study',
  StatCallout: 'Stat Callout',
  Timeline: 'Timeline',
  ConceptMap: 'Concept Map',
  QuoteCallout: 'Quote Callout (generic fallback)',
  KeyTakeaway: 'Key Takeaway',
  QuestionAnswer: 'Question & Answer',
  Flowchart: 'Flowchart',
  Hierarchy: 'Hierarchy',
  ActionPlan: 'Action Plan',
  Funnel: 'Funnel',
  ChevronProcess: 'Chevron Process',
  NarrativeCard: 'Narrative Card',
  DefinitionTriptych: 'Definition Triptych',
  HorizontalDecision: 'Horizontal Decision',
  AnswerSpotlight: 'Answer Spotlight',
  Heatmap: 'Heatmap',
  Overlay: 'Overlay',
  SessionOverview: 'Session Overview',
  SessionSummary: 'Session Summary',
}

// The 25 TemplateName values that existed before RTV-04 (23 content-bearing +
// 2 structural bookends). Heatmap/Overlay are the 2 genuinely new ones.
const EXISTING_TEMPLATE_NAMES: TemplateName[] = [
  'TopicHero', 'ConceptDefinition', 'StepFlow', 'ComparisonTable', 'TwoByTwoMatrix',
  'FrameworkCard', 'ProsCons', 'CaseStudy', 'StatCallout', 'Timeline', 'ConceptMap',
  'QuoteCallout', 'KeyTakeaway', 'QuestionAnswer', 'Flowchart', 'Hierarchy', 'ActionPlan',
  'Funnel', 'ChevronProcess', 'NarrativeCard', 'DefinitionTriptych', 'HorizontalDecision',
  'AnswerSpotlight', 'SessionOverview', 'SessionSummary',
]

const NEW_TEMPLATE_NAMES: TemplateName[] = ['Heatmap', 'Overlay']

// ─── SessionOverview / SessionSummary sample data ──────────────────────────
// Never LLM-generated in production either — built the same way
// session-bookends.ts builds the real thing, so this is a faithful sample,
// not a fabrication. The fixed literal strings below are copied verbatim
// from lib/templates/session-bookends.ts's module-private constants.

const SAMPLE_SESSION_TITLE = 'AI Strategy Fundamentals'
const SAMPLE_AGENDA = [
  { subtopic_title: 'What Is Applied AI?', skipped: false },
  { subtopic_title: 'Build vs. Buy Decisions', skipped: false },
  { subtopic_title: 'Governance & Risk', skipped: false },
]
const SAMPLE_COVERED_SUBTOPICS = SAMPLE_AGENDA.map((a) => a.subtopic_title)

function buildSessionOverviewSample() {
  return {
    session_title: SAMPLE_SESSION_TITLE,
    agenda: SAMPLE_AGENDA,
    framing_line: "Let's dive in.",
    script: {
      teach: buildOverviewTeachContent(SAMPLE_SESSION_TITLE, SAMPLE_AGENDA),
      checkpoint: 'Does that agenda work for you, or is there something specific you want to make sure we get to?',
      continue: "Perfect — let's dive into the first one.",
    },
  }
}

function buildSessionSummarySample() {
  return {
    session_title: SAMPLE_SESSION_TITLE,
    covered_subtopics: SAMPLE_COVERED_SUBTOPICS,
    closing_line: 'Nice work today.',
    script: {
      teach: buildSummaryTeachContent(SAMPLE_SESSION_TITLE, SAMPLE_COVERED_SUBTOPICS),
      checkpoint: 'How did that feel — anything you want to flag before we close out?',
      continue: 'Nice work today. Talk soon.',
    },
  }
}

function getSampleData(templateType: TemplateName): unknown {
  if (templateType === 'SessionOverview') return buildSessionOverviewSample()
  if (templateType === 'SessionSummary') return buildSessionSummarySample()
  return getMockData(templateType, SAMPLE_SUBTOPIC_TITLE)
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!)

  const rows = [
    ...EXISTING_TEMPLATE_NAMES.map((name) => ({ name, provenance: 'existing' as const })),
    ...NEW_TEMPLATE_NAMES.map((name) => ({ name, provenance: 'new' as const })),
  ].map(({ name, provenance }) => ({
    template_name: name,
    display_name: DISPLAY_NAMES[name],
    provenance,
    status: 'pending_review',
    sample_data: getSampleData(name),
    container_spec: getContainerSpecForTemplate(name),
  }))

  if (rows.length !== 27) {
    console.error(`Expected exactly 27 rows, built ${rows.length}. Aborting.`)
    process.exit(1)
  }

  const { data, error } = await supabase
    .from('template_library')
    .upsert(rows, { onConflict: 'template_name', ignoreDuplicates: true })
    .select('template_name')

  if (error) {
    console.error('Seed failed:', error)
    process.exit(1)
  }

  console.log(`Seed complete. ${data?.length ?? 0} row(s) inserted (existing rows/decisions left untouched).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
