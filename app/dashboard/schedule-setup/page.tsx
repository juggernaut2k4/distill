import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import ScheduleSetupClient from './ScheduleSetupClient'

export default async function ScheduleSetupPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, plan_approved, scheduling_prefs')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')
  if (!user.plan_approved) redirect('/dashboard/plan')
  // Self-healing: if prefs already set, skip to sessions
  if (user.scheduling_prefs) redirect('/dashboard/sessions')

  // Check for sessions — if none, redirect to plan with error
  const { count } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'draft')
  if (!count || count === 0) redirect('/dashboard/plan?error=no-sessions')

  return (
    <DashboardShell user={user} activeNav="/dashboard/sessions">
      <ScheduleSetupClient />
    </DashboardShell>
  )
}
