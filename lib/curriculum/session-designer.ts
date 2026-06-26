import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// ─── Duration mapping ─────────────────────────────────────────────────────────

export const LEARNING_GOAL_MINUTES: Record<string, number> = {
  quick_wins:      5,
  steady_progress: 15,
  deep_dive:       30,
}

export function getSessionDuration(learningGoal: string | null | undefined): number {
  return LEARNING_GOAL_MINUTES[learningGoal ?? ''] ?? 15
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const SubtopicSchema = z.object({
  title:              z.string().min(3).max(200),
  type:               z.enum(['concept', 'example', 'application', 'pitfalls', 'practice', 'summary']),
  duration_mins:      z.number().int().min(2).max(20),
  learning_objective: z.string().min(5).max(500),
})

const DesignedSessionSchema = z.object({
  session_title:   z.string().min(5).max(200),
  session_summary: z.string().min(10).max(1000),
  duration_mins:   z.number().int().min(3).max(60),
  subtopics:       z.array(SubtopicSchema).min(1).max(6),
})

const SessionDesignOutputSchema = z.object({
  sessions: z.array(DesignedSessionSchema).min(1).max(10),
})

export type Subtopic = z.infer<typeof SubtopicSchema>
export type DesignedSession = z.infer<typeof DesignedSessionSchema>

// ─── Input types ─────────────────────────────────────────────────────────────

export interface CurriculumTopicInput {
  session_id:        string
  title:             string
  focus:             string
  depth_level:       string
  estimated_minutes: number
  subtopics?:        string[]   // pre-planned by curriculum LLM; if present, used instead of LLM-invented
}

export interface DesignerUserProfile {
  role:     string
  industry: string
  maturity: string
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function buildFallbackSessions(topic: CurriculumTopicInput, maxMins: number): DesignedSession[] {
  const dur = Math.max(maxMins, 5)
  // PACE-01: compute sectionCount from duration formula, minimum 2
  const sectionCount = Math.max(2, Math.floor((dur - 2) / 2))
  const minsPerSection = Math.max(2, Math.floor(dur / sectionCount))

  const subtopics: Subtopic[] = []
  for (let i = 0; i < sectionCount; i++) {
    if (i === 0) {
      subtopics.push({
        title:              'Context and relevance',
        type:               'concept',
        duration_mins:      minsPerSection,
        learning_objective: `Understand why ${topic.title} matters to your role right now`,
      })
    } else if (i === sectionCount - 1) {
      subtopics.push({
        title:              'Practical application and next steps',
        type:               'application',
        duration_mins:      minsPerSection,
        learning_objective: `Apply ${topic.title} concepts with one concrete action you can take today`,
      })
    } else {
      subtopics.push({
        title:              `Core concept ${i}`,
        type:               'concept',
        duration_mins:      minsPerSection,
        learning_objective: `Understand core concept ${i} of ${topic.title}`,
      })
    }
  }

  return [{
    session_title:   topic.title,
    session_summary: `Understand and apply the core concepts of ${topic.title}.`,
    duration_mins:   dur,
    subtopics,
  }]
}

// ─── LLM session designer ─────────────────────────────────────────────────────

// ─── Pre-planned subtopic designer ───────────────────────────────────────────

async function designFromPreplannedSubtopics(
  topic:   CurriculumTopicInput,
  profile: DesignerUserProfile,
  maxMins: number,
  apiKey:  string,
): Promise<DesignedSession[]> {
  const subtopics = topic.subtopics!
  // PACE-01: derive section count from duration formula, minimum 2
  const sectionCount = Math.max(2, Math.floor((maxMins - 2) / 2))
  const chunks = chunkArray(subtopics, sectionCount)
  const client = new Anthropic({ apiKey })

  const sessions: DesignedSession[] = []

  for (const chunk of chunks) {
    const subtopicList = chunk.map((s, i) => `${i + 1}. ${s}`).join('\n')

    const prompt = `You are a curriculum designer for an executive learning platform.

Design ONE 15-minute learning session (10 minutes of content + 5 minutes reserved for Q&A).

Topic: "${topic.title}"
Learner: ${profile.role} in ${profile.industry}, AI familiarity: ${profile.maturity}

Subtopics to cover in this session (all must be included):
${subtopicList}

Rules:
1. Write a specific session title that captures what these subtopics collectively teach
2. session_summary starts with "After this session you will..."
3. duration_mins must be exactly ${maxMins} (this is the 10-min content slot — Q&A is separate)
4. For each subtopic: assign a type, duration_mins (2–3 min each), and learning_objective
5. Types: concept | example | application | pitfalls | practice | summary
6. Total subtopic duration_mins must sum to approximately ${maxMins - 5} (the 10 min teaching window)
7. Session titles must be specific — never "Part 1", "Introduction", or generic phrases

FOUNDATIONAL FRAMING RULE — applies to every session:
The first subtopic in this session is a context anchor. It must establish foundational framing
for the topic — why it matters to this user's role — before any technical detail.
Do not start with a concept definition. Start with relevance to the user's role and situation.

SECTION STRUCTURE RULES — MANDATORY
Section 1 — Context anchor (always first):
  Do NOT open with the topic name or a definition.
  Open with: "Here is why this is on your radar right now as a [role] in [industry]."
  Connect to something the user already knows or a decision they currently face.

Sections 2 to N-1 — Core concepts in dependency order:
  Each section covers exactly one concept.
  Order them so each concept unlocks the next.

Section N — Practical application (always last):
  Do NOT introduce any new concept.
  Give one specific action or decision the user can take based on what was covered.
  Name it explicitly. Connect it to the user's role.

When sectionCount = 2: Section 2 serves as both core concept and practical application.
Give one concrete action at the end of Section 2.

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "sessions": [
    {
      "session_title": "specific title naming exactly what the learner will know",
      "session_summary": "After this session you will...",
      "duration_mins": ${maxMins},
      "subtopics": [
        {
          "title": "subtopic title",
          "type": "concept" | "example" | "application" | "pitfalls" | "practice" | "summary",
          "duration_mins": <integer 2–4>,
          "learning_objective": "After this, you can..."
        }
      ]
    }
  ]
}`

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await client.messages.create({
          model:      'claude-sonnet-4-6',
          max_tokens: 2048,
          messages:   [{ role: 'user', content: prompt }],
        })

        const content = response.content[0]
        if (content.type !== 'text') continue

        const raw    = content.text.replace(/```(?:json)?\n?/g, '').trim()
        const parsed = JSON.parse(raw) as unknown
        const result = SessionDesignOutputSchema.safeParse(parsed)

        if (result.success && result.data.sessions.length > 0) {
          // Enforce exactly maxMins — LLM sometimes drifts by 1
          sessions.push({ ...result.data.sessions[0], duration_mins: maxMins })
          break
        }
        console.error('[session-designer] pre-planned chunk validation failed, attempt', attempt + 1,
          result.success ? 'no sessions' : result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        )
      } catch (err) {
        console.error('[session-designer] pre-planned chunk error, attempt', attempt + 1, err)
      }
    }

    // Fallback for this chunk if LLM failed
    if (sessions.length < chunks.indexOf(chunk) + 1) {
      sessions.push(buildFallbackSessions({ ...topic, title: `${topic.title}: Part ${chunks.indexOf(chunk) + 1}` }, maxMins)[0])
    }
  }

  return sessions
}

// ─── Chunk helper ─────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

// ─── LLM session designer ─────────────────────────────────────────────────────

export async function designSessionsForTopic(
  topic:   CurriculumTopicInput,
  profile: DesignerUserProfile,
  maxMins: number
): Promise<DesignedSession[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
    return buildFallbackSessions(topic, maxMins)
  }

  // ── If curriculum planner already decided the subtopics, split them into sessions ──
  if (topic.subtopics && topic.subtopics.length > 0) {
    return designFromPreplannedSubtopics(topic, profile, maxMins, apiKey)
  }

  // ── Legacy path: LLM invents subtopics from scratch (for sessions without pre-planned subtopics) ──
  // PACE-01: compute sectionCount from duration formula, minimum 2
  const legacySectionCount = Math.max(2, Math.floor((maxMins - 2) / 2))
  const floor   = Math.round(maxMins * 0.8)
  const ceiling = Math.round(maxMins * 1.15)

  const prompt = `You are a curriculum designer for an executive learning platform.

Design learning session(s) for this topic:
- Topic: "${topic.title}"
- What it covers: "${topic.focus}"
- Learner: ${profile.role} in ${profile.industry}, AI familiarity: ${profile.maturity}
- Session target: ${maxMins} minutes per session (floor: ${floor} min, ceiling: ${ceiling} min)

Rules:
1. Each session MUST be between ${floor} and ${ceiling} minutes
2. Each session must have exactly ${legacySectionCount} subtopics (computed from session duration: floor((${maxMins} - 2) / 2) = ${legacySectionCount}, minimum 2)
3. Each session ends at a complete thought — learner stops feeling satisfied, not cut off
4. Session titles must be specific and descriptive, never "Part 1" or "Introduction"

Subtopic types available:
- concept: a core idea or mechanism
- example: a worked real-world scenario relevant to ${profile.industry}
- application: how this applies specifically to a ${profile.role}
- pitfalls: common mistakes executives make and how to avoid them
- practice: a concrete action the learner can take today
- summary: key takeaways and a decision framework

SECTION STRUCTURE RULES — MANDATORY
Section 1 — Context anchor (always first):
  Do NOT open with the topic name or a definition.
  Open with: "Here is why this is on your radar right now as a [role] in [industry]."
  Connect to something the user already knows or a decision they currently face.

Sections 2 to N-1 — Core concepts in dependency order:
  Each section covers exactly one concept.
  Order them so each concept unlocks the next.

Section N — Practical application (always last):
  Do NOT introduce any new concept.
  Give one specific action or decision the user can take based on what was covered.
  Name it explicitly. Connect it to the user's role.

When sectionCount = 2: Section 2 serves as both core concept and practical application.
Give one concrete action at the end of Section 2.

Respond ONLY with valid JSON matching this exact schema (no markdown, no explanation):
{
  "sessions": [
    {
      "session_title": "specific descriptive title naming what the learner will know",
      "session_summary": "one sentence starting with: After this session you will...",
      "duration_mins": <integer between ${floor} and ${ceiling}>,
      "subtopics": [
        {
          "title": "subtopic title",
          "type": "concept" | "example" | "application" | "pitfalls" | "practice" | "summary",
          "duration_mins": <integer 2–15>,
          "learning_objective": "After this, you can..."
        }
      ]
    }
  ]
}`

  const client = new Anthropic({ apiKey })

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        messages:   [{ role: 'user', content: prompt }],
      })

      const content = response.content[0]
      if (content.type !== 'text') continue

      const raw     = content.text.replace(/```(?:json)?\n?/g, '').trim()
      const parsed  = JSON.parse(raw) as unknown
      const result  = SessionDesignOutputSchema.safeParse(parsed)

      if (result.success) return result.data.sessions
      console.error('[session-designer] schema validation failed, attempt', attempt + 1, result.error.issues)
    } catch (err) {
      console.error('[session-designer] attempt', attempt + 1, 'error:', err)
    }
  }

  return buildFallbackSessions(topic, maxMins)
}
