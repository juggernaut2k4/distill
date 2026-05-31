import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'

// ─── Request schema ────────────────────────────────────────────────────────────

const RecommendationsSchema = z.object({
  role: z.string().min(1).max(100),
  primaryDomain: z.string().min(1).max(100),
  subDomain: z.string().max(100).optional().default(''),
  learningGoal: z.string().max(200).optional().default(''),
  aiMaturity: z.string().max(50).optional().default('intermediate'),
})

// ─── Response types ────────────────────────────────────────────────────────────

interface Topic {
  id: string
  title: string
  description: string
}

interface Section {
  id: string
  label: string
  icon: string
  topics: Topic[]
}

interface RecommendationsResponse {
  sections: Section[]
}

interface FallbackResponse {
  fallback: true
}

// ─── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_RESPONSE: RecommendationsResponse = {
  sections: [
    {
      id: 'trending',
      label: 'Trending in your field',
      icon: 'TrendingUp',
      topics: [
        {
          id: 'ai-credit-risk',
          title: 'AI in Credit Risk Modelling',
          description: 'ML models replacing scorecards for faster, more accurate lending decisions.',
        },
        {
          id: 'llm-compliance',
          title: 'LLMs for Regulatory Compliance',
          description: 'Using AI to parse regulations and flag policy gaps automatically.',
        },
        {
          id: 'ai-fraud-detection',
          title: 'Real-Time Fraud Detection',
          description: 'How banks deploy AI to catch fraud milliseconds before transactions clear.',
        },
        {
          id: 'gen-ai-reporting',
          title: 'Generative AI for Financial Reporting',
          description: 'Automating commentary and variance analysis in board-ready reports.',
        },
      ],
    },
    {
      id: 'role',
      label: 'Based on your role',
      icon: 'Briefcase',
      topics: [
        {
          id: 'ai-strategy-finance',
          title: 'AI Strategy for Finance Leaders',
          description: 'Building a credible AI roadmap your board and CFO will approve.',
        },
        {
          id: 'ai-business-case',
          title: 'Building AI Business Cases',
          description: 'How to quantify ROI on AI projects before committing budget.',
        },
        {
          id: 'vendor-evaluation',
          title: 'Evaluating AI Vendor Pitches',
          description: 'The 5 questions that separate real AI from a polished demo.',
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools to master',
      icon: 'Wrench',
      topics: [
        {
          id: 'anthropic-claude-banking',
          title: 'Anthropic Claude for Banking',
          description: 'Using Claude for contract review, report drafting, and scenario analysis.',
        },
        {
          id: 'chatgpt-analysis',
          title: 'ChatGPT for Financial Analysis',
          description: 'Prompting strategies that turn raw data into executive-ready summaries.',
        },
        {
          id: 'copilot-productivity',
          title: 'Microsoft Copilot in Finance',
          description: 'Automating Excel models, PowerPoint decks, and email drafts at scale.',
        },
      ],
    },
    {
      id: 'goal',
      label: 'Based on your goal',
      icon: 'Target',
      topics: [
        {
          id: 'ai-roi-frameworks',
          title: 'AI ROI Frameworks',
          description: 'Proven methods to measure and communicate AI investment returns.',
        },
        {
          id: 'ai-governance',
          title: 'AI Governance for Executives',
          description: 'Building oversight structures that satisfy regulators and your board.',
        },
        {
          id: 'ai-readiness',
          title: 'Assessing AI Readiness',
          description: 'A diagnostic for where your organisation stands versus competitors.',
        },
      ],
    },
  ],
}

// ─── Claude prompt builder ─────────────────────────────────────────────────────

function buildUserPrompt(
  role: string,
  primaryDomain: string,
  subDomain: string,
  aiMaturity: string,
  learningGoal: string
): string {
  return `Generate AI learning topic recommendations for:
- Role: ${role}
- Domain: ${primaryDomain}
- Sub-domain: ${subDomain}
- AI experience: ${aiMaturity}
- Learning goal: ${learningGoal}

Return exactly 4 sections:
1. "trending" — 4 topics: current AI trends and use cases in ${subDomain} within ${primaryDomain}
2. "role" — 3 topics: what ${role}-level professionals in ${primaryDomain} are learning about AI right now
3. "tools" — 3 topics: specific AI tools relevant to ${subDomain}. MUST include Anthropic Claude as one of the tools, named specifically as "Anthropic Claude for ${subDomain}" with a one-line description of how it is used in that sub-domain. Also include 2 other relevant tools (ChatGPT, Microsoft Copilot, GitHub Copilot, Glean, Notion AI — choose based on domain relevance).
4. "goal" — 3 topics: topics that directly help someone who wants to "${learningGoal}"

Each topic must have: { "id": "kebab-case-slug", "title": "max 6 words", "description": "one sentence, max 15 words, specific to their domain" }

Return JSON only — no markdown, no explanation, no code fences.`
}

// ─── JSON response shaping ─────────────────────────────────────────────────────

const SECTION_METADATA: Record<string, { label: string; icon: string }> = {
  trending: { label: 'Trending in your field', icon: 'TrendingUp' },
  role: { label: 'Based on your role', icon: 'Briefcase' },
  tools: { label: 'Tools to master', icon: 'Wrench' },
  goal: { label: 'Based on your goal', icon: 'Target' },
}

/**
 * Parses and normalises Claude's raw JSON output into a RecommendationsResponse.
 * Returns null if parsing fails.
 */
function parseClaudeResponse(raw: string): RecommendationsResponse | null {
  try {
    // Strip any stray markdown fences Claude may emit despite instructions
    const cleaned = raw.replace(/```(?:json)?/g, '').trim()
    const parsed = JSON.parse(cleaned) as unknown

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Record<string, unknown>).sections)) {
      return null
    }

    const rawSections = (parsed as { sections: unknown[] }).sections

    const sections: Section[] = rawSections
      .filter(
        (s): s is { id: string; topics: unknown[] } =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as Record<string, unknown>).id === 'string' &&
          Array.isArray((s as Record<string, unknown>).topics)
      )
      .map((s) => {
        const meta = SECTION_METADATA[s.id] ?? { label: s.id, icon: 'Circle' }
        const topics: Topic[] = (s.topics as unknown[])
          .filter(
            (t): t is { id: string; title: string; description: string } =>
              typeof t === 'object' &&
              t !== null &&
              typeof (t as Record<string, unknown>).id === 'string' &&
              typeof (t as Record<string, unknown>).title === 'string' &&
              typeof (t as Record<string, unknown>).description === 'string'
          )
          .map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
          }))

        return { id: s.id, label: meta.label, icon: meta.icon, topics }
      })

    if (sections.length === 0) return null

    return { sections }
  } catch {
    return null
  }
}

// ─── Route handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/topics/recommendations
 *
 * Generates personalised AI topic recommendations using Claude.
 * Does NOT require auth — the middleware already protects /topics at the page level.
 * Never calls Supabase — pure AI generation endpoint.
 * Always returns 200; frontend handles the fallback flag.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<RecommendationsResponse | FallbackResponse>> {
  try {
    const body = await request.json()
    const parsed = RecommendationsSchema.safeParse(body)

    if (!parsed.success) {
      // Even on validation failure return fallback so the frontend can degrade gracefully
      return NextResponse.json({ fallback: true } as FallbackResponse)
    }

    const { role, primaryDomain, subDomain, learningGoal, aiMaturity } = parsed.data

    // ── Mock guard (PLACEHOLDER_ key) ───────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
    if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
      console.log('[MOCK Anthropic] /api/topics/recommendations — returning mock data')
      return NextResponse.json(MOCK_RESPONSE)
    }

    // ── Live Claude path ─────────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey })

    const systemPrompt =
      'You are a senior AI learning advisor for executives. Generate personalised AI topic recommendations for a business leader based on their profile. Return ONLY valid JSON matching the specified schema. Be specific and practical — every topic must be immediately relevant to someone in their exact role and sub-domain.'

    const userPrompt = buildUserPrompt(
      role,
      primaryDomain,
      subDomain,
      aiMaturity,
      learningGoal
    )

    // 10-second timeout via AbortController
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10_000)

    let rawText: string
    try {
      const response = await anthropic.messages.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        },
        { signal: controller.signal }
      )

      rawText =
        response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    } catch (err) {
      // Covers both timeout (AbortError) and network errors
      console.error('[topics/recommendations] Claude API error:', (err as Error).message)
      return NextResponse.json({ fallback: true } as FallbackResponse)
    } finally {
      clearTimeout(timeoutId)
    }

    const result = parseClaudeResponse(rawText)
    if (!result) {
      console.error('[topics/recommendations] Failed to parse Claude JSON response')
      return NextResponse.json({ fallback: true } as FallbackResponse)
    }

    return NextResponse.json(result)
  } catch (err) {
    // Unhandled errors — never let this route return 500
    console.error('[topics/recommendations] Unexpected error:', err)
    return NextResponse.json({ fallback: true } as FallbackResponse)
  }
}
