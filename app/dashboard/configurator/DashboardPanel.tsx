'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { Card, BILLING_BANNER_COPY, type BillingHealth } from './_shared'
import {
  VISIBLE_SECTIONS,
  GO_LIVE_REQUIRED_STEPS,
  type ConfiguratorStatus,
  type ConfiguratorSection,
} from '@/lib/partner/configurator-sections'
import { REQUIRED_LABELS } from './GoLivePanel'
import type { PanelSection } from './ConfiguratorSurface'

/**
 * B2B-24 — Dashboard / Overview panel. The new default landing destination
 * for the Configurator (§4.6): a read-only, four-area overview answering
 * "am I live / what's left / what's my balance / where do I go" without a
 * single click. Adds no configuration capability and duplicates no existing
 * screen's data logic — every value here is either a prop already threaded
 * from `page.tsx`/`ConfiguratorSurface` or a same-tab `?section=` navigation
 * (Requirement Doc §6, §10).
 *
 * Styling: Tailwind utility classes only (AC #16 — zero inline-style
 * objects in this file); each area is its own `Card` from `_shared.tsx`.
 */

// The confirmed Go-Live required set, read from the single source of truth
// B2B-23 established (`lib/partner/wizard.ts`'s `GO_LIVE_REQUIRED_STEPS`) —
// never a second hardcoded literal here, so this panel can never visibly
// disagree with the Go Live panel/nav row about what's required (Known
// Constraint 1). `WizardStep` and `ConfiguratorSection` are the same literal
// union under different names, so this assignment is structurally sound.
const REQUIRED: ConfiguratorSection[] = GO_LIVE_REQUIRED_STEPS

const SECTION_LABEL: Record<ConfiguratorSection, string> = {
  questionnaire: 'Questionnaire',
  topics: 'Topics',
  content: 'Content',
  visualization: 'Visualization',
  domain: 'Domain',
  integration: 'Integration',
  payment: 'Payment',
}

export default function DashboardPanel({
  status,
  isLive,
  onboardingCompletedAt,
  billingHealth,
  activePartnerAccountId,
  onSelect,
}: {
  status: ConfiguratorStatus | null
  isLive: boolean
  onboardingCompletedAt: string | null
  billingHealth: BillingHealth
  activePartnerAccountId: string
  onSelect: (key: PanelSection) => void
}) {
  return (
    <>
      <h1 className="mb-4 text-lg font-bold text-white">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <SetupArea status={status} isLive={isLive} onSelect={onSelect} />
        <LiveStatusArea status={status} isLive={isLive} onboardingCompletedAt={onboardingCompletedAt} onSelect={onSelect} />
        <WalletArea billingHealth={billingHealth} onSelect={onSelect} />
        <QuickNavArea status={status} activePartnerAccountId={activePartnerAccountId} onSelect={onSelect} />
      </div>
    </>
  )
}

