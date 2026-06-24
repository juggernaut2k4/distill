import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * POST /api/admin/clear-all-kb-content
 *
 * Nukes all generated KB content so the hourly session-content-cron re-generates
 * everything fresh on the next tick.
 *
 * Clears:
 *   - topic_content_cache   — all script + visualization + article rows
 *   - walkthrough_state     — all cached section state (stale after cache wipe)
 *   - sessions.content_status → reset to 'pending' so the cron re-queues them
 *
 * Query params:
 *   ?userId=<clerkId>  — limit to a single user (omit to clear ALL users)
 *
 * Response: { deleted_cache, deleted_walkthrough, reset_sessions, scoped_to_user }
 *
 * Auth: x-admin-secret header.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.ADMIN_SECRET
  const provided = request.headers.get('x-admin-secret')
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId') ?? null

  const supabase = createSupabaseAdminClient()

  // ── 1. Determine session IDs in scope (needed to scope topic_content_cache) ──
  let scopedSessionIds: string[] | null = null
  if (userId) {
    const { data: userSessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', userId)

    scopedSessionIds = (userSessions ?? []).map((s: { id: string }) => s.id)

    if (scopedSessionIds.length === 0) {
      return NextResponse.json({
        deleted_cache: 0, deleted_walkthrough: 0, reset_sessions: 0,
        scoped_to_user: userId, note: 'No sessions found for this user',
      })
    }
  }

  // ── 2. Delete topic_content_cache ────────────────────────────────────────────
  const cacheDeleteQuery = scopedSessionIds
    ? supabase.from('topic_content_cache').delete({ count: 'exact' }).in('topic_id', scopedSessionIds)
    : supabase.from('topic_content_cache').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000')

  const { error: cacheErr, count: deletedCache } = await cacheDeleteQuery

  if (cacheErr) {
    console.error('[clear-all-kb-content] cache delete failed:', cacheErr.message)
    return NextResponse.json({ error: 'Failed to clear cache', detail: cacheErr.message }, { status: 500 })
  }

  // ── 3. Delete walkthrough_state ──────────────────────────────────────────────
  const wsDeleteQuery = userId
    ? supabase.from('walkthrough_state').delete({ count: 'exact' }).eq('user_id', userId)
    : supabase.from('walkthrough_state').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000')

  const { error: wsErr, count: deletedWalkthrough } = await wsDeleteQuery

  if (wsErr) {
    // Non-fatal — cache already cleared, log and continue
    console.error('[clear-all-kb-content] walkthrough_state delete failed (non-fatal):', wsErr.message)
  }

  // ── 4. Reset content_status → 'pending' on active sessions ──────────────────
  const sessUpdateBase = supabase
    .from('sessions')
    .update({ content_status: 'pending' }, { count: 'exact' })
    .not('status', 'in', '("draft","completed","cancelled")')

  const sessUpdateQuery = userId
    ? sessUpdateBase.eq('user_id', userId)
    : sessUpdateBase

  const { error: sessErr, count: resetSessions } = await sessUpdateQuery

  if (sessErr) {
    console.error('[clear-all-kb-content] sessions reset failed (non-fatal):', sessErr.message)
  }

  console.log(
    `[clear-all-kb-content] Done — cache: ${deletedCache ?? 0} deleted, walkthrough: ${deletedWalkthrough ?? 0} deleted, sessions reset: ${resetSessions ?? 0}${userId ? ` (user: ${userId})` : ' (all users)'}`
  )

  return NextResponse.json({
    deleted_cache:       deletedCache ?? 0,
    deleted_walkthrough: deletedWalkthrough ?? 0,
    reset_sessions:      resetSessions ?? 0,
    scoped_to_user:      userId ?? 'all',
  })
}
