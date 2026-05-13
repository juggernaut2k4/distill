import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardClient from './DashboardClient'
import DashboardShell from '@/components/dashboard/DashboardShell'

export default async function DashboardPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

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

  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const { count: monthlyCount } = await supabase
    .from('delivery_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('sent_at', startOfMonth.toISOString())

  return (
    <DashboardShell user={user} activeNav="/dashboard">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-[#475569] text-sm mt-1">Your AI learning command center</p>
        </div>
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
    </DashboardShell>
  )
}
