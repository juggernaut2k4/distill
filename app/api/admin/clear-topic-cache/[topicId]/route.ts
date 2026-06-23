import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

// ─── Admin auth helper (matches delivery-health pattern) ─────────────────────

/**
 * Returns true if the request is from an authorised admin.
 * Priority:
 *  1. Header x-admin-secret matching ADMIN_SECRET env var (if set)
 *  2. Clerk userId matching ADMIN_CLERK_USER_ID env var (fallback)
 */
function isAdmin(request: NextRequest): boolean {
  const adminSecret = process.env.ADMIN_SECRET
  const adminClerkUserId = process.env.ADMIN_CLERK_USER_ID

  if (adminSecret) {
    const headerSecret = request.headers.get('x-admin-secret')
    return headerSecret === adminSecret
  }

  if (adminClerkUserId) {
    const { userId } = auth()
    return userId === adminClerkUserId
  }

  // No admin config set — deny all
  return false
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * DELETE /api/admin/clear-topic-cache/[topicId]
 *
 * Clears stale content cache entries for a topic from `topic_content_cache`.
 *
 * Query params:
 *   ?keepLatest=true  — keeps the most recent row per (subtopic_slug, industry, role)
 *                       combination and deletes the rest.
 *                       Omit (default) — deletes ALL rows for this topic_id.
 *
 * Auth: x-admin-secret header (preferred) OR Clerk userId matching ADMIN_CLERK_USER_ID.
 *
 * Response: { deleted: number, topicId: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { topicId: string } }
) {
  // 1. Admin guard
  if (!isAdmin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2. Validate topicId
  const topicId = params.topicId?.trim()
  if (!topicId) {
    return NextResponse.json({ error: 'topicId is required' }, { status: 400 })
  }

  // 3. Parse query param
  const keepLatest = request.nextUrl.searchParams.get('keepLatest') === 'true'

  const supabase = createSupabaseAdminClient()

  try {
    let deleted = 0

    if (keepLatest) {
      // Find the most recent row id per (subtopic_slug, industry, role) — keep those, delete the rest.
      // Step 1: Fetch all rows for this topic_id with the columns we need to group on.
      const { data: allRows, error: fetchError } = await supabase
        .from('topic_content_cache')
        .select('id, subtopic_slug, industry, role, created_at')
        .eq('topic_id', topicId)
        .order('created_at', { ascending: false })

      if (fetchError) {
        console.error('[clear-topic-cache] fetch error:', fetchError.message)
        return NextResponse.json(
          { error: `Failed to fetch cache rows: ${fetchError.message}` },
          { status: 500 }
        )
      }

      if (!allRows || allRows.length === 0) {
        return NextResponse.json({ deleted: 0, topicId })
      }

      // Step 2: Identify the latest id per combination — these are the keepers.
      const latestPerCombo = new Map<string, string>() // key → id
      for (const row of allRows) {
        const key = `${row.subtopic_slug}|${row.industry ?? ''}|${row.role ?? ''}`
        if (!latestPerCombo.has(key)) {
          // allRows is already sorted newest-first, so the first occurrence is the latest
          latestPerCombo.set(key, row.id as string)
        }
      }

      const keepIds = Array.from(latestPerCombo.values())
      const deleteIds = (allRows as Array<{ id: string }>)
        .map((r) => r.id)
        .filter((id) => !keepIds.includes(id))

      if (deleteIds.length === 0) {
        return NextResponse.json({ deleted: 0, topicId })
      }

      // Step 3: Delete only the stale rows.
      const { error: deleteError } = await supabase
        .from('topic_content_cache')
        .delete()
        .in('id', deleteIds)

      if (deleteError) {
        console.error('[clear-topic-cache] delete error (keepLatest):', deleteError.message)
        return NextResponse.json(
          { error: `Failed to delete cache rows: ${deleteError.message}` },
          { status: 500 }
        )
      }

      deleted = deleteIds.length
    } else {
      // Default: delete ALL rows for this topic_id.
      // Fetch count first so we can return an accurate deleted count —
      // Supabase JS client does not return affected row count from delete().
      const { count, error: countError } = await supabase
        .from('topic_content_cache')
        .select('*', { count: 'exact', head: true })
        .eq('topic_id', topicId)

      if (countError) {
        console.error('[clear-topic-cache] count error:', countError.message)
        return NextResponse.json(
          { error: `Failed to count cache rows: ${countError.message}` },
          { status: 500 }
        )
      }

      const { error: deleteError } = await supabase
        .from('topic_content_cache')
        .delete()
        .eq('topic_id', topicId)

      if (deleteError) {
        console.error('[clear-topic-cache] delete error:', deleteError.message)
        return NextResponse.json(
          { error: `Failed to delete cache rows: ${deleteError.message}` },
          { status: 500 }
        )
      }

      deleted = count ?? 0
    }

    return NextResponse.json({ deleted, topicId })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[clear-topic-cache] Unexpected error:', message)
    return NextResponse.json({ error: 'Internal server error', detail: message }, { status: 500 })
  }
}
