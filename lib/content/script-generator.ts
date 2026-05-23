/**
 * Step 2 of the content pipeline — generates a training script per subtopic.
 *
 * Script format: TEACH → CHECKPOINT → PROBE → CONTINUE
 * - TEACH: 2-3 minutes of clear, jargon-free explanation
 * - CHECKPOINT: a question to verify understanding before proceeding
 * - PROBE: a follow-up if the executive seems uncertain
 * - CONTINUE: a bridge statement that connects to the next concept
 *
 * Clio reads this script verbatim during live sessions, adapting tone based
 * on the executive's responses.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { SubtopicOutline } from './session-content-generator'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type ScriptSegmentType = 'TEACH' | 'CHECKPOINT' | 'PROBE' | 'CONTINUE'

export interface ScriptSegment {
  type: ScriptSegmentType
  content: string
  duration_seconds?: number
}

export interface TrainingScript {
  subtopic_title: string
  subtopic_slug: string
  segments: ScriptSegment[]
  total_duration_seconds: number
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

function buildMockScript(outline: SubtopicOutline): TrainingScript {
  const concepts = outline.key_concepts.slice(0, 2).join(' and ')
  return {
    subtopic_title: outline.subtopic_title,
    subtopic_slug: outline.subtopic_slug,
    segments: [
      {
        type: 'TEACH',
        content: `Let me walk you through ${outline.subtopic_title}. ${outline.content_summary} The key thing to understand here is ${concepts}. Think of it this way — the executives who get this right aren't the ones who understand the technology deepest, they're the ones who ask the right questions and set the right conditions for their teams to succeed.`,
        duration_seconds: 120,
      },
      {
        type: 'CHECKPOINT',
        content: `Before we go further — how does this land for you? Can you see where ${outline.key_concepts[0] ?? 'this concept'} would apply in your current situation?`,
        duration_seconds: 20,
      },
      {
        type: 'PROBE',
        content: `No problem if it's not fully clear yet — let me try a different angle. ${outline.builds_on.length > 0 ? `You'll remember we talked about ${outline.builds_on[0]} — this is the same idea applied one level up.` : 'The simplest way to think about it is through an example from your own industry.'} Does that framing help?`,
        duration_seconds: 30,
      },
      {
        type: 'CONTINUE',
        content: `Good. Let's hold that — we'll come back to it when it becomes concrete. What I want you to take from this section is simple: ${outline.key_concepts[0] ?? outline.content_summary.split('.')[0]}. Keep that in mind as we move on.`,
        duration_seconds: 20,
      },
    ],
    total_duration_seconds: 190,
  }
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Generates a training script for a single subtopic.
 * The script is structured as TEACH → CHECKPOINT → PROBE → CONTINUE
 * so Clio can pace the session and verify understanding at each step.
 *
 * @param outline     - Content outline from Step 1 (session-content-generator)
 * @param userContext - Role, industry, maturity for tone calibration
 */
export async function generateTrainingScript(
  outline: SubtopicOutline,
  userContext: { role: string; industry: string; maturity: string }
): Promise<TrainingScript> {
  if (!anthropic) {
    console.log('[MOCK] script-generator: returning mock script for', outline.subtopic_title)
    return buildMockScript(outline)
  }

  const maturityNote = userContext.maturity === 'beginner'
    ? 'Use plain language and analogy. Avoid any technical terms without defining them first.'
    : userContext.maturity === 'intermediate'
    ? 'Assume familiarity with AI concepts. Focus on strategic application over explanation.'
    : 'Skip introductory definitions. Focus on nuance, edge cases, and board-level implications.'

  const prompt = `You are Clio — an AI executive coach. You are scripting a 2-3 minute coaching segment for a live session.

EXECUTIVE PROFILE
Role: ${userContext.role}
Industry: ${userContext.industry}
AI Maturity: ${userContext.maturity}
Calibration: ${maturityNote}

SUBTOPIC: ${outline.subtopic_title}
SUMMARY: ${outline.content_summary}
KEY CONCEPTS TO COVER: ${outline.key_concepts.join(', ')}
${outline.builds_on.length > 0 ? `BUILDS ON: ${outline.builds_on.join(', ')}` : ''}

SCRIPT REQUIREMENTS
Write the script in first-person as Clio speaking directly to the executive.
Use natural spoken language — contractions, short sentences, confident tone.
Sound like a trusted peer, not a teacher or consultant.
No jargon without immediate plain-English translation.

Write exactly 4 segments in this order:

1. TEACH (90-150 seconds of spoken content)
   - Open with why this matters to them specifically
   - Explain the concept with a concrete example from their industry
   - End with the one thing they must remember

2. CHECKPOINT (15-25 seconds — one focused question)
   - Check understanding, not just recall
   - The question should reveal whether they can apply the concept

3. PROBE (20-35 seconds — follow-up if they're uncertain)
   - A different angle or simpler reframe
   - Reference something from previous sessions if possible: ${outline.builds_on.join(', ') || 'none'}

4. CONTINUE (15-25 seconds — bridge to next concept)
   - Summarise the one key insight they should hold
   - Create anticipation for what comes next

Return ONLY valid JSON (no markdown, no commentary):
{
  "segments": [
    { "type": "TEACH", "content": "...", "duration_seconds": 120 },
    { "type": "CHECKPOINT", "content": "...", "duration_seconds": 20 },
    { "type": "PROBE", "content": "...", "duration_seconds": 30 },
    { "type": "CONTINUE", "content": "...", "duration_seconds": 20 }
  ]
}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = (message.content[0] as { type: string; text: string }).text.trim()
  const json = JSON.parse(raw) as { segments: ScriptSegment[] }

  const total = json.segments.reduce((sum, s) => sum + (s.duration_seconds ?? 30), 0)

  return {
    subtopic_title: outline.subtopic_title,
    subtopic_slug: outline.subtopic_slug,
    segments: json.segments,
    total_duration_seconds: total,
  }
}

/**
 * Generates training scripts for all subtopics in parallel.
 * Limits concurrency to avoid overwhelming the Claude API.
 */
export async function generateAllTrainingScripts(
  outlines: SubtopicOutline[],
  userContext: { role: string; industry: string; maturity: string }
): Promise<TrainingScript[]> {
  // Run in batches of 3 to stay within API rate limits
  const results: TrainingScript[] = []
  const BATCH_SIZE = 3

  for (let i = 0; i < outlines.length; i += BATCH_SIZE) {
    const batch = outlines.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map((outline) => generateTrainingScript(outline, userContext))
    )
    results.push(...batchResults)
  }

  return results
}
