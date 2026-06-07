import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { createHash } from 'crypto'
import { buildCurriculum } from '@/lib/content/curriculum'
import { enrichCurriculumPlan, applyEnrichmentVisibility } from './enrichment'
import type { EnrichedPlan, RawLlmOutput } from './types'

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const SessionSchema = z.object({
  session_id: z.string().min(1).max(128),
  title: z.string().min(3).max(100),
  focus: z.string().min(10).max(300),
  arc_position: z.number().int().min(1),
  arc_length: z.number().int().min(1),
  depth_level: z.enum(['beginner', 'intermediate', 'advanced']),
  role_hint: z.string().min(5).max(300),
  subtopics: z.array(z.string().min(3).max(500)).min(1).max(30),
  is_visible: z.boolean(),
  queue_rationale: z.string().max(500).nullable(),
})

export const ArcSchema = z.object({
  arc_name: z.string().min(1).max(100),
  arc_type: z.enum(['domain', 'integrated', 'singleton']),
  sessions: z.array(SessionSchema).min(1).max(30),
})

export const CurriculumOutputSchema = z.object({
  arcs: z.array(ArcSchema).min(1).max(10),
  total_visible: z.number().int().min(1).max(10),
  total_queued: z.number().int().min(0).max(50),
  generated_at: z.string(),
  user_profile_hash: z.string().optional().default(''),
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
    'c-suite':   'Executive / C-Suite (owns P&L, accountable to board)',
    'vp-dir':    'VP / Director (leads a function, reports to C-Suite, accountable for team outcomes)',
    'manager':   'Manager / Team Lead (manages a team, executes strategy set above them)',
    'specialist':'Specialist / Individual Contributor (expert practitioner)',
  }

  const roleLevelInstruction: Record<string, string> = {
    'c-suite':   'Frame all content for a leader who approves budgets, sponsors AI initiatives, and answers to the board. Examples must involve strategic decisions, not implementation choices.',
    'vp-dir':    'Frame all content for a function leader who owns team adoption and reports outcomes to the C-Suite. Examples must involve managing upward (presenting to executives) and downward (enabling their team). Do NOT use board-level or P&L-authority framing.',
    'manager':   'Frame all content for a team lead implementing AI tools day-to-day. Examples should be hands-on and practical. Avoid board-level or C-Suite strategic framing.',
    'specialist':'Frame all content for a practitioner who uses AI tools directly. Examples should be technical and applied.',
  }

  const maturityFramingInstruction = normalisedMaturity === 'expert'
    ? '- Frame content as peer-level: Claude is speaking to someone who already understands AI mechanisms. Skip introductory analogies. Focus on edge cases, failure modes, nuanced tradeoffs, and decisions at the frontier of AI deployment. Use first-person plural: "When we\'re evaluating model risk at this scale..."'
    : normalisedMaturity === 'advanced'
    ? '- Frame content for a practitioner who has hands-on AI experience: strategic depth, real tradeoffs, and implementation decisions are appropriate. Minimal introductory context needed.'
    : normalisedMaturity === 'intermediate'
    ? '- Frame content with practical focus: explain mechanisms briefly, then move quickly to application and decisions. Some analogies are helpful; avoid deep technical theory.'
    : '- Frame content with maximum accessibility: generous analogies, concrete examples before abstract concepts, explicit "why this matters" for each idea. Never assume prior AI knowledge.'

  return `You are an expert learning curriculum designer for senior business executives.

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
If the user selects only 1 topic, arc_type is "singleton". Minimum 5 sessions. Structure:
Session 1: "Introducing [Topic] — Why It Matters for Executives" — 15-20 min
Session 2: "Core Concepts in [Topic]" — 20-25 min
Session 3: "[Topic] in Practice — [role-specific application]" — 20-25 min
Session 4: "Advanced [Topic]: [role-specific challenge]" — 25-30 min
Session 5: "What's Next: Beyond [Topic]" — 20-25 min

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

There is no minimum or mandatory count for breadth expansion — generate what earns its place and nothing more.

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

SUBTOPICS RULES:
- For each session, list every subtopic the learner must understand to genuinely grasp this topic.
- There is no fixed count — use as many as the topic actually requires.
- Simple concepts may need 2–4 subtopics. Complex strategic topics may need 8–12.
- Write each subtopic as a specific, concrete learning point (not a vague category name).
- Bad example: "Overview of AI" — too vague.
- Good example: "How transformer models process language without understanding meaning" — specific.
- Do NOT pad with subtopics that are not genuinely needed. Every subtopic must earn its place.

SUBTOPIC ORDERING (within each session):
Order subtopics from most foundational to most advanced — the learner should be able to follow them in sequence without skipping:
1. Context / why it matters — the one thing that makes the rest meaningful
2. Core concept — the fundamental mechanism or idea
3. How it works in practice — a concrete application in their role or industry
4. The nuance or pitfall — what trips executives up, what to watch for
5. The decision or action — what they can do or decide differently after this session
Not every session needs all five layers. Use the layers that the topic genuinely requires. The key rule: each subtopic should assume the previous one is understood.

SESSION ID FORMAT: {arc-slug}-s{n} where arc-slug is a kebab-case version of the arc name.
Example: "ai-governance-arc-s1", "tools-integration-s2"
All session_ids must be unique within the entire output.

IMPORTANT CONSTRAINTS:
- total_visible must exactly equal the count of sessions where is_visible is true
- total_queued must exactly equal the count of sessions where is_visible is false
- queue_rationale must be null for is_visible: true sessions
- queue_rationale must be a non-empty string for is_visible: false sessions

Return ONLY valid JSON matching this TypeScript type. No explanation, no markdown, no code block — raw JSON only:

{
  "arcs": [
    {
      "arc_name": string,
      "arc_type": "domain" | "integrated" | "singleton",
      "sessions": [
        {
          "session_id": string,
          "title": string,
          "focus": string,
          "arc_position": number,
          "arc_length": number,
          "depth_level": "beginner" | "intermediate" | "advanced",
          "role_hint": string,
          "subtopics": string[],
          "is_visible": boolean,
          "queue_rationale": string | null
        }
      ]
    }
  ],
  "total_visible": number,
  "total_queued": number,
  "generated_at": string,
  "user_profile_hash": "computed-server-side"
}`
}

