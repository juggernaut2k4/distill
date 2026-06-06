/**
 * FB-007 — 3-Layer Narrative Curriculum Enrichment
 *
 * Adds structural metadata (layer tag, quality score, dimension coverage) to an
 * existing curriculum plan output via a 2-Claude-API-call pipeline:
 *
 *   Call 1 — Topic Decomposition + Narrative Arc
 *     Classifies each session as L1_foundation | L2_core | L3_strategic and
 *     assigns dependency_ref, bridge_ref, and a role-specific "so what" sentence.
 *
 *   Call 2 — Quality Scoring
 *     Scores each session on 4 axes (0–10 each):
 *     role_relevance, industry_specificity, narrative_cohesion, dimension_coverage.
 *
 *   Local — L2 Completeness Check
 *     Keyword-checks L2 session subtopics against 7 mandatory dimensions.
 *     Retries Call 1 once if fewer than 5 of 7 dimensions are covered across all L2 sessions.
 *
 *   Local — L1 Skipping
 *     For users whose normalised maturity is 'advanced' or 'expert', L1 sessions are
 *     retained in the data but marked skip:true and excluded from visible_sessions.
 *
 * Error contract: if either Claude call fails or times out the function returns null.
 * The caller falls back to the unenriched plan. Plan delivery is never blocked.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  LayerTag,
  DimensionCoverageMap,
  QualityScore,
  EnrichedSession,
  EnrichedPlan,
  L2Dimension,
} from './types'
import { normaliseMaturity } from './planner'

// ─── Constants ────────────────────────────────────────────────────────────────

const CALL_TIMEOUT_MS = 15_000

const L2_DIMENSION_KEYWORDS: Record<L2Dimension, string[]> = {
  how_it_works:          ['how', 'mechanism', 'works', 'process', 'architecture', 'generates', 'training'],
  capabilities:          ['can', 'capability', 'able', 'enable', 'support', 'capabilities', 'features'],
  limitations:           ['limitation', 'cannot', 'limit', 'constraint', 'fail', 'cannot', 'limits', 'failure', 'risk'],
  role_specific_benefits:['benefit', 'value', 'advantage', 'roi', 'impact', 'for you', 'helps you'],
  tradeoffs:             ['tradeoff', 'trade-off', 'risk', 'cost', 'versus', 'vs', 'when to', 'not to use', 'instead of'],
  industry_examples:     ['example', 'case', 'industry', 'use case', 'application', 'in your industry'],
  what_not_to_do:        ['avoid', 'not to', 'mistake', 'pitfall', "don't", 'caution', 'warning'],
}

const ALL_L2_DIMENSIONS: L2Dimension[] = [
  'how_it_works',
  'capabilities',
  'limitations',
  'role_specific_benefits',
  'tradeoffs',
  'industry_examples',
  'what_not_to_do',
]

/** Role keywords used for role-relevance scoring */
const ROLE_EXEC_TERMS = ['executive', 'leader', 'business', 'senior', 'director', 'vp', 'chief', 'officer']
const GENERIC_BUSINESS_TERMS = ['strategy', 'decision', 'governance', 'management', 'enterprise']

// ─── Internal shapes returned by Claude calls ────────────────────────────────

interface ArcClassification {
  session_title: string
  layer: LayerTag
  dependency: string | null
  bridge: string | null
  so_what: string
}

interface QualityClassification {
  session_title: string
  role_relevance: number
  industry_specificity: number
  narrative_cohesion: number
  dimension_coverage: number
  composite: number
}

// ─── Timeout helper ───────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Claude call timed out after ${ms}ms`)), ms)
    ),
  ])
}

// ─── Strip JSON code-fences ───────────────────────────────────────────────────

function extractJson(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
  }
  return trimmed
}

// ─── L2 Completeness Check (local, no Claude call) ───────────────────────────

/**
 * Checks each L2 session's subtopics against the 7 mandatory dimension keywords.
 * Returns a DimensionCoverageMap and a count of covered dimensions.
 */
function checkL2Completeness(subtopics: string[], soWhat: string): { map: DimensionCoverageMap; coveredCount: number } {
  const combined = [...subtopics, soWhat].join(' ').toLowerCase()

  const map = {} as DimensionCoverageMap
  let coveredCount = 0

  for (const dim of ALL_L2_DIMENSIONS) {
    const keywords = L2_DIMENSION_KEYWORDS[dim]
    const covered = keywords.some((kw) => combined.includes(kw))
    map[dim] = covered ? 'covered' : 'missing'
    if (covered) coveredCount++
  }

  return { map, coveredCount }
}

