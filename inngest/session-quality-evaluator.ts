/**
 * FB-008: Post-session quality evaluation cron.
 *
 * Runs every 15 minutes. Finds sessions that completed 2–2.25 hours ago,
 * fetches the Recall.ai transcript, classifies checkpoint responses (V1–V7),
 * evaluates 6 session quality criteria, upserts knowledge_profiles, updates
 * the curriculum queue for gaps, and recalculates ai_readiness_score.
 *
 * No AI calls — all classification is keyword-scoring (<500 ms per response).
 */

import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { normaliseMaturity } from '@/lib/curriculum/planner'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Variant = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7'

interface RecallWord {
  text: string
  start_time: number
  end_time: number
}

interface RecallUtterance {
  speaker: string
  words: RecallWord[]
}

interface CheckpointPair {
  question: string
  response: string
  subtopic_slug: string
  variant: Variant
}

interface QualityCriterionResult {
  criterion: number
  result: 'pass' | 'fail'
  evidence: string
}

interface SessionRow {
  id: string
  user_id: string
  session_title: string | null
  topic_id: string | null
  recall_bot_id: string | null
  ended_at: string
  role: string | null
  industry: string | null
  ai_maturity: string | null
  active_plan_id: string | null
  created_at: string | null
  hume_native_enabled: boolean | null
  /** recall | attendee | agentcall | null (null = pre-migration row, treated as recall). See migration 070. */
  meeting_bot_provider: string | null
}

// ─── V1–V7 keyword classifier ──────────────────────────────────────────────────

const VARIANT_KEYWORDS: Record<Variant, string[]> = {
  V1: ["exactly", "precisely", "correct", "right", "yes and", "agree", "confirm", "absolutely", "spot on", "that's it"],
  V2: ["mostly", "partly", "sort of", "kind of", "i think", "maybe", "not sure about", "partially"],
  V3: ["i understand the basics", "i get the general idea", "roughly", "broadly speaking", "more or less"],
  V4: ["actually", "wait", "that's not", "i thought", "different from what i", "i was thinking"],
  V5: ["hmm", "interesting", "never thought", "adjacent", "related to", "similar to", "close to"],
  V6: ["i don't know", "not sure", "no idea", "can't say", "don't understand", "lost me", "confused"],
  V7: ["can you explain", "could you repeat", "say that again", "rephrase", "what do you mean", "didn't follow"],
}

/**
 * Classifies a user response into one of 7 comprehension variants using keyword scoring.
 * Tie-break rule: prefer the higher-numbered variant (more conservative — less comprehension).
 * No-match default: V2 (partial understanding assumed).
 * Runtime: <500 ms (pure string ops, no I/O).
 */
export function classifyResponse(responseText: string): Variant {
  const lower = responseText.toLowerCase()
  const scores: Record<Variant, number> = { V1: 0, V2: 0, V3: 0, V4: 0, V5: 0, V6: 0, V7: 0 }

  for (const [variant, keywords] of Object.entries(VARIANT_KEYWORDS) as [Variant, string[]][]) {
    for (const kw of keywords) {
      if (lower.includes(kw)) scores[variant]++
    }
  }

  const best = (Object.entries(scores) as [Variant, number][])
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]

  // If no keywords matched at all, default to V2
  return best[1] === 0 ? 'V2' : best[0]
}

// ─── Variant → numeric score mapping ─────────────────────────────────────────

const VARIANT_SCORE: Record<Variant, number> = {
  V1: 10, V2: 7, V3: 6, V4: 3, V5: 4, V6: 0, V7: 5,
}

// ─── Comprehension status from avg variant score ───────────────────────────────

function comprehensionStatusFromScore(avgScore: number): 'queued' | 'in-progress' | 'understood' | 'gap' {
  if (avgScore >= 8) return 'understood'
  if (avgScore >= 5) return 'in-progress'
  return 'gap'
}

// ─── Industry keyword map ─────────────────────────────────────────────────────
// Criterion 3: industry-specific example detection.

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  'financial services': ['bank', 'financial', 'loan', 'insurance', 'fund', 'trading', 'fintech'],
  finance:              ['bank', 'financial', 'loan', 'insurance', 'fund', 'trading', 'fintech'],
  healthcare:           ['hospital', 'patient', 'clinical', 'pharma', 'medical', 'health'],
  retail:               ['retail', 'store', 'customer', 'supply chain', 'inventory', 'e-commerce'],
  technology:           ['software', 'platform', 'saas', 'infrastructure', 'cloud', 'api'],
  consulting:           ['client', 'engagement', 'advisory', 'strategy', 'consulting'],
  manufacturing:        ['factory', 'production', 'operations', 'supply chain', 'manufacturing'],
  legal:                ['legal', 'compliance', 'contract', 'regulatory', 'litigation'],
}

// Criterion 2: seniority framing markers by role_level.
const SENIORITY_MARKERS: Record<string, string[]> = {
  'c-suite':        ['board', 'strategy', 'invest', 'approve'],
  'vp-dir':         ['team', 'function', 'report', 'manage'],
  'vp-technology':  ['infrastructure', 'engineer', 'architecture', 'api', 'security', 'build', 'deploy', 'integrate'],
  'vp-product':     ['product', 'feature', 'roadmap', 'user', 'launch', 'priorit', 'ship', 'competitive'],
  'manager':        ['implement', 'deploy', 'execute', 'team'],
  'specialist':     ['code', 'build', 'configure', 'analyse', 'analyze'],
}

