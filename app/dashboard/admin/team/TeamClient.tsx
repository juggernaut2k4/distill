'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, UserPlus, Shield } from 'lucide-react'
import Link from 'next/link'

/**
 * B2B-21 Requirement Doc §4.B / §5 — super-admin-only "Team & Access" page.
 * Two panels (Super-admins, Sales-partners) + an "Invite sales-partner"
 * inline form. Follows the exact dark-void / #111111-panel / #7C3AED-accent
 * visual precedent already established by PartnerBillingClient.tsx and
 * TemplateApprovalClient.tsx — no new colors, typography, or npm
 * dependencies. Every action is an in-place async action with an inline
 * spinner (T4) — no toast system exists in this codebase to reuse.
 */

interface SuperAdminRow {
  id: string
  email: string
  status: 'pending' | 'active' | 'deactivated'
  invited_by_email: string | null
  invited_at: string
  accepted_at: string | null
}

interface SalesPartnerRow {
  id: string
  email: string
  status: 'pending' | 'active' | 'deactivated'
  invited_at: string
  accepted_at: string | null
  has_accepted: boolean
  partner_accounts: Array<{ partner_account_id: string; name: string }>
}

interface PartnerAccountOption {
  id: string
  name: string
}

function StatusBadge({ status }: { status: 'pending' | 'active' | 'deactivated' }) {
  const styles: Record<typeof status, string> = {
    pending: 'bg-[#F59E0B]/20 text-[#F59E0B]',
    active: 'bg-[#10B981]/20 text-[#10B981]',
    deactivated: 'bg-[#475569]/20 text-[#94A3B8]',
  }
  return (
    <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${styles[status]}`}>
      {status}
    </span>
  )
}

export default function TeamClient() {
  // ─── Super-admins panel ───────────────────────────────────────────────────
  const [superAdmins, setSuperAdmins] = useState<SuperAdminRow[]>([])
  const [superAdminsLoading, setSuperAdminsLoading] = useState(true)
  const [superAdminsError, setSuperAdminsError] = useState(false)
  const [newSuperAdminEmail, setNewSuperAdminEmail] = useState('')
  const [addingSuperAdmin, setAddingSuperAdmin] = useState(false)
  const [addSuperAdminError, setAddSuperAdminError] = useState<string | null>(null)
  const [deactivatingSuperAdminId, setDeactivatingSuperAdminId] = useState<string | null>(null)

  // ─── Sales-partners panel ─────────────────────────────────────────────────
  const [salesPartners, setSalesPartners] = useState<SalesPartnerRow[]>([])
  const [salesPartnersLoading, setSalesPartnersLoading] = useState(true)
  const [salesPartnersError, setSalesPartnersError] = useState(false)
  const [busyRowId, setBusyRowId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  // ─── Partner accounts (tagging picker) ────────────────────────────────────
  const [partnerAccounts, setPartnerAccounts] = useState<PartnerAccountOption[]>([])
  const [partnerAccountsLoading, setPartnerAccountsLoading] = useState(true)
  const [partnerAccountsError, setPartnerAccountsError] = useState(false)

  // ─── Invite form ───────────────────────────────────────────────────────────
  const [inviteFormOpen, setInviteFormOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteTaggedIds, setInviteTaggedIds] = useState<string[]>([])
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // ─── Edit-tags form ────────────────────────────────────────────────────────
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null)
  const [editTaggedIds, setEditTaggedIds] = useState<string[]>([])
  const [editTagsBusy, setEditTagsBusy] = useState(false)
  const [editTagsError, setEditTagsError] = useState<string | null>(null)

  async function loadSuperAdmins() {
    setSuperAdminsLoading(true)
    setSuperAdminsError(false)
    try {
      const res = await fetch('/api/admin/team/super-admins')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setSuperAdmins(data.super_admins ?? [])
    } catch {
      setSuperAdminsError(true)
    } finally {
      setSuperAdminsLoading(false)
    }
  }

  async function loadSalesPartners() {
    setSalesPartnersLoading(true)
    setSalesPartnersError(false)
    try {
      const res = await fetch('/api/admin/team/sales-partners')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setSalesPartners(data.sales_partners ?? [])
    } catch {
      setSalesPartnersError(true)
    } finally {
      setSalesPartnersLoading(false)
    }
  }

  async function loadPartnerAccounts() {
    setPartnerAccountsLoading(true)
    setPartnerAccountsError(false)
    try {
      const res = await fetch('/api/admin/team/partner-accounts')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setPartnerAccounts(data.partner_accounts ?? [])
    } catch {
      setPartnerAccountsError(true)
    } finally {
      setPartnerAccountsLoading(false)
    }
  }

  // §10 edge case 9 — each panel's own loading state, independent of the others.
  useEffect(() => {
    loadSuperAdmins()
    loadSalesPartners()
    loadPartnerAccounts()
  }, [])

  const activeOrPendingSuperAdminCount = superAdmins.filter((s) => s.status === 'pending' || s.status === 'active').length

  async function handleAddSuperAdmin() {
    if (!newSuperAdminEmail.trim()) return
    setAddingSuperAdmin(true)
    setAddSuperAdminError(null)
    try {
      const res = await fetch('/api/admin/team/super-admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newSuperAdminEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAddSuperAdminError(data?.error?.message ?? "Couldn't add super-admin.")
        return
      }
      setNewSuperAdminEmail('')
      await loadSuperAdmins()
    } catch {
      setAddSuperAdminError("Couldn't add super-admin. Try again.")
    } finally {
      setAddingSuperAdmin(false)
    }
  }

  async function handleDeactivateSuperAdmin(id: string) {
    setDeactivatingSuperAdminId(id)
    setAddSuperAdminError(null)
    try {
      const res = await fetch(`/api/admin/team/super-admins/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setAddSuperAdminError(data?.error?.message ?? "Couldn't deactivate super-admin.")
        return
      }
      await loadSuperAdmins()
    } catch {
      setAddSuperAdminError("Couldn't deactivate super-admin. Try again.")
    } finally {
      setDeactivatingSuperAdminId(null)
    }
  }

  function toggleInviteTag(id: string) {
    setInviteTaggedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSendInvite() {
    if (!inviteEmail.trim() || inviteTaggedIds.length === 0) {
      setInviteError('Email and at least one partner account are required.')
      return
    }
    setInviteBusy(true)
    setInviteError(null)
    try {
      const res = await fetch('/api/admin/team/sales-partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), partner_account_ids: inviteTaggedIds }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInviteError(data?.error?.message ?? data?.error ?? "Couldn't send invite.")
        return
      }
      setInviteEmail('')
      setInviteTaggedIds([])
      setInviteFormOpen(false)
      await loadSalesPartners()
    } catch {
      setInviteError("Couldn't send invite. Try again.")
    } finally {
      setInviteBusy(false)
    }
  }

  function openEditTags(row: SalesPartnerRow) {
    setEditingTagsId(row.id)
    setEditTaggedIds(row.partner_accounts.map((a) => a.partner_account_id))
    setEditTagsError(null)
  }

  function toggleEditTag(id: string) {
    setEditTaggedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSaveTags(id: string) {
    if (editTaggedIds.length === 0) {
      setEditTagsError('At least one partner account must remain tagged.')
      return
    }
    setEditTagsBusy(true)
    setEditTagsError(null)
    try {
      const res = await fetch(`/api/admin/team/sales-partners/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_ids: editTaggedIds }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEditTagsError(data?.error?.message ?? data?.error ?? "Couldn't update tags.")
        return
      }
      setEditingTagsId(null)
      await loadSalesPartners()
    } catch {
      setEditTagsError("Couldn't update tags. Try again.")
    } finally {
      setEditTagsBusy(false)
    }
  }

  async function handleResendInvite(id: string) {
    setBusyRowId(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/team/sales-partners/${id}/resend-invite`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setRowError({ id, message: data?.error?.message ?? data?.error ?? "Couldn't resend invite." })
        return
      }
      await loadSalesPartners()
    } catch {
      setRowError({ id, message: "Couldn't resend invite. Try again." })
    } finally {
      setBusyRowId(null)
    }
  }

  async function handleToggleSalesPartnerStatus(row: SalesPartnerRow) {
    const nextStatus = row.status === 'deactivated' ? 'active' : 'deactivated'
    setBusyRowId(row.id)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/team/sales-partners/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRowError({ id: row.id, message: data?.error?.message ?? data?.error ?? "Couldn't update status." })
        return
      }
      await loadSalesPartners()
    } catch {
      setRowError({ id: row.id, message: "Couldn't update status. Try again." })
    } finally {
      setBusyRowId(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto" style={{ paddingInline: 'clamp(0px, 2vw, 16px)' }}>
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
        <div className="flex items-center gap-3 mb-1">
          <Shield className="w-6 h-6 text-[#7C3AED]" />
          <h1 className="text-white text-2xl font-bold">Team &amp; Access</h1>
        </div>
        <p className="text-[#94A3B8] text-sm">
          Manage Clio super-admins and invite internal sales staff scoped to specific partner accounts.
        </p>
      </div>

      {/* Super-admins panel */}
      <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6 mb-6">
        <h2 className="text-white text-lg font-semibold mb-4">Super-admins</h2>

        {superAdminsLoading && <p className="text-[#94A3B8] text-sm py-4">Loading super-admins…</p>}
        {!superAdminsLoading && superAdminsError && (
          <p className="text-[#EF4444] text-sm py-4">Couldn&apos;t load super-admins. Try refreshing.</p>
        )}

        {!superAdminsLoading && !superAdminsError && (
          <div className="space-y-2 mb-4">
            {superAdmins.map((row) => {
              const isOnlyRemaining = activeOrPendingSuperAdminCount <= 1 && (row.status === 'active' || row.status === 'pending')
              return (
                <div
                  key={row.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3 py-2.5 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]"
                >
                  <span className="text-white text-sm flex-1 min-w-0 truncate">{row.email}</span>
                  <div className="flex items-center gap-3 flex-wrap">
                    <StatusBadge status={row.status} />
                    <span className="text-[#475569] text-xs whitespace-nowrap">
                      {row.invited_by_email ? `added by ${row.invited_by_email}` : 'seed'}
                    </span>
                    {row.status !== 'deactivated' && (
                      <button
                        onClick={() => handleDeactivateSuperAdmin(row.id)}
                        disabled={isOnlyRemaining || deactivatingSuperAdminId === row.id}
                        title={isOnlyRemaining ? 'At least one super-admin must remain' : undefined}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-[#EF4444] hover:border-[#EF4444] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {deactivatingSuperAdminId === row.id && <Loader2 className="w-3 h-3 animate-spin" />}
                        Deactivate
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
          <div className="flex-1">
            <input
              type="email"
              value={newSuperAdminEmail}
              onChange={(e) => setNewSuperAdminEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED]"
            />
            {addSuperAdminError && <p className="text-[#EF4444] text-xs mt-1.5">{addSuperAdminError}</p>}
          </div>
          <button
            onClick={handleAddSuperAdmin}
            disabled={addingSuperAdmin || !newSuperAdminEmail.trim()}
            className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {addingSuperAdmin && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            + Add
          </button>
        </div>
      </div>

      {/* Internal sales staff panel */}
      <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-semibold">Internal sales staff</h2>
          <button
            onClick={() => setInviteFormOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Invite
          </button>
        </div>

        {inviteFormOpen && (
          <div className="bg-[#0A0A0A] border border-[#222222] rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-sm font-semibold">Invite internal sales staff</h3>
              <button onClick={() => setInviteFormOpen(false)} className="text-[#475569] hover:text-white text-xs">
                Cancel
              </button>
            </div>

            <label className="block text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-1.5">Email</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="rahul@salesco.example.com"
              className="w-full bg-[#111111] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED] mb-4"
            />

            <label className="block text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-1.5">
              Tag to partner account(s)
            </label>
            {partnerAccountsLoading && <p className="text-[#94A3B8] text-xs">Loading partner accounts…</p>}
            {!partnerAccountsLoading && partnerAccountsError && (
              <p className="text-[#EF4444] text-xs">Couldn&apos;t load partner accounts — try refreshing.</p>
            )}
            {!partnerAccountsLoading && !partnerAccountsError && (
              <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4">
                {partnerAccounts.map((account) => (
                  <label key={account.id} className="inline-flex items-center gap-2 text-sm text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inviteTaggedIds.includes(account.id)}
                      onChange={() => toggleInviteTag(account.id)}
                      className="accent-[#7C3AED]"
                    />
                    {account.name}
                  </label>
                ))}
                {partnerAccounts.length === 0 && <p className="text-[#475569] text-xs">No partner accounts exist yet.</p>}
              </div>
            )}

            {inviteError && <p className="text-[#EF4444] text-xs mb-3">{inviteError}</p>}

            <button
              onClick={handleSendInvite}
              disabled={inviteBusy || !inviteEmail.trim() || inviteTaggedIds.length === 0}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {inviteBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Send invite
            </button>
          </div>
        )}

        {salesPartnersLoading && <p className="text-[#94A3B8] text-sm py-4">Loading internal sales staff…</p>}
        {!salesPartnersLoading && salesPartnersError && (
          <p className="text-[#EF4444] text-sm py-4">Couldn&apos;t load internal sales staff. Try refreshing.</p>
        )}
        {!salesPartnersLoading && !salesPartnersError && salesPartners.length === 0 && (
          <p className="text-[#475569] text-sm py-4">No internal sales staff yet.</p>
        )}

        {!salesPartnersLoading && !salesPartnersError && (
          <div className="space-y-3">
            {salesPartners.map((row) => (
              <div key={row.id} className="px-3 py-3 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                  <span className="text-white text-sm flex-1 min-w-0 truncate">{row.email}</span>
                  <StatusBadge status={row.status} />
                </div>

                <div className="flex flex-wrap gap-1.5 mb-2">
                  {row.partner_accounts.map((a) => (
                    <span key={a.partner_account_id} className="text-xs px-2 py-0.5 rounded-full bg-[#1A1A1A] text-[#94A3B8] border border-[#222222]">
                      {a.name}
                    </span>
                  ))}
                </div>

                {editingTagsId === row.id ? (
                  <div className="bg-[#111111] border border-[#222222] rounded-lg p-3 mt-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-2 mb-3">
                      {partnerAccounts.map((account) => (
                        <label key={account.id} className="inline-flex items-center gap-2 text-sm text-white cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editTaggedIds.includes(account.id)}
                            onChange={() => toggleEditTag(account.id)}
                            className="accent-[#7C3AED]"
                          />
                          {account.name}
                        </label>
                      ))}
                    </div>
                    {editTagsError && <p className="text-[#EF4444] text-xs mb-2">{editTagsError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveTags(row.id)}
                        disabled={editTagsBusy}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-50"
                      >
                        {editTagsBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                        Save tags
                      </button>
                      <button
                        onClick={() => setEditingTagsId(null)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => openEditTags(row)}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#7C3AED] transition-colors"
                    >
                      Edit tags
                    </button>

                    {/* §10 edge case 4 — a deactivated row that never accepted its invite
                        (no clerk_user_id bound) needs a fresh token, not a status flip;
                        presented as "Resend invite" instead of "Reactivate". */}
                    {(row.status === 'pending' || (row.status === 'deactivated' && !row.has_accepted)) && (
                      <button
                        onClick={() => handleResendInvite(row.id)}
                        disabled={busyRowId === row.id}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#7C3AED] transition-colors disabled:opacity-50"
                      >
                        {busyRowId === row.id && <Loader2 className="w-3 h-3 animate-spin" />}
                        Resend invite
                      </button>
                    )}

                    {/* §10 edge case 3 — reactivating an already-bound row needs no new invite. */}
                    {(row.status === 'active' || row.status === 'pending' || (row.status === 'deactivated' && row.has_accepted)) && (
                      <button
                        onClick={() => handleToggleSalesPartnerStatus(row)}
                        disabled={busyRowId === row.id}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-[#EF4444] hover:border-[#EF4444] transition-colors disabled:opacity-50"
                      >
                        {busyRowId === row.id && <Loader2 className="w-3 h-3 animate-spin" />}
                        {row.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                      </button>
                    )}
                  </div>
                )}

                {rowError?.id === row.id && <p className="text-[#EF4444] text-xs mt-2">{rowError.message}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
