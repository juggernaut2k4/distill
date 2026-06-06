import Anthropic from '@anthropic-ai/sdk'
import type { CurriculumSpec, CurriculumResult, CurriculumSession } from './types'

const SYSTEM_PROMPT = `You are a curriculum designer for executive education. You create personalized learning curriculums for senior business leaders.

Given a curriculum specification, generate a precise list of learning sessions.

RULES:
1. Each session title must be 5-10 words, specific and concrete (not generic)
2. If productName is set: sessions with type 'product-*' must explicitly name that product in the title
3. Industry context must appear in at least 2 session titles (e.g. "for Financial Services", "for FS Executives")
4. Role context must appear in at least 1 session title
5. Each session has a 1-sentence justification: WHY is this in the curriculum for THIS specific user? Be specific — reference their role and industry.
6. Generate exactly totalTarget sessions
7. Arc sequence MUST be: foundation → interest → context → deploy → govern. Never reorder.
8. estimated_minutes: 20-30 per session (25 is typical)
9. Tier 4: suggest 3-4 follow-on topics that unlock after the main curriculum
10. Seniority framing: when role_level is 'vp-dir', sessions must be framed for a function leader, not a C-Suite executive. The justification must reference managing upward to C-Suite and enabling their team — not board accountability or P&L ownership. When role_level is 'c-suite', use board and strategy framing. When role_level is 'manager', use team implementation framing.

Return ONLY valid JSON matching this schema exactly:
{
  "sessions": [
    { "position": 1, "title": "string", "arc_position": "foundation|interest|context|deploy|govern", "justification": "string", "estimated_minutes": 25 }
  ],
  "tier4": [
    { "title": "string", "unlocks_after": 7 }
  ]
}`

/**
 * Hard-coded mock output for CEO · Financial Services · Claude · beginner.
 * Used when ANTHROPIC_API_KEY is a placeholder/missing.
 */
const CEO_FS_CLAUDE_MOCK: Pick<CurriculumResult, 'sessions' | 'tier4'> = {
  sessions: [
    {
      position: 1,
      title: 'Generative AI Fundamentals for Executives',
      arc_position: 'foundation',
      justification:
        'As a CEO in Financial Services, you need a solid baseline in how generative AI works before evaluating Claude or any AI investment.',
      estimated_minutes: 25,
    },
    {
      position: 2,
      title: 'How LLMs Work: A CEO Primer',
      arc_position: 'foundation',
      justification:
        'Large language models underpin Claude and every AI tool you will assess — this session gives you the literacy to ask the right questions.',
      estimated_minutes: 25,
    },
    {
      position: 3,
      title: 'AI Strategy Framing for New Executives',
      arc_position: 'foundation',
      justification:
        'As a beginner CEO, strategic framing ensures you invest in AI with clear business intent rather than chasing hype.',
      estimated_minutes: 25,
    },
    {
      position: 4,
      title: "Claude Capabilities Overview for Business Leaders",
      arc_position: 'interest',
      justification:
        'You asked about Claude specifically — this session covers what Claude can and cannot do so you can evaluate its fit for your FS organisation.',
      estimated_minutes: 25,
    },
    {
      position: 5,
      title: 'Claude Use Cases in Financial Services',
      arc_position: 'interest',
      justification:
        'Understanding how peers in Financial Services deploy Claude narrows the gap between capability and real-world application for your firm.',
      estimated_minutes: 25,
    },
    {
      position: 6,
      title: 'Claude vs Competitors: FS Executive Comparison',
      arc_position: 'context',
      justification:
        'A CEO in Financial Services must make vendor decisions with full market context — this session benchmarks Claude against its main alternatives.',
      estimated_minutes: 25,
    },
    {
      position: 7,
      title: 'AI Landscape in Financial Services 2025',
      arc_position: 'context',
      justification:
        'The broader FS AI landscape sets the competitive and regulatory context for any Claude deployment decision you make as CEO.',
      estimated_minutes: 25,
    },
    {
      position: 8,
      title: 'Deploying Claude at CEO Scale',
      arc_position: 'deploy',
      justification:
        'Moving from evaluation to deployment requires executive sponsorship decisions — this session covers rollout, change management, and success metrics for your role.',
      estimated_minutes: 25,
    },
    {
      position: 9,
      title: 'AI Security & Model Risk for FS Boards',
      arc_position: 'govern',
      justification:
        'FCA and SEC requirements make security and model risk governance non-negotiable for any AI deployment in your Financial Services firm.',
      estimated_minutes: 25,
    },
    {
      position: 10,
      title: 'AI Governance & ROI: FS Board Accountability',
      arc_position: 'govern',
      justification:
        'Board accountability for AI decisions is an FCA and investor expectation — this session equips you to lead that conversation.',
      estimated_minutes: 25,
    },
  ],
  tier4: [
    { title: 'Advanced Claude API Integration for Enterprise', unlocks_after: 7 },
    { title: 'AI Procurement & Contract Negotiation in FS', unlocks_after: 8 },
    { title: 'Building an Internal AI Centre of Excellence', unlocks_after: 9 },
    { title: 'FCA AI Regulatory Horizon Scanning', unlocks_after: 10 },
  ],
}

