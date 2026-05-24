/**
 * Step 1 of the content pipeline — generates a content outline per subtopic
 * that explicitly references what the user has already learned in previous
 * sessions, so Clio never repeats material.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabase'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface SubtopicOutline {
  subtopic_title: string
  subtopic_slug: string
  position: 'first' | 'middle' | 'last'
  content_summary: string
  key_concepts: string[]
  builds_on: string[]           // titles of previously taught concepts being extended
  new_to_user: boolean          // false = topic was covered before at introductory level
}

export interface SessionContentOutline {
  session_id: string
  topic_id: string
  topic_title: string
  subtopics: SubtopicOutline[]
  previous_sessions_summarized: string
  generated_at: string
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 60)
}

/**
 * Fetches all completed session titles and their subtopics for a user.
 * Used to build the "already covered" context passed to Claude.
 */
async function getPreviousSessionsContext(userId: string, currentSessionId: string): Promise<string> {
  try {
    const supabase = createSupabaseAdminClient()

    const { data: sessions } = await supabase
      .from('sessions')
      .select('session_title, topics, session_plan, notes')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .neq('id', currentSessionId)
      .order('ended_at', { ascending: false })
      .limit(10)

    if (!sessions || sessions.length === 0) return 'No previous sessions. This is the first session for this user.'

    const summaries = sessions.map((s) => {
      const title = s.session_title ?? 'Untitled session'
      const topics = Array.isArray(s.topics) && s.topics.length > 0
        ? s.topics.join(', ')
        : 'topics not recorded'
      return `• ${title}: covered [${topics}]`
    })

    return `Previously completed sessions:\n${summaries.join('\n')}`
  } catch {
    return 'Previous session history unavailable.'
  }
}

/**
 * Fetches existing content outlines from the cache for the same topic.
 * If content was already generated (possibly for another user), extract key concepts
 * to avoid repetition in this session.
 */
async function getExistingTopicContent(topicId: string): Promise<string> {
  try {
    const supabase = createSupabaseAdminClient()
    const { data } = await supabase
      .from('topic_content_cache')
      .select('subtopic_title, content_outline')
      .eq('topic_id', topicId)
      .not('content_outline', 'is', null)
      .limit(20)

    if (!data || data.length === 0) return ''

    const lines = data.map((row) => {
      const outline = row.content_outline as SubtopicOutline | null
      const concepts = outline?.key_concepts?.join(', ') ?? ''
      return `  • ${row.subtopic_title}${concepts ? `: ${concepts}` : ''}`
    })

    return `Previously generated content for this topic:\n${lines.join('\n')}`
  } catch {
    return ''
  }
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Generates a content outline for all subtopics in a session.
 * References the user's session history so each subtopic builds on — not repeats —
 * what they already know.
 *
 * @param sessionId        - The session being prepared
 * @param topicId          - Topic catalog ID (e.g. "ai-fundamentals")
 * @param topicTitle       - Human-readable topic title
 * @param subtopicTitles   - Ordered list of subtopic titles for this session
 * @param userId           - The user's ID (used to fetch session history)
 * @param userContext      - Role, industry, maturity for personalisation
 */
export async function generateSessionContentOutline(
  sessionId: string,
  topicId: string,
  topicTitle: string,
  subtopicTitles: string[],
  userId: string,
  userContext: { role: string; industry: string; maturity: string }
): Promise<SessionContentOutline> {
  const [previousContext, existingContent] = await Promise.all([
    getPreviousSessionsContext(userId, sessionId),
    getExistingTopicContent(topicId),
  ])

  if (!anthropic) {
    // Mock mode — return realistic placeholder outlines
    console.log('[MOCK] session-content-generator: returning mock content outline')
    const subtopics: SubtopicOutline[] = subtopicTitles.map((title, i) => ({
      subtopic_title: title,
      subtopic_slug: slugify(title),
      position: i === 0 ? 'first' : i === subtopicTitles.length - 1 ? 'last' : 'middle',
      content_summary: `An executive-level introduction to ${title}, tailored for ${userContext.role}s in ${userContext.industry}. Covers the strategic implications and key decision points without deep technical detail.`,
      key_concepts: [
        `What ${title.split(' ').slice(0, 3).join(' ')} means for your organisation`,
        'Common implementation pitfalls and how to avoid them',
        'The 2-3 decisions you need to make in the next quarter',
      ],
      builds_on: i > 0 ? [subtopicTitles[i - 1]] : [],
      new_to_user: true,
    }))
    return {
      session_id: sessionId,
      topic_id: topicId,
      topic_title: topicTitle,
      subtopics,
      previous_sessions_summarized: previousContext,
      generated_at: new Date().toISOString(),
    }
  }

  const prompt = `You are preparing content for an AI coaching session for a senior executive.

USER CONTEXT
Role: ${userContext.role}
Industry: ${userContext.industry}
AI Maturity: ${userContext.maturity}

SESSION TOPIC: ${topicTitle}
SUBTOPICS TO COVER (in order):
${subtopicTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

LEARNING HISTORY
${previousContext}

${existingContent ? `EXISTING CONTENT FOR THIS TOPIC\n${existingContent}\n` : ''}

TASK
For each subtopic, generate a focused content outline. Each subtopic should:
- BUILD ON what was previously covered (reference it briefly, don't repeat it)
- Be calibrated to this user's role and industry
- Stay actionable and concrete — no academic explanations
- Identify the 2-3 core concepts the executive must leave knowing

Return ONLY valid JSON matching this exact schema (no markdown, no commentary):
{
  "subtopics": [
    {
      "subtopic_title": "exact subtopic title from the list above",
      "content_summary": "2-3 sentences: what this section covers and why it matters to this executive",
      "key_concepts": ["concept 1", "concept 2", "concept 3"],
      "builds_on": ["title of previous subtopic or session topic this connects to"],
      "new_to_user": true
    }
  ],
  "previous_sessions_summarized": "1 sentence summary of what this user already knows"
}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })

  let raw = (message.content[0] as { type: string; text: string }).text.trim()
  // Strip markdown code fences that Claude sometimes wraps around JSON
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const json = JSON.parse(raw) as {
    subtopics: Array<{
      subtopic_title: string
      content_summary: string
      key_concepts: string[]
      builds_on: string[]
      new_to_user: boolean
    }>
    previous_sessions_summarized: string
  }

  const subtopics: SubtopicOutline[] = json.subtopics.map((s, i) => ({
    ...s,
    subtopic_slug: slugify(s.subtopic_title),
    position: i === 0 ? 'first' : i === subtopicTitles.length - 1 ? 'last' : 'middle',
  }))

  return {
    session_id: sessionId,
    topic_id: topicId,
    topic_title: topicTitle,
    subtopics,
    previous_sessions_summarized: json.previous_sessions_summarized,
    generated_at: new Date().toISOString(),
  }
}
