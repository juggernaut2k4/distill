import PartnerInviteAcceptClient from './PartnerInviteAcceptClient'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — public accept-invite
 * page for a super-admin-issued direct-partner invite. Structurally identical
 * to `app/team-invite/accept/page.tsx` — token-only, server component just
 * forwards the query param to the client component.
 */
export default function PartnerInviteAcceptPage({ searchParams }: { searchParams: { token?: string } }) {
  return <PartnerInviteAcceptClient token={searchParams.token ?? ''} />
}
