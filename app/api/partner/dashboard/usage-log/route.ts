import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { IN_SCOPE_EVENT_TYPES, resolveDeliveryStatus, resolveReference, type InScopeEventType } from '@/lib/partner/usage-log'

/**
 * GET /api/partner/dashboard/usage-log — B2B-57b Requirement Doc §6.1.
 *
 * A dashboard-session-authenticated (Clerk -> partner_admin_users) read of the reseller's own
 * webhook_dispatch_log rows, scoped to the four in-scope event types (§6.3 — wallet.low_balance is
 * never returned by this endpoint at all, even with no explicit filter). Mirrors
 * app/api/partner/known-bugs/route.ts's own requirePartnerAdmin gate exactly — this is the internal
 * dashboard-read pattern, not the partner-API-key (`requirePartnerApiKey`) pattern; the reseller's own
 * server-to-server integration never calls this route.
 *
 * Read-only. Writes: none.
 */

const QuerySchema = z.object({
  partner_account_id: z.string().uuid(),
  event_type: z.enum(IN_SCOPE_EVENT_TYPES).optional(),
  offset: z.coerce.number().int().min(0).optional().default(0),
  // §6.1 — server-enforced ceiling regardless of what the client requests.
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
})

interface WebhookDispatchLogRow {
  id: string
  event_type: InScopeEventType
  clio_session_ref: string | null
  partner_reference: string | null
  payload: Record<string, unknown> | null
  delivery_status: string
  http_status_code: number | null
  retry_count: number | null
  created_at: string
}

export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse({
    partner_account_id: request.nextUrl.searchParams.get('partner_account_id') ?? undefined,
    event_type: request.nextUrl.searchParams.get('event_type') ?? undefined,
    offset: request.nextUrl.searchParams.get('offset') ?? undefined,
    limit: request.nextUrl.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { partner_account_id: partnerAccountId, event_type: eventTypeFilter, offset, limit } = parsed.data

  // Independently re-resolves and enforces the caller's own account — never trusts
  // partner_account_id past this check, matching every other multi-tenant-scoped route (§7 AT).
  const partnerAuth = await requirePartnerAdmin(partnerAccountId)
  if (partnerAuth.error) return partnerAuth.error

  const supabase = createSupabaseAdminClient()

  let deliveryConfigured = false
  try {
    const { data: account, error } = await supabase
      .from('partner_accounts')
      .select('outbound_base_url')
      .eq('id', partnerAccountId)
      .maybeSingle()
    if (error) throw error
    deliveryConfigured = Boolean(account?.outbound_base_url)
  } catch (err) {
    console.error('[partner/dashboard/usage-log] Failed to resolve delivery configuration:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't load your usage log right now. Try refreshing the page." }, { status: 500 })
  }

  try {
    let query = supabase
      .from('webhook_dispatch_log')
      .select('id, event_type, clio_session_ref, partner_reference, payload, delivery_status, http_status_code, retry_count, created_at')
      .eq('partner_account_id', partnerAccountId)
      .in('event_type', IN_SCOPE_EVENT_TYPES)

    if (eventTypeFilter) {
      query = query.eq('event_type', eventTypeFilter)
    }

    // Fetch one row past the requested page to detect has_more without a separate count query —
    // range() is inclusive on both ends, so (offset, offset + limit) yields up to limit + 1 rows.
    const { data, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit)
    if (error) throw error

    const fetched = (data ?? []) as WebhookDispatchLogRow[]
    const hasMore = fetched.length > limit
    const pageRows = hasMore ? fetched.slice(0, limit) : fetched

    const rows = pageRows.map((row) => {
      // §8 — a malformed/missing payload field must never 500 the whole fetch or drop the row; every
      // field below defensively falls back to null (rendered as an em dash client-side) rather than
      // throwing.
      const payload = row.payload ?? {}
      const quantity = typeof payload.quantity === 'number' ? payload.quantity : null
      const unit = payload.unit === 'minutes' || payload.unit === 'calls' ? payload.unit : null
      const generationType = typeof payload.generation_type === 'string' ? payload.generation_type : null
      const resellerUniqueId = typeof payload.reseller_unique_id === 'string' ? payload.reseller_unique_id : null
      const occurredAt = typeof payload.occurred_at === 'string' ? payload.occurred_at : row.created_at

      return {
        id: row.id,
        event_type: row.event_type,
        clio_session_ref: row.clio_session_ref,
        reference: resolveReference(row.partner_reference, resellerUniqueId),
        quantity,
        unit,
        generation_type: generationType,
        test_mode: Boolean(payload.test_mode),
        occurred_at: occurredAt,
        // §6.4 — computed here, server-side, never left for the client to derive.
        delivery_status: resolveDeliveryStatus(row.delivery_status, row.retry_count ?? 0, deliveryConfigured),
        http_status_code: row.http_status_code ?? null,
      }
    })

    return NextResponse.json({ rows, has_more: hasMore, delivery_configured: deliveryConfigured })
  } catch (err) {
    console.error('[partner/dashboard/usage-log] Failed to load usage log:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't load your usage log right now. Try refreshing the page." }, { status: 500 })
  }
}
