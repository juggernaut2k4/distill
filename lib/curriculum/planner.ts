import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { createHash } from 'crypto'
import { buildCurriculum } from '@/lib/content/curriculum'
import { enrichCurriculumPlan, applyEnrichmentVisibility } from './enrichment'
import type { EnrichedPlan, RawLlmOutput } from './types'

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const SessionSchema = z.object({
  session_id: z.string().min(1).max(128),
  title: z.string().min(3).max(200),
  focus: z.string().min(10).max(1000),
  arc_position: z.number().int().min(1),
  arc_length: z.number().int().min(1),
  depth_level: z.enum(['beginner', 'intermediate', 'advanced']),
  role_hint: z.string().min(5).max(1000),
  subtopics: z.array(z.string().min(3).max(1000)).min(1).max(30),
  is_visible: z.boolean(),
  queue_rationale: z.string().max(2000).nullable(),
})

// ArcSchema v2 — comprehensive_subtopics replaces sessions[].
// SessionSchema (below) is retained for generateQueueExtension only.
export const ArcSchema = z.object({
  arc_name:                z.string().min(1).max(100),
  arc_type:                z.enum(['domain', 'integrated', 'singleton']),
  arc_description:         z.string().min(10).max(1000),
  comprehensive_subtopics: z.array(z.string().min(3).max(1000)).min(1).max(100),
  is_visible:              z.boolean(),
  queue_rationale:         z.string().max(2000).nullable(),
})

export const CurriculumOutputSchema = z.object({
  arcs:              z.array(ArcSchema).min(1).max(10),
  total_visible:     z.number().int().min(0).max(10),   // count of visible arcs
  total_queued:      z.number().int().min(0).max(50),   // count of queued arcs
  generated_at:      z.string(),
  user_profile_hash: z.string().optional().default(''),
  schema_version:    z.literal('v2').default('v2'),
})

export type Session = z.infer<typeof SessionSchema> & { estimated_minutes: number }
export type Arc = z.infer<typeof ArcSchema>
export type CurriculumOutput = z.infer<typeof CurriculumOutputSchema>

// ─── Maturity normalisation ───────────────────────────────────────────────────

/**
 * Normalises ai_maturity to a canonical depth level.
 * Two vocabularies are in use:
 *   New (onboarding 2026-06): observer | emerging | practitioner | leader
 *   Old (legacy):             beginner | intermediate | advanced | expert
 *                             + legacy free-text: 'no experience', 'some experience', 'somewhat experience'
 * Both vocabularies map to the same four canonical values.
 * Exported so buildProfileHash and tests can call it independently.
 */
export function normaliseMaturity(maturity: string): 'beginner' | 'intermediate' | 'advanced' | 'expert' {
  switch (maturity.toLowerCase().trim()) {
    case 'observer':
    case 'beginner':
    case 'no experience':        return 'beginner'
    case 'emerging':
    case 'intermediate':
    case 'some experience':
    case 'somewhat experience':  return 'intermediate'
    case 'practitioner':
    case 'advanced':             return 'advanced'
    case 'leader':
    case 'expert':               return 'expert'
    default:                     return 'intermediate'  // safe default for unknown values
  }
}

// ─── Profile hash ─────────────────────────────────────────────────────────────

/**
 * Produces a 16-char hex cache key for a user's curriculum profile.
 * Uses normalised maturity so 'observer' and 'beginner' share the same key.
 * roleLevel is included so a VP and a C-Suite with the same role+topics get distinct plans.
 */
export function buildProfileHash(role: string, maturity: string, topics: string[], roleLevel: string): string {
  const normMaturity = normaliseMaturity(maturity)
  const sorted = [...topics].sort().join(',')
  return createHash('sha256').update(`${role}::${roleLevel}::${normMaturity}::${sorted}`).digest('hex').slice(0, 16)
}

// ─── Tier limits ──────────────────────────────────────────────────────────────

