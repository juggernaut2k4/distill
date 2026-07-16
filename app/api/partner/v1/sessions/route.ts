import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'
import { dispatchMeetingBot } from '@/lib/partner/session-init'
import { inngest } from '@/inngest/client'

/**
 * POST /api/partner/v1/sessions
 *
 * Session-initiation contract. See
 * docs/specs/B2B-02-requirement-document.md Section 4.1 and
 * architecture.md Section 4 for the full sequence. Authenticated by a
 * partner API key (never a Clerk session — see lib/partner/auth.ts's "Two
 * Auth Systems" note).
 */

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/

const CreateSessionSchema = z
  .object({
    meeting_url: z.string().url(),
    partner_topic_ref: z.string().min(1).max(512).regex(PRINTABLE_ASCII).optional(),
    content_ref: z.string().uuid().optional(),
    partner_end_user_ref: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    partner_reference: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
  })
  .refine((data) => Boolean(data.partner_topic_ref || data.content_ref), {
    message: 'At least one of partner_topic_ref or content_ref is required.',
    path: ['partner_topic_ref'],
  })

export async function POST(request: NextRequest) {
  const auth = await requirePartnerApiKey(request, 'sessions_create')
  if (auth.error) return auth.error

  const body = await request.json().catch(() => null)
  const parsed = CreateSessionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const { meeting_url, partner_topic_ref, content_ref, partner_end_user_ref, partner_reference } = parsed.data

  const supabase = createSupabaseAdminClient()
  const { data: inserted, error: insertError } = await supabase
    .from('partner_sessions')
    .insert({
      partner_account_id: auth.partnerAccountId,
      // B2B-06: exactly one of these two is non-null on any successful auth result
      // (lib/partner/auth.ts) — satisfies partner_sessions_auth_credential_check (migration 079).
      // Replaces the prior unconditional `partner_api_key_id: auth.apiKeyId` write, which NOT
      // NULL-violated on every OAuth2-authenticated request before this fix (CEO review finding,
      // 2026-07-15 — see docs/specs/B2B-06-requirement-document.md v1.1 changelog and
      // architecture.md §18.7.1).
      partner_api_key_id: auth.apiKeyId,
      partner_oauth_client_id: auth.clientId,
      test_mode: auth.mode === 'test',
      meeting_url,
      partner_topic_ref: partner_topic_ref ?? null,
      content_ref: content_ref ?? null,
      partner_end_user_ref: partner_end_user_ref ?? null,
      partner_reference: partner_reference ?? null,
      status: 'requested',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[partner/sessions] Failed to insert partner_sessions row:', insertError?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to create session.' } }, { status: 500 })
  }

  const clioSessionRef = inserted.id as string
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const renderUrl = `${appUrl}/partner-render/${clioSessionRef}`

  // B2B-08 — trial/test-block gate check, test-mode keys only. Inserted between the
  // partner_sessions insert above and the existing dispatchMeetingBot() call below.
  // See docs/specs/B2B-08-requirement-document.md Section 4.A.1 and architecture.md §15.4.
  if (auth.mode === 'test') {
    const { data: wallet } = await supabase
      .from('partner_wallets')
      .select('trial_minutes_used, test_minutes_balance')
      .eq('partner_account_id', auth.partnerAccountId)
      .maybeSingle()

    const trialMinutesUsed = wallet ? Number(wallet.trial_minutes_used) : 0
    const testMinutesBalance = wallet ? Number(wallet.test_minutes_balance) : 0
    const availableMinutes = Math.max(0, 20 - trialMinutesUsed) + testMinutesBalance

    if (availableMinutes <= 0) {
      await supabase
        .from('partner_sessions')
        .update({ status: 'failed', end_reason: 'trial_exhausted' })
        .eq('id', clioSessionRef)

      return NextResponse.json(
        {
          error: {
            code: 'trial_exhausted',
            message: 'Free testing allowance used. Purchase a 2-hour test block to continue.',
          },
        },
        { status: 402 }
      )
    }

    const dispatchResult = await dispatchMeetingBot({ clioSessionRef, meetingUrl: meeting_url, renderUrl })

    if (dispatchResult.status === 'bot_active' && dispatchResult.botId) {
      inngest.send({
        name: 'clio/partner-trial.started',
        data: {
          clioSessionRef,
          partnerAccountId: auth.partnerAccountId,
          providerBotId: dispatchResult.botId,
          availableMinutes,
        },
      }).catch((err) => console.error('[partner/sessions] clio/partner-trial.started emit failed:', err))
    }

    return NextResponse.json(
      {
        clio_session_ref: clioSessionRef,
        status: dispatchResult.status,
        render_url: renderUrl,
        ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
      },
      { status: 201 }
    )
  }

  // auth.mode === 'live' falls through here.
  //
  // B2B-06 — funding guardrail (docs/specs/B2B-06-requirement-document.md Section 4.B.7,
  // architecture.md §18.7.2). Fires only for live-mode requests, between the partner_sessions
  // insert above and dispatchMeetingBot() below — never touches B2B-08's test-mode trial-gate
  // branch above, confirmed orthogonal by activation condition.
  const { data: wallet } = await supabase
    .from('partner_wallets')
    .select('stripe_default_payment_method_id')
    .eq('partner_account_id', auth.partnerAccountId)
    .maybeSingle()

  if (!wallet || !wallet.stripe_default_payment_method_id) {
    // Fail closed: no wallet row at all, or a row with no payment method on file — either way,
    // dispatchMeetingBot() must never be called (zero vendor cost incurred for a rejected dispatch).
    await supabase
      .from('partner_sessions')
      .update({ status: 'failed', end_reason: 'funding_required' })
      .eq('id', clioSessionRef)

    return NextResponse.json(
      {
        error: {
          code: 'funding_required',
          message: 'Add a payment method before starting a live session. Test-mode sessions remain unaffected.',
        },
      },
      { status: 402 }
    )
  }

  const dispatchResult = await dispatchMeetingBot({ clioSessionRef, meetingUrl: meeting_url, renderUrl })

  return NextResponse.json(
    {
      clio_session_ref: clioSessionRef,
      status: dispatchResult.status,
      render_url: renderUrl,
      ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
    },
    { status: 201 }
  )
}
