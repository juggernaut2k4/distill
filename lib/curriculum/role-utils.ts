/**
 * Shared role inference utilities used by both the topics recommendations endpoint
 * and the curriculum generator route.
 *
 * Extracting these here eliminates the inline duplicate in
 * app/api/curriculum/generate/route.ts and ensures both paths use identical logic.
 */

/**
 * The three recommendation tiers used by the topics page and recommendations API.
 */
export type RoleTier = 'executive' | 'technical' | 'manager'

/**
 * Infers a structured roleLevel from a free-text role string.
 *
 * Returns one of: 'c-suite' | 'vp-dir' | 'vp-technology' | 'vp-product' | 'manager' | 'specialist'
 *
 * Default is 'manager' — the safest neutral tier for ambiguous or missing role strings.
 */
export function inferRoleLevel(role: string): string {
  const r = role.toLowerCase().trim()
  if (/engineer|developer|analyst|scientist|designer|specialist|architect|researcher|consultant/.test(r)) return 'specialist'
  if (/manager|team.lead|lead/.test(r)) return 'manager'
  if (/vp |vice.president/.test(r)) return 'vp-dir'
  if (/director/.test(r)) return 'vp-dir'
  if (/ceo|cto|cfo|coo|cmo|chief/.test(r)) return 'c-suite'
  return 'manager'
}

/**
 * Maps a roleLevel to one of three recommendation tiers.
 * Used by both the topics page (client-side fallback selection)
 * and the recommendations API (system prompt selection).
 *
 * vp-technology and vp-product are folded into the executive tier at the
 * recommendations stage. The curriculum planner provides the deeper
 * differentiation those roles need at content-generation time.
 */
export function getRoleTier(roleLevel: string): RoleTier {
  switch (roleLevel) {
    case 'c-suite':
    case 'vp-dir':
    case 'vp-technology':
    case 'vp-product':
      return 'executive'
    case 'specialist':
      return 'technical'
    case 'manager':
    default:
      return 'manager'
  }
}
