import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import ScheduleClient from './ScheduleClient'
import DashboardShell from '@/components/dashboard/DashboardShell'

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: { topup?: string; added?: string }
}) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, ai_maturity, topic_interests, minutes_balance, minutes_included, plan_approved')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')
  if (!user.plan_approved) redirect('/dashboard/plan')

  // Fetch existing scheduled sessions
  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('scheduled_at', { ascending: true })

  const topupAdded = searchParams?.topup === 'success' ? (searchParams?.added ?? null) : null

  return (
    <DashboardShell user={user} activeNav="/dashboard/schedule">
      <ScheduleClient
        user={user}
        existingSessions={sessions ?? []}
        topupAdded={topupAdded}
      />
    </DashboardShell>
  )
}
