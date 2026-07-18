'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorNavShell, Card, COLORS, type BillingHealth } from '../_shared'
import { PARTNER_STATUS_LABEL, type PartnerBugStatus } from '@/lib/glitches/partner-status'

/**
 * B2B-22 Requirement Doc §4.A / §5 — the partner-facing Known Bugs screen: table + aggregate chart,
 * both scoped identically (§6.3's hybrid rule, enforced server-side by the API — this client trusts
 * the API's scoping entirely and does no additional filtering). Reuses the existing Configurator
 * dark-void/purple-accent visual language (`_shared.tsx`) — no new colors, typography, or npm deps.
 */

interface KnownBug {
  id: string
  status: PartnerBugStatus
  eta: string | null
  description: string
  visible_since: string | null
  comment_count: number
  can_comment: boolean
}

interface CommentAuthor {
  name: string
  email: string | null
}

interface Comment {
  id: string
  body: string
  created_at: string
  author: CommentAuthor
}

interface Summary {
  open: number
  in_progress: number
  closed: number
}

const STATUS_COLORS: Record<PartnerBugStatus, string> = {
  open: COLORS.amber,
  in_progress: COLORS.cyan,
  closed: COLORS.green,
}

function formatDate(iso: string | null): string {
  if (!iso) return 'TBD'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function StatusBadge({ status }: { status: PartnerBugStatus }) {
  const color = STATUS_COLORS[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {PARTNER_STATUS_LABEL[status]}
    </span>
  )
}

export default function KnownBugsClient({
  accounts,
  activePartnerAccountId,
  billingHealth,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  billingHealth: BillingHealth
}) {
  const [bugs, setBugs] = useState<KnownBug[]>([])
  const [bugsLoading, setBugsLoading] = useState(true)
  const [bugsError, setBugsError] = useState(false)

  const [summary, setSummary] = useState<Summary>({ open: 0, in_progress: 0, closed: 0 })
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(false)

  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadBugs = useCallback(async () => {
    setBugsLoading(true)
    setBugsError(false)
    try {
      const res = await fetch(`/api/partner/known-bugs?partner_account_id=${activePartnerAccountId}`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setBugs(data.bugs ?? [])
    } catch {
      setBugsError(true)
    } finally {
      setBugsLoading(false)
    }
  }, [activePartnerAccountId])

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    setSummaryError(false)
    try {
      const res = await fetch(`/api/partner/known-bugs/summary?partner_account_id=${activePartnerAccountId}`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setSummary({ open: data.open ?? 0, in_progress: data.in_progress ?? 0, closed: data.closed ?? 0 })
    } catch {
      setSummaryError(true)
    } finally {
      setSummaryLoading(false)
    }
  }, [activePartnerAccountId])

  useEffect(() => {
    void loadBugs()
    void loadSummary()
  }, [loadBugs, loadSummary])

  return (
    <ConfiguratorNavShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      active="known_bugs"
      billingHealth={billingHealth}
    >
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Known Bugs</h1>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 20 }}>
        Bugs Clio has identified and chosen to share with you — status and ETA, updated as we make progress.
      </p>

      {/* Aggregate chart — always rendered, even in the empty state (State P3). */}
      <Card style={{ marginBottom: 20 }}>
        {summaryError ? (
          <p style={{ fontSize: 13, color: COLORS.red }}>Couldn&apos;t load your bugs — try refreshing.</p>
        ) : (
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            {(['open', 'in_progress', 'closed'] as PartnerBugStatus[]).map((key) => (
              <div key={key}>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: COLORS.textSecondary, marginBottom: 4 }}>
                  {PARTNER_STATUS_LABEL[key]}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: STATUS_COLORS[key] }}>
                  {summaryLoading ? '—' : summary[key]}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Bug', 'Status', 'ETA', 'Since'].map((label) => (
                <th
                  key={label}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderBottom: `1px solid ${COLORS.borderSubtle}`,
                    color: COLORS.textSecondary,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bugsLoading && (
              <tr>
                <td colSpan={4} style={{ padding: '32px 12px', textAlign: 'center', color: COLORS.textSecondary, borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                  Loading…
                </td>
              </tr>
            )}

            {!bugsLoading && bugsError && (
              <tr>
                <td colSpan={4} style={{ padding: '32px 12px', textAlign: 'center', color: COLORS.red, borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                  Couldn&apos;t load your bugs — try refreshing.
                </td>
              </tr>
            )}

            {/* State P3 — empty. Table shows headers + a captioned placeholder row, never a raw blank void. */}
            {!bugsLoading && !bugsError && bugs.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '32px 12px', textAlign: 'center', color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                  Nothing to show yet.
                </td>
              </tr>
            )}

            {!bugsLoading &&
              !bugsError &&
              bugs.map((bug) => (
                <BugRow
                  key={bug.id}
                  bug={bug}
                  expanded={expandedId === bug.id}
                  onToggle={() => setExpandedId((current) => (current === bug.id ? null : bug.id))}
                  partnerAccountId={activePartnerAccountId}
                />
              ))}
          </tbody>
        </table>
      </div>
    </ConfiguratorNavShell>
  )
}

function BugRow({
  bug,
  expanded,
  onToggle,
  partnerAccountId,
}: {
  bug: KnownBug
  expanded: boolean
  onToggle: () => void
  partnerAccountId: string
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer' }}
      >
        <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}`, color: COLORS.textPrimary, maxWidth: 420 }}>
          <span style={{ marginRight: 8, color: COLORS.textMuted }}>{expanded ? '▾' : '▸'}</span>
          <span
            style={
              expanded
                ? undefined
                : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
            }
          >
            {bug.description}
          </span>
        </td>
        <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}`, whiteSpace: 'nowrap' }}>
          <StatusBadge status={bug.status} />
        </td>
        <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}`, color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
          {formatDate(bug.eta)}
        </td>
        <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}`, color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
          {formatDate(bug.visible_since)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} style={{ padding: 0, borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
            <BugDetail bug={bug} partnerAccountId={partnerAccountId} />
          </td>
        </tr>
      )}
    </>
  )
}

