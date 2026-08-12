import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'
import { resolveWalletGate } from '@/lib/partner/wallet-gate'
import { generateTransitionMarkers } from '@/lib/content/transition-markers'
import { getContentSource } from '@/lib/partner/content-sources'
import { assertUrlSafe } from '@/lib/partner/ssrf'
import { CreateWidgetSessionSchema, DEFAULT_EXPECTED_DURATION_MINUTES } from '@/lib/partner/widget-session-schema'
import { resolveWidgetRenderBaseUrl } from '@/lib/partner/widget-render-url'

/**
 * POST /api/partner/v1/widget-sessions
 *
 * B2B-70 v2.0 (docs/specs/B2B-70-requirement-document.md §6.3) — Pattern A of the embeddable widget
 * delivery channel. Rewritten in place from the v1.1 container-registration model: a widget session's
 * teaching content (`content_pages` and related fields) is now supplied by the caller on EVERY call,
 * exactly like the existing meeting-bot flow's inline-content mode — never pre-registered, never
 * stored in a Clio-owned container table (that table, `partner_widget_containers`, no longer exists —
 * see migration 109). This is still a NEW, standalone route — it does not call `dispatchMeetingBot()`
 * and does not touch `app/api/partner/v1/sessions/route.ts` in any way.
 *
 * "No leftovers" (Arun, 2026-08-03): once Clio's own findings from this session have been recorded
 * back to the reseller, the reseller's own content is purged from this row — see
 * `inngest/partner-session-insights-extractor.ts`'s widget-scoped purge step for the normal-completion
 * path. A session rejected right here at the wallet-gate stage never reaches that pipeline at all, so
 * its own rejection branch (below) purges inline, in the same UPDATE that records the rejection — a
 * stronger case of "no leftovers" than a completed session, since no bot or voice model ever spoke it.
 */

