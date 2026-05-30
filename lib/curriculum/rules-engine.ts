import type { UserProfile, CurriculumSpec, SpecItem } from './types'

/**
 * Named AI products/tools for detection in free-text interest field.
 */
const NAMED_PRODUCTS = [
  'claude',
  'chatgpt',
  'gpt',
  'copilot',
  'gemini',
  'mistral',
  'llama',
  'midjourney',
  'stable diffusion',
  'salesforce',
  'hubspot',
  'notion',
  'slack',
] as const

/**
 * Industry-mandatory topics that must appear in the curriculum for regulated/specific industries.
 */
const INDUSTRY_MANDATORY: Record<string, SpecItem[]> = {
  'financial-services': [
    {
      type: 'ai-security-privacy-model-risk',
      industry: 'financial-services',
      reason: 'FCA/SEC/GDPR mandatory for any AI deployment in FS',
    },
    {
      type: 'ai-governance-roi-board',
      industry: 'financial-services',
      reason: 'Board accountability and FCA oversight requirements for FS executives',
    },
  ],
  healthcare: [
    {
      type: 'ai-healthcare-compliance',
      industry: 'healthcare',
      reason: 'HIPAA, FDA AI regulations mandatory for healthcare AI deployment',
    },
    {
      type: 'patient-privacy-ai',
      industry: 'healthcare',
      reason: 'Patient data protection is non-negotiable in healthcare AI',
    },
  ],
  retail: [
    {
      type: 'ai-customer-experience',
      industry: 'retail',
      reason: 'CX personalisation is the primary AI use case in retail',
    },
    {
      type: 'ai-supply-chain',
      industry: 'retail',
      reason: 'Supply chain optimisation is the second primary AI use case in retail',
    },
  ],
}

/**
 * Roles that trigger the data strategy guard.
 */
const DATA_STRATEGY_ROLES = ['ceo', 'cto', 'cdo', 'cio', 'cfo']

/**
 * Detects if the interest text references a named AI product/tool.
 * Returns the matched product name (capitalized) or null.
 */
function detectNamedProduct(interest: string): { isNamed: boolean; productName: string | null } {
  const lower = interest.toLowerCase()
  for (const product of NAMED_PRODUCTS) {
    if (lower.includes(product)) {
      const capitalized = product.charAt(0).toUpperCase() + product.slice(1)
      return { isNamed: true, productName: capitalized }
    }
  }
  return { isNamed: false, productName: null }
}

/**
 * Deterministic rules engine that converts a UserProfile into a CurriculumSpec.
 * No LLM calls — pure logic.
 */
export function buildSpec(profile: UserProfile): CurriculumSpec {
  const interest = profile.interest ?? ''
  const { isNamed, productName } = detectNamedProduct(interest)

  const requiredFoundation: SpecItem[] = []
  const requiredInterest: SpecItem[] = []
  const requiredContext: SpecItem[] = []
  const requiredDeploy: SpecItem[] = []
  const requiredGovern: SpecItem[] = []

  // ── Check 1: Foundation (always inject) ──────────────────────────────────
  requiredFoundation.push({
    type: 'generative-ai-fundamentals',
    reason: 'Prerequisite — foundational understanding of how AI works',
  })
  requiredFoundation.push({
    type: 'how-llms-work',
    reason: 'LLMs are the core technology behind the interest area',
  })
  if (profile.maturity === 'beginner') {
    requiredFoundation.push({
      type: 'ai-strategy-for-executives',
      reason: 'Beginner executives need strategic framing before technical depth',
    })
  }

  // ── Check 2: Interest Depth (Interest Expansion Rule) ────────────────────
  if (isNamed && productName) {
    requiredInterest.push({
      type: 'product-capabilities-overview',
      product: productName,
      reason: 'Core understanding of what the user asked about',
    })
    requiredInterest.push({
      type: 'product-industry-use-cases',
      product: productName,
      industry: profile.industry,
      reason: 'How the product applies in their specific industry',
    })
    // product-deployment-options goes to requiredDeploy per arc assignment rules
    requiredDeploy.push({
      type: 'product-deployment-options',
      product: productName,
      role: profile.role,
      reason: 'How to actually deploy/use the product at executive level',
    })
  } else {
    // General interest area — add 3 generic interest items
    const normalizedInterest = interest || 'AI'
    requiredInterest.push({
      type: 'interest-overview',
      reason: `Core understanding of ${normalizedInterest} for executives`,
    })
    requiredInterest.push({
      type: 'interest-industry-applications',
      industry: profile.industry,
      reason: `How ${normalizedInterest} applies in ${profile.industry}`,
    })
    requiredInterest.push({
      type: 'interest-executive-decisions',
      role: profile.role,
      reason: `Decision frameworks for ${profile.role} implementing ${normalizedInterest}`,
    })
  }

  // ── Check 3: Industry Mandatory ──────────────────────────────────────────
  const industryItems = INDUSTRY_MANDATORY[profile.industry] ?? []
  requiredGovern.push(...industryItems)

  // ── Check 4: Breadth Guard ───────────────────────────────────────────────
  if (isNamed && productName) {
    requiredContext.push({
      type: 'vendor-comparison',
      product: productName,
      reason: 'A named-product interest needs one comparative topic for informed decision-making',
    })
  }

  // Always add one industry landscape topic
  requiredContext.push({
    type: 'ai-in-industry',
    industry: profile.industry,
    reason: 'Broader AI landscape in their industry beyond the specific interest',
  })

  // ── Check 5: Data Strategy Guard ─────────────────────────────────────────
  const roleLower = profile.role.toLowerCase()
  const isDataStrategyRole = DATA_STRATEGY_ROLES.some((r) => roleLower.includes(r))
  const isIntermediateOrAbove =
    profile.maturity === 'intermediate' ||
    profile.maturity === 'advanced' ||
    profile.maturity === 'expert'

  if (isDataStrategyRole || isIntermediateOrAbove) {
    requiredContext.push({
      type: 'data-strategy-infrastructure',
      reason:
        'Data readiness is the most common reason AI deployments fail — non-negotiable for this role',
    })
  }

  // ── Total target (clamp to 10 if over) ───────────────────────────────────
  const rawTotal =
    requiredFoundation.length +
    requiredInterest.length +
    requiredContext.length +
    requiredDeploy.length +
    requiredGovern.length

  const totalTarget = Math.min(rawTotal, 10)

  return {
    role: profile.role,
    industry: profile.industry,
    maturity: profile.maturity,
    interest,
    isNamedProduct: isNamed,
    productName,
    requiredFoundation,
    requiredInterest,
    requiredContext,
    requiredDeploy,
    requiredGovern,
    totalTarget,
  }
}
