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
import type { SubSessionOutline, ContentArticle, UserContext } from './session-content-generator'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type ScriptSegmentType = 'TEACH' | 'CHECKPOINT' | 'ICE_BREAKER' | 'PROBE' | 'CONTINUE' | 'CLOSE'

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

// ─── CONTENT-01: NEW ATOMIC PIPELINE TYPES ────────────────────────────────────

/**
 * VisualizationSpec — exactly 3 items (enforced as TypeScript 3-tuple).
 * Produced atomically alongside the script segments in generateScriptAndVisualization.
 */
export interface VisualizationSpec {
  headline: string                       // max 8 words — visual section title
  items: [string, string, string]        // exactly 3 items — typed 3-tuple
  so_what: string                        // max 30 words, personalised to role/industry
}

/**
 * ScriptAndVisualizationOutput — result of the single atomic LLM call per subtopic.
 * Replaces the separate generateTrainingScript + generateTemplateData calls.
 */
export interface ScriptAndVisualizationOutput {
  segments: ScriptSegment[]
  visualization_spec: VisualizationSpec
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

1. TEACH (exactly 140 words — hard limit)
   You have 140 words. Write with full confidence and precision.
   No filler, no hedging. Every sentence must teach something.
   - Open with why this matters specifically to a ${userContext.role} in ${userContext.industry}
   - Walk through each on-screen item by name — explain it fully, don't skip any
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
    { "type": "TEACH", "content": "...", "duration_seconds": 60 },
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

  const isExpanding = availableSeconds > canonicalSeconds
  const direction = isExpanding ? 'expanding' : 'condensing'
  const targetMin = Math.round(availableSeconds / 60)
  const canonicalMin = Math.round(canonicalSeconds / 60)

  const prompt = isExpanding
    ? `You are deepening a coaching script to fill a longer session — not padding it.

ORIGINAL SCRIPT (for subtopic: "${canonicalScript.subtopic_title}")
Target: ${targetMin} minutes for this subtopic (deepened from ${canonicalMin} min original)

SEGMENTS TO DEEPEN:
${nonCloseSegments.map((s) => `[${s.type}]\n${s.content}`).join('\n\n')}

DEEPENING RULES — only add if it teaches something:
- TEACH: add a concrete example or brief case study relevant to the role/industry context already in the script; add one additional sentence of practical implication per on-screen item
- CHECKPOINT: add a second follow-up angle that tests application ("And if your team raised X, how would you respond?")
- ICE_BREAKER: add a brief framing sentence before the question to contextualise why you're asking
- PROBE: deepen the reframe with a more detailed analogy or a second angle that approaches the concept differently
- CONTINUE: keep short — no expansion needed (bridge statements stay tight)
- Do not pad — every added sentence must teach or illuminate something concrete
- Keep the confident, peer-to-peer tone throughout
- TEACH must still name every on-screen item explicitly
- Each segment must remain coherent on its own

Return ONLY valid JSON (no markdown):
{
  "segments": [
    ${nonCloseSegments.map((s) => `{ "type": "${s.type}", "content": "...", "duration_seconds": ${Math.round((s.duration_seconds ?? 30) * availableSeconds / canonicalSeconds)} }`).join(',\n    ')}
  ]
}`
    : `You are rephrasing a coaching script to be stronger and more confident within a tighter time budget.

ORIGINAL SCRIPT (for subtopic: "${canonicalScript.subtopic_title}")
Target: ${targetMin} minutes for this subtopic (rephrased from ${canonicalMin} min original)

SEGMENTS TO REPHRASE:
${nonCloseSegments.map((s) => `[${s.type}]\n${s.content}`).join('\n\n')}

REPHRASING RULES:
- Preserve EVERY key concept — nothing important gets dropped
- Eliminate filler phrases, hedging language ("it's worth noting", "you might consider", "in some cases"), and repetition
- Rephrase for sharpness and confidence — a shorter script should feel more expert, not incomplete
- TEACH must still reference every on-screen item by name
- Keep the peer-to-peer, trusted-colleague tone throughout
- Each segment must remain coherent on its own — no mid-sentence cuts

Return ONLY valid JSON (no markdown):
{
  "segments": [
    ${nonCloseSegments.map((s) => `{ "type": "${s.type}", "content": "...", "duration_seconds": ${Math.round((s.duration_seconds ?? 30) * availableSeconds / canonicalSeconds)} }`).join(',\n    ')}
  ]
}`

