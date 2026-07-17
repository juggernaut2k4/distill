import { createSupabaseAdminClient } from '@/lib/supabase'
import WalkthroughClient from './WalkthroughClient'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Clio — Live Session',
}

interface Props {
  params: { userId: string }
  searchParams: { token?: string }
}

/**
 * Public walkthrough page — no Clerk auth required.
 * Accessed by the Recall.ai bot's headless browser to share as screen.
 * URL: /walkthrough/[userId]
 *
 * SECURITY (CEO review fix): this page is fully public and userId-guessable, so
 * walkthrough_state.audit_token must never be embedded in its rendered props —
 * anyone could load this URL and read it out of the page's serialized client
 * component props. Instead the audit token travels only via the `?token=`
 * query param, which is set exclusively by our own server when it builds the
 * walkthroughUrl handed to the meeting-bot provider (app/api/recall/bot/route.ts)
 * — never exposed through any other public read path. audit_token is stripped
 * from `walkthroughState` below before it's passed down as `initialState`; the
 * query-param token is passed separately as `auditToken`.
 */
export default async function PublicWalkthroughPage({ params, searchParams }: Props) {
  const { userId } = params
  const tokenFromUrl = searchParams?.token ?? null

  const supabase = createSupabaseAdminClient()

  const { data: existingState } = await supabase
    .from('walkthrough_state')
    .select('*')
    .eq('user_id', userId)
    .single()

  let walkthroughState = existingState

  if (!walkthroughState) {
    const { data: created } = await supabase
      .from('walkthrough_state')
      .insert({ user_id: userId, status: 'idle' })
      .select()
      .single()
    walkthroughState = created
  }

  // Staleness check: if topic_content_cache was regenerated after walkthrough_state
  // was last written, the stored sections are from a prior generation. Clear them so
  // the client starts with null and populates from the first poll instead.
  // Safe during an active session: the bot writes walkthrough_state continuously,
  // keeping updated_at >= the cache's generated_at while a session is live.
  if (
    walkthroughState?.topic_id &&
    Array.isArray(walkthroughState.sections) &&
    (walkthroughState.sections as unknown[]).length > 0
  ) {
    const { data: latestCache } = await supabase
      .from('topic_content_cache')
      .select('generated_at')
      .eq('topic_id', walkthroughState.topic_id as string)
      .order('generated_at', { ascending: false })
      .limit(1)
      .single()

    if (
      latestCache?.generated_at &&
      new Date(latestCache.generated_at as string) > new Date(walkthroughState.updated_at as string)
    ) {
      walkthroughState = { ...walkthroughState, sections: null }
    }
  }

  // BOT-VIEW-01: optimise layout for headless browser screen share.
  // Hides sidebar, removes skip button, bumps font sizes for clarity at low viewport resolution.
  // Toggle: set NEXT_PUBLIC_BOT_VIEW_OPTIMIZED=true in Vercel env vars. Default: off.
  const botView = process.env.NEXT_PUBLIC_BOT_VIEW_OPTIMIZED === 'true'

  // SECURITY: strip audit_token from the serialized initialState — see file
  // comment above. The real token (if any) reaches the client only via
  // auditToken, sourced from the `?token=` query param.
  const safeInitialState = walkthroughState
    ? { ...walkthroughState, audit_token: undefined }
    : { user_id: userId, status: 'idle', visual_spec: null }

  return (
    <>
      <style>{`html, body { overflow: hidden; margin: 0; padding: 0; background: #080808; }`}</style>
      <WalkthroughClient
        userId={userId}
        initialState={safeInitialState}
        auditToken={tokenFromUrl}
        botView={botView}
      />
    </>
  )
}
