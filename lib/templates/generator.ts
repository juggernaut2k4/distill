/**
 * Claude-powered template data generator.
 * Produces structured JSON data for each template type, personalised to the user's
 * role and industry. Falls back to realistic mock data when the API key is a placeholder.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '../supabase'
import type { TemplateName, TemplateSection } from './types'

// ─── CLIENT ───────────────────────────────────────────────────────────────────

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-6'

// ─── APPROVED RULES CACHE ─────────────────────────────────────────────────────
// Fetched once from DB and reused for 5 minutes to avoid a Supabase round-trip
// on every section generation. Cleared automatically when a rule is approved.

let _rulesCache: string[] | null = null
let _rulesCacheTime = 0
const RULES_TTL_MS = 5 * 60 * 1000

export async function getApprovedRules(): Promise<string[]> {
  if (_rulesCache !== null && Date.now() - _rulesCacheTime < RULES_TTL_MS) {
    return _rulesCache
  }
  try {
    const supabase = createSupabaseAdminClient()
    const { data } = await supabase
      .from('kb_qa_rules')
      .select('rule_text')
      .eq('status', 'approved')
    _rulesCache = (data ?? []).map((r: { rule_text: string }) => r.rule_text)
    _rulesCacheTime = Date.now()
    return _rulesCache
  } catch {
    return _rulesCache ?? []
  }
}

export function invalidateRulesCache() {
  _rulesCache = null
}

// ─── USER CONTEXT TYPE ────────────────────────────────────────────────────────

interface UserContext {
  role: string
  industry: string
  maturity: string
  domain?: string       // learning domain e.g. 'AI & Machine Learning', 'DevOps', 'React'
  proficiency?: string  // 'beginner' | 'intermediate' | 'advanced' | 'expert'
}

interface AdjacentTopics {
  previous?: string
  next?: string
}

// ─── SCHEMA DESCRIPTIONS ─────────────────────────────────────────────────────

function getSchemaForTemplate(type: TemplateName): string {
  const schemas: Record<TemplateName, string> = {
    TopicHero: `{
  "topic_name": string,
  "key_question": string,          // the single most important question this topic answers
  "key_takeaways": string[],       // exactly 3 concrete things the reader will leave knowing/able to do
  "so_what_preview": string,       // one-line payoff personalised to role+industry
  "why_now": string | null         // one sentence on why this is urgent or relevant right now (null if not applicable)
}`,
    ConceptDefinition: `{
  "term": string,
  "category": string,              // e.g. "AI Architecture", "Business Strategy"
  "one_line": string,              // crisp 10-word definition
  "plain_english": string,         // 2-3 sentence plain explanation
  "real_world_example": {
    "company": string,
    "what_they_did": string,
    "result": string
  },
  "common_misconception": string,
  "so_what": string                // personalised to role+industry
}`,
    StepFlow: `{
  "title": string,
  "context": string,
  "steps": [
    {
      "number": number,
      "title": string,
      "description": string,
      "what_to_watch_for": string | null,
      "time_estimate": string | null
    }
  ],
  "outcome": string,
  "so_what": string
}`,
    ComparisonTable: `{
  "title": string,
  "context": string,
  "options": [{ "name": string, "tagline": string, "best_for": string }],
  "criteria": [
    {
      "label": string,
      "description": string | null,
      "values": string[],          // one per option, same order
      "winner_index": number | null
    }
  ],
  "verdict": string,
  "so_what": string
}`,
    TwoByTwoMatrix: `{
  "title": string,
  "context": string,
  "x_axis": { "label": string, "low_label": string, "high_label": string },
  "y_axis": { "label": string, "low_label": string, "high_label": string },
  "quadrants": [
    {
      "position": "top-left" | "top-right" | "bottom-left" | "bottom-right",
      "name": string,
      "color": string,             // hex
      "description": string,
      "examples": string[]
    }
  ],
  "where_most_executives_are": string | null,
  "so_what": string
}`,
    FrameworkCard: `{
  "framework_name": string,
  "coined_by": string | null,
  "purpose": string,
  "components": [
    {
      "letter": string | null,     // for acronym frameworks
      "name": string,
      "description": string,
      "executive_question": string
    }
  ],
  "when_to_use": string,
  "when_not_to_use": string,
  "so_what": string
}`,
    ProsCons: `{
  "title": string,
  "context": string,
  "topic": string,
  "pros": [{ "title": string, "description": string, "evidence": string | null }],
  "cons": [{ "title": string, "description": string, "mitigation": string | null }],
  "verdict": string,
  "so_what": string
}`,
    CaseStudy: `{
  "company": string,
  "industry": string,
  "company_size": string | null,
  "challenge": string,
  "ai_solution": string,
  "results": [{ "metric": string, "value": string, "timeframe": string | null }],
  "key_lesson": string,
  "what_they_got_right": string,
  "what_they_got_wrong": string | null,
  "so_what_for_you": string
}`,
    StatCallout: `{
  "headline_stat": string,
  "unit": string,
  "context": string,
  "source": string | null,
  "why_it_matters": string,
  "supporting_stats": [{ "stat": string, "label": string }],
  "so_what": string
}`,
    Timeline: `{
  "title": string,
  "context": string,
  "events": [
    {
      "year": string,
      "title": string,
      "description": string,
      "significance": "low" | "medium" | "high",
      "color": string | null
    }
  ],
  "where_we_are_now": string,
  "so_what": string
}`,
    ConceptMap: `{
  "title": string,
  "central_concept": string,
  "nodes": [{ "id": string, "label": string, "description": string, "category": string, "color": string }],
  "edges": [{ "from": string, "to": string, "relationship": string }],
  "so_what": string
}`,
    QuoteCallout: `{
  "quote": string,
  "attribution": string | null,
  "context": string,
  "so_what": string
}`,
    KeyTakeaway: `{
  "topic": string,
  "insights": [{ "insight": string, "implication": string }],
  "one_thing_to_remember": string,
  "action_for_you": string,
  "next_topic_preview": string | null
}`,
    QuestionAnswer: `{
  "question": string,
  "direct_answer": string,
  "analogy": string | null,
  "example": string | null,
  "important_nuance": string | null,
  "so_what": string,
  "returning_to": string
}`,
    ActionPlan: `{
  "session_topic": string,
  "key_takeaways": [{ "takeaway": string, "why_it_matters": string }],
  "immediate_actions": [
    {
      "action": string,
      "timeline": string,
      "difficulty": "easy" | "medium" | "hard"
    }
  ],
  "questions_to_ask_your_team": string[],
  "watch_out_for": string[],
  "next_session_preview": string | null
}`,
    Funnel: `{
  "title": string,
  "context": string,
  "stages": [
    {
      "name": string,
      "description": string,
      "what_gets_filtered_out": string,
      "decision_criteria": string
    }
  ],
  "what_makes_it_through": string,
  "so_what": string
}`,
    Flowchart: `{
  "title": string,
  "context": string,
  "nodes": [
    { "id": string, "type": "start"|"decision"|"action"|"end", "label": string, "detail": string|null }
  ],
  "edges": [
    { "from": string, "to": string, "label": string|null }
  ],
  "so_what": string
}`,
    Hierarchy: `{
  "title": string,
  "context": string,
  "root": {
    "label": string,
    "detail": string|null,
    "children": [
      {
        "label": string,
        "detail": string|null,
        "children": [{ "label": string, "detail": string|null }]
      }
    ]
  },
  "so_what": string
}`,
    ChevronProcess: `{
  "title": string,
  "context": string,
  "stages": [                          // exactly 3-4 stages, NO MORE than 4
    {
      "name": string,                  // max 3 words
      "description": string,           // 1-2 sentences
      "key_action": string             // what the executive does here
    }
  ],
  "outcome": string,                   // what emerges at the end
  "so_what": string
}`,
    NarrativeCard: `{
  "company": string,
  "industry": string,
  "challenge": string,                 // 1-2 sentences
  "approach": string,                  // 1-2 sentences
  "impact": string,                    // 1-2 sentences
  "metrics": [                         // exactly 2-3 metrics, NO MORE than 3
    { "value": string, "label": string }
  ],
  "lesson": string,
  "so_what": string
}`,
    DefinitionTriptych: `{
  "term": string,
  "category": string,
  "what_it_is": string,               // 2-3 sentences, plain English, no jargon
  "real_example": {
    "company": string,
    "what": string,                   // 1-2 sentences
    "result": string                  // 1 sentence with a number if possible
  },
  "common_myth": string,              // "People think X. Actually Y." 1-2 sentences
  "so_what": string
}`,
    HorizontalDecision: `{
  "title": string,
  "context": string,
  "nodes": [                          // exactly 3-4 nodes, NO MORE than 4
    {
      "id": string,
      "label": string,                // max 6 words
      "detail": string | null,        // 1 sentence or null
      "type": "start" | "decision" | "action" | "end",
      "branch_label": string | null,  // only for decision nodes, e.g. "If No"
      "branch_outcome": string | null // only for decision nodes, 1 sentence
    }
  ],
  "so_what": string
}`,
    AnswerSpotlight: `{
  "question": string,
  "direct_answer": string,            // 2-3 sentences
  "analogy": string | null,
  "example": string | null,
  "important_nuance": string | null,
  "so_what": string
}`,
  }

  return schemas[type]
}

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

/**
 * Returns realistic hardcoded mock data for each template type.
 * Used when ANTHROPIC_API_KEY is a placeholder.
 */
