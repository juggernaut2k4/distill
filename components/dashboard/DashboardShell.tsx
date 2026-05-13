'use client'

import { UserButton } from '@clerk/nextjs'
import { LayoutDashboard, MessageSquare, CreditCard, Settings, BookOpen, CalendarDays, Phone } from 'lucide-react'
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
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/plan', icon: BookOpen, label: 'My Plan' },
  { href: '/dashboard/schedule', icon: CalendarDays, label: 'Sessions' },
  { href: '/dashboard/messages', icon: MessageSquare, label: 'Messages' },
  { href: '/dashboard/billing', icon: CreditCard, label: 'Billing' },
  { href: '/dashboard/phone', icon: Phone, label: 'Phone Setup' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
]

export default function DashboardShell({ user, activeNav, children }: DashboardShellProps) {
  const planPending = !user.plan_approved && user.plan_tier && user.plan_tier !== 'free'

  return (
    <div className="min-h-screen bg-[#080808] flex">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-[#111111] border-r border-[#222222] flex flex-col">
        {/* Logo */}
        <div className="px-6 py-6 border-b border-[#222222]">
          <span className="text-xl font-extrabold tracking-tight text-white">Clio</span>
          <span className="ml-2 text-xs text-[#7C3AED] font-semibold uppercase tracking-widest">AI</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const isActive = activeNav === href
            const hasBadge = href === '/dashboard/plan' && planPending

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
                {hasBadge && (
                  <span className="w-2 h-2 rounded-full bg-[#F59E0B] flex-shrink-0" />
                )}
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
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
