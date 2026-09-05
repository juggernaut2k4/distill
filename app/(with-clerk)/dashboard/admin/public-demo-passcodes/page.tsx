import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'
import PublicDemoPasscodesClient from './PublicDemoPasscodesClient'

/**
 * DEMO-PASSCODE-01 (docs/specs/DEMO-PASSCODE-01-requirement-document.md §4.C) — super-admin-only
 * "Public demo passcodes" page. Byte-identical gate pattern to
 * app/(with-clerk)/dashboard/admin/waitlist/page.tsx.
 */
export default async function PublicDemoPasscodesPage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

  return (
    <DashboardShell
      user={{ email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/admin/public-demo-passcodes"
    >
      <PublicDemoPasscodesClient />
    </DashboardShell>
  )
}
