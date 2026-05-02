/* eslint-disable */
// Note: newsapi package uses CommonJS; dynamic require is required.
const NewsAPI = require('newsapi')
/* eslint-enable */

import { createSupabaseAdminClient } from '../supabase'
import type { ContentType } from './taxonomy'

const isPlaceholder =
  !process.env.NEWS_API_KEY ||
  process.env.NEWS_API_KEY.startsWith('PLACEHOLDER_')

const newsapi = isPlaceholder ? null : new NewsAPI(process.env.NEWS_API_KEY)

export interface NewsArticle {
  title: string
  description: string
  url: string
  source: string
  publishedAt: string
  relevanceScore: number
  role_tags: string[]
  industry_tags: string[]
}

/** Keywords used for role/industry tagging of articles */
const ROLE_KEYWORDS: Record<string, string[]> = {
  'CEO / MD / President': ['board', 'strategy', 'governance', 'competitive', 'transformation', 'leadership'],
  'VP / SVP / EVP': ['roi', 'investment', 'vendor', 'budget', 'team', 'deployment'],
  'CU Lead / Practice Head': ['capability', 'practice', 'use case', 'implementation', 'pilot'],
  'BU Lead / Functional Head': ['function', 'operations', 'efficiency', 'productivity'],
}

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  'Technology / SaaS': ['software', 'cloud', 'tech', 'startup', 'saas', 'platform'],
  'Financial Services / Banking': ['banking', 'finance', 'fintech', 'investment', 'trading', 'fraud'],
  'Healthcare / Life Sciences': ['health', 'medical', 'clinical', 'pharma', 'drug', 'patient'],
  'Retail / E-commerce': ['retail', 'ecommerce', 'consumer', 'shopping', 'store', 'inventory'],
  'Manufacturing / Supply Chain': ['manufacturing', 'supply chain', 'logistics', 'factory', 'automation'],
  'Consulting / Professional Services': ['consulting', 'advisory', 'professional services', 'mckinsey', 'deloitte'],
}

/** 10 hardcoded realistic mock articles for development */
const MOCK_ARTICLES: NewsArticle[] = [
  {
    title: 'JPMorgan Deploys AI Across Trading Operations, Reports 60% Efficiency Gain',
    description: 'The bank\'s AI-driven trade review system processes 200x more transactions per analyst, signaling a fundamental shift in financial services.',
    url: 'https://example.com/jpmorgan-ai',
    source: 'Financial Times',
    publishedAt: new Date().toISOString(),
    relevanceScore: 9,
    role_tags: ['CEO / MD / President', 'VP / SVP / EVP'],
    industry_tags: ['Financial Services / Banking'],
  },
  {
    title: 'Microsoft Copilot Adoption Reaches 300 Million Monthly Users',
    description: 'Enterprise AI adoption is accelerating as productivity gains become measurable. Early adopters report 2-3 hour weekly time savings per employee.',
    url: 'https://example.com/copilot-adoption',
    source: 'Wall Street Journal',
    publishedAt: new Date().toISOString(),
    relevanceScore: 8,
    role_tags: [],
    industry_tags: ['Technology / SaaS'],
  },
  {
    title: 'Healthcare AI Diagnostics Reduce Misdiagnosis Rate by 40% in Trial',
    description: 'A landmark trial across 50 hospitals shows AI-assisted diagnostics outperform solo physician assessment in catching rare conditions.',
    url: 'https://example.com/health-ai',
    source: 'Nature Medicine',
    publishedAt: new Date().toISOString(),
    relevanceScore: 8,
    role_tags: ['CU Lead / Practice Head', 'BU Lead / Functional Head'],
    industry_tags: ['Healthcare / Life Sciences'],
  },
  {
    title: 'Retailers Using AI Personalization See 15% Conversion Lift on Average',
    description: 'A study of 200 retail brands shows AI-driven recommendations are now table stakes, with laggards losing significant market share.',
    url: 'https://example.com/retail-ai',
    source: 'RetailDive',
    publishedAt: new Date().toISOString(),
    relevanceScore: 7,
    role_tags: ['CEO / MD / President'],
    industry_tags: ['Retail / E-commerce'],
  },
  {
    title: 'The New AI Governance Playbook: What Boards Need to Know',
    description: 'Boards are now expected to have at least one AI-literate member. Here\'s the governance framework Fortune 500 companies are adopting.',
    url: 'https://example.com/ai-governance',
    source: 'Harvard Business Review',
    publishedAt: new Date().toISOString(),
    relevanceScore: 9,
    role_tags: ['CEO / MD / President'],
    industry_tags: [],
  },
  {
    title: 'Supply Chain AI Reduces Forecast Errors by 35%, Study Shows',
    description: 'Machine learning models trained on 5+ years of demand data are outperforming traditional planning methods in complex supply chains.',
    url: 'https://example.com/supply-chain-ai',
    source: 'Supply Chain Digital',
    publishedAt: new Date().toISOString(),
    relevanceScore: 7,
    role_tags: ['BU Lead / Functional Head'],
    industry_tags: ['Manufacturing / Supply Chain'],
  },
  {
    title: 'McKinsey: 70% of Consulting Engagements Now Include AI Component',
    description: 'Professional services firms are embedding AI analysis in every major engagement. Clients who lack AI literacy are asking worse questions.',
    url: 'https://example.com/consulting-ai',
    source: 'Consulting Magazine',
    publishedAt: new Date().toISOString(),
    relevanceScore: 8,
    role_tags: ['VP / SVP / EVP', 'Product Sponsor / Owner'],
    industry_tags: ['Consulting / Professional Services'],
  },
  {
    title: 'How to Evaluate an AI Vendor\'s Actual Capabilities in 2026',
    description: 'With thousands of AI vendors competing for enterprise budgets, the ability to separate substance from marketing has become a core executive competency.',
    url: 'https://example.com/vendor-evaluation',
    source: 'Gartner Insights',
    publishedAt: new Date().toISOString(),
    relevanceScore: 8,
    role_tags: ['VP / SVP / EVP', 'Product Sponsor / Owner'],
    industry_tags: [],
  },
  {
    title: 'Anthropic Releases Claude 4 with Enhanced Business Reasoning',
    description: 'The new model shows 40% improvement in multi-step business analysis tasks and is now being deployed in enterprise decision support systems.',
    url: 'https://example.com/claude-4',
    source: 'TechCrunch',
    publishedAt: new Date().toISOString(),
    relevanceScore: 7,
    role_tags: [],
    industry_tags: ['Technology / SaaS'],
  },
  {
    title: 'AI ROI: The Framework That Actually Works for Enterprise',
    description: 'After analyzing 500 enterprise AI deployments, Forrester found that projects with pre-defined success metrics delivered 3x better ROI.',
    url: 'https://example.com/ai-roi',
    source: 'Forrester',
    publishedAt: new Date().toISOString(),
    relevanceScore: 9,
    role_tags: ['CEO / MD / President', 'VP / SVP / EVP'],
    industry_tags: [],
  },
]

