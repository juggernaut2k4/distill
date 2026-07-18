import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'
import PartnerBillingClient from './PartnerBillingClient'

/**
 * B2B-21 Requirement Doc §4.A / §11 Q2 — cross-partner billing/revenue
 * detail is super-admin-only (brushes the frozen commission topic; a
 * sales-partner gets notFound() here, State G5). Content of this page is
 * otherwise untouched — only the role gate is new.
 */
export default async function PartnerBillingPage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

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
      <PartnerBillingClient />
    </DashboardShell>
  )
}
