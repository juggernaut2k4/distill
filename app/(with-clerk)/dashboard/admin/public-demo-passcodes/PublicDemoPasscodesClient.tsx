'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Ticket } from 'lucide-react'
import Link from 'next/link'

/**
 * DEMO-PASSCODE-01 (docs/specs/DEMO-PASSCODE-01-requirement-document.md §4.C) — super-admin-only
 * "Public demo passcodes" page. Modeled directly on WaitlistClient.tsx — flat list, no bells and
 * whistles, read-only (no delete action on either list — deleting a passcode or redemption record
 * would only remove Arun's own audit trail, explicitly out of scope, §10).
 */

interface PasscodeRow {
  id: string
  buyer_email: string
  purchased_at: string
  uses_remaining: number
  uses_total: number
}

interface RedemptionRow {
  id: string
  buyer_email: string
  redeemed_name: string
  slug: string
  redeemed_at: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function PublicDemoPasscodesClient() {
  const [passcodes, setPasscodes] = useState<PasscodeRow[]>([])
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setLoadError(false)
      try {
        const res = await fetch('/api/admin/public-demo-passcodes')
        if (!res.ok) throw new Error('failed')
        const data = await res.json()
        setPasscodes(data.passcodes ?? [])
        setRedemptions(data.redemptions ?? [])
      } catch {
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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
          <Ticket className="w-6 h-6 text-[#7C3AED]" />
          <h1 className="text-white text-2xl font-bold">Public demo passcodes</h1>
        </div>
        <p className="text-[#94A3B8] text-sm">Every $10 demo purchase and passcode redemption.</p>
      </div>

      <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6 mb-6">
        <h2 className="text-white text-lg font-semibold mb-4">Passcodes issued</h2>
        {loading && <p className="text-[#94A3B8] text-sm py-4">Loading…</p>}
        {!loading && loadError && <p className="text-[#EF4444] text-sm py-4">Couldn&apos;t load — try refreshing.</p>}
        {!loading && !loadError && passcodes.length === 0 && (
          <p className="text-[#475569] text-sm py-4">No demo passcodes purchased yet.</p>
        )}
        {!loading && !loadError && passcodes.length > 0 && (
          <div className="space-y-3">
            {passcodes.map((p) => (
              <div key={p.id} className="px-3 py-3 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <span className="text-white text-sm font-medium min-w-0 truncate flex-1">{p.buyer_email}</span>
                  <span className="text-[#475569] text-xs whitespace-nowrap">{formatDate(p.purchased_at)}</span>
                  <span className="text-[#94A3B8] text-xs whitespace-nowrap">
                    {p.uses_remaining} / {p.uses_total} uses left
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6">
        <h2 className="text-white text-lg font-semibold mb-4">Redemptions</h2>
        {loading && <p className="text-[#94A3B8] text-sm py-4">Loading…</p>}
        {!loading && loadError && <p className="text-[#EF4444] text-sm py-4">Couldn&apos;t load — try refreshing.</p>}
        {!loading && !loadError && redemptions.length === 0 && (
          <p className="text-[#475569] text-sm py-4">No redemptions yet.</p>
        )}
        {!loading && !loadError && redemptions.length > 0 && (
          <div className="space-y-3">
            {redemptions.map((r) => (
              <div key={r.id} className="px-3 py-3 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <span className="text-white text-sm font-medium min-w-0 truncate sm:w-48">
                    {r.redeemed_name} <span className="text-[#475569]">({r.buyer_email})</span>
                  </span>
                  <span className="text-[#94A3B8] text-sm min-w-0 truncate flex-1">{r.slug}</span>
                  <span className="text-[#475569] text-xs whitespace-nowrap">{formatDateTime(r.redeemed_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