/**
 * Counts how many of the 7 L2 dimensions are covered across ALL L2 sessions combined.
 * Returns true if at least 5 dimensions are covered (the completeness threshold).
 */
function checkOverallL2Completeness(
  sessions: Array<{ subtopics: string[]; so_what: string; layer: LayerTag }>
): boolean {
  const l2Sessions = sessions.filter((s) => s.layer === 'L2_core')
  if (l2Sessions.length === 0) return true // no L2 — skip check

  const coveredDimensions = new Set<L2Dimension>()
  for (const session of l2Sessions) {
    const combined = [...session.subtopics, session.so_what].join(' ').toLowerCase()
    for (const dim of ALL_L2_DIMENSIONS) {
      if (L2_DIMENSION_KEYWORDS[dim].some((kw) => combined.includes(kw))) {
        coveredDimensions.add(dim)
      }
    }
  }
  return coveredDimensions.size >= 5
}

// ─── Quality Scoring (local, for fallback / re-score) ─────────────────────────

/**
 * Scores a single session locally when the Claude quality-scoring call is unavailable.
 * Uses keyword matching against role, industry, and layer tag.
 */
function scoreSessionLocally(
  session: {
    title: string
    subtopics: string[]
    layer: LayerTag
    arc_position: number
    arc_length: number
  },
  role: string,
  industry: string,
): QualityScore {
  const combined = [session.title, ...session.subtopics].join(' ').toLowerCase()
  const roleLower = role.toLowerCase()
  const industryLower = industry.toLowerCase()

  // Role relevance
  let role_relevance: number
  if (combined.includes(roleLower)) {
    role_relevance = 10
  } else if (ROLE_EXEC_TERMS.some((t) => combined.includes(t))) {
    role_relevance = 6
  } else if (GENERIC_BUSINESS_TERMS.some((t) => combined.includes(t))) {
    role_relevance = 4
  } else {
    role_relevance = 3
  }

  // Industry specificity
  let industry_specificity: number
  if (combined.includes(industryLower)) {
    industry_specificity = 10
  } else if (GENERIC_BUSINESS_TERMS.some((t) => combined.includes(t))) {
    industry_specificity = 5
  } else {
    industry_specificity = 2
  }

  // Narrative cohesion — proxy: position within arc
  const positionRatio = session.arc_position / Math.max(session.arc_length, 1)
  // Sessions in the middle of an arc are assumed more cohesive
  const narrative_cohesion = positionRatio <= 1 ? 8 : 6

  // Dimension coverage
  const dimension_coverage = session.layer === 'L2_core'
    ? (function () {
        const combined2 = [session.title, ...session.subtopics].join(' ').toLowerCase()
        const covered = ALL_L2_DIMENSIONS.filter((dim) =>
          L2_DIMENSION_KEYWORDS[dim].some((kw) => combined2.includes(kw))
        ).length
        return Math.round((covered / 7) * 10)
      })()
    : 8

  const composite = parseFloat(
    ((role_relevance + industry_specificity + narrative_cohesion + dimension_coverage) / 4).toFixed(2)
  )

  return { role_relevance, industry_specificity, narrative_cohesion, dimension_coverage, composite }
}

// ─── Call 1 — Topic Decomposition + Narrative Arc ────────────────────────────

async function callArcClassification(
  client: Anthropic,
  sessions: Array<{ session_id: string; title: string; subtopics: string[] }>,
  profile: { role: string; roleLevel: string; industry: string; maturity: string },
  extraInstruction?: string,
): Promise<ArcClassification[]> {
  const sessionList = sessions
    .map((s, i) => `${i + 1}. "${s.title}" — subtopics: ${s.subtopics.slice(0, 4).join('; ')}`)
    .join('\n')

  const systemPrompt = `You are a curriculum architect for executive AI learning.

Given a curriculum plan, classify each session into exactly one of:
- L1_foundation: prerequisite knowledge the user must understand first
- L2_core: the main topic with all key dimensions (how it works, capabilities, limitations, role benefits, tradeoffs, industry examples, what not to do)
- L3_strategic: strategic extensions, connections between topics, and role-specific applications

For each session return:
- session_title: exact title as given
- layer: one of L1_foundation | L2_core | L3_strategic
- dependency: title of the session this builds on (null if none)
- bridge: title of the session this enables next (null if none)
- so_what: a single sentence specific to the user's role and industry explaining the immediate relevance${extraInstruction ? `\n\nADDITIONAL INSTRUCTION: ${extraInstruction}` : ''}

Return ONLY a valid JSON array. No markdown, no explanation.`

  const userMessage = `User profile:
- Role: ${profile.role}
- Seniority: ${profile.roleLevel}
- Industry: ${profile.industry}
- AI maturity: ${profile.maturity}

Sessions to classify:
${sessionList}

Return JSON array of { session_title, layer, dependency, bridge, so_what } for every session.`

  const message = await withTimeout(
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    CALL_TIMEOUT_MS
  )

  const raw = message.content[0].type === 'text' ? message.content[0].text : '[]'
  const parsed = JSON.parse(extractJson(raw)) as unknown[]
  return parsed as ArcClassification[]
}

