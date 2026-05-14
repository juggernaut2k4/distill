import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { createBot } from '@/lib/recall'

/**
 * POST /api/admin/test-session
 * Creates a test session and sends the Recall.ai bot into an existing meeting URL.
 * For testing only — bypasses the 25-35 min cron window.
 * Body: { title?, meetingUrl, durationMins? }
 */
export async function POST(request: NextRequest) {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { title?: string; meetingUrl?: string; durationMins?: number } = {}
  try {
    body = await request.json()
  } catch {
    // use defaults
  }

  const sessionTitle = body.title ?? 'How Claude Works'
  const durationMins = body.durationMins ?? 30
  const meetingUrl = body.meetingUrl?.trim()

  if (!meetingUrl) {
    return NextResponse.json({ error: 'meetingUrl is required' }, { status: 400 })
  }

  const scheduledAt = new Date(Date.now() + 3 * 60 * 1000)
  const supabase = createSupabaseAdminClient()

  const { data: existingSessions } = await supabase
    .from('sessions')
    .select('session_index')
    .eq('user_id', userId)
    .order('session_index', { ascending: false })
    .limit(1)

  const sessionIndex = existingSessions?.[0]?.session_index
    ? (existingSessions[0].session_index as number) + 1
    : 1

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      session_index: sessionIndex,
      session_title: sessionTitle,
      scheduled_at: scheduledAt.toISOString(),
      duration_mins: durationMins,
      status: 'scheduled',
      meeting_url: meetingUrl,
    })
    .select()
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: `Failed to create session: ${sessionError?.message}` }, { status: 500 })
  }

  const walkthroughUrl = `${process.env.NEXT_PUBLIC_APP_URL}/walkthrough/${userId}`

  try {
    const { botId } = await createBot(meetingUrl, userId, walkthroughUrl)

    await supabase
      .from('walkthrough_state')
      .upsert({
        user_id: userId,
        bot_id: botId,
        meeting_url: meetingUrl,
        session_id: session.id,
        status: 'idle',
        visual_spec: null,
      })

    return NextResponse.json({
      sessionId: session.id,
      sessionTitle,
      meetingUrl,
      botId,
      walkthroughUrl,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to send bot: ${message}` }, { status: 500 })
  }
}
