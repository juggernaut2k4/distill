import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { createBot, deleteBot } from '@/lib/recall'
import { getAllReadySections, type SessionPlan } from '@/lib/session-plan'

const CreateBotSchema = z.object({
  meetingUrl: z.string().url(),
  sessionId: z.string().uuid(),
  skippedTopics: z.array(z.string()).optional().default([]),
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

  const { meetingUrl, sessionId, skippedTopics } = parsed.data

  // Public URL — no auth required so the Recall.ai headless browser can render it
  const walkthroughUrl = `${process.env.NEXT_PUBLIC_APP_URL}/walkthrough/${userId}`

  try {
    const { botId } = await createBot(meetingUrl, userId, walkthroughUrl)

    const supabase = createSupabaseAdminClient()

    // Load session title + pre-generated template sections from the session plan
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('session_title, topic_id, session_plan')
      .eq('id', sessionId)
      .single()

    const sessionTitle = sessionData?.session_title ?? null
    const topicId = sessionData?.topic_id ?? null
    const readySections = getAllReadySections(sessionData?.session_plan as SessionPlan | null)
    console.log(`[recall/bot] Session: "${sessionTitle}" — loading ${readySections.length} pre-generated sections`)

    // Fetch training scripts from topic_content_cache, aligned by subtopic_slug order
    let trainingScripts: unknown[] = []
    if (topicId && readySections.length > 0) {
      const slugs = readySections.map((s) => s.id)
      const { data: scriptRows } = await supabase
        .from('topic_content_cache')
        .select('subtopic_slug, training_script')
        .eq('topic_id', topicId)
        .in('subtopic_slug', slugs)
      const scriptMap = new Map((scriptRows ?? []).map((r) => [r.subtopic_slug, r.training_script]))
      // Preserve section order so training_scripts[i] matches sections[i]
      trainingScripts = readySections.map((s) => scriptMap.get(s.id) ?? null)
      console.log(`[recall/bot] Loaded ${scriptRows?.length ?? 0} training scripts`)
    }

    // Upsert walkthrough_state — onConflict ensures existing row is updated, not duplicated
    const { error: upsertErr } = await supabase.from('walkthrough_state').upsert(
      {
        user_id: userId,
        bot_id: botId,
        meeting_url: meetingUrl,
        session_id: sessionId,
        status: 'idle',
        visual_spec: null,
        topic_title: sessionTitle,
        topic_id: topicId,
        skipped_topics: skippedTopics,
        sections: readySections.length > 0 ? readySections : null,
        current_section_index: 0,
        training_scripts: trainingScripts.length > 0 ? trainingScripts : null,
      },
      { onConflict: 'user_id' }
    )
    if (upsertErr) console.error('[recall/bot] walkthrough_state upsert error:', upsertErr)

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
