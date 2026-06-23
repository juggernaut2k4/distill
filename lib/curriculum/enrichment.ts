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
  // CURR-01: Narrative fields
  scene_narrative?: string
  arc_throughline?: string
  session_chapter_position?: 'opening' | 'building' | 'pivot' | 'climax' | 'resolution'
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
- so_what: a single sentence specific to the user's role and industry explaining the immediate relevance
- scene_narrative: one sentence (MAX 25 words) describing what this session reveals to the learner — written as a chapter teaser, not a topic summary. Example: "You discover why Constitutional AI matters more than any policy document your compliance team will write."
- arc_throughline: a 1-2 sentence arc-level narrative answering "what story does this arc tell?" — the SAME string for ALL sessions in the same arc. Answers: what transformation does this arc give the learner?
- session_chapter_position: this session's role in the arc narrative — one of: opening | building | pivot | climax | resolution. Assign based on the session's position and content within its arc.${extraInstruction ? `\n\nADDITIONAL INSTRUCTION: ${extraInstruction}` : ''}

Return ONLY a valid JSON array. No markdown, no explanation.`

  const userMessage = `User profile:
- Role: ${profile.role}
- Seniority: ${profile.roleLevel}
- Industry: ${profile.industry}
- AI maturity: ${profile.maturity}

Sessions to classify:
${sessionList}

