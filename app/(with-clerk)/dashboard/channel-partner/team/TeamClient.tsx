'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { COLORS, Card } from '../_shared'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §4) — Team screen client
 * component. Fetches `GET /api/channel-partner/team` on mount. Distinct,
 * new file from `app/dashboard/admin/team/TeamClient.tsx` (B2B-21) — no
 * shared code beyond design tokens, per the spec.
 */

interface MemberRow {
  id: string
  clerkUserId: string
  email: string
  role: 'owner' | 'member'
}

interface PendingInviteRow {
  id: string
  email: string
  invitedAt: string
}

function RoleBadge({ role }: { role: 'owner' | 'member' }) {
  const style = role === 'owner' ? { color: COLORS.purple } : { color: COLORS.textSecondary }
  return (
    <span
      className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ ...style, background: 'rgba(255,255,255,0.06)' }}
    >
      {role === 'owner' ? 'Owner' : 'Member'}
    </span>
  )
}

export default function TeamClient({ initialFormOpen }: { initialFormOpen: boolean }) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [formOpen, setFormOpen] = useState(initialFormOpen)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  async function loadTeam() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/channel-partner/team')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setMembers(data.members ?? [])
      setPendingInvites(data.pendingInvites ?? [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTeam()
  }, [])

  async function handleInvite() {
    if (!email.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/channel-partner/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data?.error ?? "Couldn't send invite. Try again.")
        return
      }
      setEmail('')
      setFormOpen(false)
      await loadTeam()
    } catch {
      setSubmitError("Couldn't send invite. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend(id: string) {
    setBusyInviteId(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/channel-partner/team/invite/${id}/resend`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setRowError({ id, message: data?.error ?? "Couldn't resend invite." })
        return
      }
      await loadTeam()
    } catch {
      setRowError({ id, message: "Couldn't resend invite. Try again." })
    } finally {
      setBusyInviteId(null)
    }
  }

  async function handleRevoke(id: string) {
    setBusyInviteId(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/channel-partner/team/invite/${id}/revoke`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setRowError({ id, message: data?.error ?? "Couldn't revoke invite." })
        return
      }
      await loadTeam()
    } catch {
      setRowError({ id, message: "Couldn't revoke invite. Try again." })
    } finally {
      setBusyInviteId(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-white text-2xl font-bold">Team</h1>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors"
        >
          Invite a team member
        </button>
      </div>

      {formOpen && (
        <Card style={{ marginBottom: 16 }}>
          <label className="block text-[#94A3B8] text-sm font-medium mb-1.5">Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED] mb-4"
          />
          {submitError && <p className="text-[#EF4444] text-xs mb-3">{submitError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleInvite}
              disabled={submitting || !email.trim()}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Send invite
            </button>
            <button
              onClick={() => setFormOpen(false)}
              className="text-sm font-semibold px-4 py-2 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </Card>
      )}

      {loading && <p style={{ color: COLORS.textSecondary, fontSize: 14 }}>Loading…</p>}
      {!loading && loadError && <p style={{ color: COLORS.red, fontSize: 14 }}>Couldn&apos;t load your team.</p>}

      {!loading && !loadError && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '20px 0 8px' }}>Team members</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {members.map((member) => (
              <Card key={member.id}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: COLORS.textPrimary, fontSize: 14 }}>{member.email}</span>
                  <RoleBadge role={member.role} />
                </div>
              </Card>
            ))}
          </div>

          <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '20px 0 8px' }}>Pending invites</h2>
          {pendingInvites.length === 0 ? (
            <p style={{ color: COLORS.textMuted, fontSize: 14 }}>No pending invites.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingInvites.map((invite) => (
                <Card key={invite.id}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <span style={{ color: COLORS.textPrimary, fontSize: 14 }}>{invite.email}</span>
                      <span style={{ color: COLORS.textMuted, fontSize: 12, marginLeft: 8 }}>
                        Invited {new Date(invite.invitedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => handleResend(invite.id)}
                        disabled={busyInviteId === invite.id}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#7C3AED] transition-colors disabled:opacity-50"
                      >
                        {busyInviteId === invite.id && <Loader2 className="w-3 h-3 animate-spin" />}
                        Resend
                      </button>
                      <button
                        onClick={() => handleRevoke(invite.id)}
                        disabled={busyInviteId === invite.id}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-[#EF4444] hover:border-[#EF4444] transition-colors disabled:opacity-50"
                      >
                        {busyInviteId === invite.id && <Loader2 className="w-3 h-3 animate-spin" />}
                        Revoke
                      </button>
                    </div>
                  </div>
                  {rowError?.id === invite.id && <p className="text-[#EF4444] text-xs mt-2">{rowError.message}</p>}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
