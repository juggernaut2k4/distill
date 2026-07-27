import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getDemoTopicBySlug, flattenBlocksToNarrationText } from '@/app/demo/_content'
import { verifyDemoPasscode } from '@/lib/demo/passcode'

/**
 * POST /api/demo/[slug]/dispatch
 *
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.3, amended §0a 2026-07-23). Dispatches Clio's
 * real meeting bot into the Google Meet URL saved for this demo topic, by calling the real, unmodified
 * POST /api/partner/v1/sessions server-to-server — the same contract real partners use — authenticated
 * as the dedicated "Clio Internal — Public Demo" account (test_mode: true, never a real partner's
 * account or balance_usd). content_pages[] is assembled deterministically from the already-authored
 * chapter text in app/demo/_content.ts — no AI call anywhere in this route.
 *
 * Per the §0a CEO amendment, this also requires the same DEMO_MEETING_PASSCODE the Save action uses —
 * a public, unauthenticated page must not be able to make a real bot join a real meeting with zero
 * credential. The per-slug rate-limit cooldown that used to sit here (defense-in-depth against a
 * leaked passcode) was removed 2026-07-27 per Arun's direct instruction — the passcode gate alone is
 * considered sufficient; a leaked passcode is a credential-rotation problem, not a rate-limiting one.
 *
 * `apiBaseUrl` and `contentBaseUrl` (2026-07-27 fix, revised same day) are deliberately SEPARATE env
 * vars, not just separate constants — `apiBaseUrl` reads NEXT_PUBLIC_APP_URL (the app's real
 * production host), `contentBaseUrl` reads its own dedicated DEMO_CONTENT_BASE_URL. They must never
 * be backed by the same variable: `test.hello-clio.com` (the demo/content host) 404s on every path
 * except /demo/* and the test-harness authoring surface (see middleware.ts's per-host block) —
 * including /api/partner/v1/sessions AND /api/attendee/webhook AND /partner-render/[id], none of
 * which are demo paths.
 *
 * History: an earlier fix pointed NEXT_PUBLIC_APP_URL itself at test.hello-clio.com (to fix
 * content_pages[] visual-rendering here). That broke far more than this route — NEXT_PUBLIC_APP_URL
 * is read by ~15 other call sites (Stripe checkout URLs, every transactional email link, invite
 * links, and critically the Attendee bot's webhook URL and the real /partner-render/[id] URL built
 * in app/api/partner/v1/sessions/route.ts for EVERY partner session, demo or real). Confirmed live
 * 2026-07-27 via Vercel runtime logs: a live demo session had its meeting bot navigate to
 * `test.hello-clio.com/partner-render/<id>` (404, per middleware) and a stream of
 * `POST /api/attendee/webhook 404`s — the bot never rendered content and Clio never spoke, because
 * the whole webhook/render loop was pointed at a host that structurally can't serve it. Fixed by
 * giving the demo-only content-page need its own narrow env var and leaving NEXT_PUBLIC_APP_URL as
 * the real production host everywhere, as every other call site already assumes.
 */

const DispatchSchema = z.object({
  passcode: z.string().min(1),
})

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const topic = getDemoTopicBySlug(params.slug)
  if (!topic) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Unknown demo topic.' } }, { status: 404 })
  }

  const requestBody = await request.json().catch(() => null)
  const parsed = DispatchSchema.safeParse(requestBody)
  if (!parsed.success || !verifyDemoPasscode(parsed.data.passcode)) {
    return NextResponse.json({ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }, { status: 401 })
  }

  const supabase = createSupabaseAdminClient()
  const { data: savedRow } = await supabase
    .from('demo_meeting_urls')
    .select('meeting_url, end_user_name, last_dispatch_attempted_at')
    .eq('slug', params.slug)
    .maybeSingle()

  if (!savedRow?.meeting_url) {
    return NextResponse.json(
      { error: { code: 'no_meeting_url', message: 'No meeting URL has been saved for this topic yet.' } },
      { status: 422 }
    )
  }

  // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.9) — defensive server-side check,
  // since this endpoint is independently callable and passcode-gated, not solely reliant on the
  // client button's `disabled` state.
  if (!savedRow?.end_user_name) {
    return NextResponse.json(
      { error: { code: 'no_end_user_name', message: 'No participant name has been saved for this topic yet.' } },
      { status: 422 }
    )
  }

  // Still recorded (for diagnostics/observability) even though the cooldown check itself was
  // removed — see the file-header comment for why.
  await supabase.from('demo_meeting_urls').update({ last_dispatch_attempted_at: new Date().toISOString() }).eq('slug', params.slug)

  // Content-page URLs must resolve on the demo/test-harness host — /demo/* only renders there.
  // Deliberately its OWN env var, never NEXT_PUBLIC_APP_URL — see file-header comment. No
  // hardcoded host fallback: per Arun's direct instruction (2026-07-27), the test-harness host
  // must always come from config, never be a literal baked into route logic.
  const contentBaseUrl = process.env.DEMO_CONTENT_BASE_URL
  if (!contentBaseUrl) {
    console.error('[demo/dispatch] DEMO_CONTENT_BASE_URL is not configured.')
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong starting the bot. Try again in a moment.' } },
      { status: 500 }
    )
  }
  // The real partner API must NOT be called against that same host — see file-header comment.
  const apiBaseUrl = process.env.DEMO_PARTNER_API_BASE_URL ?? 'https://www.hello-clio.com'

  const content_pages = topic.chapters.map((ch) => ({
    url: `${contentBaseUrl}/demo/${params.slug}/visuals/${ch.id}`,
    media_type: 'html' as const,
    title: ch.title,
    transition_trigger: `Move on once "${ch.title}" has been fully explained.`,
    // B2B-35 F1 — the chapter's actual teaching content, flattened to plain narration text (no
    // AI call — deterministic transform of already-authored blocks).
    content_text: flattenBlocksToNarrationText(ch.blocks),
  }))

  const expected_duration_minutes = topic.chapters.reduce((sum, ch) => {
    const m = parseInt(ch.durationLabel, 10)
    return sum + (Number.isNaN(m) ? 0 : m)
  }, 0)

  const body = {
    meeting_url: savedRow.meeting_url,
    end_user_name: savedRow.end_user_name,
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
    const upstream = await fetch(`${apiBaseUrl}/api/partner/v1/sessions`, {
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
