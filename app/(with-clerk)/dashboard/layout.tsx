import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

/**
 * B2B-16 Requirement Doc Section 4.7 (Approved Decision #1). The old hard
 * billing-redirect gate here was removed — it bounced every genuine partner
 * admin (who has no consumer subscription row) to the retired consumer pricing
 * page. The only gate that remains is the Clerk session check below; the
 * per-page onboarding-completion gate (redirect to the wizard) is unchanged and
 * lives on each Configurator page. The old welcome-page path exemption is also
 * gone — that page was deleted in B2B-14, so the branch was dead.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')
  return <>{children}</>
}
