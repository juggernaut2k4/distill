// Content taxonomy constants for Distill
// These define the allowed tag values for content matching and user profiling

export const ROLES = [
  'CEO / MD / President',
  'VP / SVP / EVP',
  'CU Lead / Practice Head',
  'BU Lead / Functional Head',
  'Product Sponsor / Owner',
  'Director / Senior Manager',
  'Other',
] as const

export const INDUSTRIES = [
  'Technology / SaaS',
  'Financial Services / Banking',
  'Healthcare / Life Sciences',
  'Retail / E-commerce',
  'Manufacturing / Supply Chain',
  'Consulting / Professional Services',
  'Other',
] as const

export const MATURITY_LEVELS = [
  'observer',
  'evaluator',
  'pilot',
  'scaler',
] as const

export const WORRY_TYPES = [
  'job_relevance',
  'roi_clarity',
  'vendor_evaluation',
  'team_upskilling',
  'competitive_pressure',
] as const

export const CONTENT_TYPES = [
  'tip',
  'signal',
  'decoder',
  'lens',
  'framework',
] as const

export type Role = typeof ROLES[number]
export type Industry = typeof INDUSTRIES[number]
export type Maturity = typeof MATURITY_LEVELS[number]
export type Worry = typeof WORRY_TYPES[number]
export type ContentType = typeof CONTENT_TYPES[number]

export interface UserProfile {
  id: string
  role: string
  industry: string
  ai_maturity: string
  worry_tags: string[]
}

export interface ContentItem {
  id: string
  type: ContentType
  body_text: string
  role_tags: string[]
  industry_tags: string[]
  maturity_tags: string[]
  worry_tags: string[]
  created_at: string
}

export interface DeliveryLogEntry {
  content_item_id: string
  sent_at: string
  content_type?: ContentType
}

/**
 * Scores and ranks content items by relevance to a user's profile.
 * Scoring: exact tag match = 3pts per tag, no tags on item (wildcard) = 1pt.
 * @param userProfile - The user's onboarding profile
 * @param contentItems - Array of available content items
 * @returns Content items sorted by match score (highest first)
 */
export function matchContentToUser(
  userProfile: UserProfile,
  contentItems: ContentItem[]
): ContentItem[] {
  const scored = contentItems.map((item) => {
    let score = 0

    // Role match
    if (item.role_tags.length === 0) {
      score += 1 // wildcard
    } else if (item.role_tags.includes(userProfile.role)) {
      score += 3 // exact match
    }

    // Industry match
    if (item.industry_tags.length === 0) {
      score += 1
    } else if (item.industry_tags.includes(userProfile.industry)) {
      score += 3
    }

    // Maturity match
    if (item.maturity_tags.length === 0) {
      score += 1
    } else if (item.maturity_tags.includes(userProfile.ai_maturity)) {
      score += 3
    }

    // Worry tag match (user may have multiple worry tags)
    if (item.worry_tags.length === 0) {
      score += 1
    } else {
      const matchedWorries = item.worry_tags.filter((tag) =>
        userProfile.worry_tags.includes(tag)
      )
      score += matchedWorries.length * 3
    }

    return { item, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
}

/**
 * Determines the next content type to deliver, rotating through all types
 * to ensure variety. Avoids repeating the same type used in last delivery.
 * @param recentDeliveries - Recent delivery log entries (most recent first)
 * @returns The content type to use for the next delivery
 */
export function getNextContentType(
  recentDeliveries: DeliveryLogEntry[]
): ContentType {
  if (recentDeliveries.length === 0) {
    return 'tip' // Start with a tip
  }

  // Count recent usage of each type in last 5 deliveries
  const recent = recentDeliveries.slice(0, 5)
  const usageCounts: Record<string, number> = {}

  for (const type of CONTENT_TYPES) {
    usageCounts[type] = 0
  }

  for (const entry of recent) {
    if (entry.content_type && usageCounts[entry.content_type] !== undefined) {
      usageCounts[entry.content_type]++
    }
  }

  // Pick the least recently used type
  const leastUsed = CONTENT_TYPES.reduce((min, type) =>
    usageCounts[type] < usageCounts[min] ? type : min
  )

  return leastUsed
}
