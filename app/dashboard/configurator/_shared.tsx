'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'

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
 */

export const COLORS = {
  bg: '#080808',
  surface: '#111111',
  raised: '#1A1A1A',
  borderSubtle: '#222222',
  borderStrong: '#333333',
  purple: '#7C3AED',
  cyan: '#06B6D4',
  amber: '#F59E0B',
  green: '#10B981',
  red: '#EF4444',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#475569',
}

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
          <span style={{ fontWeight: 700, fontSize: 14 }}>Clio Configurator</span>
          <span style={{ color: COLORS.textMuted, fontSize: 13 }}>{title}</span>
        </div>
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
      </div>
      <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>{children}</div>
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
