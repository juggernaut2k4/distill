'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import type { ConfiguratorStatus, ConfiguratorSection } from '@/lib/partner/configurator-status'
import { ConfiguratorNavShell, type BillingHealth } from './_shared'
import QuestionnaireBuilderClient from './questionnaire/QuestionnaireBuilderClient'
import TopicsConfigClient from './topics/TopicsConfigClient'
import ContentConfigClient from './content/ContentConfigClient'
import VisualizationClient from './visualization/VisualizationClient'
import DomainConfigClient from './domain/DomainConfigClient'
import IntegrationClient from './integration/IntegrationClient'
import PaymentConfigClient from './PaymentConfigClient'
import GoLivePanel from './GoLivePanel'

/**
 * B2B-20 — the unified Configurator surface. A persistent, responsive left-nav
 * + panel that replaces BOTH the forced-linear wizard and the post-go-live
 * card-grid Home. Used identically for first-run setup and ongoing editing.
 *
 * Styling: Tailwind utility classes with the existing `COLORS` hexes as
 * arbitrary values (`bg-[#080808]` etc.) — the project's declared standard and
 * the established B2B-03 pattern. This file (and any co-located nav/drawer
 * subcomponents) contains ZERO inline-style objects (AC #16); inline
 * styles cannot express the media queries this responsive surface requires,
 * which is exactly the bug B2B-20 fixes. Reused `embedded` section internals,
 * `PaymentConfigClient`, and `GoLivePanel` keep their own inline styles (out
 * of grep scope per §8).
 *
 * Motion: Framer Motion for section-switch + drawer, with `prefers-reduced-
 * motion` fallbacks (§12). No new dependency.
 */

type PanelSection = ConfiguratorSection | 'go_live'

interface NavItemDef {
  key: ConfiguratorSection
  label: string
}

interface NavGroupDef {
  heading: string
  items: NavItemDef[]
}

const NAV_GROUPS: NavGroupDef[] = [
  {
    heading: 'Learning experience',
    items: [
      { key: 'questionnaire', label: 'Questionnaire' },
      { key: 'topics', label: 'Topics' },
      { key: 'content', label: 'Content' },
      { key: 'visualization', label: 'Visualization' },
    ],
  },
  {
    heading: 'Delivery & integration',
    items: [
      { key: 'domain', label: 'Domain' },
      { key: 'integration', label: 'Integration' },
    ],
  },
  {
    heading: 'Billing',
    items: [{ key: 'payment', label: 'Payment' }],
  },
]

const SECTION_LABEL: Record<PanelSection, string> = {
  questionnaire: 'Questionnaire',
  topics: 'Topics',
  content: 'Content',
  visualization: 'Visualization',
  domain: 'Domain',
  integration: 'Integration',
  payment: 'Payment',
  go_live: 'Go Live',
}

// Canonical order for the first-incomplete default (§3).
const CANONICAL_ORDER: ConfiguratorSection[] = [
  'questionnaire',
  'topics',
  'content',
  'visualization',
  'domain',
  'integration',
  'payment',
]

