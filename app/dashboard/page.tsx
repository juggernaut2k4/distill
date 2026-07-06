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

  // Fetch recent 5 delivery log entries (shown in "Recent Insights" section)
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
    .limit(5)

  // Fetch today's insight (most recent delivery sent today)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const { data: todayDeliveries } = await supabase
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
    .gte('sent_at', todayStart.toISOString())
    .order('sent_at', { ascending: false })
    .limit(1)

  const todayDelivery = todayDeliveries && todayDeliveries.length > 0
    ? {
        ...todayDeliveries[0],
        content_items: Array.isArray(todayDeliveries[0].content_items)
          ? (todayDeliveries[0].content_items[0] ?? null)
          : (todayDeliveries[0].content_items ?? null),
      }
    : null

  // Fetch next upcoming session
  const { data: upcomingSessions } = await supabase
    .from('sessions')
    .select('id, session_index, session_title, scheduled_at, status, topics, duration_mins, planned_duration_mins')
    .eq('user_id', userId)
    .gt('scheduled_at', new Date().toISOString())
    .not('status', 'eq', 'completed')
    .not('status', 'eq', 'cancelled')
    .order('scheduled_at', { ascending: true })
    .limit(1)

  const nextSession = upcomingSessions && upcomingSessions.length > 0 ? upcomingSessions[0] : null

  // Monthly insight count
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
        todayDelivery={todayDelivery}
        nextSession={nextSession ?? null}
        schedulingPrefsNull={user.scheduling_prefs === null || user.scheduling_prefs === undefined}
      />
    </DashboardShell>
  )
}
