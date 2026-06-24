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
  session_summary: z.string().min(10).max(600),
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
  const conceptMins  = Math.round(dur * 0.5)
  const applyMins    = Math.round(dur * 0.3)
  const summaryMins  = dur - conceptMins - applyMins

  return [{
    session_title:   topic.title,
    session_summary: `Understand and apply the core concepts of ${topic.title}.`,
    duration_mins:   dur,
    subtopics: [
      {
        title:              'Core concepts',
        type:               'concept',
        duration_mins:      conceptMins,
        learning_objective: `Understand the fundamentals of ${topic.title}`,
      },
      {
        title:              'Real-world application',
        type:               'application',
        duration_mins:      applyMins,
        learning_objective: `Apply ${topic.title} concepts in your day-to-day work`,
      },
      {
        title:              'Key takeaways',
        type:               'summary',
        duration_mins:      Math.max(summaryMins, 2),
        learning_objective: `Summarise what matters most from ${topic.title}`,
      },
    ],
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
  // 4 subtopics per session → ~10 min content (2.5 min each) + 5 min Q&A = 15 min total
  const SUBTOPICS_PER_SESSION = 4
  const chunks = chunkArray(subtopics, SUBTOPICS_PER_SESSION)
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
2. If concepts run short of ${floor} min, ADD depth segments — never send the learner away early
3. Each session ends at a complete thought — learner stops feeling satisfied, not cut off
4. Session titles must be specific and descriptive, never "Part 1" or "Introduction"
5. 2–5 subtopics or depth segments per session

Depth segment types you may add when sessions run short:
- example: a worked real-world scenario relevant to ${profile.industry} (3–4 min)
- application: how this applies specifically to a ${profile.role} (2–3 min)
- pitfalls: common mistakes executives make and how to avoid them (2–3 min)
- practice: a concrete action the learner can take today (2 min)
- summary: key takeaways and a decision framework (2–3 min)

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
