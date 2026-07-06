import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'

interface Params {
  params: { id: string }
}

/**
 * POST /api/sessions/[id]/retake
 * Creates a brand-new draft session on the same topic as an already-completed
 * session, without ever reading-and-writing the original row (SELECT only).
 *
 * See docs/specs/RETAKE-01-requirement-document.md for the full approved spec.
 *
 * Steps:
 *   1. Fetch the original session — must belong to the caller and be 'completed'.
 *   2. If the original has a curriculum_plan_id, require that plan to be approved
 *      (same check as /api/sessions/[id]/start).
 *   3. Require users.minutes_balance > 0.
 *   4. Compute the next session_index (max + 1, scoped to this user).
 *   5. Insert a new 'draft' session copying topic/duration fields from the original,
 *      with retaken_from_session_id pointing back to it.
 *   6. Self-reference topic_id to the new row's own id (matches
 *      session-designer-auto.ts's SESS-01 pattern).
 *   7. Fire distill/session.content.generate so content generates fresh.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  try {
    // ── 1. Fetch original session (read-only — never updated) ────────────────
    const { data: original } = await supabase
      .from('sessions')
      .select(
        'id, status, session_title, topics, sub_sessions, curriculum_plan_id, curriculum_session_id, duration_mins, planned_duration_mins'
      )
      .eq('id', params.id)
      .eq('user_id', userId!)
      .single()

    if (!original) {
      return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    }

    if (original.status !== 'completed') {
      return NextResponse.json(
        { error: "This session hasn't been completed yet." },
        { status: 409 }
      )
    }

    // ── 2. Curriculum plan approval check (same as /api/sessions/[id]/start) ──
    if (original.curriculum_plan_id) {
      const { data: plan } = await supabase
        .from('curriculum_plans')
        .select('is_approved')
        .eq('id', original.curriculum_plan_id)
        .maybeSingle()

      if (!plan?.is_approved) {
        return NextResponse.json(
          { error: 'Your learning plan needs to be approved first.', code: 'PLAN_NOT_APPROVED' },
          { status: 403 }
        )
      }
    }

    // ── 3. Minutes balance check ───────────────────────────────────────────────
    const { data: user } = await supabase
      .from('users')
      .select('minutes_balance')
      .eq('id', userId!)
      .single()

    const minutesBalance = user?.minutes_balance ?? 0
    if (minutesBalance <= 0) {
      return NextResponse.json(
        {
          error: "You're out of session minutes. Add more to continue.",
          code: 'NO_MINUTES',
        },
        { status: 403 }
      )
    }

    // ── 4. Compute next session_index (max + 1, scoped to this user) ─────────
    const { data: existingSessions } = await supabase
      .from('sessions')
      .select('session_index')
      .eq('user_id', userId!)
      .order('session_index', { ascending: false })
      .limit(1)

    const nextSessionIndex = existingSessions?.[0]?.session_index
      ? (existingSessions[0].session_index as number) + 1
      : 1

    // ── 5. Insert new draft session, copying fields from the original ────────
    const { data: inserted, error: insertError } = await supabase
      .from('sessions')
      .insert({
        user_id: userId!,
        status: 'draft',
        session_index: nextSessionIndex,
        session_title: `Retake — ${original.session_title}`,
        topics: original.topics,
        sub_sessions: original.sub_sessions,
        curriculum_plan_id: original.curriculum_plan_id,
        curriculum_session_id: original.curriculum_session_id,
        duration_mins: original.duration_mins,
        planned_duration_mins: original.planned_duration_mins,
        deferred_questions: [],
        retaken_from_session_id: original.id,
        meeting_url: null,
        session_plan: null,
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('[sessions/retake] Failed to insert new session:', insertError?.message)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }

    const newSessionId = inserted.id as string

    // ── 6. Self-reference topic_id (SESS-01 pattern from session-designer-auto.ts) ──
    await supabase.from('sessions').update({ topic_id: newSessionId }).eq('id', newSessionId)

    // ── 7. Fire content generation event ──────────────────────────────────────
    await inngest.send({
      name: 'distill/session.content.generate',
      data: { sessionId: newSessionId, userId: userId! },
    }).catch((err) => console.error('[sessions/retake] Failed to emit distill/session.content.generate:', err))

    return NextResponse.json({ newSessionId }, { status: 201 })
  } catch (err) {
    console.error('[sessions/retake] Unexpected error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
