/**
 * RTV-02 — Marker-generation content-authoring pipeline.
 *
 * DATA-ONLY. Nothing here runs live, nothing is displayed. This module derives,
 * at content-authoring time, a high-precision set of "golden word" markers per
 * session topic so a later phase (RTV-03) can identify which topic Clio is
 * teaching from a single reliable keyword hit in live speech.
 *
 * See .claude/agents/clio/requirement-docs/RTV-02-marker-generation-pipeline.md
 * for the full approved spec (Section 5 worked example, Q1/Q2 pseudocode).
 *
 * Algorithm summary (Q1):
 *   0. Bookend markers (section_index 0 = "overview", N+1 = "summary") are
 *      literal words — they never go through the three-check pipeline.
 *   1. Every non-bookend topic gets 3 own-topic source levels: level 0 =
 *      extractWhatToCover(teach) (the exact runtime "what to cover" line),
 *      level 1 = full teach text, level 2 = the full 8-field article.
 *   2. Check 3 (uniqueness) is deterministic, computed ONCE against every
 *      topic's full teach text: a token is topic-unique iff it appears in
 *      exactly one topic (grouped by topic, not raw count).
 *   3. Checks 1 & 2 (noun/named-term + cannot-miss) are ONE LLM call per
 *      escalation level, covering every topic still needing judgment at that
 *      level — never a per-topic call.
 *   4. Bounded rework loop: level 0 -> 1 -> 2, stop at first level with >=1
 *      approved candidate for a topic. Golden word = highest within-topic
 *      frequency among approved candidates (ties: token length desc, then
 *      alphabetical).
 *   5. Hard no-fallback stop: any topic with zero approved candidates after
 *      level 2 flags the WHOLE session rtv_eligible=false (never ships an
 *      empty marker array for a non-bookend topic while eligible=true).
 *
 * This module is pure/testable: it performs no DB writes. Callers (the
 * Inngest pipeline step, currently) write the returned object to
 * sessions.session_markers / sessions.rtv_eligible.
 */

import Anthropic from '@anthropic-ai/sdk'
import { extractWhatToCover } from '@/lib/clio-context-builder'
import { sendAdminAlert } from '@/lib/delivery/email'
import type { LiveConductorTab } from '@/lib/content/live-conductor-content'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface SessionMarker {
  word: string
  literal?: true
  within_topic_freq?: number
  rank?: number
}

export interface SessionMarkerEntry {
  section_index: number
  type: 'SessionOverview' | 'SessionSummary' | 'topic'
  subtopic_slug: string | null
  subtopic_title?: string
  is_bookend: boolean
  source_level?: number
  golden_word: string | null
  markers: SessionMarker[]
}

export interface SessionMarkers {
  version: 1
  generator: 'rtv-02'
  generated_at: string
  source: 'live_conductor_content'
  rtv_eligible: boolean
  rtv_ineligible_reason: string | null
  topics: SessionMarkerEntry[]
}

// ─── ANTHROPIC CLIENT (same pattern as lib/content/live-conductor-content.ts) ─

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

// ─── TOKENIZER (deterministic, reviewable) ───────────────────────────────────

/**
 * Curated stoplist: articles, prepositions, pronouns, auxiliaries,
 * conjunctions, and session-generic words that appear across nearly every
 * topic (so they would never survive check 3 anyway, but dropping them here
 * keeps candidate pools small and the LLM prompt focused). Reviewable by QA —
 * this is the single source of truth for excluded generic terms.
 */
export const RTV02_STOPWORDS = new Set<string>([
  // articles
  'a', 'an', 'the',
  // prepositions
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'into', 'onto',
  'over', 'under', 'about', 'across', 'after', 'before', 'between', 'during',
  'through', 'without', 'within', 'against', 'among', 'around', 'up', 'out', 'off',
  // pronouns / determiners
  'it', 'its', 'they', 'their', 'them', 'this', 'that', 'these', 'those',
  'you', 'your', 'we', 'our', 'he', 'she', 'his', 'her', 'i', 'my', 'who', 'which', 'what',
  // auxiliaries / common verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'shall',
  // conjunctions / connectives
  'and', 'or', 'but', 'so', 'as', 'if', 'because', 'than', 'then', 'not', 'no',
  // curated session-generic terms — appear across nearly every topic in an
  // AI-coaching session, so they are never safe single-hit markers
  'ai', 'model', 'models', 'use', 'using', 'used', 'data', 'system', 'systems',
  'executive', 'executives', 'business', 'team', 'teams', 'work', 'working',
  'help', 'helps', 'need', 'needs', 'way', 'ways', 'one', 'two', 'three',
  'also', 'more', 'most', 'like', 'just', 'get', 'gets', 'new', 'today', 'now',
  'when', 'where', 'why', 'how', 'all', 'any', 'some', 'each', 'every', 'other',
  'make', 'makes', 'making', 'take', 'takes', 'taking', 'give', 'gives', 'giving',
  'session', 'topic', 'topics', 'thing', 'things', 'know', 'knowing', 'understand',
])

