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

// B2B-65 (docs/specs/B2B-65-requirement-document.md §6.4) — one accumulated, permanently-visible
// past demo session's outcome. Deliberately excludes Duration/Usage (see the spec's §6.4
// reasoning: both are live/derived lookups today, not stored values — re-deriving them per
// historical entry on every public page load adds cost for fields never described as needing to
// accumulate).
// B2B-65 tabular-format amendment (docs/specs/B2B-65-tabular-performance-format-amendment-
// requirement-document.md §6.2) — widened from 6 to all 18 real partner_session_insights columns
// (learner_insight's 4 sub-fields kept flattened, as before) per Arun's explicit "display
// everything in this table" instruction — a knowing, time-boxed exception, see the requirement
// document's §9 for the tracked removal commitment.
interface PerformanceEntry {
  id: string
  partner_session_id: string
  partner_account_id: string
  end_client_id: string | null
  reseller_unique_id: string | null
  hume_chat_id: string | null
  hume_config_id: string | null
  extraction_status: 'pending' | 'success' | 'success_empty' | 'failed'
  attempt_count: number
  error_message: string | null
  transcript_event_count: number | null
  full_detail_purged_at: string | null
  created_at: string
  demo_performance_visible: boolean
  glitches: { type: string; description: string | null }[]
  extracted_at: string | null
  action_items: { text: string }[]
  summary: string | null
  topics_of_interest: string[]
  engagement_style: string | null
  suggested_next_topics: string[]
}