Return JSON array of { session_title, layer, dependency, bridge, so_what, scene_narrative, arc_throughline, session_chapter_position } for every session.`

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

      // CURR-01: Narrative fields — use LLM values with fallbacks
      let scene_narrative: string
      let arc_throughline: string
      let session_chapter_position: 'opening' | 'building' | 'pivot' | 'climax' | 'resolution'

      if (arcClass?.scene_narrative) {
        scene_narrative = arcClass.scene_narrative
      } else {
        console.warn(`[enrichment][WARN] narrative fields missing for session "${s.title}" — using fallback`)
        scene_narrative = `${s.title} — a key part of your learning journey.`
      }

      if (arcClass?.arc_throughline) {
        arc_throughline = arcClass.arc_throughline
      } else {
        arc_throughline = `This arc builds your understanding of ${arc.arc_name}.`
      }

      if (arcClass?.session_chapter_position) {
        session_chapter_position = arcClass.session_chapter_position
      } else {
        // Derive from arc position
        if (s.arc_position === 1) {
          session_chapter_position = 'opening'
        } else if (s.arc_position === s.arc_length) {
          session_chapter_position = 'resolution'
        } else {
          session_chapter_position = 'building'
        }
      }

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
        // CURR-01: Narrative fields
        scene_narrative,
        arc_throughline,
        session_chapter_position,
      }
    })

    return { arc_name: arc.arc_name, arc_type: arc.arc_type, sessions: enrichedSessions }
  })

  return { arcs: enrichedArcs }
}

// ─── CURR-01: 7-Dimension Coverage Check ─────────────────────────────────────

type CurriculumDimensionId =
  | 'strategic'
  | 'operational'
  | 'technical'
  | 'compliance'
  | 'competitive'
  | 'team_management'
  | 'personal_productivity'

export interface DimensionCoverageResult {
  checked_at: string
  visible_session_count: number
  dimensions: Record<CurriculumDimensionId, { covered: boolean; match_count: number }>
  covered_count: number
  missing_dimensions: string[]
  gap_fill_triggered: boolean
  gap_fill_sessions_added: number
}

const CURRICULUM_DIMENSION_KEYWORDS: Record<CurriculumDimensionId, string[]> = {
  strategic:            ['strategy', 'vision', 'roadmap', 'board', 'competitive', 'market position', 'investment', 'priority'],
  operational:          ['workflow', 'process', 'implement', 'deploy', 'rollout', 'team adoption', 'day-to-day', 'operationalise'],
  technical:            ['model', 'api', 'architecture', 'infrastructure', 'integration', 'security', 'token', 'data pipeline'],
  compliance:           ['compliance', 'regulatory', 'governance', 'risk', 'audit', 'legal', 'policy', 'gdpr', 'soc2', 'hipaa'],
  competitive:          ['competitor', 'landscape', 'benchmark', 'vendor', 'alternative', 'openai', 'google', 'microsoft', 'market'],
  team_management:      ['team', 'hire', 'upskill', 'enablement', 'culture', 'change management', 'train', 'staff', 'adoption'],
  personal_productivity:['personal', 'my workflow', 'time', 'productivity', 'own use', 'daily', 'habit', 'prompt', 'assistant'],
}

const ALL_CURRICULUM_DIMENSIONS: CurriculumDimensionId[] = [
  'strategic', 'operational', 'technical', 'compliance',
  'competitive', 'team_management', 'personal_productivity',
]

/**
 * Checks keyword presence (case-insensitive) for each of 7 learning dimensions
 * across all visible sessions. A dimension is "covered" for a session if it has
 * ≥2 keyword matches. A dimension is "covered" overall if at least one session covers it.
 * Returns DimensionCoverageResult (no Claude call — purely local).
 * If < 5 dimensions are covered AND an API key is available, calls runGapFill.
 */
export async function checkDimensionCoverage(
  visibleSessions: EnrichedSession[],
  userProfile: { role: string; roleLevel: string; industry: string; maturity: string },
): Promise<DimensionCoverageResult> {
  const dimensions = {} as Record<CurriculumDimensionId, { covered: boolean; match_count: number }>

  for (const dimId of ALL_CURRICULUM_DIMENSIONS) {
    const keywords = CURRICULUM_DIMENSION_KEYWORDS[dimId]
    let totalMatches = 0
    let coveredByAnySession = false

    for (const session of visibleSessions) {
      const combined = [
        session.title,
        ...session.subtopics,
        session.so_what,
      ].join(' ').toLowerCase()

      let sessionMatchCount = 0
      for (const kw of keywords) {
        if (combined.includes(kw.toLowerCase())) sessionMatchCount++
      }
      totalMatches += sessionMatchCount
      if (sessionMatchCount >= 2) coveredByAnySession = true
    }

    dimensions[dimId] = { covered: coveredByAnySession, match_count: totalMatches }
  }

  const missingDimensions = ALL_CURRICULUM_DIMENSIONS.filter((d) => !dimensions[d].covered)
  const coveredCount = ALL_CURRICULUM_DIMENSIONS.length - missingDimensions.length

  const result: DimensionCoverageResult = {
    checked_at: new Date().toISOString(),
    visible_session_count: visibleSessions.length,
    dimensions,
    covered_count: coveredCount,
    missing_dimensions: missingDimensions,
    gap_fill_triggered: false,
    gap_fill_sessions_added: 0,
  }

  // Gap-fill: only if < 5 dimensions covered and API key is available
  if (coveredCount < 5 && visibleSessions.length > 0) {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
    if (apiKey && !apiKey.startsWith('PLACEHOLDER_')) {
      try {
        const gapSessions = await runGapFill(visibleSessions, missingDimensions, userProfile, apiKey)
        result.gap_fill_triggered = true
        result.gap_fill_sessions_added = gapSessions.length

        // Merge gap-fill sessions into visibleSessions in-place so the caller
        // (curriculum-generator step) can see them on the returned array.
        for (const gs of gapSessions) {
          visibleSessions.push(gs)
        }
      } catch (err) {
        console.error('[curriculum-generator][ERROR] gap-fill call failed — plan saved without gap-fill sessions:', err)
        result.gap_fill_triggered = true
        result.gap_fill_sessions_added = 0
      }
    }
  }

  return result
}

/**
 * Makes a single Claude call to generate gap-fill sessions for missing dimensions.
 * Each returned session is validated with SessionSchema before insertion.
 * Sessions that fail validation are silently dropped.
 */
async function runGapFill(
  visibleSessions: EnrichedSession[],
  missingDimensions: string[],
  userProfile: { role: string; roleLevel: string; industry: string; maturity: string },
  apiKey: string,
): Promise<EnrichedSession[]> {
  const { SessionSchema } = await import('./planner')

  const sessionSummary = visibleSessions.map((s) =>
    `- "${s.title}": ${s.subtopics.slice(0, 3).join('; ')}`
  ).join('\n')

  const systemPrompt = `You are an expert curriculum designer for executive AI learning.
