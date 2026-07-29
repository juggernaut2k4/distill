'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import { COLORS, SHELL_CONTENT_STYLE } from './design-tokens'

/**
 * B2B-03 — Configurator shared UI (Requirement Doc Section 4.A). Internal
 * dark-admin design system, reused verbatim from the existing
 * `/dashboard/admin/templates` (RTV-04) convention per Section 4.A's own
 * design-system note: `bg-[#080808]` page, `bg-[#111111]` cards with
 * `border-[#222222]`, purple/cyan/amber accents.
 *
 * Every Configurator route call carries `partner_account_id` explicitly
 * (Section 9's "no implicit current-partner server-side state") — this
 * switcher writes the selection into the URL's query string, never a
 * server-side session.
 *
 * Hotfix (2026-07-20, live-tested by Arun): both `ConfiguratorShell` and
 * `ConfiguratorNavShell` gained a Clerk `<UserButton>` in the top bar — no
 * sign-out control existed anywhere in the app (grepped every dashboard
 * shell; zero `UserButton`/`SignOutButton` usage). Same fix applied to
 * `ChannelPartnerShell` (app/dashboard/channel-partner/_shared.tsx).
 */

// B2B-29 hotfix — COLORS and SHELL_CONTENT_STYLE now live in ./design-tokens
// (no 'use client' directive, zero dependencies) so Server Components can dot
// into them directly. Re-exported here so every existing
// `from '../configurator/_shared'` / `from './_shared'` import site keeps
// working unchanged.
export { COLORS, SHELL_CONTENT_STYLE }

