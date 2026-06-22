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
 * the enriched SubSessionOutline produced in Step 1. They share coaching_narrative
 * and visual_spec as the single source of truth, ensuring Clio's words always
 * align with what appears on screen.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { SubSessionOutline } from './session-content-generator'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type ScriptSegmentType = 'TEACH' | 'CHECKPOINT' | 'PROBE' | 'CONTINUE' | 'CLOSE'

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

function buildMockScript(outline: SubSessionOutline, sessionCtx?: { allSubtopics: string[]; nextSessionTopic?: string }): TrainingScript {
  const items = outline.visual_spec?.items ?? outline.key_concepts.slice(0, 2)
  const itemList = items.slice(0, 3).join(', ')
  const isLast = outline.position === 'last'
  const segments: ScriptSegment[] = [
    {
      type: 'TEACH',
      content: outline.coaching_narrative ?? `Let me walk you through ${outline.subtopic_title}. ${outline.content_summary} On your screen you can see ${itemList}. Let's work through each one carefully. ${items[0] ? `Starting with ${items[0]} — this is foundational.` : ''} ${items[1] ? `Then ${items[1]}, which builds directly on what we just covered.` : ''} ${items[2] ? `Finally, ${items[2]} — this is where most executives find the highest leverage.` : ''} The executives who get this right aren't the ones who understand the technology deepest — they're the ones who ask the right questions and set the right conditions for their teams to succeed. Here's what that looks like in practice: you're not choosing a technology, you're choosing a capability trajectory. That distinction changes every decision downstream.`,
      duration_seconds: 360,
    },
    {
      type: 'CHECKPOINT',
      content: outline.checkpoint_question ?? `Before we go further — how does this land for you? Where do you see the biggest gap between where your organisation is today and where it needs to be on ${outline.subtopic_title}?`,
      duration_seconds: 75,
    },
    {
      type: 'PROBE',
      content: `No problem if it's not fully clear yet — let me try a different angle. ${outline.builds_on.length > 0 ? `You'll remember we talked about ${outline.builds_on[0]} — this is the same idea applied one level up.` : 'The simplest way to think about it is through an analogy from your own industry.'} The question isn't whether to act — it's how to act without creating more risk than you solve. Does that framing help?`,
      duration_seconds: 75,
    },
    {
      type: 'CONTINUE',
      content: `Good. Let's lock that in. ${outline.visual_spec?.so_what ?? outline.content_summary.split('.')[0]}. Keep that in mind — we'll build on it in the next section.`,
      duration_seconds: 75,
    },
  ]
  if (isLast) {
    const covered = sessionCtx?.allSubtopics?.join(', ') ?? outline.subtopic_title
    const next = sessionCtx?.nextSessionTopic
    segments.push({
      type: 'CLOSE',
      content: `That wraps up today's session. We've covered ${covered} — and you now have a clear framework for making decisions in this space without needing to be the technical expert in the room. As a ${outline.subtopic_title.split(' ')[0] ?? 'senior leader'}, you're now better equipped to ask the right questions, evaluate what you're being told, and set the conditions for your team to move with confidence.${next ? ` Next time, we'll be diving into ${next} — so you'll want to come prepared with any questions that came up today.` : ' Great work today.'}`,
      duration_seconds: 120,
    })
  }
  return {
    subtopic_title: outline.subtopic_title,
    subtopic_slug: outline.subtopic_slug,
    segments,
    total_duration_seconds: segments.reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0),
  }
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Generates a training script for a single subtopic.
 *
 * Canonical target: 10-12 minutes total per subtopic (for a 1-hour session with 5 subtopics).
 * The canonical script is condensed per-user to their session.duration_mins via adaptScriptToDuration.
 *
 * Uses coaching_narrative and visual_spec from the enriched SubSessionOutline
 * produced in Step 1 — the same source that drives the visual template.
 * This guarantees Clio's words always align with what appears on screen.
 *
 * @param outline       - SubSessionOutline from Step 1
 * @param userContext   - Role, industry, maturity for calibration
 * @param sessionCtx    - Optional: allSubtopics (for CLOSE summary) + nextSessionTopic (for teaser)
 */
