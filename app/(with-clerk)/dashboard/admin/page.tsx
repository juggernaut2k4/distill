import { currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Building2, LayoutTemplate, Bug, Shield, Link2, Users, LucideIcon } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import DashboardShell from '@/components/dashboard/DashboardShell'
import DemoAccessCard from './DemoAccessCard'
import DemoPerformanceToggleCard from './DemoPerformanceToggleCard'
import VoiceProviderCard from './VoiceProviderCard'

/**
 * B2B-40 (docs/specs/B2B-40-requirement-document.md §4.B) — super-admin
 * home/navigation hub. Same currentUser()-then-DashboardShell-then-content
 * shape as every other admin sub-page (e.g.
 * app/dashboard/admin/team/page.tsx), substituting requireSuperAdmin() +
 * notFound() on failure — identical gate convention to every sibling page,
 * not a new pattern. The link grid itself is 100% static (no data fetch, no
 * interactivity), so it renders directly as part of this server component
 * per §4.B / Design Question 2 (link grid only, no metrics/charts/live
 * data) — `DemoAccessCard` (relocated here from
 * `/dashboard/admin/sales-partners` per Arun's direct instruction, since it
 * is the admin's own settings, not part of managing other resellers) is
 * the one 'use client' exception, composed in as a child same as any
 * Server Component rendering a Client Component.
 */

interface AdminLinkCard {
  href: string
  icon: LucideIcon
  title: string
  description: string
}

const ADMIN_LINKS: AdminLinkCard[] = [
  { href: '/dashboard/admin/clients', icon: Building2, title: 'Clients', description: 'Cross-partner billing and revenue detail.' },
  { href: '/dashboard/admin/templates', icon: LayoutTemplate, title: 'Templates', description: "Clio's global content-approval queue." },
  { href: '/dashboard/admin/glitches', icon: Bug, title: 'Glitches', description: 'Internal bug and issue tracker.' },
  { href: '/dashboard/admin/team', icon: Shield, title: 'Team', description: 'Manage super-admins and sales-partner access.' },
  { href: '/dashboard/admin/partner-invites', icon: Link2, title: 'Partner invites', description: 'Manage partner invite links and their status.' },
  { href: '/dashboard/admin/sales-partners', icon: Users, title: 'Sales-partners', description: 'Reseller roster and usage.' },
]

export default async function AdminHomePage() {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const admin = await requireSuperAdmin()
  if (admin.error) notFound()

  return (
    <DashboardShell
      user={{ email: clerkUser.emailAddresses[0]?.emailAddress }}
      activeNav="/dashboard/admin"
    >
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-white">Admin</h1>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Jump into any part of Clio&apos;s internal admin tools.
        </p>

        <div className="mt-6">
          <DemoAccessCard />
          <DemoPerformanceToggleCard />
          <VoiceProviderCard />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ADMIN_LINKS.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col gap-2 rounded-xl border border-[#222222] bg-[#111111] p-5 transition-colors hover:border-[#333333] hover:bg-[#1A1A1A]"
            >
              <div className="flex items-center gap-2 text-white">
                <Icon size={18} />
                <span className="font-semibold">{title}</span>
              </div>
              <p className="text-sm text-[#94A3B8]">{description}</p>
            </Link>
          ))}
        </div>
      </div>
    </DashboardShell>
  )
}
