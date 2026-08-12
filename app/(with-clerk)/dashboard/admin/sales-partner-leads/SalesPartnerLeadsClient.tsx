'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Users, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'

/**
 * B2B-80 (docs/specs/B2B-80-requirement-document.md §4.B) — super-admin-only "Sales-partner leads"
 * page. Mirrors PartnerInvitesClient.tsx's generate/list/one-time-reveal interaction pattern (no
 * confirm dialogs, inline spinners, no toast system), but rows expand inline to show phone/message
 * (§4.B's explicit recommendation over a separate detail page) instead of that page's flat list.
 */

interface LeadRow {
  id: string
  name: string
  company_name: string
  email: string
  phone: string | null
  message: string | null
  status: 'new' | 'contacted' | 'invited' | 'declined'
  created_at: string
  contacted_at: string | null
  invite_id: string | null
}

function StatusBadge({ status }: { status: LeadRow['status'] }) {
  const styles: Record<LeadRow['status'], string> = {
    new: 'bg-[#06B6D4]/20 text-[#06B6D4]',
    contacted: 'bg-[#F59E0B]/20 text-[#F59E0B]',
    invited: 'bg-[#10B981]/20 text-[#10B981]',
    declined: 'bg-[#475569]/20 text-[#94A3B8]',
  }
  const labels: Record<LeadRow['status'], string> = {
    new: 'New',
    contacted: 'Contacted',
    invited: 'Invited',
    declined: 'Declined',
  }
  return (
    <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

function formatRelative(iso: string): string {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return '1 day ago'
  return `${diffDays} days ago`
}

export default function SalesPartnerLeadsClient() {
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [inviteFormId, setInviteFormId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [actingId, setActingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  async function loadLeads() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/sales-partner-leads')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setLeads(data.leads ?? [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLeads()
  }, [])

  async function handleMarkContacted(id: string) {
    setActingId(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/sales-partner-leads/${id}/contact`, { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      await loadLeads()
    } catch {
      setRowError({ id, message: "Couldn't update this lead. Try again." })
    } finally {
      setActingId(null)
    }
  }

  async function handleDecline(id: string) {
    setActingId(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/sales-partner-leads/${id}/decline`, { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      await loadLeads()
    } catch {
      setRowError({ id, message: "Couldn't update this lead. Try again." })
    } finally {
      setActingId(null)
    }
  }

  async function handleGenerateInvite(lead: LeadRow) {
    setGenerating(true)
    setGenerateError(null)
    try {
      const res = await fetch('/api/admin/partner-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: `${lead.company_name} (${lead.name})`,
          target_account_kind: 'channel_partner',
          source_lead_id: lead.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setGenerateError(data?.error ?? "Couldn't generate this invite. Try again.")
        return
      }
      setRevealedUrl(data.acceptUrl)
    } catch {
      setGenerateError("Couldn't generate this invite. Try again.")
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy() {
    if (!revealedUrl) return
    try {
      await navigator.clipboard.writeText(revealedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API failure degrades gracefully — the input remains selectable by hand.
    }
  }

  function handleInviteDone() {
    setRevealedUrl(null)
    setCopied(false)
    setInviteFormId(null)
    void loadLeads()
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
          <h1 className="text-white text-2xl font-bold">Sales-partner leads</h1>
        </div>
        <p className="text-[#94A3B8] text-sm">Inquiries submitted through the public /partner-inquiry form.</p>
      </div>

      <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6">
        {loading && <p className="text-[#94A3B8] text-sm py-4">Loading leads…</p>}
        {!loading && loadError && <p className="text-[#EF4444] text-sm py-4">Couldn&apos;t load leads. Try refreshing.</p>}
        {!loading && !loadError && leads.length === 0 && (
          <p className="text-[#475569] text-sm py-4">No inquiries submitted yet.</p>
        )}

        {!loading && !loadError && leads.length > 0 && (
          <div className="space-y-3">
            {leads.map((lead) => {
              const expanded = expandedId === lead.id
              const showInviteForm = inviteFormId === lead.id
              return (
                <div key={lead.id} className="px-3 py-3 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]">
                  <button
                    onClick={() => setExpandedId(expanded ? null : lead.id)}
                    className="w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-left"
                  >
                    <span className="text-white text-sm font-medium min-w-0 truncate sm:w-40">{lead.name}</span>
                    <span className="text-[#94A3B8] text-sm min-w-0 truncate sm:w-40">{lead.company_name}</span>
                    <span className="text-[#94A3B8] text-sm min-w-0 truncate flex-1">{lead.email}</span>
                    <StatusBadge status={lead.status} />
                    {expanded ? (
                      <ChevronUp className="w-4 h-4 text-[#475569] shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[#475569] shrink-0" />
                    )}
                  </button>

                  {expanded && (
                    <div className="mt-3 pt-3 border-t border-[#1A1A1A] text-xs text-[#94A3B8] space-y-1">
                      <p>Phone: {lead.phone ?? '—'}</p>
                      <p>Message: {lead.message ?? '—'}</p>
                      <p className="text-[#475569]">
                        Submitted {formatRelative(lead.created_at)}
                        {lead.contacted_at && <> · Contacted {formatRelative(lead.contacted_at)}</>}
                      </p>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {lead.status === 'new' && (
                      <button
                        onClick={() => handleMarkContacted(lead.id)}
                        disabled={actingId === lead.id}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#7C3AED] transition-colors disabled:opacity-50"
                      >
                        {actingId === lead.id && <Loader2 className="w-3 h-3 animate-spin" />}
                        Mark contacted
                      </button>
                    )}
                    {(lead.status === 'new' || lead.status === 'contacted') && (
                      <>
                        <button
                          onClick={() => setInviteFormId(showInviteForm ? null : lead.id)}
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors"
                        >
                          Invite
                        </button>
                        <button
                          onClick={() => handleDecline(lead.id)}
                          disabled={actingId === lead.id}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-[#EF4444] hover:border-[#EF4444] transition-colors disabled:opacity-50"
                        >
                          {actingId === lead.id && <Loader2 className="w-3 h-3 animate-spin" />}
                          Decline
                        </button>
                      </>
                    )}
                  </div>

                  {rowError?.id === lead.id && <p className="text-[#EF4444] text-xs mt-2">{rowError.message}</p>}

                  {showInviteForm && !revealedUrl && (
                    <div className="mt-3 bg-[#111111] border border-[#222222] rounded-lg p-4">
                      <p className="text-white text-sm mb-3">
                        Invite {lead.name} ({lead.company_name}) as a sales-partner
                      </p>
                      {generateError && <p className="text-[#EF4444] text-xs mb-3">{generateError}</p>}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleGenerateInvite(lead)}
                          disabled={generating}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-50"
                        >
                          {generating && <Loader2 className="w-3 h-3 animate-spin" />}
                          Generate invite link
                        </button>
                        <button
                          onClick={() => setInviteFormId(null)}
                          className="text-xs text-[#475569] hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {showInviteForm && revealedUrl && (
                    <div className="mt-3 bg-[#111111] border border-[#222222] rounded-lg p-4">
                      <label className="block text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-1.5">
                        Invite link (copy and share this yourself — it will not be shown again)
                      </label>
                      <div className="flex items-center gap-2 mb-3">
                        <input
                          type="text"
                          readOnly
                          value={revealedUrl}
                          className="flex-1 min-w-0 bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-xs text-white font-mono overflow-x-auto"
                        />
                        <button
                          onClick={handleCopy}
                          className="text-xs font-semibold px-3 py-2 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#7C3AED] transition-colors whitespace-nowrap"
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <button
                        onClick={handleInviteDone}
                        className="text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
