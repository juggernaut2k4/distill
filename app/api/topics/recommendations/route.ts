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
  domainProficiency: z.record(z.string()).catch({}).optional().default({}),
  roleLevel: z.enum(['c-suite', 'vp-dir', 'vp-technology', 'vp-product', 'manager', 'specialist'])
             .optional()
             .catch('manager')
             .default('manager'),
})

// Normalise the many maturity vocabulary words into 3 actionable tiers
function normalizeMaturity(raw: string): 'beginner' | 'intermediate' | 'advanced' {
  const v = raw.toLowerCase()
  if (v === 'observer' || v === 'beginner') return 'beginner'
  if (v === 'emerging' || v === 'intermediate') return 'intermediate'
  return 'advanced' // practitioner, leader, expert, advanced
}

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
  maturity?: string
  advancedSections?: Section[]  // present for beginner users — shown collapsed in UI
}

interface FallbackResponse {
  fallback: true
  sections: Section[]
  maturity?: string
  advancedSections?: Section[]
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
      id: 'how_it_works',
      label: 'How it actually works',
      icon: 'Lightbulb',
      topics: [
        {
          id: 'why-context-windows-matter',
          title: 'Why context window size changes what AI can do for you',
          description: 'The single technical spec that determines whether an AI tool can handle your real workload.',
        },
        {
          id: 'rag-vs-finetuning-exec',
          title: "RAG vs fine-tuning: the question your vendor is hoping you won't ask",
          description: 'Two very different bets on where your data lives and who controls it.',
        },
        {
          id: 'how-llms-generate-text',
          title: 'How LLMs actually generate text — and why that creates hallucination risk',
          description: 'One paragraph that will change how you read every AI-generated output.',
        },
        {
          id: 'model-size-exec',
          title: 'Why bigger models are not always better for your use case',
          description: 'Cost, latency, and fit — the tradeoffs your engineering team is already making without you.',
        },
        {
          id: 'training-cutoff-exec',
          title: 'What "training data cutoff" means for your AI vendor decision',
          description: 'The invisible expiry date on every AI model and why it matters for compliance.',
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
      id: 'tools',
      label: 'AI tools to know',
      icon: 'Wrench',
      topics: [
        {
          id: 'claude',
          title: 'Claude',
          description: "Anthropic's AI model — what it's good at, how it differs from GPT, and when to use it.",
        },
        {
          id: 'chatgpt-gpt',
          title: 'ChatGPT & GPT',
          description: "OpenAI's model family — capabilities, limits, and how developers use it day to day.",
        },
        {
          id: 'gemini',
          title: 'Gemini',
          description: "Google's AI model — what makes it different and where it fits in your stack.",
        },
        {
          id: 'cursor',
          title: 'Cursor',
          description: 'The AI-native coding editor — how developers use it to write, refactor, and debug faster.',
        },
        {
          id: 'github-copilot',
          title: 'GitHub Copilot',
          description: 'AI pair programming built into your editor — autocomplete, test generation, and PR review.',
        },
        {
          id: 'higgsfield',
          title: 'Higgsfield',
          description: 'AI video generation — what it can create and how creative teams are using it.',
        },
      ],
    },
    {
      id: 'concepts',
      label: 'Concepts to master',
      icon: 'TrendingUp',
      topics: [
        {
          id: 'prompt-engineering',
          title: 'Prompt Engineering',
          description: 'How to write instructions that reliably get good AI outputs across different tasks.',
        },
        {
          id: 'rag',
          title: 'RAG',
          description: 'Retrieval-Augmented Generation — connecting AI to your own data and documents.',
        },
        {
          id: 'multi-agent-systems',
          title: 'Multi-Agent Systems',
          description: 'Orchestrating multiple AI agents to complete complex tasks that one model cannot do alone.',
        },
        {
          id: 'mcp',
          title: 'MCP',
          description: 'Model Context Protocol — the emerging standard for connecting AI models to tools and data sources.',
        },
        {
          id: 'ai-agents',
          title: 'AI Agents',
          description: 'Autonomous AI that can plan, use tools, and complete multi-step goals without constant guidance.',
        },
      ],
    },
    {
      id: 'apply',
      label: 'Apply to your work',
      icon: 'Code2',
      topics: [
        {
          id: 'ai-in-software-development',
          title: 'AI in Software Development',
          description: 'How AI is changing how developers write, review, test, and ship code.',
        },
        {
          id: 'building-with-ai-apis',
          title: 'Building with AI APIs',
          description: 'Integrating AI capabilities into your applications — from first call to production.',
        },
        {
          id: 'ai-for-product-teams',
          title: 'AI for Product Teams',
          description: 'How AI changes what you build, how fast you ship, and what users now expect.',
        },
      ],
    },
  ],
}

