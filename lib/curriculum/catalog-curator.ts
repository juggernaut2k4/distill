import Anthropic from '@anthropic-ai/sdk'

export interface CuratedTopic {
  title: string
  description: string
  domain_id: string
  is_trending: boolean
  trending_score: number  // 0–1
  popularity_rank: number // 1 = most popular
  tags: string[]
}

export interface CatalogCuration {
  featured: CuratedTopic[]   // top ~15–20 for this role×industry×maturity
  generated_at: string
}

const SYSTEM_PROMPT = `You are an education specialist and curriculum designer for senior business executives.

Given a user's role, industry, and AI maturity level, curate a list of exactly 18 learning topics they should be offered to choose from.

Requirements:
1. Every topic must be genuinely useful and relevant for this specific role in this specific industry
2. Include a mix of: strategic topics, operational topics, risk/governance topics, and at least 2 currently trending AI topics
3. Order topics by: trending/hot topics first, then high-value strategic topics, then operational, then foundational
4. Mark topics as trending if they are currently hot in the market (AI agents, Claude, LLMs, etc.)
5. Each topic must have a clear 1-sentence description that speaks to the role's perspective
6. No generic filler topics — every topic must be immediately recognisable as relevant to someone in this role
7. Assign a domain_id from: ai-ml, leadership, digital-transformation, finance, data-decisions, risk, innovation, operations, people-org, data-engineering, cybersecurity, bi-analytics

Return ONLY valid JSON:
{
  "topics": [
    {
      "title": "Topic title (5–8 words)",
      "description": "One sentence from the perspective of this role",
      "domain_id": "ai-ml",
      "is_trending": true,
      "trending_score": 0.95,
      "popularity_rank": 1,
      "tags": ["keyword1", "keyword2"]
    }
  ]
}`

const isPlaceholder = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER_')