// ─── Build fallback plan from existing engine ─────────────────────────────────

function buildFallbackPlan(
  topics: string[],
  maturity: string,
  profileHash: string,
  planTier: string | null,
): CurriculumOutput {
  const { visible: visibleLimit, queue: queueLimit } = getTierLimits(planTier)
  const normMaturity = normaliseMaturity(maturity)

  // 1. Build 4 sessions per topic using a deterministic template
  const sessionsByTopic: Session[][] = topics.map((topic, topicIndex) => {
    const advancedDepth: 'intermediate' | 'advanced' =
      normMaturity === 'beginner' ? 'intermediate' : 'advanced'

    const templates: Array<{
      title: string
      subtopics: string[]
      depth_level: 'beginner' | 'intermediate' | 'advanced'
    }> = [
      {
        title: `${topic}: Why It Matters`,
        subtopics: [
          'What this topic means for your role',
          'Why this is on every executive agenda now',
          'The business risk of ignoring it',
          'One question to ask in your next AI meeting',
        ],
        depth_level: 'beginner',
      },
      {
        title: `${topic}: Core Concepts`,
        subtopics: [
          'The fundamental mechanism',
          "How it differs from what you've heard",
          'A concrete analogy for non-technical leaders',
          'What practitioners actually do with it',
        ],
        depth_level: 'beginner',
      },
      {
        title: `${topic}: Applying It in Your Role`,
        subtopics: [
          'How your peers are already using this',
          'The decision you can make differently now',
          'What to ask your team',
          'How to evaluate vendors on this capability',
        ],
        depth_level: 'intermediate',
      },
      {
        title: `${topic}: Advanced Decisions`,
        subtopics: [
          'The tradeoffs most leaders miss',
          'What separates good from great in this area',
          'Your 90-day action step',
          'How to measure progress',
        ],
        depth_level: advancedDepth,
      },
    ]

    return templates.map((tmpl, sessionIndex) => ({
      session_id: `fallback-t${topicIndex}-s${sessionIndex}`,
      title: tmpl.title,
      focus: tmpl.title,
      arc_position: sessionIndex + 1,
      arc_length: 4,
      depth_level: tmpl.depth_level,
      role_hint: 'Frame for a senior executive with practical AI interest.',
      subtopics: tmpl.subtopics,
      estimated_minutes: 15,
      // is_visible and queue_rationale assigned after interleaving
      is_visible: true,
      queue_rationale: null,
    }))
  })

  // 2. Interleave across topics: position 0..3, then each topic at that position
  const interleaved: Array<{ topicIndex: number; session: Session }> = []
  for (let pos = 0; pos < 4; pos++) {
    for (let t = 0; t < topics.length; t++) {
      const s = sessionsByTopic[t][pos]
      if (s !== undefined) {
        interleaved.push({ topicIndex: t, session: s })
      }
    }
  }

  // 3. Apply tier limits
  const totalAllowed = visibleLimit + queueLimit
  const trimmed = interleaved.slice(0, totalAllowed)

  const withVisibility = trimmed.map((item, idx): typeof item => ({
    topicIndex: item.topicIndex,
    session: {
      ...item.session,
      is_visible: idx < visibleLimit,
      queue_rationale: idx < visibleLimit
        ? null
        : 'Available after completing earlier sessions in your plan.',
    },
  }))

  // 4. Group back into one arc per topic
  const arcs: Array<z.infer<typeof ArcSchema>> = topics.map((topic, topicIndex) => {
    const topicSessions = withVisibility
      .filter((item) => item.topicIndex === topicIndex)
      .map((item) => item.session)
    return {
      arc_name: topic,
      arc_type: 'singleton' as const,
      sessions: topicSessions,
    }
  }).filter((arc) => arc.sessions.length > 0)

  // 5. Compute totals
  const allSessions = withVisibility.map((item) => item.session)
  const totalVisible = allSessions.filter((s) => s.is_visible).length
  const totalQueued = allSessions.filter((s) => !s.is_visible).length

  return {
    arcs,
    total_visible: totalVisible,
    total_queued: totalQueued,
    generated_at: new Date().toISOString(),
    user_profile_hash: profileHash,
  }
}