export function getMockData(type: TemplateName, subtopicTitle: string): TemplateSection['data'] {
  const mockMap: Record<TemplateName, TemplateSection['data']> = {
    TopicHero: {
      topic_name: subtopicTitle,
      key_question: `What does ${subtopicTitle} actually mean for how you run your business?`,
      key_takeaways: [
        'How to spot when an AI vendor is overselling their capabilities',
        'The one question to ask before any AI procurement decision',
        'What your CTO should own versus what you need to govern',
      ],
      so_what_preview: 'This one concept will change how you evaluate every AI vendor pitch.',
      why_now: 'Boards are beginning to ask about AI strategy in every governance cycle.',
    },
    ConceptDefinition: {
      term: subtopicTitle,
      category: 'AI Architecture',
      one_line: 'The system that decides what an AI model does next.',
      plain_english:
        'Think of it like a project manager for AI — it breaks big tasks into smaller ones, delegates them, and assembles the results. Instead of one AI doing everything, an orchestration layer coordinates many specialists.',
      real_world_example: {
        company: 'JPMorgan Chase',
        what_they_did: 'Deployed an AI orchestration layer across 300 internal tools, routing analyst queries to the right model automatically.',
        result: 'Reduced research time by 40% in the first quarter of rollout.',
      },
      common_misconception:
        'Most executives think "AI orchestration" means one powerful model. It actually means many coordinated models — more like a symphony than a solo.',
      so_what:
        'As a CEO, your job is not to understand every note — it\'s to know who\'s conducting. Ask your CTO: "Who owns orchestration accountability?"',
    },
    StepFlow: {
      title: `How to Implement ${subtopicTitle}`,
      context: 'A practical sequence for senior leaders overseeing an AI initiative.',
      steps: [
        {
          number: 1,
          title: 'Audit your current data landscape',
          description: 'Before any AI project starts, map what data you have, where it lives, and who owns it. Ungoverned data is the #1 reason AI projects fail.',
          what_to_watch_for: 'Siloed data in business units that IT doesn\'t know about.',
          time_estimate: '2-4 weeks',
        },
        {
          number: 2,
          title: 'Define the business outcome, not the technology',
          description: 'Frame the initiative as "reduce churn by 15%" not "build an ML model." This keeps the team focused on value, not technical novelty.',
          what_to_watch_for: 'Engineers who want to solve the interesting problem rather than the business problem.',
          time_estimate: '1 week',
        },
        {
          number: 3,
          title: 'Run a 6-week proof of concept',
          description: 'Test against a real business case with a small dataset. Validate accuracy, latency, and user adoption — not just model performance.',
          what_to_watch_for: 'POC success that doesn\'t translate to production scale.',
          time_estimate: '6 weeks',
        },
        {
          number: 4,
          title: 'Build the governance layer',
          description: 'Assign an AI owner, define escalation paths, and set review cycles before you scale. Retrofitting governance is 3x more expensive.',
          what_to_watch_for: 'Governance treated as a legal checkbox rather than an operational necessity.',
          time_estimate: '2 weeks',
        },
      ],
      outcome: 'A live, governed AI capability with measurable business impact and clear ownership.',
      so_what: 'As a CEO, your leverage point is Step 2. If your team can\'t articulate the business outcome in one sentence, the project isn\'t ready.',
    },
    ComparisonTable: {
      title: `Comparing AI Approaches: ${subtopicTitle}`,
      context: 'Three common paths executives choose — each with different cost, speed, and risk profiles.',
      options: [
        { name: 'Build in-house', tagline: 'Full control, full cost', best_for: 'Competitive differentiation' },
        { name: 'Buy a platform', tagline: 'Fast start, vendor lock-in risk', best_for: 'Speed and standardisation' },
        { name: 'Hybrid model', tagline: 'Balanced risk, complex governance', best_for: 'Large enterprises with mixed needs' },
      ],
      criteria: [
        { label: 'Time to value', values: ['12-24 months', '1-3 months', '6-12 months'], winner_index: 1 },
        { label: 'Upfront cost', values: ['$2M-$10M+', '$50K-$500K', '$500K-$3M'], winner_index: 1 },
        { label: 'Data privacy control', values: ['Full', 'Partial', 'High'], winner_index: 0 },
        { label: 'Long-term flexibility', values: ['Maximum', 'Limited', 'Moderate'], winner_index: 0 },
        { label: 'Talent requirement', values: ['Very high', 'Low', 'Medium'], winner_index: 1 },
      ],
      verdict: 'For most mid-large enterprises, the hybrid model balances speed with control — but only if you have a clear governance owner before day one.',
      so_what: 'As a CEO, resist the "build vs. buy" binary. The smarter question is: "Which capabilities must we own, and which can we rent?"',
    },
    TwoByTwoMatrix: {
      title: `AI Initiative Prioritisation Matrix`,
      context: 'Use this to rank AI projects by strategic value and implementation feasibility.',
      x_axis: { label: 'Implementation Difficulty', low_label: 'Easy', high_label: 'Hard' },
      y_axis: { label: 'Business Impact', low_label: 'Low', high_label: 'High' },
      quadrants: [
        {
          position: 'top-left',
          name: 'Quick Wins',
          color: '#10B981',
          description: 'High impact, easy to implement. Start here. These build momentum and fund harder bets.',
          examples: ['AI-powered customer FAQ', 'Automated invoice processing', 'Sales email personalisation'],
        },
        {
          position: 'top-right',
          name: 'Strategic Bets',
          color: '#7C3AED',
          description: 'High impact but complex. These are your 18-month plays — resource them properly or don\'t start.',
          examples: ['Predictive demand forecasting', 'AI underwriting', 'Real-time supply chain optimisation'],
        },
        {
          position: 'bottom-left',
          name: 'Fill-ins',
          color: '#475569',
          description: 'Low impact, low effort. Delegate these. Don\'t let them crowd out strategic bets.',
          examples: ['Meeting summary tools', 'Internal document search', 'HR policy chatbots'],
        },
        {
          position: 'bottom-right',
          name: 'Traps',
          color: '#EF4444',
          description: 'Low impact, high effort. These are the projects that kill AI momentum. Kill them early.',
          examples: ['Bespoke recommendation engines before data is clean', 'Fully custom LLM training'],
        },
      ],
      where_most_executives_are: 'Most leadership teams spend 60% of AI budget in the bottom-right quadrant without realising it.',
      so_what: 'As a CEO, ask your CTO to map every active AI initiative to this matrix. If more than two projects are in the Traps quadrant, you have a prioritisation problem.',
    },
    FrameworkCard: {
      framework_name: 'The AI Readiness Framework',
      coined_by: 'McKinsey Digital',
      purpose: 'Assess whether an organisation is structurally ready to capture value from AI — before spending a dollar on technology.',
      components: [
        {
          letter: 'D',
          name: 'Data Foundation',
          description: 'Centralised, governed, accessible data at scale.',
          executive_question: 'Can our data team answer any business question in under 24 hours?',
        },
        {
          letter: 'A',
          name: 'Algorithmic Capability',
          description: 'In-house talent or credible partners who can build and validate models.',
          executive_question: 'Do we have at least one person who can call out a bad AI vendor?',
        },
        {
          letter: 'T',
          name: 'Technology Infrastructure',
          description: 'Cloud-native, API-first systems that can integrate AI outputs into workflows.',
          executive_question: 'Can our systems act on an AI decision without a human in the loop?',
        },
        {
          letter: 'A',
          name: 'Adoption Culture',
          description: 'Employees who trust and use AI tools, and leaders who model that behaviour.',
          executive_question: 'Do I personally use at least one AI tool in my daily workflow?',
        },
      ],
      when_to_use: 'Before approving any AI investment over $500K. Run this assessment first — it takes two hours and saves months of wasted effort.',
      when_not_to_use: 'Don\'t use this as a reason to delay. A score of 60% readiness is high enough to run a well-scoped pilot.',
      so_what: 'As a CEO, your most leveraged action is the last question: "Do I personally use AI?" Your behaviour sets the adoption ceiling for your entire organisation.',
    },
    ProsCons: {
      title: `Should We Invest in ${subtopicTitle}?`,
      context: 'A balanced view for executive decision-making — what you gain, what you risk, and what you can mitigate.',
      topic: subtopicTitle,
      pros: [
        {
          title: 'Measurable productivity gains',
          description: 'Organisations that have deployed this report 20-35% reduction in manual processing time within the first year.',
          evidence: 'Deloitte AI Survey 2024: 67% of early adopters hit ROI within 18 months.',
        },
        {
          title: 'Competitive differentiation',
          description: 'Early movers build proprietary data advantages that compound over time. The longer you wait, the harder this gap becomes to close.',
        },
        {
          title: 'Employee satisfaction uplift',
          description: 'When AI handles repetitive tasks, staff focus on higher-value work — reducing attrition in high-cost roles.',
        },
      ],
      cons: [
        {
          title: 'Integration complexity',
          description: 'Legacy systems often require significant re-architecture before AI can be embedded. Budget 30% more than the vendor quotes.',
          mitigation: 'Conduct a technical readiness audit before signing any contract.',
        },
        {
          title: 'Change management burden',
          description: 'The technology is rarely the hard part. Getting people to change behaviour is. This is often underestimated by a factor of 3.',
          mitigation: 'Appoint a dedicated change lead — not IT, not HR — someone with business credibility.',
        },
        {
          title: 'Regulatory uncertainty',
          description: 'AI regulation is evolving rapidly. What\'s compliant today may require rework in 18 months.',
          mitigation: 'Build with configurability in mind. Avoid any vendor that can\'t explain their compliance roadmap.',
        },
      ],
      verdict: 'The investment case is strong, but only if you\'re prepared to treat change management as a first-class workstream, not an afterthought.',
      so_what: 'As a CEO, the question isn\'t "should we do this?" — it\'s "are we willing to lead the change it requires?" Technology without behavioural change returns nothing.',
    },
    CaseStudy: {
      company: 'Maersk',
      industry: 'Logistics & Shipping',
      company_size: '100,000+ employees, $80B revenue',
      challenge: 'Manual freight documentation processing was taking 3-5 days per shipment, creating bottlenecks at major ports and costing millions in demurrage fees.',
      ai_solution: 'Deployed a document intelligence system using large language models to extract, validate, and route freight documents automatically. Integrated with existing customs APIs to enable same-day clearance.',
      results: [
        { metric: 'Processing time', value: '3 days → 4 hours', timeframe: 'By Q2 2024' },
        { metric: 'Demurrage cost reduction', value: '42%', timeframe: 'Year 1' },
        { metric: 'Staff redeployed to higher-value roles', value: '1,200 FTEs', timeframe: 'Within 18 months' },
      ],
      key_lesson: 'The AI was ready in 6 months. The integration with legacy port authority systems took another 14 months. Always budget integration time separately from model development time.',
      what_they_got_right: 'They started with the highest-cost, highest-frequency document type (Bills of Lading) rather than trying to solve everything at once. One use case, done right, funded the rest.',
      what_they_got_wrong: 'Initial rollout skipped change management for port operations staff. Resistance caused a 4-month delay and required a dedicated re-training programme.',
      so_what_for_you: 'As a CEO in logistics or operations, your equivalent of their "Bill of Lading" is whatever document or process creates the most costly delay. Start there — and budget for the integration, not just the model.',
    },
    StatCallout: {
      headline_stat: '73',
      unit: '% of AI projects never reach production',
      context: 'Despite record AI investment, most initiatives stall between proof-of-concept and live deployment. Gartner estimates only 27% of enterprise AI projects deliver measurable business value.',
      source: 'Gartner AI Survey 2025',
      why_it_matters: 'This isn\'t a technology problem — it\'s a governance and prioritisation problem. The companies that beat this statistic share one trait: executive sponsorship that stays active past the POC stage.',
      supporting_stats: [
        { stat: '$500B+', label: 'Enterprise AI spend in 2025' },
        { stat: '18 months', label: 'Average POC-to-production gap' },
        { stat: '3x', label: 'Cost overrun on first AI deployment' },
      ],
      so_what: 'As a CEO, your job is to be the forcing function that moves AI from experiment to production. Ask your team: "What\'s blocking us from going live?" — then remove that blocker.',
    },
    Timeline: {
      title: 'The AI Revolution: A Leadership Timeline',
      context: 'Understanding where we came from helps you calibrate where we\'re going — and what bets to make now.',
      events: [
        { year: '2012', title: 'Deep Learning Breakthrough', description: 'AlexNet wins ImageNet by a massive margin. The AI research community shifts entirely to neural networks.', significance: 'medium', color: '#475569' },
        { year: '2017', title: 'Transformer Architecture', description: 'Google publishes "Attention Is All You Need." This paper is the direct ancestor of every LLM in use today.', significance: 'high', color: '#7C3AED' },
        { year: '2020', title: 'GPT-3 Launch', description: 'OpenAI demonstrates that scale produces emergent capabilities. The enterprise AI market accelerates.', significance: 'high', color: '#7C3AED' },
        { year: '2022', title: 'ChatGPT Reaches 100M Users', description: 'Fastest consumer product adoption in history. Boards begin demanding AI strategies.', significance: 'high', color: '#06B6D4' },
        { year: '2024', title: 'Agentic AI Goes Mainstream', description: 'AI systems that take actions — book meetings, write code, execute workflows — move from labs to enterprise.', significance: 'high', color: '#10B981' },
        { year: '2025', title: 'Enterprise AI Becomes Table Stakes', description: 'Competitors who haven\'t deployed AI are measurably losing productivity and talent battles.', significance: 'high', color: '#F59E0B' },
      ],
      where_we_are_now: 'We are at the point where AI capability has outpaced most organisations\' ability to absorb and deploy it. The bottleneck is leadership, not technology.',
      so_what: 'As a CEO, you are not early — but you are not too late. The next 24 months will determine which companies build durable AI advantages. The window is open, not closed.',
    },
    ConceptMap: {
      title: 'The AI Technology Landscape',
      central_concept: 'Large Language Models',
      nodes: [
        { id: 'llm', label: 'Large Language Models', description: 'Foundation models trained on vast text data', category: 'core', color: '#7C3AED' },
        { id: 'rag', label: 'RAG', description: 'Retrieval-Augmented Generation — connects LLMs to your private data', category: 'architecture', color: '#06B6D4' },
        { id: 'agents', label: 'AI Agents', description: 'LLMs that take actions autonomously', category: 'application', color: '#10B981' },
        { id: 'fine_tuning', label: 'Fine-Tuning', description: 'Adapting a model to your specific domain', category: 'technique', color: '#F59E0B' },
        { id: 'embeddings', label: 'Embeddings', description: 'How AI represents meaning as numbers', category: 'technique', color: '#475569' },
        { id: 'vector_db', label: 'Vector Database', description: 'Storage optimised for AI search', category: 'infrastructure', color: '#475569' },
      ],
      edges: [
        { from: 'llm', to: 'rag', relationship: 'enhanced by' },
        { from: 'llm', to: 'agents', relationship: 'powers' },
        { from: 'llm', to: 'fine_tuning', relationship: 'customised via' },
        { from: 'rag', to: 'embeddings', relationship: 'requires' },
        { from: 'embeddings', to: 'vector_db', relationship: 'stored in' },
        { from: 'vector_db', to: 'rag', relationship: 'feeds' },
      ],
      so_what: 'As a CEO, you don\'t need to understand every node — but you should be able to ask "do we have a RAG strategy?" and "are our agents governed?" Those two questions will reveal your team\'s AI maturity.',
    },
    QuoteCallout: {
      quote: 'The companies that will win with AI are not the ones with the best models. They\'re the ones with the best processes for deciding which problems to solve with AI.',
      attribution: 'Andrew Ng, AI pioneer and founder of DeepLearning.AI',
      context: 'Said at the World Economic Forum 2024, responding to a question about why most enterprise AI investments underperform.',
      so_what: 'As a CEO, this is a leadership statement, not a technology statement. The bottleneck is your decision-making process, not your compute budget.',
    },
    KeyTakeaway: {
      topic: subtopicTitle,
      insights: [
        {
          insight: 'AI capability is no longer the constraint — organisational readiness is.',
          implication: 'Your competitive advantage comes from your ability to absorb and deploy AI, not from having access to the best model.',
        },
        {
          insight: 'The executives who learn AI fundamentals outperform those who delegate it entirely.',
          implication: 'You don\'t need to code. You need to ask better questions, evaluate vendors more accurately, and set more ambitious targets.',
        },
        {
          insight: 'Every AI project that fails in your organisation makes the next one harder.',
          implication: 'Sequencing matters. Start with projects that are very likely to succeed visibly — then use that momentum to fund the harder bets.',
        },
      ],
      one_thing_to_remember: 'The question is never "should we use AI?" It\'s always "what should we use AI for first?"',
      action_for_you: 'This week: ask your CTO or CDO for a one-page map of every active AI initiative, its expected outcome, and who owns it. If they can\'t produce it in 48 hours, that\'s your first problem to solve.',
      next_topic_preview: 'Next: How to evaluate AI vendors without a technical background.',
    },
    QuestionAnswer: {
      question: subtopicTitle,
      direct_answer: 'The short answer: it depends on your data, your use case, and how much control you need. But for most executives, the decision comes down to two variables — how fast you need results and how sensitive your data is.',
      analogy: 'Think of it like choosing between hiring a specialised contractor versus building an in-house team. The contractor is faster and cheaper to start, but over time the in-house team learns your specific context and becomes more valuable.',
      example: 'A regional bank wanting to automate loan document review should buy a proven platform — speed and compliance matter more than customisation. A hedge fund building proprietary signal detection should build in-house — competitive edge requires control.',
      important_nuance: 'The build vs. buy decision isn\'t permanent. Many organisations start with a vendor platform to move fast, then gradually build proprietary components on top as they understand the problem better.',
      so_what: 'As a CEO, your job in this decision is to set the strategic intent — "we need differentiation" or "we need speed" — and let your team translate that into a technical path. Don\'t let the technical team make the strategic call.',
      returning_to: 'AI Strategy Fundamentals',
    },
    ActionPlan: {
      session_topic: subtopicTitle,
      key_takeaways: [
        { takeaway: 'AI projects fail at the governance layer, not the technology layer.', why_it_matters: 'Without clear ownership and accountability, even good AI becomes a liability.' },
        { takeaway: 'Your role is to set strategic intent and remove blockers — not to pick models.', why_it_matters: 'Executive decisions about priority and resource allocation determine AI outcomes more than technical choices.' },
        { takeaway: 'Visible early wins fund bigger bets.', why_it_matters: 'The internal politics of AI adoption require proof points. Sequence your portfolio accordingly.' },
      ],
      immediate_actions: [
        { action: 'Map every active AI initiative to a named owner and expected ROI', timeline: 'This week', difficulty: 'easy' },
        { action: 'Ask your CTO to present the AI roadmap at the next board meeting', timeline: 'Next board cycle', difficulty: 'medium' },
        { action: 'Identify one AI quick win to champion publicly this quarter', timeline: 'This quarter', difficulty: 'easy' },
        { action: 'Commission an AI readiness assessment across your top 3 business units', timeline: '60 days', difficulty: 'medium' },
      ],
      questions_to_ask_your_team: [
        'What\'s our single biggest AI bottleneck right now — data, talent, or leadership support?',
        'Which AI projects are in flight that I haven\'t reviewed in the last 90 days?',
        'If we could only do one AI project in the next 6 months, what should it be and why?',
        'What would it take to go from our current AI maturity to the next level?',
      ],
      watch_out_for: [
        'Teams that report on AI activity (models tested, tools evaluated) rather than AI outcomes (revenue impact, cost reduction).',
        'Vendors who promise "plug and play" AI — integration always takes longer than the demo suggests.',
        'AI initiatives that don\'t have a named business owner (only a technical owner).',
      ],
      next_session_preview: 'In the next session: How to evaluate AI vendors — a framework for non-technical executives.',
    },
    Funnel: {
      title: `AI Project Evaluation Funnel`,
      context: 'A structured filter for deciding which AI opportunities deserve your organisation\'s investment and attention.',
      stages: [
        {
          name: 'Strategic Fit',
          description: 'Does this AI use case align with a top-3 business priority?',
          what_gets_filtered_out: 'Interesting technology looking for a problem. Cool demos with no clear business case.',
          decision_criteria: 'Can you draw a direct line from this AI project to a KPI that matters to the board?',
        },
        {
          name: 'Data Readiness',
          description: 'Do we have the data required, and is it governed well enough to use?',
          what_gets_filtered_out: 'Projects that require data we don\'t have, can\'t access, or can\'t trust.',
          decision_criteria: 'Can we get clean, labelled data for this use case in under 6 months without a new data programme?',
        },
        {
          name: 'Build vs. Buy Clarity',
          description: 'Have we made a deliberate decision about whether to build, buy, or partner?',
          what_gets_filtered_out: 'Projects where the build/buy decision is driven by vendor pressure or internal politics rather than strategic logic.',
          decision_criteria: 'Does our chosen approach optimise for the right thing — speed, control, cost, or differentiation?',
        },
        {
          name: 'Governance Ready',
          description: 'Is there a named owner, a risk framework, and a success metric defined?',
          what_gets_filtered_out: 'AI initiatives with only technical ownership. Anything without a defined success metric.',
          decision_criteria: 'Can a non-technical executive explain what this AI does, who owns it, and how we\'ll know if it\'s working?',
        },
      ],
      what_makes_it_through: 'AI projects with a direct board-level KPI owner, clean accessible data, a deliberate build/buy decision, and a named business accountable.',
      so_what: 'As a CEO, run every proposed AI initiative through this funnel before approving budget. Most will fail at Stage 1 or 2 — and that\'s the point. Filter fast, fund deeply.',
    },
    Flowchart: {
      title: `${subtopicTitle} — Decision Flow`,
      context: 'A decision framework for evaluating AI opportunities at the executive level.',
      nodes: [
        { id: 'start', type: 'start' as const, label: 'New AI Opportunity', detail: undefined },
        { id: 'd1', type: 'decision' as const, label: 'Strategic fit?', detail: 'Does it map to a top-3 priority?' },
        { id: 'a1', type: 'action' as const, label: 'Reject or Park', detail: 'Add to a future consideration list.' },
        { id: 'd2', type: 'decision' as const, label: 'Data ready?', detail: 'Clean, accessible, governed?' },
        { id: 'a2', type: 'action' as const, label: 'Launch Data Programme', detail: 'Fix the data first. AI comes second.' },
        { id: 'd3', type: 'decision' as const, label: 'Build vs buy decided?', detail: 'Deliberate, not defaulted.' },
        { id: 'a3', type: 'action' as const, label: 'Approve & Fund', detail: 'Assign owner, set KPI, start sprint.' },
        { id: 'end', type: 'end' as const, label: 'Launch', detail: undefined },
      ],
      edges: [
        { from: 'start', to: 'd1', label: undefined },
        { from: 'd1', to: 'a1', label: 'No' },
        { from: 'd1', to: 'd2', label: 'Yes' },
        { from: 'd2', to: 'a2', label: 'No' },
        { from: 'd2', to: 'd3', label: 'Yes' },
        { from: 'd3', to: 'a3', label: 'Yes' },
        { from: 'a3', to: 'end', label: undefined },
      ],
      so_what: 'Most AI opportunities fail at the first decision gate. Use this flow to filter fast — every rejected idea saves 6 months of wasted effort.',
    },
    ChevronProcess: {
      title: `${subtopicTitle} — Process Flow`,
      context: 'A stage-by-stage view of how this plays out in practice.',
      stages: [
        {
          name: 'Define the Goal',
          description: 'Articulate the business outcome this initiative must deliver, in one sentence.',
          key_action: 'Write the success metric before touching a vendor or tool.',
        },
        {
          name: 'Assess Readiness',
          description: 'Audit your data, talent, and systems for gaps that would block progress.',
          key_action: 'Commission a two-week readiness report from your CTO.',
        },
        {
          name: 'Run a Pilot',
          description: 'Test on a real use case with limited scope. Validate value before scale.',
          key_action: 'Define pass/fail criteria before the pilot starts — not after.',
        },
        {
          name: 'Scale & Govern',
          description: 'Expand with a named owner, risk framework, and review cycle in place.',
          key_action: 'Assign an executive sponsor who is accountable for business outcomes.',
        },
      ],
      outcome: 'A live, governed capability with measurable ROI and clear ownership.',
      so_what: 'As a CEO, your leverage point is Stage 1. If the goal is vague, everything downstream will drift.',
    },
    NarrativeCard: {
      company: 'DHL',
      industry: 'Logistics',
      challenge: 'Manual customs documentation was causing 2-day delays per shipment, costing millions in demurrage fees annually.',
      approach: 'Deployed an AI document intelligence layer to extract, validate, and route freight paperwork automatically across 40 countries.',
      impact: 'Shipment clearance dropped from 48 hours to under 6 hours in the first six months of rollout.',
      metrics: [
        { value: '87%', label: 'faster clearance time' },
        { value: '$34M', label: 'annual savings' },
        { value: '1,400', label: 'staff redeployed' },
      ],
      lesson: 'Start with the highest-frequency, highest-cost document type — not the most technically interesting one.',
      so_what: 'As a CEO, find your equivalent of their customs form. One high-volume pain point, solved well, funds everything else.',
    },
    DefinitionTriptych: {
      term: subtopicTitle,
      category: 'AI Fundamentals',
      what_it_is: 'A system that uses patterns from training data to generate outputs — text, decisions, or predictions — without being explicitly programmed for each case. It learns by example, not by rule.',
      real_example: {
        company: 'American Express',
        what: 'Uses ML models to approve or decline transactions in under 2 milliseconds, analysing 115 variables per transaction.',
        result: 'Reduced false fraud declines by 60%, saving $1.2B in lost revenue annually.',
      },
      common_myth: 'People think AI "thinks" like a human. Actually it finds statistical patterns — impressive at scale, brittle outside its training distribution.',
      so_what: 'As a CEO, the key question is not "can AI do this?" but "what data do we have to train it, and how often will it face cases outside that data?"',
    },
    HorizontalDecision: {
      title: `${subtopicTitle} — Decision Flow`,
      context: 'How to navigate this decision as an executive.',
      nodes: [
        {
          id: 'start',
          label: 'AI Opportunity Arrives',
          detail: null,
          type: 'start' as const,
          branch_label: null,
          branch_outcome: null,
        },
        {
          id: 'd1',
          label: 'Strategic fit?',
          detail: 'Maps to a top-3 priority?',
          type: 'decision' as const,
          branch_label: 'If No',
          branch_outcome: 'Park or reject. Add to future consideration list.',
        },
        {
          id: 'a1',
          label: 'Fund the pilot',
          detail: 'Assign owner + define success metric.',
          type: 'action' as const,
          branch_label: null,
          branch_outcome: null,
        },
        {
          id: 'end',
          label: 'Launch & govern',
          detail: null,
          type: 'end' as const,
          branch_label: null,
          branch_outcome: null,
        },
      ],
      so_what: 'As a CEO, most AI opportunities fail at the first gate. Use this flow to filter fast — rejected ideas save 6 months of wasted effort.',
    },
    AnswerSpotlight: {
      question: subtopicTitle,
      direct_answer: 'The honest answer is: it depends on how sensitive your data is and how fast you need results. For most organisations, the safest starting point is a proven vendor platform — then build proprietary layers on top as you learn the problem.',
      analogy: 'Think of it like a kitchen. You can rent a commercial kitchen (vendor platform) to start, then build your own once you know exactly what you cook.',
      example: 'A regional insurer used Salesforce Einstein to automate claim routing in 90 days. A hedge fund built its own signal detection engine because it could not share trading data with any vendor.',
      important_nuance: 'The build vs. buy decision is not permanent. Most organisations start vendor, then build proprietary components over 18-24 months as they accumulate domain data.',
      so_what: 'As a CEO, your job is to set the strategic intent — "we need speed" or "we need differentiation" — and let your team translate that into a build/buy path.',
    },
    Hierarchy: {
      title: `${subtopicTitle} — Structure Breakdown`,
      context: 'Understanding the layered structure of modern AI systems.',
      root: {
        label: 'AI System',
        detail: 'Enterprise-grade AI stack',
        children: [
          {
            label: 'Data Layer',
            detail: 'Raw inputs & pipelines',
            children: [
              { label: 'Structured Data', detail: 'Databases, CRM, ERP' },
              { label: 'Unstructured Data', detail: 'Docs, emails, audio' },
            ],
          },
          {
            label: 'Model Layer',
            detail: 'Intelligence & reasoning',
            children: [
              { label: 'Foundation Model', detail: 'GPT, Claude, Gemini' },
              { label: 'Fine-tuned Model', detail: 'Domain-specific tuning' },
            ],
          },
          {
            label: 'Application Layer',
            detail: 'User-facing tools',
            children: [
              { label: 'Internal Tools', detail: 'Copilots, assistants' },
              { label: 'Customer-facing', detail: 'Chatbots, recommendations' },
            ],
          },
          {
            label: 'Governance Layer',
            detail: 'Control & accountability',
            children: [
              { label: 'Risk & Compliance', detail: 'Audit trails, bias checks' },
              { label: 'Performance Monitoring', detail: 'Drift detection, KPIs' },
            ],
          },
        ],
      },
      so_what: 'As a CEO, you own the governance layer even if you don\'t touch the model layer. Most AI failures happen because leadership disengages after the model is deployed.',
    },
  }

  return mockMap[type]
}

