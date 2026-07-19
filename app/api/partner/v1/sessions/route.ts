import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'
import { dispatchMeetingBot } from '@/lib/partner/session-init'
import { resolveEffectiveRate } from '@/lib/partner/webhooks'
import { getContentSource } from '@/lib/partner/content-sources'
import { assertUrlSafe } from '@/lib/partner/ssrf'
import { generateTransitionMarkers } from '@/lib/content/transition-markers'
import { CreateSessionSchema, DEFAULT_EXPECTED_DURATION_MINUTES } from '@/lib/partner/session-schema'
import { inngest } from '@/inngest/client'

/**
 * POST /api/partner/v1/sessions
 *
 * Session-initiation contract. See docs/specs/B2B-02-requirement-document.md
 * Section 4.1 and docs/specs/B2B-19-requirement-document.md Sections 4.B/5.2 for
 * the full sequence. Authenticated by a partner API key or OAuth2 token (never a
 * Clerk session — see lib/partner/auth.ts's "Two Auth Systems" note).
 *
 * B2B-19 adds an additive "inline content" mode (Option 1): the partner supplies
 * their own page/image URLs + per-page transition triggers instead of a
 * content reference (Option 2). Exactly one of the two modes is required. Every
 * existing Option 2 (`content_ref`/`partner_topic_ref`) request keeps working
 * byte-for-byte unchanged (AT-BC-1/2). The request schema lives in
 * lib/partner/session-schema.ts so it stays unit-testable.
 */

