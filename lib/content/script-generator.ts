/**
 * Step 3 of the content pipeline — generates a training script per subtopic.
 *
 * Script format: TEACH → CHECKPOINT → PROBE → CONTINUE
 * - TEACH: 2-3 minutes of spoken coaching aligned to the visual on screen
 * - CHECKPOINT: a question to verify understanding before proceeding
 * - PROBE: a follow-up if the executive seems uncertain
 * - CONTINUE: a bridge statement that connects to the next concept
 *
 * Both this script (Step 3) and the visual template (Step 2) are derived from
 * the enriched SubtopicOutline produced in Step 1. They share coaching_narrative
 * and visual_spec as the single source of truth, ensuring Clio's words always
 * align with what appears on screen.
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
  const items = outline.visual_spec?.items ?? outline.key_concepts.slice(0, 2)
  const itemList = items.slice(0, 3).join(', ')
  return {
    subtopic_title: outline.subtopic_title,
    subtopic_slug: outline.subtopic_slug,
    segments: [
      {
        type: 'TEACH',
        content: outline.coaching_narrative ?? `Let me walk you through ${outline.subtopic_title}. ${outline.content_summary} On your screen you can see ${itemList}. Let's work through each of these. The executives who get this right aren't the ones who understand the technology deepest — they're the ones who ask the right questions and set the right conditions for their teams to succeed.`,
        duration_seconds: 120,
      },
      {
        type: 'CHECKPOINT',
        content: outline.checkpoint_question ?? `Before we go further — how does this land for you? Can you see where ${items[0] ?? 'this concept'} would apply in your current situation?`,
        duration_seconds: 20,
      },
      {
        type: 'PROBE',
        content: `No problem if it's not fully clear yet — let me try a different angle. ${outline.builds_on.length > 0 ? `You'll remember we talked about ${outline.builds_on[0]} — this is the same idea applied one level up.` : 'The simplest way to think about it is through an example from your own industry.'} Does that framing help?`,
        duration_seconds: 30,
      },
      {
        type: 'CONTINUE',
        content: `Good. Let's hold that — we'll come back to it when it becomes concrete. What I want you to take from this section is simple: ${outline.visual_spec?.so_what ?? outline.content_summary.split('.')[0]}. Keep that in mind as we move on.`,
        duration_seconds: 20,
      },
    ],
    total_duration_seconds: 190,
  }
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Generates a training script for a single subtopic.
 *
 * Uses coaching_narrative and visual_spec from the enriched SubtopicOutline
 * produced in Step 1 — the same source that drives the visual template.
 * This guarantees Clio's words always align with what appears on screen.
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

  const visualItems = outline.visual_spec?.items ?? outline.key_concepts
  const visualItemList = visualItems.map((item, i) => `  ${i + 1}. ${item}`).join('\n')

  const prompt = `You are Clio — an AI executive coach. You are scripting a 2-3 minute coaching segment for a live session.

EXECUTIVE PROFILE
Role: ${userContext.role}
Industry: ${userContext.industry}
AI Maturity: ${userContext.maturity}
Calibration: ${maturityNote}

SUBTOPIC: ${outline.subtopic_title}
SUMMARY: ${outline.content_summary}

WHAT IS SHOWN ON SCREEN (your script MUST reference these items by name)
Visual headline: "${outline.visual_spec?.headline ?? outline.subtopic_title}"
Items displayed on screen:
${visualItemList}
So what shown on screen: "${outline.visual_spec?.so_what ?? ''}"

COACHING NARRATIVE (your source of truth — expand on this, do not invent new content)
${outline.coaching_narrative ?? outline.content_summary}
${outline.builds_on.length > 0 ? `\nBUILDS ON: ${outline.builds_on.join(', ')}` : ''}

SCRIPT REQUIREMENTS
Write in first-person as Clio speaking directly to the executive.
Use natural spoken language — contractions, short sentences, confident peer tone.
Sound like a trusted colleague, not a teacher or consultant.

CRITICAL ALIGNMENT RULE: Your TEACH segment must walk through each item shown on screen by name.
The executive is looking at: ${visualItems.join(' | ')}
Reference them explicitly as you explain — Clio speaks to what is visible on screen.

Write exactly 4 segments in this order:

1. TEACH (90-150 seconds of spoken content)
   - Open with why this matters to them specifically
   - Walk through each visual item on screen by name — explain it, don't skip any
   - Use a concrete example from their industry where possible
   - End with the one thing they must remember

2. CHECKPOINT (15-25 seconds — use this exact question or a close variant)
   ${outline.checkpoint_question ?? 'Check understanding, not just recall — ask a question that reveals whether they can apply the concept'}

3. PROBE (20-35 seconds — follow-up if they're uncertain)
   - A different angle or simpler reframe
   - Reference something from previous sessions if possible: ${outline.builds_on.join(', ') || 'none'}

4. CONTINUE (15-25 seconds — bridge to next concept)
   - Summarise the one key insight they should hold
   - Reference the so_what: "${outline.visual_spec?.so_what ?? ''}"
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

  let raw = (message.content[0] as { type: string; text: string }).text.trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
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
