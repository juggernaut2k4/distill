/**
 * LIVE-01 — two-layer content generation for the script-less live conductor path.
 *
 * This is a NEW file, not a modification of lib/content/session-content-generator.ts
 * or lib/content/script-generator.ts (both remain byte-for-byte untouched — the old
 * script-generation path must keep working exactly as it does today when the
 * NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED toggle is off).
 *
 * Two layers, per the resolved spec (Section 11 / Known Constraint 1):
 *   1. generateTopicBackground — whole-topic background, ~1,500-2,000 words,
 *      generated ONCE per session. Fixed for the entire session; does not change
 *      as tabs advance.
 *   2. buildLiveConductorTabs — per-tab content chunks. Reuses
 *      generateContentArticles() as-is (it already produces exactly this: rich
 *      substance, no script) rather than duplicating its logic.
 */

import Anthropic from '@anthropic-ai/sdk'
import { generateContentArticles, type ContentArticle, type UserContext } from './session-content-generator'
import {
  LIVE_CONDUCTOR_TOPIC_BACKGROUND_WORD_TARGET_MIN,
  LIVE_CONDUCTOR_TOPIC_BACKGROUND_WORD_TARGET_MAX,
} from './live-conductor-prompt'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface LiveConductorTab {
  subtopic_slug: string
  subtopic_title: string
  article: ContentArticle
}

export interface LiveConductorContent {
  topic_background: string
  tabs: LiveConductorTab[]
  generated_at: string
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

// ─── LAYER 1: whole-topic background (generated once per session) ───────────

/**
 * Generates the whole-topic background layer — a single ~1,500-2,000 word
 * synthesis across all subtopics/ContentArticles for the session. This is fixed
 * context for the entire live conversation: it does not change as tabs advance,
 * and it is what lets Clio answer questions that go beyond the current tab.
 *
 * @param topicTitle    - Human-readable session/topic title
 * @param articles      - The per-subtopic ContentArticles already generated for
 *                        this session (Step C of the existing pipeline) — used as
 *                        source material so this layer never contradicts the
 *                        per-tab content built from the same articles.
 * @param userContext   - Role, industry, maturity, roleLevel for personalisation
 */
export async function generateTopicBackground(
  topicTitle: string,
  articles: ContentArticle[],
  userContext: UserContext
): Promise<string> {
  if (!anthropic) {
    console.log('[MOCK] live-conductor-content: returning mock topic background')
    const subtopicList = articles.map((a) => `- ${a.subtopic_title}: ${a.sections.overview}`).join('\n')
    return `TOPIC BACKGROUND — ${topicTitle}\n\n` +
      `This session covers ${articles.length} interconnected areas for a ${userContext.role} in ` +
      `${userContext.industry}: ${articles.map((a) => a.subtopic_title).join(', ')}.\n\n` +
      `${subtopicList}\n\n` +
      `Across all of these, the throughline is that ${userContext.role}s in ${userContext.industry} ` +
      `need enough working knowledge to ask sharp questions and make sound decisions — not to become ` +
      `practitioners themselves. Key facts, mechanisms, and enterprise implications for each area are ` +
      `available above; use them to answer questions the participant raises even if they range beyond ` +
      `whatever tab is currently active.`
  }

  const subtopicSummaries = articles
    .map((a, i) => {
      return [
        `### ${i + 1}. ${a.subtopic_title}`,
        `Overview: ${a.sections.overview}`,
        `Key facts: ${a.sections.key_facts.join(' | ')}`,
        `How it works: ${a.sections.how_it_works}`,
        `Enterprise implications: ${a.sections.enterprise_implications}`,
        `Common misconceptions: ${a.sections.common_misconceptions.join(' | ')}`,
        `Role relevance: ${a.role_relevance}`,
        `Industry angle: ${a.industry_angle}`,
      ].join('\n')
    })
    .join('\n\n')

  const prompt = `You are preparing background reference material for a live AI voice coaching session.

USER CONTEXT
Role: ${userContext.role}
Industry: ${userContext.industry}
AI Maturity: ${userContext.maturity}

SESSION TOPIC: ${topicTitle}

SOURCE MATERIAL (per-subtopic articles already prepared for this session):
${subtopicSummaries}

TASK
Synthesize the source material above into ONE continuous whole-topic background document,
${LIVE_CONDUCTOR_TOPIC_BACKGROUND_WORD_TARGET_MIN}-${LIVE_CONDUCTOR_TOPIC_BACKGROUND_WORD_TARGET_MAX} words.

This document is given to a live voice AI as its full working knowledge for the entire session — it
does NOT change as the session progresses through tabs. Its purpose is to let the AI:
- Teach any part of this topic naturally and conversationally, in its own words (not read verbatim).
- Answer follow-up questions that go beyond whatever specific tab is currently active.

Requirements:
- Cover every subtopic above, connected into a coherent narrative — not a disjointed list.
- Preserve the concrete facts, numbers, mechanisms, and enterprise implications from the source
  material; do not water them down into vague generalities.
- Write in plain prose (not bullet points) so it reads naturally as background knowledge.
- Calibrate depth and framing to the user's role and industry given above.
- Do not include any spoken-style phrasing ("let me tell you", "so what this means for you") — this
  is reference material for the AI to draw from, not a script for it to say aloud.

Return ONLY the background document text — no headers, no JSON, no commentary.`

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = (message.content[0] as { type: string; text: string }).text.trim()
    return text || buildFallbackBackground(topicTitle, articles, userContext)
  } catch (err) {
    console.error('[live-conductor-content] generateTopicBackground failed, using fallback:', err)
    return buildFallbackBackground(topicTitle, articles, userContext)
  }
}

