import type { CurriculumResult, CurriculumSpec, ValidationResult, ArcPosition } from './types'

const ARC_ORDER: ArcPosition[] = ['foundation', 'interest', 'context', 'deploy', 'govern']

/**
 * Validates a CurriculumResult against the generating CurriculumSpec.
 * Returns a ValidationResult with a list of any errors found.
 */
export function validate(result: CurriculumResult, spec: CurriculumSpec): ValidationResult {
  const errors: string[] = []

  // 1. Session count within 8-12 range
  if (result.sessions.length < 8 || result.sessions.length > 12) {
    errors.push(
      `Session count ${result.sessions.length} outside 8-12 range`
    )
  }

  // 2. Foundation minimum of 2
  const foundationCount = result.sessions.filter(
    (s) => s.arc_position === 'foundation'
  ).length
  if (foundationCount < 2) {
    errors.push(
      `Only ${foundationCount} foundation sessions — minimum 2 required`
    )
  }

  // 3. Named product coverage (must appear in at least 3 session titles)
  if (spec.isNamedProduct && spec.productName) {
    const productLower = spec.productName.toLowerCase()
    const productSessions = result.sessions.filter((s) =>
      s.title.toLowerCase().includes(productLower)
    ).length
    if (productSessions < 3) {
      errors.push(
        `Named product "${spec.productName}" appears in only ${productSessions} sessions — minimum 3 required`
      )
    }
  }

  // 4. Govern sessions required when industry mandatory topics exist
  const governCount = result.sessions.filter(
    (s) => s.arc_position === 'govern'
  ).length
  if (spec.requiredGovern.length > 0 && governCount === 0) {
    errors.push(
      `No govern sessions present but industry mandatory topics were required`
    )
  }

  // 5. Arc sequence must be non-decreasing (foundation → interest → context → deploy → govern)
  let maxSeenIdx = 0
  for (const session of result.sessions) {
    const idx = ARC_ORDER.indexOf(session.arc_position)
    if (idx < maxSeenIdx - 1) {
      errors.push(
        `Arc sequence violation at position ${session.position}: ${session.arc_position} appears after ${ARC_ORDER[maxSeenIdx]}`
      )
      break
    }
    maxSeenIdx = Math.max(maxSeenIdx, idx)
  }

  // 6. All sessions must have adequate justifications (≥20 chars)
  const missingJustification = result.sessions.filter(
    (s) => !s.justification || s.justification.length < 20
  )
  if (missingJustification.length > 0) {
    errors.push(
      `${missingJustification.length} sessions missing adequate justification`
    )
  }

  // 7. Total minutes must be within reasonable range (150-400)
  const totalMinutes = result.sessions.reduce(
    (sum, s) => sum + s.estimated_minutes,
    0
  )
  if (totalMinutes < 150 || totalMinutes > 400) {
    errors.push(
      `Total minutes ${totalMinutes} outside reasonable range 150-400`
    )
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
