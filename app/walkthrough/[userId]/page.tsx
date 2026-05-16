import { createSupabaseAdminClient } from '@/lib/supabase'
import WalkthroughClient from '@/app/dashboard/walkthrough/WalkthroughClient'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Clio — Live Session',
}

interface Props {
  params: { userId: string }
}

/**
 * Public walkthrough page — no Clerk auth required.
 * Accessed by the Recall.ai bot's headless browser to share as screen.
 * URL: /walkthrough/[userId]
 */
export default async function PublicWalkthroughPage({ params }: Props) {
  const { userId } = params

  const supabase = createSupabaseAdminClient()

  // Fetch walkthrough state and user profile in parallel
  const [stateResult, profileResult] = await Promise.all([
    supabase.from('walkthrough_state').select('*').eq('user_id', userId).single(),
    supabase.from('users').select('role, industry, ai_maturity, delivery_preference').eq('id', userId).single(),
  ])

  let walkthroughState = stateResult.data

  if (!walkthroughState) {
    const { data: created } = await supabase
      .from('walkthrough_state')
      .insert({ user_id: userId, status: 'idle' })
      .select()
      .single()
    walkthroughState = created
  }

  const userProfile = profileResult.data ?? null

  return (
    <>
      <style>{`html, body { overflow: hidden; margin: 0; padding: 0; background: #080808; }`}</style>
      <WalkthroughClient
        userId={userId}
        initialState={walkthroughState ?? { user_id: userId, status: 'idle', visual_spec: null }}
        userProfile={userProfile}
      />
    </>
  )
}
