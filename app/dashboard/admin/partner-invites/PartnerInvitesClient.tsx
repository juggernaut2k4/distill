'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Link2, Loader2 } from 'lucide-react'
import Link from 'next/link'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §4) — super-admin-only
 * "Partner invites" page: generate/list/revoke single-use direct-partner
 * invite links. Mirrors `TeamClient.tsx`'s generate/list/revoke interaction
 * pattern (no confirm dialogs, inline spinners, no toast system) — a
 * different component because the data shape is different (no partner-
 * account tagging, no email recipient at all), the *pattern* is reused, not
 * the code.
 */

interface InviteRow {
  id: string
  label: string | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invite_token_expires_at: string
  created_at: string
  accepted_at: string | null
  created_by_email: string
}

function StatusBadge({ status }: { status: InviteRow['status'] }) {
  const styles: Record<InviteRow['status'], string> = {
    pending: 'bg-[#F59E0B]/20 text-[#F59E0B]',
    accepted: 'bg-[#10B981]/20 text-[#10B981]',
    expired: 'bg-[#475569]/20 text-[#94A3B8]',
    revoked: 'bg-[#475569]/20 text-[#94A3B8]',
  }
  return (
    <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${styles[status]}`}>
      {status}
    </span>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return '1 day ago'
  return `${diffDays} days ago`
}

export default function PartnerInvitesClient() {
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const [revealedUrl, setRevealedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  async function loadInvites() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/partner-invites')
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setInvites(data.invites ?? [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInvites()
  }, [])

  async function handleGenerate() {
    setGenerating(true)
    setGenerateError(null)
    try {
      const res = await fetch('/api/admin/partner-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setGenerateError(data?.error ?? "Couldn't generate this invite. Try again.")
        return
      }
      setRevealedUrl(data.acceptUrl)
      setLabel('')
      setFormOpen(false)
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
      // Clipboard API failure degrades gracefully — the input remains
      // selectable/copyable by hand regardless (§9 Edge Case 9).
    }
  }

  function handleDone() {
    setRevealedUrl(null)
    setCopied(false)
    void loadInvites()
  }

  async function handleRevoke(id: string) {
    setRevokingId(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/admin/partner-invites/${id}/revoke`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setRowError({ id, message: data?.error ?? 'This invite is no longer pending.' })
        return
      }
      await loadInvites()
    } catch {
      setRowError({ id, message: "Couldn't revoke this invite. Try again." })
    } finally {
      setRevokingId(null)
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
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <div className="flex items-center gap-3">
            <Link2 className="w-6 h-6 text-[#7C3AED]" />
            <h1 className="text-white text-2xl font-bold">Partner invites</h1>
          </div>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors"
          >
            + Generate invite
          </button>
        </div>
        <p className="text-[#94A3B8] text-sm">
          Single-use links for onboarding a new direct partner. Each link works once.
        </p>
      </div>

      {formOpen && !revealedUrl && (
        <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white text-sm font-semibold">Generate invite</h3>
            <button onClick={() => setFormOpen(false)} className="text-[#475569] hover:text-white text-xs">
              Cancel
            </button>
          </div>

          <label className="block text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-1.5">
            Label (optional, for your own reference — never shown to the invitee)
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Pluralsight — Jan outreach"
            maxLength={200}
            className="w-full bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED] mb-4"
          />

          {generateError && <p className="text-[#EF4444] text-xs mb-3">{generateError}</p>}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Generate
          </button>
        </div>
      )}

      {revealedUrl && (
        <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6 mb-6">
          <label className="block text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-1.5">
            Invite link (copy and share this yourself — it will not be shown again)
          </label>
          <div className="flex items-center gap-2 mb-4">
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
            onClick={handleDone}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors"
          >
            Done
          </button>
        </div>
      )}

      <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6">
        {loading && <p className="text-[#94A3B8] text-sm py-4">Loading invites…</p>}
        {!loading && loadError && (
          <p className="text-[#EF4444] text-sm py-4">Couldn&apos;t load invites. Try refreshing.</p>
        )}
        {!loading && !loadError && invites.length === 0 && (
          <p className="text-[#475569] text-sm py-4">No invite links generated yet.</p>
        )}

        {!loading && !loadError && invites.length > 0 && (
          <div className="space-y-3">
            {invites.map((row) => (
              <div key={row.id} className="px-3 py-3 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                  <span className="text-white text-sm flex-1 min-w-0 truncate">{row.label ?? '—'}</span>
                  <StatusBadge status={row.status} />
                </div>
                <div className="text-[#475569] text-xs mb-2">
                  Generated {formatRelative(row.created_at)} by {row.created_by_email}
                  {row.accepted_at && <> · Accepted {formatRelative(row.accepted_at)}</>}
                </div>
                {row.status === 'pending' && (
                  <button
                    onClick={() => handleRevoke(row.id)}
                    disabled={revokingId === row.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#333333] text-[#94A3B8] hover:text-[#EF4444] hover:border-[#EF4444] transition-colors disabled:opacity-50"
                  >
                    {revokingId === row.id && <Loader2 className="w-3 h-3 animate-spin" />}
                    Revoke
                  </button>
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
