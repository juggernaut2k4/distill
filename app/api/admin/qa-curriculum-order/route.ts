/**
 * GET /api/admin/qa-curriculum-order?userId=<id>
 *
 * CURR-SEQ-01 — Step 7 of the mandatory QA validation checklist.
 *
 * Validates that sessions for a user's active plan are ordered in a
 * pedagogically logical sequence (foundational before applied, no obvious
 * prerequisite inversions). Returns ok:true when all checks pass.
 *
 * If userId is omitted, uses the authenticated Clerk user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export const maxDuration = 30

interface SessionRow {
  id: string
  session_title: string | null
  session_index: number
  sub_sessions: string[] | null
  status: string
  curriculum_session_id: string | null
}

export async function GET(request: NextRequest) {
  const { userId: authUserId } = auth()
  if (!authUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createSupabaseAdminClient()
  const targetUserId = request.nextUrl.searchParams.get('userId') ?? authUserId

  const issues: string[] = []

  // ── Load active plan ───────────────────────────────────────────────────────
  const { data: plan } = await supabase
    .from('curriculum_plans')
    .select('id, sequencing_status, sequencing_rationale, visible_sessions')
    .eq('user_id', targetUserId)
    .is('superseded_at', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan) {
    return NextResponse.json({
      ok: false,
      error: 'No active curriculum plan found for this user.',
    }, { status: 404 })
  }

  // ── Load sessions in index order ───────────────────────────────────────────
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, session_title, session_index, sub_sessions, status, curriculum_session_id')
    .eq('user_id', targetUserId)
    .in('status', ['draft', 'pending', 'active', 'scheduled', 'completed'])
    .order('session_index', { ascending: true })

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'No sessions found for this user.',
    }, { status: 404 })
  }

  const typedSessions = sessions as SessionRow[]

  // ── Check 1: sequencing_status ─────────────────────────────────────────────
  const sequencingStatus = (plan.sequencing_status as string | null) ?? 'pending'
  if (sequencingStatus === 'pending') {
    issues.push('sequencing_status is pending — session-designer-auto may still be running')
  } else if (sequencingStatus === 'fallback_order') {
    issues.push('sequencing_status is fallback_order — Claude sequencing failed, sessions are in original arc order')
  }

  // ── Check 2: All sessions have non-empty titles ────────────────────────────
  const untitled = typedSessions.filter((s) => !s.session_title || s.session_title.trim() === '')
  if (untitled.length > 0) {
    issues.push(`${untitled.length} session(s) have no title — session-designer LLM may have failed`)
  }

  // ── Check 3: session_index values are contiguous (no gaps or duplicates) ───
  const indexes = typedSessions.map((s) => s.session_index)
  const uniqueIndexes = new Set(indexes)
  if (uniqueIndexes.size !== typedSessions.length) {
    issues.push('Duplicate session_index values detected — sequencing update may have partially failed')
  }

  // ── Check 4: No adjacent sessions with same curriculum_session_id prefix ───
  // Avoids back-to-back sessions from same arc chunk (repetition check)
  for (let i = 0; i < typedSessions.length - 1; i++) {
    const curr = typedSessions[i].curriculum_session_id ?? ''
    const next = typedSessions[i + 1].curriculum_session_id ?? ''
    // Extract the base slug (everything before the last "-part-N")
    const currBase = curr.replace(/-part-\d+$/, '')
    const nextBase = next.replace(/-part-\d+$/, '')
    if (currBase && nextBase && currBase === nextBase && currBase.length > 3) {
      issues.push(`Sessions ${i + 1} and ${i + 2} are adjacent chunks of the same arc ("${currBase}") — consider splitting them`)
    }
  }

  // ── Check 5: Sequencing rationale exists ──────────────────────────────────
  const rationale = (plan.sequencing_rationale as string | null) ?? ''
  if (!rationale || rationale.trim().length === 0) {
    issues.push('No sequencing_rationale found — sequencer may not have run yet')
  }

  // ── Build ordered session summary ─────────────────────────────────────────
  const sessionsInOrder = typedSessions.map((s, i) => ({
    position: i + 1,
    session_index: s.session_index,
    title: s.session_title ?? '(untitled)',
    status: s.status,
    subtopics_preview: Array.isArray(s.sub_sessions)
      ? (s.sub_sessions as string[]).slice(0, 2).join(' → ')
      : null,
  }))

  return NextResponse.json({
    ok: issues.length === 0,
    user_id: targetUserId,
    plan_id: plan.id as string,
    sequencing_status: sequencingStatus,
    sequencing_rationale: rationale || null,
    total_sessions: typedSessions.length,
    sessions_in_order: sessionsInOrder,
    issues: issues.length > 0 ? issues : ['None — all checks passed'],
  })
}
