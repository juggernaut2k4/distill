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
