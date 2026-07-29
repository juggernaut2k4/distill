import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'
import SalesPartnersClient from './SalesPartnersClient'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — super-admin-only
 * sales-partner roster page. Same gate pattern as the other admin pages.
 */
export default async function SalesPartnersPage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

  return (
    <DashboardShell
      user={{ email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/admin/sales-partners"
    >
      <SalesPartnersClient />
    </DashboardShell>
  )
}
