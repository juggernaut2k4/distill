import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { createBot, deleteBot } from '@/lib/recall'
import { getAllReadySections, type SessionPlan } from '@/lib/session-plan'
import { buildAllClioDocs } from '@/lib/clio-context-builder'
import { generateTopicContextDoc } from '@/lib/content/topic-context-generator'

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
 * Creates a Recall.ai bot, joins the meeting, and populates walkthrough_state
 * with all three Clio session documents (brief, topic context, script).
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
  const walkthroughUrl = `${process.env.NEXT_PUBLIC_APP_URL}/walkthrough/${userId}`

  try {
    const { botId } = await createBot(meetingUrl, userId, walkthroughUrl)
    const supabase = createSupabaseAdminClient()

    // ── Fetch session + user profile ────────────────────────────────────────
    const [{ data: sessionData }, { data: userRow }] = await Promise.all([
      supabase
        .from('sessions')
        .select('session_title, topic_id, session_plan, session_index')
        .eq('id', sessionId)
        .single(),
      supabase
        .from('users')
        .select('role, industry, ai_maturity')
        .eq('id', userId)
        .single(),
    ])

    const sessionTitle = sessionData?.session_title ?? 'AI Coaching Session'
    const topicId = sessionData?.topic_id ?? null
    const sessionIndex = (sessionData?.session_index as number | null) ?? null
    const readySections = getAllReadySections(sessionData?.session_plan as SessionPlan | null)
    const userRole = userRow?.role ?? 'executive'
    const userIndustry = userRow?.industry ?? 'business'

    console.log(`[recall/bot] "${sessionTitle}" — ${readySections.length} sections`)

    // ── Fetch training scripts + content outlines + cached context docs ─────
    let trainingScripts: unknown[] = []
    let topicContextDocs: (string | null)[] = []
    let docs = { session_brief: '', topic_context: '', session_script: '', system_prompt: '' }

    if (topicId && readySections.length > 0) {
      const slugs = readySections.map((s) => s.id)

      const { data: cacheRows } = await supabase
        .from('topic_content_cache')
        .select('subtopic_slug, training_script, content_outline, topic_context_doc')
        .eq('topic_id', topicId)
        .in('subtopic_slug', slugs)

      const scriptMap = new Map((cacheRows ?? []).map((r) => [r.subtopic_slug, r.training_script]))
      const outlineMap = new Map((cacheRows ?? []).map((r) => [r.subtopic_slug, r.content_outline]))
      const ctxDocMap = new Map((cacheRows ?? []).map((r) => [r.subtopic_slug, r.topic_context_doc as string | null]))

      trainingScripts = readySections.map((s) => scriptMap.get(s.id) ?? null)
      const contentOutlines = readySections.map((s) => outlineMap.get(s.id) ?? null)

      // Generate topic context docs for any subtopics that don't have one cached
      const contextDocUpdates: Array<{ slug: string; doc: string }> = []
      topicContextDocs = await Promise.all(
        readySections.map(async (s, i) => {
          const cached = ctxDocMap.get(s.id)
          if (cached) return cached

          const outline = contentOutlines[i] as {
            subtopic_title?: string
            content_summary?: string
            key_concepts?: string[]
            common_misconceptions?: string[]
            executive_relevance?: string
            builds_on?: string[]
          } | null

          if (!outline) return null

          const doc = await generateTopicContextDoc(
            {
              subtopic_title: s.meta.subtopicTitle,
              content_summary: outline.content_summary,
              key_concepts: outline.key_concepts,
              common_misconceptions: outline.common_misconceptions,
              executive_relevance: outline.executive_relevance,
              builds_on: outline.builds_on,
            },
            sessionTitle,
            { role: userRole, industry: userIndustry }
          )
          contextDocUpdates.push({ slug: s.id, doc })
          return doc
        })
      )

      // Persist any newly generated context docs to the cache (fire and forget)
      if (contextDocUpdates.length > 0) {
        Promise.all(
          contextDocUpdates.map(({ slug, doc }) =>
            supabase
              .from('topic_content_cache')
              .update({ topic_context_doc: doc })
              .eq('topic_id', topicId)
              .eq('subtopic_slug', slug)
          )
        ).catch((err) => console.error('[recall/bot] context doc cache write failed:', err))
      }

      // ── Build all 3 Clio documents ────────────────────────────────────────
      docs = buildAllClioDocs({
        sessionTitle,
        sessionIndex,
        topicId,
        sections: readySections.map((s) => ({ id: s.id, meta: s.meta })),
        trainingScripts: trainingScripts as never[],
        topicContextDocs,
        skippedTopics,
        userRole,
        userIndustry,
      })

      console.log(
        `[recall/bot] Built: brief=${docs.session_brief.length}c, ` +
        `context=${docs.topic_context.length}c, script=${docs.session_script.length}c`
      )
    }

    // ── Upsert walkthrough_state ────────────────────────────────────────────
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
        // Three-document context
        session_brief: docs.session_brief || null,
        topic_context: docs.topic_context || null,
        session_script: docs.session_script || null,
        // Legacy combined field — kept for fallback compatibility
        clio_session_context: docs.system_prompt || null,
      },
      { onConflict: 'user_id' }
    )
    if (upsertErr) console.error('[recall/bot] walkthrough_state upsert error:', upsertErr)

    return NextResponse.json({ botId, walkthroughUrl }, { status: 200 })
  } catch (err) {
    console.error('[recall/bot POST] Error:', err)
    return NextResponse.json({ error: 'Failed to create bot' }, { status: 500 })
  }
}

/**
 * DELETE /api/recall/bot
 * Stops the Recall.ai bot and clears all session context from walkthrough_state.
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
      sections: null,
      training_scripts: null,
      session_brief: null,
      topic_context: null,
      session_script: null,
      clio_session_context: null,
      current_section_index: 0,
    }).eq('user_id', userId)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error('[recall/bot DELETE] Error:', err)
    return NextResponse.json({ error: 'Failed to delete bot' }, { status: 500 })
  }
}