// ─── Main planner function ─────────────────────────────────────────────────────

export interface PlannerInput {
  userId: string
  role: string
  industry: string
  maturity: string
  worry: string
  topics: string[]
  planTier: string | null
  roleLevel: string  // 'c-suite' | 'vp-dir' | 'manager' | 'specialist'
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
    const fallback = buildFallbackPlan(topics, maturity, profileHash, planTier)
    return { output: fallback, isFallback: true, rawLlmOutput: { fallback: true, reason: 'ANTHROPIC_API_KEY not set' }, enrichedPlan: null }
  }

  const systemPrompt = buildSystemPrompt(role, industry, maturity, worry, topics, visibleLimit, queueLimit, roleLevel)
  const client = new Anthropic({ apiKey })

  // Single attempt — retries triple the time budget and cause 504s when Zod
  // validation fails (e.g. Claude generates >20 subtopics). Fail fast to fallback.
  const controller = new AbortController()
  const callTimeout = setTimeout(() => controller.abort(), 90_000)

  try {
    const message = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
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

    // Enforce tier limits: cap visible sessions
    let visibleCount = 0
    const capped = {
      ...validated,
      arcs: validated.arcs.map((arc) => ({
        ...arc,
        sessions: arc.sessions.map((s) => {
          if (s.is_visible && visibleCount < visibleLimit) {
            visibleCount++
            return s
          } else if (s.is_visible) {
            return { ...s, is_visible: false, queue_rationale: s.queue_rationale ?? 'Deferred to queue due to plan tier limit.' }
          }
          return s
        }),
      })),
    }
    const finalVisible = capped.arcs.flatMap((a) => a.sessions).filter((s) => s.is_visible).length
    const finalQueued = capped.arcs.flatMap((a) => a.sessions).filter((s) => !s.is_visible).length

    // Compute estimated_minutes from subtopic count: ceil(n / 4) * 15
    const withDuration = {
      ...capped,
      arcs: capped.arcs.map((arc) => ({
        ...arc,
        sessions: arc.sessions.map((s) => ({
          ...s,
          estimated_minutes: Math.ceil(s.subtopics.length / 4) * 15,
        })),
      })),
    }
    const final = { ...withDuration, total_visible: finalVisible, total_queued: finalQueued, user_profile_hash: profileHash }

    // ── FB-007: 3-layer narrative enrichment (2-call pipeline) ─────────────
    // Run after plan is successfully generated. Failure falls back gracefully.
    let enrichedPlan: EnrichedPlan | null = null
    try {
      enrichedPlan = await enrichCurriculumPlan({
        role,
        roleLevel,
        industry,
        maturity,
        arcs: withDuration.arcs,
      })
    } catch (enrichErr) {
      console.error('[planner] 3-layer enrichment threw unexpectedly — using unenriched plan:', enrichErr)
      enrichedPlan = null
    }

    return { output: final, isFallback: false, rawLlmOutput: parsed, enrichedPlan }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[curriculum/planner] LLM plan generation failed — using fallback:', errMsg)
    const fallback = buildFallbackPlan(topics, maturity, profileHash, planTier)
    return { output: fallback, isFallback: true, rawLlmOutput: { fallback: true, reason: errMsg }, enrichedPlan: null }
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

  const systemPrompt = `You are an expert learning curriculum designer for senior executives.

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
    return z.array(SessionSchema).parse(parsed).slice(0, queueLimit).map((s) => ({
      ...s,
      estimated_minutes: Math.ceil(s.subtopics.length / 4) * 15,
    }))
  } catch (err) {
    console.error('[curriculum/planner] Queue extension failed:', err)
    return []
  }
}