// ─── ROLE DEPTH CLASSIFIER ────────────────────────────────────────────────────

const EXECUTIVE_ROLES = new Set(['ceo', 'coo', 'cfo', 'director', 'chro', 'cmo', 'cpo'])
const TECHNICAL_ROLES = new Set(['developer', 'data-scientist', 'data-analyst', 'cto'])

/**
 * Returns a depth instruction that tells Claude how much technical detail
 * vs strategic context to provide, based on the learner's role tier.
 *
 * Executive tier:  buy/decide/govern — business outcomes, TCO, vendor risk
 * Technical tier:  build/use/evaluate — features, APIs, benchmarks, trade-offs
 * Functional tier: manage/specify/advocate — balanced, workflow-impact focused
 */
function getRoleDepthInstruction(role: string): string {
  const r = role.toLowerCase().replace(/\s+/g, '-')

  if (EXECUTIVE_ROLES.has(r)) {
    return `This learner is a senior executive (${role}) who makes decisions, not implementations.
- For tool/platform comparisons: skip installation, configuration, and API details entirely. Focus on strategic fit, total cost of ownership, vendor stability, procurement complexity, and the 1–2 questions they need answered to make a buy/build/partner call. Frame criteria in business language (e.g. "scales to enterprise contracts" not "supports horizontal pod autoscaling").
- For all content: lead with business outcomes and competitive implications. Explain what they need to tell their board or their team, not how the technology works internally.
- Technical terms are allowed only when necessary — always follow them with a one-clause plain-English translation.`
  }

  if (TECHNICAL_ROLES.has(r)) {
    return `This learner is a technical practitioner (${role}) who evaluates, builds, or operates these tools directly.
- For tool/platform comparisons: include technical feature depth — API quality, integration patterns, performance characteristics, scalability limits, licensing model, and real implementation trade-offs. Name specific capabilities that differentiate tools at the feature level.
- For all content: be precise and concrete. Avoid vague business language where specific technical terms are clearer. Include "gotchas" and edge cases a practitioner would encounter.`
  }

  // Functional tier: PM, Designer, Marketing, HR — balanced
  return `This learner is a functional leader (${role}) who bridges business strategy and technical implementation.
- For tool/platform comparisons: balance business value with functional capabilities. Explain technical trade-offs in terms of their impact on team workflows and outcomes, without deep implementation detail. Include procurement considerations and integration effort.
- For all content: connect the subject to this role's day-to-day decisions. Be specific enough to have an informed conversation with both executives and technical teams.`
}

