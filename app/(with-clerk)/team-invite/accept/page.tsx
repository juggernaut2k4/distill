import TeamInviteAcceptClient from './TeamInviteAcceptClient'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §4, §12) — public
 * accept-invite page for a sales-partner's own team invite. Structurally
 * identical to `app/invite/accept/page.tsx` (B2B-21) — token-only, server
 * component just forwards the query param to the client component.
 */
export default function TeamInviteAcceptPage({ searchParams }: { searchParams: { token?: string } }) {
  return <TeamInviteAcceptClient token={searchParams.token ?? ''} />
}
