import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardClient from './DashboardClient'
import { LayoutDashboard, MessageSquare, CreditCard, Settings } from 'lucide-react'
import Link from 'next/link'

export default async function DashboardPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  // Fetch user data
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  // If not onboarded, redirect
  if (!user) redirect('/onboarding')

  // Fetch recent 7 delivery log entries
  const { data: recentDeliveries } = await supabase
    .from('delivery_log')
    .select(`
      id,
      content_item_id,
      channel,
      sent_at,
      feedback,
      content_items (
        id, type, body_text
      )
    `)
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(7)

  // Count this month's messages
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const { count: monthlyCount } = await supabase
    .from('delivery_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('sent_at', startOfMonth.toISOString())

  return (
    <div className="min-h-screen bg-[#080808] flex">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-[#111111] border-r border-[#222222] flex flex-col">
        {/* Logo */}
        <div className="px-6 py-6 border-b border-[#222222]">
          <span className="text-xl font-extrabold tracking-tight text-white">
            Clio
          </span>
          <span className="ml-2 text-xs text-[#7C3AED] font-semibold uppercase tracking-widest">
            AI
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {[
            { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { href: '/dashboard/messages', icon: MessageSquare, label: 'Messages' },
            { href: '/dashboard/billing', icon: CreditCard, label: 'Billing' },
            { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
          ].map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#94A3B8] hover:text-white hover:bg-[#1A1A1A] transition-colors"
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
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
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              <p className="text-[#475569] text-sm mt-1">
                Your AI learning command center
              </p>
            </div>
            <UserButton afterSignOutUrl="/" />
          </div>

          <DashboardClient
            user={user}
            recentDeliveries={(recentDeliveries ?? []).map((d) => ({
              ...d,
              content_items: Array.isArray(d.content_items)
                ? (d.content_items[0] ?? null)
                : (d.content_items ?? null),
            }))}
            monthlyCount={monthlyCount ?? 0}
          />
        </div>
      </main>
    </div>
  )
}
