import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'
import TemplateApprovalClient from './TemplateApprovalClient'

/**
 * B2B-21 Requirement Doc §4.A / §7 note / §11 Q2 — template_library has no
 * partner_account_id column at all; it is Clio's own global content-approval
 * queue. Super-admin only — a sales-partner gets notFound() here (State G5).
 */
export default async function TemplateLibraryPage() {
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
      <TemplateApprovalClient />
    </DashboardShell>
  )
}
