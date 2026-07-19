import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'
import PartnerInvitesClient from './PartnerInvitesClient'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — super-admin-only
 * "Partner invites" page. Same currentUser()-then-requireSuperAdmin()-then-
 * notFound() gate as app/dashboard/admin/team/page.tsx and
 * app/dashboard/admin/clients/page.tsx.
 */
export default async function PartnerInvitesPage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

  return (
    <DashboardShell
      user={{ email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/admin/partner-invites"
    >
      <PartnerInvitesClient />
    </DashboardShell>
  )
}
