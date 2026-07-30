'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { ConfiguratorNavShell, Card, COLORS, type BillingHealth } from '../_shared'
import {
  IN_SCOPE_EVENT_TYPES,
  EVENT_TYPE_LABEL,
  DELIVERY_STATUS_LABEL,
  formatAmount,
  type InScopeEventType,
  type ResolvedDeliveryStatus,
} from '@/lib/partner/usage-log'

/**
 * B2B-57b Requirement Doc §4/§5 — the partner-facing Usage log screen: a reverse-chronological,
 * filterable, paginated table of the reseller's own `webhook_dispatch_log` rows. Mirrors
 * `KnownBugsClient.tsx`'s fetch/state pattern exactly (§6.5) — reuses the existing Configurator
 * dark-void/purple-accent visual language (`_shared.tsx`), no new colors, typography, or npm deps.
 */

const PAGE_SIZE = 25

interface UsageRow {
  id: string
  event_type: InScopeEventType
  clio_session_ref: string | null
  reference: string | null
  quantity: number | null
  unit: 'minutes' | 'calls' | null
  generation_type: string | null
  test_mode: boolean
  occurred_at: string
  delivery_status: ResolvedDeliveryStatus
  http_status_code: number | null
}

interface UsageLogResponse {
  rows: UsageRow[]
  has_more: boolean
  delivery_configured: boolean
}

const DELIVERY_STATUS_COLOR: Record<ResolvedDeliveryStatus, string> = {
  delivered: COLORS.green,
  pending: COLORS.cyan,
  retrying: COLORS.amber,
  failed: COLORS.red,
  not_configured: COLORS.textMuted,
}

const EVENT_TYPE_COLOR: Record<InScopeEventType, string> = {
  'usage.voice_minute': COLORS.cyan,
  'usage.llm_generation_call': COLORS.purple,
  'session.completed': COLORS.green,
  'session.insights_ready': COLORS.amber,
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}
    </span>
  )
}

function ModePill({ testMode }: { testMode: boolean }) {
  if (!testMode) {
    return <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.textPrimary, whiteSpace: 'nowrap' }}>Live</span>
  }
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: COLORS.amber,
        background: 'rgba(245, 158, 11, 0.12)',
        border: `1px solid ${COLORS.amber}`,
        borderRadius: 999,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      Test
    </span>
  )
}

