import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getDemoTopicBySlug, flattenBlocksToNarrationText } from '@/app/(demo)/demo/_content'
import { resolveDemoPasscodeToAccount } from '@/lib/demo/passcode-accounts'

/**
 * POST /api/demo/[slug]/widget-dispatch
 *
 * B2B-70 v2.0 (docs/specs/B2B-70-requirement-document.md §6.5) — rewritten in place: no longer looks
 * up a pre-registered container (`demo_widget_container_map`/`container_id` are retired — migration
 * 109). `/demo` plays the role of "the reseller's own external system" per Arun's framing, so this
 * route now assembles `content_pages` itself and sends it INLINE to the real
 * `POST /api/partner/v1/widget-sessions` call — exactly mirroring what a real reseller's backend does,
 * and using the EXACT SAME construction the Meeting-tab dispatch route
 * (`app/api/demo/[slug]/dispatch/route.ts`) already uses from `getDemoTopicBySlug(slug).chapters` (same
 * `DEMO_CONTENT_BASE_URL`-rooted URL building, same `flattenBlocksToNarrationText()` call, same
 * `expected_duration_minutes` sum) — not a paraphrase, the same transform applied to the same `topic`.
 *
 * Still authenticated upstream as the fixed "Clio Internal — Public Demo" account
 * (DEMO_PARTNER_API_KEY / DEMO_PARTNER_ACCOUNT_ID), never a real partner's own account or balance.
 * Still returns render_url to the caller (unlike the Meeting-tab dispatch route) — the visitor's own
 * browser renders it in an iframe, exactly mirroring what a real reseller's backend does with
 * widget-sessions' response.
 */

const DispatchSchema = z.object({
  passcode: z.string().min(1),
  end_user_name: z.string().trim().min(1).max(200),
})

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const topic = getDemoTopicBySlug(params.slug)
  if (!topic) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Unknown demo topic.' } }, { status: 404 })
  }

  const requestBody = await request.json().catch(() => null)
  const parsed = DispatchSchema.safeParse(requestBody)
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }, { status: 401 })
  }

  const resolved = await resolveDemoPasscodeToAccount(parsed.data.passcode)
  if (!resolved) {
    return NextResponse.json({ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }, { status: 401 })
  }
  const billedAccountId = resolved.partnerAccountId

  const supabase = createSupabaseAdminClient()
  const demoPartnerAccountId = process.env.DEMO_PARTNER_ACCOUNT_ID
  if (!demoPartnerAccountId) {
    console.error('[demo/widget-dispatch] DEMO_PARTNER_ACCOUNT_ID is not configured.')
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong starting the widget session. Try again in a moment.' } },
      { status: 500 }
    )
  }

  // Duplicate-dispatch guard — mirrors the Meeting tab dispatch route's own (B2B-44 Fix 5a), scoped
  // to this slug's most recent WIDGET session only (a widget session never passes through
  // 'requested'/'bot_dispatch_failed'/'bot_active' — it is created directly as 'widget_active').
  const { data: latestWidgetRows } = await supabase
    .from('partner_sessions')
    .select('id, status')
    .eq('partner_reference', params.slug)
    .eq('partner_account_id', demoPartnerAccountId)
    .eq('delivery_channel', 'widget')
    .order('created_at', { ascending: false })
    .limit(1)
  const latestWidget = latestWidgetRows?.[0] ?? null

  if (latestWidget && latestWidget.status === 'widget_active') {
    return NextResponse.json(
      { error: { code: 'session_already_active', message: 'A widget session is already active for this topic. End it before starting a new one.' } },
      { status: 409 }
    )
  }

  // Content-page URLs must resolve on the demo/test-harness host — /demo/* only renders there.
  // Deliberately its OWN env var, never NEXT_PUBLIC_APP_URL — same discipline as the Meeting-tab
  // dispatch route (see that file's header comment for the incident this convention prevents).
  const contentBaseUrl = process.env.DEMO_CONTENT_BASE_URL
  if (!contentBaseUrl) {
    console.error('[demo/widget-dispatch] DEMO_CONTENT_BASE_URL is not configured.')
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong starting the widget session. Try again in a moment.' } },
      { status: 500 }
    )
  }
  const apiBaseUrl = process.env.DEMO_PARTNER_API_BASE_URL ?? 'https://www.hello-clio.com'

  // §6.5 step 3 — identical construction to app/api/demo/[slug]/dispatch/route.ts's own content_pages
  // assembly (not a paraphrase — the same transform applied to the same topic object).
  const content_pages = topic.chapters.map((ch) => ({
    url: `${contentBaseUrl}/demo/${params.slug}/visuals/${ch.id}`,
    media_type: 'html' as const,
    title: ch.title,
    transition_trigger: `Move on once "${ch.title}" has been fully explained.`,
    content_text: flattenBlocksToNarrationText(ch.blocks),
  }))

  const expected_duration_minutes = topic.chapters.reduce((sum, ch) => {
    const m = parseInt(ch.durationLabel, 10)
    return sum + (Number.isNaN(m) ? 0 : m)
  }, 0)

  let upstreamStatus: number
  let upstreamBody: { status?: string; clio_session_ref?: string; render_url?: string; error?: { code?: string; message?: string } | string }
  try {
    const upstream = await fetch(`${apiBaseUrl}/api/partner/v1/widget-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEMO_PARTNER_API_KEY}`,
      },
      body: JSON.stringify({
        content_pages,
        content_source_id: process.env.DEMO_CONTENT_SOURCE_ID,
        content_to_explain: topic.overview,
        content_title: topic.title,
        content_subtitle: topic.subtitle,
        expected_duration_minutes,
        end_user_name: parsed.data.end_user_name,
        partner_reference: params.slug,
        reseller_id: demoPartnerAccountId,
      }),
    })
    upstreamStatus = upstream.status
    upstreamBody = await upstream.json()
  } catch (err) {
    console.error('[demo/widget-dispatch] Network error calling /api/partner/v1/widget-sessions:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: { code: 'dispatch_failed', message: 'Something went wrong starting the widget session. Try again in a moment.' } },
      { status: 502 }
    )
  }

  if (upstreamStatus === 201 && upstreamBody.status === 'widget_active' && upstreamBody.clio_session_ref && upstreamBody.render_url) {
    const { error: demoDispatchError } = await supabase.from('demo_dispatches').insert({
      clio_session_ref: upstreamBody.clio_session_ref,
      billed_partner_account_id: billedAccountId,
      demo_passcode_id: resolved.passcodeId,
      slug: params.slug,
    })
    if (demoDispatchError) {
      console.error('[demo/widget-dispatch] Failed to insert demo_dispatches row (non-blocking):', demoDispatchError.message)
    }

    return NextResponse.json({ status: 'dispatched', clio_session_ref: upstreamBody.clio_session_ref, render_url: upstreamBody.render_url })
  }

  console.error('[demo/widget-dispatch] Upstream dispatch did not succeed:', upstreamStatus, JSON.stringify(upstreamBody))
  return NextResponse.json(
    { error: { code: 'dispatch_failed', message: 'Something went wrong starting the widget session. Try again in a moment.' } },
    { status: 502 }
  )
}
