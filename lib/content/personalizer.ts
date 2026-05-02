import { createSupabaseAdminClient } from '../supabase'
import { matchContentToUser, getNextContentType } from './taxonomy'
import { generateContent } from './generator'
import type { ContentItem, UserProfile, DeliveryLogEntry, ContentType } from './taxonomy'
import type { PersonalizedContent } from './generator'

export interface ContentPlan {
  emailContent: string
  smsContent: string
  contentItemId: string
  contentType: ContentType
  wordCount: number
}

/**
 * Full personalization pipeline for a single user.
 * Fetches profile, delivery history, feedback weights, selects and generates content.
 * @param userId - The user's Clerk user ID
 * @returns Personalized email + SMS content with content item ID
 */
export async function getUserContentPlan(userId: string): Promise<ContentPlan> {
  const supabase = createSupabaseAdminClient()

  // Step 1: Fetch user profile
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, role, industry, ai_maturity, worry_tags')
    .eq('id', userId)
    .single()

  if (userError || !user) {
    throw new Error(`User not found: ${userId}`)
  }

  const userProfile: UserProfile = {
    id: user.id,
    role: user.role ?? '',
    industry: user.industry ?? '',
    ai_maturity: user.ai_maturity ?? 'observer',
    worry_tags: user.worry_tags ?? [],
  }

  // Step 2: Fetch last 30 delivery log entries
  const { data: deliveryLog } = await supabase
    .from('delivery_log')
    .select('content_item_id, sent_at, content_items(type)')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(30)

  const recentDeliveries: DeliveryLogEntry[] = (deliveryLog ?? []).map((entry: {
    content_item_id: string
    sent_at: string
    content_items?: { type: string }[] | { type: string } | null
  }) => {
    const ci = Array.isArray(entry.content_items) ? entry.content_items[0] : entry.content_items
    return {
      content_item_id: entry.content_item_id,
      sent_at: entry.sent_at,
      content_type: (ci?.type as ContentType) ?? undefined,
    }
  })

  // Step 3: Fetch feedback weights for this user
  const { data: feedbackWeights } = await supabase
    .from('feedback_weights')
    .select('tag, weight')
    .eq('user_id', userId)

  const weightMap: Record<string, number> = {}
  for (const fw of feedbackWeights ?? []) {
    weightMap[fw.tag] = fw.weight
  }

  // Step 4: Fetch all available content items
  const { data: allContent } = await supabase
    .from('content_items')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  const contentItems: ContentItem[] = (allContent ?? []).map((item: {
    id: string
    type: string
    body_text: string
    role_tags: string[] | null
    industry_tags: string[] | null
    maturity_tags: string[] | null
    worry_tags: string[] | null
    created_at: string
  }) => ({
    id: item.id,
    type: item.type as ContentType,
    body_text: item.body_text,
    role_tags: item.role_tags ?? [],
    industry_tags: item.industry_tags ?? [],
    maturity_tags: item.maturity_tags ?? [],
    worry_tags: item.worry_tags ?? [],
    created_at: item.created_at,
  }))

  // Step 5: Filter out items sent in the last 14 days
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const recentlyDeliveredIds = new Set(
    recentDeliveries
      .filter((d) => new Date(d.sent_at) > fourteenDaysAgo)
      .map((d) => d.content_item_id)
  )

  const candidates = contentItems.filter(
    (item) => !recentlyDeliveredIds.has(item.id)
  )

  if (candidates.length === 0) {
    // Fallback: use all items if everything has been sent recently
    candidates.push(...contentItems)
  }

  // Step 6: Rank candidates by user relevance
  const ranked = matchContentToUser(userProfile, candidates)

  // Step 7: Determine the next content type for variety
  const nextContentType = getNextContentType(recentDeliveries)

  // Prefer items matching the desired content type, but fall back to top-ranked
  const preferredItem =
    ranked.find((item) => item.type === nextContentType) ?? ranked[0]

  if (!preferredItem) {
    throw new Error('No content available for user')
  }

  // Step 8: Generate personalized content using Claude API
  const generated: PersonalizedContent = await generateContent(
    preferredItem,
    userProfile,
    nextContentType
  )

  return {
    emailContent: generated.emailBody,
    smsContent: generated.smsBody,
    contentItemId: preferredItem.id,
    contentType: nextContentType,
    wordCount: generated.wordCount,
  }
}
