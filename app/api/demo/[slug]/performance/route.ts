import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getDemoTopicBySlug } from '@/app/(demo)/demo/_content'
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

// B2B-57a — the demo session's own `usage.voice_minute` webhook_dispatch_log row, surfaced back on
// the Performance tab. `minutes_billed` is pre-formatted server-side ("4.2 minutes", quantity rounded
// to 1 decimal like duration_minutes already is) since PerfScalarCell renders a single opaque value
// per the CEO brief's "use PerfScalarCell for all five" instruction. `mode` is derived from the
// payload's `test_mode` boolean (the brief's own text says "live_mode/test_mode" but only test_mode
// actually exists on WebhookPayload — confirmed by direct read of lib/partner/webhooks.ts — so this is
// test_mode-only, flagged to the orchestrator as a minor brief inaccuracy, not a product decision).
interface PerformanceUsage {
  minutes_billed: string | null
  generation_type: string | null
  mode: 'Live' | 'Test'
  event_id: string
  recorded_at: string
}

interface PerformanceResponse {
  session_state: SessionState
  duration_minutes: number | null
  action_items: { text: string }[] | null
  learner_insight: LearnerInsight | null
  usage: PerformanceUsage | null
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
    usage: null,
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
      usage: null,
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
      usage: null,
    } satisfies PerformanceResponse)
  }

  if (insightsRow.extraction_status === 'failed') {
    return NextResponse.json({
      session_state: 'extraction_failed',
      duration_minutes: durationMinutes,
      action_items: null,
      learner_insight: null,
      usage: null,
    } satisfies PerformanceResponse)
  }

  // B2B-57a — this demo session's own `usage.voice_minute` webhook_dispatch_log row, keyed by
  // clio_session_ref = partner_sessions.id (same resolution as every other partner-session join in
  // this codebase). Most-recent row wins if more than one somehow exists for this session. Only
  // fetched in the 'ready' branch since that's the only place the Field/Value table (and these rows)
  // render — matches the brief's "no new fetch/endpoint pattern for one field group" constraint by
  // extending this existing route rather than adding a second query path.
  const { data: usageRow } = await supabase
    .from('webhook_dispatch_log')
    .select('payload, created_at')
    .eq('clio_session_ref', sessionRow.id as string)
    .eq('event_type', 'usage.voice_minute')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let usage: PerformanceUsage | null = null
  if (usageRow?.payload) {
    const payload = usageRow.payload as {
      quantity: number | null
      unit: string | null
      generation_type: string | null
      event_id: string
      occurred_at: string
      test_mode: boolean
    }
    usage = {
      minutes_billed:
        payload.quantity !== null && payload.quantity !== undefined
          ? `${Math.round(payload.quantity * 10) / 10} ${payload.unit ?? 'minutes'}`
          : null,
      generation_type: payload.generation_type ?? null,
      mode: payload.test_mode ? 'Test' : 'Live',
      event_id: payload.event_id,
      recorded_at: payload.occurred_at,
    }
  }

  // extraction_status is 'success' or 'success_empty' here.
  return NextResponse.json({
    session_state: 'ready',
    duration_minutes: durationMinutes,
    action_items: (insightsRow.action_items as { text: string }[] | null) ?? [],
    learner_insight: (insightsRow.learner_insight as LearnerInsight | null) ?? null,
    usage,
  } satisfies PerformanceResponse)
}
