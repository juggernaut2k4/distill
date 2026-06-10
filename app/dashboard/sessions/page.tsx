import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import SessionsClient from './SessionsClient'
import DashboardShell from '@/components/dashboard/DashboardShell'

export default async function SessionsPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, plan_approved, minutes_balance, scheduling_prefs')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')

  const [{ data: sessions }, { data: plan }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, session_index, session_title, scheduled_at, status, topics, duration_mins, curriculum_session_id, meeting_url')
      .eq('user_id', userId)
      .neq('status', 'draft')
      .order('session_index', { ascending: true }),
    supabase
      .from('curriculum_plans')
      .select('visible_sessions')
      .eq('user_id', userId)
      .is('superseded_at', null)
      .single(),
  ])

  // Build a map from curriculum_session_id → topic title
  const topicTitleMap: Record<string, string> = {}
  const visibleSessions = (plan?.visible_sessions ?? []) as Array<{ session_id: string; title: string }>
  for (const vs of visibleSessions) {
    topicTitleMap[vs.session_id] = vs.title
  }

  return (
    <DashboardShell user={user} activeNav="/dashboard/sessions">
      <SessionsClient
        sessions={sessions ?? []}
        topicTitleMap={topicTitleMap}
        minutesBalance={user.minutes_balance ?? 0}
        schedulingPrefsNull={user.scheduling_prefs === null || user.scheduling_prefs === undefined}
      />
    </DashboardShell>
  )
}
