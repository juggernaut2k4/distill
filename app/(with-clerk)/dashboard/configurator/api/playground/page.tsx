import { redirect } from 'next/navigation'

/**
 * /dashboard/configurator/api/playground — superseded 2026-08-10. The playground is now folded
 * directly into the unified 3-pane /dashboard/configurator/api page (docs + live playground in one
 * surface) rather than living on its own route. This redirect exists only so any old bookmark/link
 * still lands somewhere real instead of a dead 404. PlaygroundClient.tsx in this directory is now
 * unreferenced dead code — left in place rather than deleted without explicit confirmation.
 */
export default function PlaygroundPageRedirect({ searchParams }: { searchParams: { partner_account_id?: string } }) {
  const qs = searchParams.partner_account_id ? `?partner_account_id=${searchParams.partner_account_id}` : ''
  redirect(`/dashboard/configurator/api${qs}`)
}