/**
 * Scores article relevance based on AI keyword presence.
 */
function scoreRelevance(title: string, description: string): number {
  const text = `${title} ${description}`.toLowerCase()
  const keywords = ['ai', 'artificial intelligence', 'machine learning', 'automation',
    'llm', 'model', 'generative', 'neural', 'algorithm', 'data', 'prediction']
  return keywords.filter((kw) => text.includes(kw)).length
}

/**
 * Tags an article with role and industry relevance based on keyword matching.
 */
function tagArticle(
  title: string,
  description: string
): { role_tags: string[]; industry_tags: string[] } {
  const text = `${title} ${description}`.toLowerCase()

  const role_tags = Object.entries(ROLE_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => text.includes(kw)))
    .map(([role]) => role)

  const industry_tags = Object.entries(INDUSTRY_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => text.includes(kw)))
    .map(([industry]) => industry)

  return { role_tags, industry_tags }
}

/**
 * Fetches fresh AI news from NewsAPI, processes and saves to Supabase.
 * Falls back to mock articles if NEWS_API_KEY is a placeholder.
 * @returns Array of processed news articles
 */
export async function ingestNews(): Promise<NewsArticle[]> {
  if (isPlaceholder || !newsapi) {
    console.log('[MOCK] ingestNews — returning 10 hardcoded mock articles')
    return MOCK_ARTICLES
  }

  try {
    const response = await newsapi.v2.everything({
      q: 'artificial intelligence OR "AI" business executive enterprise',
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: 30,
    })

    if (!response.articles || response.articles.length === 0) {
      return MOCK_ARTICLES
    }

    // Deduplicate by URL
    const seen = new Set<string>()
    const articles: NewsArticle[] = []

    for (const article of response.articles) {
      if (seen.has(article.url) || !article.title || !article.description) {
        continue
      }
      seen.add(article.url)

      const relevanceScore = scoreRelevance(article.title, article.description ?? '')
      if (relevanceScore < 2) continue // Filter low-relevance articles

      const { role_tags, industry_tags } = tagArticle(article.title, article.description ?? '')

      articles.push({
        title: article.title,
        description: article.description ?? '',
        url: article.url,
        source: article.source?.name ?? 'Unknown',
        publishedAt: article.publishedAt,
        relevanceScore,
        role_tags,
        industry_tags,
      })
    }

    // Save to Supabase content_items as 'signal' type
    const supabase = createSupabaseAdminClient()
    const itemsToInsert = articles.slice(0, 10).map((article) => ({
      type: 'signal' as ContentType,
      body_text: `${article.title}: ${article.description}`.substring(0, 320),
      role_tags: article.role_tags,
      industry_tags: article.industry_tags,
      maturity_tags: [],
      worry_tags: [],
      source_url: article.url,
      generated_by: 'curated',
    }))

    await supabase.from('content_items').upsert(itemsToInsert, {
      onConflict: 'source_url',
      ignoreDuplicates: true,
    })

    return articles
  } catch (err) {
    console.error('[news-ingestion] Error fetching news:', err)
    return MOCK_ARTICLES
  }
}
