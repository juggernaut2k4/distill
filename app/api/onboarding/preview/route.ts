import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'

const PreviewSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  industry: z.string().default(''),
  aiMaturity: z.string().default('intermediate'),
  worry: z.string().default(''),
})

export type PreviewRequest = z.infer<typeof PreviewSchema>

export interface PreviewResponse {
  bodyText: string
  type: 'tip' | 'signal' | 'decoder'
}

// ─── Mock message library ──────────────────────────────────────────────────────
// Keyed by `role:industry` (lowercase, partial match). Falls back to generic.

interface MockEntry {
  roleKey: string
  industryKey: string
  bodyText: string
  type: 'tip' | 'signal' | 'decoder'
}

const MOCK_MESSAGES: MockEntry[] = [
  {
    roleKey: 'ceo',
    industryKey: 'tech',
    bodyText:
      "Microsoft's AI investments returned 3.5x productivity gains in legal and HR within 18 months — not from replacing headcount, but from augmenting senior analysts. The winning play: identify your highest-cost knowledge workers and run one contained pilot. So what? Your next board AI question shouldn't be 'should we?' — it should be 'which function first?'",
    type: 'signal',
  },
  {
    roleKey: 'vp',
    industryKey: 'financial',
    bodyText:
      "JPMorgan processes 12,000 commercial credit agreements per year. AI now handles 360,000 hours of that work annually. The model wasn't built internally — it was licensed. So what? If your team is still building AI from scratch, ask your next vendor whether they offer licensed foundation model access instead.",
    type: 'signal',
  },
  {
    roleKey: 'consulting',
    industryKey: 'consulting',
    bodyText:
      "McKinsey's AI readiness framework has one leading indicator above all others: whether the organisation has clean, labelled historical data. Not GPU spend. Not talent. Data. So what? Before approving any AI pilot budget, ask your team to show you the training dataset first.",
    type: 'decoder',
  },
  {
    roleKey: 'ceo',
    industryKey: 'health',
    bodyText:
      "Epic's AI ambient documentation reduced physician note time by 47 minutes per day per doctor at Oregon Health. The ROI case was not efficiency — it was burnout prevention and retention. So what? Frame your next AI investment to your board as a talent retention play, not a cost-cut.",
    type: 'signal',
  },
  {
    roleKey: 'vp',
    industryKey: 'retail',
    bodyText:
      "Zara runs AI demand forecasting across 450 product lines with a 2-week replenishment cycle. Their model doesn't predict trends — it reacts to them 14 days faster than competitors. So what? The competitive advantage is not the AI — it's the supply chain agility it unlocks. That's your real investment thesis.",
    type: 'signal',
  },
  {
    roleKey: 'director',
    industryKey: 'manufactur',
    bodyText:
      "Siemens reduced unplanned downtime by 20% using predictive maintenance AI on legacy equipment — not new machines. They retrofitted sensors to 30-year-old assets. So what? You don't need to replace your plant floor to capture AI value. Start with sensors on your three highest-failure assets.",
    type: 'tip',
  },
  // Generic fallbacks by role level
  {
    roleKey: 'ceo',
    industryKey: '',
    bodyText:
      "Boards are starting to ask CEOs about AI strategy as routinely as they ask about cybersecurity. Companies with a documented AI policy report 40% fewer vendor selection missteps. So what? A two-page AI decision framework — what you will pilot, what you won't, and who decides — is now a board-table asset.",
    type: 'tip',
  },
  {
    roleKey: 'vp',
    industryKey: '',
    bodyText:
      "Gartner found that 67% of enterprise AI pilots fail to reach production — not because the model is wrong, but because the handoff to operations is broken. The fix isn't better AI. It's clearer ownership. So what? Every AI pilot you sponsor should name the operational owner before the first line of code is written.",
    type: 'tip',
  },
  {
    roleKey: 'director',
    industryKey: '',
    bodyText:
      "AI tools that augment individual contributors show 3x higher adoption than tools that 'automate' tasks. Workers adopt what helps them, resist what threatens them. So what? Reframe every AI initiative you manage as 'making your team faster' — the pilot success rate will follow.",
    type: 'decoder',
  },
  {
    roleKey: '',
    industryKey: '',
    bodyText:
      "The #1 reason AI investments underperform: executives approved the technology but not the change management. The model works; the organisation doesn't adopt it. So what? Before your next AI greenlight, ask who owns the people side — and make sure they have a real budget.",
    type: 'tip',
  },
]

/**
 * Picks the best mock message given the user's role and industry.
 * Scores by partial string match — higher score wins.
 */
function pickMockMessage(role: string, industry: string): MockEntry {
  const roleLower = role.toLowerCase()
  const industryLower = industry.toLowerCase()

  let best = MOCK_MESSAGES[MOCK_MESSAGES.length - 1]
  let bestScore = -1

  for (const entry of MOCK_MESSAGES) {
    let score = 0
    if (entry.roleKey && roleLower.includes(entry.roleKey)) score += 3
    if (entry.industryKey && industryLower.includes(entry.industryKey)) score += 3
    if (entry.roleKey === '' && entry.industryKey === '') score = 0 // generic fallback

    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  return best
}

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER_')

/**
 * POST /api/onboarding/preview
 * Generates a personalized content preview message based on the user's onboarding answers.
 * Returns a real Claude-generated insight when ANTHROPIC_API_KEY is set,
 * or a curated mock message when the key is a placeholder.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = PreviewSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { role, industry, aiMaturity, worry } = parsed.data

    // ── Mock path ────────────────────────────────────────────────────────────
    if (isPlaceholder) {
      const mock = pickMockMessage(role, industry)
      return NextResponse.json<PreviewResponse>({
        bodyText: mock.bodyText,
        type: mock.type,
      })
    }

    // ── Live Claude path ──────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const systemPrompt = `You are Clio, a sharp AI advisor for senior business executives. Write like a trusted peer who has already done the research. No jargon. No filler phrases. No "As an AI..." hedging. Every sentence must be either actionable or genuinely illuminating. Maximum 60 words. Always end with exactly one sentence starting with "So what?" — make it specific to their role and situation. Return only the insight text, nothing else.`

    const userPrompt = `Write ONE insight for a ${role || 'senior executive'}${industry ? ` in ${industry}` : ''}${worry ? `, concerned about ${worry}` : ''}${aiMaturity ? ` (AI maturity: ${aiMaturity})` : ''}. Maximum 60 words. End with a "So what?" sentence.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rawText =
      response.content[0].type === 'text' ? response.content[0].text.trim() : ''

    // Classify content type from the text heuristically
    const lower = rawText.toLowerCase()
    const type: PreviewResponse['type'] = lower.includes('what is') || lower.includes('means')
      ? 'decoder'
      : lower.includes('%') || lower.includes('report') || lower.includes('found')
      ? 'signal'
      : 'tip'

    return NextResponse.json<PreviewResponse>({ bodyText: rawText, type })
  } catch (err) {
    console.error('[onboarding/preview] Error:', err)
    // Fallback to a generic mock on any error — never break the onboarding flow
    return NextResponse.json<PreviewResponse>({
      bodyText:
        "The #1 reason AI investments underperform: executives approved the technology but not the change management. The model works; the organisation doesn't adopt it. So what? Before your next AI greenlight, ask who owns the people side — and make sure they have a real budget.",
      type: 'tip',
    })
  }
}
