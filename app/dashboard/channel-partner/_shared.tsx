import Link from 'next/link'
import { Card, PrimaryButton, SecondaryButton } from '../configurator/_shared'
import { COLORS, SHELL_CONTENT_STYLE } from '../configurator/design-tokens'

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
 *
 * B2B-29 hotfix (prod digest 2779826077) — COLORS/SHELL_CONTENT_STYLE are
 * now imported directly from '../configurator/design-tokens' (no 'use
 * client' directive), not via '../configurator/_shared' (which has one).
 * This file has no directive of its own, so when it's reached from a Server
 * Component (app/dashboard/channel-partner/page.tsx renders
 * <ChannelPartnerShell>), its own code — including this module's top-level
 * COLORS.x property access below — runs in the server bundle. Importing a
 * plain-object export through a 'use client' file makes it an opaque client
 * reference there, and dotting into it on the server throws "Cannot access
 * X on the server." This bug was latent since B2B-26 (ChannelPartnerShell
 * itself reads COLORS.borderSubtle) and only surfaced once a real self-serve
 * signup finally reached this page in production. `Card`/`PrimaryButton`/
 * `SecondaryButton` are unaffected — they're real components used as JSX
 * elements, which is exactly the "pass the imported name through" pattern
 * Next.js allows across this boundary.
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
  showShowcaseTab = false,
  children,
}: {
  companyName: string
  active: 'dashboard' | 'clients' | 'team' | 'settings' | 'showcase'
  /**
   * B2B-31 (docs/specs/B2B-31-requirement-document.md §4) — gates the 5th
   * "Showcase" nav tab. Defaults to `false` so every existing caller
   * (page.tsx, clients/page.tsx, team/page.tsx, settings/page.tsx) is
   * completely unaffected unless it explicitly passes `true` after reading
   * `showcase_access_enabled` itself (`getShowcaseAccessEnabled`,
   * lib/partner/auth.ts). A non-allowlisted admin never sees a 5th tab at
   * all — an absent tab, not a visible-but-403 one.
   */
  showShowcaseTab?: boolean
  children: React.ReactNode
}) {
  // B2B-29 (docs/specs/B2B-29-requirement-document.md §6.8) — 4th nav tab,
  // "Settings", for the new Company info + Payment page.
  const navItems: { key: 'dashboard' | 'clients' | 'team' | 'settings' | 'showcase'; label: string; href: string }[] = [
    { key: 'dashboard', label: 'Dashboard', href: '/dashboard/channel-partner' },
    { key: 'clients', label: 'Clients', href: '/dashboard/channel-partner/clients' },
    { key: 'team', label: 'Team', href: '/dashboard/channel-partner/team' },
    { key: 'settings', label: 'Settings', href: '/dashboard/channel-partner/settings' },
  ]

  // B2B-31 (§4) — 5th nav tab, conditionally rendered only for allowlisted accounts.
  if (showShowcaseTab) {
    navItems.push({ key: 'showcase', label: 'Showcase', href: '/dashboard/channel-partner/showcase' })
  }

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
