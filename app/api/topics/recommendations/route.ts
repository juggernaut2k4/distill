import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { getRoleTier } from '@/lib/curriculum/role-utils'
import type { RoleTier } from '@/lib/curriculum/role-utils'

export const maxDuration = 45

// ─── Request schema ────────────────────────────────────────────────────────────

const RecommendationsSchema = z.object({
  // min(1) removed — empty strings are valid; we default gracefully rather than returning blank fallback
  role: z.string().max(100).optional().default(''),
  primaryDomain: z.string().max(100).optional().default(''),
  subDomain: z.string().max(100).optional().default(''),
  learningGoal: z.string().max(200).optional().default(''),
  aiMaturity: z.string().max(50).optional().default('intermediate'),
  roleLevel: z.enum(['c-suite', 'vp-dir', 'vp-technology', 'vp-product', 'manager', 'specialist'])
             .optional()
             .default('manager'),
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
  sections: Section[]
}

// ─── Mock data ─────────────────────────────────────────────────────────────────

// Three role-differentiated fallback objects — shown when Claude is unavailable or times out.
// Selected by getRoleTier(roleLevel) at each fallback return site.

const MOCK_RESPONSE_EXECUTIVE: RecommendationsResponse = {
  sections: [
    {
      id: 'trending',
      label: 'Trending in your field',
      icon: 'TrendingUp',
      topics: [
        {
          id: 'ai-governance-leaders',
          title: 'AI Governance for Leaders',
          description: 'Building oversight structures that satisfy your board, regulators, and risk teams.',
        },
        {
          id: 'agentic-ai-enterprise',
          title: 'Agentic AI in the Enterprise',
          description: 'What autonomous AI systems mean for your operations, risk exposure, and workforce.',
        },
        {
          id: 'ai-competitive-intelligence',
          title: 'AI Competitive Intelligence',
          description: 'How to read what your competitors are doing with AI before it becomes a threat.',
        },
        {
          id: 'ai-investment-decisions',
          title: 'Making AI Investment Decisions',
          description: 'A framework for deciding which AI bets to fund and which to defer.',
        },
      ],
    },
    {
      id: 'role',
      label: 'Based on your role',
      icon: 'Briefcase',
      topics: [
        {
          id: 'ai-strategy-leaders',
          title: 'AI Strategy for Leaders',
          description: 'How to define, communicate, and execute an AI strategy your organisation can act on.',
        },
        {
          id: 'evaluating-ai-vendors',
          title: 'Evaluating AI Vendor Pitches',
          description: 'The five questions that separate real AI capability from a polished sales demo.',
        },
        {
          id: 'ai-roi-frameworks',
          title: 'Measuring AI ROI',
          description: 'Proven methods to quantify and communicate the return on AI investments.',
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools to master',
      icon: 'Wrench',
      topics: [
        {
          id: 'anthropic-claude-executives',
          title: 'Anthropic Claude for Executives',
          description: 'Using Claude for analysis, briefing preparation, and decision support.',
        },
        {
          id: 'chatgpt-enterprise',
          title: 'ChatGPT Enterprise',
          description: 'What the enterprise tier offers and whether it fits your organisation.',
        },
        {
          id: 'microsoft-copilot-leadership',
          title: 'Microsoft Copilot for Leadership',
          description: 'Automating executive documents, presentations, and communications.',
        },
      ],
    },
    {
      id: 'goal',
      label: 'Based on your goal',
      icon: 'Target',
      topics: [
        {
          id: 'ai-fluency-executives',
          title: 'AI Fluency for Executives',
          description: 'What every senior leader needs to know to hold their own in any AI conversation.',
        },
        {
          id: 'board-ai-communication',
          title: 'Communicating AI to Your Board',
          description: 'How to present AI risk, opportunity, and progress at board level.',
        },
        {
          id: 'ai-team-enablement',
          title: 'Enabling Your Team with AI',
          description: 'How leaders accelerate AI adoption without becoming the bottleneck.',
        },
      ],
    },
  ],
}

const MOCK_RESPONSE_TECHNICAL: RecommendationsResponse = {
  sections: [
    {
      id: 'trending',
      label: 'Trending in your field',
      icon: 'TrendingUp',
      topics: [
        {
          id: 'agentic-systems-production',
          title: 'Agentic Systems in Production',
          description: 'Building, evaluating, and safely deploying autonomous AI agents in real systems.',
        },
        {
          id: 'rag-pipelines-engineers',
          title: 'RAG Pipelines for Engineers',
          description: 'Retrieval-augmented generation: architecture, chunking, retrieval, and evaluation.',
        },
        {
          id: 'llm-evaluation-practitioner',
          title: 'LLM Evaluation for Practitioners',
          description: 'How to measure model quality systematically — beyond vibe checks.',
        },
        {
          id: 'multimodal-apis',
          title: 'Multimodal APIs in Practice',
          description: 'Using vision, audio, and document capabilities in production AI applications.',
        },
      ],
    },
    {
      id: 'role',
      label: 'Based on your role',
      icon: 'Briefcase',
      topics: [
        {
          id: 'prompt-engineering-engineers',
          title: 'Prompt Engineering for Engineers',
          description: 'Systematic prompt design, chaining, and evaluation for production use cases.',
        },
        {
          id: 'building-ai-features',
          title: 'Building AI-Powered Features',
          description: 'End-to-end patterns for integrating LLMs into product features safely.',
        },
        {
          id: 'ai-code-review',
          title: 'AI-Assisted Code Review',
          description: 'Using LLMs to catch bugs, suggest refactors, and enforce patterns at PR time.',
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools to master',
      icon: 'Wrench',
      topics: [
        {
          id: 'anthropic-claude-developers',
          title: 'Anthropic Claude API for Developers',
          description: 'Messages API, tool use, streaming, and context management in production.',
        },
        {
          id: 'github-copilot-engineers',
          title: 'GitHub Copilot for Engineers',
          description: 'Beyond autocomplete: using Copilot for architecture, tests, and debugging.',
        },
        {
          id: 'cursor-ai-ide',
          title: 'Cursor AI IDE',
          description: 'The AI-native editor and how to use it for complex multi-file refactors.',
        },
      ],
    },
    {
      id: 'goal',
      label: 'Based on your goal',
      icon: 'Target',
      topics: [
        {
          id: 'llm-fundamentals-engineers',
          title: 'LLM Fundamentals for Engineers',
          description: 'Tokens, context windows, temperature, and inference — what every builder must know.',
        },
        {
          id: 'ai-safety-practitioners',
          title: 'AI Safety for Practitioners',
          description: 'Prompt injection, jailbreaks, and output validation in production systems.',
        },
        {
          id: 'mlops-llm-era',
          title: 'MLOps in the LLM Era',
          description: 'Deploying, monitoring, and updating LLM-powered systems in production.',
        },
      ],
    },
  ],
}

const MOCK_RESPONSE_MANAGER: RecommendationsResponse = {
  sections: [
    {
      id: 'trending',
      label: 'Trending in your field',
      icon: 'TrendingUp',
      topics: [
        {
          id: 'ai-team-adoption',
          title: 'AI Adoption Playbook for Teams',
          description: 'A practical guide to rolling out AI tools across a team of 5–20 people.',
        },
        {
          id: 'ai-productivity-measurement',
          title: 'Measuring AI Productivity Gains',
          description: 'How to quantify and report AI impact at team level without complex tooling.',
        },
        {
          id: 'ai-tools-landscape',
          title: 'AI Tools Landscape for Managers',
          description: 'What is actually useful right now versus what is vendor hype.',
        },
        {
          id: 'agentic-ai-teams',
          title: 'Agentic AI and Your Team',
          description: 'What autonomous AI workflows mean for how your team operates day to day.',
        },
      ],
    },
    {
      id: 'role',
      label: 'Based on your role',
      icon: 'Briefcase',
      topics: [
        {
          id: 'evaluating-ai-tools-function',
          title: 'Evaluating AI Tools for Your Function',
          description: 'A structured approach to trialling, selecting, and deploying AI tools for your team.',
        },
        {
          id: 'coaching-team-ai',
          title: 'Coaching Your Team on AI',
          description: 'How to build AI habits across a team without mandating a specific tool.',
        },
        {
          id: 'ai-workflows-operations',
          title: 'AI Workflows for Operations',
          description: 'The highest-leverage AI use cases for operational and cross-functional teams.',
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools to master',
      icon: 'Wrench',
      topics: [
        {
          id: 'anthropic-claude-managers',
          title: 'Anthropic Claude for Managers',
          description: 'Using Claude for performance reviews, status reports, and team communications.',
        },
        {
          id: 'notion-ai-teams',
          title: 'Notion AI for Teams',
          description: 'Building shared AI-powered docs, templates, and wikis your team actually uses.',
        },
        {
          id: 'microsoft-copilot-managers',
          title: 'Microsoft Copilot for Managers',
          description: 'Automating meeting notes, action tracking, and reporting across your team.',
        },
      ],
    },
    {
      id: 'goal',
      label: 'Based on your goal',
      icon: 'Target',
      topics: [
        {
          id: 'ai-fluency-managers',
          title: 'AI Fluency for Managers',
          description: 'What every manager needs to understand to lead an AI-enabled team.',
        },
        {
          id: 'prompt-skills-managers',
          title: 'Practical Prompt Skills',
          description: 'The prompting techniques that deliver the most value with the least effort.',
        },
        {
          id: 'ai-change-management',
          title: 'AI Change Management',
          description: 'How to handle team resistance, upskilling gaps, and workflow disruption.',
        },
      ],
    },
  ],
}

// Lookup map for fallback selection by tier
const MOCK_RESPONSES: Record<RoleTier, RecommendationsResponse> = {
  executive: MOCK_RESPONSE_EXECUTIVE,
  technical:  MOCK_RESPONSE_TECHNICAL,
  manager:    MOCK_RESPONSE_MANAGER,
}

// Three system prompts — selected by getRoleTier(roleLevel) before each Claude call.
const SYSTEM_PROMPTS: Record<RoleTier, string> = {
  executive: `You are a senior AI learning advisor for business leaders and executives. Your audience holds titles such as CEO, CFO, COO, CMO, CTO, VP, SVP, and Director. They are accountable for AI decisions at organisational scale — budgets, risk, competitive positioning, and team capability — but they do not write code or build models themselves.

Generate personalised AI topic recommendations for this leader based on their profile. Every topic you suggest must be immediately relevant to someone making strategic, operational, or leadership decisions about AI.

Rules for topic selection and framing:
- Frame every topic at the decision-maker level: what do they need to know to lead, evaluate, govern, or invest in AI — not how to build it.
- Prioritise topics that build confidence in AI conversations at board level, with vendors, with regulators, and with their own teams.
- Include topics on AI governance, risk, ROI, vendor evaluation, and competitive strategy — these are the executive's primary AI responsibilities.
- Do NOT suggest topics on prompt engineering mechanics, API integration, model fine-tuning, MLOps, or any hands-on technical skill. These belong to their team, not to them.
- Vocabulary: use "AI strategy", "AI governance", "competitive intelligence", "team enablement", "ROI", "risk framework" — not "tokens", "embeddings", "inference", "fine-tuning", "RAG".

Return ONLY valid JSON matching the specified schema. Be specific and practical — every topic must be immediately relevant to someone in their exact role and sub-domain.`,

  technical: `You are a senior AI learning advisor for technical practitioners. Your audience holds titles such as Software Engineer, Senior Engineer, Data Scientist, Data Analyst, ML Engineer, Platform Engineer, and other individual contributor or specialist roles. They build and integrate AI systems as part of their daily work — writing code, calling APIs, evaluating models, and shipping AI-powered features.

Generate personalised AI topic recommendations for this practitioner based on their profile. Every topic you suggest must deliver hands-on, implementable knowledge that makes them more effective at building with AI.

Rules for topic selection and framing:
- Frame every topic at the implementation level: how to build, integrate, evaluate, optimise, or operate AI systems.
- Prioritise topics on Claude API, prompt engineering, agentic systems, RAG pipelines, model evaluation, AI tooling, and applied ML in production.
- Include topics that are immediately applicable: skills they can use in their next sprint, pull request, or architecture decision.
- Do NOT suggest topics on AI governance, board communication, vendor procurement, ROI frameworks, or organisational strategy — these belong to their leadership, not to them.
- Vocabulary: use "API", "prompt engineering", "context window", "embeddings", "RAG", "fine-tuning", "agentic systems", "LLM", "inference", "latency", "evaluation" — not "board-ready", "executive briefing", "governance", "stakeholder".

Return ONLY valid JSON matching the specified schema. Be specific and practical — every topic must be immediately relevant to someone in their exact role and sub-domain.`,

  manager: `You are a senior AI learning advisor for team managers and team leads. Your audience holds titles such as Manager, Senior Manager, Team Lead, and Engineering Manager. They are responsible for the productivity and AI adoption of teams of 3–20 people. They need to evaluate and deploy AI tools for their function, coach their team on AI use, and report impact upward — without needing to build AI systems themselves or make board-level governance decisions.

Generate personalised AI topic recommendations for this manager based on their profile. Every topic you suggest must be practical and operational — things they can implement with their team in the next 30–60 days.

Rules for topic selection and framing:
- Frame every topic at the team-operations level: how to adopt, evaluate, deploy, and measure AI tools for a specific function or team.
- Prioritise topics on AI productivity tools, team adoption playbooks, evaluating AI tools for a function, measuring AI impact at team level, and practical prompt skills.
- Include topics that help them have credible AI conversations with both their team and their leadership.
- Do NOT suggest topics on hands-on model implementation, API integration, or MLOps — those are for their engineers. Do NOT suggest board-level governance, procurement, or investor framing — those are for their leadership.
- Vocabulary: use "AI adoption", "team productivity", "tool evaluation", "practical AI", "AI workflow", "measuring impact" — avoid both deep technical jargon and board-level strategic language.

Return ONLY valid JSON matching the specified schema. Be specific and practical — every topic must be immediately relevant to someone in their exact role and sub-domain.`,
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
 * Attempts to shape a parsed JSON value into a RecommendationsResponse.
 * Returns null if the value does not match the expected shape.
 */
function shapeResponse(parsed: unknown): RecommendationsResponse | null {
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
}

/**
 * Tries JSON.parse on a candidate string and shapes the result.
 * Returns null on any parse or shape failure.
 */
function tryParse(candidate: string): RecommendationsResponse | null {
  try {
    return shapeResponse(JSON.parse(candidate) as unknown)
  } catch {
    return null
  }
}

/**
 * Parses and normalises Claude's raw JSON output into a RecommendationsResponse.
 * Uses multiple extraction strategies in sequence so that any valid JSON buried in
 * Claude's response (prose prefix, markdown fences, trailing commas, etc.) is recovered.
 * Returns null only when every strategy fails — caller logs the full raw string.
 */
function parseClaudeResponse(raw: string): RecommendationsResponse | null {
  // Log the first 500 chars BEFORE any parse attempt so production logs always show
  // exactly what Claude returned, even when parsing fails.
  console.log('[topics/recommendations] raw Claude response:', raw.slice(0, 500))

  // Strategy A — try the raw string as-is (Claude may already return clean JSON)
  const stratA = tryParse(raw)
  if (stratA) return stratA

  // Strategy B — strip everything before the first { or [ and after the last } or ]
  const firstBracket = Math.min(
    raw.indexOf('{') === -1 ? Infinity : raw.indexOf('{'),
    raw.indexOf('[') === -1 ? Infinity : raw.indexOf('['),
  )
  const lastClose = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'))
  if (firstBracket !== Infinity && lastClose > firstBracket) {
    const sliced = raw.slice(firstBracket, lastClose + 1)
    const stratB = tryParse(sliced)
    if (stratB) return stratB

    // Strategy C — remove trailing commas before } or ] on the sliced string
    const noTrailing = sliced.replace(/,(\s*[}\]])/g, '$1')
    const stratC = tryParse(noTrailing)
    if (stratC) return stratC
  }

  // Strategy D — strip markdown fences (``` or ```json ... ```) then retry B+C
  const fenceStripped = raw
    .replace(/^```(?:json)?\s*/im, '')  // opening fence (may have leading whitespace)
    .replace(/\s*```\s*$/im, '')        // closing fence (may have trailing whitespace)
    .trim()
  const stratD = tryParse(fenceStripped)
  if (stratD) return stratD

  // Strategy D2 — fence-strip then also strip trailing commas
  const fenceNoTrailing = fenceStripped.replace(/,(\s*[}\]])/g, '$1')
  const stratD2 = tryParse(fenceNoTrailing)
  if (stratD2) return stratD2

  // Strategy E — regex extraction: pull largest {...} or [...] block from the raw string
  const regexMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (regexMatch) {
    const extracted = regexMatch[1]
    const stratE = tryParse(extracted)
    if (stratE) return stratE

    // Strategy E2 — same extracted block but with trailing commas removed
    const stratE2 = tryParse(extracted.replace(/,(\s*[}\]])/g, '$1'))
    if (stratE2) return stratE2
  }

  // All strategies exhausted — log the full raw string so we can diagnose
  console.error('[topics/recommendations] All JSON parse strategies failed. Full raw Claude response:\n', raw)
  return null
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
      // roleLevel is unavailable when Zod parse fails — use manager as safe default (EC-06)
      return NextResponse.json({ fallback: true, sections: MOCK_RESPONSE_MANAGER.sections } as FallbackResponse)
    }

    const { role, primaryDomain, subDomain, learningGoal, aiMaturity, roleLevel } = parsed.data

    // Derive the three-tier bucket once — used for both prompt selection and fallback selection
    const tier = getRoleTier(roleLevel)

    // ── Mock guard (PLACEHOLDER_ key) ───────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
    if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
      console.log('[MOCK Anthropic] /api/topics/recommendations — returning mock data for tier:', tier)
      return NextResponse.json(MOCK_RESPONSES[tier])
    }

    // ── Live Claude path ─────────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey })

    const systemPrompt = SYSTEM_PROMPTS[tier]

    const userPrompt = buildUserPrompt(
      role,
      primaryDomain,
      subDomain,
      aiMaturity,
      learningGoal
    )

    // 20-second timeout via AbortController (Claude Sonnet p50 is ~3s, p99 is ~15s)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 20_000)

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
      return NextResponse.json({ fallback: true, sections: MOCK_RESPONSES[tier].sections } as FallbackResponse)
    } finally {
      clearTimeout(timeoutId)
    }

    const result = parseClaudeResponse(rawText)
    if (!result) {
      console.error('[topics/recommendations] Failed to parse Claude JSON response')
      return NextResponse.json({ fallback: true, sections: MOCK_RESPONSES[tier].sections } as FallbackResponse)
    }

    return NextResponse.json(result)
  } catch (err) {
    // Unhandled errors — never let this route return 500.
    // roleLevel is unknown here (outer catch fires before Zod parse); use manager as safe default.
    console.error('[topics/recommendations] Unexpected error:', err)
    return NextResponse.json({ fallback: true, sections: MOCK_RESPONSE_MANAGER.sections } as FallbackResponse)
  }
}
