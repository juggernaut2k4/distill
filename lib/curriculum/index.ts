import { buildSpec } from './rules-engine'
import { generateCurriculum } from './specialist'
import { validate } from './validator'
import type { UserProfile, CurriculumResult } from './types'

export type { UserProfile, CurriculumResult, CurriculumSession, CurriculumSpec, ArcPosition, Maturity } from './types'

/**
 * Main entry point for the curriculum engine.
 *
 * Orchestrates the 4-layer pipeline:
 * 1. Rules engine (deterministic spec from profile)
 * 2. LLM specialist (generate curriculum from spec)
 * 3. Validator (assert correctness)
 * 4. Retry once on failure, then warn and return anyway
 */
export async function buildCurriculum(profile: UserProfile): Promise<CurriculumResult> {
  // Layer 1: Deterministic rules engine
  const spec = buildSpec(profile)

  // Layer 2: LLM specialist — first attempt
  let result = await generateCurriculum(spec)

  // Layer 3: Validate
  const validation = validate({ ...result, meta: buildMeta(profile, result) }, spec)

  if (!validation.valid) {
    // Layer 4: Retry once, passing validation errors as additional context
    result = await generateCurriculum(spec, validation.errors)
    const v2 = validate({ ...result, meta: buildMeta(profile, result) }, spec)
    if (!v2.valid) {
      // Return anyway with warnings logged — never block the user
      console.warn('[curriculum] Validation warnings after retry:', v2.errors)
    }
  }

  return {
    ...result,
    meta: buildMeta(profile, result),
  }
}

function buildMeta(
  profile: UserProfile,
  result: Pick<CurriculumResult, 'sessions'>
): CurriculumResult['meta'] {
  return {
    role: profile.role,
    industry: profile.industry,
    maturity: profile.maturity,
    interest: profile.interest ?? '',
    total_sessions: result.sessions.length,
    total_minutes: result.sessions.reduce((s, r) => s + r.estimated_minutes, 0),
  }
}
