import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import SessionDetailClient from './SessionDetailClient'

interface Props {
  params: { id: string }
}

export default async function SessionDetailPage({ params }: Props) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  const [{ data: user }, { data: session }] = await Promise.all([
    supabase
      .from('users')
      .select('id, email, plan_tier, plan_approved, minutes_balance')
      .eq('id', userId)
      .single(),
    supabase
      .from('sessions')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', userId)
      .single(),
  ])

  if (!user) redirect('/onboarding')
  if (!session) notFound()

  return (
    <DashboardShell user={user} activeNav="/dashboard/sessions">
      <SessionDetailClient session={session} minutesBalance={user.minutes_balance ?? 0} />
    </DashboardShell>
  )
}
