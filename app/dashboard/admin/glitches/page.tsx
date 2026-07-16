import { currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import GlitchDashboardClient from './GlitchDashboardClient'

/**
 * B2B-09 Requirement Doc §4.A / architecture.md §16.9 — the one real screen
 * this brief builds. Byte-for-byte the same shape as
 * app/dashboard/admin/clients/page.tsx (Clerk `currentUser()` gate, redirect
 * to /sign-in, DashboardShell wrapper), substituting GlitchDashboardClient
 * for PartnerBillingClient. No new visual direction invented.
 */
export default async function GlitchDashboardPage() {
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
    >
      <GlitchDashboardClient />
    </DashboardShell>
  )
}
