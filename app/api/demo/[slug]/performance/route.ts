import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getDemoTopicBySlug } from '@/app/demo/_content'
import { fetchHumeChatDuration } from '@/lib/voice/hume-native/session-details'

/**
 * GET /api/demo/[slug]/performance
 *
 * B2B-34 Piece 1 (docs/specs/B2B-34-requirement-document.md Part C §6.2). Public, no auth, no
 * passcode — read-only, matches GET /api/demo/[slug]/meeting's existing posture. Resolves the
 * "currently-dispatched meeting" for this demo slug (the most recent partner_sessions row dispatched
 * under the DEMO_PARTNER_ACCOUNT_ID account, correlated via partner_reference = slug — the same
 * convention B2B-33's dispatch route already sets, no new column) and returns its post-meeting
 * performance data: a Hume-verified duration, action items, and a learner insight.
 *
 * Always 200 — there is no error state at the HTTP layer for this read-only, no-input route (an
 * unknown slug 404s exactly like every other /api/demo/[slug]/* route).
 *
 * Status-enum note: the spec's §6.2 SQL prose says `status IN ('requested', 'active')` for
 * 'in_progress' and `status = 'failed'` for 'not_dispatched'. The actual partner_sessions CHECK
 * constraint (migration 071) is `status IN ('requested', 'bot_dispatch_failed', 'bot_active',
 * 'completed', 'failed')` — there is no 'active' value; the live/dispatched state is 'bot_active', and
 * a dispatch that never succeeded also surfaces as 'bot_dispatch_failed' (lib/partner/session-init.ts),
 * not just 'failed'. This route maps against the REAL enum values (verified live against project
 * nqxlpcshouboplhnuvrh) while preserving the exact same semantic tiers the spec describes — a purely
 * technical mapping fix, not a product/UX reinterpretation. Flagged to the orchestrator.
 */

type SessionState = 'not_dispatched' | 'in_progress' | 'pending_extraction' | 'extraction_failed' | 'ready'

interface LearnerInsight {
  summary: string
  topics_of_interest: string[]
  engagement_style: string
  suggested_next_topics: string[]
}

interface PerformanceResponse {
  session_state: SessionState
  duration_minutes: number | null
  action_items: { text: string }[] | null
  learner_insight: LearnerInsight | null
}

export async function GET(_request: NextRequest, { params }: { params: { slug: string } }) {
  if (!getDemoTopicBySlug(params.slug)) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Unknown demo topic.' } }, { status: 404 })
  }

  const supabase = createSupabaseAdminClient()
  const demoPartnerAccountId = process.env.DEMO_PARTNER_ACCOUNT_ID

  const empty: PerformanceResponse = {
    session_state: 'not_dispatched',
    duration_minutes: null,
    action_items: null,
    learner_insight: null,
  }

  // DEMO_PARTNER_ACCOUNT_ID is a one-time infra value the Orchestrator sets (§6.1), not code this Part
  // writes. If it's unset/placeholder, there's no way to resolve any session — fail closed to
  // 'not_dispatched' rather than throwing, matching this route's "no error state at the HTTP layer"
  // contract.
  if (!demoPartnerAccountId || demoPartnerAccountId.startsWith('PLACEHOLDER')) {
    return NextResponse.json(empty)
  }

  const { data: sessionRow } = await supabase
    .from('partner_sessions')
    .select('id, status, hume_chat_id, created_at')
    .eq('partner_account_id', demoPartnerAccountId)
    .eq('partner_reference', params.slug)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // duration_minutes resolution is independent of session_state (§6.2) — computed whenever
  // hume_chat_id is non-null, regardless of which branch below is taken.
  let durationMinutes: number | null = null
  if (sessionRow?.hume_chat_id) {
    const durationResult = await fetchHumeChatDuration(sessionRow.hume_chat_id as string)
    if (durationResult.ok) {
      durationMinutes = Math.round((durationResult.durationSeconds / 60) * 10) / 10
    }
    // durationResult.ok === false (any reason, including "still in progress") → durationMinutes stays
    // null, never surfaced as an error — always renders as "Not available" on the client.
  }

  if (!sessionRow || sessionRow.status === 'failed' || sessionRow.status === 'bot_dispatch_failed') {
    return NextResponse.json({ ...empty, duration_minutes: durationMinutes })
  }

  if (sessionRow.status === 'requested' || sessionRow.status === 'bot_active') {
    return NextResponse.json({
      session_state: 'in_progress',
      duration_minutes: durationMinutes,
      action_items: null,
      learner_insight: null,
    } satisfies PerformanceResponse)
  }

  // sessionRow.status === 'completed' from here on.
  const { data: insightsRow } = await supabase
    .from('partner_session_insights')
    .select('extraction_status, action_items, learner_insight')
    .eq('partner_session_id', sessionRow.id as string)
    .maybeSingle()

  if (!insightsRow || insightsRow.extraction_status === 'pending') {
    return NextResponse.json({
      session_state: 'pending_extraction',
      duration_minutes: durationMinutes,
      action_items: null,
      learner_insight: null,
    } satisfies PerformanceResponse)
  }

  if (insightsRow.extraction_status === 'failed') {
    return NextResponse.json({
      session_state: 'extraction_failed',
      duration_minutes: durationMinutes,
      action_items: null,
      learner_insight: null,
    } satisfies PerformanceResponse)
  }

  // extraction_status is 'success' or 'success_empty' here.
  return NextResponse.json({
    session_state: 'ready',
    duration_minutes: durationMinutes,
    action_items: (insightsRow.action_items as { text: string }[] | null) ?? [],
    learner_insight: (insightsRow.learner_insight as LearnerInsight | null) ?? null,
  } satisfies PerformanceResponse)
}
