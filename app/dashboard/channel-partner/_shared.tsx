import Link from 'next/link'
import { COLORS, Card, PrimaryButton, SecondaryButton, SHELL_CONTENT_STYLE } from '../configurator/_shared'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §4, §12) — the
 * sales-partner's own dashboard shell. Reuses `_shared.tsx`'s design tokens
 * (`COLORS`, `Card`, `PrimaryButton`, `SecondaryButton`, `SHELL_CONTENT_STYLE`)
 * verbatim, no new colors or components invented. Mirrors
 * `ConfiguratorNavShell`'s top-bar/nav chrome (same borderBottom, same
 * active-tab underline in COLORS.purple), NOT its literal Configurator-
 * specific nav items — this tree has no Configurator/API/Docs/Known-Bugs
 * tabs (§ Judgment Call — a sales-partner's own account is strictly a
 * management shell, never a direct-partner target).
 */
export { COLORS, Card, PrimaryButton, SecondaryButton, SHELL_CONTENT_STYLE }

export function NoChannelPartnerAccount() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: COLORS.bg,
        color: COLORS.textSecondary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <p>You don&apos;t administer a sales-partner account.</p>
    </div>
  )
}

export function ChannelPartnerShell({
  companyName,
  active,
  children,
}: {
  companyName: string
  active: 'dashboard' | 'clients' | 'team'
  children: React.ReactNode
}) {
  const navItems: { key: 'dashboard' | 'clients' | 'team'; label: string; href: string }[] = [
    { key: 'dashboard', label: 'Dashboard', href: '/dashboard/channel-partner' },
    { key: 'clients', label: 'Clients', href: '/dashboard/channel-partner/clients' },
    { key: 'team', label: 'Team', href: '/dashboard/channel-partner/team' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ borderBottom: `1px solid ${COLORS.borderSubtle}`, padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Clio — Sales-partner dashboard</span>
        <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>{companyName}</span>
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

      <div style={SHELL_CONTENT_STYLE}>{children}</div>
    </div>
  )
}