function getTierLimits(planTier: string | null): { visible: number; queue: number } {
  switch (planTier) {
    case 'pro':
    case 'executive': return { visible: 10, queue: 50 }
    default: return { visible: 5, queue: 10 } // starter (no free tier)
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  role: string,
  industry: string,
  maturity: string,
  worry: string,
  topics: string[],
  visibleLimit: number,
  queueLimit: number,
  roleLevel: string,
): string {
  /**
   * Normalise ai_maturity to a canonical depth level.
   * Two vocabularies:
   *   New (onboarding 2026-06): observer | emerging | practitioner | leader
   *   Old (legacy):             beginner | intermediate | advanced | expert
   *                             + legacy free-text: 'no experience', 'some experience', 'somewhat experience'
   * Both map to: beginner | intermediate | advanced | expert
   *
   * Note: 'practitioner' and 'leader' both resolve to depthCap 'advanced' (the schema's max).
   * The difference is expressed as a PROMPT INSTRUCTION, not a schema value.
   */
  const normalisedMaturity = normaliseMaturity(maturity)

  const depthCap = (() => {
    switch (normalisedMaturity) {
      case 'beginner':     return 'intermediate'
      case 'intermediate': return 'advanced'
      case 'advanced':     return 'advanced'
      case 'expert':       return 'advanced'
      default:             return 'advanced'
    }
  })()

  const roleLevelLabel: Record<string, string> = {
    'c-suite':        'Executive / C-Suite (owns P&L, accountable to board)',
    'vp-dir':         'VP / Director (leads a function, reports to C-Suite, accountable for team outcomes)',
    'vp-technology':  'VP of Technology (owns engineering team adoption, technical infrastructure decisions, and AI vendor evaluation)',
    'vp-product':     'VP of Product (owns AI feature strategy, model integration in product, and competitive differentiation through AI)',
    'manager':        'Manager / Team Lead (manages a team, executes strategy set above them)',
    'specialist':     'Specialist / Individual Contributor (expert practitioner)',
  }

  const roleLevelInstruction: Record<string, string> = {
    'c-suite':       'Frame all content for a leader who approves budgets, sponsors AI initiatives, and answers to the board. Examples must involve strategic decisions, not implementation choices.',
    'vp-dir':        'Frame all content for a function leader who owns team adoption and reports outcomes to the C-Suite. Examples must involve managing upward (presenting to executives) and downward (enabling their team). Do NOT use board-level or P&L-authority framing.',
    'vp-technology': 'Frame all content for a VP of Technology who owns engineering team adoption, infrastructure decisions, and technical risk. Examples must involve: API procurement vs SaaS tradeoffs, security architecture for AI systems, how to evaluate model quality for production use cases, and how to present build-vs-buy recommendations upward to the CTO or CFO. Do NOT use board-level P&L framing. Do NOT use product roadmap or feature prioritisation framing.',
    'vp-product':    'Frame all content for a VP of Product who owns AI-assisted feature strategy, model integration in the product, and competitive differentiation through AI capability. Examples must involve: when to use AI in the product vs when it is over-engineering, how to frame AI features for users without technical backgrounds, managing model latency and cost as product constraints, and presenting AI roadmap trade-offs to engineering and leadership. Do NOT use infrastructure or procurement framing. Do NOT use board-level P&L framing.',
    'manager':       'Frame all content for a team lead implementing AI tools day-to-day. Examples should be hands-on and practical. Avoid board-level or C-Suite strategic framing.',
    'specialist':    'Frame all content for a practitioner who uses AI tools directly. Examples should be technical and applied.',
  }

  const maturityFramingInstruction = normalisedMaturity === 'expert'
    ? '- Frame content as peer-level: Claude is speaking to someone who already understands AI mechanisms. Skip introductory analogies. Focus on edge cases, failure modes, nuanced tradeoffs, and decisions at the frontier of AI deployment. Use first-person plural: "When we\'re evaluating model risk at this scale..."'
    : normalisedMaturity === 'advanced'
    ? '- Frame content for a practitioner who has hands-on AI experience: strategic depth, real tradeoffs, and implementation decisions are appropriate. Minimal introductory context needed.'
    : normalisedMaturity === 'intermediate'
    ? '- Frame content with practical focus: explain mechanisms briefly, then move quickly to application and decisions. Some analogies are helpful; avoid deep technical theory.'
    : '- Frame content with maximum accessibility: generous analogies, concrete examples before abstract concepts, explicit "why this matters" for each idea. Never assume prior AI knowledge.'

  // Role-adaptive learner label — used in the opening sentence and singleton rule
  // so the LLM never defaults to "executives" framing for ICs or managers.
  const learnerLabel: Record<string, string> = {
    'c-suite':       'senior business executives',
    'vp-dir':        'senior functional leaders',
    'vp-technology': 'technology leaders',
    'vp-product':    'product leaders',
    'manager':       'managers and team leads',
    'specialist':    'individual contributors and specialist practitioners',
  }
  const audienceLabel = learnerLabel[roleLevel] ?? 'working professionals'

  // For singleton Rule 5, the session 1 title needs a short audience word
  const singletonAudienceWord: Record<string, string> = {
    'c-suite':       'Executives',
    'vp-dir':        'Leaders',
    'vp-technology': 'Tech Leaders',
    'vp-product':    'Product Leaders',
    'manager':       'Managers',
    'specialist':    'Practitioners',
  }
  const audienceWord = singletonAudienceWord[roleLevel] ?? 'Professionals'

  return `You are an expert learning curriculum designer for ${audienceLabel}.

Your task: design a personalised learning curriculum in JSON format based on the user's profile and topic selections.

USER PROFILE:
- Role: ${role}
- Industry: ${industry}
- AI maturity: ${maturity}
- Biggest AI worry: ${worry || 'not specified'}
- Selected topics: ${topics.join(', ')}
- Seniority level: ${roleLevelLabel[roleLevel] ?? roleLevel}
${roleLevelInstruction[roleLevel] ?? ''}

CURRICULUM REQUIREMENTS:
- Visible plan sessions: up to ${visibleLimit} sessions total. IMPORTANT: each selected topic MUST have a minimum of 3 sessions covering (1) foundation, (2) core concept/mechanism, (3) practical application for their role. Additional sessions (advanced, synthesis, cross-topic) are encouraged up to the visible limit. Never generate fewer than 3 sessions for any selected topic.
- Shadow queue sessions: generate as many as genuinely add value — do not fill slots for the sake of it, but do not artificially limit yourself either. The cap is ${queueLimit}${queueLimit === 0 ? ' (this tier has no queue — skip queue sessions entirely)' : ', but quality determines count, not the cap. A queue of 8 deeply relevant sessions is better than 40 generic ones.'}
- Total arcs: 1 to 10

ARC CLASSIFICATION RULES (strictly follow these):

Rule 1 — Domain/strategy topics → arc_type: "domain" (separate arc, 3-5 sessions deep)
Topics about governance, ethics, policy, risk, regulatory frameworks get their own arc.
Examples: AI Governance, AI Ethics, AI Regulation, AI Strategy, AI Competitive Intelligence

Rule 2 — Tool/product topics → arc_type: "integrated" (woven together)
Topics about specific tools or workflows are woven into a single coherent arc.
Examples: Claude for Work + ChatGPT → "AI Tools for Executive Work" arc
If only 1 tool topic is selected, make it singleton if it stands alone.

Rule 3 — Process/workflow topics → conditional
If 2+ process topics overlap the same functional area, integrate them.
If 1 standalone process topic, it gets its own arc.

Rule 4 — Foundational topics (Generative AI Fundamentals, How LLMs Work, ML Basics)
Only include as the first arc for users with maturity "beginner" or "no experience".
For intermediate+ users, skip these unless explicitly selected.

Rule 5 — Singleton handling
If the user selects only 1 topic, arc_type is "singleton". A singleton topic typically needs a
broader comprehensive_subtopics list than a topic sharing an arc with others — on the order of
20-35 sub-topics — to earn its place as the user's sole focus. Cover introduction, core mechanism,
practical application, advanced considerations, and next steps within that sub-topic list. Session
count and titles are computed automatically downstream from the sub-topic list; do not propose
session numbers, titles, or minute ranges here.

INTELLIGENT SESSION PRIORITISATION (replaces mechanical topological fill):

You must reason like a senior curriculum expert — not apply a formula. Work through these steps before assigning is_visible:

STEP 1 — Topic-level priority weights:
For each selected topic, privately score its urgency for THIS user (consider their role, industry, worry, and maturity):
- Which topic is most immediately applicable to their day-to-day pressure?
- Which topic is more foundational — i.e., understanding it unlocks the others?
- Which topic addresses their stated worry most directly?
Higher-priority topics earn more visible slots. Topics do NOT split visible slots equally by default.

STEP 2 — Session-level priority within each topic:
Rank every session within each arc by learning value for this specific user:
- Early arc positions (1–2): Foundational — almost always visible
- Mid arc positions (3–4): Practical application — visible if topic priority is high
- Late arc positions (5+): Advanced or capstone — often queued unless topic is critical
- Breadth expansion sessions (adjacent topics not selected): Always queue

STEP 3 — Cross-arc interleaving:
After scoring all sessions across all arcs, sort them globally by priority. Do NOT exhaust one arc before starting another. A good plan for 2 topics typically looks like:
  → Foundation of Topic A
  → Foundation of Topic B
  → Core practice of Topic A
  → Core practice of Topic B
  → Advanced Topic A (if still within visible limit)
  → Advanced Topic B (if still within visible limit)
The exact interleave depends on the priority scores from Steps 1–2.

STEP 4 — Assign is_visible:
- The top ${visibleLimit} sessions by priority across all arcs: is_visible = true
- All remaining sessions: is_visible = false
- Hard rule: at least 1 session from EACH selected topic must be is_visible: true, even if that topic has lower priority

STEP 5 — Queue ordering and rationale:
Order queue sessions from most likely to be unlocked next to furthest away.
For each queued session, write a queue_rationale that answers:
- Why is this session queued rather than visible?
- What specific milestone or question from the user should surface it?
- What unique value does it add beyond what the visible sessions cover?
Breadth expansion sessions (topics not selected) are always is_visible: false.

STEP 6 — Education specialist curriculum review (breadth expansion):
After completing all arcs for the selected topics, pause and act as a senior education specialist reviewing this learner's full journey.

Ask yourself:
- What gaps exist in their understanding that the selected topics don't cover?
- What adjacent skills or knowledge would make the visible sessions 2× more useful?
- What topics are commonly needed by a ${role} in ${industry} that this person hasn't selected but would benefit from?
- What would a great executive coach add to this curriculum that the learner didn't know to ask for?

Generate additional queue sessions only for topics that genuinely belong in this person's learning journey. Do not pad.
Each breadth expansion session must:
- Address a real gap or adjacent need specific to this user's role, industry, and worry
- Have a clear reason why it belongs alongside the selected topics
- Be ordered in the queue by how soon the learner will need it (earliest need first)

Aim for at least 1-3 genuinely relevant breadth-expansion topics per plan when this user's role,
industry, and worry profile suggests real adjacent gaps. Never pad — skip entirely only if nothing
genuinely earns a place.

DEPTH RULES:
- NEVER assign depth_level "advanced" to a user with maturity "${maturity}" if the computed depth cap is "${depthCap}".
- ${depthCap === 'intermediate' ? 'All sessions must be "beginner" or "intermediate" depth only.' : 'Sessions may reach "advanced" depth from session 3+ within an arc.'}
- Match session depth to the user's role: a CFO getting AI governance content needs board-level framing, not technical implementation details.
- Maturity framing: this user's AI maturity normalises to "${normalisedMaturity}".
${maturityFramingInstruction}

ROLE HINT RULES:
- role_hint is a private instruction for the content generator — NOT shown to the user.
- Write it as a specific instruction: "Frame this as [specific angle] for a ${role} in ${industry}."
- Focus on the user's ${worry ? `stated worry: "${worry}"` : 'professional context'}.

ARC SUBTOPICS:
For each arc, generate a COMPREHENSIVE list of ALL sub-topics the learner needs to understand
this arc completely. Do NOT divide sub-topics by session — session division happens automatically
after you respond. Do NOT cap, limit, or pad the sub-topic count artificially.

Every sub-topic that earns its place must appear. A sub-topic earns its place if skipping it
would leave the learner with a gap in their understanding of this arc.

Typical arc subtopic counts:
- A focused, single-concept arc: 8–12 sub-topics
- A broad, multi-concept arc: 20–35 sub-topics
There is no required count. Coverage completeness is the only criterion.

SUBTOPIC ORDERING within each arc:
Order sub-topics from most foundational to most advanced so the learner can follow them
in sequence without back-referencing. Follow this structure:

1. Context anchor (always first): why this arc matters specifically to this user's role.
   Do NOT open with a definition or the arc name. Open with: "Here is the decision or
   pressure you face right now as a [role] that makes this arc immediately relevant."
   Connect to something the user already knows or a situation they currently face.

2. Core concepts (middle sub-topics): one concept per sub-topic, in dependency order.
   Each sub-topic should assume the previous one is understood. Earlier sub-topics unlock later ones.

3. Practical action (always last): one specific thing the user can do or decide differently
   after completing this arc. Name it explicitly. Connect it to their role and industry.

SUBTOPIC FORMAT:
Write each sub-topic as a specific, concrete learning point — not a vague category name.
Bad:  "Overview of Claude"
Good: "How to choose between claude-haiku-4-5 and claude-sonnet-4-6 based on latency and cost requirements for your team's production use case"

Do NOT pad with sub-topics that are not genuinely needed. Every sub-topic must earn its place.

IMPORTANT CONSTRAINTS:
- total_visible must exactly equal the count of arcs where is_visible is true
- total_queued must exactly equal the count of arcs where is_visible is false
- queue_rationale must be null for is_visible: true arcs
- queue_rationale must be a non-empty string for is_visible: false arcs
- schema_version must always be "v2"

Return ONLY valid JSON matching this TypeScript type. No explanation, no markdown, no code block — raw JSON only:

{
  "arcs": [
    {
      "arc_name": string,
      "arc_type": "domain" | "integrated" | "singleton",
      "arc_description": "one sentence: what this arc teaches and why it matters for this user",
      "comprehensive_subtopics": ["string", "string", "..."],
      "is_visible": boolean,
      "queue_rationale": string | null
    }
  ],
  "total_visible": number,
  "total_queued": number,
  "generated_at": string,
  "user_profile_hash": "computed-server-side",
  "schema_version": "v2"
}`
}

// ─── Build fallback plan from existing engine ─────────────────────────────────

function buildFallbackPlan(
  topics: string[],
  maturity: string,
  profileHash: string,
  planTier: string | null,
  roleLevel: string = 'manager',
): CurriculumOutput {
  const { visible: visibleLimit } = getTierLimits(planTier)

  // Build one v2 arc per topic with comprehensive_subtopics (flat list, no sessions).
  // The session organizer divides these into sessions at approve time.
  const arcs: Arc[] = topics.map((topic, topicIndex) => {
    const isVisible = topicIndex < visibleLimit
    const subtopics = [
      `Why ${topic} is on your agenda right now as a ${roleLevel === 'specialist' ? 'practitioner' : 'leader'}`,
      'The fundamental mechanism — how it actually works',
      'A concrete analogy that makes this immediately clear',
      'How your peers in the industry are already applying this',
      'The common mistake — what trips most people up here',
      'The decision you can make differently after understanding this',
      'What to ask your team or vendor to evaluate their approach',
      'Your 90-day action step to apply this in your role',
    ]
    return {
      arc_name:                topic,
      arc_type:                'singleton' as const,
      arc_description:         `A comprehensive introduction to ${topic} tailored for ${roleLevel === 'specialist' ? 'practitioners' : 'senior leaders'}.`,
      comprehensive_subtopics: subtopics,
      is_visible:              isVisible,
      queue_rationale:         isVisible ? null : 'Available after completing earlier arcs in your plan.',
    }
  })

  const totalVisible = arcs.filter((a) => a.is_visible).length
  const totalQueued  = arcs.filter((a) => !a.is_visible).length

  return {
    arcs,
    total_visible:    totalVisible,
    total_queued:     totalQueued,
    generated_at:     new Date().toISOString(),
    user_profile_hash: profileHash,
    schema_version:   'v2',
  }
}

// ─── Main planner function ─────────────────────────────────────────────────────

// Maps learningGoal to session minutes — mirrors LEARNING_GOAL_MINUTES in session-designer.ts.
const PLANNER_SESSION_MINS: Record<string, number> = {
  quick_wins:      5,
  steady_progress: 15,
  deep_dive:       30,
}

export interface PlannerInput {
  userId: string
  role: string
  industry: string
  maturity: string
  worry: string
  topics: string[]
  planTier: string | null
  roleLevel: string  // 'c-suite' | 'vp-dir' | 'manager' | 'specialist'
  learningGoal?: string  // 'quick_wins' | 'steady_progress' | 'deep_dive'
}

export interface PlannerResult {
  output: CurriculumOutput
  isFallback: boolean
  rawLlmOutput: RawLlmOutput
  /** FB-007: 3-layer narrative enrichment. null when API key missing or enrichment fails. */
  enrichedPlan: EnrichedPlan | null
}

export async function generateCurriculumPlan(input: PlannerInput): Promise<PlannerResult> {
  const { role, industry, maturity, worry, topics, planTier, roleLevel } = input
  const { visible: visibleLimit, queue: queueLimit } = getTierLimits(planTier)
  const profileHash = buildProfileHash(role, maturity, topics, roleLevel)

  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
    console.error('[planner] ANTHROPIC_API_KEY not set — returning fallback plan')
    const fallback = buildFallbackPlan(topics, maturity, profileHash, planTier, roleLevel)
    return { output: fallback, isFallback: true, rawLlmOutput: { fallback: true, reason: 'ANTHROPIC_API_KEY not set' }, enrichedPlan: null }
  }

  const systemPrompt = buildSystemPrompt(role, industry, maturity, worry, topics, visibleLimit, queueLimit, roleLevel)
  const client = new Anthropic({ apiKey })

  // Single attempt — retries triple the time budget and cause 504s when Zod
  // validation fails (e.g. Claude generates >20 subtopics). Fail fast to fallback.
  const controller = new AbortController()
  const callTimeout = setTimeout(() => controller.abort(), 180_000)

  try {
    const message = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Generate the curriculum plan JSON for this user.' }],
      },
      { signal: controller.signal }
    )

    const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
    const trimmed = rawText.trim()

    // Strip markdown code fences if present
    const jsonText = trimmed.startsWith('```') ? trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '') : trimmed
    const parsed = JSON.parse(jsonText)
    const validated = CurriculumOutputSchema.parse(parsed)

    // CURR-01: Tier limits are enforced at the arc level (not session level).
    // Cap visible arcs to visibleLimit; excess visible arcs are moved to queue.
    let visibleCount = 0
    const capped: CurriculumOutput = {
      ...validated,
      arcs: validated.arcs.map((arc) => {
        if (arc.is_visible && visibleCount < visibleLimit) {
          visibleCount++
          return arc
        } else if (arc.is_visible) {
          return { ...arc, is_visible: false, queue_rationale: arc.queue_rationale ?? 'Deferred to queue due to plan tier limit.' }
        }
        return arc
      }),
      user_profile_hash: profileHash,
    }
    const finalVisible = capped.arcs.filter((a) => a.is_visible).length
    const finalQueued  = capped.arcs.filter((a) => !a.is_visible).length
    const final = { ...capped, total_visible: finalVisible, total_queued: finalQueued }

    // CURR-01: Skip enrichment for v2 plans — enrichment.ts references arc.sessions[]
    // which no longer exists. The session organizer (session-organizer.ts) divides
    // comprehensive_subtopics into sessions at approve time; enrichment runs after that.
    const enrichedPlan: EnrichedPlan | null = null

    return { output: final, isFallback: false, rawLlmOutput: parsed, enrichedPlan }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[curriculum/planner] LLM plan generation failed — using fallback:', errMsg)
    const fallback = buildFallbackPlan(topics, maturity, profileHash, planTier, roleLevel)
    return { output: fallback, isFallback: true, rawLlmOutput: { fallback: true, reason: errMsg }, enrichedPlan: null }
  } finally {
    clearTimeout(callTimeout)
  }
}