export function ConfiguratorShell({
  accounts,
  activePartnerAccountId,
  title,
  backHref,
  children,
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string | null
  title: string
  backHref?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()

  function onSwitch(id: string) {
    router.push(`${pathname}?partner_account_id=${id}`)
  }

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ borderBottom: `1px solid ${COLORS.borderSubtle}`, padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {backHref && (
            <Link href={backHref} style={{ color: COLORS.textSecondary, fontSize: 13, textDecoration: 'none' }}>
              ←
            </Link>
          )}
          <span style={{ fontWeight: 700, fontSize: 14 }}>Clio Configure</span>
          <span style={{ color: COLORS.textMuted, fontSize: 13 }}>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {accounts.length > 1 ? (
            <select
              value={activePartnerAccountId ?? ''}
              onChange={(e) => onSwitch(e.target.value)}
              style={{ background: COLORS.surface, color: COLORS.textPrimary, border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : accounts.length === 1 ? (
            <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>{accounts[0].name}</span>
          ) : null}
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </div>
      <div style={SHELL_CONTENT_STYLE}>{children}</div>
    </div>
  )
}

/**
 * B2B-16 (Requirement Doc Section 4.2 / 4.5) — billing-health state for the
 * non-blocking banner. Computed server-side from `partner_wallets`
 * (`_billing-health.ts`) and passed into `ConfiguratorNavShell`. `healthy`
 * renders no banner. This is a read-only advisory; it never blocks or gates.
 */
export type BillingHealthState = 'past_due' | 'canceled' | 'low_balance' | 'healthy'
export interface BillingHealth {
  state: BillingHealthState
  // B2B-24 §6.3 — extends the existing read/shape (one extra `select()` on
  // the already-executed `getBillingHealth()` query) so the Dashboard's
  // wallet snapshot (Area 3) needs no new query or endpoint. `balance_usd`
  // is `null` specifically for "no wallet row yet" (distinct from a real
  // `0` balance) — see `_billing-health.ts`.
  balance_usd: number | null
  next_billing_date: string | null
}

// Fixed factual copy — LOCKED by CEO (Requirement Doc Section 4.5). No dollar
// figures. Do not edit wording without a spec change.
// Exported (B2B-24 §6.3) so the Dashboard's wallet snapshot (Area 3) reuses
// this exact copy verbatim rather than inventing a second warning string.
export const BILLING_BANNER_COPY: Record<
  Exclude<BillingHealthState, 'healthy'>,
  { message: string; linkLabel: string }
> = {
  past_due: {
    message: 'Your plan payment is past due. Add a payment method to avoid interruption.',
    linkLabel: 'Fix billing →',
  },
  canceled: {
    message: 'Your plan has been canceled. Reactivate to keep your integration running.',
    linkLabel: 'Fix billing →',
  },
  low_balance: {
    message: 'Your usage balance is running low. Top up to avoid interruption.',
    linkLabel: 'Add funds →',
  },
}

/**
 * B2B-16 Requirement Doc Section 4.5 — persistent, non-blocking billing-health
 * banner. Renders above the page body on the three destinations; the page
 * remains fully visible and usable. Links to the Docs billing explainer
 * (`/dashboard/configurator/docs#billing`) — never a redirect, never an overlay.
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §6.1) — gains `basePath`,
 * default `'/dashboard/configurator'`, so the "Fix billing"/"Add funds" link
 * stays inside a client-scoped Configure surface instead of always pointing
 * at the direct-partner route. Every existing call site passes no prop, so
 * it renders the exact literal it already renders today.
 */
function BillingBanner({
  billingHealth,
  activePartnerAccountId,
  basePath = '/dashboard/configurator',
}: {
  billingHealth: BillingHealth
  activePartnerAccountId: string
  basePath?: string
}) {
  if (billingHealth.state === 'healthy') return null
  const copy = BILLING_BANNER_COPY[billingHealth.state]
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        background: COLORS.raised,
        border: `1px solid ${COLORS.amber}`,
        borderRadius: 10,
        padding: '10px 16px',
        marginBottom: 20,
      }}
    >
      <span style={{ color: COLORS.amber, fontSize: 13, flex: 1, minWidth: 220 }}>
        <span aria-hidden style={{ marginRight: 8 }}>⚠</span>
        {copy.message}
      </span>
      <Link
        href={`${basePath}/docs?partner_account_id=${activePartnerAccountId}#billing`}
        style={{ color: COLORS.amber, fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
      >
        {copy.linkLabel}
      </Link>
    </div>
  )
}

/**
 * B2B-16 Requirement Doc Section 4.2 — additive lean nav shell wrapping the
 * three top-level destinations (Configurator / API / Docs). Reuses the exact
 * top-bar chrome + account switcher of `ConfiguratorShell` and the `COLORS`
 * design system — NO new visual language. Adds a 3-item nav row and the
 * billing-health banner. Does NOT replace `ConfiguratorShell` (still used by
 * the 6 sub-screens + Playground) or `DashboardShell` (admin surface).
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §6.1) — gains two new
 * optional props, `basePath` (default `'/dashboard/configurator'`) and
 * `navLabel` (default `'Configure'`, renamed 2026-07-21 per Arun's direct
 * instruction — the label previously read "Configurator"), so this exact component can be
 * reused verbatim for the client-scoped Configure surface
 * (`/dashboard/channel-partner/clients/[id]/configure`). Every existing
 * `/dashboard/configurator/**` caller passes neither prop, so it renders the
 * exact literal it already renders today — zero behavior or copy change for
 * any direct partner.
 */
export function ConfiguratorNavShell({
  accounts,
  activePartnerAccountId,
  active,
  billingHealth,
  children,
  basePath = '/dashboard/configurator',
  navLabel = 'Configure',
}: {
  accounts: AdminPartnerAccount[]
  activePartnerAccountId: string
  active: 'configurator' | 'api' | 'docs' | 'known_bugs'
  billingHealth: BillingHealth
  children: React.ReactNode
  basePath?: string
  navLabel?: string
}) {
  const router = useRouter()
  const pathname = usePathname()

  function onSwitch(id: string) {
    router.push(`${pathname}?partner_account_id=${id}`)
  }

  const navItems: { key: 'configurator' | 'api' | 'docs' | 'known_bugs'; label: string; href: string }[] = [
    { key: 'configurator', label: navLabel, href: `${basePath}?partner_account_id=${activePartnerAccountId}` },
    { key: 'api', label: 'API', href: `${basePath}/api?partner_account_id=${activePartnerAccountId}` },
    { key: 'docs', label: 'Docs', href: `${basePath}/docs?partner_account_id=${activePartnerAccountId}` },
    // B2B-22 §6.6 — Known Bugs is an ongoing operational/status view, not a Configurator setup step,
    // so it's a 4th top-nav tab rather than a left-nav step group entry.
    { key: 'known_bugs', label: 'Known Bugs', href: `${basePath}/known-bugs?partner_account_id=${activePartnerAccountId}` },
  ]

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ borderBottom: `1px solid ${COLORS.borderSubtle}`, padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Clio Configure</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {accounts.length > 1 ? (
            <select
              value={activePartnerAccountId}
              onChange={(e) => onSwitch(e.target.value)}
              style={{ background: COLORS.surface, color: COLORS.textPrimary, border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : accounts.length === 1 ? (
            <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>{accounts[0].name}</span>
          ) : null}
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </div>

      <nav style={{ borderBottom: `1px solid ${COLORS.borderSubtle}`, padding: '0 32px', display: 'flex', gap: 8 }}>
        {navItems.map((item) => {
          const isActive = item.key === active
          return (
            <Link
              key={item.key}
              href={item.href}
              style={{
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                color: isActive ? COLORS.textPrimary : COLORS.textSecondary,
                borderBottom: `2px solid ${isActive ? COLORS.purple : 'transparent'}`,
                marginBottom: -1,
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div style={SHELL_CONTENT_STYLE}>
        <BillingBanner billingHealth={billingHealth} activePartnerAccountId={activePartnerAccountId} basePath={basePath} />
        {children}
      </div>
    </div>
  )
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 12, padding: 20, ...style }}>
      {children}
    </div>
  )
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { style, disabled, ...rest } = props
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        background: COLORS.purple,
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '10px 16px',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}
    />
  )
}

export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { style, ...rest } = props
  return (
    <button
      {...rest}
      style={{
        background: 'transparent',
        color: COLORS.textPrimary,
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: 8,
        padding: '10px 16px',
        fontSize: 13,
        cursor: 'pointer',
        ...style,
      }}
    />
  )
}

export function NoPartnerAccounts() {
  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <p>You don&apos;t administer any partner accounts.</p>
    </div>
  )
}
