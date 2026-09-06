'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Users, Loader2, Trash2 } from 'lucide-react'
import Link from 'next/link'

/**
 * WAITLIST-01 (docs/specs/WAITLIST-01-requirement-document.md §4.D) — super-admin-only "Waitlist"
 * page. Modeled directly on SalesPartnerLeadsClient.tsx, with rows rendered flat (no status
 * lifecycle, no expand-for-detail) and a delete action via an inline two-step confirm (no modal
 * component exists in this codebase to reuse).
 */

interface WaitlistRow {
  id: string
  name: string
  email: string
  created_at: string
  invite: { status: 'pending' | 'accepted' | 'revoked' | 'expired'; created_at: string } | null
}

function formatRelative(iso: string): string {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return '1 day ago'
  return `${diffDays} days ago`
}

export default function WaitlistClient() {
  const [signups, setSignups] = useState<WaitlistRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  async function loadSignups() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/waitlist')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setSignups(data.signups ?? [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSignups()
  }, [])

  async function handleConfirmDelete(id: string) {
    setDeletingId(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/waitlist/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      setSignups((prev) => prev.filter((s) => s.id !== id))
      setConfirmingId(null)
    } catch {
      setRowError({ id, message: "Couldn't delete this entry. Try again." })
    } finally {
      setDeletingId(null)
    }
  }

  async function handleInvite(id: string) {
    setInvitingId(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/waitlist/${id}/invite`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.status === 409) {
        await loadSignups() // authoritative refresh rather than guessing the existing state (§6.3)
        return
      }
      if (!res.ok) throw new Error('failed')
      setSignups((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, invite: { status: 'pending', created_at: data.invite.created_at } } : s
        )
      )
      if (data.email_sent === false) {
        setRowError({ id, message: "Invite created, but the email couldn't be sent. Ask them to reach out if they don't receive it." })
      }
    } catch {
      setRowError({ id, message: "Couldn't send this invite. Try again." })
    } finally {
      setInvitingId(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto" style={{ paddingInline: 'clamp(0px, 2vw, 16px)' }}>
      <div className="mb-8">
        <Link
          href="/dashboard/admin"
          className="inline-flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Admin
        </Link>
        <div className="flex items-center gap-3 mb-1">
          <Users className="w-6 h-6 text-[#7C3AED]" />
          <h1 className="text-white text-2xl font-bold">Waitlist</h1>
        </div>
        <p className="text-[#94A3B8] text-sm">People who joined the homepage waitlist.</p>
      </div>

      <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6">
        {loading && <p className="text-[#94A3B8] text-sm py-4">Loading waitlist…</p>}
        {!loading && loadError && <p className="text-[#EF4444] text-sm py-4">Couldn&apos;t load the waitlist. Try refreshing.</p>}
        {!loading && !loadError && signups.length === 0 && (
          <p className="text-[#475569] text-sm py-4">No one has joined the waitlist yet.</p>
        )}

        {!loading && !loadError && signups.length > 0 && (
          <div className="space-y-3">
            {signups.map((signup) => {
              const confirming = confirmingId === signup.id
              const deleting = deletingId === signup.id
              const inviting = invitingId === signup.id
              return (
                <div key={signup.id} className="px-3 py-3 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <span className="text-white text-sm font-medium min-w-0 truncate sm:w-48">{signup.name}</span>
                    <span className="text-[#94A3B8] text-sm min-w-0 truncate flex-1">{signup.email}</span>
                    <span className="text-[#475569] text-xs whitespace-nowrap">{formatRelative(signup.created_at)}</span>

                    {inviting ? (
                      <Loader2 className="w-4 h-4 text-[#475569] animate-spin shrink-0" />
                    ) : signup.invite ? (
                      <span className="text-[#475569] text-xs whitespace-nowrap">
                        {signup.invite.status === 'pending' && `Invited · ${formatRelative(signup.invite.created_at)}`}
                        {signup.invite.status === 'accepted' && 'Signed up'}
                        {signup.invite.status === 'expired' && 'Invite expired'}
                        {signup.invite.status === 'revoked' && 'Invite revoked'}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleInvite(signup.id)}
                        className="text-[#7C3AED] text-xs font-semibold hover:text-[#A855F7] transition-colors shrink-0 whitespace-nowrap"
                      >
                        Invite
                      </button>
                    )}

                    {deleting ? (
                      <Loader2 className="w-4 h-4 text-[#475569] animate-spin shrink-0" />
                    ) : confirming ? (
                      <span className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={() => handleConfirmDelete(signup.id)}
                          className="text-[#EF4444] text-xs font-semibold"
                        >
                          Confirm delete
                        </button>
                        <button
                          onClick={() => setConfirmingId(null)}
                          className="text-[#475569] text-xs"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmingId(signup.id)}
                        aria-label="Delete entry"
                        disabled={inviting}
                        className="text-[#475569] hover:text-[#EF4444] transition-colors shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {rowError?.id === signup.id && <p className="text-[#EF4444] text-xs mt-2">{rowError.message}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
