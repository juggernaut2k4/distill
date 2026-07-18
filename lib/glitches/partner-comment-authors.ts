import { clerkClient } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-22 — resolves display info for `glitch_issue_partner_comments.author_partner_admin_user_id`
 * (Requirement Doc §4.A State P5 / §4.B State I4 — comment threads show "author's name/email").
 * `partner_admin_users` stores only `clerk_user_id`, no name/email of its own, so this looks the
 * author up via Clerk — the same `clerkClient().users.getUser()` pattern already used in
 * `lib/onboarding.ts`. Best-effort: a Clerk lookup failure never breaks the thread, it just falls
 * back to a generic label.
 */

export interface CommentAuthorInfo {
  name: string
  email: string | null
}

const FALLBACK_AUTHOR: CommentAuthorInfo = { name: 'Partner user', email: null }

/**
 * Resolves display info for a set of `partner_admin_users.id` values in one batch. Returns a map
 * keyed by `partner_admin_users.id` (not `clerk_user_id`) so callers can look authors up directly by
 * `author_partner_admin_user_id`.
 */
export async function resolveCommentAuthors(
  partnerAdminUserIds: Array<string | null>
): Promise<Map<string, CommentAuthorInfo>> {
  const uniqueIds = Array.from(new Set(partnerAdminUserIds.filter((id): id is string => Boolean(id))))
  const result = new Map<string, CommentAuthorInfo>()
  if (uniqueIds.length === 0) return result

  const supabase = createSupabaseAdminClient()
  const { data: rows } = await supabase
    .from('partner_admin_users')
    .select('id, clerk_user_id')
    .in('id', uniqueIds)

  const clerkUserIdByAdminId = new Map<string, string>()
  for (const row of (rows ?? []) as Array<{ id: string; clerk_user_id: string }>) {
    clerkUserIdByAdminId.set(row.id, row.clerk_user_id)
  }

  const client = clerkClient()
  await Promise.all(
    Array.from(clerkUserIdByAdminId.entries()).map(async ([adminId, clerkUserId]) => {
      try {
        const clerkUser = await client.users.getUser(clerkUserId)
        const primaryEmail =
          clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress ?? null
        const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim()
        result.set(adminId, { name: name || primaryEmail || FALLBACK_AUTHOR.name, email: primaryEmail })
      } catch (err) {
        console.error('[glitches/partner-comment-authors] Failed to resolve Clerk user (non-fatal):', err)
        result.set(adminId, FALLBACK_AUTHOR)
      }
    })
  )

  return result
}

export { FALLBACK_AUTHOR }