function BugDetail({ bug, partnerAccountId }: { bug: KnownBug; partnerAccountId: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/partner/known-bugs/${bug.id}/comments?partner_account_id=${partnerAccountId}`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setComments(data.comments ?? [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [bug.id, partnerAccountId])

  useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    const trimmed = draft.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setSubmitError(null)

    // State P6 — optimistic append, rolled back on failure.
    const optimisticId = `optimistic-${Date.now()}`
    const optimisticComment: Comment = {
      id: optimisticId,
      body: trimmed,
      created_at: new Date().toISOString(),
      author: { name: 'You', email: null },
    }
    setComments((prev) => [...prev, optimisticComment])
    setDraft('')

    try {
      const res = await fetch(`/api/partner/known-bugs/${bug.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: partnerAccountId, body: trimmed }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setComments((prev) => prev.map((c) => (c.id === optimisticId ? data.comment : c)))
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== optimisticId))
      setSubmitError("Couldn't post your comment — try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: '4px 12px 20px 32px', background: COLORS.raised }}>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, whiteSpace: 'pre-wrap', marginBottom: 16, maxWidth: 640 }}>
        {bug.description}
      </p>

      <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: COLORS.textMuted, marginBottom: 8 }}>
        Comments
      </h4>

      {loading && <p style={{ fontSize: 13, color: COLORS.textSecondary }}>Loading…</p>}
      {!loading && error && <p style={{ fontSize: 13, color: COLORS.red }}>Couldn&apos;t load comments.</p>}
      {!loading && !error && comments.length === 0 && (
        <p style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 12 }}>No comments yet.</p>
      )}
      {!loading && !error && comments.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.map((comment) => (
            <li key={comment.id}>
              <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 2 }}>
                {comment.author.name}
                {comment.author.email ? ` (${comment.author.email})` : ''} — {formatDateTime(comment.created_at)}
              </p>
              <p style={{ fontSize: 13, color: COLORS.textPrimary, whiteSpace: 'pre-wrap' }}>{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      {bug.can_comment ? (
        <div style={{ display: 'flex', gap: 8, maxWidth: 640 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={5000}
            placeholder="Add a comment or note more evidence…"
            style={{
              flex: 1,
              background: COLORS.bg,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              color: COLORS.textPrimary,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <button
            onClick={submit}
            disabled={submitting || !draft.trim()}
            style={{
              background: COLORS.purple,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting || !draft.trim() ? 'not-allowed' : 'pointer',
              opacity: submitting || !draft.trim() ? 0.4 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: COLORS.textMuted }}>This bug is closed and no longer accepting new comments.</p>
      )}

      {submitError && <p style={{ fontSize: 12, color: COLORS.red, marginTop: 8 }}>{submitError}</p>}
    </div>
  )
}