function buildFallbackBackground(topicTitle: string, articles: ContentArticle[], userContext: UserContext): string {
  // Non-LLM fallback: concatenate the article sections directly. Not as polished
  // as a synthesized narrative, but never empty and never blocks the session.
  return [
    `Background for "${topicTitle}" — prepared for a ${userContext.role} in ${userContext.industry}.`,
    ...articles.map((a) =>
      [
        `${a.subtopic_title}: ${a.sections.overview} ${a.sections.how_it_works} ${a.sections.enterprise_implications}`,
      ].join(' ')
    ),
  ].join('\n\n')
}

// ─── LAYER 2: per-tab content (reuses generateContentArticles as-is) ────────

/**
 * Builds the per-tab content layer for the live conductor. Deliberately reuses
 * generateContentArticles() unmodified — it already produces exactly what this
 * path needs (rich substance, no script) — rather than duplicating that logic
 * in a parallel function.
 *
 * @param sessionId       - The session being prepared (passed through to
 *                          generateContentArticles for history lookups)
 * @param topicId         - Topic catalog ID
 * @param topicTitle      - Human-readable topic title
 * @param subtopicTitles  - Ordered list of subtopic titles for this session
 * @param userId          - The user's ID
 * @param userContext     - Role, industry, maturity, roleLevel for personalisation
 */
export async function buildLiveConductorTabs(
  sessionId: string,
  topicId: string,
  topicTitle: string,
  subtopicTitles: string[],
  userId: string,
  userContext: UserContext
): Promise<{ tabs: LiveConductorTab[]; articles: ContentArticle[] }> {
  const articles = await generateContentArticles(
    sessionId,
    topicId,
    topicTitle,
    subtopicTitles,
    userId,
    userContext
  )

  const tabs: LiveConductorTab[] = articles.map((article) => ({
    subtopic_slug: article.subtopic_slug,
    subtopic_title: article.subtopic_title,
    article,
  }))

  return { tabs, articles }
}

/**
 * Convenience wrapper: runs both layers and returns the full LiveConductorContent
 * shape that gets stored on sessions.live_conductor_content (see migration
 * 054_live_conductor_state.sql). Layer 2 runs first since Layer 1's synthesis
 * prompt uses the same articles as source material — this keeps both layers
 * consistent with each other and avoids a second, divergent LLM call sequence.
 */
export async function generateLiveConductorContent(
  sessionId: string,
  topicId: string,
  topicTitle: string,
  subtopicTitles: string[],
  userId: string,
  userContext: UserContext
): Promise<LiveConductorContent> {
  const { tabs, articles } = await buildLiveConductorTabs(
    sessionId,
    topicId,
    topicTitle,
    subtopicTitles,
    userId,
    userContext
  )

  const topicBackground = await generateTopicBackground(topicTitle, articles, userContext)

  return {
    topic_background: topicBackground,
    tabs,
    generated_at: new Date().toISOString(),
  }
}

/**
 * Formats a single tab's ContentArticle into plain text for injection into the
 * live conductor's system prompt as "CURRENT TAB CONTENT". Swapped wholesale on
 * every advance_tab call — see lib/voice/live-conductor-bridge.ts.
 */
export function formatTabContentForPrompt(tab: LiveConductorTab): string {
  const a = tab.article
  return [
    `TAB: ${tab.subtopic_title}`,
    ``,
    `Overview: ${a.sections.overview}`,
    ``,
    `Key facts: ${a.sections.key_facts.map((f) => `- ${f}`).join('\n')}`,
    ``,
    `How it works: ${a.sections.how_it_works}`,
    ``,
    `Enterprise implications: ${a.sections.enterprise_implications}`,
    ``,
    `Common misconceptions: ${a.sections.common_misconceptions.map((m) => `- ${m}`).join('\n')}`,
    ``,
    `Decision questions worth raising: ${a.sections.decision_questions.map((q) => `- ${q}`).join('\n')}`,
    ``,
    `Illustrative example: ${a.sections.illustrative_example}`,
    ``,
    `Try this: ${a.sections.try_this}`,
    ``,
    `Role relevance: ${a.role_relevance}`,
    `Industry angle: ${a.industry_angle}`,
  ].join('\n')
}
