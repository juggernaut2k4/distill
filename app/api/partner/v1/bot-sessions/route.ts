import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'
import { resolveWalletGate } from '@/lib/partner/wallet-gate'
import { generateTransitionMarkers } from '@/lib/content/transition-markers'
import { getContentSource } from '@/lib/partner/content-sources'
import { assertUrlSafe } from '@/lib/partner/ssrf'
import { resolveBotIdToAgentId } from '@/lib/partner/bot-id-resolution'
import { CreateBotSessionSchema, DEFAULT_EXPECTED_DURATION_MINUTES } from '@/lib/partner/bot-session-schema'

/**
 * POST /api/partner/v1/bot-sessions
 *
 * B2B-78 (docs/specs/B2B-78-requirement-document.md §3/§4.A/§6.1-§6.4) — stage 2 of the two-stage
 * production pipeline. Claims a `bot_dispatch_reservations` row created by
 * `POST /api/partner/v1/bot-dispatch` and converts it into a real `partner_sessions` row — the
 * exact, already-proven content/wallet-gate/response shape `widget-sessions` already uses (§0),
 * reusing its same shared helpers (`getContentSource`/`assertUrlSafe`/`generateTransitionMarkers`/
 * `resolveWalletGate`) directly rather than duplicating or forking that logic.
 *
 * `widget-sessions/route.ts` itself is untouched by this file — this is a new, standalone route.
 * Direct partners and any sales-partner not using the two-stage flow continue calling
 * `widget-sessions` unchanged (§9).
 *
 * The reservation's own `id` (== the `session_id` the caller sends) becomes `partner_sessions.id`
 * unchanged — never regenerated (§6.2). A `session_id` is single-use for claiming: the atomic
 * conditional UPDATE below (`WHERE status = 'reserved'`) is what actually serializes a concurrent
 * double-claim race, and the `partner_sessions.id` PRIMARY KEY constraint is the second, redundant
 * backstop if two claims somehow both believed they'd won. Unlike `reseller_unique_id`'s own
 * idempotent-replay semantics, a second `bot-sessions` call against an already-claimed `session_id`
 * is treated as an ERROR, not silently idempotent (§9) — it could plausibly carry different
 * content, and silently accepting it would either double-charge or overwrite a live session.
 */