// ─── MAIN GENERATOR ───────────────────────────────────────────────────────────

/**
 * Generates structured template data using Claude or falls back to mock data.
 *
 * @param templateType   - The template variant to generate data for
 * @param subtopicTitle  - The subtopic title (used in prompts)
 * @param sessionTitle   - The session title for context
 * @param userContext    - User role, industry, and AI maturity level
 * @param adjacentTopics - Optional previous/next topic titles for continuity
 * @param contentSpec    - Step 1 visual_spec: constrains visual items to match the coaching script
 * @returns Typed data object matching the template's data interface
 */
export async function generateTemplateData(
  templateType: TemplateName,
  subtopicTitle: string,
  sessionTitle: string,
  userContext: UserContext,
  adjacentTopics?: AdjacentTopics,
  contentSpec?: { headline: string; items: string[]; so_what: string; summary: string }
): Promise<TemplateSection['data']> {
  if (isPlaceholder || !anthropic) {
    console.log('[MOCK TEMPLATE-GENERATOR]', templateType, subtopicTitle)
    return getMockData(templateType, subtopicTitle)
  }

  const schema = getSchemaForTemplate(templateType)

  const adjacentContext = adjacentTopics
    ? `\nPrevious topic: ${adjacentTopics.previous ?? 'none'}\nNext topic: ${adjacentTopics.next ?? 'none'}`
    : ''

  // Inject approved QA rules — they evolve as the QA agent reviews sections
  const approvedRules = await getApprovedRules()
  const rulesBlock = approvedRules.length > 0
    ? `\n\nQUALITY RULES (approved by the content team — follow strictly):\n${approvedRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : ''

  const domainLabel = userContext.domain ?? 'the subject'
  const proficiencyLabel = userContext.proficiency ?? userContext.maturity ?? 'intermediate'

  // Role-tier depth instruction — determines how technical vs strategic the content is
  const roleDepthInstruction = getRoleDepthInstruction(userContext.role)

  const systemPrompt = `You are a world-class educator and subject matter expert in ${domainLabel}.
You are creating content for a ${userContext.role} at ${proficiencyLabel} level.
Your output will be displayed as a full-screen visual section in a premium learning platform.

AUDIENCE DEPTH:
${roleDepthInstruction}

Rules:
1. Return ONLY valid JSON matching the schema below. No markdown, no explanation.
2. Every "so_what" or "so_what_for_you" field MUST be personalised to: Role="${userContext.role}", Domain="${domainLabel}". Start with "As a ${userContext.role},"
3. All content must be immediately actionable or illuminating for someone at ${proficiencyLabel} level. No jargon beyond what a ${proficiencyLabel}-level learner would know.
4. Use real companies, tools, and statistics where possible. If unsure of exact figures, use ranges.
5. Write like a trusted senior colleague, not a textbook or a vendor pitch.

LAYOUT CONSTRAINTS — CRITICAL: Content renders inside ReactFlow nodes with fixed pixel heights. Overflow causes visual clipping and overlapping. Strictly respect these word counts:

GLOBAL (all templates):
- "so_what" / "so_what_for_you": max 30 words, must start with "As a [role],"
- "title" fields (section headline): max 8 words
- "context" / subtitle fields: max 15 words

PER TEMPLATE:
ConceptDefinition — "plain_english": max 14 words | "one_line": max 10 words | "what_they_did": max 12 words | "result": max 8 words | "common_misconception": max 12 words
StepFlow — each step "title": max 5 words | "description": max 15 words | "what_to_watch_for": max 12 words | max 4 steps | "outcome": max 15 words
ComparisonTable — option "name": max 3 words | "tagline": max 8 words | "best_for": max 8 words | criterion "label": max 4 words | cell "value": max 6 words | max 3 options, 4 criteria | "verdict": max 25 words
ProsCons — pro/con "title": max 5 words | "description": max 15 words | "evidence"/"mitigation": max 12 words | max 3 pros, 3 cons | "verdict": max 20 words
KeyTakeaway — "insight": max 8 words | "implication": max 18 words | max 3 insights | "one_thing_to_remember": max 15 words | "action_for_you": max 20 words
FrameworkCard — "framework_name": max 5 words | "purpose": max 5 words | component "description": max 8 words | "executive_question": max 12 words | "when_to_use"/"when_not_to_use": max 20 words | max 4 components
TopicHero — "topic_name": max 5 words | "key_question": max 12 words | each "key_takeaways" item: max 12 words | "so_what_preview": max 15 words | "why_now": max 15 words or null
CaseStudy — "challenge": max 12 words | "ai_solution": max 12 words | "what_they_got_right": max 10 words | "what_they_got_wrong": max 8 words | result "metric": max 4 words | "value": max 5 words
StatCallout — "headline_stat": 1-3 characters (number only) | "unit": max 8 words | "context": max 15 words | "why_it_matters": max 30 words | supporting stat "label": max 5 words | max 3 supporting stats
Timeline — event "title": max 6 words | "description": max 20 words | max 6 events | "where_we_are_now": max 25 words
QuoteCallout — "quote": max 40 words | "context": max 20 words
QuestionAnswer — "direct_answer": max 30 words | "analogy": max 25 words | "example": max 25 words | "important_nuance": max 20 words
ActionPlan — takeaway "takeaway": max 8 words | "why_it_matters": max 15 words | max 3 takeaways | action "action": max 10 words | max 4 actions | question: max 10 words | max 4 questions | watch_out: max 15 words | max 3 watch_outs
Funnel — stage "name": max 4 words | "description": max 8 words | "what_gets_filtered_out": max 7 words | "decision_criteria": max 7 words | max 4 stages
Flowchart — start/end "label": max 4 words | decision "label": max 3 words (diamond shape, visible area is ~50% of node) | action "label": max 4 words | action "detail": max 5 words | set decision "detail" to null | max 8 nodes
Hierarchy — any "label": max 5 words | any "detail": max 5 words
TwoByTwoMatrix — quadrant "name": max 3 words | "description": max 20 words | "examples": max 2 items each max 5 words
ConceptMap — "central_concept": max 4 words | node "label": max 5 words | node "description": max 10 words
ChevronProcess — stage "name": max 3 words | "description": max 15 words | "key_action": max 10 words | max 4 stages | "outcome": max 15 words
NarrativeCard — "challenge"/"approach"/"impact": max 20 words each | metric "value": max 5 chars | metric "label": max 4 words | max 3 metrics | "lesson": max 15 words
DefinitionTriptych — "what_it_is": max 30 words | "real_example.what": max 20 words | "real_example.result": max 12 words | "common_myth": max 20 words
HorizontalDecision — node "label": max 6 words | node "detail": max 8 words or null | "branch_outcome": max 10 words or null | max 4 nodes
AnswerSpotlight — "direct_answer": max 35 words | "analogy": max 25 words or null | "example": max 25 words or null | "important_nuance": max 20 words or null${rulesBlock}

Template: ${templateType}
Required JSON schema (data fields only):
${schema}`

  // When contentSpec is provided, constrain the visual to match the coaching script exactly.
  // This is the key alignment mechanism: Step 1 defines items → Step 2 renders them → Step 3 names them.
  const contentSpecBlock = contentSpec && contentSpec.items.length > 0
    ? `\n\nCONTENT SPECIFICATION — USE THESE EXACT ITEMS (the voice coach will name them on screen)
Headline: "${contentSpec.headline}"
Items to display (use as your steps/components/quadrants/pros/cons — do not substitute):
${contentSpec.items.map((it, i) => `  ${i + 1}. ${it}`).join('\n')}
So what (use verbatim or very close): "${contentSpec.so_what}"
Summary: "${contentSpec.summary}"

CRITICAL: The items above are EXACTLY what Clio will say while the executive looks at this visual.
Map them faithfully into the template structure — do not invent alternative items.`
    : ''

  const userPrompt = `Session: "${sessionTitle}"
Subtopic: "${subtopicTitle}"
Learner Role: ${userContext.role}
Domain: ${domainLabel}
Proficiency: ${proficiencyLabel}
Industry: ${userContext.industry}${adjacentContext}${contentSpecBlock}

Generate the template data JSON for this subtopic.`

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned) as TemplateSection['data']
  } catch (err) {
    console.error('[TEMPLATE-GENERATOR] Failed, falling back to mock:', templateType, err)
    return getMockData(templateType, subtopicTitle)
  }
}

/**
 * Regenerates a TemplateSection incorporating user feedback.
 * Sends the existing section JSON + feedback to Claude and returns an updated section.
 * @param section - The current rendered section
 * @param feedback - Free-text feedback from the user describing desired changes
 */
// ─── OVERFLOW NODE TYPE ───────────────────────────────────────────────────────

export interface OverflowNode {
  nodeId: string
  nodeType: string
  overflowPx: number
}

// ─── FIX OVERFLOWED SECTION ───────────────────────────────────────────────────

/**
 * Analyses a DOM overflow report and asks Claude to produce a version that fits
 * within the canvas. Claude may shorten text, reduce item counts, or switch to a
 * more compact template type — whichever preserves the most educational impact.
 *
 * Returns the fixed TemplateSection (potentially a different template type) plus
 * metadata about the chosen strategy.
 */
export async function fixOverflowedSection(
  section: TemplateSection,
  overflowReport: OverflowNode[]
): Promise<{ fixedSection: TemplateSection; strategy: string; reason: string }> {
  if (isPlaceholder || !anthropic) {
    console.log('[TEMPLATE-GENERATOR] Mock fixOverflowedSection — returning section unchanged')
    return { fixedSection: section, strategy: 'no-op', reason: 'API key placeholder' }
  }

  const totalOverflow = overflowReport.reduce((s, n) => s + n.overflowPx, 0)
  const overflowLines = overflowReport
    .map((n) => `  - node "${n.nodeId}" (${n.nodeType}): +${n.overflowPx}px vertical overflow`)
    .join('\n')

  const currentSchema = getSchemaForTemplate(section.type as TemplateName)

  // Compact alternatives to offer Claude when a template switch makes sense
  const COMPACT_ALTERNATIVES: TemplateName[] = [
    'TwoByTwoMatrix', 'ProsCons', 'StatCallout', 'QuoteCallout',
    'KeyTakeaway', 'QuestionAnswer', 'ConceptDefinition',
  ]
  const alternatives = COMPACT_ALTERNATIVES.filter((t) => t !== section.type)
  const altSchemas = alternatives
    .map((t) => `### ${t}\n${getSchemaForTemplate(t)}`)
    .join('\n\n')

  const systemPrompt = `You are a visual content optimizer for an AI coaching platform. Content renders as interactive diagrams (ReactFlow) on a fixed landscape canvas — approximately 1400px wide × 700px tall.

Each diagram node has a FIXED declared height. Content that overflows a node's height is clipped and not visible. You must ensure ALL content fits within node bounds.

Your job: receive a template section with overflow problems and return a fixed version that fits — without compromising the educational impact or clarity of the content.

## Fix strategies (apply in this order of preference)

1. **SHORTEN_TEXT** — Keep same template type. Reduce word counts in overflowing nodes:
   - Trim descriptions to their essential insight only
   - Cut redundant phrases, examples, or clauses
   - Prefer active, direct language over elaborate explanations
   - This is the preferred strategy when overflow is ≤30px per node

2. **REDUCE_ITEMS** — Keep same template type. Remove the least critical items:
   - Reduce steps from 5→4, components from 5→4, insights from 4→3, etc.
   - Keep items that carry the most decision-relevant insight for executives
   - Use this when the node count itself is the source of the overflow

3. **SWITCH_TEMPLATE** — Change to a more compact template that conveys the same lesson:
   - Use this when the current template is fundamentally too tall for the content volume
   - Choose a template from the compact alternatives below
   - Rewrite content to fit the new template's schema
   - Preserve the core educational goal: what should the executive understand?

## Current section
Template: ${section.type}
Educational goal: "${section.meta?.subtopicTitle ?? 'unknown'}"
Schema: ${currentSchema}

Current data:
${JSON.stringify(section.data, null, 2)}

## Overflow report (${overflowReport.length} nodes, ${totalOverflow}px total)
${overflowLines}

## Compact template alternatives (use for SWITCH_TEMPLATE)
${altSchemas}

## Word count limits (always apply)
- "so_what"/"so_what_for_you": max 30 words
- "title"/"context"/"subtitle": max 15 words
- Any node description: max 15 words
- Any label: max 6 words
- Max 4 steps/components/items per section

## Response format
Return ONLY valid JSON — no markdown, no explanation:
{
  "strategy": "SHORTEN_TEXT" | "REDUCE_ITEMS" | "SWITCH_TEMPLATE",
  "reason": "one-sentence explanation of what you changed and why",
  "type": "TemplateName",
  "data": { ...template data matching the schema for the chosen type... }
}`

  const userPrompt = `Fix the overflow and return the corrected section JSON.`

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned) as {
      strategy: string
      reason: string
      type: TemplateName
      data: TemplateSection['data']
    }

    const fixedSection = {
      ...section,
      type: parsed.type,
      data: parsed.data,
    } as TemplateSection

    return { fixedSection, strategy: parsed.strategy, reason: parsed.reason }
  } catch (err) {
    console.error('[TEMPLATE-GENERATOR] fixOverflowedSection failed:', err)
    throw new Error('Failed to fix overflow.')
  }
}

