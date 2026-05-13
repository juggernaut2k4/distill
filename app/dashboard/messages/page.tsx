import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import MessagesComingSoon from './MessagesComingSoon'

export default async function MessagesPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, plan_approved')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')

  return (
    <DashboardShell user={user} activeNav="/dashboard/messages">
      <MessagesComingSoon />
    </DashboardShell>
  )
}
