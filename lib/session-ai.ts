/**
 * Claude-powered session AI for live coaching sessions.
 * Generates visual specs, analyzes transcriptions, and produces spoken responses.
 */

import Anthropic from '@anthropic-ai/sdk'

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder
  ? null
  : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-6'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface VisualNode {
  id: string
  label: string
  sublabel?: string
  type: 'source' | 'processor' | 'destination' | 'store' | 'outcome'
  position: { x: number; y: number } // percentage of container (0–100)
  highlight?: boolean
}

export interface VisualEdge {
  from: string
  to: string
  label?: string
  style: 'solid' | 'dashed' | 'curved'
  animated: boolean
  color?: string
}

export interface SummaryCard {
  heading: string
  headingColor: string
  value: string
}

export interface VisualScenario {
  id: string
  badge: string
  badgeColor: 'red' | 'green' | 'cyan' | 'amber' | 'purple'
  caption: string
  nodes: VisualNode[]
  edges: VisualEdge[]
  summaryCards: SummaryCard[]
  summaryLine: string
}

export interface VisualSpec {
  topicId: string
  title: string
  titleHighlight: string
  subtitle: string
  scenarios: VisualScenario[]
}

export interface TranscriptionAnalysis {
  intent: 'question' | 'acknowledgment' | 'confused' | 'skip' | 'no_time' | 'other'
  isComplex: boolean
  extractedQuestion?: string
  newTopicNeeded?: string
  sentiment: 'positive' | 'neutral' | 'frustrated' | 'engaged'
  suggestedResponse: string
}

export interface SpecReviewResult {
  approved: boolean
  feedback: string
  revisedSpec?: VisualSpec
}

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

function getMockVisualSpec(topicId: string, topicTitle: string): VisualSpec {
  return {
    topicId,
    title: topicTitle,
    titleHighlight: topicTitle.split(' ')[0],
    subtitle: `How ${topicTitle} works in practice — and why it matters for your business`,
    scenarios: [
      {
        id: 'without',
        badge: `WITHOUT ${topicTitle.toUpperCase()} — uncontrolled`,
        badgeColor: 'red',
        caption: 'Requests hit your system directly — unpredictable load',
        nodes: [
          { id: 'client', label: 'Client', type: 'source', position: { x: 10, y: 45 } },
          { id: 'api', label: 'API', sublabel: 'overwhelmed', type: 'processor', position: { x: 50, y: 45 }, highlight: true },
          { id: 'db', label: 'Database', sublabel: '503 errors', type: 'destination', position: { x: 85, y: 45 } },
        ],
        edges: [
          { from: 'client', to: 'api', style: 'solid', animated: true, color: '#EF4444' },
          { from: 'api', to: 'db', style: 'dashed', animated: false, color: '#EF4444' },
        ],
        summaryCards: [
          { heading: 'PATH', headingColor: '#EF4444', value: 'Direct hit' },
          { heading: 'RESULT', headingColor: '#EF4444', value: '503 errors' },
          { heading: 'IMPACT', headingColor: '#EF4444', value: 'System crash' },
        ],
        summaryLine: `Without ${topicTitle}, uncontrolled load causes failures and unpredictable costs.`,
      },
      {
        id: 'with',
        badge: `WITH ${topicTitle.toUpperCase()} — controlled flow`,
        badgeColor: 'green',
        caption: 'Traffic is shaped — predictable, resilient, scalable',
        nodes: [
          { id: 'client2', label: 'Client', type: 'source', position: { x: 10, y: 45 } },
          { id: 'limiter', label: topicTitle, sublabel: 'queue & shape', type: 'processor', position: { x: 45, y: 45 }, highlight: true },
          { id: 'api2', label: 'API', sublabel: 'stable', type: 'processor', position: { x: 75, y: 45 } },
          { id: 'db2', label: 'Database', type: 'destination', position: { x: 92, y: 45 } },
        ],
        edges: [
          { from: 'client2', to: 'limiter', style: 'solid', animated: true, color: '#10B981' },
          { from: 'limiter', to: 'api2', style: 'solid', animated: true, color: '#10B981' },
          { from: 'api2', to: 'db2', style: 'solid', animated: true, color: '#10B981' },
        ],
        summaryCards: [
          { heading: 'PATH', headingColor: '#10B981', value: 'Metered queue' },
          { heading: 'RESULT', headingColor: '#10B981', value: '200 OK' },
          { heading: 'IMPACT', headingColor: '#10B981', value: 'Predictable cost' },
        ],
        summaryLine: `With ${topicTitle}, your system handles peak load gracefully — no surprises, no outages.`,
      },
    ],
  }
}