const MOCK_RESPONSE_TECHNICAL_BEGINNER: RecommendationsResponse = {
  sections: [
    {
      id: 'tools',
      label: 'AI tools to start with',
      icon: 'Wrench',
      topics: [
        { id: 'claude', title: 'Claude', description: "Anthropic's AI — what it does, how to talk to it, and what makes it different from ChatGPT." },
        { id: 'chatgpt-gpt', title: 'ChatGPT & GPT', description: "OpenAI's AI — the most widely used model and what developers actually use it for." },
        { id: 'cursor', title: 'Cursor', description: 'AI-powered code editor — how to set it up and use it to write code faster from day one.' },
        { id: 'github-copilot', title: 'GitHub Copilot', description: 'AI autocomplete in your existing editor — get it running and understand when to trust it.' },
        { id: 'gemini', title: 'Gemini', description: "Google's AI model — what it's good at and how it compares to Claude and GPT." },
      ],
    },
    {
      id: 'concepts',
      label: 'Concepts to understand first',
      icon: 'TrendingUp',
      topics: [
        { id: 'prompt-engineering', title: 'Prompt Engineering', description: 'How to write instructions that get AI to do exactly what you want, consistently.' },
        { id: 'how-llms-work', title: 'How LLMs Work', description: 'A plain-English explanation of what language models actually do under the hood.' },
        { id: 'rag', title: 'RAG', description: 'How AI answers questions from your own documents — the concept behind most AI search tools.' },
        { id: 'ai-agents', title: 'AI Agents', description: 'What it means when AI can take actions, use tools, and complete tasks autonomously.' },
        { id: 'mcp', title: 'MCP', description: 'Model Context Protocol — the standard that lets AI connect to your tools and data.' },
      ],
    },
    {
      id: 'apply',
      label: 'Apply to your work',
      icon: 'Code2',
      topics: [
        { id: 'ai-in-software-development', title: 'AI in Software Development', description: 'Where AI actually helps developers today — and where it still falls short.' },
        { id: 'building-with-ai-apis', title: 'Building with AI APIs', description: 'How to make your first API call, send a message, and get a response into your app.' },
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
- Do not frame any topic as a tutorial, step-by-step guide, or skill-building exercise. Frame every topic — including technical ones — as insight a leader needs to make better decisions or ask better questions.
- Vocabulary for governance/strategy topics: use "AI strategy", "AI governance", "competitive intelligence", "team enablement", "ROI", "risk framework". Vocabulary for conceptual-literacy topics (how_it_works): technical terms such as "context window", "RAG", "fine-tuning", "training cutoff", "hallucination" are permitted — framed as concepts the executive needs to evaluate, not skills they need to build.

Include a section with id 'how_it_works', label 'How it actually works', icon 'Lightbulb', containing 5 topics. These are conceptual literacy topics — not implementation guides. Frame each as what a CTO would explain to a board member who asked 'how does that actually work?'. Each topic title should be a question or a direct insight, not a course name. Each description (max 20 words) should make the executive feel smarter for reading it, not like they are being taught.

Return ONLY valid JSON matching the specified schema. Be specific and practical — every topic must be immediately relevant to someone in their exact role and sub-domain.`,

  technical: `You are a senior AI learning advisor for technical practitioners — software engineers, data scientists, ML engineers, and other builders. Your job is to recommend AI topics that are high-level and concept-focused, not implementation recipes.

Topic philosophy:
- Topic titles should be NAMES (Claude, RAG, MCP, Multi-Agent, Gemini) or SHORT CONCEPTS (Prompt Engineering, AI Agents) — not implementation recipes or course titles.
- A good topic title: "Claude", "RAG", "MCP", "Prompt Engineering", "Multi-Agent Systems", "Gemini", "Higgsfield"
- A bad topic title: "RAG Pipelines with Hybrid Search", "LLM Evaluation Frameworks in CI/CD", "Promptfoo for LLM Evaluation Testing"
- Descriptions: one sentence, 15 words max, explaining what this topic IS and why it matters — not a task they will perform.
- Calibrate breadth to the user's AI experience: beginner → well-known tools + foundational concepts; intermediate → add emerging concepts (MCP, agents, multi-agent); advanced → add frontier topics.
- Never include specific version numbers, specific library names as topics (Pinecone, LangChain, Promptfoo are too narrow), or CI/CD pipeline specifics.

Return ONLY valid JSON matching the specified schema.`,

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

const USER_PROMPTS: Record<RoleTier, (role: string, primaryDomain: string, subDomain: string, aiMaturity: string, learningGoal: string, domainProficiency: string) => string> = {
  technical: (role, primaryDomain, subDomain, aiMaturity, learningGoal, domainProficiency) =>
    `Generate AI topic recommendations for a ${role} in ${primaryDomain} (${subDomain}).
AI experience: ${aiMaturity}. Domain proficiency: ${domainProficiency}. Learning goal: ${learningGoal}.

Return exactly 3 sections:

1. "tools" — label "AI tools to know", icon "Wrench", 5–6 topics.
   List the major AI tools this person should know about. Think: Claude, ChatGPT, Gemini, Cursor, GitHub Copilot, Higgsfield, Midjourney, Runway, Perplexity — whichever are most relevant to their domain.
   Titles: just the tool name (e.g. "Claude", "Gemini", "Cursor"). Descriptions: 1 sentence, what this tool does and why it matters for their work.

2. "concepts" — label "Concepts to master", icon "TrendingUp", 4–5 topics.
   The core AI concepts this person needs to understand. Think: Prompt Engineering, RAG, Multi-Agent Systems, MCP, AI Agents, Fine-tuning, Embeddings, Context Windows — calibrated to their experience level.
   Titles: the concept name (e.g. "RAG", "MCP", "Prompt Engineering"). Descriptions: 1 sentence, what this concept IS and why it matters.

3. "apply" — label "Apply to your work", icon "Code2", 3–4 topics.
   How AI applies to their specific domain and role. Think broad application areas, not specific tools or recipes.
   Titles: 3–6 words (e.g. "AI in Software Development", "AI for Data Teams"). Descriptions: 1 sentence on impact.

Calibrate to AI experience:
  observer/beginner → well-known tools only; foundational concepts only
  emerging/intermediate → add emerging concepts (MCP, agents, multi-agent)
  practitioner/advanced → add frontier topics and domain-specific depth
  leader/expert → cutting-edge and strategic application

Titles must be SHORT — tool name or concept name only. Never "X for Y" or "Using X to do Y" or "Introduction to X".

Return JSON only — no markdown, no explanation.
Format: { "tools": [...], "concepts": [...], "apply": [...] }`,

  executive: (role, primaryDomain, subDomain, aiMaturity, learningGoal, _domainProficiency) =>
    `Generate AI learning topic recommendations for:
- Role: ${role}
- Domain: ${primaryDomain}
- Sub-domain: ${subDomain}
- AI experience: ${aiMaturity}
- Learning goal: ${learningGoal}

Return exactly 4 sections. Think from this executive's perspective — what do they need to own, decide, understand, and be fluent in?

1. "trending" — 4 topics: urgent AI developments in ${subDomain} within ${primaryDomain} that this leader must be aware of right now.
2. "decisions" — 4 topics: the specific AI decisions, governance choices, and strategic calls that a ${role} in ${primaryDomain} needs to own. Frame each as a decision they must make.
3. "how_it_works" — 5 topics: conceptual technical literacy — what a CTO would explain to a board member who asked "how does that actually work?". Frame each as understanding, not skill-building. Titles should be questions or direct insights. Descriptions (max 20 words) should make the executive feel smarter, not taught.
4. "tools" — 3 topics: the AI tools this executive should be personally fluent in — not their team's tools, theirs.

Rules:
- Frame topics at the decision-maker level — not "how to build", but "how to evaluate, govern, fund, or lead"
- Titles: max 7 words, concrete and specific
- Descriptions: one sentence, max 18 words, what they can decide or do after learning this

Return JSON only — no markdown, no explanation.
Format: { "trending": [...], "decisions": [...], "how_it_works": [...], "tools": [...] }`,

  manager: (role, primaryDomain, subDomain, aiMaturity, learningGoal, _domainProficiency) =>
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
  learningGoal: string,
  domainProficiency: string
): string {
  return USER_PROMPTS[tier](role, primaryDomain, subDomain, aiMaturity, learningGoal, domainProficiency)
}

// ─── JSON response shaping ─────────────────────────────────────────────────────

const SECTION_METADATA: Record<string, { label: string; icon: string }> = {
  trending:    { label: 'Trending in your field',    icon: 'TrendingUp' },
  skills:      { label: 'Skills to build',           icon: 'Code2'      },
  decisions:   { label: 'Decisions you need to own', icon: 'Briefcase'  },
  team:        { label: 'Enabling your team',        icon: 'Users'      },
  tools:       { label: 'AI tools to know',          icon: 'Wrench'     },
  concepts:    { label: 'Concepts to master',        icon: 'TrendingUp' },
  apply:       { label: 'Apply to your work',        icon: 'Code2'      },
  how_it_works:{ label: 'How it actually works',     icon: 'Lightbulb'  },
  fundamentals:{ label: 'Start here',                icon: 'BookOpen'   },
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
  const KNOWN_SECTION_KEYS = ['trending', 'skills', 'decisions', 'team', 'tools', 'concepts', 'apply', 'how_it_works', 'role', 'goal']
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
          (t): t is { title: string; description: string; id?: string } =>
            typeof t === 'object' &&
            t !== null &&
            typeof (t as Record<string, unknown>).title === 'string' &&
            typeof (t as Record<string, unknown>).description === 'string'
        )
        .map((t) => ({
          // Claude omits id — derive a slug from the title so the frontend has a stable key
          id: t.id ?? t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
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
  effectiveMaturity: string,
  learningGoal: string
): string {
  // v5: bump invalidates v4 entries; adds how_it_works section to executive tier
  const canonical = ['v5', tier, role, primaryDomain, subDomain, effectiveMaturity, learningGoal]
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

    const { role, primaryDomain, subDomain, learningGoal, aiMaturity, domainProficiency, roleLevel } = parsed.data

    // Derive the three-tier bucket once — used for prompt selection, fallback selection, and cache key
    const tier = getRoleTier(roleLevel)

    // Effective maturity: per-domain proficiency beats the global aiMaturity scalar.
    // This is the richer signal captured in onboarding Step 5.
    const rawMaturity = (primaryDomain && domainProficiency[primaryDomain])
      ? domainProficiency[primaryDomain]
      : aiMaturity
    const effectiveMaturity = normalizeMaturity(rawMaturity)

    // ── Cache lookup ─────────────────────────────────────────────────────────────
    const cacheKey = buildCacheKey(tier, role, primaryDomain, subDomain, effectiveMaturity, learningGoal)
    const cached = await getCachedRecommendations(cacheKey)
    if (cached) {
      console.log('[topic-rec-cache] HIT for key:', cacheKey.slice(0, 12))
      return NextResponse.json({ sections: cached, maturity: effectiveMaturity })
    }
    console.log('[topic-rec-cache] MISS — calling Claude for tier:', tier, '| maturity:', effectiveMaturity)

    // ── Mock guard (PLACEHOLDER_ key) ───────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
    if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
      console.log('[MOCK Anthropic] /api/topics/recommendations — tier:', tier, '| maturity:', effectiveMaturity)
      const mockBase = tier === 'technical' && effectiveMaturity === 'beginner'
        ? MOCK_RESPONSE_TECHNICAL_BEGINNER
        : MOCK_RESPONSES[tier]
      const advancedSections = (tier === 'technical' && effectiveMaturity === 'beginner')
        ? MOCK_RESPONSE_TECHNICAL.sections
        : undefined
      return NextResponse.json({ ...mockBase, maturity: effectiveMaturity, advancedSections })
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
      learningGoal,
      effectiveMaturity
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
      const fallbackSections = (tier === 'technical' && effectiveMaturity === 'beginner')
        ? MOCK_RESPONSE_TECHNICAL_BEGINNER.sections
        : MOCK_RESPONSES[tier].sections
      const fallbackAdvanced = (tier === 'technical' && effectiveMaturity === 'beginner')
        ? MOCK_RESPONSE_TECHNICAL.sections : undefined
      return NextResponse.json({ fallback: true, sections: fallbackSections, maturity: effectiveMaturity, advancedSections: fallbackAdvanced } as FallbackResponse)
    } finally {
      clearTimeout(timeoutId)
    }

    const result = parseClaudeResponse(rawText)
    if (!result) {
      console.error('[topics/recommendations] Failed to parse Claude JSON response')
      const fallbackSections = (tier === 'technical' && effectiveMaturity === 'beginner')
        ? MOCK_RESPONSE_TECHNICAL_BEGINNER.sections
        : MOCK_RESPONSES[tier].sections
      const fallbackAdvanced = (tier === 'technical' && effectiveMaturity === 'beginner')
        ? MOCK_RESPONSE_TECHNICAL.sections : undefined
      return NextResponse.json({ fallback: true, sections: fallbackSections, maturity: effectiveMaturity, advancedSections: fallbackAdvanced } as FallbackResponse)
    }

    // Save to cache — awaited so it completes before the cold path returns (~50ms, negligible vs 3-5s Claude)
    await saveToCache(cacheKey, tier, result.sections)

    const advancedSections = (tier === 'technical' && effectiveMaturity === 'beginner')
      ? MOCK_RESPONSE_TECHNICAL.sections : undefined
    return NextResponse.json({ ...result, maturity: effectiveMaturity, advancedSections })
  } catch (err) {
    // Unhandled errors — never let this route return 500.
    // roleLevel is unknown here (outer catch fires before Zod parse); use manager as safe default.
    console.error('[topics/recommendations] Unexpected error:', err)
    return NextResponse.json({ fallback: true, sections: MOCK_RESPONSE_MANAGER.sections } as FallbackResponse)
  }
}