export default function ConfiguratorSurface({
  accounts,
  activePartnerAccountId,
  billingHealth,
  isLive,
  initialSection,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  billingHealth: BillingHealth
  isLive: boolean
  initialSection: PanelSection
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const reduce = useReducedMotion()

  const [activeSection, setActiveSection] = useState<PanelSection>(initialSection)
  const [status, setStatus] = useState<ConfiguratorStatus | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const refetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/configurator/status?partner_account_id=${activePartnerAccountId}`)
      if (!res.ok) throw new Error('status load failed')
      const data: ConfiguratorStatus = await res.json()
      setStatus(data)
    } catch {
      // §8 — a failed status fetch must never block configuration. Default all
      // dots to incomplete (safe default); a silent retry happens on next
      // section change (the effect below re-runs).
      setStatus({
        questionnaire: false,
        topics: false,
        content: false,
        visualization: false,
        domain: false,
        integration: false,
        payment: false,
      })
    }
  }, [activePartnerAccountId])

  // Fetch on mount, on account switch, and on each section change (§8 silent
  // retry + AC #7 "Integration flips to complete after generating a client").
  useEffect(() => {
    refetchStatus()
  }, [refetchStatus, activeSection])

  const selectSection = useCallback(
    (key: PanelSection) => {
      setActiveSection(key)
      setDrawerOpen(false)
      const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []))
      params.set('section', key)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const requiredReady = status !== null && status.questionnaire && status.payment
  const firstIncomplete = status
    ? CANONICAL_ORDER.find((k) => !status[k]) ?? null
    : null

  const panel = renderPanel({ activeSection, accounts, activePartnerAccountId, isLive, status, refetchStatus })

  const nav = (
    <ConfiguratorNav
      groups={NAV_GROUPS}
      status={status}
      activeSection={activeSection}
      isLive={isLive}
      requiredReady={requiredReady}
      firstIncompleteLabel={
        !isLive ? SECTION_LABEL[(firstIncomplete ?? 'questionnaire') as PanelSection] : null
      }
      onSelect={selectSection}
    />
  )

  return (
    <ConfiguratorNavShell
      accounts={accounts}
      activePartnerAccountId={activePartnerAccountId}
      active="configurator"
      billingHealth={billingHealth}
    >
      {/* Cancel the untouchable NavShell's fixed 32px content padding so the
          surface uses the full content column, then own responsive padding. */}
      <div className="-mx-8 -mb-8">
        {/* Mobile / tablet hamburger header row (<lg). */}
        <div className="flex items-center justify-between gap-3 border-b border-[#222222] px-4 py-3 md:px-6 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-[#333333] bg-[#111111] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1A1A1A]"
            aria-label="Open sections menu"
            aria-expanded={drawerOpen}
          >
            <span aria-hidden>☰</span> Sections
          </button>
          <span className="truncate text-sm text-[#94A3B8]">{SECTION_LABEL[activeSection]}</span>
        </div>

        <div className="lg:flex">
          {/* Persistent desktop sidebar (≥lg). */}
          <aside className="hidden shrink-0 border-r border-[#222222] lg:flex lg:w-[260px] lg:flex-col">
            {nav}
          </aside>

          {/* Main panel. min-w-0 + overflow-x-auto contain wide inline-styled
              section internals so the page body never scrolls horizontally. */}
          <main className="min-w-0 flex-1 overflow-x-auto p-4 md:p-6 lg:p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {panel}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      {/* Off-canvas drawer (<lg). */}
      <AnimatePresence>
        {drawerOpen && (
          <div className="lg:hidden">
            <motion.div
              className="fixed inset-0 z-40 bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 flex w-[80vw] max-w-[320px] flex-col overflow-y-auto border-r border-[#222222] bg-[#111111] md:w-[280px]"
              initial={reduce ? { opacity: 0 } : { x: '-100%' }}
              animate={reduce ? { opacity: 1 } : { x: 0 }}
              exit={reduce ? { opacity: 0 } : { x: '-100%' }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              role="dialog"
              aria-label="Sections"
            >
              <div className="flex items-center justify-between border-b border-[#222222] px-3 py-3">
                <span className="text-sm font-semibold text-white">Sections</span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded px-2 py-1 text-[#94A3B8] transition-colors hover:text-white"
                  aria-label="Close sections menu"
                >
                  ✕
                </button>
              </div>
              {nav}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </ConfiguratorNavShell>
  )
}

function renderPanel({
  activeSection,
  accounts,
  activePartnerAccountId,
  isLive,
  status,
  refetchStatus,
}: {
  activeSection: PanelSection
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  isLive: boolean
  status: ConfiguratorStatus | null
  refetchStatus: () => void
}) {
  switch (activeSection) {
    case 'questionnaire':
      return <QuestionnaireBuilderClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
    case 'topics':
      return <TopicsConfigClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
    case 'content':
      return <ContentConfigClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
    case 'visualization':
      return <VisualizationClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
    case 'domain':
      return <DomainConfigClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
    case 'integration':
      return <IntegrationClient accounts={accounts} activePartnerAccountId={activePartnerAccountId} embedded />
    case 'payment':
      return (
        <PaymentConfigClient
          accounts={accounts}
          activePartnerAccountId={activePartnerAccountId}
          embedded
          onFunded={refetchStatus}
        />
      )
    case 'go_live':
      return (
        <GoLivePanel
          partnerAccountId={activePartnerAccountId}
          isLive={isLive}
          status={status}
          onWentLive={refetchStatus}
        />
      )
  }
}

/** Left-nav pane contents — shared by the desktop sidebar and the mobile drawer. */
function ConfiguratorNav({
  groups,
  status,
  activeSection,
  isLive,
  requiredReady,
  firstIncompleteLabel,
  onSelect,
}: {
  groups: NavGroupDef[]
  status: ConfiguratorStatus | null
  activeSection: PanelSection
  isLive: boolean
  requiredReady: boolean
  firstIncompleteLabel: string | null
  onSelect: (key: PanelSection) => void
}) {
  return (
    <nav className="flex flex-1 flex-col gap-1 py-3">
      {firstIncompleteLabel && (
        <p className="px-4 pb-2 text-xs text-[#94A3B8]">
          Start here → <span className="font-semibold text-white">{firstIncompleteLabel}</span>
        </p>
      )}

      {groups.map((group) => (
        <div key={group.heading} className="mb-2">
          <p className="mb-1 mt-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-[#475569]">
            {group.heading}
          </p>
          {group.items.map((item) => (
            <NavRow
              key={item.key}
              label={item.label}
              complete={status?.[item.key] === true}
              active={activeSection === item.key}
              onClick={() => onSelect(item.key)}
            />
          ))}
        </div>
      ))}

      {/* Pinned Go Live action — separated, pushed to the bottom on desktop. */}
      <div className="mt-auto border-t border-[#222222] pt-2">
        <GoLiveRow
          active={activeSection === 'go_live'}
          isLive={isLive}
          requiredReady={requiredReady}
          onClick={() => onSelect('go_live')}
        />
      </div>
    </nav>
  )
}

function NavRow({
  label,
  complete,
  active,
  onClick,
}: {
  label: string
  complete: boolean
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={
        'flex w-full items-center gap-3 border-l-[3px] px-4 py-2 text-left text-sm transition-colors ' +
        (active
          ? 'border-[#7C3AED] bg-[#7C3AED]/10 text-white'
          : 'border-transparent text-[#94A3B8] hover:bg-[#1A1A1A] hover:text-white')
      }
    >
      <CompletionDot complete={complete} />
      <span className="truncate">{label}</span>
    </button>
  )
}

function CompletionDot({ complete }: { complete: boolean }) {
  return complete ? (
    <span className="h-2 w-2 shrink-0 rounded-full bg-[#10B981]" aria-label="complete" role="img" />
  ) : (
    <span className="h-2 w-2 shrink-0 rounded-full border border-[#475569]" aria-label="incomplete" role="img" />
  )
}

function GoLiveRow({
  active,
  isLive,
  requiredReady,
  onClick,
}: {
  active: boolean
  isLive: boolean
  requiredReady: boolean
  onClick: () => void
}) {
  let statusNode: React.ReactNode
  if (isLive) {
    statusNode = (
      <span className="flex items-center gap-1.5 text-xs text-[#10B981]">
        <span className="h-2 w-2 rounded-full bg-[#10B981]" aria-hidden /> Live
      </span>
    )
  } else if (requiredReady) {
    statusNode = <span className="text-xs text-[#10B981]">Ready</span>
  } else {
    statusNode = <span className="text-xs text-[#475569]">Setup incomplete</span>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={
        'flex w-full items-center justify-between gap-2 border-l-[3px] px-4 py-2.5 text-left text-sm font-semibold transition-colors ' +
        (active
          ? 'border-[#7C3AED] bg-[#7C3AED]/10 text-white'
          : 'border-transparent text-white hover:bg-[#1A1A1A]')
      }
    >
      <span>{isLive ? 'Live' : 'Go Live'}</span>
      {statusNode}
    </button>
  )
}
