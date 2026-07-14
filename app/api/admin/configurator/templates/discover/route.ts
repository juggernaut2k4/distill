import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { discoverTemplates, recordDiscoveryUsage } from '@/lib/partner/template-discovery'
import { recordPreferenceSignal } from '@/lib/partner/preference'

/**
 * POST /api/admin/configurator/templates/discover
 * Section 4.A.4 Screen state 4/5 — free-text matching. Fires
 * `llm_generation_discovery` usage_events for every real run (Section 8: no
 * event for malformed input, but a "no match" outcome still reached the
 * partner-admin, so it IS billable per Section 8's own row for this case —
 * only a validation failure upstream of a real run is unbilled).
 */

const BodySchema = z.object({
  partner_account_id: z.string().uuid(),
  free_text: z.string().min(1).max(500),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const { candidates, bestMatch } = await discoverTemplates(parsed.data.free_text)
  await recordDiscoveryUsage(parsed.data.partner_account_id)

  if (!bestMatch) {
    // Section 7's acceptance test — no code path here queues skeleton
    // generation; that only happens on the partner-admin's explicit
    // subsequent [Generate a new template] click (templates/generate-new).
    return NextResponse.json({ best_match: null, candidates, no_match: true })
  }

  return NextResponse.json({ best_match: bestMatch, candidates })
}

/** Reject signal — Screen state 4's `[Not quite — see other options]` (Section 6.5, -3). Separate small POST so the discover route itself stays a pure query. */
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = z.object({ partner_account_id: z.string().uuid() }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  await recordPreferenceSignal(parsed.data.partner_account_id, { kind: 'ai_rejected' })
  return NextResponse.json({ ok: true })
}