export async function POST(request: NextRequest) {
  const auth = await requirePartnerApiKey(request, 'sessions_create')
  if (auth.error) return auth.error

  const body = await request.json().catch(() => null)
  const parsed = CreateSessionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const {
    meeting_url,
    partner_topic_ref,
    content_ref,
    content_pages,
    content_source_id,
    content_to_explain,
    title,
    subtitle,
    expected_duration_minutes,
    partner_end_user_ref,
    partner_reference,
  } = parsed.data

  const supabase = createSupabaseAdminClient()
  const isInline = Boolean(content_pages)

  // ─── Option 1 (inline) pre-flight: content source + SSRF + marker generation ─
  // Runs BEFORE any row insert or dispatch (State B2/B3 — "No dispatch"), so a
  // bad source/URL never creates a session row or incurs vendor cost.
  let inlineColumns: Record<string, unknown> = {}
  if (isInline && content_pages && content_source_id) {
    // State B2 — tenant-scoped content-source resolution.
    const source = await getContentSource(content_source_id, auth.partnerAccountId)
    if (!source) {
      return NextResponse.json(
        { error: { code: 'content_source_not_found', message: 'content_source_id not found for this account.' } },
        { status: 422 }
      )
    }
    if (source.authType === 'presigned_url' || source.authType === 'mtls') {
      return NextResponse.json(
        {
          error: {
            code: 'content_source_auth_type_not_supported',
            message: `auth_type '${source.authType}' is documented but not yet supported.`,
          },
        },
        { status: 422 }
      )
    }

    // State B3 — SSRF gate for every page URL, before dispatch.
    for (let i = 0; i < content_pages.length; i++) {
      const safety = await assertUrlSafe(content_pages[i].url)
      if (!safety.ok) {
        return NextResponse.json(
          {
            error: {
              code: 'content_source_url_rejected',
              message: `content_pages[${i}].url is not an allowed URL (${safety.reason}). Must be https to a public host.`,
              rejected_index: i,
            },
          },
          { status: 422 }
        )
      }
    }

    // System-generated unique transition marker per page (Requirement Doc Section 2.1),
    // collision-checked against the narration so it can never occur incidentally.
    const narration = [content_to_explain, title, subtitle].filter(Boolean).join(' ')
    const markers = generateTransitionMarkers(
      content_pages.map((p) => ({ title: p.title, subtitle: p.subtitle, transitionTrigger: p.transition_trigger })),
      narration
    )
    const pagesWithMarkers = content_pages.map((p, i) => ({
      url: p.url,
      media_type: p.media_type,
      title: p.title ?? null,
      subtitle: p.subtitle ?? null,
      transition_trigger: p.transition_trigger,
      transition_marker: markers[i],
    }))

    inlineColumns = {
      content_source_id,
      content_pages: pagesWithMarkers,
      content_to_explain: content_to_explain ?? null,
      content_title: title ?? null,
      content_subtitle: subtitle ?? null,
      expected_duration_minutes: expected_duration_minutes ?? DEFAULT_EXPECTED_DURATION_MINUTES,
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('partner_sessions')
    .insert({
      partner_account_id: auth.partnerAccountId,
      // B2B-06: exactly one of these two is non-null on any successful auth result.
      partner_api_key_id: auth.apiKeyId,
      partner_oauth_client_id: auth.clientId,
      test_mode: auth.mode === 'test',
      meeting_url,
      partner_topic_ref: partner_topic_ref ?? null,
      content_ref: content_ref ?? null,
      partner_end_user_ref: partner_end_user_ref ?? null,
      partner_reference: partner_reference ?? null,
      status: 'requested',
      ...inlineColumns,
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

  // B2B-08 — trial/test-block gate check, test-mode keys only.
  if (auth.mode === 'test') {
    const { data: wallet } = await supabase
      .from('partner_wallets')
      .select('trial_minutes_used, test_minutes_balance, stripe_default_payment_method_id')
      .eq('partner_account_id', auth.partnerAccountId)
      .maybeSingle()

    // B2B-27 — card-on-file prerequisite, checked BEFORE trial-minutes math.
    // A card is a hard prerequisite independent of remaining allowance — even a
    // full, fresh 20-minute trial is blocked with no card on file. No
    // grandfathering: applies to every account immediately, mirroring B2B-06's
    // live-mode funding guardrail's own unconditional rollout.
    if (!wallet?.stripe_default_payment_method_id) {
      await supabase
        .from('partner_sessions')
        .update({ status: 'failed', end_reason: 'card_required' })
        .eq('id', clioSessionRef)

      return NextResponse.json(
        {
          error: {
            code: 'card_required',
            message: 'Add a payment method to start testing. No charge — this only verifies the card is valid.',
          },
        },
        { status: 402 }
      )
    }

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
      inngest
        .send({
          name: 'clio/partner-trial.started',
          data: { clioSessionRef, partnerAccountId: auth.partnerAccountId, providerBotId: dispatchResult.botId, availableMinutes },
        })
        .catch((err) => console.error('[partner/sessions] clio/partner-trial.started emit failed:', err))
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
  // B2B-06 — funding guardrail (unchanged): fires for every live-mode request.
  const { data: wallet } = await supabase
    .from('partner_wallets')
    .select('stripe_default_payment_method_id, balance_usd')
    .eq('partner_account_id', auth.partnerAccountId)
    .maybeSingle()

  if (!wallet || !wallet.stripe_default_payment_method_id) {
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

  // B2B-19 Billing gap 1 — live-wallet balance enforcement at initiation.
  // Scoped to inline (Option 1) sessions: Option 2 template-ref sessions ignore
  // expected_duration_minutes entirely and retain their exact pre-B2B-19
  // funding_required-only behavior (AT-BC-1 byte-for-byte backward compat).
  let affordableMinutes: number | null = null
  if (isInline) {
    const rate = await resolveEffectiveRate(auth.partnerAccountId, 'voice_minute', new Date().toISOString())
    // No configured rate → there is no per-minute cost to enforce; do not
    // over-block (Requirement Doc Req 3.1). Proceed with no mid-session cutoff.
    if (rate && rate.rate_usd > 0) {
      const balance = Number(wallet.balance_usd ?? 0)
      const expected = expected_duration_minutes ?? DEFAULT_EXPECTED_DURATION_MINUTES
      if (balance < expected * rate.rate_usd) {
        await supabase
          .from('partner_sessions')
          .update({ status: 'failed', end_reason: 'balance_exhausted' })
          .eq('id', clioSessionRef)

        return NextResponse.json(
          {
            error: {
              code: 'balance_exhausted',
              message:
                "Your Clio balance cannot cover this session's expected duration. Add funds or reduce expected_duration_minutes. Test-mode sessions are unaffected.",
            },
          },
          { status: 402 }
        )
      }
      affordableMinutes = Math.floor(balance / rate.rate_usd)
    }
  }

  const dispatchResult = await dispatchMeetingBot({ clioSessionRef, meetingUrl: meeting_url, renderUrl })

  // B2B-19 — arm the mid-session live-wallet cutoff (inline live sessions with a
  // finite affordable-minutes budget only).
  if (isInline && affordableMinutes !== null && dispatchResult.status === 'bot_active' && dispatchResult.botId) {
    inngest
      .send({
        name: 'clio/partner-live.started',
        data: { clioSessionRef, partnerAccountId: auth.partnerAccountId, providerBotId: dispatchResult.botId, affordableMinutes },
      })
      .catch((err) => console.error('[partner/sessions] clio/partner-live.started emit failed:', err))
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
