import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import WalkthroughClient from './WalkthroughClient'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Clio — Live Session',
}

export default async function WalkthroughPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  // Fetch or seed an empty walkthrough state for this user
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

  return (
    <>
      {/* Prevent scrollbars on the live walkthrough page */}
      <style>{`html, body { overflow: hidden; margin: 0; padding: 0; }`}</style>
      <WalkthroughClient
        userId={userId}
        initialState={walkthroughState ?? { user_id: userId, status: 'idle', visual_spec: null }}
      />
    </>
  )
}
