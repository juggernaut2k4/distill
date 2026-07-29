import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * B2B-40 (docs/specs/B2B-40-requirement-document.md §13) — sibling test file
 * covering app/dashboard/admin/page.tsx (the new admin home/nav hub) and the
 * AT-10 DashboardShell nav-array regression.
 *
 * Both target files are 'use client'-free but JSX-returning .tsx server
 * components. This repo's vitest.config.ts runs with environment: 'node' and
 * no @vitejs/plugin-react, and tsconfig.json sets "jsx": "preserve" (Next.js
 * owns the JSX transform, not tsc/esbuild) — so a live `import()` of either
 * file fails at Vite's import-analysis step with "invalid JS syntax" the
 * moment esbuild hits a JSX return statement (confirmed empirically: only
 * app/dashboard/page.tsx, which contains zero JSX, can be live-imported —
 * see tests/unit/b2b40-admin-routing.test.ts). This is exactly why the
 * existing tests/unit/b2b28-security-orthogonality-and-naming.test.ts
 * precedent reads TeamClient.tsx via fs.readFileSync and asserts on its
 * source text rather than importing/rendering it. This file follows that
 * same, already-established convention for both AdminHomePage and
 * DashboardShell.
 */

const pageSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/dashboard/admin/page.tsx'),
  'utf8'
)

const EXPECTED_LINKS = [
  { href: '/dashboard/admin/clients', title: 'Clients', description: 'Cross-partner billing and revenue detail.' },
  { href: '/dashboard/admin/templates', title: 'Templates', description: "Clio's global content-approval queue." },
  { href: '/dashboard/admin/glitches', title: 'Glitches', description: 'Internal bug and issue tracker.' },
  { href: '/dashboard/admin/team', title: 'Team', description: 'Manage super-admins and sales-partner access.' },
  { href: '/dashboard/admin/partner-invites', title: 'Partner invites', description: 'Manage partner invite links and their status.' },
  { href: '/dashboard/admin/sales-partners', title: 'Sales-partners', description: 'Reseller roster and usage.' },
]

describe('B2B-40 — app/dashboard/admin/page.tsx (AdminHomePage) — source-level assertions', () => {
  it('AT-6: gates with requireSuperAdmin() and notFound() on error, matching every sibling admin sub-page (e.g. TeamPage)', () => {
    expect(pageSource).toContain("import { requireSuperAdmin } from '@/lib/internal-admin/auth'")
    expect(pageSource).toContain('const admin = await requireSuperAdmin()')
    expect(pageSource).toContain('if (admin.error) notFound()')
  })

  it('AT-6: ADMIN_LINKS contains exactly the six §4.B entries, with exact href/title/description, in the exact specified order', () => {
    const arrayMatch = pageSource.match(/const ADMIN_LINKS: AdminLinkCard\[\] = \[([\s\S]*?)\n\]/)
    expect(arrayMatch).not.toBeNull()
    const arrayBody = arrayMatch![1]

    // Exactly 6 entries.
    expect((arrayBody.match(/href:/g) ?? []).length).toBe(6)

    let cursor = -1
    for (const link of EXPECTED_LINKS) {
      const entryPattern = new RegExp(
        `href: '${link.href.replace(/\//g, '\\/')}', icon: \\w+, title: '${link.title}', description: (?:'${link.description.replace(/'/g, "\\\\'")}'|"${link.description}")`
      )
      const match = arrayBody.match(entryPattern)
      expect(match, `expected an ADMIN_LINKS entry matching ${JSON.stringify(link)}`).not.toBeNull()
      const index = arrayBody.indexOf(match![0])
      expect(index).toBeGreaterThan(cursor) // enforces ordering matches §4.B's table
      cursor = index
    }
  })

  it('AT-6: each card reuses the same icon DashboardShell.tsx uses for the same destination (Building2/LayoutTemplate/Bug/Shield/Link2/Users)', () => {
    const expectedIcons = ['Building2', 'LayoutTemplate', 'Bug', 'Shield', 'Link2', 'Users']
    for (const icon of expectedIcons) {
      expect(pageSource).toContain(`icon: ${icon},`)
    }
  })

  it('AT-6: renders inside DashboardShell with activeNav="/dashboard/admin" so the sidebar entry highlights as active', () => {
    expect(pageSource).toContain('import DashboardShell from \'@/components/dashboard/DashboardShell\'')
    expect(pageSource).toContain('activeNav="/dashboard/admin"')
  })

  it('AT-6: no metrics/charts/counts — the page has no data fetching beyond the auth check itself', () => {
    // No supabase/database import exists on this page beyond the auth helper.
    expect(pageSource).not.toMatch(/from '@\/lib\/supabase'/)
    expect(pageSource).not.toContain('createSupabaseAdminClient')
  })

  it('AT-7/AT-8: checks for a Clerk session and redirects to /sign-in BEFORE calling requireSuperAdmin(), matching TeamPage\'s own ordering', () => {
    const redirectIndex = pageSource.indexOf("if (!clerkUser) redirect('/sign-in')")
    const requireSuperAdminIndex = pageSource.indexOf('await requireSuperAdmin()')
    expect(redirectIndex).toBeGreaterThan(-1)
    expect(requireSuperAdminIndex).toBeGreaterThan(-1)
    expect(redirectIndex).toBeLessThan(requireSuperAdminIndex)
  })
})

describe('B2B-40 — AT-10 (regression): DashboardShell mobile bottom nav is unchanged by the new Admin Home entry', () => {
  const shellSource = fs.readFileSync(
    path.resolve(__dirname, '../../components/dashboard/DashboardShell.tsx'),
    'utf8'
  )

  it('appends the new Admin Home entry AFTER Sales-partners, not before it (append-only diff)', () => {
    const salesPartnersIndex = shellSource.indexOf("label: 'Sales-partners'")
    const adminHomeIndex = shellSource.indexOf("label: 'Admin Home'")
    expect(salesPartnersIndex).toBeGreaterThan(-1)
    expect(adminHomeIndex).toBeGreaterThan(-1)
    expect(adminHomeIndex).toBeGreaterThan(salesPartnersIndex)
  })

  it('keeps MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5) byte-identical to its pre-B2B-40 definition', () => {
    expect(shellSource).toContain('const MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5)')
  })

  it('NAV_ITEMS still lists Clients, Templates, Glitches, Team, Partner invites as the first five entries, in order — the exact set the mobile bottom bar renders', () => {
    const expectedFirstFive = ['Clients', 'Templates', 'Glitches', 'Team', 'Partner invites']
    const labelMatches = Array.from(shellSource.matchAll(/label: '([^']+)'/g)).map((m) => m[1])
    expect(labelMatches.slice(0, 5)).toEqual(expectedFirstFive)
  })

  it('Admin Home is the 7th (last) NAV_ITEMS entry, outside the slice(0, 5) window used for the mobile bottom bar', () => {
    const labelMatches = Array.from(shellSource.matchAll(/label: '([^']+)'/g)).map((m) => m[1])
    expect(labelMatches).toHaveLength(7)
    expect(labelMatches[6]).toBe('Admin Home')
  })

  it('imports the Home icon from lucide-react for the new nav entry, alongside the existing six icons', () => {
    expect(shellSource).toMatch(/import \{ Building2, LayoutTemplate, Bug, Shield, Link2, Users, Home \} from 'lucide-react'/)
  })

  it('links the new entry to /dashboard/admin', () => {
    expect(shellSource).toContain("{ href: '/dashboard/admin', icon: Home, label: 'Admin Home' }")
  })
})
