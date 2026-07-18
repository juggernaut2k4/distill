'use client'

import { UserButton } from '@clerk/nextjs'
import { Building2, LayoutTemplate, Bug, Shield } from 'lucide-react'
import Link from 'next/link'

interface ShellUser {
  email?: string | null
  plan_tier?: string | null
  plan_approved?: boolean | null
}

interface DashboardShellProps {
  user: ShellUser
  activeNav?: string
  children: React.ReactNode
}

const NAV_ITEMS = [
  { href: '/dashboard/admin/clients', icon: Building2, label: 'Clients' },
  { href: '/dashboard/admin/templates', icon: LayoutTemplate, label: 'Templates' },
  { href: '/dashboard/admin/glitches', icon: Bug, label: 'Glitches' },
  // B2B-21 — Team is super-admin-only; the nav array is not conditionally
  // rendered per-role today (no per-item auth check exists in this client
  // component), so this link's own page-level requireSuperAdmin() gate is
  // what actually enforces access. Visible-but-404-on-click to a
  // sales-partner, matching the existing pattern for the other 3 items.
  { href: '/dashboard/admin/team', icon: Shield, label: 'Team' },
]

// Primary nav items shown in mobile bottom bar (most important 5)
const MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5)

export default function DashboardShell({ user, activeNav, children }: DashboardShellProps) {
  return (
    <div className="min-h-screen bg-[#080808] flex">
      {/* Sidebar — hidden on mobile, visible on md+ */}
      <aside className="hidden md:flex md:flex-col w-60 flex-shrink-0 bg-[#111111] border-r border-[#222222]">
        {/* Logo */}
        <div className="px-6 py-6 border-b border-[#222222]">
          <span className="text-xl font-extrabold tracking-tight text-white">Clio</span>
          <span className="ml-2 text-xs text-[#7C3AED] font-semibold uppercase tracking-widest">AI</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const isActive = activeNav === href

            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-purple-950/40 text-white border border-purple-800/30'
                    : 'text-[#94A3B8] hover:text-white hover:bg-[#1A1A1A]'
                }`}
              >
                <Icon size={18} />
                <span className="flex-1">{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-[#222222]">
          <div className="flex items-center gap-3">
            <UserButton afterSignOutUrl="/" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[#94A3B8] truncate">{user?.email ?? 'My account'}</p>
              <p className="text-xs text-[#475569] truncate capitalize">{user?.plan_tier ?? 'free'} plan</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[#222222] bg-[#111111]">
          <span className="text-lg font-extrabold tracking-tight text-white">
            Clio <span className="text-xs text-[#7C3AED] font-semibold uppercase tracking-widest">AI</span>
          </span>
          <UserButton afterSignOutUrl="/" />
        </div>

        <div className="p-4 md:p-8 pb-24 md:pb-8">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#111111] border-t border-[#222222] flex">
        {MOBILE_NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const isActive = activeNav === href
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] transition-colors ${
                isActive ? 'text-white' : 'text-[#475569]'
              }`}
            >
              <Icon size={20} />
              <span className="leading-tight truncate max-w-[52px] text-center">{label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
