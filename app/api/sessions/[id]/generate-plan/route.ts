import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  buildInitialPlan,
  generateFirstSubtopicVisual,
  generateRemainingSubtopicVisuals,
  type SessionPlan,
} from '@/lib/session-plan'
// TemplateSection is used via session-plan functions — no direct import needed

// Allow up to 120s — first subtopic sequential (~8s) + 4 remaining in parallel (~8s)
export const maxDuration = 120

interface Params {
  params: { id: string }
}

function findSubtopicsFromCatalog(topicId: string, sessionTitle: string): string[] {
  // Inline catalog lookup to avoid circular import issues
  const catalogSubtopics: Record<string, string[]> = {
    'ai-fundamentals': [
      'What generative AI is and why this moment is strategically different',
      'The foundation model landscape: GPT, Claude, Gemini — what they share',
      'What AI can realistically do today vs. what vendors claim',
      'The three decisions every executive must make in the next 12 months',
      'How to frame AI as a capability, not a one-time project',
    ],
    'llm-basics': [
      'How language models process and generate text — no math required',
      'What "training" means and why it determines what a model knows',
      'Context windows, tokens, and why they affect your use case',
      'Open-source vs. proprietary models: the real strategic trade-off',
      'Why two models with similar names can produce very different outputs',
    ],
    'ai-strategy-intro': [
      'The four strategic postures: observe, experiment, scale, lead',
      'How to define AI ambition without overcommitting resources',
      'Aligning AI initiatives with core business outcomes',
      'What separates an AI strategy from an AI wish list',
      'What a credible 12-month AI roadmap actually looks like',
    ],
    'ml-basics': [
      'The difference between machine learning, deep learning, and AI',
      'How models learn from data and why data quality is the real bottleneck',
      'Supervised vs. unsupervised learning — which applies to your business',
      'Why ML models degrade after deployment and need ongoing maintenance',
      'Reading model performance metrics without being a data scientist',
    ],
    'ai-culture': [
      'Why most AI initiatives fail for cultural, not technical, reasons',
      'The five mindset shifts required at every level of the organization',
      'How to create psychological safety around AI experimentation',
      'Identifying and empowering your internal AI champions',
      'Building an environment where AI experiments are expected to fail fast',
    ],
    'ai-roi': [
      'The three categories of AI value: efficiency, revenue, and strategic advantage',
      'How to calculate ROI when benefits are indirect or long-term',
      'Which AI investments pay back in 90 days vs. 2 years',
      'Setting the right KPIs before you start — not after',
      'The measurement traps executives consistently fall into with AI',
    ],
    'ai-vendor-eval': [
      'The seven questions to ask every AI vendor — and the answers that matter',
      'How to evaluate vendor claims without deep technical knowledge',
      'Build vs. buy vs. partner: the executive framework for AI decisions',
      'Red flags in AI vendor proposals and how to spot them',
      'Due diligence checklist for AI procurement',
    ],
    'ai-governance': [
      'Why AI governance is now a board-level conversation',
      'The three pillars of AI governance: accountability, transparency, control',
      'How to structure an AI oversight committee that actually works',
      'Policy frameworks that balance innovation with risk management',
      'What good AI governance looks like in practice — with real examples',
    ],
    'data-strategy': [
      'Why data is the real AI competitive advantage — not the model',
      'Honestly assessing your organization\'s data readiness',
      'Data lakes vs. warehouses vs. what you actually need',
      'Data governance: who owns what and why ownership matters',
      'Building a data strategy that enables AI without becoming a data project',
    ],
    'ai-ops': [
      'The eight operational areas where AI creates the most immediate value',
      'Supply chain AI: demand forecasting, route optimization, risk detection',
      'How to identify automation candidates in your existing operations',
      'Integrating AI into operational workflows without disrupting them',
      'Measuring operational AI success beyond cost savings alone',
    ],
    'ai-cx': [
      'Where AI creates genuine customer experience improvements vs. hype',
      'The personalization paradox: why more data doesn\'t always mean better CX',
      'AI-powered service: what customers actually respond to',
      'How to avoid the "AI chatbot that frustrates everyone" outcome',
      'Measuring CX AI impact in terms your customers actually care about',
    ],
    'process-automation': [
      'Distinguishing RPA from intelligent automation from true AI',
      'The process automation opportunity matrix — where to start',
      'How to identify which processes to automate first for maximum impact',
      'Managing the workforce transition that automation creates',
      'Automation governance: when AI makes wrong decisions at scale',
    ],
    'upskilling': [
      'The AI skills gap: what it actually means for your organization',
      'The four types of AI literacy your team needs at different levels',
      'Building an AI learning culture vs. just running a training program',
      'How to evaluate AI upskilling vendors and programs critically',
      'Creating an AI mentorship and peer learning ecosystem internally',
    ],
    'change-mgmt': [
      'The three waves of AI-driven organizational change — and your timing',
      'Why AI change management differs from standard digital transformation',
      'Managing the fear and resistance that AI inevitably creates',
      'Communication strategies for AI adoption across all levels',
      'Building change capacity before you urgently need it',
    ],
    'ai-security': [
      'The new attack vectors that AI opens which didn\'t exist before',
      'Prompt injection, data poisoning, and model theft — explained simply',
      'How to evaluate AI security claims from vendors without being an expert',
      'Building AI security requirements into procurement and deployment',
      'The regulatory landscape for AI security and data privacy',
    ],
    'ai-competitive': [
      'How to track and interpret competitors\' AI investments and capabilities',
      'Building a competitive intelligence system powered by AI',
      'First-mover vs. fast-follower: which AI strategy fits your position',
      'Identifying AI-driven market disruption before it arrives at your door',
      'Translating competitive intelligence into board-level strategic decisions',
    ],
    'ai-product': [
      'How AI fundamentally changes the product development lifecycle',
      'From feature roadmaps to intelligence roadmaps — the shift in thinking',
      'AI product ethics: what to build, what to avoid, and why it matters',
      'The new product management skills required in an AI-first environment',
      'Measuring AI product success beyond engagement and retention metrics',
    ],
    'ai-teams': [
      'The new roles AI creates and the existing roles it fundamentally changes',
      'How to recruit AI talent in a market where demand exceeds supply',
      'Centralized AI center of excellence vs. distributed team model',
      'Building interdisciplinary teams where AI engineers and business leaders align',
      'Creating a culture where AI and business speak the same language',
    ],
    'ai-finance': [
      'AI applications in financial forecasting and strategic planning',
      'Fraud detection, risk modeling, and anomaly detection at enterprise scale',
      'How AI is changing the CFO role and the finance function',
      'The financial data infrastructure that AI requires to perform reliably',
      'Evaluating AI vendors specifically for finance and forecasting use cases',
    ],
    'ai-ethics': [
      'Why AI ethics is a strategic business issue, not just a PR concern',
      'Identifying and mitigating bias in AI systems before it causes harm',
      'Fairness, accountability, and transparency — practical frameworks for leaders',
      'How to build an AI ethics review process that isn\'t just a checkbox',
      'When to say no: the decisions AI should never make on its own',
    ],
    'ai-regulation': [
      'The global AI regulatory landscape and where it\'s heading',
      'EU AI Act, US Executive Orders, and what they mean for your business now',
      'Building compliance into AI development before regulators require it',
      'How to engage productively with regulators on AI policy',
      'Preparing for AI regulation that doesn\'t fully exist yet',
    ],
    'ai-trends': [
      'The AI capabilities arriving in the next 12-18 months that will matter most',
      'Multi-modal AI: what becomes possible when AI sees, hears, and reads together',
      'Agentic AI: when AI systems act autonomously on your organization\'s behalf',
      'The organizations that will define AI leadership in the next five years',
      'Separating genuine AI breakthroughs from noise — a leader\'s filter',
    ],
  }

  // Keyword-based title matching — always check the title first; topicId may be stale
  // (sessions created before the curriculum fix may have wrong topicIds like 'ai-fundamentals')
  const titleKeywordMap: Array<{ keywords: string[]; key: string }> = [
    // Longer/more specific phrases first so they match before shorter overlapping keywords
    { keywords: ['claude code', 'claude chat', 'claude cowork', 'claude feature', 'how to use claude', 'large language model', 'llm', 'language model'], key: 'llm-basics' },
    { keywords: ['machine learning', 'ml basics', 'supervised', 'unsupervised'], key: 'ml-basics' },
    { keywords: ['generative ai', 'gen ai', 'foundation model', 'gpt', 'claude', 'gemini', 'ai fundamentals', 'ai basics'], key: 'ai-fundamentals' },
    { keywords: ['ai strategy', 'ai roadmap', 'ai ambition', 'ai posture'], key: 'ai-strategy-intro' },
    { keywords: ['ai culture', 'ai mindset', 'psychological safety', 'ai champion'], key: 'ai-culture' },
    { keywords: ['ai roi', 'return on investment', 'ai value', 'ai kpi'], key: 'ai-roi' },
    { keywords: ['vendor eval', 'vendor assessment', 'ai vendor', 'build vs buy', 'procurement'], key: 'ai-vendor-eval' },
    { keywords: ['ai governance', 'ai oversight', 'ai committee'], key: 'ai-governance' },
    { keywords: ['data strategy', 'data readiness', 'data lake', 'data warehouse', 'data governance'], key: 'data-strategy' },
    { keywords: ['ai operations', 'ai ops', 'operational ai', 'supply chain ai', 'process ai'], key: 'ai-ops' },
    { keywords: ['customer experience', 'ai cx', 'personalization', 'ai chatbot', 'customer service ai'], key: 'ai-cx' },
    { keywords: ['process automation', 'rpa', 'intelligent automation', 'workflow automation'], key: 'process-automation' },
    { keywords: ['upskilling', 'ai training', 'ai literacy', 'ai learning', 'workforce ai'], key: 'upskilling' },
    { keywords: ['change management', 'change mgmt', 'ai adoption', 'ai resistance'], key: 'change-mgmt' },
    { keywords: ['ai security', 'prompt injection', 'data poisoning', 'model theft', 'ai risk'], key: 'ai-security' },
    { keywords: ['competitive intelligence', 'market disruption', 'first mover', 'fast follower'], key: 'ai-competitive' },
    { keywords: ['ai product', 'intelligence roadmap', 'ai product ethics'], key: 'ai-product' },
    { keywords: ['ai teams', 'ai talent', 'center of excellence', 'ai recruit'], key: 'ai-teams' },
    { keywords: ['ai finance', 'financial forecasting', 'fraud detection', 'finance ai'], key: 'ai-finance' },
    { keywords: ['ai ethics', 'responsible ai'], key: 'ai-ethics' },
    { keywords: ['ai regulation', 'eu ai act', 'compliance ai', 'ai policy'], key: 'ai-regulation' },
    { keywords: ['ai trends', 'future of ai', 'agentic ai', 'multi-modal', 'multimodal'], key: 'ai-trends' },
  ]

  const titleLower = sessionTitle.toLowerCase()
  for (const { keywords, key } of titleKeywordMap) {
    if (keywords.some((kw) => titleLower.includes(kw)) && catalogSubtopics[key]) {
      return catalogSubtopics[key]
    }
  }

  // Fallback: synthesize subtopics from the session title — all bullets reference the
  // actual topic so they remain distinct across multiple unmatched sessions in a plan
  const t = sessionTitle.toLowerCase()
  return [
    `Core concepts and frameworks underlying ${t}`,
    `How leading organizations are applying ${t} today`,
    `Common pitfalls and risks when adopting ${t}`,
    `Key metrics and decision points for ${t}`,
    `Your immediate action plan: first steps with ${t}`,
  ]
}

