import InviteAcceptClient from './InviteAcceptClient'

/**
 * B2B-21 Requirement Doc §4.C — public accept-invite page. Token-only,
 * server component just forwards the query param to the client component
 * that drives states A1–A4.
 */
export default function InviteAcceptPage({ searchParams }: { searchParams: { token?: string } }) {
  return <InviteAcceptClient token={searchParams.token ?? ''} />
}
