import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'
import WaitlistClient from './WaitlistClient'

/**
 * WAITLIST-01 (docs/specs/WAITLIST-01-requirement-document.md §4.D) — super-admin-only
 * "Waitlist" page. Byte-identical gate pattern to
 * app/(with-clerk)/dashboard/admin/sales-partner-leads/page.tsx.
 */
export default async function WaitlistPage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

  return (
    <DashboardShell
      user={{ email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/admin/waitlist"
    >
      <WaitlistClient />
    </DashboardShell>
  )
}