/**
 * POST /api/sessions/[id]/generate-plan
 * Directly generates visual specs for all session subtopics.
 * Generates the first subtopic first (enabling the launch button immediately),
 * then generates the rest in parallel within the same request.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const [{ data: session }, { data: userRow }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, session_title, topic_id, session_plan, subtopics')
      .eq('id', params.id)
      .eq('user_id', userId!)
      .single(),
    supabase
      .from('users')
      .select('role, industry, ai_maturity')
      .eq('id', userId!)
      .single(),
  ])

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Already fully ready — nothing to do
  if (session.session_plan?.plan_status === 'ready') {
    return NextResponse.json({ ok: true, status: 'already_ready' })
  }

  const topicId = session.topic_id ?? ''
  const topicTitle = session.session_title ?? ''
  // Prefer LLM-designed subtopics from the session designer (stored at approval time).
  // Fall back to hardcoded catalog only for sessions created before FB-005.
  const designedSubtopics = Array.isArray(session.subtopics) && session.subtopics.length > 0
    ? (session.subtopics as Array<{ title: string }>).map((s) => s.title)
    : null
  const subtopics = designedSubtopics ?? findSubtopicsFromCatalog(topicId, topicTitle)
  const userProfile = userRow ?? {}

  // Write generating state immediately so UI shows progress
  const initialPlan = buildInitialPlan(topicId, topicTitle, subtopics)
  await supabase
    .from('sessions')
    .update({ session_plan: initialPlan })
    .eq('id', params.id)

  try {
    // Generate first subtopic visual (enables launch button as soon as this completes)
    const subtopicsAfterFirst = await generateFirstSubtopicVisual(subtopics, userProfile, topicTitle, topicId)

    const partialPlan: SessionPlan = {
      topic_id: topicId,
      topic_title: topicTitle,
      subtopics: subtopicsAfterFirst,
      plan_status: 'partial',
      generated_at: new Date().toISOString(),
    }

    // Persist partial plan — launch button becomes enabled from here
    await supabase
      .from('sessions')
      .update({ session_plan: partialPlan })
      .eq('id', params.id)

    // Generate remaining subtopics in parallel (within maxDuration window)
    const allSubtopics = await generateRemainingSubtopicVisuals(subtopicsAfterFirst, userProfile, topicTitle, topicId)
    const allReady = allSubtopics.every((s) => s.visual_status === 'ready')

    const completePlan: SessionPlan = {
      topic_id: topicId,
      topic_title: topicTitle,
      subtopics: allSubtopics,
      plan_status: allReady ? 'ready' : 'partial',
      generated_at: new Date().toISOString(),
    }

    await supabase
      .from('sessions')
      .update({ session_plan: completePlan })
      .eq('id', params.id)

    return NextResponse.json({ ok: true, status: completePlan.plan_status })
  } catch (err) {
    console.error('[generate-plan] Visual generation failed:', err)
    // Write failed status so UI stops spinning and shows retry option
    const failedPlan: SessionPlan = {
      topic_id: topicId,
      topic_title: topicTitle,
      subtopics: initialPlan.subtopics.map((s) => ({ ...s, visual_status: 'failed' as const })),
      plan_status: 'failed',
      generated_at: new Date().toISOString(),
    }
    await supabase
      .from('sessions')
      .update({ session_plan: failedPlan })
      .eq('id', params.id)
    return NextResponse.json({ error: 'Visual generation failed' }, { status: 500 })
  }
}

/**
 * PATCH /api/sessions/[id]/generate-plan
 * Toggles skipped state for a single subtopic.
 * Body: { subtopicId: string; skipped: boolean }
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const body = await request.json() as { subtopicId?: string; skipped?: boolean }
  if (typeof body.subtopicId !== 'string' || typeof body.skipped !== 'boolean') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('session_plan')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session?.session_plan) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const plan = session.session_plan as SessionPlan
  const updatedPlan: SessionPlan = {
    ...plan,
    subtopics: plan.subtopics.map((s) =>
      s.id === body.subtopicId ? { ...s, skipped: body.skipped } : s
    ),
  }

  await supabase
    .from('sessions')
    .update({ session_plan: updatedPlan })
    .eq('id', params.id)

  return NextResponse.json({ ok: true })
}

/**
 * GET /api/sessions/[id]/generate-plan
 * Returns the current session_plan for polling.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('session_plan')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  return NextResponse.json({ session_plan: session.session_plan ?? null })
}
