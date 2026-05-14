import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { createGoogleMeetSession } from '@/lib/recall'

/**
 * POST /api/admin/test-session
 * Creates a test session and immediately spins up a Google Meet with the Recall.ai bot.
 * For testing only — bypasses the 25-35 min cron window.
 */
export async function POST(request: NextRequest) {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { title?: string; durationMins?: number } = {}
  try {
    body = await request.json()
  } catch {
    // use defaults
  }

  const sessionTitle = body.title ?? 'How Claude Works'
  const durationMins = body.durationMins ?? 30
  const scheduledAt = new Date(Date.now() + 3 * 60 * 1000) // 3 min from now

  const supabase = createSupabaseAdminClient()

  // Find the next session_index for this user
  const { data: existingSessions } = await supabase
    .from('sessions')
    .select('session_index')
    .eq('user_id', userId)
    .order('session_index', { ascending: false })
    .limit(1)

  const sessionIndex = existingSessions?.[0]?.session_index
    ? (existingSessions[0].session_index as number) + 1
    : 1

  // Create the session row
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      session_index: sessionIndex,
      session_title: sessionTitle,
      scheduled_at: scheduledAt.toISOString(),
      duration_mins: durationMins,
      status: 'scheduled',
      meeting_url: null,
    })
    .select()
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: `Failed to create session: ${sessionError?.message}` }, { status: 500 })
  }

  // Immediately create the Google Meet (bypassing the cron window)
  const walkthroughUrl = `${process.env.NEXT_PUBLIC_APP_URL}/walkthrough/${userId}`

  try {
    const { botId, meetingUrl } = await createGoogleMeetSession(
      userId,
      walkthroughUrl,
      sessionTitle
    )

    // Store meeting_url on the session
    await supabase
      .from('sessions')
      .update({ meeting_url: meetingUrl })
      .eq('id', session.id)

    // Upsert walkthrough_state with bot info
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
      scheduledAt: scheduledAt.toISOString(),
      meetingUrl,
      botId,
      walkthroughUrl,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to create meeting: ${message}` }, { status: 500 })
  }
}
