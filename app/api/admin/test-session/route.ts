import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
import { isTestSessionEnabled } from '@/lib/admin-access'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'

/**
 * POST /api/admin/test-session
 * Creates a test session and sends the active meeting bot provider's bot
 * (Recall.ai or Attendee, per MEETING_BOT_PROVIDER) into an existing meeting URL.
 * For testing only — bypasses the 25-35 min cron window.
 * Body: { title?, meetingUrl, durationMins? }
 * B2B-21 Requirement Doc §7 — gated `requireSuperAdmin()` (previously bare `auth()`).
 */
export async function POST(request: NextRequest) {
  if (!isTestSessionEnabled()) {
    return NextResponse.json(
      { error: 'Test session endpoint is disabled' },
      { status: 403 }
    )
  }

  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const userId = admin.clerkUserId

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
      planned_duration_mins: durationMins,
      status: 'scheduled',
      meeting_url: meetingUrl,
    })
    .select()
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: `Failed to create session: ${sessionError?.message}` }, { status: 500 })
  }

  const walkthroughUrl = `${process.env.NEXT_PUBLIC_APP_URL}/walkthrough/${userId}`
  console.log('[test-session] walkthroughUrl sent to bot:', walkthroughUrl)

  try {
    const botProvider = getMeetingBotProvider()
    const { botId } = await botProvider.createBot(meetingUrl, userId, walkthroughUrl, session.id as string)
    console.log('[test-session] bot created:', botId)

    // Record which provider actually ran this session — see migration
    // 070_sessions_meeting_bot_provider.sql.
    await supabase
      .from('sessions')
      .update({ meeting_bot_provider: botProvider.name })
      .eq('id', session.id)

    const { error: upsertError } = await supabase
      .from('walkthrough_state')
      .upsert(
        {
          user_id: userId,
          bot_id: botId,
          meeting_url: meetingUrl,
          session_id: session.id,
          status: 'idle',
          visual_spec: null,
        },
        { onConflict: 'user_id' }
      )

    if (upsertError) {
      console.error('[test-session] walkthrough_state upsert failed:', upsertError)
    } else {
      console.log('[test-session] walkthrough_state upserted for user:', userId, 'bot:', botId)
    }

    // LIVE-01 parity fix: /api/sessions/[id]/start (commit fcd4aa7) now resets
    // the per-user walkthrough_state live-conductor fields at the start of every
    // real session, because that row is a singleton reused across sessions and
    // stale tab index/visual state otherwise carries over (the "static page"
    // bug). This dev-only shortcut creates/updates the same walkthrough_state
    // row above, so it must apply the identical reset or testing via this route
    // can reproduce that same stale-state bug.
    const { error: resetError } = await supabase
      .from('walkthrough_state')
      .update({
        live_conductor_tab_index: 0,
        live_conductor_visual: null,
        live_conductor_tab_turn_count: 0,
      })
      .eq('user_id', userId)

    if (resetError) {
      console.error('[test-session] live_conductor state reset failed:', resetError)
    }

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
