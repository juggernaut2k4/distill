import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { resolveDispatchPasscode } from '@/lib/partner/dispatch-passcodes'

/**
 * POST /api/partner/v1/bot-dispatch
 *
 * B2B-78 (docs/specs/B2B-78-requirement-document.md §3/§4.A/§6.4/§6.5) — stage 1 of the two-stage
 * production pipeline. Sent by a sales-partner's own backend the moment an end_user initiates a
 * session (e.g. a button click on the client's page). Auth is a lighter-weight passcode, not the
 * full `Authorization: Bearer` API-key mechanism — deliberately, per §6.1 Q7: overloading the same
 * header for two different trust levels across sibling endpoints (`bot-dispatch` vs `bot-sessions`)
 * is a real footgun, so the passcode travels as a body field instead.
 *
 * Creates a `bot_dispatch_reservations` row (identity + reservation only, no content, no wallet
 * check — those are `bot-sessions`' job) and returns `session_id` — the umbrella key every
 * subsequent call in this session's lifecycle references. `session_id` IS the reservation row's
 * own `id`; it migrates forward unchanged into `partner_sessions.id` at the moment `bot-sessions`
 * successfully claims it (§6.2) — never regenerated.
 *
 * No rate limiting is applied here, unlike every other partner-facing endpoint in this codebase —
 * a deliberate, stated omission, not an oversight: this route's auth (a passcode) has no
 * `partner_account_id` to key a rate-limit bucket on until AFTER a candidate resolves, so limiting
 * by resolved account would not slow down a brute-force attempt against unresolved candidates
 * (the actual threat model here). This is flagged rather than silently worked around with an
 * imperfect fix — a real distributed/IP-based limiter for this specific threat is a follow-up
 * decision, not something to invent unilaterally beyond what B2B-78's approved spec covers.
 */

const DispatchSchema = z.object({
  end_user_name: z.string().trim().min(1, 'end_user_name is required').max(200),
  passcode: z.string().min(1),
})

const RESERVATION_TTL_MS = 15 * 60 * 1000 // 15 minutes, per §6.5

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = DispatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const resolved = await resolveDispatchPasscode(parsed.data.passcode)
  if (!resolved) {
    return NextResponse.json(
      { error: { code: 'invalid_passcode', message: 'Passcode not recognized, revoked, or invalid.' } },
      { status: 401 }
    )
  }

  const supabase = createSupabaseAdminClient()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS)

  const { data: inserted, error } = await supabase
    .from('bot_dispatch_reservations')
    .insert({
      partner_account_id: resolved.partnerAccountId,
      client_id: resolved.clientId,
      end_user_name: parsed.data.end_user_name,
      status: 'reserved',
      expires_at: expiresAt.toISOString(),
    })
    .select('id, expires_at')
    .single()

  if (error || !inserted) {
    console.error('[partner/bot-dispatch] Failed to insert bot_dispatch_reservations row:', error?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to create reservation.' } }, { status: 500 })
  }

  return NextResponse.json(
    {
      session_id: inserted.id,
      status: 'reserved',
      expires_at: inserted.expires_at,
    },
    { status: 201 }
  )
}