// ─── Smart Topic Delta: additive arc generation ───────────────────────────────
// CORE_OBJECTIVES.md Objective 4. Used by inngest/curriculum-generator.ts when
// topics are added to an existing plan. Generates arcs ONLY for the newly added
// topics — existing (kept) arcs are never touched or re-sent to the LLM.

export interface DeltaArcInput {
  role: string
  industry: string
  maturity: string
  worry: string
  roleLevel: string
  planTier: string | null
}

/**
 * Generates one or more arcs for newly-added topics only. Mirrors generateCurriculumPlan's
 * single-call shape but scoped to addedTopics, with a small visible allotment (this is an
 * incremental addition to an existing plan, not a full plan).
 */
export async function generateArcsForTopics(
  addedTopics: string[],
  input: DeltaArcInput,
): Promise<{ arcs: Arc[]; isFallback: boolean }> {
  const { role, industry, maturity, worry, roleLevel, planTier } = input
  const { visible: tierVisibleLimit } = getTierLimits(planTier)
  // An addition earns at most a small slice of the tier's total visible budget —
  // the existing kept arcs already occupy the rest.
  const visibleLimit = Math.max(1, Math.min(addedTopics.length * 2, tierVisibleLimit))

  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
    console.error('[planner] ANTHROPIC_API_KEY not set — returning fallback arcs for added topics')
    const fallback = buildFallbackPlan(addedTopics, maturity, '', planTier, roleLevel)
    return { arcs: fallback.arcs, isFallback: true }
  }

  const systemPrompt = buildSystemPrompt(role, industry, maturity, worry, addedTopics, visibleLimit, 0, roleLevel)
  const client = new Anthropic({ apiKey })
  const controller = new AbortController()
  const callTimeout = setTimeout(() => controller.abort(), 180_000)

  try {
    const message = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Generate the curriculum plan JSON for these newly added topics only.' }],
      },
      { signal: controller.signal }
    )

    const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
    const trimmed = rawText.trim()
    const jsonText = trimmed.startsWith('```') ? trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '') : trimmed
    const parsed = JSON.parse(jsonText)
    const validated = CurriculumOutputSchema.parse(parsed)

    // All new-topic arcs are visible by default (they're what the user just asked for),
    // capped to visibleLimit.
    let visibleCount = 0
    const arcs = validated.arcs.map((arc) => {
      if (visibleCount < visibleLimit) {
        visibleCount++
        return { ...arc, is_visible: true, queue_rationale: null }
      }
      return { ...arc, is_visible: false, queue_rationale: arc.queue_rationale ?? 'Deferred due to plan tier limit.' }
    })

    return { arcs, isFallback: false }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[curriculum/planner] generateArcsForTopics failed — using fallback:', errMsg)
    const fallback = buildFallbackPlan(addedTopics, maturity, '', planTier, roleLevel)
    return { arcs: fallback.arcs, isFallback: true }
  } finally {
    clearTimeout(callTimeout)
  }
}

