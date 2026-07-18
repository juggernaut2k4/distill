import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { type Subtopic } from '@/lib/curriculum/session-designer'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'

/**
 * POST /api/admin/backfill-sub-sessions
 *
 * One-time repair: finds all sessions where sub_sessions is NULL or empty,
 * looks up the matching entry in curriculum_plans.visible_sessions by db_session_id,
 * and writes the subtopics (string[]) as SubtopicObject[] into sessions.sub_sessions.
 *
 * Query params:
 *   ?userId=<clerkId>  — limit repair to a single user (optional)
 *
 * Response: { repaired: number; skipped: number; orphaned: string[]; errors: string[] }
 *
 * Protected by `requireSuperAdmin()` OR x-admin-secret header (B2B-21
 * Requirement Doc §7 — this was previously any authenticated Clerk session,
 * an internal/cross-partner defect; the x-admin-secret path is unchanged).
 * Idempotent: rows already populated are counted in `skipped` and not overwritten.
 */

// ── Types for visible_sessions JSONB entries ──────────────────────────────────

interface VisibleSessionEntry {
  session_id?:        string
  db_session_id?:     string
  subtopics?:         string[]
  title?:             string
  focus?:             string
  depth_level?:       string
  estimated_minutes?: number
  [key: string]: unknown
}

// ── Mapping: string[] → SubtopicObject[] ──────────────────────────────────────

/**
 * Maps plain subtopic strings from curriculum_plans.visible_sessions[n].subtopics
 * into the canonical SubtopicObject[] format that generate-plan expects.
 * Spec §6 mapping rule.
 */
function mapStringsToSubtopics(
  subtopics: string[],
  estimatedMinutes: number,
): Subtopic[] {
  return subtopics.map((title) => ({
    title,
    type:               'concept' as const,
    duration_mins:      Math.max(2, Math.floor(estimatedMinutes / subtopics.length)),
    learning_objective: title,  // proxy — richer data not available from this source
  }))
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Admin auth: requireSuperAdmin() OR x-admin-secret header
  const secret        = process.env.ADMIN_SECRET
  const providedSecret = request.headers.get('x-admin-secret')
  const secretOk      = Boolean(secret) && providedSecret === secret

  if (!secretOk) {
    const admin = await requireSuperAdmin()
    if (admin.error) return admin.error
  }

  // Optional: limit to a single user for targeted repair
  const { searchParams } = new URL(request.url)
  const targetUserId = searchParams.get('userId') ?? null

  const supabase = createSupabaseAdminClient()

  // ── Step 1: Load all sessions with empty/null sub_sessions ───────────────

  let sessionsQuery = supabase
    .from('sessions')
    .select('id, user_id, curriculum_plan_id, sub_sessions')
    .or('sub_sessions.is.null,sub_sessions.eq.[]')

  if (targetUserId) {
    sessionsQuery = sessionsQuery.eq('user_id', targetUserId)
  }

  const { data: emptySessions, error: sessionsError } = await sessionsQuery

  if (sessionsError) {
    console.error('[backfill-sub-sessions] Failed to load sessions:', sessionsError)
    return NextResponse.json({ error: 'Failed to load sessions', detail: sessionsError.message }, { status: 500 })
  }

  if (!emptySessions || emptySessions.length === 0) {
    return NextResponse.json({ repaired: 0, skipped: 0, orphaned: [], errors: [] })
  }

  // ── Step 2: Load all relevant curriculum plans ────────────────────────────

  // Collect the unique plan IDs we actually need
  const planIds = Array.from(new Set(
    emptySessions
      .map((s) => s.curriculum_plan_id as string | null)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  ))

  let plansQuery = supabase
    .from('curriculum_plans')
    .select('id, user_id, visible_sessions')
    .in('id', planIds)

  if (targetUserId) {
    plansQuery = plansQuery.eq('user_id', targetUserId)
  }

  const { data: plans, error: plansError } = await plansQuery

  if (plansError) {
    console.error('[backfill-sub-sessions] Failed to load curriculum plans:', plansError)
    return NextResponse.json({ error: 'Failed to load curriculum plans', detail: plansError.message }, { status: 500 })
  }

  // Build a lookup: sessions.id → VisibleSessionEntry (joined via db_session_id)
  const sessionIdToEntry = new Map<string, { entry: VisibleSessionEntry; estimatedMinutes: number }>()

  for (const plan of plans ?? []) {
    let visibleSessions: unknown

    // visible_sessions may come back as a parsed array or as a raw JSON string
    // depending on the Supabase client version — handle both defensively.
    if (typeof plan.visible_sessions === 'string') {
      try {
        visibleSessions = JSON.parse(plan.visible_sessions as string)
      } catch {
        console.error('[backfill-sub-sessions] Malformed visible_sessions JSON for plan:', plan.id)
        continue
      }
    } else {
      visibleSessions = plan.visible_sessions
    }

    if (!Array.isArray(visibleSessions)) continue

    for (const raw of visibleSessions) {
      const entry = raw as VisibleSessionEntry
      if (typeof entry.db_session_id !== 'string' || !entry.db_session_id) continue

      sessionIdToEntry.set(entry.db_session_id, {
        entry,
        estimatedMinutes: typeof entry.estimated_minutes === 'number' ? entry.estimated_minutes : 15,
      })
    }
  }

  // ── Step 3: Repair each session ───────────────────────────────────────────

  let repaired  = 0
  let skipped   = 0
  const orphaned: string[] = []
  const errors:   string[] = []

  for (const session of emptySessions) {
    const sessionId = session.id as string

    // AC-05: skip rows that already have data (handles race/double-call)
    // The query used .or('sub_sessions.is.null,sub_sessions.eq.[]') so any row
    // returned here is already empty. But check defensively.
    const existing = session.sub_sessions
    if (Array.isArray(existing) && (existing as unknown[]).length > 0) {
      skipped++
      continue
    }

    // AC-06: no matching curriculum plan entry → orphaned
    const match = sessionIdToEntry.get(sessionId)
    if (!match) {
      console.log('[backfill-sub-sessions] No matching visible_session entry for session:', sessionId)
      orphaned.push(sessionId)
      continue
    }

    const { entry, estimatedMinutes } = match

    // Edge case: subtopics array is empty in the curriculum plan (spec §9)
    if (!Array.isArray(entry.subtopics) || entry.subtopics.length === 0) {
      console.log('[backfill-sub-sessions] Empty subtopics in curriculum plan for session:', sessionId)
      orphaned.push(sessionId)
      continue
    }

    // Map string[] → SubtopicObject[]
    const subTopicObjects: Subtopic[] = mapStringsToSubtopics(
      entry.subtopics,
      estimatedMinutes,
    )

    // Write to sessions.sub_sessions
    const { error: updateError } = await supabase
      .from('sessions')
      .update({ sub_sessions: subTopicObjects })
      .eq('id', sessionId)

    if (updateError) {
      console.error('[backfill-sub-sessions] Failed to update session:', sessionId, updateError)
      errors.push(sessionId)
      continue
    }

    repaired++
  }

  console.log(
    `[backfill-sub-sessions] Done — repaired: ${repaired}, skipped: ${skipped}, orphaned: ${orphaned.length}, errors: ${errors.length}`,
  )

  return NextResponse.json({ repaired, skipped, orphaned, errors })
}