export async function generateTrainingScript(
  outline: SubSessionOutline,
  userContext: { role: string; industry: string; maturity: string; roleLevel?: string; profileContext?: string },
  sessionCtx?: { allSubtopics: string[]; nextSessionTopic?: string }
): Promise<TrainingScript> {
  if (!anthropic) {
    console.log('[MOCK] script-generator: returning mock script for', outline.subtopic_title)
    return buildMockScript(outline, sessionCtx)
  }

  const maturityNote = userContext.maturity === 'beginner'
    ? 'Use plain language and analogy. Avoid any technical terms without defining them first.'
    : userContext.maturity === 'intermediate'
    ? 'Assume familiarity with AI concepts. Focus on strategic application over explanation.'
    : 'Skip introductory definitions. Focus on nuance, edge cases, and board-level implications.'

  const visualItems = outline.visual_spec?.items ?? outline.key_concepts
  const visualItemList = visualItems.map((item, i) => `  ${i + 1}. ${item}`).join('\n')

  const isLastSubtopic = outline.position === 'last'
  const nextTopic = sessionCtx?.nextSessionTopic
  const allSubtopicsList = sessionCtx?.allSubtopics?.join(', ') ?? outline.subtopic_title

  const closeInstruction = isLastSubtopic ? `
5. CLOSE (120 seconds — MANDATORY closing segment, always present regardless of session duration)
   This is the session wrap-up. Structure exactly as:
   - 3 sentences summarising what was learned across all subtopics today: ${allSubtopicsList}
   - 1 sentence of genuine encouragement tied to their role as a ${userContext.role} ("You now have...")
   - 1 sentence teaser for the next session${nextTopic ? `: "${nextTopic}"` : ''} ("Next time, we'll...")
   Keep it warm, confident, and brief. No new information. Pure close.` : ''

  // Inject the full learning profile if available — this is what makes scripts adaptive.
  // When profile_confidence=low, the profile block is omitted and maturity-level calibration is used.
  const profileBlock = userContext.profileContext
    ? `\n${userContext.profileContext}\n`
    : ''

  const prompt = `You are Clio — an AI executive coach scripting a 10-12 minute coaching segment.
This is the CANONICAL version — it covers the topic at full depth. It will be condensed for shorter sessions.

EXECUTIVE PROFILE
Role: ${userContext.role}
Industry: ${userContext.industry}
AI Maturity: ${userContext.maturity}
Calibration: ${maturityNote}${profileBlock}

SUBTOPIC: ${outline.subtopic_title}
POSITION: ${outline.position} (${isLastSubtopic ? 'last subtopic — include CLOSE segment' : 'not the last subtopic'})
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
- Write in first-person as Clio speaking directly to the executive
- Natural spoken language — contractions, short sentences, confident peer tone
- Sound like a trusted colleague, not a teacher or consultant
- CRITICAL: TEACH must walk through each screen item by name. Executive is looking at: ${visualItems.join(' | ')}

Write ${isLastSubtopic ? '5' : '4'} segments in this exact order:

1. TEACH (300-420 seconds of spoken content — 5-7 minutes, ~600-840 words)
   - Open with why this matters specifically to a ${userContext.role} in ${userContext.industry}
   - Walk through each on-screen item by name — explain it fully with examples, don't skip any
   - Use at least one concrete story or scenario from their industry
   - Go deep: give nuance, edge cases, real-world implications
   - End with the single most important takeaway

2. CHECKPOINT (60-90 seconds — probe for real understanding, not recall)
   ${outline.checkpoint_question ?? 'Ask a question that reveals whether they can apply the concept in their specific context'}

3. PROBE (60-90 seconds — follow-up if uncertain, different angle)
   - Reframe with a simpler analogy or different example
   - Reference something from previous sessions if possible: ${outline.builds_on.join(', ') || 'none'}

4. CONTINUE (60-90 seconds — bridge to next concept)
   - Lock in the key insight: "${outline.visual_spec?.so_what ?? ''}"
   - Create anticipation for what comes next without giving it away
${closeInstruction}

Return ONLY valid JSON (no markdown, no commentary):
{
  "segments": [
    { "type": "TEACH", "content": "...", "duration_seconds": 360 },
    { "type": "CHECKPOINT", "content": "...", "duration_seconds": 75 },
    { "type": "PROBE", "content": "...", "duration_seconds": 75 },
    { "type": "CONTINUE", "content": "...", "duration_seconds": 75 }${isLastSubtopic ? ',\n    { "type": "CLOSE", "content": "...", "duration_seconds": 120 }' : ''}
  ]
}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
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
 * Automatically builds sessionCtx so the last subtopic gets the CLOSE segment.
 */
export async function generateAllTrainingScripts(
  outlines: SubSessionOutline[],
  userContext: { role: string; industry: string; maturity: string; roleLevel?: string; profileContext?: string },
  nextSessionTopic?: string
): Promise<TrainingScript[]> {
  const allSubtopics = outlines.map((o) => o.subtopic_title)
  const results: TrainingScript[] = []
  const BATCH_SIZE = 3

  for (let i = 0; i < outlines.length; i += BATCH_SIZE) {
    const batch = outlines.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map((outline) =>
        generateTrainingScript(outline, userContext, { allSubtopics, nextSessionTopic })
      )
    )
    results.push(...batchResults)
  }

  return results
}

// ─── DURATION ADAPTATION ─────────────────────────────────────────────────────

/**
 * Condenses a canonical 1-hour training script to fit a user's actual session duration.
 *
 * Rules:
 * - Visuals are unchanged (handled at the template layer, not here)
 * - CLOSE segment is always preserved at full length (~120s) regardless of target
 * - TEACH is condensed: same concepts, fewer words, tighter sentences
 * - CHECKPOINT / PROBE / CONTINUE are trimmed proportionally
 * - The LLM must preserve every concept from the original — only reduce elaboration
 *
 * @param canonicalScript  - The full 1-hour script from the KB
 * @param targetMinutes    - User's session duration_mins
 * @param subtopicCount    - Total subtopics in the session (used to budget time per subtopic)
 * @param nextSessionTopic - Optional: teaser for CLOSE segment if the canonical didn't have one
 */
export async function adaptScriptToDuration(
  canonicalScript: TrainingScript,
  targetMinutes: number,
  subtopicCount: number,
  nextSessionTopic?: string
): Promise<TrainingScript> {
  // Budget time per subtopic, always reserving 2 min for CLOSE on the last subtopic
  const closeSeconds = 120
  const hasClose = canonicalScript.segments.some((s) => s.type === 'CLOSE')
  const availableSeconds = (targetMinutes * 60) / subtopicCount - (hasClose ? closeSeconds : 0)

  const canonicalSeconds = canonicalScript.segments
    .filter((s) => s.type !== 'CLOSE')
    .reduce((sum, s) => sum + (s.duration_seconds ?? 30), 0)

  // If already within 10% of target, return as-is
  if (Math.abs(canonicalSeconds - availableSeconds) / canonicalSeconds < 0.1) {
    return canonicalScript
  }

  if (!anthropic) {
    // Mock: proportionally scale duration_seconds, preserve content
    const ratio = availableSeconds / canonicalSeconds
    const adapted = canonicalScript.segments.map((s) => ({
      ...s,
      duration_seconds: s.type === 'CLOSE' ? closeSeconds : Math.round((s.duration_seconds ?? 30) * ratio),
    }))
    return { ...canonicalScript, segments: adapted, total_duration_seconds: targetMinutes * 60 }
  }

  const nonCloseSegments = canonicalScript.segments.filter((s) => s.type !== 'CLOSE')
  const closeSegment = canonicalScript.segments.find((s) => s.type === 'CLOSE')

  const prompt = `You are condensing a coaching script to fit a shorter session duration.

ORIGINAL SCRIPT (for subtopic: "${canonicalScript.subtopic_title}")
Target: ${Math.round(availableSeconds / 60)} minutes for this subtopic (condensed from ${Math.round(canonicalSeconds / 60)} min canonical)

SEGMENTS TO CONDENSE:
${nonCloseSegments.map((s) => `[${s.type}]\n${s.content}`).join('\n\n')}

CONDENSATION RULES:
- Preserve EVERY key concept — do not remove any topic or idea
- Reduce by shortening sentences, removing repetition, and tightening elaborations
- TEACH must still reference every on-screen item by name
- Keep the confident, peer-to-peer tone
- Each segment must remain coherent on its own — no mid-sentence cuts

Return ONLY valid JSON (no markdown):
{
  "segments": [
    ${nonCloseSegments.map((s) => `{ "type": "${s.type}", "content": "...", "duration_seconds": ${Math.round((s.duration_seconds ?? 30) * availableSeconds / canonicalSeconds)} }`).join(',\n    ')}
  ]
}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })

  let raw = (message.content[0] as { type: string; text: string }).text.trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const json = JSON.parse(raw) as { segments: ScriptSegment[] }

  const adaptedSegments = [...json.segments]
  if (closeSegment) adaptedSegments.push(closeSegment) // always restore CLOSE at full length

  return {
    ...canonicalScript,
    segments: adaptedSegments,
    total_duration_seconds: adaptedSegments.reduce((sum, s) => sum + (s.duration_seconds ?? 30), 0),
  }
}
