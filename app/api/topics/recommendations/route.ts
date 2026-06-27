import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { getRoleTier } from '@/lib/curriculum/role-utils'
import type { RoleTier } from '@/lib/curriculum/role-utils'
import { createSupabaseAdminClient } from '@/lib/supabase'

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
      id: 'decisions',
      label: 'Decisions you need to own',
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
        {
          id: 'board-ai-communication',
          title: 'Communicating AI to Your Board',
          description: 'How to present AI risk, opportunity, and progress at board level.',
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools to be fluent in',
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
        {
          id: 'structured-outputs-llm',
          title: 'Structured Outputs from LLMs',
          description: 'Reliably extracting typed JSON and validated data from language model responses.',
        },
      ],
    },
    {
      id: 'skills',
      label: 'Skills to build',
      icon: 'Code2',
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
          id: 'cursor-ai-ide',
          title: 'Cursor AI IDE',
          description: 'The AI-native editor and how to use it for complex multi-file refactors.',
        },
        {
          id: 'github-copilot-engineers',
          title: 'GitHub Copilot for Engineers',
          description: 'Beyond autocomplete: using Copilot for architecture, tests, and debugging.',
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
      id: 'team',
      label: 'Enabling your team',
      icon: 'Users',
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
        {
          id: 'ai-change-management',
          title: 'AI Change Management',
          description: 'How to handle team resistance, upskilling gaps, and workflow disruption.',
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

const USER_PROMPTS: Record<RoleTier, (role: string, primaryDomain: string, subDomain: string, aiMaturity: string, learningGoal: string) => string> = {
  technical: (role, primaryDomain, subDomain, aiMaturity, learningGoal) =>
    `Generate AI learning topic recommendations for:
- Role: ${role}
- Domain: ${primaryDomain}
- Sub-domain: ${subDomain}
- AI experience: ${aiMaturity}
- Learning goal: ${learningGoal}

Return exactly 3 sections. Think from this developer's perspective — what do they actually need to build great AI systems?

1. "trending" — 5 topics: what is happening RIGHT NOW in AI engineering that someone in ${subDomain} must know about. Urgent and specific.
2. "skills" — 5 topics: the concrete implementation skills and techniques a ${role} in ${primaryDomain} needs to build and ship AI systems. Things they can use in their next sprint.
3. "tools" — 4 topics: the exact AI tools, APIs, IDEs, or platforms that ${role}s in ${subDomain} are investing time in right now.

Rules:
- Every topic must be specific to this exact role and sub-domain — never generic
- Titles: max 7 words, concrete and specific (never "Introduction to X" or "Overview of Y")
- Descriptions: one sentence, max 18 words, what they can DO after learning this

Return JSON only — no markdown, no explanation.
Format: { "trending": [...], "skills": [...], "tools": [...] }`,

  executive: (role, primaryDomain, subDomain, aiMaturity, learningGoal) =>
    `Generate AI learning topic recommendations for:
- Role: ${role}
- Domain: ${primaryDomain}
- Sub-domain: ${subDomain}
- AI experience: ${aiMaturity}
- Learning goal: ${learningGoal}

Return exactly 3 sections. Think from this executive's perspective — what do they need to own, decide, and understand about AI?

1. "trending" — 4 topics: urgent AI developments in ${subDomain} within ${primaryDomain} that this leader must be aware of right now.
2. "decisions" — 4 topics: the specific AI decisions, governance choices, and strategic calls that a ${role} in ${primaryDomain} needs to own. Frame each as a decision they must make.
3. "tools" — 3 topics: the AI tools this executive should be personally fluent in — not their team's tools, theirs.

Rules:
- Frame topics at the decision-maker level — not "how to build", but "how to evaluate, govern, fund, or lead"
- Titles: max 7 words, concrete and specific
- Descriptions: one sentence, max 18 words, what they can decide or do after learning this

Return JSON only — no markdown, no explanation.
Format: { "trending": [...], "decisions": [...], "tools": [...] }`,

  manager: (role, primaryDomain, subDomain, aiMaturity, learningGoal) =>
    `Generate AI learning topic recommendations for:
- Role: ${role}
- Domain: ${primaryDomain}
- Sub-domain: ${subDomain}
- AI experience: ${aiMaturity}
- Learning goal: ${learningGoal}

Return exactly 3 sections. Think from this manager's perspective — what do they need to adopt AI for themselves and enable it for their team?

1. "trending" — 4 topics: what is happening in AI right now that directly affects a ${role} managing a team in ${subDomain}.
2. "team" — 4 topics: the specific AI adoption, coaching, and workflow topics a ${role} needs to enable their team. Each topic should result in a concrete action they take with their team.
3. "tools" — 3 topics: the AI tools this manager should master — to use personally and to evaluate for their team.

Rules:
- Topics should be operational, not strategic (board-level) and not technical (implementation-level)
- Titles: max 7 words, concrete and specific
- Descriptions: one sentence, max 18 words, what they can do or change after learning this

Return JSON only — no markdown, no explanation.
Format: { "trending": [...], "team": [...], "tools": [...] }`,
}

function buildUserPrompt(
  tier: RoleTier,
  role: string,
  primaryDomain: string,
  subDomain: string,
  aiMaturity: string,
  learningGoal: string
): string {
  return USER_PROMPTS[tier](role, primaryDomain, subDomain, aiMaturity, learningGoal)
}

// ─── JSON response shaping ─────────────────────────────────────────────────────

const SECTION_METADATA: Record<string, { label: string; icon: string }> = {
  trending:  { label: 'Trending in your field',    icon: 'TrendingUp' },
  skills:    { label: 'Skills to build',           icon: 'Code2'      },
  decisions: { label: 'Decisions you need to own', icon: 'Briefcase'  },
  team:      { label: 'Enabling your team',        icon: 'Users'      },
  tools:     { label: 'Tools to master',           icon: 'Wrench'     },
  // legacy keys — kept so any cached/in-flight responses still render
  role: { label: 'Based on your role',  icon: 'Briefcase' },
  goal: { label: 'Based on your goal',  icon: 'Target'    },
}

/**
 * Attempts to shape a parsed JSON value into a RecommendationsResponse.
 * Returns null if the value does not match the expected shape.
 */
function shapeResponse(parsed: unknown): RecommendationsResponse | null {
  if (!parsed || typeof parsed !== 'object') return null

  const obj = parsed as Record<string, unknown>

  // Claude returns { trending: [...], skills: [...] } — normalise to the internal sections format
  const KNOWN_SECTION_KEYS = ['trending', 'skills', 'decisions', 'team', 'tools', 'role', 'goal']
  let rawSections: unknown[]

  if (Array.isArray(obj.sections)) {
    rawSections = obj.sections
  } else {
    // Map top-level named keys → [{ id, topics }]
    const fromKeys = KNOWN_SECTION_KEYS
      .filter((k) => Array.isArray(obj[k]))
      .map((k) => ({ id: k, topics: obj[k] }))
    if (fromKeys.length === 0) return null
    rawSections = fromKeys
  }

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

// ─── Cache helpers ─────────────────────────────────────────────────────────────

function buildCacheKey(
  tier: string,
  role: string,
  primaryDomain: string,
  subDomain: string,
  aiMaturity: string,
  learningGoal: string
): string {
  // v2: bump invalidates all v1 entries (old 2-section format → new 3-section tier-aware format)
  const canonical = ['v2', tier, role, primaryDomain, subDomain, aiMaturity, learningGoal]
    .map((s) => s.trim().toLowerCase())
    .join('|')
  return createHash('sha256').update(canonical).digest('hex')
}

async function getCachedRecommendations(hash: string): Promise<Section[] | null> {
  try {
    const supabase = createSupabaseAdminClient()
    const { data } = await supabase
      .from('topic_recommendations_cache')
      .select('sections, hit_count')
      .eq('profile_hash', hash)
      .single()
    if (!data) return null
    // Bump hit count + last_used_at in background — don't block the response
    void supabase
      .from('topic_recommendations_cache')
      .update({ hit_count: (data.hit_count as number) + 1, last_used_at: new Date().toISOString() } as never)
      .eq('profile_hash', hash)
    return data.sections as Section[]
  } catch {
    return null
  }
}

/** Union-merge two section arrays. Existing topics are never removed; only new IDs are appended. */
function mergeSections(existing: Section[], incoming: Section[]): Section[] {
  const result = existing.map((s) => ({ ...s, topics: [...s.topics] }))
  for (const inc of incoming) {
    const match = result.find((s) => s.id === inc.id)
    if (!match) {
      result.push({ ...inc })
    } else {
      const existingIds = new Set(match.topics.map((t) => t.id))
      for (const topic of inc.topics) {
        if (!existingIds.has(topic.id)) match.topics.push(topic)
      }
    }
  }
  return result
}

async function saveToCache(hash: string, tier: string, newSections: Section[]): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient()
    const { data: existing } = await supabase
      .from('topic_recommendations_cache')
      .select('sections')
      .eq('profile_hash', hash)
      .single()

    if (existing) {
      const merged = mergeSections(existing.sections as Section[], newSections)
      await supabase
        .from('topic_recommendations_cache')
        .update({ sections: merged, last_used_at: new Date().toISOString() } as never)
        .eq('profile_hash', hash)
    } else {
      await supabase
        .from('topic_recommendations_cache')
        .insert({ profile_hash: hash, tier, sections: newSections })
    }
  } catch (err) {
    console.error('[topic-rec-cache] save failed:', err)
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
      // roleLevel is unavailable when Zod parse fails — use manager as safe default (EC-06)
      return NextResponse.json({ fallback: true, sections: MOCK_RESPONSE_MANAGER.sections } as FallbackResponse)
    }

    const { role, primaryDomain, subDomain, learningGoal, aiMaturity, roleLevel } = parsed.data

    // Derive the three-tier bucket once — used for prompt selection, fallback selection, and cache key
    const tier = getRoleTier(roleLevel)

    // ── Cache lookup ─────────────────────────────────────────────────────────────
    const cacheKey = buildCacheKey(tier, role, primaryDomain, subDomain, aiMaturity, learningGoal)
    const cached = await getCachedRecommendations(cacheKey)
    if (cached) {
      console.log('[topic-rec-cache] HIT for key:', cacheKey.slice(0, 12))
      return NextResponse.json({ sections: cached })
    }
    console.log('[topic-rec-cache] MISS — calling Claude for tier:', tier)

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
      tier,
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
          max_tokens: 4000,
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

    // Save to cache — awaited so it completes before the cold path returns (~50ms, negligible vs 3-5s Claude)
    await saveToCache(cacheKey, tier, result.sections)

    return NextResponse.json(result)
  } catch (err) {
    // Unhandled errors — never let this route return 500.
    // roleLevel is unknown here (outer catch fires before Zod parse); use manager as safe default.
    console.error('[topics/recommendations] Unexpected error:', err)
    return NextResponse.json({ fallback: true, sections: MOCK_RESPONSE_MANAGER.sections } as FallbackResponse)
  }
}
