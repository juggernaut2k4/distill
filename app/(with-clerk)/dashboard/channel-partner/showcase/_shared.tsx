import Link from 'next/link'
import { COLORS } from '../_shared'

/**
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §0 point 2, §4). Local
 * two-item sub-nav (`Content | Visualization`) inside the Showcase pages
 * themselves — styled like the Configurator's own top tab row
 * (`borderBottom: 2px solid COLORS.purple` on the active item), not two more
 * `ChannelPartnerShell`-level nav items (that would make the shell's primary
 * nav 6 items deep for a feature only one person ever sees). No 'use client'
 * directive needed — plain links, no interactivity — importing `COLORS` from
 * `../_shared` is safe here for the same reason it's safe in every other
 * Server Component in this tree (see `_shared.tsx`'s own hotfix comment).
 */
export function ShowcaseSubNav({ active }: { active: 'content' | 'visualization' }) {
  const items: { key: 'content' | 'visualization'; label: string; href: string }[] = [
    { key: 'content', label: 'Content', href: '/dashboard/channel-partner/showcase' },
    { key: 'visualization', label: 'Visualization', href: '/dashboard/channel-partner/showcase/visualization' },
  ]

  return (
    <div style={{ display: 'flex', gap: 20, borderBottom: `1px solid ${COLORS.borderSubtle}`, marginBottom: 20 }}>
      {items.map((item) => {
        const isActive = item.key === active
        return (
          <Link
            key={item.key}
            href={item.href}
            style={{
              padding: '10px 2px',
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
    </div>
  )
}
