import { redirect, notFound } from 'next/navigation'
import { requireChannelPartnerClientAccess } from '@/lib/partner/auth'
import ClientDetailClient from './ClientDetailClient'

/**
 * /dashboard/channel-partner/clients/[id] — B2B-29
 * (docs/specs/B2B-29-requirement-document.md §4). New client detail page.
 * Server component gate: `requireChannelPartnerClientAccess(params.id)`.
 * On error: no session → the existing app-wide `/sign-in` redirect pattern;
 * not the caller's own client, or the client doesn't exist → `notFound()`, a
 * plain 404 — exposing "this exists but isn't yours" vs. "this doesn't
 * exist" is exactly the info leak this codebase's auth functions already
 * avoid (see `requirePartnerAdmin`'s own identical-403-either-way
 * convention).
 */
export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const access = await requireChannelPartnerClientAccess(params.id)
  if (access.error) {
    if (access.error.status === 401) redirect('/sign-in')
    notFound()
  }

  return <ClientDetailClient client={access.client} />
}