// ─── Call 2 — Quality Scoring ─────────────────────────────────────────────────

async function callQualityScoring(
  client: Anthropic,
  sessions: Array<{ title: string; layer: LayerTag; subtopics: string[]; so_what: string }>,
  profile: { role: string; industry: string },
): Promise<QualityClassification[]> {
  const sessionList = sessions
    .map(
      (s, i) =>
        `${i + 1}. [${s.layer}] "${s.title}" — subtopics: ${s.subtopics.slice(0, 4).join('; ')} | so_what: ${s.so_what}`
    )
    .join('\n')

  const systemPrompt = `You are a curriculum quality evaluator for executive AI education.

Score each session on 4 axes, each 0–10:
1. role_relevance: how specific and tailored to the user's exact role (10 = directly names or frames for the role; 6 = uses generic exec terms; 3 = no role connection)
2. industry_specificity: how specific to the user's industry (10 = explicitly addresses industry; 5 = general business; 2 = no industry connection)
3. narrative_cohesion: how well it connects to adjacent sessions in the sequence (10 = contiguous L1→L2→L3 with no gaps; 6 = one gap; 3 = multiple gaps or out of order)
4. dimension_coverage: for L2_core sessions — out of 7 mandatory dimensions (how it works, capabilities, limitations, role benefits, tradeoffs, industry examples, what not to do) — score = (covered/7)×10. For L1_foundation and L3_strategic, always score 8.
5. composite: average of all 4 axes rounded to 2 decimal places.

Return ONLY a valid JSON array. No markdown, no explanation.`

  const userMessage = `User profile:
- Role: ${profile.role}
- Industry: ${profile.industry}

Sessions to score:
${sessionList}

Return JSON array of { session_title, role_relevance, industry_specificity, narrative_cohesion, dimension_coverage, composite } for every session.`

  const message = await withTimeout(
    client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    CALL_TIMEOUT_MS
  )

  const raw = message.content[0].type === 'text' ? message.content[0].text : '[]'
  const parsed = JSON.parse(extractJson(raw)) as unknown[]
  return parsed as QualityClassification[]
}

// ─── Main enrichment function ─────────────────────────────────────────────────

export interface EnrichmentInput {
  role: string
  roleLevel: string
  industry: string
  maturity: string           // raw value — will be normalised internally
  arcs: Array<{
    arc_name: string
    arc_type: string
    sessions: Array<{
      session_id: string
      title: string
      focus: string
      arc_position: number
      arc_length: number
      depth_level: 'beginner' | 'intermediate' | 'advanced'
      role_hint: string
      subtopics: string[]
      is_visible: boolean
      queue_rationale: string | null
      estimated_minutes: number
    }>
  }>
}

/**
 * Runs the 2-Claude-call enrichment pipeline on an existing curriculum plan.
 *
 * Returns an EnrichedPlan (stored in raw_llm_output.enriched_plan) or null if
 * either call fails/times out. The caller must fall back to the unenriched plan.
 *
 * Side-effect free — does not write to the DB. The caller stores the result.
 */
