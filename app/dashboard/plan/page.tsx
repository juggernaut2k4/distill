import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import PlanClient from './PlanClient'
import DashboardShell from '@/components/dashboard/DashboardShell'

export default async function PlanPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, ai_maturity, topic_interests, curriculum_plan, plan_approved, minutes_balance, minutes_included')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')

  return (
    <DashboardShell user={user} activeNav="/dashboard/plan">
      <PlanClient user={user} />
    </DashboardShell>
  )
}