function mockCuration(role: string, industry: string): CuratedTopic[] {
  // Hardcoded mock for CEO × financial-services (the test fixture)
  if (role === 'ceo' && industry === 'financial-services') {
    return [
      { title: 'AI Agents & Autonomous Workflows', description: 'How autonomous AI agents are transforming FS operations and what your board needs to know', domain_id: 'ai-ml', is_trending: true, trending_score: 0.97, popularity_rank: 1, tags: ['ai agents', 'automation', 'autonomous'] },
      { title: 'Claude & LLMs for Financial Services', description: 'How leading FS firms are deploying Claude and other LLMs for research, compliance, and client service', domain_id: 'ai-ml', is_trending: true, trending_score: 0.95, popularity_rank: 2, tags: ['claude', 'llm', 'financial services'] },
      { title: 'AI Governance & FCA Compliance', description: 'What the FCA expects from FS firms deploying AI, and how to build compliant governance frameworks', domain_id: 'risk', is_trending: true, trending_score: 0.90, popularity_rank: 3, tags: ['fca', 'governance', 'compliance', 'regulation'] },
      { title: 'AI Strategy for Financial Services CEOs', description: 'How to build and execute an AI strategy that satisfies your board, regulators, and shareholders', domain_id: 'leadership', is_trending: false, trending_score: 0.85, popularity_rank: 4, tags: ['ai strategy', 'ceo', 'financial services'] },
      { title: 'Generative AI Fundamentals for Executives', description: 'What every FS executive must understand about how generative AI works before making investment decisions', domain_id: 'ai-ml', is_trending: false, trending_score: 0.80, popularity_rank: 5, tags: ['generative ai', 'fundamentals', 'executive'] },
      { title: 'AI Vendor Evaluation: Claude vs GPT vs Gemini', description: 'How to assess and select the right AI models for your FS organisation', domain_id: 'ai-ml', is_trending: true, trending_score: 0.88, popularity_rank: 6, tags: ['vendor evaluation', 'claude', 'gpt', 'gemini'] },
      { title: 'AI in Finance: Forecasting & Risk Modelling', description: 'How AI is transforming financial forecasting, credit risk, and investment decision-making', domain_id: 'finance', is_trending: false, trending_score: 0.75, popularity_rank: 7, tags: ['forecasting', 'risk modelling', 'finance ai'] },
      { title: 'Data Strategy for AI-Ready Organisations', description: 'The data foundations every FS firm needs before AI can deliver value at scale', domain_id: 'data-decisions', is_trending: false, trending_score: 0.72, popularity_rank: 8, tags: ['data strategy', 'data governance', 'ai readiness'] },
      { title: 'AI Security & Model Risk Management', description: 'How to manage model risk, data privacy, and security threats in FS AI deployments', domain_id: 'cybersecurity', is_trending: false, trending_score: 0.70, popularity_rank: 9, tags: ['model risk', 'ai security', 'privacy'] },
      { title: 'Measuring AI ROI for FS Board Presentations', description: 'How to quantify and communicate AI investment returns to your board and investors', domain_id: 'finance', is_trending: false, trending_score: 0.68, popularity_rank: 10, tags: ['roi', 'board', 'ai investment'] },
      { title: 'Building an AI-Ready Organisation', description: 'Culture, skills, and operating model changes needed to scale AI across a FS firm', domain_id: 'leadership', is_trending: false, trending_score: 0.65, popularity_rank: 11, tags: ['change management', 'ai culture', 'upskilling'] },
      { title: 'Digital Transformation in Financial Services', description: 'How AI fits into the broader digital transformation agenda for FS leaders', domain_id: 'digital-transformation', is_trending: false, trending_score: 0.62, popularity_rank: 12, tags: ['digital transformation', 'fintech', 'modernisation'] },
      { title: 'AI for Customer Experience in Banking', description: 'How FS firms are using AI to personalise customer journeys and reduce churn', domain_id: 'operations', is_trending: false, trending_score: 0.60, popularity_rank: 13, tags: ['customer experience', 'banking', 'personalisation'] },
      { title: 'EU AI Act: What FS Executives Must Know', description: 'The EU AI Act obligations that apply to FS firms and what compliance looks like in practice', domain_id: 'risk', is_trending: true, trending_score: 0.85, popularity_rank: 14, tags: ['eu ai act', 'regulation', 'compliance'] },
      { title: 'AI Competitive Intelligence for FS CEOs', description: 'How competitors are using AI and what your firm needs to do to stay ahead', domain_id: 'innovation', is_trending: false, trending_score: 0.58, popularity_rank: 15, tags: ['competitive intelligence', 'ai strategy', 'market'] },
      { title: 'Responsible AI & Ethics in Financial Services', description: 'How to build ethical AI frameworks that satisfy regulators, customers, and your board', domain_id: 'risk', is_trending: false, trending_score: 0.55, popularity_rank: 16, tags: ['responsible ai', 'ethics', 'bias', 'fairness'] },
      { title: 'How Large Language Models Work', description: 'The technical concepts every FS CEO needs to understand to make informed AI decisions', domain_id: 'ai-ml', is_trending: false, trending_score: 0.52, popularity_rank: 17, tags: ['llm', 'fundamentals', 'technical'] },
      { title: 'AI Talent & Skills Strategy for FS Leaders', description: 'How to attract, retain, and upskill AI talent in a competitive FS market', domain_id: 'people-org', is_trending: false, trending_score: 0.50, popularity_rank: 18, tags: ['ai talent', 'skills', 'hr', 'upskilling'] },
    ]
  }

  // Generic fallback mock
  return [
    { title: 'AI Strategy for Executives', description: 'Build and execute an AI strategy that delivers measurable business results', domain_id: 'leadership', is_trending: true, trending_score: 0.90, popularity_rank: 1, tags: ['ai strategy', 'executive'] },
    { title: 'Generative AI Fundamentals', description: 'What every executive must understand about generative AI before making investment decisions', domain_id: 'ai-ml', is_trending: true, trending_score: 0.88, popularity_rank: 2, tags: ['generative ai', 'fundamentals'] },
    { title: 'AI Governance & Risk Management', description: 'Build governance frameworks that satisfy boards, regulators, and stakeholders', domain_id: 'risk', is_trending: false, trending_score: 0.75, popularity_rank: 3, tags: ['governance', 'risk'] },
  ]
}

/**
 * Generates a curated list of 18 topics for a given role×industry×maturity combination.
 * Uses Claude as an education specialist to select and rank topics by relevance and trendiness.
 * Falls back to a hardcoded mock when ANTHROPIC_API_KEY is a placeholder.
 *
 * @param role - The user's role slug (e.g. 'ceo', 'cto')
 * @param industry - The user's industry slug (e.g. 'financial-services', 'retail')
 * @param maturity - The user's AI maturity level (e.g. 'beginner', 'intermediate')
 * @returns CatalogCuration with featured topics and generation timestamp
 */
export async function generateCuratedCatalog(
  role: string,
  industry: string,
  maturity: string
): Promise<CatalogCuration> {
  if (isPlaceholder) {
    console.log(`[MOCK] generateCuratedCatalog role=${role} industry=${industry} maturity=${maturity}`)
    return { featured: mockCuration(role, industry), generated_at: new Date().toISOString() }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Generate 18 curated topics for:\nRole: ${role}\nIndustry: ${industry}\nMaturity: ${maturity}\n\nOrder by trending first, then strategic value.`
    }]
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const data = JSON.parse(clean) as { topics?: unknown }

  if (!Array.isArray(data.topics) || data.topics.length === 0) {
    throw new Error('Empty topics from catalog curator')
  }

  return {
    featured: data.topics as CuratedTopic[],
    generated_at: new Date().toISOString(),
  }
}
