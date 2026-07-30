/**
 * B2B-57b (docs/specs/B2B-57b-requirement-document.md) — pure, unit-testable helpers backing the
 * reseller-facing Usage log screen (`GET /api/partner/dashboard/usage-log`,
 * `app/(with-clerk)/dashboard/configurator/usage/*`). Kept dependency-free (no Supabase, no Next.js
 * imports) so the delivery-status resolution table (§6.4) and the Amount/Reference formatting rules
 * (§6.1/§9) can be tested directly, matching this repo's convention of extracting pure logic out of
 * route handlers for the Test Plan's "Unit" section (§13).
 */

import type { BillableEventType } from './webhooks'

/** §6.3 — the four event types this screen shows. `wallet.low_balance` is deliberately excluded
 * (account-level alert, not a usage record — never returned by this endpoint at all). */
export const IN_SCOPE_EVENT_TYPES = [
  'usage.voice_minute',
  'usage.llm_generation_call',
  'session.completed',
  'session.insights_ready',
] as const satisfies readonly BillableEventType[]

export type InScopeEventType = (typeof IN_SCOPE_EVENT_TYPES)[number]

export const EVENT_TYPE_LABEL: Record<InScopeEventType, string> = {
  'usage.voice_minute': 'Voice minutes',
  'usage.llm_generation_call': 'LLM generation',
  'session.completed': 'Session completed',
  'session.insights_ready': 'Insights ready',
}

/**
 * §6.4 — five-state delivery resolution, computed server-side (never left to the client). The raw
 * `delivery_status` DB column only has 4 values (`pending | delivered | failed | exhausted`,
 * `'failed'` legacy/unused per §0), but the screen must distinguish "queued, will attempt shortly"
 * (Pending) from "queued but will never be attempted until an endpoint is configured" (Delivery not
 * configured) and from "actively retrying" (Retrying) — none of which the raw column can express on
 * its own. This function is the single source of truth for that mapping; the route handler calls it
 * per row and the client renders whatever comes back, with no resolution logic of its own.
 */
export type ResolvedDeliveryStatus = 'delivered' | 'pending' | 'retrying' | 'failed' | 'not_configured'

export const DELIVERY_STATUS_LABEL: Record<ResolvedDeliveryStatus, string> = {
  delivered: 'Delivered',
  pending: 'Pending',
  retrying: 'Retrying',
  failed: 'Failed',
  not_configured: 'Delivery not configured',
}

export function resolveDeliveryStatus(
  dbDeliveryStatus: string,
  retryCount: number,
  deliveryConfigured: boolean
): ResolvedDeliveryStatus {
  if (dbDeliveryStatus === 'delivered') return 'delivered'
  // 'exhausted' is the real terminal-failure value ever written; 'failed' is schema-valid but never
  // written by any current code path (§0) — handled defensively, same bucket as 'exhausted'.
  if (dbDeliveryStatus === 'exhausted' || dbDeliveryStatus === 'failed') return 'failed'

  // dbDeliveryStatus === 'pending' (or any unexpected future value — treated the same, defensively,
  // rather than throwing on a single malformed row per §8).
  if (retryCount > 0) return 'retrying'
  return deliveryConfigured ? 'pending' : 'not_configured'
}

/** §9 edge case — a row with `partner_reference` AND `payload.reseller_unique_id` both populated:
 * `partner_reference` wins, since it's the field this codebase's webhook docs already surface as the
 * primary opaque reference. */
export function resolveReference(partnerReference: string | null, resellerUniqueId: string | null): string | null {
  return partnerReference ?? resellerUniqueId ?? null
}

/**
 * §4 point 4 "Amount" column / §9 edge case. `session.completed`/`session.insights_ready` never carry
 * a quantity -> em dash. For `usage.*` types: `"{quantity} {unit}"`, singularizing the unit when
 * quantity is exactly 1 (the spec's own visual example shows "1 call", not "1 calls", even though the
 * stored `unit` value is always the plural `'calls'`/`'minutes'` — see `lib/partner/webhooks.ts`
 * `WebhookPayload['unit']`). LLM generation calls additionally show `generation_type` in parens when
 * present; when it's null (schema allows this), no parenthetical is appended (§9), never `"(null)"`.
 */
export function formatAmount(
  eventType: InScopeEventType,
  quantity: number | null,
  unit: 'minutes' | 'calls' | null,
  generationType: string | null
): string {
  if (eventType === 'session.completed' || eventType === 'session.insights_ready') return '—'
  if (quantity == null) return '—'

  let unitLabel = unit ?? ''
  if (quantity === 1 && unitLabel.endsWith('s')) unitLabel = unitLabel.slice(0, -1)
  let amount = unitLabel ? `${quantity} ${unitLabel}` : `${quantity}`

  if (eventType === 'usage.llm_generation_call' && generationType) {
    amount += ` (${generationType})`
  }
  return amount
}