/**
 * Deterministic tokenizer: lowercase + Unicode NFKC normalize, split on
 * whitespace/punctuation EXCEPT internal hyphens/underscores/dots between
 * alphanumerics (so `top_p`, `server-sent`, `gpt-4`, `claude-sonnet-4-6`
 * survive as single tokens). Drops pure-number tokens, tokens shorter than 2
 * chars, and stopwords.
 */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return []
  const normalized = text.normalize('NFKC').toLowerCase()
  const raw = normalized.match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) ?? []
  return raw.filter((tok) => {
    if (tok.length < 2) return false
    if (/^[0-9]+$/.test(tok)) return false
    if (RTV02_STOPWORDS.has(tok)) return false
    return true
  })
}

// ─── PER-TOPIC SOURCE BUILDING ────────────────────────────────────────────────

function buildTeachText(sections: LiveConductorTab['article']['sections']): string {
  return [sections.overview, sections.how_it_works, sections.enterprise_implications]
    .filter(Boolean)
    .join(' ')
}

function buildLevel2Text(sections: LiveConductorTab['article']['sections']): string {
  return [
    sections.overview,
    ...(sections.key_facts ?? []),
    sections.how_it_works,
    sections.enterprise_implications,
    ...(sections.common_misconceptions ?? []),
    ...(sections.decision_questions ?? []),
    sections.illustrative_example,
    sections.try_this,
  ]
    .filter(Boolean)
    .join(' ')
}

// ─── STABLE UNIQUENESS CORPUS (check 3 — deterministic, no LLM) ──────────────

function buildTokenToTopics(tokensFullPerTopic: string[][]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>()
  tokensFullPerTopic.forEach((tokens, i) => {
    Array.from(new Set(tokens)).forEach((token) => {
      if (!map.has(token)) map.set(token, new Set())
      map.get(token)!.add(i)
    })
  })
  return map
}

// ─── CHECKS 1 & 2 (LLM, one call per escalation level across all topics) ────

interface JudgeBatchItem {
  index: number
  title: string
  sourceText: string
  candidates: string[]
  freqByToken: Record<string, number>
}

type JudgeResult = Record<number, string[]>

function buildJudgePrompt(items: JudgeBatchItem[]): string {
  const topicsBlock = items
    .map((item) => {
      return [
        `TOPIC INDEX ${item.index}`,
        `Title: "${item.title}"`,
        `Source text: "${item.sourceText}"`,
        `Candidate tokens (already confirmed unique to this topic within this session): ${item.candidates.join(', ')}`,
      ].join('\n')
    })
    .join('\n\n')

  return `You are screening candidate keyword markers for a live voice-AI topic tracker in an executive coaching session. For each topic below, decide which of its candidate tokens qualify as a "golden word" marker.

A token QUALIFIES only if BOTH are true:
1. It is a noun, a specific named thing, or a technical term — NOT a generic descriptive word, adjective, or verb that could apply to many topics.
2. It is "cannot-miss" — this specific topic cannot be taught without this term coming up. It is central to the topic, not incidental.

${topicsBlock}

Return ONLY strict JSON in this exact shape, no markdown, no commentary, no code fences:
{"topics":[{"index":0,"qualifying_tokens":["..."]}]}

Only include tokens drawn from each topic's own candidate list above. If none qualify for a topic, return an empty array for that topic. Include exactly one entry for every topic index listed above.`
}

function parseJudgeResponse(text: string): { topics: Array<{ index: number; qualifying_tokens: string[] }> } {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim()

  const parsed: unknown = JSON.parse(cleaned)

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { topics?: unknown }).topics)
  ) {
    throw new Error('malformed judge response: missing topics array')
  }

  const topics = (parsed as { topics: unknown[] }).topics
  for (const t of topics) {
    if (
      !t ||
      typeof t !== 'object' ||
      typeof (t as { index?: unknown }).index !== 'number' ||
      !Array.isArray((t as { qualifying_tokens?: unknown }).qualifying_tokens)
    ) {
      throw new Error('malformed judge response: invalid topic entry')
    }
  }

  return parsed as { topics: Array<{ index: number; qualifying_tokens: string[] }> }
}

