import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { createBot, deleteBot } from '@/lib/recall'

const CreateBotSchema = z.object({
  meetingUrl: z.string().url(),
  sessionId: z.string().uuid(),
})

const DeleteBotSchema = z.object({
  botId: z.string().min(1),
})

/**
 * POST /api/recall/bot
 * Creates a Recall.ai bot, joins the meeting, and updates walkthrough_state.
 */
export async function POST(request: NextRequest) {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateBotSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 })
  }

  const { meetingUrl, sessionId } = parsed.data

  const walkthroughUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/walkthrough`

  try {
    const { botId } = await createBot(meetingUrl, userId, walkthroughUrl)

    const supabase = createSupabaseAdminClient()

    // Upsert walkthrough_state
    await supabase.from('walkthrough_state').upsert({
      user_id: userId,
      bot_id: botId,
      meeting_url: meetingUrl,
      session_id: sessionId,
      status: 'idle',
      visual_spec: null,
      topic_title: null,
      topic_id: null,
    })

    return NextResponse.json({ botId, walkthroughUrl }, { status: 200 })
  } catch (err) {
    console.error('[recall/bot POST] Error:', err)
    return NextResponse.json(
      { error: 'Failed to create bot' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/recall/bot
 * Stops and removes the Recall.ai bot, resets walkthrough_state to idle.
 */
export async function DELETE(request: NextRequest) {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = DeleteBotSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 })
  }

  const { botId } = parsed.data

  try {
    await deleteBot(botId)

    const supabase = createSupabaseAdminClient()
    await supabase.from('walkthrough_state').update({
      bot_id: null,
      meeting_url: null,
      status: 'idle',
      visual_spec: null,
      topic_title: null,
      topic_id: null,
    }).eq('user_id', userId)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error('[recall/bot DELETE] Error:', err)
    return NextResponse.json(
      { error: 'Failed to delete bot' },
      { status: 500 }
    )
  }
}
