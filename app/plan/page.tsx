import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import PlanClient from './PlanClient'

export default async function PlanPage() {
  const { userId } = auth()

  if (userId) {
    const supabase = createSupabaseAdminClient()
    const { data: user } = await supabase
      .from('users')
      .select('subscription_status')
      .eq('id', userId)
      .single()

    // Already on a trial or active plan — no need to pick one
    if (
      user?.subscription_status === 'trialing' ||
      user?.subscription_status === 'active'
    ) {
      redirect('/dashboard')
    }
  }

  return <PlanClient />
}
