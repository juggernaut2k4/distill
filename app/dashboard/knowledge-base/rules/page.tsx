import { currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import KBRulesClient from './KBRulesClient'

export default async function KBRulesPage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, plan_approved')
    .eq('id', clerkUser.id)
    .single()

  return (
    <DashboardShell
      user={user ?? { email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/knowledge-base"
    >
      <KBRulesClient />
    </DashboardShell>
  )
}
