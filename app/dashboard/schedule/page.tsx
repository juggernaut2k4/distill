import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import ScheduleClient from './ScheduleClient'
import DashboardShell from '@/components/dashboard/DashboardShell'

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: { subscribed?: string }
}) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, ai_maturity, topic_interests, plan_approved, minutes_balance')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')
  if (!user.plan_approved) redirect('/dashboard/plan')

  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('scheduled_at', { ascending: true })

  const subscribedSuccess = searchParams?.subscribed === '1'

  return (
    <DashboardShell user={user} activeNav="/dashboard/schedule">
      <ScheduleClient
        user={user}
        existingSessions={sessions ?? []}
        subscribedSuccess={subscribedSuccess}
        minutesBalance={user.minutes_balance ?? 0}
      />
    </DashboardShell>
  )
}
