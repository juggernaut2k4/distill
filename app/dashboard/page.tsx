import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getPartnerAccountsForClerkUser } from '@/lib/partner/admin-accounts'
import { resolveInternalAdmin } from '@/lib/internal-admin/auth'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.9) — smart router.
 * B2B-40 (docs/specs/B2B-40-requirement-document.md §6.1) — a super-admin
 * priority check is inserted BEFORE the existing channel_partner membership
 * check. Uses resolveInternalAdmin() (NOT requireSuperAdmin() — that helper
 * would 403 every non-super-admin session, which would break this router
 * for every ordinary partner/reseller login). admin.error is intentionally
 * never inspected here: for a non-super-admin session, resolveInternalAdmin()
 * either returns role: 'internal_staff' or role: null with a populated
 * `error` field, and both cases simply fall through to the two existing
 * branches below, completely unchanged from pre-B2B-40 behavior.
 */
export default async function DashboardPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const admin = await resolveInternalAdmin()
  if (admin.role === 'super_admin') {
    redirect('/dashboard/admin')
  }

  const accounts = await getPartnerAccountsForClerkUser(userId)
  if (accounts.some((a) => a.account_kind === 'channel_partner')) {
    redirect('/dashboard/channel-partner')
  }
  redirect('/dashboard/configurator')
}