// Criterion 4: "too technical" markers that should NOT appear for beginner/observer users.
const TOO_TECHNICAL_BEGINNER = [
  'neural network', 'backpropagation', 'tokenizer', 'embedding dimension',
  'attention head', 'gradient', 'hyperparameter',
]

// Criterion 5: actionable tail keywords (checked in last 200 words of Clio speech).
const ACTIONABLE_TAIL_KEYWORDS = [
  'next step', 'action', 'decide', 'consider', 'ask', 'evaluate',
  'start', 'try', 'question to', 'before your next',
]

// Criterion 6: transition phrases linking to adjacent subtopics.
const TRANSITION_PHRASES = [
  'now that we', 'this connects to', 'in our next', 'which leads us to',
  'building on this', 'this will help when we',
]

// ─── DEFER-QUESTION-01: deferred-question detection ────────────────────────────
// Clio is prompted (lib/clio-context-builder.ts, rule 9) to verbally acknowledge
// deferring a complex/off-topic question rather than calling a tool. This is a
// fixed phrase family we control (we wrote the prompt), so keyword matching is
// sufficient — same no-LLM precedent as the rest of this file. Keep this list in
// sync with the acknowledgment wording in lib/clio-context-builder.ts.
const DEFERRAL_PHRASES = [
  'save that for next time',
  'save it for next time',
  "let's save that",
  'save this for next time',
  'save that question for next time',
]

interface DetectedDeferredQuestion {
  question: string
  deferred_at: string
}

// ─── DEFER-QUESTION-01 (Hume-native): deferred-question detection ─────────────
// Hume-native sessions use a different, more autonomous prompt (see
// lib/voice/hume-native/prompt-template.ts, rule 6, PROMPT_TEMPLATE_VERSION
// 'v3') that instructs Clio to acknowledge a deferral verbally — no tool call
// — built around phrasing anchored on "next time" / "next session" / "cover
// that properly". This is a different phrase family from the Custom-LLM-path
// DEFERRAL_PHRASES above, so it needs its own keyword list and detector. Keep
// this list in sync with the phrasing nudged by that prompt rule.
const DEFERRAL_TRIGGER_PHRASES = [
  'next time',
  'next session',
  'cover that properly',
  'cover this properly',
  "that's worth its own session",
  'worth its own session',
]

interface DeferredQuestionEntry {
  question: string
  deferred_at: string
  source: 'transcript-detected'
}

/** Dedup threshold for near-identical deferred questions within one batch of matches. */
const DEFERRAL_DEDUP_SIMILARITY_THRESHOLD = 0.85

/**
 * Hume-native counterpart to detectDeferredQuestions() above. Scans Clio's
 * utterances for DEFERRAL_TRIGGER_PHRASES (the Hume-native prompt's phrase
 * family — distinct from the Custom-LLM-path DEFERRAL_PHRASES) and pairs each
 * match with the immediately preceding user utterance, treated as the
 * deferred question. Conservative: skips a match if there is no preceding
 * user utterance rather than fabricating a question — same behavior as the
 * Custom-LLM-path detector.
 *
 * Must only ever be invoked when session.hume_native_enabled === true; the
 * Custom-LLM-path detectDeferredQuestions() remains the detector for every
 * other session, preserving existing behavior for all pre-existing rows.
 *
 * Near-duplicate matches (paraphrased re-asks of essentially the same
 * question) are collapsed: a new match is dropped if its question has a
 * word-overlap similarity above DEFERRAL_DEDUP_SIMILARITY_THRESHOLD (0.85)
 * with a question already accepted into this batch's results.
 *
 * Pure keyword/string matching — no LLM call, consistent with the rest of
 * this file.
 */
export function detectHumeNativeDeferredQuestions(
  utterances: RecallUtterance[],
  clioSpeaker: string,
  userSpeakers: string[],
  sessionEndedAt: string,
): DeferredQuestionEntry[] {
  const results: DeferredQuestionEntry[] = []

  for (let i = 0; i < utterances.length; i++) {
    const u = utterances[i]
    if (u.speaker !== clioSpeaker) continue

    const text = utteranceText(u).toLowerCase()
    const matchedPhrase = DEFERRAL_TRIGGER_PHRASES.find((p) => text.includes(p))
    if (!matchedPhrase) continue

    // Find the nearest preceding user utterance by transcript order.
    let precedingUser: RecallUtterance | null = null
    for (let j = i - 1; j >= 0; j--) {
      if (userSpeakers.includes(utterances[j].speaker)) {
        precedingUser = utterances[j]
        break
      }
    }
    if (!precedingUser) continue // skip on ambiguity — don't fabricate a question

    const question = utteranceText(precedingUser).trim()
    if (!question) continue

    // Dedup: skip if a near-identical question is already in this batch's results.
    const isNearDuplicate = results.some(
      (r) => wordOverlapSimilarity(question, r.question) > DEFERRAL_DEDUP_SIMILARITY_THRESHOLD,
    )
    if (isNearDuplicate) continue

    results.push({
      question,
      deferred_at: sessionEndedAt,
      source: 'transcript-detected',
    })
  }

  return results
}

/**
 * Scans Clio's utterances for deferral-acknowledgment phrases and pairs each
 * match with the immediately preceding user utterance (treated as the deferred
 * question). Conservative: skips a match if no preceding user utterance exists,
 * rather than fabricating a question (same "skip on ambiguity" behavior as the
 * checkpoint-pairing logic below).
 *
 * `sessionEndedAt` is used as a single approximate timestamp for every match in
 * a session — word-level absolute clock time isn't reconstructable from this
 * batch job's inputs, and the UI only ever displays time-of-day granularity.
 */