/**
 * Runs checks 1 & 2 for every topic in `items` (all topics still needing
 * judgment at the current escalation level) as a SINGLE LLM call — never
 * per-topic. On a placeholder API key, mocks by approving the top-K
 * (K = min(3, candidate count)) topic-unique tokens by within-topic
 * frequency, deterministically, so dev/build/CI never break (Section 8).
 *
 * Throws on Anthropic call failure or malformed JSON — callers must treat
 * that as a whole-session failure (never partially trust a failed pass).
 */
async function judgeCandidatesBatch(level: number, items: JudgeBatchItem[]): Promise<JudgeResult> {
  if (items.length === 0) return {}

  if (isPlaceholder || !anthropic) {
    const result: JudgeResult = {}
    for (const item of items) {
      const k = Math.min(3, item.candidates.length)
      const ranked = [...item.candidates].sort(
        (a, b) => (item.freqByToken[b] ?? 0) - (item.freqByToken[a] ?? 0)
      )
      result[item.index] = ranked.slice(0, k)
      console.log(`[MOCK] rtv-02: level ${level} topic ${item.index} ("${item.title}") approved:`, result[item.index])
    }
    return result
  }

  const prompt = buildJudgePrompt(items)
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = (message.content[0] as { type: string; text: string }).text.trim()
  const parsed = parseJudgeResponse(text)

  const result: JudgeResult = {}
  for (const t of parsed.topics) {
    const item = items.find((it) => it.index === t.index)
    if (!item) continue
    // Defensive: only trust tokens that were actually offered as candidates.
    result[t.index] = t.qualifying_tokens.filter((tok) => item.candidates.includes(tok))
  }
  return result
}

// ─── BOOKEND / EMPTY-TOPIC HELPERS ───────────────────────────────────────────

function bookendEntry(sectionIndex: number, type: 'SessionOverview' | 'SessionSummary', word: string): SessionMarkerEntry {
  return {
    section_index: sectionIndex,
    type,
    subtopic_slug: null,
    is_bookend: true,
    golden_word: word,
    markers: [{ word, literal: true }],
  }
}

function emptyTopicEntry(tab: LiveConductorTab, index: number): SessionMarkerEntry {
  return {
    section_index: index + 1,
    type: 'topic',
    subtopic_slug: tab.subtopic_slug,
    subtopic_title: tab.subtopic_title,
    is_bookend: false,
    golden_word: null,
    markers: [],
  }
}