/**
 * Judges whether newly added topics are semantically related enough to the topics the
 * user already knows (kept) to warrant a bridging arc, and if so, generates it.
 * Returns null when unrelated — per CORE_OBJECTIVES.md: "Skip if topics are semantically
 * unrelated (don't force a poor bridge)." This is a real LLM go/no-go judgment, not a heuristic.
 */
export async function generateBridgingArc(
  addedTopics: string[],
  keptTopics: string[],
  input: DeltaArcInput,
): Promise<Arc | null> {
  if (keptTopics.length === 0 || addedTopics.length === 0) return null

  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
    console.log('[planner] ANTHROPIC_API_KEY not set — skipping bridging arc generation')
    return null
  }

  const { role, industry, maturity, worry, roleLevel } = input
  const normalisedMaturity = normaliseMaturity(maturity)

  const bridgeSystemPrompt = `You are an expert learning curriculum designer judging whether a short "bridging" arc
should be created to connect a learner's existing knowledge to newly added topics.

USER PROFILE:
- Role: ${role}
- Industry: ${industry}
- AI maturity: ${maturity} (normalised: ${normalisedMaturity})
- Biggest AI worry: ${worry || 'not specified'}
- Seniority level: ${roleLevel}

Topics the learner ALREADY knows (kept, untouched): ${keptTopics.join(', ')}
Topics the learner JUST ADDED: ${addedTopics.join(', ')}

TASK:
Decide: is there a genuine, natural conceptual connection between what they already know and what
they just added, such that a short bridging arc would help them see how the new topic builds on or
relates to their existing knowledge?

Skip bridging (return should_bridge: false) if the topics are semantically unrelated — do NOT force
a poor bridge just to have one. A bridge only earns its place if skipping it would leave a genuine
gap in how the new topic connects to what they already know.

If should_bridge is true, generate ONE short bridging arc:
- 1-2 sessions worth of content only (typically 4-10 comprehensive_subtopics total)
- Placed conceptually at the ENTRY POINT of the new topic's arc — it should explicitly reference
  what the learner already knows and use it as the on-ramp into the new topic
- arc_type must be "singleton"
- is_visible must be true (bridges are always shown, never queued)

Return ONLY valid JSON, no markdown, no explanation:
{
  "should_bridge": boolean,
  "reasoning": "one sentence explaining the decision",
  "arc": {
    "arc_name": string,
    "arc_type": "singleton",
    "arc_description": "one sentence: how this bridges kept knowledge into the new topic",
    "comprehensive_subtopics": ["string", "..."],
    "is_visible": true,
    "queue_rationale": null
  } | null
}`

  const client = new Anthropic({ apiKey })
  const controller = new AbortController()
  const callTimeout = setTimeout(() => controller.abort(), 90_000)

  try {
    const message = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: bridgeSystemPrompt,
        messages: [{ role: 'user', content: 'Judge relatedness and generate the bridging arc JSON if warranted.' }],
      },
      { signal: controller.signal }
    )

    const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
    const trimmed = rawText.trim()
    const jsonText = trimmed.startsWith('```') ? trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '') : trimmed
    const parsed = JSON.parse(jsonText) as { should_bridge?: boolean; reasoning?: string; arc?: unknown }

    if (!parsed.should_bridge || !parsed.arc) {
      console.log('[planner] Bridging skipped — topics judged unrelated:', parsed.reasoning ?? '(no reasoning given)')
      return null
    }

    const validatedArc = ArcSchema.parse(parsed.arc)
    console.log('[planner] Bridging arc generated:', validatedArc.arc_name, '—', parsed.reasoning)
    return validatedArc
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[curriculum/planner] generateBridgingArc failed — skipping bridge:', errMsg)
    return null
  } finally {
    clearTimeout(callTimeout)
  }
}