/**
 * Builds the user message from a CurriculumSpec.
 */
function buildUserMessage(spec: CurriculumSpec, validationErrors?: string[]): string {
  const errorContext =
    validationErrors && validationErrors.length > 0
      ? `\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Fix these issues:\n${validationErrors.map((e) => `- ${e}`).join('\n')}\n`
      : ''

  return `Generate a curriculum for:
Role: ${spec.role}
Role Level: ${spec.roleLevel}
Industry: ${spec.industry}
Maturity: ${spec.maturity}
Interest: ${spec.interest}
Named product: ${spec.isNamedProduct ? spec.productName : 'None'}

Curriculum structure to generate (${spec.totalTarget} sessions total):

FOUNDATION (${spec.requiredFoundation.length} sessions):
${spec.requiredFoundation.map((i) => `- Type: ${i.type} | Reason: ${i.reason}`).join('\n')}

INTEREST (${spec.requiredInterest.length} sessions):
${spec.requiredInterest.map((i) => `- Type: ${i.type} | Product: ${i.product ?? 'n/a'} | Reason: ${i.reason}`).join('\n')}

CONTEXT (${spec.requiredContext.length} sessions):
${spec.requiredContext.map((i) => `- Type: ${i.type} | Reason: ${i.reason}`).join('\n')}

DEPLOY (${spec.requiredDeploy.length} sessions):
${spec.requiredDeploy.map((i) => `- Type: ${i.type} | Product: ${i.product ?? 'n/a'} | Reason: ${i.reason}`).join('\n')}

GOVERN (${spec.requiredGovern.length} sessions):
${spec.requiredGovern.map((i) => `- Type: ${i.type} | Industry: ${i.industry ?? 'n/a'} | Reason: ${i.reason}`).join('\n')}${errorContext}`
}

/**
 * Parses raw JSON text from Claude, stripping markdown code fences if present.
 */
function parseClaudeJson(text: string): Pick<CurriculumResult, 'sessions' | 'tier4'> {
  const clean = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  const data = JSON.parse(clean) as {
    sessions?: unknown
    tier4?: unknown
  }

  if (!Array.isArray(data.sessions)) {
    throw new Error('Response missing sessions array')
  }

  const sessions = data.sessions as CurriculumSession[]
  const tier4 = Array.isArray(data.tier4)
    ? (data.tier4 as Array<{ title: string; unlocks_after: number }>)
    : []

  return { sessions, tier4 }
}

/**
 * Makes a single Claude API call to generate a curriculum from a CurriculumSpec.
 * Falls back to a hardcoded mock when ANTHROPIC_API_KEY is a placeholder.
 */
export async function generateCurriculum(
  spec: CurriculumSpec,
  validationErrors?: string[]
): Promise<Pick<CurriculumResult, 'sessions' | 'tier4'>> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  const isPlaceholder = !apiKey || apiKey.startsWith('PLACEHOLDER_')

  if (isPlaceholder) {
    console.log('[curriculum/specialist] ANTHROPIC_API_KEY is a placeholder — returning mock data')
    return CEO_FS_CLAUDE_MOCK
  }

  const anthropic = new Anthropic({ apiKey })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildUserMessage(spec, validationErrors),
      },
    ],
  })

  const text =
    response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''

  return parseClaudeJson(text)
}
