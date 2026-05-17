import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, subscription_status, stripe_subscription_id, plan_approved')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')

  return (
    <DashboardShell user={user} activeNav="/dashboard/settings">
      <SettingsClient
        email={user.email ?? ''}
        planTier={user.plan_tier ?? 'free'}
        subscriptionStatus={user.subscription_status ?? 'inactive'}
        hasSubscription={!!user.stripe_subscription_id}
      />
    </DashboardShell>
  )
}
