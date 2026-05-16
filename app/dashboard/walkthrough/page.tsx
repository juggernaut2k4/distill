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

  return (
    <>
      {/* Prevent scrollbars on the live walkthrough page */}
      <style>{`html, body { overflow: hidden; margin: 0; padding: 0; }`}</style>
      <WalkthroughClient
        userId={userId}
        initialState={walkthroughState ?? { user_id: userId, status: 'idle', visual_spec: null }}
        userProfile={profileResult.data ?? null}
      />
    </>
  )
}
