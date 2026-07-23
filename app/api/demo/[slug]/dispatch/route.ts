import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getDemoTopicBySlug } from '@/app/demo/_content'

/**
 * POST /api/demo/[slug]/dispatch
 *
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.3). Dispatches Clio's real meeting bot into
 * the Google Meet URL saved for this demo topic, by calling the real, unmodified
 * POST /api/partner/v1/sessions server-to-server — the same contract real partners use — authenticated
 * as the dedicated "Clio Internal — Public Demo" account (test_mode: true, never a real partner's
 * account or balance_usd). content_pages[] is assembled deterministically from the already-authored
 * chapter text in app/demo/_content.ts — no AI call anywhere in this route.
 *
 * No passcode check here (§0 Known Constraints — the passcode gates Save only). Instead, rate-limited
 * per topic slug (3-minute cooldown) to close the residual abuse gap of unlimited free repeat-dispatch
 * of an already-saved URL by any anonymous visitor — a technical/error-handling decision, not a
 * product-shape one (see spec §0's "why dispatch needed an additional technical safeguard").
 */

const RATE_LIMIT_MS = 3 * 60 * 1000

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const topic = getDemoTopicBySlug(params.slug)
  if (!topic) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Unknown demo topic.' } }, { status: 404 })
  }

  const supabase = createSupabaseAdminClient()
  const { data: savedRow } = await supabase
    .from('demo_meeting_urls')
    .select('meeting_url, last_dispatch_attempted_at')
    .eq('slug', params.slug)
    .maybeSingle()

  if (!savedRow?.meeting_url) {
    return NextResponse.json(
      { error: { code: 'no_meeting_url', message: 'No meeting URL has been saved for this topic yet.' } },
      { status: 422 }
    )
  }

  if (savedRow.last_dispatch_attempted_at) {
    const elapsed = Date.now() - new Date(savedRow.last_dispatch_attempted_at).getTime()
    if (elapsed < RATE_LIMIT_MS) {
      return NextResponse.json({ error: { code: 'rate_limited', message: 'Try again in a few minutes.' } }, { status: 429 })
    }
  }

  // Marked before the outbound call so two near-simultaneous requests racing past the read-check
  // above still can't both proceed — a small accepted race window, not a financial system (§6.3).
  await supabase.from('demo_meeting_urls').update({ last_dispatch_attempted_at: new Date().toISOString() }).eq('slug', params.slug)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

  const content_pages = topic.chapters.map((ch) => ({
    url: `${appUrl}/demo/${params.slug}/visuals/${ch.id}`,
    media_type: 'html' as const,
    title: ch.title,
    transition_trigger: `Move on once "${ch.title}" has been fully explained.`,
  }))

  const expected_duration_minutes = topic.chapters.reduce((sum, ch) => {
    const m = parseInt(ch.durationLabel, 10)
    return sum + (Number.isNaN(m) ? 0 : m)
  }, 0)

  const body = {
    meeting_url: savedRow.meeting_url,
    content_pages,
    content_source_id: process.env.DEMO_CONTENT_SOURCE_ID,
    content_to_explain: topic.overview,
    title: topic.title,
    subtitle: topic.subtitle,
    expected_duration_minutes,
    partner_reference: params.slug,
  }

  let upstreamStatus: number
  let upstreamBody: { status?: string; clio_session_ref?: string; error?: { code?: string; message?: string } | string }
  try {
    const upstream = await fetch(`${appUrl}/api/partner/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEMO_PARTNER_API_KEY}`,
      },
      body: JSON.stringify(body),
    })
    upstreamStatus = upstream.status
    upstreamBody = await upstream.json()
  } catch (err) {
    console.error('[demo/dispatch] Network error calling /api/partner/v1/sessions:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: { code: 'dispatch_failed', message: 'Something went wrong starting the bot. Try again in a moment.' } },
      { status: 502 }
    )
  }

  // Never forward the upstream response body verbatim to the public client (§6.3's response-mapping
  // table) — no vendor name, HTTP status, or billing-internal detail is ever exposed to a visitor.
  if (upstreamStatus === 201 && upstreamBody.status === 'bot_active') {
    return NextResponse.json({ status: 'dispatched', clio_session_ref: upstreamBody.clio_session_ref })
  }

  console.error('[demo/dispatch] Upstream dispatch did not succeed:', upstreamStatus, JSON.stringify(upstreamBody))
  return NextResponse.json(
    { error: { code: 'dispatch_failed', message: 'Something went wrong starting the bot. Try again in a moment.' } },
    { status: 502 }
  )
}
