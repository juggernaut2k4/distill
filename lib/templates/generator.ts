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
  "topic_number": number,
  "total_topics": number,
  "key_question": string,          // the single most important question this topic answers
  "estimated_minutes": number,     // 3-8
  "so_what_preview": string        // one-line teaser personalised to role+industry
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
      topic_number: 1,
      total_topics: 5,
      key_question: `What does ${subtopicTitle} actually mean for how you run your business?`,
      estimated_minutes: 5,
      so_what_preview: 'As a CEO, this one concept will change how you evaluate every AI vendor pitch.',
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
  }

  return mockMap[type]
}

// ─── MAIN GENERATOR ───────────────────────────────────────────────────────────

/**
 * Generates structured template data using Claude or falls back to mock data.
 *
 * @param templateType - The template variant to generate data for
 * @param subtopicTitle - The subtopic title (used in prompts)
 * @param sessionTitle - The session title for context
 * @param userContext - User role, industry, and AI maturity level
 * @param adjacentTopics - Optional previous/next topic titles for continuity
 * @returns Typed data object matching the template's data interface
 */
export async function generateTemplateData(
  templateType: TemplateName,
  subtopicTitle: string,
  sessionTitle: string,
  userContext: UserContext,
  adjacentTopics?: AdjacentTopics
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

  const systemPrompt = `You are a world-class executive educator creating content for senior business leaders.
Your output will be displayed as a full-screen visual section in a premium coaching product.

Rules:
1. Return ONLY valid JSON matching the schema below. No markdown, no explanation.
2. Every "so_what" or "so_what_for_you" field MUST be personalised to: Role="${userContext.role}", Industry="${userContext.industry}". Start with "As a ${userContext.role}," or "As a ${userContext.role} in ${userContext.industry},"
3. All content must be immediately actionable or illuminating. No jargon. No fluff.
4. Use real companies and real statistics where possible. If unsure of exact figures, use ranges.
5. Write for someone who reads The Economist, not a technical paper.${rulesBlock}

Template: ${templateType}
Required JSON schema (data fields only):
${schema}`

  const userPrompt = `Session: "${sessionTitle}"
Subtopic: "${subtopicTitle}"
User Role: ${userContext.role}
User Industry: ${userContext.industry}
AI Maturity: ${userContext.maturity}${adjacentContext}

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
- If feedback asks for structural changes that can't fit the schema, do your best within the existing structure`

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