A curriculum plan has been generated but is missing coverage of key learning dimensions.
Generate the minimum number of sessions needed to cover the missing dimensions — one session per dimension that cannot be covered by extending existing sessions.

Return a JSON array of session objects. Each session must exactly match this schema:
{
  "session_id": string (unique, use format "gap-[dimension]-s1"),
  "title": string,
  "focus": string (min 10 chars),
  "arc_position": number,
  "arc_length": number,
  "depth_level": "beginner" | "intermediate" | "advanced",
  "role_hint": string (min 5 chars),
  "subtopics": string[] (3–8 items, each min 3 chars),
  "is_visible": true,
  "queue_rationale": string (describe gap-fill purpose, e.g. "gap-fill: compliance")
}

Return ONLY a valid JSON array. No markdown, no explanation.`

  const userMessage = `User profile:
- Role: ${userProfile.role}
- Seniority: ${userProfile.roleLevel}
- Industry: ${userProfile.industry}
- AI maturity: ${userProfile.maturity}

Current visible sessions:
${sessionSummary}

Missing dimensions (generate a session for each): ${missingDimensions.join(', ')}

For each missing dimension, create one session that:
- Covers at least 2 keywords from that dimension's keyword set
- Is framed for the user's specific role and industry
- Has queue_rationale starting with "gap-fill: [dimension_id]"
- Sets is_visible: true`

  const client = new Anthropic({ apiKey })
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

  // Get the last arc from visible sessions to anchor gap-fill sessions
  const lastSession = visibleSessions[visibleSessions.length - 1]
  const anchorArcName = lastSession?.arc_name ?? 'supplementary'
  const anchorArcType = lastSession?.arc_type ?? 'singleton'

  const validSessions: EnrichedSession[] = []
  for (const raw_session of parsed) {
    const validationResult = SessionSchema.safeParse(raw_session)
    if (!validationResult.success) {
      console.warn('[enrichment][WARN] gap-fill session failed Zod validation — dropping:', validationResult.error.flatten())
      continue
    }

    const s = validationResult.data
    // Build a minimal EnrichedSession for the gap-fill session
    const gapSession: EnrichedSession = {
      session_id: s.session_id,
      title: s.title,
      focus: s.focus,
      arc_position: s.arc_position,
      arc_length: s.arc_length,
      depth_level: s.depth_level,
      role_hint: s.role_hint,
      subtopics: s.subtopics,
      is_visible: true,
      queue_rationale: s.queue_rationale,
      estimated_minutes: Math.ceil(s.subtopics.length / 4) * 15,
      arc_name: anchorArcName,
      arc_type: anchorArcType,
      layer: 'L2_core',
      skip: false,
      quality_score: { role_relevance: 7, industry_specificity: 7, narrative_cohesion: 7, dimension_coverage: 7, composite: 7 },
      dimension_coverage: null,
      dependency_ref: null,
      bridge_ref: null,
      so_what: `This session ensures your curriculum covers ${s.queue_rationale?.replace('gap-fill: ', '') ?? 'an important dimension'}.`,
      completeness_warning: false,
      scene_narrative: `${s.title} — a key part of your learning journey.`,
      arc_throughline: `This arc builds your understanding of ${anchorArcName}.`,
      session_chapter_position: 'building',
    }
    validSessions.push(gapSession)
  }

  return validSessions
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
