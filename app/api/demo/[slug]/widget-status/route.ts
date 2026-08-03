import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getDemoTopicBySlug } from '@/app/(demo)/demo/_content'

/**
 * GET /api/demo/[slug]/widget-status
 *
 * B2B-70 (docs/specs/B2B-70-requirement-document.md §6.9) — lets the Widget Demo tab learn, on page
 * load/refresh, whether a widget session it previously dispatched is still active (so it can
 * re-render the iframe instead of losing the session on a refresh) without needing any client-side
 * state beyond the slug in the URL. Read-only, no auth beyond the slug itself — mirrors
 * GET /api/demo/[slug]/performance's own unauthenticated, slug-scoped read pattern.
 */

export async function GET(_request: NextRequest, { params }: { params: { slug: string } }) {
  const topic = getDemoTopicBySlug(params.slug)
  if (!topic) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Unknown demo topic.' } }, { status: 404 })
  }

  const demoPartnerAccountId = process.env.DEMO_PARTNER_ACCOUNT_ID
  if (!demoPartnerAccountId) {
    return NextResponse.json({ active: false, clio_session_ref: null, render_url: null })
  }

  const supabase = createSupabaseAdminClient()
  const { data: latestWidgetRows } = await supabase
    .from('partner_sessions')
    .select('id, status')
    .eq('partner_reference', params.slug)
    .eq('partner_account_id', demoPartnerAccountId)
    .eq('delivery_channel', 'widget')
    .order('created_at', { ascending: false })
    .limit(1)
  const latestWidget = latestWidgetRows?.[0] ?? null

  if (!latestWidget || latestWidget.status !== 'widget_active') {
    return NextResponse.json({ active: false, clio_session_ref: null, render_url: null })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  return NextResponse.json({
    active: true,
    clio_session_ref: latestWidget.id,
    render_url: `${appUrl}/partner-render/${latestWidget.id}`,
  })
}
