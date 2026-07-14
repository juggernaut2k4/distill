import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'
import type { BillableEventType, WebhookPayload } from '@/lib/partner/webhooks'

/**
 * GET /api/partner/v1/usage
 *
 * docs/specs/B2B-02-requirement-document.md Section 4.3. F-01 is resolved as
 * Resolution A (owner decision, 2026-07-13): `usage_events` (migration 072,
 * `072_b2b02_usage_events_resolution_a.sql`, applied and live) is Clio's own
 * aggregating usage ledger and is now the unconditional source of truth this
 * endpoint reads from — the driving table, filtered on
 * `partner_account_id` + `event_type` + `occurred_at`, matching
 * `idx_usage_events_account_type_time`. `test_mode = FALSE` is always
 * applied (test-key-originated usage is never billable and the ledger's own
 * index only covers non-test rows).
 *
 * The partner-facing response shape is unchanged from Resolution B: each
 * event is still the exact architecture.md §7.3 webhook payload shape plus
 * `delivery_status`, reconstructed via each `usage_events` row's
 * `webhook_dispatch_log_id` traceability link — matching Section 8's finding
 * that the partner-facing contract is byte-for-byte identical regardless of
 * which table backs it internally.
 *
 * Note: `usage_events` only ever holds billable events — its CHECK
 * constraint has no `session.completed` value (that event carries no
 * quantity to meter). A `session.completed` row is still written to
 * `webhook_dispatch_log` for delivery/audit purposes, but is never mirrored
 * into `usage_events`. Filtering `event_type=session.completed` therefore
 * always yields an empty page now; `webhook_dispatch_log` remains the place
 * to inspect lifecycle-event delivery status.
 *
 * Paginated, cursor-based, page size 100 (Section 4.3). Cursor encodes
 * `occurred_at|id` (base64) for stable keyset pagination ordered ascending.
 */

const PAGE_SIZE = 100
const VALID_EVENT_TYPES: BillableEventType[] = ['usage.voice_minute', 'usage.llm_generation_call', 'session.completed']

/** Maps the partner-facing BillableEventType filter to the usage_events.event_type domain it corresponds to. */
function usageEventTypesFor(eventType: BillableEventType): string[] {
  if (eventType === 'usage.voice_minute') return ['voice_minute']
  if (eventType === 'usage.llm_generation_call') {
    // B2B-04 Requirement Doc Section 6 — migration 074 (B2B-03) extended
    // usage_events.event_type to 8 values but this mapping was never
    // updated, so a partner filtering on this event type silently never saw
    // the 4 newer sub-types' usage. Fixed alongside B2B-04 since it's
    // already touching usage_events-adjacent billing/read code.
    return [
      'llm_generation_topic',
      'llm_generation_content',
      'llm_generation_prerequisite',
      'llm_generation_skeleton',
      'llm_generation_discovery',
      'llm_generation_sample_fill',
      'llm_generation_new_template',
    ]
  }
  return [] // 'session.completed' — never stored in usage_events (non-billable, no quantity)
}

function decodeCursor(cursor: string | null): { occurredAt: string; id: string } | null {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8')
    const [occurredAt, id] = decoded.split('|')
    if (!occurredAt || !id) return null
    return { occurredAt, id }
  } catch {
    return null
  }
}

function encodeCursor(occurredAt: string, id: string): string {
  return Buffer.from(`${occurredAt}|${id}`, 'utf8').toString('base64')
}

interface UsageEventRow {
  id: string
  occurred_at: string
  webhook_dispatch_log: { payload: WebhookPayload; delivery_status: string } | null
}

export async function GET(request: NextRequest) {
  const auth = await requirePartnerApiKey(request, 'reads')
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const eventTypeParam = searchParams.get('event_type')
  const cursorParam = searchParams.get('cursor')

  const from = fromParam ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const to = toParam ?? new Date().toISOString()

  if (eventTypeParam && !VALID_EVENT_TYPES.includes(eventTypeParam as BillableEventType)) {
    return NextResponse.json(
      { error: 'Validation failed', details: { event_type: `must be one of ${VALID_EVENT_TYPES.join(', ')}` } },
      { status: 422 }
    )
  }

  // usage_events never contains session.completed rows (non-billable) — short-circuit
  // rather than issuing a query with an impossible `event_type IN ()`.
  if (eventTypeParam === 'session.completed') {
    return NextResponse.json({ events: [], next_cursor: null })
  }

  const cursor = decodeCursor(cursorParam)

  const supabase = createSupabaseAdminClient()
  let query = supabase
    .from('usage_events')
    .select('id, occurred_at, webhook_dispatch_log(payload, delivery_status)')
    .eq('partner_account_id', auth.partnerAccountId)
    .eq('test_mode', false)
    .gte('occurred_at', from)
    .lte('occurred_at', to)
    .order('occurred_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(PAGE_SIZE)

  if (eventTypeParam) {
    query = query.in('event_type', usageEventTypesFor(eventTypeParam as BillableEventType))
  }

  if (cursor) {
    query = query.or(`occurred_at.gt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},id.gt.${cursor.id})`)
  }

  const { data, error } = await query

  if (error) {
    console.error('[partner/usage] Query failed:', error.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to read usage.' } }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as UsageEventRow[]
  const events = rows.map((row) => ({
    ...(row.webhook_dispatch_log?.payload ?? {}),
    delivery_status: row.webhook_dispatch_log?.delivery_status ?? null,
  }))

  const nextCursor = rows.length === PAGE_SIZE ? encodeCursor(rows[rows.length - 1].occurred_at, rows[rows.length - 1].id) : null

  return NextResponse.json({ events, next_cursor: nextCursor })
}