  console.log(`[adaptScriptToDuration] ${direction} subtopic "${canonicalScript.subtopic_title}" — rephrasing from ${canonicalMin}min to ${targetMin}min target`)

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

// ─── CONTENT-01: generateScriptAndVisualization ───────────────────────────────

/**
 * Single atomic LLM call that produces BOTH training script segments AND
 * visualization spec from a ContentArticle.
 *
 * Segment order: TEACH → CHECKPOINT → ICE_BREAKER → PROBE → CONTINUE
 * (last subtopic: TEACH → CHECKPOINT → ICE_BREAKER → PROBE → CLOSE)
 *
 * TEACH embeds [NAV:tab_0], [NAV:tab_1], [NAV:tab_2] inline at the moment each
 * visualization item is named — the WalkthroughClient watches these to advance tabs.
 *
 * VP calibration: vp-dir / c-suite roles skip definitions, open on
 * competitive/compliance/procurement framing.
 *
 * @param durationMins - Session duration in minutes. Used to set a proactive per-subtopic
 *   word budget so generation targets the right density from the start. Defaults to 30.
 */
export async function generateScriptAndVisualization(
  article: ContentArticle,
  userContext: UserContext,
  isLastSubtopic: boolean,
  subtopicIndex: number,
  totalSubtopics: number,
  durationMins: number = 30
): Promise<ScriptAndVisualizationOutput> {
  if (!anthropic) {
    console.log('[MOCK] script-generator: returning mock ScriptAndVisualizationOutput for', article.subtopic_title)
    return buildMockScriptAndVisualization(article, userContext, isLastSubtopic)
  }

  // PACE-01: fixed 140-word TEACH budget per subtopic regardless of duration or count.
  // Each section is ~2 minutes: 1 min TEACH (140 words) + 1 min Q&A.
  const wordsPerSubtopic = 140

  // VP / C-Suite calibration rules
  const isVpOrAbove = userContext.roleLevel === 'vp-dir' || userContext.roleLevel === 'c-suite'

  const vpCalibrationBlock = isVpOrAbove ? `
VP/C-SUITE CALIBRATION — MANDATORY:
DO NOT include in TEACH:
- Any definition of what an LLM or AI is
- Phrases: "enterprise-grade", "AI is not a toy", "let me explain what [term] means", "at a basic level", "to understand AI you need to know"
- Analogies explaining foundational tech ("think of AI like...")
- "Here are the players" competitive overview from scratch

DO start TEACH with one of these frames:
- Competitive positioning ("You're probably evaluating X alongside Y...")
- Procurement implications ("The contract terms that matter here are...")
- Regulatory/compliance framing ("The regulatory exposure in ${userContext.industry} is...")
- Risk differentiation between vendors
- Team adoption strategy` : userContext.roleLevel === 'manager' ? `
MANAGER CALIBRATION: Include one explanatory sentence per concept — functional, not definitional. Bridge from concept to team implementation.` : `
SPECIALIST CALIBRATION: Full technical depth. Edge cases, implementation nuance, architectural trade-offs.`

  const continueOrClose = isLastSubtopic
    ? `5. CLOSE (120 seconds — MANDATORY, replaces CONTINUE on final subtopic)
   Session wrap-up. Structure exactly:
   - 3 sentences summarising what was learned today across all subtopics (subtopic ${subtopicIndex + 1} of ${totalSubtopics})
   - 1 sentence of genuine encouragement tied to their role as a ${userContext.role} ("You now have...")
   - 1 sentence preview: what to think about before the next session
   No new information. Pure close. Warm, confident, brief.`
    : `5. CONTINUE (45-60 seconds — bridge to next concept)
   Lock in the key insight from this subtopic. Create anticipation for the next section without giving it away. End with a forward-leaning sentence.`

  const prompt = `You are Clio — an AI executive coach. Generate a complete coaching script AND visualization spec for one subtopic.

EXECUTIVE PROFILE
Role: ${userContext.role}
Industry: ${userContext.industry}
AI Maturity: ${userContext.maturity}
Role Level: ${userContext.roleLevel}
${vpCalibrationBlock}

CONTENT ARTICLE (source of truth — derive everything from this, do not invent new content)
Subtopic: ${article.subtopic_title}
Overview: ${article.sections.overview}
Key Facts: ${article.sections.key_facts.join(' | ')}
How It Works: ${article.sections.how_it_works}
Enterprise Implications: ${article.sections.enterprise_implications}
Common Misconceptions: ${article.sections.common_misconceptions.join(' | ')}
Decision Questions: ${article.sections.decision_questions.join(' | ')}
Role Relevance: ${article.role_relevance}
Industry Angle: ${article.industry_angle}

SUBTOPIC POSITION: ${subtopicIndex + 1} of ${totalSubtopics}${isLastSubtopic ? ' (FINAL — include CLOSE segment)' : ''}

SCRIPT SEGMENTS — write in this exact order:

1. TEACH (exactly 140 words — hard limit, no exceptions)
   You have 140 words for this segment. Count carefully. If your draft exceeds 140 words,
   cut from the least important sentence first. Never cut the final takeaway sentence.
   Write with confidence and precision. No filler, no hedging, no padding.
   Every sentence must teach something new.
   Prioritise the insight that will most change how this ${userContext.role} thinks or acts.
   - Open immediately with the frame specified in calibration rules above
   - Name EXACTLY 3 items that will appear on screen — say "On your screen you'll see three items: [item 1], [item 2], [item 3]"
   - Walk through each item by name. At the EXACT moment you name each item, embed the nav directive INLINE:
     First item → embed [NAV:tab_0] immediately before or after the item name
     Second item → embed [NAV:tab_1] immediately before or after the item name
     Third item → embed [NAV:tab_2] immediately before or after the item name
   - The 3 items named in TEACH MUST match visualization_spec.items exactly
   - End with the single most important takeaway for a ${userContext.role} in ${userContext.industry}

2. CHECKPOINT (60-75 seconds)
   A single targeted question that reveals whether the user can APPLY the concept — not just recall it.
   Draw from the article's decision_questions. Not a yes/no question.

3. ICE_BREAKER (30-45 seconds)
   ONE open situational question about the user's context, motivation, or use case.
   Rules:
   - Must NOT be a comprehension check
   - Must be open-ended (not yes/no)
   - Must reference ONE of: their evaluation context, their team's current status, a specific driving use case, or a stakeholder they need to address
   - Example pattern: "What's the specific context driving this for you right now — is it [scenario A], or more [scenario B]?"

4. PROBE (45-60 seconds)
   Reframing fallback if the user seems uncertain on CHECKPOINT. Try a different angle.
   Reference something from a different section of the article. Keep it brief.

${continueOrClose}

VISUALIZATION SPEC
Choose 3 items that are the most concrete, memorable, and actionable from this subtopic.
These 3 items are what appear on screen during TEACH — they MUST match what TEACH names.
- headline: max 8 words — what appears as the visual section title
- items: exactly 3 strings — the items shown on screen (must match TEACH exactly)
- so_what: max 30 words, personalised to ${userContext.role} in ${userContext.industry}

Return ONLY valid JSON (no markdown, no commentary):
{
  "segments": [
    { "type": "TEACH", "content": "...", "duration_seconds": 60 },
    { "type": "CHECKPOINT", "content": "...", "duration_seconds": 65 },
    { "type": "ICE_BREAKER", "content": "...", "duration_seconds": 40 },
    { "type": "PROBE", "content": "...", "duration_seconds": 50 }${isLastSubtopic
      ? ',\n    { "type": "CLOSE", "content": "...", "duration_seconds": 120 }'
      : ',\n    { "type": "CONTINUE", "content": "...", "duration_seconds": 50 }'}
  ],
  "visualization_spec": {
    "headline": "...",
    "items": ["item 1", "item 2", "item 3"],
    "so_what": "..."
  }
}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })

  let raw = (message.content[0] as { type: string; text: string }).text.trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  const json = JSON.parse(raw) as {
    segments: ScriptSegment[]
    visualization_spec: {
      headline: string
      items: string[]
      so_what: string
    }
  }

  // Runtime correction: enforce exactly 3 items in visualization_spec
  const rawItems = json.visualization_spec.items ?? []
  if (rawItems.length !== 3) {
    console.warn(
      `[script-generator][WARN] visualization_spec item count corrected from ${rawItems.length} to 3 for subtopic: ${article.subtopic_title}`
    )
    while (rawItems.length < 3) rawItems.push(rawItems[rawItems.length - 1] ?? 'Key insight')
    rawItems.splice(3)
  }
  const items: [string, string, string] = [rawItems[0], rawItems[1], rawItems[2]]

  const vizSpec: VisualizationSpec = {
    headline: json.visualization_spec.headline ?? article.subtopic_title.slice(0, 50),
    items,
    so_what: json.visualization_spec.so_what ?? article.role_relevance,
  }

  const total = json.segments.reduce((sum, s) => sum + (s.duration_seconds ?? 30), 0)

  return {
    segments: json.segments,
    visualization_spec: vizSpec,
    total_duration_seconds: total,
  }
}

/**
 * Mock implementation for generateScriptAndVisualization when ANTHROPIC_API_KEY is a placeholder.
 * Returns a realistic ScriptAndVisualizationOutput with all required segment types.
 */
function buildMockScriptAndVisualization(
  article: ContentArticle,
  userContext: UserContext,
  isLastSubtopic: boolean
): ScriptAndVisualizationOutput {
  const item1 = article.sections.key_facts[0]?.slice(0, 60) ?? 'Strategic framing'
  const item2 = article.sections.key_facts[1]?.slice(0, 60) ?? 'Implementation reality'
  const item3 = article.sections.key_facts[2]?.slice(0, 60) ?? 'Decision leverage points'

  const segments: ScriptSegment[] = [
    {
      type: 'TEACH',
      content: `${article.role_relevance} Let me show you what that means in practice. On your screen you'll see three items: [NAV:tab_0] ${item1}, [NAV:tab_1] ${item2}, and [NAV:tab_2] ${item3}. ${article.sections.overview} ${article.sections.how_it_works} The single most important takeaway: ${article.sections.enterprise_implications.split('.')[0]}.`,
      duration_seconds: 120,
    },
    {
      type: 'CHECKPOINT',
      content: article.sections.decision_questions[0] ?? `How does this change the way you'd approach the next AI decision in your organisation?`,
      duration_seconds: 65,
    },
    {
      type: 'ICE_BREAKER',
      content: `What's the specific context driving this evaluation for you right now — is it a use case your team is already experimenting with, or more "I need to speak to this intelligently with my leadership"?`,
      duration_seconds: 40,
    },
    {
      type: 'PROBE',
      content: article.sections.common_misconceptions[0]
        ? `Let me try a different angle. ${article.sections.common_misconceptions[0]} Does that reframing help?`
        : `Let me reframe this. The question isn't whether to act — it's how to act without creating more risk than you solve. Does that land differently?`,
      duration_seconds: 50,
    },
  ]

  if (isLastSubtopic) {
    segments.push({
      type: 'CLOSE',
      content: `That wraps up today's session on ${article.subtopic_title}. You've covered the key facts, the mechanism, and the enterprise implications — and you now have a clear framework for making decisions here without needing to be the technical expert in the room. As a ${userContext.role}, you're now better positioned to ask the right questions and set the right conditions for your team. Think about: ${article.sections.decision_questions[article.sections.decision_questions.length - 1] ?? 'what one decision this changes for you'} — and we'll pick that thread up next time.`,
      duration_seconds: 120,
    })
  } else {
    segments.push({
      type: 'CONTINUE',
      content: `Good. ${article.role_relevance} Keep that in mind — it's the through-line for everything we'll cover next.`,
      duration_seconds: 50,
    })
  }

  const items: [string, string, string] = [item1, item2, item3]
  const total = segments.reduce((sum, s) => sum + (s.duration_seconds ?? 30), 0)

  return {
    segments,
    visualization_spec: {
      headline: article.subtopic_title.split(' ').slice(0, 6).join(' '),
      items,
      so_what: article.role_relevance,
    },
    total_duration_seconds: total,
  }
}