interface PerformanceResponse {
  session_state: SessionState
  duration_minutes: number | null
  action_items: { text: string }[] | null
  learner_insight: LearnerInsight | null
  usage: PerformanceUsage | null
  entries: PerformanceEntry[]
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
    entries: [],
  }

  // DEMO_PARTNER_ACCOUNT_ID is a one-time infra value the Orchestrator sets (§6.1), not code this Part
  // writes. If it's unset/placeholder, there's no way to resolve any session — fail closed to
  // 'not_dispatched' rather than throwing, matching this route's "no error state at the HTTP layer"
  // contract.
  if (!demoPartnerAccountId || demoPartnerAccountId.startsWith('PLACEHOLDER')) {
    return NextResponse.json(empty)
  }

  // 2026-08-02 — ROOT CAUSE FOUND (confirmed live via a CEO-agent-recommended diagnostic that
  // logged PostgREST's own full ordered result set): `.limit(1).maybeSingle()` was intermittently
  // returning a stale/wrong row on this Supabase project, even though direct SQL and PostgREST's
  // own un-collapsed result set (`.limit(N)` with no `.maybeSingle()`) were always correct. Every
  // query on this route that used `.maybeSingle()` (optionally combined with `.limit(1)`) has been
  // rewritten below to fetch a plain array instead and take `[0]` — confirmed live to resolve
  // correctly where `.maybeSingle()` did not. This is a `@supabase/supabase-js`/PostgREST-client
  // reliability issue, not a data or RLS problem (both independently verified correct beforehand).

  // B2B-65 (docs/specs/B2B-65-requirement-document.md §6.4) — independent of the latest-single-
  // session lookup below: renders regardless of that session's own state, so a previously-
  // successful entry never disappears just because the most recent dispatch failed or is still
  // mid-flight. Scoped by the same partner_reference column the query below already uses (B2B-33
  // convention) — per-topic, never combined across demo slugs. Falls back to [] on any query
  // failure (§8) rather than breaking the rest of this route's response.
  //
  // Rewritten as two plain queries instead of one query with a `partner_sessions!inner(...)`
  // embedded-resource dot-path filter — the embedded-filter form was also returning zero rows for
  // sessions confirmed (via direct SQL) to match, alongside the `.maybeSingle()` issue above. A
  // plain `.in('partner_session_id', ids)` avoids the embedded-join filter path entirely.
  let entries: PerformanceEntry[] = []
  const { data: matchingSessions, error: matchingSessionsError } = await supabase
    .from('partner_sessions')
    .select('id')
    .eq('partner_account_id', demoPartnerAccountId)
    .eq('partner_reference', params.slug)

  if (matchingSessionsError) {
    console.error(`[demo/performance] Failed to resolve sessions for slug ${params.slug}:`, matchingSessionsError.message)
  } else if (matchingSessions && matchingSessions.length > 0) {
    const { data: entryRows, error: entriesError } = await supabase
      .from('partner_session_insights')
      .select(
        'id, partner_session_id, partner_account_id, end_client_id, reseller_unique_id, hume_chat_id, hume_config_id, extraction_status, attempt_count, error_message, transcript_event_count, full_detail_purged_at, created_at, demo_performance_visible, glitches, extracted_at, action_items, learner_insight'
      )
      .eq('demo_performance_visible', true)
      .in('partner_session_id', matchingSessions.map((s) => s.id as string))
      .order('extracted_at', { ascending: false })
      .limit(200)

    if (entriesError) {
      console.error(`[demo/performance] Failed to load accumulating entries for slug ${params.slug}:`, entriesError.message)
    } else if (entryRows) {
      entries = entryRows.map((row) => {
        const insight = row.learner_insight as LearnerInsight | null
        return {
          id: row.id as string,
          partner_session_id: row.partner_session_id as string,
          partner_account_id: row.partner_account_id as string,
          end_client_id: (row.end_client_id as string | null) ?? null,
          reseller_unique_id: (row.reseller_unique_id as string | null) ?? null,
          hume_chat_id: (row.hume_chat_id as string | null) ?? null,
          hume_config_id: (row.hume_config_id as string | null) ?? null,
          extraction_status: row.extraction_status as PerformanceEntry['extraction_status'],
          attempt_count: row.attempt_count as number,
          error_message: (row.error_message as string | null) ?? null,
          transcript_event_count: (row.transcript_event_count as number | null) ?? null,
          full_detail_purged_at: (row.full_detail_purged_at as string | null) ?? null,
          created_at: row.created_at as string,
          demo_performance_visible: row.demo_performance_visible as boolean,
          glitches: (row.glitches as { type: string; description: string | null }[] | null) ?? [],
          extracted_at: (row.extracted_at as string | null) ?? null,
          action_items: (row.action_items as { text: string }[] | null) ?? [],
          summary: insight?.summary ?? null,
          topics_of_interest: insight?.topics_of_interest ?? [],
          engagement_style: insight?.engagement_style ?? null,
          suggested_next_topics: insight?.suggested_next_topics ?? [],
        }
      })
    }
  }

  const { data: sessionRows } = await supabase
    .from('partner_sessions')
    .select('id, status, hume_chat_id, created_at')
    .eq('partner_account_id', demoPartnerAccountId)
    .eq('partner_reference', params.slug)
    .order('created_at', { ascending: false })
    .limit(1)

  const sessionRow = sessionRows?.[0] ?? null

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
    return NextResponse.json({ ...empty, duration_minutes: durationMinutes, entries })
  }

  if (sessionRow.status === 'requested' || sessionRow.status === 'bot_active') {
    return NextResponse.json({
      session_state: 'in_progress',
      duration_minutes: durationMinutes,
      action_items: null,
      learner_insight: null,
      usage: null,
      entries,
    } satisfies PerformanceResponse)
  }

  // sessionRow.status === 'completed' from here on. Plain array fetch + [0], not .maybeSingle() —
  // see the 2026-08-02 root-cause note above this function.
  const { data: insightsRows } = await supabase
    .from('partner_session_insights')
    .select('extraction_status, action_items, learner_insight')
    .eq('partner_session_id', sessionRow.id as string)
    .limit(1)

  const insightsRow = insightsRows?.[0] ?? null

  if (!insightsRow || insightsRow.extraction_status === 'pending') {
    return NextResponse.json({
      session_state: 'pending_extraction',
      duration_minutes: durationMinutes,
      action_items: null,
      learner_insight: null,
      usage: null,
      entries,
    } satisfies PerformanceResponse)
  }

  if (insightsRow.extraction_status === 'failed') {
    return NextResponse.json({
      session_state: 'extraction_failed',
      duration_minutes: durationMinutes,
      action_items: null,
      learner_insight: null,
      usage: null,
      entries,
    } satisfies PerformanceResponse)
  }

  // B2B-57a — this demo session's own `usage.voice_minute` webhook_dispatch_log row, keyed by
  // clio_session_ref = partner_sessions.id (same resolution as every other partner-session join in
  // this codebase). Most-recent row wins if more than one somehow exists for this session. Only
  // fetched in the 'ready' branch since that's the only place the Field/Value table (and these rows)
  // render — matches the brief's "no new fetch/endpoint pattern for one field group" constraint by
  // extending this existing route rather than adding a second query path.
  // Plain array fetch + [0], not .maybeSingle() — see the 2026-08-02 root-cause note above.
  const { data: usageRows } = await supabase
    .from('webhook_dispatch_log')
    .select('payload, created_at')
    .eq('clio_session_ref', sessionRow.id as string)
    .eq('event_type', 'usage.voice_minute')
    .order('created_at', { ascending: false })
    .limit(1)

  const usageRow = usageRows?.[0] ?? null

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
    entries,
    action_items: (insightsRow.action_items as { text: string }[] | null) ?? [],
    learner_insight: (insightsRow.learner_insight as LearnerInsight | null) ?? null,
    usage,
  } satisfies PerformanceResponse)
}
