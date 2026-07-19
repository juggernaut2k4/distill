import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getChannelPartnerAccountForClerkUser } from '@/lib/partner/admin-accounts'
import { listClientsForChannelPartner } from '@/lib/partner/clients'
import { listTeamAndInvites } from '@/lib/partner/team-invites'
import { ChannelPartnerShell, NoChannelPartnerAccount, Card, SecondaryButton, COLORS } from './_shared'

/**
 * /dashboard/channel-partner — B2B-26 Dashboard (docs/specs/B2B-26-requirement-document.md §4).
 * Four content areas: Clients glimpse, Team glimpse, Billing — coming soon,
 * Quick links. No Known-Bugs data (B2B-29 scope), no wallet numbers
 * (B2B-28 scope) — a real, honest placeholder for both, not a disabled-
 * looking fake button.
 */
export default async function ChannelPartnerDashboardPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) return <NoChannelPartnerAccount />

  const [clients, team] = await Promise.all([
    listClientsForChannelPartner(account.id),
    listTeamAndInvites(account.id),
  ])

  const recentClientNames = clients.slice(0, 3).map((c) => c.name)
  const activeCount = team.members.length
  const pendingCount = team.pendingInvites.length
  const totalPeople = activeCount + pendingCount

  return (
    <ChannelPartnerShell companyName={account.name} active="dashboard">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 12px' }}>Clients</h2>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.cyan }}>{clients.length}</span>
            <span style={{ color: COLORS.textSecondary, fontSize: 14 }}>clients</span>
          </div>
          {recentClientNames.length > 0 ? (
            <p style={{ color: COLORS.textSecondary, fontSize: 14, margin: '0 0 16px' }}>{recentClientNames.join(', ')}</p>
          ) : (
            <p style={{ color: COLORS.textMuted, fontSize: 14, margin: '0 0 16px' }}>No clients yet.</p>
          )}
          <a href="/dashboard/channel-partner/clients" style={{ textDecoration: 'none' }}>
            <SecondaryButton>View all clients →</SecondaryButton>
          </a>
        </Card>

        <Card>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 12px' }}>Team</h2>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.purple }}>{totalPeople}</span>
            <span style={{ color: COLORS.textSecondary, fontSize: 14 }}>people</span>
          </div>
          <p style={{ color: COLORS.textSecondary, fontSize: 14, margin: '0 0 16px' }}>
            {activeCount} active, {pendingCount} pending
          </p>
          <a href="/dashboard/channel-partner/team" style={{ textDecoration: 'none' }}>
            <SecondaryButton>Manage team →</SecondaryButton>
          </a>
        </Card>

        <Card>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 12px' }}>Billing</h2>
          <p style={{ color: COLORS.textMuted, fontSize: 14, margin: 0 }}>Shared wallet billing for your clients is coming soon.</p>
        </Card>

        <Card>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 12px' }}>Quick links</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="/dashboard/channel-partner/clients?action=add" style={{ textDecoration: 'none' }}>
              <SecondaryButton>Add a client</SecondaryButton>
            </a>
            <a href="/dashboard/channel-partner/team?action=invite" style={{ textDecoration: 'none' }}>
              <SecondaryButton>Invite a team member</SecondaryButton>
            </a>
          </div>
        </Card>
      </div>
    </ChannelPartnerShell>
  )
}
