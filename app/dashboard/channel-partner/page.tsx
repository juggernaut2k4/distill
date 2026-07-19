import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getChannelPartnerAccountForClerkUser } from '@/lib/partner/admin-accounts'
import { listClientsForChannelPartner } from '@/lib/partner/clients'
import { listTeamAndInvites } from '@/lib/partner/team-invites'
import { checkCardOnFile } from '@/lib/partner/configurator-status'
import { ChannelPartnerShell, NoChannelPartnerAccount, Card, SecondaryButton, COLORS } from './_shared'

const UNNAMED_PLACEHOLDER = 'Unnamed partner'

/**
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §4) — the non-blocking
 * "Finish setting up your account" checklist. Renders only while at least
 * one of the two items is incomplete; never blocks anything below it.
 */
function SetupBanner({ companyName, cardOnFile }: { companyName: string; cardOnFile: boolean }) {
  const companyInfoDone = companyName !== UNNAMED_PLACEHOLDER
  if (companyInfoDone && cardOnFile) return null

  return (
    <Card>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 12px' }}>
        Finish setting up your account
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SetupRow done={companyInfoDone} label="Company info" pendingCopy="Add your company name and website" />
        <SetupRow done={cardOnFile} label="Payment" pendingCopy="Add a card — this never charges you automatically" />
      </div>
    </Card>
  )
}

function SetupRow({ done, label, pendingCopy }: { done: boolean; label: string; pendingCopy: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {done ? (
          <span style={{ color: COLORS.green, fontSize: 13 }}>✓</span>
        ) : (
          <span style={{ width: 10, height: 10, borderRadius: '50%', border: `1px solid ${COLORS.textMuted}`, display: 'inline-block' }} />
        )}
        <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 600 }}>{label}</span>
        {!done && <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>— {pendingCopy}</span>}
      </div>
      {!done && (
        <a href="/dashboard/channel-partner/settings" style={{ color: COLORS.purple, fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Add →
        </a>
      )}
    </div>
  )
}

/**
 * /dashboard/channel-partner — B2B-26 Dashboard (docs/specs/B2B-26-requirement-document.md §4).
 * Four content areas: Clients glimpse, Team glimpse, Billing — coming soon,
 * Quick links. No Known-Bugs data, no wallet numbers (B2B-28 scope) — a
 * real, honest placeholder for both, not a disabled-looking fake button.
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §4) — adds the
 * non-blocking "Finish setting up your account" banner above the Clients
 * card.
 */
export default async function ChannelPartnerDashboardPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const account = await getChannelPartnerAccountForClerkUser(userId)
  if (!account) return <NoChannelPartnerAccount />

  const [clients, team, cardOnFile] = await Promise.all([
    listClientsForChannelPartner(account.id),
    listTeamAndInvites(account.id),
    checkCardOnFile(account.id),
  ])

  const recentClientNames = clients.slice(0, 3).map((c) => c.name)
  const activeCount = team.members.length
  const pendingCount = team.pendingInvites.length
  const totalPeople = activeCount + pendingCount

  return (
    <ChannelPartnerShell companyName={account.name} active="dashboard">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SetupBanner companyName={account.name} cardOnFile={cardOnFile} />
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
