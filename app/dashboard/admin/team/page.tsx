import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'
import TeamClient from './TeamClient'

/**
 * B2B-21 Requirement Doc §4.B State T1 — super-admin-only "Team & Access"
 * page: manage super-admins and invite/manage sales-partners. Follows the
 * exact currentUser()-then-DashboardShell-then-<Client/> shape of the other
 * three internal admin pages, substituting requireSuperAdmin() for the bare
 * currentUser() check (a sales-partner has no reason to manage the team —
 * they get notFound()).
 */
export default async function TeamPage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

  return (
    <DashboardShell
      user={{ email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/admin/team"
    >
      <TeamClient />
    </DashboardShell>
  )
}