export async function POST(request: NextRequest) {
  const auth = await requirePartnerApiKey(request, 'widget_sessions_create')
  if (auth.error) return auth.error

  // B2B-79 §6.3 — extends the same domain-mandatory gate `bot-sessions` enforces to this existing
  // endpoint too, per that document's explicit recommendation: D16's "no exceptions, no shared
  // fallback offered" describes the sales-partner relationship itself, not one endpoint — leaving
  // this endpoint exempt would let any sales-partner simply keep calling it to avoid ever
  // configuring a domain. Confirmed safe before shipping: every live channel_partner account has
  // custom_domain_status = 'none' today, so no real integration is broken by this.
  const renderBase = await resolveWidgetRenderBaseUrl(auth.accountKind, auth.partnerAccountId)
  if (!renderBase.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'domain_not_configured',
          message: 'Configure and verify a custom domain in Developer settings > Domain before creating sessions.',
        },
      },
      { status: 422 }
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = CreateWidgetSessionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const {
    content_pages,
    content_source_id,
    content_to_explain,
    content_title,
    content_subtitle,
    expected_duration_minutes,
    end_user_name,
    end_user_role,
    end_user_industry,
    partner_end_user_ref,
    partner_reference,
    reseller_unique_id,
    language,
    reseller_id,
    client_id,
    elevenlabs_agent_id,
  } = parsed.data

  const supabase = createSupabaseAdminClient()

  // Mirrors app/api/partner/v1/sessions/route.ts's own reseller_id pre-flight (B2B-38 §6.5) — same
  // reasoning, kept consistent between the two session-creation routes.
  if (reseller_id !== auth.partnerAccountId) {
    return NextResponse.json(
      { error: { code: 'invalid_reseller_id', message: 'reseller_id does not match the account resolved from your API key.' } },
      { status: 422 }
    )
  }

  // Mirrors the existing route's client_id pre-flight (B2B-34 Piece 2) — channel-partner (reseller)
  // callers only; direct partners are unaffected.
  let endClientId: string | null = null
  if (auth.accountKind === 'channel_partner') {
    if (!client_id) {
      return NextResponse.json(
        {
          error: {
            code: 'client_id_required',
            message: "client_id is required for sales-partner accounts. Register a client first, or use your account's auto-provisioned self client.",
          },
        },
        { status: 422 }
      )
    }
    const { data: clientRows } = await supabase
      .from('partner_accounts')
      .select('id')
      .eq('id', client_id)
      .eq('owning_channel_partner_id', auth.partnerAccountId)
      .limit(1)
    if (!clientRows?.[0]) {
      return NextResponse.json(
        { error: { code: 'invalid_client_id', message: 'client_id was not found or is not registered to your account.' } },
        { status: 422 }
      )
    }
    endClientId = client_id
  }

  // §6.3 step 5 — content-source tenant-scoped resolution, mirroring the do-not-touch /sessions
  // route's own identical check for the identical field (State B2 of that route).
  const source = await getContentSource(content_source_id as string, auth.partnerAccountId)
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

  // §6.3 step 6 — per-page URL safety, mirroring the do-not-touch /sessions route's own State B3.
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

  // §6.3 step 7 — transition marker generation, identical construction to the existing /sessions route.
  const narration = [content_to_explain, content_title, content_subtitle].filter(Boolean).join(' ')
  const markers = generateTransitionMarkers(
    content_pages.map((p) => ({ title: p.title, subtitle: p.subtitle, transitionTrigger: p.transition_trigger })),
    narration
  )
  const contentPagesWithMarkers = content_pages.map((p, i) => ({
    url: p.url,
    media_type: p.media_type,
    title: p.title ?? null,
    subtitle: p.subtitle ?? null,
    transition_trigger: p.transition_trigger,
    transition_marker: markers[i],
    content_text: p.content_text ?? null,
  }))

  const expectedDurationMinutes = expected_duration_minutes ?? DEFAULT_EXPECTED_DURATION_MINUTES

  const { data: inserted, error: insertError } = await supabase
    .from('partner_sessions')
    .insert({
      partner_account_id: auth.partnerAccountId,
      partner_api_key_id: auth.apiKeyId,
      partner_oauth_client_id: auth.clientId,
      test_mode: auth.mode === 'test',
      delivery_channel: 'widget',
      content_source_id,
      content_pages: contentPagesWithMarkers,
      content_to_explain: content_to_explain ?? null,
      content_title: content_title ?? null,
      content_subtitle: content_subtitle ?? null,
      expected_duration_minutes: expectedDurationMinutes,
      partner_end_user_ref: partner_end_user_ref ?? null,
      partner_reference: partner_reference ?? null,
      end_client_id: endClientId,
      end_user_role: end_user_role ?? null,
      end_user_name,
      end_user_industry: end_user_industry ?? null,
      conversation_language: language ?? null,
      reseller_unique_id: reseller_unique_id ?? null,
      elevenlabs_agent_id: elevenlabs_agent_id ?? null,
      status: 'widget_active',
    })
    .select('id')
    .single()

  // Idempotent-replay branch — same reasoning/behavior as the existing route's own (B2B-38 §6.5).
  if (insertError?.code === '23505' && reseller_unique_id) {
    const { data: originalRows } = await supabase
      .from('partner_sessions')
      .select('id, status')
      .eq('partner_account_id', auth.partnerAccountId)
      .eq('reseller_unique_id', reseller_unique_id)
      .limit(1)
    const original = originalRows?.[0] ?? null
    if (original) {
      return NextResponse.json(
        {
          clio_session_ref: original.id,
          status: original.status,
          // B2B-71 (docs/specs/B2B-71-requirement-document.md §6.2) — widget sessions render on
          // their own dedicated route, not the shared /partner-render path meeting-bot sessions use.
          // B2B-79 §6.3 — renderBase was already resolved (and gated) above, before this insert.
          render_url: `${renderBase.baseUrl}/widget-render/${original.id}`,
          reseller_unique_id,
        },
        { status: 201 }
      )
    }
  }

  if (insertError || !inserted) {
    console.error('[partner/widget-sessions] Failed to insert partner_sessions row:', insertError?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to create session.' } }, { status: 500 })
  }

  const clioSessionRef = inserted.id as string
  // B2B-71 (docs/specs/B2B-71-requirement-document.md §6.2) — same reasoning as the idempotent-
  // replay branch above. B2B-79 §6.3 — renderBase was already resolved (and gated) above.
  const renderUrl = `${renderBase.baseUrl}/widget-render/${clioSessionRef}`

  const { error: traceLogError } = await supabase.from('partner_session_trace_logs').insert({
    clio_session_ref: clioSessionRef,
    partner_account_id: auth.partnerAccountId,
    reseller_id: auth.partnerAccountId,
    end_client_id: endClientId,
    reseller_unique_id: reseller_unique_id ?? null,
  })
  if (traceLogError) {
    console.error('[partner/widget-sessions] Failed to insert partner_session_trace_logs row (non-fatal):', traceLogError.message)
  }

  // §6.3 step 9 — wallet gate. New in v2.0: the rejection branch also nulls the content columns it
  // just wrote at insert time (above) — "no leftovers" applies even more strongly here than to a
  // completed session, since a rejected session never enters the insights-extraction pipeline that
  // would otherwise be the trigger for this same cleanup.
  const gate = await resolveWalletGate(auth.partnerAccountId, auth.mode as 'test' | 'live', expectedDurationMinutes)

  if (gate.status !== 'ok') {
    const endReasonByStatus: Record<Exclude<typeof gate.status, 'ok'>, string> = {
      card_required: 'card_required',
      trial_exhausted: 'trial_exhausted',
      funding_required: 'funding_required',
      balance_exhausted: 'balance_exhausted',
    }
    const messageByStatus: Record<Exclude<typeof gate.status, 'ok'>, string> = {
      card_required: 'Add a payment method to start testing. No charge — this only verifies the card is valid.',
      trial_exhausted: 'Free testing allowance used. Purchase a 2-hour test block to continue.',
      funding_required: 'Add a payment method before starting a live session. Test-mode sessions remain unaffected.',
      balance_exhausted:
        "Your Clio balance cannot cover this session's expected duration. Add funds or reduce expected_duration_minutes. Test-mode sessions are unaffected.",
    }
    await supabase
      .from('partner_sessions')
      .update({
        status: 'failed',
        end_reason: endReasonByStatus[gate.status],
        content_pages: null,
        content_to_explain: null,
        content_title: null,
        content_subtitle: null,
        assembled_prompt_snapshot: null,
      })
      .eq('id', clioSessionRef)

    return NextResponse.json({ error: { code: gate.status, message: messageByStatus[gate.status] } }, { status: 402 })
  }

  return NextResponse.json(
    {
      clio_session_ref: clioSessionRef,
      status: 'widget_active',
      render_url: renderUrl,
      ...(reseller_unique_id ? { reseller_unique_id } : {}),
    },
    { status: 201 }
  )
}