/** Area 1 — setup completion glimpse (§4.2, §6.1). */
function SetupArea({
  status,
  isLive,
  onSelect,
}: {
  status: ConfiguratorStatus | null
  isLive: boolean
  onSelect: (key: PanelSection) => void
}) {
  // §8 — while status is still loading (null), render nothing rather than
  // guessing; a brief empty-to-populated flash on first load, consistent
  // with the nav's completion dots.
  if (status === null) {
    return (
      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#475569]">Setup</h2>
      </Card>
    )
  }

  const incompleteRequired = REQUIRED_LABELS.filter((r) => !status[r.key])
  const optional = VISIBLE_SECTIONS.filter((k) => !REQUIRED.includes(k) && !status[k])

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#475569]">Setup</h2>
      {incompleteRequired.length === 0 ? (
        <>
          <p className="text-sm font-semibold text-[#10B981]">
            ✓ {isLive ? 'Setup complete' : 'Setup complete — ready to go live'}
          </p>
          {optional.length > 0 && (
            <p className="mt-2 text-xs text-[#475569]">
              {optional.map((k) => `Optional: ${SECTION_LABEL[k]} not yet configured`).join(' · ')}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mb-2 text-sm text-white">
            {incompleteRequired.length} step{incompleteRequired.length === 1 ? '' : 's'} left before you can go live
          </p>
          <ul className="space-y-2">
            {REQUIRED_LABELS.map((r) => {
              const done = status[r.key] === true
              // The first incomplete item in fixed order gets the primary
              // CTA; the rest are listed but not separately buttoned, to
              // avoid two competing primary CTAs (§4.2).
              const isFirstIncomplete = !done && incompleteRequired[0]?.key === r.key
              return (
                <li key={r.key} className="flex items-start justify-between gap-3 text-sm">
                  <span className="flex items-start gap-2">
                    <span className={done ? 'text-[#10B981]' : 'text-[#EF4444]'}>{done ? '✓' : '✕'}</span>
                    <span className="text-white">
                      {r.label}
                      {!done && <span className="text-[#94A3B8]"> — {r.requirement}</span>}
                    </span>
                  </span>
                  {isFirstIncomplete && (
                    <button
                      type="button"
                      onClick={() => onSelect(r.key)}
                      className="shrink-0 text-xs font-semibold text-[#7C3AED] transition-colors hover:text-[#A855F7]"
                    >
                      Finish →
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {optional.length > 0 && (
            <p className="mt-3 text-xs text-[#475569]">
              {optional.map((k) => `Optional: ${SECTION_LABEL[k]} not yet configured`).join(' · ')}
            </p>
          )}
        </>
      )}
    </Card>
  )
}

/** Area 2 — live status (§4.2, §6.2). */
function LiveStatusArea({
  status,
  isLive,
  onboardingCompletedAt,
  onSelect,
}: {
  status: ConfiguratorStatus | null
  isLive: boolean
  onboardingCompletedAt: string | null
  onSelect: (key: PanelSection) => void
}) {
  const requiredReady = status !== null && REQUIRED.every((k) => status[k])

  // §8 — defensive: an unparseable timestamp falls back to a plain "Live"
  // with no date clause, rather than crashing or showing "Invalid Date".
  let liveSinceLabel: string | null = null
  if (isLive && onboardingCompletedAt) {
    const parsed = new Date(onboardingCompletedAt)
    if (!Number.isNaN(parsed.getTime())) {
      liveSinceLabel = format(parsed, 'MMM d, yyyy')
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#475569]">Live status</h2>
      {isLive ? (
        <p className="flex items-center gap-2 text-sm text-white">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#10B981]" aria-hidden />
          {liveSinceLabel ? `Live since ${liveSinceLabel}` : 'Live'}
        </p>
      ) : (
        <>
          <p className="mb-2 flex items-center gap-2 text-sm text-[#475569]">
            <span className="h-2 w-2 shrink-0 rounded-full border border-[#475569]" aria-hidden />
            Not live yet
          </p>
          {status !== null && (
            requiredReady ? (
              <>
                <p className="mb-2 text-xs text-[#94A3B8]">You&apos;re ready — go live when you want.</p>
                <button
                  type="button"
                  onClick={() => onSelect('go_live')}
                  className="text-xs font-semibold text-[#7C3AED] transition-colors hover:text-[#A855F7]"
                >
                  Go live →
                </button>
              </>
            ) : (
              <p className="text-xs text-[#94A3B8]">Finish required setup to go live.</p>
            )
          )}
        </>
      )}
    </Card>
  )
}

/** Area 3 — wallet / billing snapshot (§4.2, §6.3). */
function WalletArea({
  billingHealth,
  onSelect,
}: {
  billingHealth: BillingHealth
  onSelect: (key: PanelSection) => void
}) {
  const warningCopy = billingHealth.state === 'healthy' ? null : BILLING_BANNER_COPY[billingHealth.state]

  let nextBillingLabel: string | null = null
  if (billingHealth.next_billing_date) {
    const parsed = new Date(billingHealth.next_billing_date)
    if (!Number.isNaN(parsed.getTime())) {
      nextBillingLabel = format(parsed, 'MMM d, yyyy')
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#475569]">Wallet</h2>
      {warningCopy && (
        <p className="mb-2 text-xs text-[#F59E0B]">
          <span aria-hidden className="mr-1">⚠</span>
          {warningCopy.message}
        </p>
      )}
      {billingHealth.balance_usd === null ? (
        // §6.3, §9 — a wallet is only lazily created on first credit/decrement;
        // this is a distinct state from a real $0.00 balance.
        <>
          <p className="mb-1 text-sm font-semibold text-white">No wallet yet</p>
          <p className="mb-3 text-xs text-[#94A3B8]">Add a funding method to get started.</p>
          <button
            type="button"
            onClick={() => onSelect('payment')}
            className="text-xs font-semibold text-[#7C3AED] transition-colors hover:text-[#A855F7]"
          >
            Set up payment →
          </button>
        </>
      ) : (
        <>
          <p className="mb-1 text-sm font-semibold text-white">${billingHealth.balance_usd.toFixed(2)} available</p>
          {nextBillingLabel && <p className="mb-3 text-xs text-[#94A3B8]">Next billing {nextBillingLabel}</p>}
          <button
            type="button"
            onClick={() => onSelect('payment')}
            className="text-xs font-semibold text-[#7C3AED] transition-colors hover:text-[#A855F7]"
          >
            Manage billing →
          </button>
        </>
      )}
    </Card>
  )
}

/** Area 4 — quick-nav tiles (§4.2, §6.4). A compact list of link-rows, not a
 * 3-column icon-in-a-circle grid (explicitly prohibited as an AI-slop
 * pattern). */
function QuickNavArea({
  status,
  activePartnerAccountId,
  onSelect,
}: {
  status: ConfiguratorStatus | null
  activePartnerAccountId: string
  onSelect: (key: PanelSection) => void
}) {
  const incomplete = status ? VISIBLE_SECTIONS.filter((k) => !status[k]) : []

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#475569]">Quick links</h2>
      <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
        <QuickLink href={`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`}>Configurator →</QuickLink>
        <QuickLink href={`/dashboard/configurator/api?partner_account_id=${activePartnerAccountId}`}>API →</QuickLink>
        <QuickLink href={`/dashboard/configurator/docs?partner_account_id=${activePartnerAccountId}`}>Docs →</QuickLink>
      </div>
      {incomplete.length > 0 && (
        <>
          <div className="my-3 border-t border-[#222222]" />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {incomplete.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                className="truncate rounded px-2 py-1.5 text-left text-sm text-[#94A3B8] transition-colors hover:bg-[#1A1A1A] hover:text-white"
              >
                Finish {SECTION_LABEL[key]} →
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

function QuickLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="truncate rounded px-2 py-1.5 text-sm text-[#94A3B8] transition-colors hover:bg-[#1A1A1A] hover:text-white"
    >
      {children}
    </Link>
  )
}