export function detectDeferredQuestions(
  utterances: RecallUtterance[],
  clioSpeaker: string,
  userSpeakers: string[],
  sessionEndedAt: string,
): DetectedDeferredQuestion[] {
  const results: DetectedDeferredQuestion[] = []

  for (let i = 0; i < utterances.length; i++) {
    const u = utterances[i]
    if (u.speaker !== clioSpeaker) continue

    const text = utteranceText(u).toLowerCase()
    const matchedPhrase = DEFERRAL_PHRASES.find((p) => text.includes(p))
    if (!matchedPhrase) continue

    // Find the nearest preceding user utterance by transcript order.
    let precedingUser: RecallUtterance | null = null
    for (let j = i - 1; j >= 0; j--) {
      if (userSpeakers.includes(utterances[j].speaker)) {
        precedingUser = utterances[j]
        break
      }
    }
    if (!precedingUser) continue // skip on ambiguity — don't fabricate a question

    const question = utteranceText(precedingUser).trim()
    if (!question) continue

    results.push({
      question,
      deferred_at: sessionEndedAt,
    })
  }

  return results
}

// ─── CURR-01: 7-Dimension session classification ──────────────────────────────

type SessionDimensionId =
  | 'strategic'
  | 'operational'
  | 'technical'
  | 'compliance'
  | 'competitive'
  | 'team_management'
  | 'personal_productivity'

interface SessionDimensionResult {
  evaluated_at: string
  dimensions: Record<SessionDimensionId, { covered: boolean; match_count: number }>
  covered_count: number
}

const SESSION_DIMENSION_KEYWORDS: Record<SessionDimensionId, string[]> = {
  strategic:            ['strategy', 'vision', 'roadmap', 'board', 'competitive', 'market position', 'investment', 'priority'],
  operational:          ['workflow', 'process', 'implement', 'deploy', 'rollout', 'team adoption', 'day-to-day', 'operationalise'],
  technical:            ['model', 'api', 'architecture', 'infrastructure', 'integration', 'security', 'token', 'data pipeline'],
  compliance:           ['compliance', 'regulatory', 'governance', 'risk', 'audit', 'legal', 'policy', 'gdpr', 'soc2', 'hipaa'],
  competitive:          ['competitor', 'landscape', 'benchmark', 'vendor', 'alternative', 'openai', 'google', 'microsoft', 'market'],
  team_management:      ['team', 'hire', 'upskill', 'enablement', 'culture', 'change management', 'train', 'staff', 'adoption'],
  personal_productivity:['personal', 'my workflow', 'time', 'productivity', 'own use', 'daily', 'habit', 'prompt', 'assistant'],
}

const ALL_SESSION_DIMENSIONS: SessionDimensionId[] = [
  'strategic', 'operational', 'technical', 'compliance',
  'competitive', 'team_management', 'personal_productivity',
]

/**
 * Runs the 7-dimension keyword classification over the Clio session transcript.
 * Uses the same keyword map as the plan-level coverage check (CURR-01).
 * Pure local function — no API calls.
 */
function checkSessionDimensions(
  clioText: string,
  sessionTitle: string,
  _roleLevel: string,
  _industry: string,
): SessionDimensionResult {
  const combined = (clioText + ' ' + sessionTitle).toLowerCase()
  const dimensions = {} as Record<SessionDimensionId, { covered: boolean; match_count: number }>

  let coveredCount = 0
  for (const dimId of ALL_SESSION_DIMENSIONS) {
    const keywords = SESSION_DIMENSION_KEYWORDS[dimId]
    let matchCount = 0
    for (const kw of keywords) {
      if (combined.includes(kw.toLowerCase())) matchCount++
    }
    const covered = matchCount >= 2
    dimensions[dimId] = { covered, match_count: matchCount }
    if (covered) coveredCount++
  }

  return {
    evaluated_at: new Date().toISOString(),
    dimensions,
    covered_count: coveredCount,
  }
}

// ─── Word-overlap similarity (for checkpoint question matching) ────────────────

function wordOverlapSimilarity(a: string, b: string): number {
  const wordsA = a.toLowerCase().split(/\s+/).filter(Boolean)
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  const intersection = wordsA.filter((w) => wordsB.has(w)).length
  const allWords = new Set(wordsA)
  wordsB.forEach((w) => allWords.add(w))
  const union = allWords.size
  return union === 0 ? 0 : intersection / union
}

// ─── Reconstruct utterance text from words array ──────────────────────────────

function utteranceText(u: RecallUtterance): string {
  return u.words.map((w) => w.text).join(' ')
}

// ─── Reusable transcript fetch + speaker identification ────────────────────────
// RTV-03's accuracy-report step (inngest/rtv03-accuracy-evaluator.ts) reuses
// these two exported functions verbatim rather than duplicating the Recall.ai
// fetch or the Clio-speaker heuristic — see requirement-docs/
// RTV-03-live-position-tracking.md Section 6.1.

export interface RecallTranscriptResult {
  utterances: RecallUtterance[]
  transcriptError: string | null
}

/**
 * Fetches the Recall.ai transcript for a session's bot. Exact extraction of
 * this file's original Step B logic (no behavior change) — a 404 re-throws so
 * the caller's Inngest step retries; any other failure is captured as a
 * transcriptError string rather than thrown.
 */