export async function regenerateWithFeedback(
  section: TemplateSection,
  feedback: string
): Promise<TemplateSection> {
  if (isPlaceholder || !anthropic) {
    console.log('[TEMPLATE-GENERATOR] Mock regenerateWithFeedback — returning section unchanged')
    return section
  }

  const systemPrompt = `You are a visual content editor for an AI coaching platform. You receive structured JSON that powers an infographic/slide, along with user feedback requesting changes. Your job is to apply the feedback and return ONLY the updated JSON — same structure, same field names, improved content.

Rules:
- Return ONLY valid JSON, no markdown, no explanation
- Keep the exact same JSON structure and field names
- Apply the feedback thoughtfully — improve content, not just rephrase
- Keep language concise and executive-appropriate
- If feedback asks for structural changes that can't fit the schema, do your best within the existing structure

LAYOUT CONSTRAINTS — content renders in fixed-height ReactFlow nodes. Stay within these limits:
- "so_what"/"so_what_for_you": max 30 words
- "title" fields: max 8 words | "context"/"subtitle": max 15 words
- ConceptDefinition "plain_english": max 14w | "what_they_did": max 12w | "result": max 8w | "common_misconception": max 12w
- StepFlow each step "description": max 15w | "what_to_watch_for": max 12w | max 4 steps
- ComparisonTable cell "value": max 6w | "verdict": max 25w | max 3 options, 4 criteria
- ProsCons "description": max 15w | max 3 pros/cons | "verdict": max 20w
- KeyTakeaway "insight": max 8w | "implication": max 18w | max 3 insights
- FrameworkCard "framework_name": max 5w | "purpose": max 5w | component "description": max 8w | "executive_question": max 12w | max 4 components
- Flowchart decision "label": max 3w | action "label": max 4w | action "detail": max 5w | set decision "detail" to null
- TopicHero "topic_name": max 5w | "key_question": max 12w | each "key_takeaways" item: max 12w | "so_what_preview": max 15w | "why_now": max 15w or null
- CaseStudy "challenge": max 12w | "ai_solution": max 12w | "what_they_got_right": max 10w | "what_they_got_wrong": max 8w
- StatCallout "context": max 15w | "headline_stat": number only 1-3 chars
- ActionPlan takeaway "takeaway": max 8w | question: max 10w
- Funnel "description": max 8w | "what_gets_filtered_out": max 7w | "decision_criteria": max 7w
- TwoByTwoMatrix quadrant "description": max 20w
- ConceptMap "central_concept": max 4w | node "label": max 5w
- Hierarchy any "detail": max 5w
- ChevronProcess stage "name": max 3w | "description": max 15w | "key_action": max 10w | max 4 stages
- NarrativeCard "challenge"/"approach"/"impact": max 20w | max 3 metrics
- DefinitionTriptych "what_it_is": max 30w | "real_example.what": max 20w | "common_myth": max 20w
- HorizontalDecision node "label": max 6w | "detail": max 8w or null | max 4 nodes
- AnswerSpotlight "direct_answer": max 35w | "analogy"/"example"/"important_nuance": max 25w or null`

  const userPrompt = `Current section type: ${section.type}

Current section data:
${JSON.stringify(section.data, null, 2)}

User feedback:
${feedback}

Apply this feedback and return the updated JSON data object only (not the full section wrapper, just the data).`

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const updatedData = JSON.parse(cleaned) as TemplateSection['data']

    return { ...section, data: updatedData } as TemplateSection
  } catch (err) {
    console.error('[TEMPLATE-GENERATOR] regenerateWithFeedback failed:', err)
    throw new Error('Failed to regenerate section with feedback.')
  }
}