export async function enrichCurriculumPlan(input: EnrichmentInput): Promise<EnrichedPlan | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) {
    console.warn('[enrichment] ANTHROPIC_API_KEY not set — skipping enrichment')
    return null
  }

  const normMaturity = normaliseMaturity(input.maturity)
  const shouldSkipL1 = normMaturity === 'advanced' || normMaturity === 'expert'

  // Flatten all sessions across all arcs for the API calls
  const allSessions = input.arcs.flatMap((arc) =>
    arc.sessions.map((s) => ({ ...s, arc_name: arc.arc_name, arc_type: arc.arc_type }))
  )

  if (allSessions.length === 0) {
    console.warn('[enrichment] No sessions to enrich — skipping')
    return null
  }

  const client = new Anthropic({ apiKey })

  // ── Call 1: Arc classification (with one retry if L2 completeness fails) ──

  let arcClassifications: ArcClassification[]
  let completenessPassedAfterRetry = true

  try {
    arcClassifications = await callArcClassification(
      client,
      allSessions.map((s) => ({ session_id: s.session_id, title: s.title, subtopics: s.subtopics })),
      { role: input.role, roleLevel: input.roleLevel, industry: input.industry, maturity: input.maturity }
    )
  } catch (err) {
    console.error('[enrichment] Call 1 (arc classification) failed — falling back to unenriched plan:', err)
    return null
  }

  // Build a title → classification map (case-insensitive fallback)
  const arcMap = new Map<string, ArcClassification>()
  for (const c of arcClassifications) {
    arcMap.set(c.session_title.toLowerCase().trim(), c)
  }

  // Check overall L2 completeness — retry Call 1 once if needed
  const sessionsForCompletenessCheck = allSessions.map((s) => {
    const match = arcMap.get(s.title.toLowerCase().trim())
    return {
      subtopics: s.subtopics,
      so_what: match?.so_what ?? '',
      layer: (match?.layer ?? 'L2_core') as LayerTag,
    }
  })

  if (!checkOverallL2Completeness(sessionsForCompletenessCheck)) {
    console.warn('[enrichment] L2 completeness check failed — retrying Call 1 with dimension instruction')
    try {
      const retryClassifications = await callArcClassification(
        client,
        allSessions.map((s) => ({ session_id: s.session_id, title: s.title, subtopics: s.subtopics })),
        { role: input.role, roleLevel: input.roleLevel, industry: input.industry, maturity: input.maturity },
        'The L2_core sessions MUST cover as many of these 7 mandatory dimensions as possible in their so_what sentences: how it works, capabilities, limitations, role-specific benefits, tradeoffs, industry examples, what not to do. Ensure at least 5 of 7 are represented across all L2 sessions.'
      )

      // Re-populate the map with retry results
      arcMap.clear()
      for (const c of retryClassifications) {
        arcMap.set(c.session_title.toLowerCase().trim(), c)
      }

      const retryCheck = allSessions.map((s) => {
        const match = arcMap.get(s.title.toLowerCase().trim())
        return {
          subtopics: s.subtopics,
          so_what: match?.so_what ?? '',
          layer: (match?.layer ?? 'L2_core') as LayerTag,
        }
      })

      if (!checkOverallL2Completeness(retryCheck)) {
        completenessPassedAfterRetry = false
        console.warn('[enrichment] L2 completeness check failed after retry — proceeding with completeness_warning: true')
      }
    } catch (retryErr) {
      completenessPassedAfterRetry = false
      console.error('[enrichment] Call 1 retry failed:', retryErr)
      // Continue with the original arcMap from the first call
    }
  }

  // ── Call 2: Quality scoring ────────────────────────────────────────────────

  let qualityScores: QualityClassification[] = []
  let qualityCallFailed = false

  try {
    const sessionsForScoring = allSessions.map((s) => {
      const match = arcMap.get(s.title.toLowerCase().trim())
      return {
        title: s.title,
        layer: (match?.layer ?? 'L2_core') as LayerTag,
        subtopics: s.subtopics,
        so_what: match?.so_what ?? '',
      }
    })

    qualityScores = await callQualityScoring(
      client,
      sessionsForScoring,
      { role: input.role, industry: input.industry }
    )
  } catch (err) {
    console.error('[enrichment] Call 2 (quality scoring) failed — will use local scoring:', err)
    qualityCallFailed = true
  }

  const qualityMap = new Map<string, QualityClassification>()
  for (const q of qualityScores) {
    qualityMap.set(q.session_title.toLowerCase().trim(), q)
  }

  // ── Assemble enriched sessions per arc ────────────────────────────────────

  // Build session_id → session_id dependency/bridge refs using title-based refs
  // We'll resolve dependency/bridge titles to session_ids after all sessions are classified
  const titleToSessionId = new Map<string, string>()
  for (const s of allSessions) {
    titleToSessionId.set(s.title.toLowerCase().trim(), s.session_id)
  }

  const enrichedArcs: EnrichedPlan['arcs'] = input.arcs.map((arc) => {
    const enrichedSessions: EnrichedSession[] = arc.sessions.map((s) => {
      const titleKey = s.title.toLowerCase().trim()
      const arcClass = arcMap.get(titleKey)
      const layer: LayerTag = arcClass?.layer ?? 'L2_core'
      const so_what = arcClass?.so_what ?? `Understanding ${s.title} directly impacts your effectiveness as a ${input.role} in ${input.industry}.`

      // Resolve dependency/bridge titles to session_ids
      const dependency_ref = arcClass?.dependency
        ? (titleToSessionId.get(arcClass.dependency.toLowerCase().trim()) ?? null)
        : null
      const bridge_ref = arcClass?.bridge
        ? (titleToSessionId.get(arcClass.bridge.toLowerCase().trim()) ?? null)
        : null

      // L1 skip logic
      const skip = layer === 'L1_foundation' && shouldSkipL1

      // Quality score
      let quality_score: QualityScore
      const qualityResult = qualityMap.get(titleKey)
      if (qualityResult && !qualityCallFailed) {
        // Clamp all axis values to 0–10
        const clamp = (v: number) => Math.min(10, Math.max(0, isNaN(v) ? 5 : v))
        const role_relevance = clamp(qualityResult.role_relevance)
        const industry_specificity = clamp(qualityResult.industry_specificity)
        const narrative_cohesion = clamp(qualityResult.narrative_cohesion)
        const dimension_coverage = clamp(qualityResult.dimension_coverage)
        quality_score = {
          role_relevance,
          industry_specificity,
          narrative_cohesion,
          dimension_coverage,
          composite: parseFloat(((role_relevance + industry_specificity + narrative_cohesion + dimension_coverage) / 4).toFixed(2)),
        }
      } else {
        // Local fallback scoring
        quality_score = scoreSessionLocally(
          { title: s.title, subtopics: s.subtopics, layer, arc_position: s.arc_position, arc_length: s.arc_length },
          input.role,
          input.industry
        )
      }

      // L2 dimension coverage map
      let dimension_coverage_map: DimensionCoverageMap | null = null
      if (layer === 'L2_core') {
        const { map } = checkL2Completeness(s.subtopics, so_what)
        dimension_coverage_map = map
      }

      // Completeness warning: only on L2 sessions when the overall check failed
      const completeness_warning = layer === 'L2_core' && !completenessPassedAfterRetry

      return {
        // Base fields
        session_id: s.session_id,
        title: s.title,
        focus: s.focus,
        arc_position: s.arc_position,
        arc_length: s.arc_length,
        depth_level: s.depth_level,
        role_hint: s.role_hint,
        subtopics: s.subtopics,
        is_visible: s.is_visible,
        queue_rationale: s.queue_rationale,
        estimated_minutes: s.estimated_minutes,
        arc_name: arc.arc_name,
        arc_type: arc.arc_type,
        // Enrichment fields
        layer,
        skip,
        quality_score,
        dimension_coverage: dimension_coverage_map,
        dependency_ref,
        bridge_ref,
        so_what,
        completeness_warning,
      }
    })

    return { arc_name: arc.arc_name, arc_type: arc.arc_type, sessions: enrichedSessions }
  })

  return { arcs: enrichedArcs }
}