export async function fetchRecallTranscript(
  sessionIdForLogging: string,
  recallBotId: string | null,
  recallApiKey: string,
): Promise<RecallTranscriptResult> {
  let utterances: RecallUtterance[] = []
  let transcriptError: string | null = null

  if (!recallBotId) {
    console.warn(`[quality-evaluator] Session ${sessionIdForLogging} has no recall_bot_id — empty transcript`)
    transcriptError = 'no_recall_bot_id'
  } else if (!recallApiKey || recallApiKey.startsWith('PLACEHOLDER_')) {
    console.warn(`[quality-evaluator] RECALL_API_KEY not set — skipping transcript for session ${sessionIdForLogging}`)
    transcriptError = 'recall_api_key_missing'
  } else {
    try {
      const resp = await fetch(
        `https://api.recall.ai/api/v1/bot/${recallBotId}/transcript`,
        { headers: { Authorization: `Token ${recallApiKey}` } },
      )

      if (!resp.ok) {
        if (resp.status === 404) {
          // Transcript not yet available — throw so Inngest retries this step
          throw new Error(`Transcript not yet available for bot ${recallBotId} (HTTP 404)`)
        }
        console.error(`[quality-evaluator] Recall API error ${resp.status} for session ${sessionIdForLogging}`)
        transcriptError = `recall_api_error_${resp.status}`
      } else {
        const body = await resp.json() as RecallUtterance[]
        if (Array.isArray(body) && body.length > 0) {
          utterances = body
        } else {
          transcriptError = 'transcript_empty'
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Re-throw 404 cases so Inngest retries. After 3 retries it marks as error.
      if (msg.includes('HTTP 404')) throw err
      console.error(`[quality-evaluator] Transcript fetch threw for session ${sessionIdForLogging}:`, msg)
      transcriptError = 'transcript_fetch_error'
    }
  }

  return { utterances, transcriptError }
}

/**
 * Fetches the Attendee.dev transcript for a session's bot and normalizes it
 * into the same RecallUtterance[] shape fetchRecallTranscript() produces, so
 * every downstream consumer in this file (checkpoint-pair extraction, the 6
 * quality criteria, the 7-dimension classifier, both deferred-question
 * detectors) works unmodified regardless of which provider ran the session.
 *
 * Attendee's GET /api/v1/bots/{id}/transcript returns an array of
 * utterance-level objects — { speaker_name, timestamp_ms, duration_ms,
 * transcription } — not Recall's word-level { text, start_time, end_time }
 * array. There is no finer-grained timing available from Attendee's API, so
 * each utterance's words are synthesized by splitting `transcription` on
 * whitespace and giving every resulting word the SAME start_time/end_time
 * (the utterance's own start/end, in seconds). This is a real, non-fabricated
 * value at the utterance boundary — it is only the intra-utterance per-word
 * timing that's approximated — and every downstream consumer in this file only
 * ever reads the FIRST or LAST word's start_time/end_time (i.e. the utterance
 * boundary) or the word COUNT (for "last 200 words" style checks), never true
 * intra-utterance timing, so this normalization changes no scoring behavior.
 */
export async function fetchAttendeeTranscript(
  sessionIdForLogging: string,
  attendeeBotId: string | null,
  attendeeApiKey: string,
): Promise<RecallTranscriptResult> {
  let utterances: RecallUtterance[] = []
  let transcriptError: string | null = null

  if (!attendeeBotId) {
    console.warn(`[quality-evaluator] Session ${sessionIdForLogging} has no bot id — empty transcript`)
    transcriptError = 'no_bot_id'
  } else if (!attendeeApiKey || attendeeApiKey.startsWith('PLACEHOLDER')) {
    console.warn(`[quality-evaluator] ATTENDEE_API_KEY not set — skipping transcript for session ${sessionIdForLogging}`)
    transcriptError = 'attendee_api_key_missing'
  } else {
    try {
      const resp = await fetch(
        `https://app.attendee.dev/api/v1/bots/${attendeeBotId}/transcript`,
        { headers: { Authorization: `Token ${attendeeApiKey}` } },
      )

      if (!resp.ok) {
        if (resp.status === 404) {
          // Transcript not yet available — throw so Inngest retries this step
          // (parity with fetchRecallTranscript's 404 handling above).
          throw new Error(`Transcript not yet available for bot ${attendeeBotId} (HTTP 404)`)
        }
        console.error(`[quality-evaluator] Attendee API error ${resp.status} for session ${sessionIdForLogging}`)
        transcriptError = `attendee_api_error_${resp.status}`
      } else {
        const body = await resp.json() as Array<{
          speaker_name?: string
          timestamp_ms?: number
          duration_ms?: number
          transcription?: string
        }>

        if (Array.isArray(body) && body.length > 0) {
          utterances = body
            .filter((u) => typeof u.transcription === 'string' && u.transcription.trim().length > 0)
            .map((u) => {
              const startSec = (u.timestamp_ms ?? 0) / 1000
              const endSec = ((u.timestamp_ms ?? 0) + (u.duration_ms ?? 0)) / 1000
              const words = (u.transcription ?? '')
                .split(/\s+/)
                .filter(Boolean)
                .map((text) => ({ text, start_time: startSec, end_time: endSec }))
              return { speaker: u.speaker_name ?? 'unknown', words }
            })

          if (utterances.length === 0) transcriptError = 'transcript_empty'
        } else {
          transcriptError = 'transcript_empty'
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('HTTP 404')) throw err
      console.error(`[quality-evaluator] Attendee transcript fetch threw for session ${sessionIdForLogging}:`, msg)
      transcriptError = 'transcript_fetch_error'
    }
  }

  return { utterances, transcriptError }
}

export interface ClioSpeakerIdentification {
  clioSpeaker: string
  userSpeakers: string[]
  clioUtterances: RecallUtterance[]
  userUtterances: RecallUtterance[]
}

/**
 * Identifies which speaker label is Clio vs. the participant(s). Clio tends to
 * be more verbose — the more verbose speaker (by total word count) is treated
 * as Clio. Exact extraction of this file's original heuristic (no behavior
 * change).
 */
export function identifyClioSpeaker(utterances: RecallUtterance[]): ClioSpeakerIdentification {
  const speakerWordCount: Record<string, number> = {}
  for (const u of utterances) {
    speakerWordCount[u.speaker] = (speakerWordCount[u.speaker] ?? 0) + u.words.length
  }
  const speakers = Object.entries(speakerWordCount).sort((a, b) => b[1] - a[1])
  const clioSpeaker = speakers[0]?.[0] ?? 'host'
  const userSpeakers = speakers.slice(1).map(([s]) => s)

  const clioUtterances = utterances.filter((u) => u.speaker === clioSpeaker)
  const userUtterances = utterances.filter((u) => userSpeakers.includes(u.speaker))

  return { clioSpeaker, userSpeakers, clioUtterances, userUtterances }
}

// ─── 6 quality criteria evaluator ─────────────────────────────────────────────

function evaluateQualityCriteria(
  clioTranscriptText: string,
  topicTitle: string,
  roleLevel: string,
  industry: string,
  normalisedMat: string,
  clioUtterances: RecallUtterance[],
): QualityCriterionResult[] {
  const results: QualityCriterionResult[] = []
  const lowerTranscript = clioTranscriptText.toLowerCase()

  // Criterion 1: Teaches the selected topic directly
  // Pass if transcript contains topic_title or 3+ words from it.
  const topicWords = topicTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  const topicWordMatches = topicWords.filter((w) => lowerTranscript.includes(w))
  const c1Pass = lowerTranscript.includes(topicTitle.toLowerCase()) || topicWordMatches.length >= 3
  results.push({
    criterion: 1,
    result: c1Pass ? 'pass' : 'fail',
    evidence: c1Pass
      ? `Topic keywords matched: ${topicWordMatches.join(', ')}`
      : `Topic title or 3+ keywords not found in transcript (topic: "${topicTitle}")`,
  })

  // Criterion 2: Correct seniority framing
  const seniorityKey = roleLevel in SENIORITY_MARKERS ? roleLevel : 'c-suite'
  const seniorityWords = SENIORITY_MARKERS[seniorityKey]
  const matchedSeniority = seniorityWords.find((kw) => lowerTranscript.includes(kw))
  results.push({
    criterion: 2,
    result: matchedSeniority ? 'pass' : 'fail',
    evidence: matchedSeniority
      ? `Seniority marker found: "${matchedSeniority}"`
      : `No seniority markers for ${roleLevel} found (expected one of: ${seniorityWords.join(', ')})`,
  })

  // Criterion 3: At least one industry-specific example
  const industryKey = Object.keys(INDUSTRY_KEYWORDS).find((k) =>
    industry.toLowerCase().includes(k) || k.includes(industry.toLowerCase())
  )
  const industryWords = industryKey ? INDUSTRY_KEYWORDS[industryKey] : []
  const matchedIndustry = industryWords.find((kw) => lowerTranscript.includes(kw))
    ?? (lowerTranscript.includes(industry.toLowerCase()) ? industry.toLowerCase() : null)
  results.push({
    criterion: 3,
    result: matchedIndustry ? 'pass' : 'fail',
    evidence: matchedIndustry
      ? `Industry keyword found: "${matchedIndustry}"`
      : 'No industry keywords matched in transcript',
  })

  // Criterion 4: Depth matches maturity
  // For beginner/observer: fail if >3 "too technical" markers appear.
  if (normalisedMat === 'beginner') {
    const techMatches = TOO_TECHNICAL_BEGINNER.filter((kw) => lowerTranscript.includes(kw))
    const c4Pass = techMatches.length <= 3
    results.push({
      criterion: 4,
      result: c4Pass ? 'pass' : 'fail',
      evidence: c4Pass
        ? `Technical term count within limit: ${techMatches.length}/3`
        : `Too many technical terms for beginner user: ${techMatches.join(', ')}`,
    })
  } else {
    // For intermediate/advanced/expert users this criterion is always pass.
    results.push({
      criterion: 4,
      result: 'pass',
      evidence: `Maturity level "${normalisedMat}" — depth check not applicable`,
    })
  }

  // Criterion 5: Ends with something actionable
  // Check last 200 words of Clio's spoken text.
  const allClioWords = clioUtterances.flatMap((u) => u.words.map((w) => w.text))
  const last200Words = allClioWords.slice(-200).join(' ').toLowerCase()
  const matchedActionable = ACTIONABLE_TAIL_KEYWORDS.find((kw) => last200Words.includes(kw))
  results.push({
    criterion: 5,
    result: matchedActionable ? 'pass' : 'fail',
    evidence: matchedActionable
      ? `Actionable keyword in tail: "${matchedActionable}"`
      : 'No actionable keywords found in last 200 words of Clio speech',
  })

  // Criterion 6: Connects to adjacent subtopics
  const matchedTransition = TRANSITION_PHRASES.find((kw) => lowerTranscript.includes(kw))
  results.push({
    criterion: 6,
    result: matchedTransition ? 'pass' : 'fail',
    evidence: matchedTransition
      ? `Transition phrase found: "${matchedTransition}"`
      : 'No subtopic transition phrases found in transcript',
  })

  return results
}

// ─── Inngest cron function ─────────────────────────────────────────────────────

type StepFn = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> }

export const sessionQualityEvaluator = inngest.createFunction(
  {
    id: 'session-quality-evaluator',
    retries: 3,
    triggers: [{ cron: '*/15 * * * *' }],
  },
  async ({ step }: { step: StepFn }) => {
    const recallApiKey = process.env.RECALL_API_KEY ?? ''
    if (!recallApiKey || recallApiKey.startsWith('PLACEHOLDER_')) {
      console.warn('[quality-evaluator] RECALL_API_KEY not set — skipping transcript fetch')
    }
    const attendeeApiKey = process.env.ATTENDEE_API_KEY ?? ''
    if (!attendeeApiKey || attendeeApiKey.startsWith('PLACEHOLDER')) {
      console.warn('[quality-evaluator] ATTENDEE_API_KEY not set — skipping Attendee transcript fetch')
    }

    const supabase = createSupabaseAdminClient()

    // ── Step A: Find sessions due for evaluation ──────────────────────────────
    const sessions = await step.run('find-sessions-to-evaluate', async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          id,
          user_id,
          session_title,
          topic_id,
          recall_bot_id,
          ended_at,
          hume_native_enabled,
          meeting_bot_provider,
          users!inner (
            role,
            industry,
            ai_maturity,
            active_plan_id,
            created_at
          )
        `)
        .eq('status', 'completed')
        .eq('quality_evaluated', false)
        .gte('ended_at', new Date(Date.now() - 2 * 60 * 60 * 1000 - 15 * 60 * 1000).toISOString())
        .lt('ended_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())

      if (error) {
        console.error('[quality-evaluator] Failed to fetch sessions:', error.message)
        return [] as SessionRow[]
      }

      // Flatten the join — Supabase returns nested objects for joined tables
      return (data ?? []).map((row) => {
        const user = Array.isArray(row.users) ? row.users[0] : row.users
        return {
          id: row.id,
          user_id: row.user_id,
          session_title: row.session_title ?? null,
          topic_id: row.topic_id ?? null,
          recall_bot_id: row.recall_bot_id ?? null,
          ended_at: row.ended_at,
          role: (user as { role?: string | null })?.role ?? null,
          industry: (user as { industry?: string | null })?.industry ?? null,
          ai_maturity: (user as { ai_maturity?: string | null })?.ai_maturity ?? null,
          active_plan_id: (user as { active_plan_id?: string | null })?.active_plan_id ?? null,
          created_at: (user as { created_at?: string | null })?.created_at ?? null,
          // Defensive: older rows / pre-migration schemas may not have this column yet.
          // Treat null/undefined as "not Hume-native" so existing sessions keep using
          // the Custom-LLM-path detector below (no behavior change for existing rows).
          hume_native_enabled: (row as { hume_native_enabled?: boolean | null }).hume_native_enabled ?? null,
          meeting_bot_provider: (row as { meeting_bot_provider?: string | null }).meeting_bot_provider ?? null,
        } satisfies SessionRow
      })
    })

    console.log(`[quality-evaluator] Sessions to evaluate: ${sessions.length}`)

    // ── Process each session individually ────────────────────────────────────
    for (const session of sessions) {
      await step.run(`evaluate-session-${session.id}`, async () => {
        await evaluateSession(supabase, session, recallApiKey, attendeeApiKey)
      })
    }

    return { evaluated: sessions.length }
  },
)

// ─── Per-session evaluation logic ─────────────────────────────────────────────

async function evaluateSession(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  session: SessionRow,
  recallApiKey: string,
  attendeeApiKey: string,
): Promise<void> {
  const topicId = session.topic_id ?? 'unknown'
  const topicTitle = session.session_title ?? 'AI Strategy Session'
  const normMat = normaliseMaturity(session.ai_maturity ?? 'intermediate')
  const roleLevel = 'c-suite' // will be resolved from role_level if available
  const industry = session.industry ?? 'business'

  // ── Step B: Fetch the transcript from whichever meeting-bot provider ran
  // this session. NULL/'recall' (all pre-migration rows — see migration 070)
  // keeps using fetchRecallTranscript(), unchanged. Only sessions explicitly
  // recorded as 'attendee' use the new fetchAttendeeTranscript() path — both
  // return the identical RecallTranscriptResult shape, so nothing below this
  // point (checkpoint pairing, quality criteria, dimension classification,
  // deferred-question detection) needs to know which provider ran the call.
  // RTV-03 (2026-07-10): fetchRecallTranscript() extracted so the sibling
  // accuracy-evaluator reuses this exact logic rather than duplicating it —
  // pure extraction, no behavior change here.
  const isAttendeeSession = session.meeting_bot_provider === 'attendee'
  const { utterances, transcriptError: fetchedTranscriptError } = isAttendeeSession
    ? await fetchAttendeeTranscript(session.id, session.recall_bot_id, attendeeApiKey)
    : await fetchRecallTranscript(session.id, session.recall_bot_id, recallApiKey)
  let transcriptError = fetchedTranscriptError

  // If transcript completely unavailable after retries, mark and move on
  if (transcriptError === 'transcript_unavailable') {
    await supabase.from('sessions').update({
      quality_evaluated: true,
      quality_error: 'transcript_unavailable',
    }).eq('id', session.id)
    return
  }

  // ── Identify Clio vs user speaker labels ──────────────────────────────────
  // RTV-03 (2026-07-10): extracted to identifyClioSpeaker() — pure extraction,
  // no behavior change here.
  const { clioSpeaker, userSpeakers, clioUtterances, userUtterances } = identifyClioSpeaker(utterances)

  // Full Clio transcript text (concatenated)
  const clioText = clioUtterances.map(utteranceText).join(' ')
  const clioTextEmpty = clioText.trim().length === 0

  if (clioTextEmpty) {
    transcriptError = 'no_clio_speech_detected'
  }

  // ── DEFER-QUESTION-01: Detect deferred-question moments ──────────────────
  // Mutually exclusive per session, gated on hume_native_enabled: Hume-native
  // sessions use the Hume-native-specific phrase family/detector; every other
  // session (falsy/undefined flag — includes all pre-existing rows) keeps
  // using the original Custom-LLM-path detector, unchanged.
  const detectedDeferrals: Array<DetectedDeferredQuestion | DeferredQuestionEntry> = clioTextEmpty
    ? []
    : session.hume_native_enabled === true
      ? detectHumeNativeDeferredQuestions(utterances, clioSpeaker, userSpeakers, session.ended_at)
      : detectDeferredQuestions(utterances, clioSpeaker, userSpeakers, session.ended_at)

  // ── Step C: Extract checkpoint question/response pairs ────────────────────
  let pairs: CheckpointPair[] = []

  if (!clioTextEmpty && topicId !== 'unknown') {
    const { data: cacheRows } = await supabase
      .from('topic_content_cache')
      .select('subtopic_slug, content_outline')
      .eq('topic_id', topicId)

    if (cacheRows && cacheRows.length > 0) {
      for (const cacheRow of cacheRows) {
        const outline = cacheRow.content_outline as {
          subtopics?: Array<{ checkpoint_question?: string }>
        } | null
        const checkpoints = outline?.subtopics
          ?.map((s) => s.checkpoint_question)
          .filter((q): q is string => typeof q === 'string' && q.length > 0) ?? []

        for (const cpQuestion of checkpoints) {
          // Find matching Clio utterance (word overlap >= 70%)
          const matchedUtterance = clioUtterances.find(
            (u) => wordOverlapSimilarity(cpQuestion, utteranceText(u)) >= 0.7,
          )
          if (!matchedUtterance) continue

          const cpEndTime = matchedUtterance.words[matchedUtterance.words.length - 1]?.end_time ?? 0

          // User response: first user utterance starting within 30s of checkpoint end
          const responseUtterance = userUtterances.find(
            (u) => (u.words[0]?.start_time ?? 0) >= cpEndTime &&
                    (u.words[0]?.start_time ?? 0) <= cpEndTime + 30,
          )
          if (!responseUtterance) continue

          const responseText = utteranceText(responseUtterance)
          const variant = classifyResponse(responseText)

          pairs.push({
            question: cpQuestion,
            response: responseText,
            subtopic_slug: String(cacheRow.subtopic_slug),
            variant,
          })
        }
      }
    }
  }

  // ── Step D: Variant scores already classified in Step C ───────────────────

  // ── Step E: Evaluate 6 quality criteria ──────────────────────────────────
  const criteriaResults: QualityCriterionResult[] = evaluateQualityCriteria(
    clioText,
    topicTitle,
    roleLevel,
    industry,
    normMat,
    clioUtterances,
  )

  // ── Step F: Update knowledge_profiles ────────────────────────────────────
  if (pairs.length > 0) {
    const avgVariantScore = pairs.reduce((sum, p) => sum + VARIANT_SCORE[p.variant], 0) / pairs.length
    const comprehensionStatus = comprehensionStatusFromScore(avgVariantScore)
    const gaps = pairs
      .filter((p) => ['V4', 'V5', 'V6'].includes(p.variant))
      .map((p) => p.subtopic_slug)

    // Fetch existing profile to update sessions_count and check maturity_signal
    const { data: existingProfile } = await supabase
      .from('knowledge_profiles')
      .select('sessions_count, comprehension_status, maturity_signal')
      .eq('user_id', session.user_id)
      .eq('topic_id', topicId)
      .maybeSingle()

    const prevCount = (existingProfile?.sessions_count ?? 0)
    const newCount = prevCount + 1

    // maturity_signal: set 'promoted' if this is the 2nd consecutive 'understood'
    let maturitySignal: string | null = existingProfile?.maturity_signal ?? null
    if (comprehensionStatus === 'understood' && existingProfile?.comprehension_status === 'understood') {
      maturitySignal = 'promoted'
    }

    await supabase.from('knowledge_profiles').upsert(
      {
        user_id: session.user_id,
        topic_id: topicId,
        sessions_count: newCount,
        avg_variant_score: Number(avgVariantScore.toFixed(2)),
        comprehension_status: comprehensionStatus,
        gaps,
        maturity_signal: maturitySignal,
        last_evaluated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,topic_id' },
    )

    // ── Step G: Insert reinforcement subtopics into queue for gaps ──────────
    if (gaps.length > 0 && session.active_plan_id) {
      const { data: planRow } = await supabase
        .from('curriculum_plans')
        .select('queue_sessions')
        .eq('id', session.active_plan_id)
        .single()

      if (planRow) {
        const existingQueue = Array.isArray(planRow.queue_sessions) ? planRow.queue_sessions : []

        let queueModified = false
        const newQueue = [...existingQueue]

        for (const gap of gaps) {
          const pair = pairs.find((p) => p.subtopic_slug === gap)
          if (!pair) continue

          // Idempotency: skip if a reinforcement session for this subtopic already exists
          const alreadyQueued = newQueue.some(
            (s: { session_id?: string }) =>
              typeof s.session_id === 'string' && s.session_id.startsWith(`reinforcement-${gap}`),
          )
          if (alreadyQueued) continue

          const reinforcementSession = {
            session_id: `reinforcement-${gap}-${Date.now()}`,
            title: `Reinforcing: ${gap.replace(/-/g, ' ')}`,
            focus: `Revisiting the concepts from ${gap.replace(/-/g, ' ')} with a different framing and examples.`,
            layer: 'L2_core',
            depth_level: normMat === 'beginner' ? 'beginner' : 'intermediate',
            is_visible: false,
            queue_rationale: `Gap identified from session quality evaluation — user response classified as ${pair.variant} on this subtopic.`,
          }

          // Insert at position 0 (next to be unlocked)
          newQueue.unshift(reinforcementSession)
          queueModified = true
        }

        if (queueModified) {
          await supabase
            .from('curriculum_plans')
            .update({ queue_sessions: newQueue })
            .eq('id', session.active_plan_id)
        }
      }
    }

    // ── Step H: Recalculate ai_readiness_score ──────────────────────────────
    if (session.created_at) {
      const daysSinceOnboarding =
        (Date.now() - new Date(session.created_at).getTime()) / (1000 * 60 * 60 * 24)

      if (daysSinceOnboarding >= 7) {
        const { count: totalCompleted } = await supabase
          .from('sessions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.user_id)
          .eq('status', 'completed')
          .eq('quality_evaluated', true)

        if ((totalCompleted ?? 0) >= 5) {
          const { data: allProfiles } = await supabase
            .from('knowledge_profiles')
            .select('avg_variant_score, sessions_count')
            .eq('user_id', session.user_id)

          if (allProfiles && allProfiles.length > 0) {
            // avgComprehension: normalise avg_variant_score (0–10) to 0–100
            const totalWeightedScore = allProfiles.reduce(
              (sum, p) => sum + (Number(p.avg_variant_score) / 10) * 100 * (p.sessions_count ?? 1),
              0,
            )
            const totalSessions = allProfiles.reduce((sum, p) => sum + (p.sessions_count ?? 1), 0)
            const avgComprehension = totalWeightedScore / Math.max(totalSessions, 1)

            // Fetch streak_days for the score formula
            const { data: userRow } = await supabase
              .from('users')
              .select('streak_days')
              .eq('id', session.user_id)
              .single()

            const streakDays = (userRow as { streak_days?: number } | null)?.streak_days ?? 0
            const streakContribution = Math.min(streakDays / 30, 1) * 40
            const comprehensionContribution = avgComprehension * 0.6
            const newScore = Math.min(100, Math.round(comprehensionContribution + streakContribution))

            await supabase
              .from('users')
              .update({ ai_readiness_score: newScore })
              .eq('id', session.user_id)

            console.log(`[quality-evaluator] ai_readiness_score updated for user ${session.user_id}: ${newScore}`)
          }
        }
      }
    }
  }

  // ── CURR-01: Compute 7-dimension classification from transcript ──────────────
  const dimensionResult: SessionDimensionResult = checkSessionDimensions(
    clioText,
    topicTitle,
    roleLevel,
    industry,
  )

  // ── DEFER-QUESTION-01: Append detected deferrals to sessions.deferred_questions ──
  // Fetch-then-append (never overwrite) so this stays compatible with any other
  // writer of this column (e.g. the separate Hume-native walkthrough path).
  let mergedDeferredQuestions: Array<DetectedDeferredQuestion | DeferredQuestionEntry> | null = null
  if (detectedDeferrals.length > 0) {
    const { data: existingSessionRow } = await supabase
      .from('sessions')
      .select('deferred_questions')
      .eq('id', session.id)
      .single()

    const existingDeferrals: Array<DetectedDeferredQuestion | DeferredQuestionEntry> = Array.isArray(
      (existingSessionRow as { deferred_questions?: unknown } | null)?.deferred_questions,
    )
      ? ((existingSessionRow as { deferred_questions: Array<DetectedDeferredQuestion | DeferredQuestionEntry> }).deferred_questions)
      : []

    mergedDeferredQuestions = [...existingDeferrals, ...detectedDeferrals]
  }

  // ── Step I: Mark session as quality-evaluated ─────────────────────────────
  try {
    await supabase
      .from('sessions')
      .update({
        quality_evaluated: true,
        quality_error: transcriptError ?? null,
        quality_criteria_results: criteriaResults.length > 0
          ? criteriaResults
          : [{ criterion: 0, result: 'fail' as const, evidence: transcriptError ?? 'no transcript' }],
        quality_dimension_result: dimensionResult,
        ...(mergedDeferredQuestions ? { deferred_questions: mergedDeferredQuestions } : {}),
      })
      .eq('id', session.id)
  } catch (updateErr) {
    // If the dimension result write fails (e.g. column not yet migrated), fall back to
    // writing without it so the session is still marked evaluated (prevents re-evaluation).
    console.error(`[quality-evaluator] Failed to write quality_dimension_result for session ${session.id} — retrying without it:`, updateErr)
    await supabase
      .from('sessions')
      .update({
        quality_evaluated: true,
        quality_error: transcriptError ?? null,
        quality_criteria_results: criteriaResults.length > 0
          ? criteriaResults
          : [{ criterion: 0, result: 'fail' as const, evidence: transcriptError ?? 'no transcript' }],
        ...(mergedDeferredQuestions ? { deferred_questions: mergedDeferredQuestions } : {}),
      })
      .eq('id', session.id)
  }

  console.log(
    `[quality-evaluator] Session ${session.id} evaluated: ` +
    `${pairs.length} pairs, ${criteriaResults.filter((c) => c.result === 'pass').length}/6 criteria pass`,
  )
}
