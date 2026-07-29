import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import SalesPartnerDetailClient from './SalesPartnerDetailClient'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4, §9 Edge Case 8) —
 * super-admin-only sales-partner detail page. Server component resolves
 * `id` server-side and 404s if no `partner_accounts` row with that id and
 * `account_kind='channel_partner'` exists — same defense-in-depth the API
 * route also applies.
 */
export default async function SalesPartnerDetailPage({ params }: { params: { id: string } }) {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('id, account_kind')
    .eq('id', params.id)
    .maybeSingle()

  if (!account || account.account_kind !== 'channel_partner') notFound()

  return (
    <DashboardShell
      user={{ email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/admin/sales-partners"
    >
      <SalesPartnerDetailClient id={params.id} />
    </DashboardShell>
  )
}
