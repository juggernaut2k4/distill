import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import SessionsClient from './SessionsClient'
import DashboardShell from '@/components/dashboard/DashboardShell'

export default async function SessionsPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, plan_approved')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, session_index, session_title, scheduled_at, status, topics, duration_mins')
    .eq('user_id', userId)
    .order('scheduled_at', { ascending: true })

  return (
    <DashboardShell user={user} activeNav="/dashboard/sessions">
      <SessionsClient sessions={sessions ?? []} />
    </DashboardShell>
  )
}