// ─── VISUAL SPEC GENERATION ───────────────────────────────────────────────────

/**
 * Generates a VisualSpec JSON for a topic using Claude.
 * Falls back to realistic mock data when API key is not configured.
 */
export async function generateVisualSpec(
  topicId: string,
  topicTitle: string,
  userContext: { role: string; industry: string; maturity: string },
  containerDimensions: { width: number; height: number }
): Promise<VisualSpec> {
  if (isPlaceholder || !anthropic) {
    console.log('[MOCK SESSION-AI] generateVisualSpec', { topicId, topicTitle })
    return getMockVisualSpec(topicId, topicTitle)
  }

  const systemPrompt = `You are a world-class visual educator creating interactive concept diagrams for senior business executives.
Generate a VisualSpec JSON for the given topic.
The spec must show the concept through contrast (before/after, with/without, problem/solution).
Position nodes using percentage coordinates (0-100) so they scale to any screen size.
Make every element meaningful — executives need to understand WHY, not just what.
Return ONLY valid JSON matching the VisualSpec interface. No markdown, no explanation — just the JSON object.

The VisualSpec interface:
{
  topicId: string,
  title: string,
  titleHighlight: string,  // one key word in title to accent with color
  subtitle: string,        // insightful one-liner below title
  scenarios: Array<{
    id: string,
    badge: string,          // e.g. "WITHOUT RATE LIMITING — direct burst"
    badgeColor: "red" | "green" | "cyan" | "amber" | "purple",
    caption: string,        // annotation below diagram
    nodes: Array<{
      id: string,
      label: string,
      sublabel?: string,
      type: "source" | "processor" | "destination" | "store" | "outcome",
      position: { x: number, y: number },  // 0-100 percentages
      highlight?: boolean
    }>,
    edges: Array<{
      from: string,         // node id
      to: string,           // node id
      label?: string,
      style: "solid" | "dashed" | "curved",
      animated: boolean,
      color?: string        // hex color
    }>,
    summaryCards: Array<{
      heading: string,      // e.g. "PATH", "QUEUE", "RESULT"
      headingColor: string, // hex color
      value: string         // short value text
    }>,
    summaryLine: string     // wide summary sentence
  }>
}`

  const userPrompt = `Topic: "${topicTitle}" (ID: ${topicId})
User context: Role=${userContext.role}, Industry=${userContext.industry}, AI Maturity=${userContext.maturity}
Container: ${containerDimensions.width}x${containerDimensions.height}px

Generate a VisualSpec with 2 scenarios (problem vs solution, or without vs with).
Make it specific and executive-relevant. Show concrete business impact.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const rawText =
    response.content[0].type === 'text' ? response.content[0].text : '{}'

  // Parse and validate
  let spec: VisualSpec
  try {
    // Strip any markdown code fences if model adds them
    const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    spec = JSON.parse(cleaned) as VisualSpec
  } catch (e) {
    console.error('Failed to parse VisualSpec JSON, using mock', e)
    return getMockVisualSpec(topicId, topicTitle)
  }

  // Basic validation
  if (!spec.topicId || !spec.title || !Array.isArray(spec.scenarios) || spec.scenarios.length === 0) {
    console.error('VisualSpec failed validation, using mock')
    return getMockVisualSpec(topicId, topicTitle)
  }

  return spec
}

// ─── VISUAL SPEC REVIEW ───────────────────────────────────────────────────────

/**
 * Agent 2: Reviews a VisualSpec for quality and suggests improvements.
 * Runs during a live call, so it must be fast and decisive.
 */
export async function reviewVisualSpec(spec: VisualSpec): Promise<SpecReviewResult> {
  if (isPlaceholder || !anthropic) {
    console.log('[MOCK SESSION-AI] reviewVisualSpec — approved')
    return { approved: true, feedback: 'Mock review: looks good' }
  }

  const systemPrompt = `You are a senior UI/UX designer and information architect reviewing visual specs for a premium executive coaching product.
Check: (1) Are node positions balanced and readable? (2) Is the contrast between scenarios clear? (3) Are summary cards crisp and specific? (4) Is the subtitle genuinely insightful?
If the spec is good, respond with: { "approved": true, "feedback": "Looks good" }
If it needs revision, respond with: { "approved": true, "feedback": "...", "revisedSpec": { ...full revised spec... } }
Be fast and decisive — this runs during a live call. Return ONLY valid JSON.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Review this VisualSpec:\n${JSON.stringify(spec, null, 2)}`,
      },
    ],
  })

  const rawText =
    response.content[0].type === 'text' ? response.content[0].text : '{}'

  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(cleaned) as SpecReviewResult
    return result
  } catch (e) {
    console.error('Failed to parse review result', e)
    return { approved: true, feedback: 'Review parse error — proceeding with original spec' }
  }
}

// ─── TRANSCRIPTION ANALYSIS ───────────────────────────────────────────────────

/**
 * Analyzes a transcript chunk to determine user intent, sentiment, and next action.
 */
export async function analyzeTranscription(
  text: string,
  currentTopicId: string,
  userContext: object
): Promise<TranscriptionAnalysis> {
  if (isPlaceholder || !anthropic) {
    console.log('[MOCK SESSION-AI] analyzeTranscription', { text, currentTopicId })
    return {
      intent: 'acknowledgment',
      isComplex: false,
      sentiment: 'neutral',
      suggestedResponse: 'Great, let me continue with the next point.',
    }
  }

  const systemPrompt = `You are analyzing real-time transcription from an executive coaching session.
Classify the speaker's intent and sentiment. Return ONLY valid JSON with this shape:
{
  "intent": "question" | "acknowledgment" | "confused" | "skip" | "no_time" | "other",
  "isComplex": boolean,     // true if the question requires more than 10 minutes to answer properly
  "extractedQuestion": string | null,
  "newTopicNeeded": string | null,   // if they want to change topic, what topic?
  "sentiment": "positive" | "neutral" | "frustrated" | "engaged",
  "suggestedResponse": string  // what the AI coach should say (max 120 words)
}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Current topic: ${currentTopicId}
User context: ${JSON.stringify(userContext)}
Transcript: "${text}"`,
      },
    ],
  })

  const rawText =
    response.content[0].type === 'text' ? response.content[0].text : '{}'

  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned) as TranscriptionAnalysis
  } catch (e) {
    console.error('Failed to parse transcription analysis', e)
    return {
      intent: 'other',
      isComplex: false,
      sentiment: 'neutral',
      suggestedResponse: 'I heard you — let me continue.',
    }
  }
}

// ─── SPOKEN RESPONSE ──────────────────────────────────────────────────────────

/**
 * Generates a concise spoken response for the bot to deliver via TTS.
 */
export async function generateSpokenResponse(
  question: string,
  topicContext: string,
  userContext: object,
  maxWords = 120
): Promise<string> {
  if (isPlaceholder || !anthropic) {
    console.log('[MOCK SESSION-AI] generateSpokenResponse', { question, maxWords })
    return `That's a great question about ${topicContext}. The key thing to understand is this concept applies directly to your decisions as a leader. Let me walk you through the visual.`
  }

  const systemPrompt = `You are Clio, a premium AI coaching assistant for senior executives.
Speak concisely and confidently. No jargon. No "basically" or "so".
Treat the executive as an equal. Max ${maxWords} words.
Be direct and immediately useful.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Question: "${question}"
Topic context: ${topicContext}
User: ${JSON.stringify(userContext)}
Generate a spoken response.`,
      },
    ],
  })

  const rawText =
    response.content[0].type === 'text' ? response.content[0].text : ''

  // Trim to maxWords
  const words = rawText.trim().split(/\s+/)
  if (words.length <= maxWords) return rawText.trim()
  return words.slice(0, maxWords).join(' ')
}
