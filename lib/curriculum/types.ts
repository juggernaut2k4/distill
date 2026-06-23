export type ArcPosition = 'foundation' | 'interest' | 'context' | 'deploy' | 'govern'

// ─── Shared type for raw_llm_output stored in curriculum_plans ────────────────
// Use this type in both planner.ts (writer) and generate/route.ts (reader)
// so property names can never drift between the two files.
export type RawLlmOutput =
  | { fallback: true; reason: string }
  | Record<string, unknown>
export type Maturity = 'beginner' | 'intermediate' | 'advanced' | 'expert'

// ─── FB-007: 3-layer narrative enrichment types ───────────────────────────────

export type LayerTag = 'L1_foundation' | 'L2_core' | 'L3_strategic'

export type L2Dimension =
  | 'how_it_works'
  | 'capabilities'
  | 'limitations'
  | 'role_specific_benefits'
  | 'tradeoffs'
  | 'industry_examples'
  | 'what_not_to_do'

export interface DimensionCoverageMap {
  how_it_works: 'covered' | 'missing'
  capabilities: 'covered' | 'missing'
  limitations: 'covered' | 'missing'
  role_specific_benefits: 'covered' | 'missing'
  tradeoffs: 'covered' | 'missing'
  industry_examples: 'covered' | 'missing'
  what_not_to_do: 'covered' | 'missing'
}

export interface QualityScore {
  role_relevance: number         // 0–10
  industry_specificity: number   // 0–10
  narrative_cohesion: number     // 0–10
  dimension_coverage: number     // 0–10 (L2 only; 8 for L1/L3)
  composite: number              // average of all 4 axes
}

/**
 * A session object extended with 3-layer narrative enrichment metadata.
 * Stored in raw_llm_output.enriched_plan.arcs[*].sessions[*].
 * The base session fields are preserved unchanged so downstream consumers are unaffected.
 */
export interface EnrichedSession {
  // Base session fields (mirrored from SessionSchema — typed loosely here to avoid circular import)
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
  arc_name: string
  arc_type: string
  // Enrichment fields
  layer: LayerTag
  skip: boolean                          // true for L1 sessions skipped due to high maturity
  quality_score: QualityScore
  dimension_coverage: DimensionCoverageMap | null  // null for L1/L3
  dependency_ref: string | null          // session_id this session builds on
  bridge_ref: string | null              // session_id this session enables
  so_what: string                        // role+industry specific "so what" sentence
  completeness_warning: boolean          // true if L2 check found >2 missing dims after retry
  // CURR-01: Narrative curriculum fields
  scene_narrative: string              // max 25 words: what this session reveals, written as chapter teaser
  arc_throughline: string              // arc-level narrative, same value for all sessions in the same arc
  session_chapter_position: 'opening' | 'building' | 'pivot' | 'climax' | 'resolution'
}

export interface EnrichedArc {
  arc_name: string
  arc_type: string
  sessions: EnrichedSession[]
}

export interface EnrichedPlan {
  arcs: EnrichedArc[]
}

export interface UserProfile {
  role: string
  industry: string
  maturity: Maturity
  roleLevel: string  // 'c-suite' | 'vp-dir' | 'manager' | 'specialist'
  interest?: string // optional free text (last resort)
}

export interface CurriculumSpec {
  role: string
  industry: string
  maturity: Maturity
  interest: string
  roleLevel: string  // 'c-suite' | 'vp-dir' | 'manager' | 'specialist'
  isNamedProduct: boolean
  productName: string | null
  requiredFoundation: SpecItem[]
  requiredInterest: SpecItem[]
  requiredContext: SpecItem[]
  requiredDeploy: SpecItem[]
  requiredGovern: SpecItem[]
  totalTarget: number
}

export interface SpecItem {
  type: string
  reason: string
  product?: string
  industry?: string
  role?: string
}

export interface CurriculumSession {
  position: number
  title: string
  arc_position: ArcPosition
  justification: string
  estimated_minutes: number
}

export interface CurriculumResult {
  sessions: CurriculumSession[]
  tier4: Array<{ title: string; unlocks_after: number }>
  meta: {
    role: string
    industry: string
    maturity: string
    interest: string
    total_sessions: number
    total_minutes: number
  }
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}
