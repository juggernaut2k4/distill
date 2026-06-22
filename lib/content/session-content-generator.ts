/**
 * Step 1 of the content pipeline — generates a content outline per subtopic
 * that explicitly references what the user has already learned in previous
 * sessions, so Clio never repeats material.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabase'

// ─── TYPES ────────────────────────────────────────────────────────────────────

// SubSessionOutline: content outline for one tab (sub-session) within a live session.
// Stored as sessions.subtopics in DB — column rename pending TERM-01.
export interface SubSessionOutline {
  subtopic_title: string
  subtopic_slug: string
  position: 'first' | 'middle' | 'last'
  content_summary: string
  key_concepts: string[]
  builds_on: string[]           // titles of previously taught concepts being extended
  new_to_user: boolean          // false = topic was covered before at introductory level
  coaching_narrative: string    // full spoken explanation Clio delivers (~300 words)
  visual_spec: {
    headline: string            // max 8 words — visual section title
    items: string[]             // 3–5 named items shown on screen (steps, quadrants, etc.)
    template_hint: string       // suggested template type for the visual
    so_what: string             // max 30 words personalised to role/industry
  }
  checkpoint_question: string   // single question Clio asks to verify understanding
}

export interface SessionContentOutline {
  session_id: string
  topic_id: string
  topic_title: string
  subtopics: SubSessionOutline[]
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
      const outline = row.content_outline as SubSessionOutline | null
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
  userContext: { role: string; industry: string; maturity: string; roleLevel: string }
): Promise<SessionContentOutline> {
  const [previousContext, existingContent] = await Promise.all([
    getPreviousSessionsContext(userId, sessionId),
    getExistingTopicContent(topicId),
  ])

  if (!anthropic) {
    // Mock mode — return realistic placeholder outlines
    console.log('[MOCK] session-content-generator: returning mock content outline')
    // subSessions: tabs within this session (stored as sessions.subtopics in DB — column rename pending TERM-01)
    const subSessions: SubSessionOutline[] = subtopicTitles.map((title, i) => ({
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
      coaching_narrative: `Let me walk you through ${title}. This is one of the most important concepts for ${userContext.role}s in ${userContext.industry} to understand right now. The executives who get this right aren't the ones who understand the technology deepest — they're the ones who ask the right questions. Here's what you need to know: first, the fundamentals matter more than the vendor pitch. Second, implementation always takes longer than the demo suggests. Third, governance must come before scale. Keep those three things in mind and you'll avoid the most common and costly mistakes.`,
      visual_spec: {
        headline: `${title.split(' ').slice(0, 5).join(' ')}`,
        items: [
          `What ${title.split(' ').slice(0, 3).join(' ')} means for your org`,
          'Common pitfalls and how to avoid them',
          'The decisions you must make this quarter',
        ],
        template_hint: 'KeyTakeaway',
        so_what: `As a ${userContext.role}, focus on governance first and technology second.`,
      },
      checkpoint_question: `Before we move on — where do you see the biggest gap between where your organisation is today and where it needs to be on ${title.split(' ').slice(0, 3).join(' ')}?`,
    }))
    return {
      session_id: sessionId,
      topic_id: topicId,
      topic_title: topicTitle,
      subtopics: subSessions,
      previous_sessions_summarized: previousContext,
      generated_at: new Date().toISOString(),
    }
  }

  const roleLevelInstruction: Record<string, string> = {
    'c-suite':   'Frame all content for a leader who approves budgets, sponsors AI initiatives, and answers to the board. Examples must involve strategic decisions, not implementation choices.',
    'vp-dir':    'Frame all content for a function leader who owns team adoption and reports outcomes to the C-Suite. Examples must involve managing upward (presenting to executives) and downward (enabling their team). Do NOT use board-level or P&L-authority framing.',
    'manager':   'Frame all content for a team lead implementing AI tools day-to-day. Examples should be hands-on and practical. Avoid board-level or C-Suite strategic framing.',
    'specialist':'Frame all content for a practitioner who uses AI tools directly. Examples should be technical and applied.',
  }

  const prompt = `You are preparing content for an AI coaching session for a senior executive.

USER CONTEXT
Role: ${userContext.role}
Industry: ${userContext.industry}
AI Maturity: ${userContext.maturity}
Seniority: ${userContext.roleLevel} — ${roleLevelInstruction[userContext.roleLevel] ?? ''}

SESSION TOPIC: ${topicTitle}
SUBTOPICS TO COVER (in order):
${subtopicTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

LEARNING HISTORY
${previousContext}

${existingContent ? `EXISTING CONTENT FOR THIS TOPIC\n${existingContent}\n` : ''}

TASK
For each subtopic, generate a complete content document that serves as the single source of truth for both the visual slide and the voice coaching script.

Each subtopic must include:
1. A content_summary (what and why)
2. key_concepts (2-3 core ideas)
3. coaching_narrative (the full spoken explanation Clio delivers — 250-350 words in natural spoken language)
4. visual_spec (defines EXACTLY what will appear on screen — the script MUST reference these items by name)
5. checkpoint_question (one focused question to verify understanding)

The coaching_narrative and visual_spec must be in sync: visual_spec.items are the exact items Clio names while teaching.

Return ONLY valid JSON matching this exact schema (no markdown, no commentary):
{
  "subtopics": [
    {
      "subtopic_title": "exact subtopic title from the list above",
      "content_summary": "2-3 sentences: what this section covers and why it matters to this executive",
      "key_concepts": ["concept 1", "concept 2", "concept 3"],
      "builds_on": ["title of previous subtopic or session topic this connects to"],
      "new_to_user": true,
      "coaching_narrative": "Full 250-350 word spoken narrative Clio delivers. Natural spoken language — contractions, short sentences, confident peer tone. Must explicitly name and explain every item in visual_spec.items. Must end with a clear takeaway.",
      "visual_spec": {
        "headline": "max 8 words — what appears as the visual section title",
        "items": ["Item 1 shown on screen", "Item 2 shown on screen", "Item 3 shown on screen"],
        "template_hint": "one of: StepFlow | FrameworkCard | TwoByTwoMatrix | ComparisonTable | CaseStudy | StatCallout | ProsCons | Timeline | KeyTakeaway | ConceptDefinition",
        "so_what": "max 30 words personalised insight starting with As a [role],"
      },
      "checkpoint_question": "Single focused question to verify the executive understood and can apply the concept"
    }
  ],
  "previous_sessions_summarized": "1 sentence summary of what this user already knows"
}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
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
      coaching_narrative: string
      visual_spec: {
        headline: string
        items: string[]
        template_hint: string
        so_what: string
      }
      checkpoint_question: string
    }>
    previous_sessions_summarized: string
  }

  // subSessions: tabs within this session (stored as sessions.subtopics in DB — column rename pending TERM-01)
  const subSessions: SubSessionOutline[] = json.subtopics.map((s, i) => ({
    ...s,
    // Use the original input title for slug so GET endpoint lookups always match.
    // Claude may paraphrase the title slightly; anchoring on the input prevents slug drift.
    subtopic_title: subtopicTitles[i] ?? s.subtopic_title,
    subtopic_slug: slugify(subtopicTitles[i] ?? s.subtopic_title),
    position: i === 0 ? 'first' : i === subtopicTitles.length - 1 ? 'last' : 'middle',
    // Guard against Claude omitting new fields
    coaching_narrative: s.coaching_narrative ?? s.content_summary,
    visual_spec: s.visual_spec ?? {
      headline: s.subtopic_title,
      items: s.key_concepts ?? [],
      template_hint: 'KeyTakeaway',
      so_what: '',
    },
    checkpoint_question: s.checkpoint_question ?? `How does this apply in your context?`,
  }))

  return {
    session_id: sessionId,
    topic_id: topicId,
    topic_title: topicTitle,
    subtopics: subSessions,
    previous_sessions_summarized: json.previous_sessions_summarized,
    generated_at: new Date().toISOString(),
  }
}
