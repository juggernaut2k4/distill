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

  return (
    <>
      <style>{`html, body { overflow: hidden; margin: 0; padding: 0; background: #080808; }`}</style>
      <WalkthroughClient
        userId={userId}
        initialState={walkthroughState ?? { user_id: userId, status: 'idle', visual_spec: null }}
      />
    </>
  )
}
