import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'
import { dispatchMeetingBot } from '@/lib/partner/session-init'
import { resolveEffectiveRate } from '@/lib/partner/webhooks'
import { getContentSource } from '@/lib/partner/content-sources'
import { assertUrlSafe } from '@/lib/partner/ssrf'
import { generateTransitionMarkers } from '@/lib/content/transition-markers'
import { CreateSessionSchema, DEFAULT_EXPECTED_DURATION_MINUTES, isTemplateModeEnabled } from '@/lib/partner/session-schema'
import { inngest } from '@/inngest/client'
import { TRIAL_MINUTES_LIFETIME_CAP } from '@/lib/billing/trial-minutes'

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
    client_id,
    end_user_role,
    end_user_name,
    end_user_industry,
    reseller_id,
    reseller_unique_id,
    language,
  } = parsed.data

  const supabase = createSupabaseAdminClient()
  const isInline = Boolean(content_pages)

  // ─── B2B-64 (docs/specs/B2B-64-requirement-document.md §4/§6) — Option 2 session-creation guard.
  // Runs immediately after Zod success, before every other pre-flight — no partner_sessions row is
  // ever created, no dispatch attempted, no cost incurred for a rejected Option-2 request. A
  // request supplying BOTH content_pages and partner_topic_ref/content_ref never reaches here —
  // CreateSessionSchema's own "exactly one of" refine already failed inside safeParse() above,
  // returning the generic Validation-failed 422 first (§4 State D). Guard, not deletion: the schema
  // fields and this route's Option-2 logic below are untouched — re-enabling is a one-line env var
  // flip (TEMPLATE_MODE_SESSIONS_ENABLED=true), no code change.
  if (!isInline && !isTemplateModeEnabled()) {
    return NextResponse.json(
      {
        error: {
          code: 'content_reference_not_supported',
          message:
            'Creating a session with partner_topic_ref or content_ref is not currently supported. Use inline content (content_pages) instead — see the Docs page for the current integration guide.',
        },
      },
      { status: 422 }
    )
  }

  // ─── B2B-38 (docs/specs/B2B-38-requirement-document.md §6.5) — reseller_id mismatch pre-flight
  // (Open Item 1). Runs before client_id's own pre-flight and before any row insert — a mismatched
  // reseller_id must never create a session row or incur vendor cost, exactly mirroring why
  // client_id's own pre-flight runs first. A request that omits reseller_id entirely never reaches
  // this check — it fails Zod's own required-field validation first (the generic 422 above).
  if (reseller_id !== auth.partnerAccountId) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_reseller_id',
          message: 'reseller_id does not match the account resolved from your API key.',
        },
      },
      { status: 422 }
    )
  }

  // ─── B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.5) — client_id pre-flight.
  // Required only for account_kind='channel_partner' (reseller) callers; direct partners
  // (account_kind='partner') are completely unaffected — client_id stays absent/unused for them,
  // exactly matching pre-B2B-34 behavior. Runs before the Option-1 pre-flight block below so a bad
  // client_id never creates a session row or triggers a content-source lookup.
  let endClientId: string | null = null
  if (auth.accountKind === 'channel_partner') {
    if (!client_id) {
      return NextResponse.json(
        {
          error: {
            code: 'client_id_required',
            message:
              "client_id is required for sales-partner accounts. Register a client first, or use your account's auto-provisioned self client (see your Clients page).",
          },
        },
        { status: 422 }
      )
    }
    const { data: clientRow } = await supabase
      .from('partner_accounts')
      .select('id')
      .eq('id', client_id)
      .eq('owning_channel_partner_id', auth.partnerAccountId)
      .maybeSingle()
    if (!clientRow) {
      return NextResponse.json(
        { error: { code: 'invalid_client_id', message: 'client_id was not found or is not registered to your account.' } },
        { status: 422 }
      )
    }
    endClientId = client_id
  }

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
      // B2B-35 F1 — optional per-page narration content, threaded through unchanged.
      content_text: p.content_text ?? null,
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
      end_client_id: endClientId,
      // B2B-35 F3 — session-wide audience description, applies to both content modes.
      end_user_role: end_user_role ?? null,
      // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.6) — required at the Zod layer
      // (§6.2), so `?? null` here is defensive only, matching this file's existing style for the
      // other end_user_* fields.
      end_user_name: end_user_name ?? null,
      end_user_industry: end_user_industry ?? null,
      // B2B-62 — optional, session-wide conversation language. Null (English) for every request
      // that omits it, byte-identical to pre-B2B-62 behavior.
      conversation_language: language ?? null,
      // B2B-38 §6.4/§6.5 — idempotent-replay key (Open Item 2). A replay of the same
      // (partner_account_id, reseller_unique_id) pair fails this insert with a Postgres
      // unique-violation (23505), caught below.
      reseller_unique_id: reseller_unique_id ?? null,
      status: 'requested',
      ...inlineColumns,
    })
    .select('id')
    .single()

  // B2B-38 §6.5 — Open Item 2's idempotent-replay branch. A unique-violation on
  // idx_partner_sessions_reseller_unique_id means this exact (reseller, reseller_unique_id) pair
  // already has a session — return that session's ORIGINAL response, do not create a new row, do not
  // call dispatchMeetingBot(). Any other field differences in this retried request (e.g. a different
  // meeting_url) are deliberately ignored — reseller_unique_id alone is the idempotency key. This
  // branch runs BEFORE dispatchMeetingBot() is ever reached, so no concurrent replay can ever cause a
  // second real bot join — the DB unique index is the sole source of truth, not a check-then-act.
  if (insertError?.code === '23505' && reseller_unique_id) {
    const { data: original } = await supabase
      .from('partner_sessions')
      .select('id, status')
      .eq('partner_account_id', auth.partnerAccountId)
      .eq('reseller_unique_id', reseller_unique_id)
      .maybeSingle()

    if (original) {
      const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
      const originalRenderUrl = `${originalAppUrl}/partner-render/${original.id}`
      return NextResponse.json(
        { clio_session_ref: original.id, status: original.status, render_url: originalRenderUrl, reseller_unique_id },
        { status: 201 }
      )
    }
    // Conflict fired but the row vanished between insert and re-select (should not happen — no
    // delete path exists for partner_sessions) — fall through to the generic error below rather
    // than silently succeed on an inconsistent state.
  }

  if (insertError || !inserted) {
    console.error('[partner/sessions] Failed to insert partner_sessions row:', insertError?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to create session.' } }, { status: 500 })
  }

  const clioSessionRef = inserted.id as string
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const renderUrl = `${appUrl}/partner-render/${clioSessionRef}`

  // B2B-38 §6.5 — new trace-log row, inserted immediately after a genuinely new partner_sessions
  // row is created. Best-effort, logged-not-thrown — a logging-table failure must never prevent a
  // real session from being created and dispatched.
  const { error: traceLogError } = await supabase.from('partner_session_trace_logs').insert({
    clio_session_ref: clioSessionRef,
    partner_account_id: auth.partnerAccountId,
    reseller_id: auth.partnerAccountId, // always equal — validated above (§6.1)
    end_client_id: endClientId,
    reseller_unique_id: reseller_unique_id ?? null,
  })
  if (traceLogError) {
    console.error('[partner/sessions] Failed to insert partner_session_trace_logs row (non-fatal):', traceLogError.message)
  }

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
    const availableMinutes = Math.max(0, TRIAL_MINUTES_LIFETIME_CAP - trialMinutesUsed) + testMinutesBalance

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
        // B2B-38 §6.5 — echoed back only when the caller sent one (same conditional-spread
        // convention as `error` immediately below).
        ...(reseller_unique_id ? { reseller_unique_id } : {}),
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
      // B2B-38 §6.5 — echoed back only when the caller sent one (same conditional-spread
      // convention as `error` immediately below).
      ...(reseller_unique_id ? { reseller_unique_id } : {}),
      ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
    },
    { status: 201 }
  )
}