export async function POST(request: NextRequest) {
  const auth = await requirePartnerApiKey(request, 'widget_sessions_create')
  if (auth.error) return auth.error

  const body = await request.json().catch(() => null)
  const parsed = CreateBotSessionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const {
    session_id,
    content_pages,
    content_source_id,
    content_to_explain,
    content_title,
    content_subtitle,
    expected_duration_minutes,
    end_user_role,
    end_user_industry,
    partner_end_user_ref,
    partner_reference,
    reseller_unique_id,
    language,
    reseller_id,
    client_id,
    bot_id,
  } = parsed.data

  const supabase = createSupabaseAdminClient()

  if (reseller_id !== auth.partnerAccountId) {
    return NextResponse.json(
      { error: { code: 'invalid_reseller_id', message: 'reseller_id does not match the account resolved from your API key.' } },
      { status: 422 }
    )
  }

  // §6.4 — a scoped (per-client) key may only be used with its own client_id.
  if (auth.scopedClientId && auth.scopedClientId !== client_id) {
    return NextResponse.json(
      { error: { code: 'client_scope_mismatch', message: 'This API key is scoped to a different client.' } },
      { status: 403 }
    )
  }

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

  // §6.2/§6.4/§9 — atomically claim the reservation. The `status = 'reserved'` condition is what
  // actually serializes a concurrent double-claim; a 0-row result means not-found, expired, or
  // already claimed by another call, and the follow-up SELECT below distinguishes which.
  const nowIso = new Date().toISOString()
  const { data: claimedRows } = await supabase
    .from('bot_dispatch_reservations')
    .update({ status: 'claimed', claimed_at: nowIso })
    .eq('id', session_id)
    .eq('status', 'reserved')
    .gt('expires_at', nowIso)
    .select('id, partner_account_id, client_id, end_user_name')
    .limit(1)
  const claimed = claimedRows?.[0] ?? null

  if (!claimed) {
    const { data: existingRows } = await supabase
      .from('bot_dispatch_reservations')
      .select('status, expires_at')
      .eq('id', session_id)
      .limit(1)
    const existing = existingRows?.[0] ?? null

    if (!existing) {
      return NextResponse.json({ error: { code: 'session_not_found', message: 'session_id was not found.' } }, { status: 422 })
    }
    if (existing.status === 'claimed') {
      return NextResponse.json({ error: { code: 'session_already_claimed', message: 'This session_id has already been claimed.' } }, { status: 422 })
    }
    // Either already marked 'expired' by the cleanup job, or still 'reserved' but past expires_at
    // (cleanup hasn't run yet) — both are the same caller-facing failure.
    return NextResponse.json({ error: { code: 'session_expired', message: 'This session_id has expired. Call bot-dispatch again.' } }, { status: 422 })
  }

  // Reservation resolved to a different account than the authenticated caller — treated
  // identically to not-found (never confirm existence of another account's session_id).
  if (claimed.partner_account_id !== auth.partnerAccountId) {
    return NextResponse.json({ error: { code: 'session_not_found', message: 'session_id was not found.' } }, { status: 422 })
  }

  // The reservation's own client_id (resolved from the bot-dispatch passcode) is the source of
  // truth for which client this session is for — client_id in this body must agree with it.
  if (claimed.client_id !== endClientId) {
    return NextResponse.json(
      { error: { code: 'client_scope_mismatch', message: 'client_id does not match the client this session_id was reserved for.' } },
      { status: 403 }
    )
  }

  let resolvedAgentId: string | null = null
  if (bot_id) {
    resolvedAgentId = await resolveBotIdToAgentId(auth.partnerAccountId, bot_id)
    if (!resolvedAgentId) {
      return NextResponse.json(
        {
          error: {
            code: 'bot_id_not_configured',
            message: `bot_id '${bot_id}' is not configured for your account. Configure it in Developer settings > Bot Voices.`,
          },
        },
        { status: 422 }
      )
    }
  }

  // §6.3 — content-source tenant-scoped resolution, identical to widget-sessions' own check.
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

  // Per-page URL safety, identical to widget-sessions' own check.
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

  // Transition marker generation, identical construction to widget-sessions.
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

  // §6.2 — the reservation's own id becomes partner_sessions.id unchanged, not regenerated.
  const { data: inserted, error: insertError } = await supabase
    .from('partner_sessions')
    .insert({
      id: session_id,
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
      end_user_name: claimed.end_user_name,
      end_user_industry: end_user_industry ?? null,
      conversation_language: language ?? null,
      reseller_unique_id: reseller_unique_id ?? null,
      elevenlabs_agent_id: resolvedAgentId,
      status: 'widget_active',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[partner/bot-sessions] Failed to insert partner_sessions row:', insertError?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to create session.' } }, { status: 500 })
  }

  const clioSessionRef = inserted.id as string
  // B2B-79 owns render_url's real domain resolution (per-sales-partner custom domain) — placeholder
  // shared-domain construction here, to be replaced by that document's §6.3 gate/resolution.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const renderUrl = `${appUrl}/widget-render/${clioSessionRef}`

  const { error: traceLogError } = await supabase.from('partner_session_trace_logs').insert({
    clio_session_ref: clioSessionRef,
    partner_account_id: auth.partnerAccountId,
    reseller_id: auth.partnerAccountId,
    end_client_id: endClientId,
    reseller_unique_id: reseller_unique_id ?? null,
  })
  if (traceLogError) {
    console.error('[partner/bot-sessions] Failed to insert partner_session_trace_logs row (non-fatal):', traceLogError.message)
  }

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
      session_id: clioSessionRef,
      status: 'widget_active',
      render_url: renderUrl,
      ...(reseller_unique_id ? { reseller_unique_id } : {}),
    },
    { status: 201 }
  )
}