// ─── Queue regeneration ────────────────────────────────────────────────────────

export async function generateQueueExtension(
  input: PlannerInput,
  completedTitles: string[],
): Promise<Session[]> {
  const { role, industry, maturity, worry, topics, planTier, roleLevel } = input
  const { queue: queueLimit } = getTierLimits(planTier)
  const profileHash = buildProfileHash(role, maturity, topics, roleLevel)

  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) return []

  const completedList = completedTitles.length > 0 ? completedTitles.map((t) => `- ${t}`).join('\n') : '(none yet)'

  const queueAudienceLabel = roleLevel === 'specialist' ? 'individual contributors and specialist practitioners'
    : roleLevel === 'manager' ? 'managers and team leads'
    : roleLevel === 'vp-technology' ? 'technology leaders'
    : roleLevel === 'vp-product' ? 'product leaders'
    : roleLevel === 'vp-dir' ? 'senior functional leaders'
    : 'senior business executives'

  const systemPrompt = `You are an expert learning curriculum designer for ${queueAudienceLabel}.

The user has already completed these sessions:
${completedList}

Generate 20 new queue sessions that logically follow their learning journey.
Do NOT repeat completed topics. Use this profile:
- Role: ${role}, Industry: ${industry}, AI maturity: ${maturity}, Worry: ${worry}
- Original topics: ${topics.join(', ')}

Return ONLY a JSON array of session objects (not wrapped in arcs). Each session must include a "subtopics" array of specific learning points (3–10 items). Each session:
{
  "session_id": string (unique slug, prefix with "ext-"),
  "title": string,
  "focus": string,
  "arc_position": number,
  "arc_length": number,
  "depth_level": "beginner" | "intermediate" | "advanced",
  "role_hint": string,
  "subtopics": string[],
  "is_visible": false,
  "queue_rationale": string
}

Return raw JSON array only.`

  const client = new Anthropic({ apiKey })
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Generate the 20 extension queue sessions.' }],
    })

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '[]'
    const trimmed = rawText.trim()
    const jsonText = trimmed.startsWith('```') ? trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '') : trimmed
    const parsed = JSON.parse(jsonText) as unknown[]
    const queueSessionMins = PLANNER_SESSION_MINS[input.learningGoal ?? ''] ?? 15
    return z.array(SessionSchema).parse(parsed).slice(0, queueLimit).map((s) => ({
      ...s,
      estimated_minutes: queueSessionMins,
    }))
  } catch (err) {
    console.error('[curriculum/planner] Queue extension failed:', err)
    return []
  }
}
