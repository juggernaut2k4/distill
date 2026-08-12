import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'
import SalesPartnerLeadsClient from './SalesPartnerLeadsClient'

/**
 * B2B-80 (docs/specs/B2B-80-requirement-document.md §4.B) — super-admin-only "Sales-partner leads"
 * page. Same currentUser()-then-requireSuperAdmin()-then-notFound() gate as
 * app/dashboard/admin/partner-invites/page.tsx.
 */
export default async function SalesPartnerLeadsPage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

  return (
    <DashboardShell
      user={{ email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/admin/sales-partner-leads"
    >
      <SalesPartnerLeadsClient />
    </DashboardShell>
  )
}