async function sendAdminAlertSafe(sessionId: string, reason: string): Promise<void> {
  try {
    await sendAdminAlert({
      subject: `RTV-02: session ${sessionId} flagged RTV-ineligible`,
      body: `Session ${sessionId} could not generate a complete marker set for every topic.\n\nReason: ${reason}`,
      context: { sessionId, reason },
    })
  } catch (err) {
    // Never let alert failure mask the original ineligibility result.
    console.error('[rtv-02] sendAdminAlert failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

/**
 * Generates the full marker set for a session's live-conductor tabs, per the
 * Q1 algorithm. Pure/testable — does not write to the DB; callers persist the
 * returned object to sessions.session_markers / sessions.rtv_eligible.
 *
 * @param sessionId - Used only for admin-alert context and log lines.
 * @param tabs       - live_conductor_content.tabs, in tab order (non-bookend).
 */
export async function generateSessionMarkers(
  sessionId: string,
  tabs: LiveConductorTab[]
): Promise<SessionMarkers> {
  const generated_at = new Date().toISOString()
  const N = tabs.length

  const overviewEntry = bookendEntry(0, 'SessionOverview', 'overview')
  const summaryEntry = bookendEntry(N + 1, 'SessionSummary', 'summary')

  if (N === 0) {
    return {
      version: 1,
      generator: 'rtv-02',
      generated_at,
      source: 'live_conductor_content',
      rtv_eligible: false,
      rtv_ineligible_reason: 'no topics in live_conductor_content',
      topics: [overviewEntry, summaryEntry],
    }
  }

  // ── 1. Build per-topic sources at all 3 levels (own-topic content only) ───
  const teachTexts: string[] = []
  const levelSources: [string[], string[], string[]] = [[], [], []]

  for (const tab of tabs) {
    const sections = tab.article.sections
    const teach = buildTeachText(sections)
    teachTexts.push(teach)
    levelSources[0].push(extractWhatToCover(teach || null))
    levelSources[1].push(teach)
    levelSources[2].push(buildLevel2Text(sections))
  }

  // ── 2. Stable uniqueness corpus (deterministic, NO LLM) — check 3 ─────────
  const tokensFullPerTopic = teachTexts.map((t) => tokenize(t))
  const tokenToTopics = buildTokenToTopics(tokensFullPerTopic)
  const isTopicUnique = (token: string): boolean => (tokenToTopics.get(token)?.size ?? 0) === 1

  // ── 3. Bounded escalation (levels 0 -> 1 -> 2), one LLM call per level ────
  const resolved: (SessionMarkerEntry | null)[] = new Array(N).fill(null)

  try {
    for (let level = 0; level <= 2; level++) {
      const batchItems: JudgeBatchItem[] = []

      for (let i = 0; i < N; i++) {
        if (resolved[i]) continue // topic already satisfied at an earlier level

        const pool = tokenize(levelSources[level][i])
        const distinctCandidates = Array.from(new Set(pool)).filter(isTopicUnique)
        if (distinctCandidates.length === 0) continue // nothing unique here — escalate

        const freqByToken: Record<string, number> = {}
        for (const c of distinctCandidates) {
          freqByToken[c] = pool.reduce((count, tok) => (tok === c ? count + 1 : count), 0)
        }

        batchItems.push({
          index: i,
          title: tabs[i].subtopic_title,
          sourceText: levelSources[level][i],
          candidates: distinctCandidates,
          freqByToken,
        })
      }

      if (batchItems.length === 0) continue // nobody has candidates to judge at this level

      const approvedMap = await judgeCandidatesBatch(level, batchItems)

      for (const item of batchItems) {
        const approved = approvedMap[item.index] ?? []
        if (approved.length === 0) continue // still unresolved — will escalate next level

        // Golden-word scoring: within-home-topic frequency is the golden
        // signal (repetition is a plus, never a disqualifier). Ties broken by
        // token length desc, then alphabetical.
        const ranked = approved
          .map((word) => ({ word, freq: item.freqByToken[word] ?? 0 }))
          .sort((a, b) => b.freq - a.freq || b.word.length - a.word.length || a.word.localeCompare(b.word))
          .map((m, idx): SessionMarker => ({ word: m.word, within_topic_freq: m.freq, rank: idx + 1 }))

        resolved[item.index] = {
          section_index: item.index + 1,
          type: 'topic',
          subtopic_slug: tabs[item.index].subtopic_slug,
          subtopic_title: tabs[item.index].subtopic_title,
          is_bookend: false,
          source_level: level,
          golden_word: ranked[0].word,
          markers: ranked,
        }
      }
    }
  } catch (err) {
    // Anthropic call failure or malformed JSON at any escalation level — treat
    // as a whole-session failure. Never partially trust output from a failed
    // LLM pass; topics already resolved via a genuinely successful earlier
    // level are kept for inspection only (mirrors the hard-stop path below).
    const reason = 'marker LLM judgment unavailable'
    console.error('[rtv-02] generateSessionMarkers: LLM judgment failed:', err instanceof Error ? err.message : err)
    await sendAdminAlertSafe(sessionId, reason)

    const topics: SessionMarkerEntry[] = [
      overviewEntry,
      ...tabs.map((tab, i) => resolved[i] ?? emptyTopicEntry(tab, i)),
      summaryEntry,
    ]

    return {
      version: 1,
      generator: 'rtv-02',
      generated_at,
      source: 'live_conductor_content',
      rtv_eligible: false,
      rtv_ineligible_reason: reason,
      topics,
    }
  }

  // ── 4. Hard no-fallback stop: any topic with zero markers fails the session ─
  let ineligibleReason: string | null = null
  for (let i = 0; i < N; i++) {
    if (!resolved[i]) {
      ineligibleReason = `topic '${tabs[i].subtopic_slug}' yielded zero unique golden words after full source escalation (levels 0-2)`
    }
  }

  const eligible = ineligibleReason === null
  if (!eligible) {
    await sendAdminAlertSafe(sessionId, ineligibleReason!)
  }

  const topics: SessionMarkerEntry[] = [
    overviewEntry,
    ...tabs.map((tab, i) => resolved[i] ?? emptyTopicEntry(tab, i)),
    summaryEntry,
  ]

  return {
    version: 1,
    generator: 'rtv-02',
    generated_at,
    source: 'live_conductor_content',
    rtv_eligible: eligible,
    rtv_ineligible_reason: ineligibleReason,
    topics,
  }
}
