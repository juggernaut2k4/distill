import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { createHash } from 'crypto'
import { buildCurriculum } from '@/lib/content/curriculum'

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const SessionSchema = z.object({
  session_id: z.string().min(1).max(128),
  title: z.string().min(3).max(100),
  focus: z.string().min(10).max(300),
  arc_position: z.number().int().min(1),
  arc_length: z.number().int().min(1),
  depth_level: z.enum(['beginner', 'intermediate', 'advanced']),
  role_hint: z.string().min(5).max(300),
  subtopics: z.array(z.string().min(3).max(200)).min(1).max(20),
  is_visible: z.boolean(),
  queue_rationale: z.string().max(300).nullable(),
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

// ─── Profile hash ─────────────────────────────────────────────────────────────

export function buildProfileHash(role: string, maturity: string, topics: string[]): string {
  const sorted = [...topics].sort().join(',')
  return createHash('sha256').update(`${role}::${maturity}::${sorted}`).digest('hex').slice(0, 16)
}

// ─── Tier limits ──────────────────────────────────────────────────────────────

function getTierLimits(planTier: string | null): { visible: number; queue: number } {
  switch (planTier) {
    case 'starter': return { visible: 5, queue: 10 }
    case 'pro':
    case 'executive': return { visible: 10, queue: 50 }
    default: return { visible: 3, queue: 0 } // free / trial
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
): string {
  const depthCap = (() => {
    switch (maturity.toLowerCase()) {
      case 'beginner':
      case 'no experience': return 'intermediate'
      case 'intermediate':
      case 'some experience':
      case 'somewhat experience': return 'advanced'
      default: return 'advanced'
    }
  })()

  return `You are an expert learning curriculum designer for senior business executives.

Your task: design a personalised learning curriculum in JSON format based on the user's profile and topic selections.

USER PROFILE:
- Role: ${role}
- Industry: ${industry}
- AI maturity: ${maturity}
- Biggest AI worry: ${worry || 'not specified'}
- Selected topics: ${topics.join(', ')}

CURRICULUM REQUIREMENTS:
- Visible plan sessions: exactly up to ${visibleLimit} sessions (at least 1 per selected topic)
- Shadow queue sessions: up to ${queueLimit} additional sessions (can be 0 if queueLimit is 0)
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

DEPTH RULES:
- NEVER assign depth_level "advanced" to a user with maturity "${maturity}" if the computed depth cap is "${depthCap}".
- ${depthCap === 'intermediate' ? 'All sessions must be "beginner" or "intermediate" depth only.' : 'Sessions may reach "advanced" depth from session 3+ within an arc.'}
- Match session depth to the user's role: a CFO getting AI governance content needs board-level framing, not technical implementation details.

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

function buildFallbackPlan(topics: string[], maturity: string, profileHash: string): CurriculumOutput {
  const simplePlan = buildCurriculum(topics, maturity)
  const sessions: Session[] = simplePlan.sessions.flatMap((s, sIdx) =>
    s.topics.map((l, lIdx) => {
      const subtopics: string[] = l.subtopics && l.subtopics.length > 0
        ? l.subtopics
        : [
            `Core concepts of ${l.title}`,
            `Why ${l.title} matters for executives`,
            `How leading organisations apply ${l.title}`,
            `Your immediate action steps for ${l.title}`,
          ]
      return {
        session_id: `fallback-session-${sIdx}-${lIdx}`,
        title: l.title,
        focus: subtopics[0] ?? `Learn about ${l.title}`,
        arc_position: lIdx + 1,
        arc_length: s.topics.length,
        depth_level: l.difficulty,
        role_hint: 'Frame for a senior executive with limited technical background.',
        subtopics,
        estimated_minutes: Math.ceil(subtopics.length / 4) * 15,
        is_visible: true,
        queue_rationale: null,
      }
    })
  )

  return {
    arcs: [{
      arc_name: 'Your Learning Path',
      arc_type: 'singleton',
      sessions,
    }],
    total_visible: sessions.length,
    total_queued: 0,
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
}

export interface PlannerResult {
  output: CurriculumOutput
  isFallback: boolean
  rawLlmOutput: object
}

export async function generateCurriculumPlan(input: PlannerInput): Promise<PlannerResult> {
  const { role, industry, maturity, worry, topics, planTier } = input
  const { visible: visibleLimit, queue: queueLimit } = getTierLimits(planTier)
  const profileHash = buildProfileHash(role, maturity, topics)

  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
    console.error('[planner] ANTHROPIC_API_KEY not set — returning fallback plan')
    const fallback = buildFallbackPlan(topics, maturity, profileHash)
    return { output: fallback, isFallback: true, rawLlmOutput: { fallback: true, reason: 'ANTHROPIC_API_KEY not set' } }
  }

  const systemPrompt = buildSystemPrompt(role, industry, maturity, worry, topics, visibleLimit, queueLimit)
  const client = new Anthropic({ apiKey })

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Generate the curriculum plan JSON for this user.' }],
      })

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
      return { output: final, isFallback: false, rawLlmOutput: parsed }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.error(`[planner] LLM attempt ${attempt}/3 failed:`, lastError.message)
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5000))
    }
  }

  console.error('[curriculum/planner] LLM failed after 3 attempts:', lastError?.message)
  const fallback = buildFallbackPlan(topics, maturity, profileHash)
  return { output: fallback, isFallback: true, rawLlmOutput: { fallback: true, reason: lastError?.message ?? 'LLM error' } }
}

// ─── Queue regeneration ────────────────────────────────────────────────────────

export async function generateQueueExtension(
  input: PlannerInput,
  completedTitles: string[],
): Promise<Session[]> {
  const { role, industry, maturity, worry, topics, planTier } = input
  const { queue: queueLimit } = getTierLimits(planTier)
  const profileHash = buildProfileHash(role, maturity, topics)

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
