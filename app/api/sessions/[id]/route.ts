import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

interface Params {
  params: { id: string }
}

export async function GET(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, session_title, scheduled_at, status, duration_mins, planned_duration_mins, meeting_url, topics, topic_id')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // DUR-01: expose a single resolved duration value alongside the raw columns so any
  // consumer can use `effective_duration_mins` without re-implementing the fallback.
  const effective_duration_mins = session.planned_duration_mins ?? session.duration_mins

  return NextResponse.json({ session: { ...session, effective_duration_mins } })
}