/**
 * Applies enrichment skip/quality-threshold rules to determine which sessions
 * are visible vs. queued.
 *
 * L1 sessions with skip:true → moved to queue with queue_rationale explaining why.
 * Sessions with composite < 5.5 → moved to queue with quality rationale.
 * All other sessions retain their original is_visible value.
 *
 * Returns separate visible and queue session arrays for DB storage.
 */
export function applyEnrichmentVisibility(
  enrichedPlan: EnrichedPlan,
): {
  visible: EnrichedSession[]
  queued: EnrichedSession[]
} {
  const visible: EnrichedSession[] = []
  const queued: EnrichedSession[] = []

  for (const arc of enrichedPlan.arcs) {
    for (const session of arc.sessions) {
      // L1 skip: high-maturity user, skip L1 sessions
      if (session.layer === 'L1_foundation' && session.skip) {
        queued.push({
          ...session,
          is_visible: false,
          queue_rationale: session.queue_rationale ?? 'L1 foundation skipped — your maturity level means you start at core content.',
        })
        continue
      }

      // Quality threshold: composite < 5.5 → queue
      if (session.quality_score.composite < 5.5 && session.is_visible) {
        queued.push({
          ...session,
          is_visible: false,
          queue_rationale: `Quality score below threshold (composite: ${session.quality_score.composite}/10)`,
        })
        continue
      }

      if (session.is_visible) {
        visible.push(session)
      } else {
        queued.push(session)
      }
    }
  }

  return { visible, queued }
}
