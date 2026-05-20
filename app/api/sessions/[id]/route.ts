import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

interface Params {
  params: { id: string }
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, session_title, scheduled_at, status, duration_mins, meeting_url, topics, topic_id')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  return NextResponse.json({ session })
}