export default function UsageLogClient({
  accounts,
  activePartnerAccountId,
  billingHealth,
  basePath,
  navLabel,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  billingHealth: BillingHealth
  basePath?: string
  navLabel?: string
}) {
  const effectiveBasePath = basePath ?? '/dashboard/configurator'

  const [filter, setFilter] = useState<'' | InScopeEventType>('')
  const [rows, setRows] = useState<UsageRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [deliveryConfigured, setDeliveryConfigured] = useState(true)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)

  const fetchPage = useCallback(
    async (eventTypeFilter: '' | InScopeEventType, offset: number): Promise<UsageLogResponse> => {
      const params = new URLSearchParams({
        partner_account_id: activePartnerAccountId,
        offset: String(offset),
        limit: String(PAGE_SIZE),
      })
      if (eventTypeFilter) params.set('event_type', eventTypeFilter)

      const res = await fetch(`/api/partner/dashboard/usage-log?${params.toString()}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    [activePartnerAccountId]
  )

  const loadFirstPage = useCallback(
    async (eventTypeFilter: '' | InScopeEventType) => {
      setLoading(true)
      setError(false)
      setLoadMoreError(false)
      try {
        const data = await fetchPage(eventTypeFilter, 0)
        setRows(data.rows ?? [])
        setHasMore(Boolean(data.has_more))
        setDeliveryConfigured(data.delivery_configured ?? true)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    },
    [fetchPage]
  )

  useEffect(() => {
    void loadFirstPage(filter)
    // Filter changes reset pagination to the first page of the filtered set (§7 AT).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, activePartnerAccountId])

  async function loadMore() {
    setLoadingMore(true)
    setLoadMoreError(false)
    try {
      const data = await fetchPage(filter, rows.length)
      setRows((prev) => [...prev, ...(data.rows ?? [])])
      setHasMore(Boolean(data.has_more))
      setDeliveryConfigured(data.delivery_configured ?? true)
    } catch {
      setLoadMoreError(true)
    } finally {
      setLoadingMore(false)
    }
  }

  // State B — zero rows exist at all for this account (the real, current, universal state for every
  // non-demo partner today). Only applies to the unfiltered view — a filtered-to-zero result is a
  // different, lighter-weight condition handled inline in the table body below.
  const isEmptyState = !loading && !error && filter === '' && rows.length === 0

  return (
    <ConfiguratorNavShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      active="usage"
      billingHealth={billingHealth}
      basePath={basePath}
      navLabel={navLabel}
    >
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Usage</h1>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: error || isEmptyState ? 20 : 8 }}>
        A record of every usage event Clio has recorded for your account, and its webhook delivery status.
      </p>

      {/* State E — initial fetch failed. No partial/broken table renders. */}
      {error && (
        <Card>
          <p style={{ fontSize: 13, color: COLORS.red, margin: 0 }}>Couldn&apos;t load your usage log right now. Try refreshing the page.</p>
        </Card>
      )}

      {/* State B — zero rows, no filter dropdown, no table (filtering an empty set is meaningless UI). */}
      {!error && isEmptyState && (
        <Card>
          <div style={{ textAlign: 'center', padding: '24px 12px' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 8px 0' }}>No usage events yet</h2>
            <p style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6, margin: '0 auto', maxWidth: 480 }}>
              Usage events appear here automatically as soon as Clio records billable activity for your account — for
              example, voice minutes from a live session. Nothing has been recorded yet.
            </p>
          </div>
        </Card>
      )}

      {/* State A / C / D — rows (or loading), filter, table, pagination. */}
      {!error && !isEmptyState && (
        <>
          {/* State C — rows exist but delivery isn't configured for this account yet. */}
          {!loading && !deliveryConfigured && rows.length > 0 && (
            <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 12 }}>
              Delivery isn&apos;t configured for your account yet — these events are recorded but not yet sent
              anywhere.{' '}
              <Link
                href={`${effectiveBasePath}/integration?partner_account_id=${activePartnerAccountId}`}
                style={{ color: COLORS.cyan, textDecoration: 'none' }}
              >
                Configure it on the Integration page →
              </Link>
            </p>
          )}

          <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 220px', minWidth: 180 }}>
              <label style={{ display: 'block', fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>Event type</label>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as '' | InScopeEventType)}
                style={{
                  display: 'block',
                  width: '100%',
                  background: COLORS.raised,
                  border: `1px solid ${COLORS.borderStrong}`,
                  borderRadius: 6,
                  padding: 8,
                  color: COLORS.textPrimary,
                  fontSize: 13,
                }}
              >
                <option value="">All event types</option>
                {IN_SCOPE_EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {EVENT_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Event', 'Reference', 'Amount', 'Mode', 'Occurred', 'Delivery'].map((label) => (
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
                {loading && (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px 12px', textAlign: 'center', color: COLORS.textSecondary, borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                      Loading…
                    </td>
                  </tr>
                )}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px 12px', textAlign: 'center', color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                      No usage events match this filter.
                    </td>
                  </tr>
                )}

                {!loading &&
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                        <Pill label={EVENT_TYPE_LABEL[row.event_type]} color={EVENT_TYPE_COLOR[row.event_type]} />
                      </td>
                      <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}`, color: COLORS.textPrimary }}>
                        {row.reference ? (
                          <div>
                            <div style={{ fontFamily: 'monospace' }}>{row.reference}</div>
                            {row.clio_session_ref && (
                              <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }} title={row.clio_session_ref}>
                                Clio ID: {row.clio_session_ref.slice(0, 8)}…
                              </div>
                            )}
                          </div>
                        ) : row.clio_session_ref ? (
                          <span style={{ fontFamily: 'monospace' }}>{row.clio_session_ref}</span>
                        ) : (
                          <span style={{ color: COLORS.textMuted }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}`, color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
                        {formatAmount(row.event_type, row.quantity, row.unit, row.generation_type)}
                      </td>
                      <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                        <ModePill testMode={row.test_mode} />
                      </td>
                      <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}`, color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
                        {formatDateTime(row.occurred_at)}
                      </td>
                      <td style={{ padding: '12px', borderBottom: `1px solid ${COLORS.borderSubtle}` }}>
                        <Pill label={DELIVERY_STATUS_LABEL[row.delivery_status]} color={DELIVERY_STATUS_COLOR[row.delivery_status]} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {!loading && hasMore && !loadMoreError && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  background: 'transparent',
                  color: COLORS.textPrimary,
                  border: `1px solid ${COLORS.borderStrong}`,
                  borderRadius: 8,
                  padding: '10px 20px',
                  fontSize: 13,
                  cursor: loadingMore ? 'not-allowed' : 'pointer',
                  opacity: loadingMore ? 0.5 : 1,
                }}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}

          {/* §8 — the button itself is replaced by this inline message on a "Load more" failure;
              already-loaded rows stay visible, and this does not escalate to the full State E Card
              since those rows are still valid. No custom retry mechanism, matching this codebase's
              existing minimal-error-UI convention (State E has none either). */}
          {!loading && loadMoreError && (
            <p style={{ fontSize: 13, color: COLORS.red, textAlign: 'center', marginTop: 20 }}>Couldn&apos;t load more — try again</p>
          )}
        </>
      )}
    </ConfiguratorNavShell>
  )
}
