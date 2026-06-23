import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import SessionsClient from './SessionsClient'
import DashboardShell from '@/components/dashboard/DashboardShell'

// Shape of each entry in curriculum_plans.visible_sessions
interface VisibleSession {
  session_id: string
  title: string
  arc_name?: string
  arc_type?: string
}

export default async function SessionsPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, plan_approved, minutes_balance, scheduling_prefs, plan_adapted_at, plan_adaptation_acknowledged_at')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')

  const [{ data: sessions }, { data: plan }, { data: latestAdaptation }] = await Promise.all([
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
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('plan_adaptations')
      .select('sessions_reordered')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const visibleSessions = (plan?.visible_sessions ?? []) as VisibleSession[]

  // TITLE-01: topic title map — fallback only (sessions.session_title takes priority in client)
  const topicTitleMap: Record<string, string> = {}
  for (const vs of visibleSessions) {
    topicTitleMap[vs.session_id] = vs.title
  }

  // SESS-04: arc name map — curriculum_session_id → arc_name
  // Used to render Arc headers above topic groups in the sessions list.
  const arcNameMap: Record<string, string> = {}
  const arcTypeMap: Record<string, string> = {}
  for (const vs of visibleSessions) {
    if (vs.arc_name) arcNameMap[vs.session_id] = vs.arc_name
    if (vs.arc_type) arcTypeMap[vs.session_id] = vs.arc_type
  }

  return (
    <DashboardShell user={user} activeNav="/dashboard/sessions">
      <SessionsClient
        sessions={sessions ?? []}
        topicTitleMap={topicTitleMap}
        arcNameMap={arcNameMap}
        arcTypeMap={arcTypeMap}
        minutesBalance={user.minutes_balance ?? 0}
        schedulingPrefsNull={user.scheduling_prefs === null || user.scheduling_prefs === undefined}
        planAdaptedAt={user.plan_adapted_at ?? null}
        planAdaptationAcknowledgedAt={user.plan_adaptation_acknowledged_at ?? null}
        sessionsReorderedCount={latestAdaptation?.sessions_reordered ?? null}
      />
    </DashboardShell>
  )
}
