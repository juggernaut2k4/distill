import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { createBot, deleteBot } from '@/lib/recall'
import { getAllReadySections, type SessionPlan } from '@/lib/session-plan'
import type { TemplateSection } from '@/lib/templates/types'
import { buildAllClioDocs } from '@/lib/clio-context-builder'
import { generateTopicContextDoc } from '@/lib/content/topic-context-generator'
import { getUserLearningProfile, buildProfileContextForClio } from '@/lib/learning/user-profile'

const CreateBotSchema = z.object({
  meetingUrl: z.string().url(),
  sessionId: z.string().uuid(),
  skippedTopics: z.array(z.string()).optional().default([]),
})

const DeleteBotSchema = z.object({
  botId: z.string().min(1),
})

export const maxDuration = 120

/**
 * POST /api/recall/bot
 * Builds all Clio context docs, writes them to walkthrough_state FIRST,
 * then creates the Recall.ai bot — so by the time Recall.ai's headless
 * browser loads the walkthrough URL the context is already in the DB and
 * WalkthroughClient receives it as initialState on the first server render.
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
    const supabase = createSupabaseAdminClient()

    // ── Step 1: Fetch session + user profile ────────────────────────────────
    const [{ data: sessionData }, { data: userRow }, learningProfile] = await Promise.all([
      supabase
        .from('sessions')
        .select('session_title, topic_id, session_plan, session_index, curriculum_session_id')
        .eq('id', sessionId)
        .single(),
      supabase
        .from('users')
        .select('role, industry, ai_maturity, primary_domain')
        .eq('id', userId)
        .single(),
      getUserLearningProfile(userId).catch(() => null),
    ])

    const sessionTitle = sessionData?.session_title ?? 'AI Coaching Session'
    // Curriculum sessions have topic_id=NULL — use curriculum_session_id as the effective
    // cache key so sections and training scripts are found in topic_content_cache.
    const topicId = sessionData?.topic_id ?? sessionData?.curriculum_session_id ?? null
    const isCurriculumSession = !sessionData?.topic_id && !!sessionData?.curriculum_session_id
    const sessionIndex = (sessionData?.session_index as number | null) ?? null
    const readySections = getAllReadySections(sessionData?.session_plan as SessionPlan | null)
    const userRole = userRow?.role ?? 'executive'
    const userIndustry = userRow?.industry ?? 'business'
    const currentDomain = (userRow?.primary_domain as string | null) ?? 'ai-ml'
    const learnerProfile = learningProfile
      ? buildProfileContextForClio(learningProfile, currentDomain)
      : null

    console.log(`[recall/bot] "${sessionTitle}" — ${readySections.length} ready sections, topicId=${topicId}`)
    if (readySections.length === 0 && sessionData?.session_plan) {
      const plan = sessionData.session_plan as SessionPlan
      console.log(`[recall/bot] Plan status: ${plan.plan_status}, subtopics: ${plan.subtopics?.length ?? 0}`)
      plan.subtopics?.forEach((s) => console.log(`  [recall/bot] subtopic: "${s.title}" visual_status=${s.visual_status} has_section=${!!s.template_section}`))
    }

    // ── Step 2: Build context docs ──────────────────────────────────────────
    let trainingScripts: unknown[] = []
    let topicContextDocs: (string | null)[] = []
    let docs = { session_brief: '', topic_context: '', session_script: '', system_prompt: '' }
    // Starts as the session-plan snapshot; overwritten with fresh cache data below when available.
    let freshSections: TemplateSection[] = readySections

    if (topicId && (readySections.length > 0 || isCurriculumSession)) {
      // Old-style sessions: filter by known slugs from session_plan.
      // Curriculum sessions: load ALL cache rows for this curriculum_session_id
      // (no session_plan slug list — the pipeline owns the ordering via generated_at).
      const cacheQuery = supabase
        .from('topic_content_cache')
        .select('subtopic_slug, training_script, content_outline, topic_context_doc, section_data')
        .eq('topic_id', topicId)
        .eq('pipeline_status', 'ready')

      const { data: cacheRows } = isCurriculumSession
        ? await cacheQuery.order('generated_at', { ascending: true })
        : await cacheQuery.in('subtopic_slug', readySections.map((s) => s.id))

      const slugs = isCurriculumSession ? (cacheRows ?? []).map((r) => r.subtopic_slug) : readySections.map((s) => s.id)
      console.log(`[recall/bot] Querying cache: topic_id=${topicId}, curriculum=${isCurriculumSession}, slugs=[${slugs.join(', ')}]`)
      console.log(`[recall/bot] Cache rows found: ${cacheRows?.length ?? 0}`, (cacheRows ?? []).map((r) => `${r.subtopic_slug}(script=${r.training_script ? 'yes' : 'no'}, section_data=${r.section_data ? 'yes' : 'null'})`))

      const scriptMap = new Map((cacheRows ?? []).map((r) => [r.subtopic_slug, r.training_script]))
      const outlineMap = new Map((cacheRows ?? []).map((r) => [r.subtopic_slug, r.content_outline]))
      const ctxDocMap = new Map((cacheRows ?? []).map((r) => [r.subtopic_slug, r.topic_context_doc as string | null]))

      // Build a map of fresh section_data from cache so we always render the latest
      // regenerated content — not the snapshot frozen inside the session plan.
      const freshSectionMap = new Map(
        (cacheRows ?? [])
          .filter((r) => r.section_data)
          .map((r) => [r.subtopic_slug, r.section_data as TemplateSection])
      )

      console.log(`[recall/bot] freshSectionMap has ${freshSectionMap.size} entries with section_data`)

      if (isCurriculumSession) {
        // Curriculum sessions: build freshSections directly from all cache rows (ordered by generated_at).
        // No session_plan to fall back to — cache is the source of truth.
        freshSections = (cacheRows ?? [])
          .filter((r) => r.section_data)
          .map((r) => ({
            ...(r.section_data as TemplateSection),
            meta: { ...(r.section_data as TemplateSection).meta, userRole, userIndustry },
          }))
        trainingScripts = freshSections.map((s) => scriptMap.get(s.id) ?? null)
        console.log(`[recall/bot] Curriculum: built ${freshSections.length} sections from cache`)
      } else {
        // Old-style sessions: replace each session_plan section with the latest cache version.
        // Falls back to the session-plan snapshot if the slug isn't cached yet.
        freshSections = readySections.map((s) => {
          const cached = freshSectionMap.get(s.id)
          if (!cached) {
            console.log(`[recall/bot] FALLBACK to session plan snapshot for slug="${s.id}" — no section_data in cache`)
            return s
          }
          console.log(`[recall/bot] Using KB-fresh section for slug="${s.id}" type=${cached.type}`)
          return {
            ...cached,
            meta: { ...cached.meta, userRole, userIndustry },
          } as TemplateSection
        })
        trainingScripts = freshSections.map((s) => scriptMap.get(s.id) ?? null)
      }

      const contentOutlines = slugs.map((slug) => outlineMap.get(slug) ?? null)

      const contextDocUpdates: Array<{ slug: string; doc: string }> = []
      topicContextDocs = await Promise.all(
        freshSections.map(async (s, i) => {
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

      docs = buildAllClioDocs({
        sessionTitle,
        sessionIndex,
        topicId,
        sections: freshSections.map((s) => ({ id: s.id, meta: s.meta })),
        trainingScripts: trainingScripts as never[],
        topicContextDocs,
        skippedTopics,
        userRole,
        userIndustry,
        learnerProfile,
      })

      console.log(
        `[recall/bot] Built: brief=${docs.session_brief.length}c, ` +
        `context=${docs.topic_context.length}c, script=${docs.session_script.length}c`
      )
    }

    // ── Guard: refuse to launch a curriculum session with no content ────────
    // A missing-sections launch silently degrades to on-the-fly generation —
    // invisible during the call and much harder to debug than a clear error now.
    if (isCurriculumSession && freshSections.length === 0) {
      console.error(
        `[recall/bot] BLOCKED: no sections in topic_content_cache for ` +
        `curriculum session topic_id=${topicId} session=${sessionId}. ` +
        `Run generate-content for this session first.`
      )
      return NextResponse.json(
        {
          error: 'Session content not ready. Please generate content for this session before launching.',
          code: 'CONTENT_NOT_READY',
        },
        { status: 400 }
      )
    }

    // ── Step 3: Write context to walkthrough_state BEFORE bot creation ───────
    // Critical: Recall.ai loads walkthroughUrl immediately after createBot returns.
    // If context is stored after bot creation, the server-render races and
    // WalkthroughClient gets empty initialState → Clio connects with no context.
    const { error: preUpsertErr } = await supabase.from('walkthrough_state').upsert(
      {
        user_id: userId,
        bot_id: null,                                              // filled in after bot creation
        meeting_url: meetingUrl,
        session_id: sessionId,
        status: 'idle',
        visual_spec: null,
        topic_title: sessionTitle,
        topic_id: topicId,
        skipped_topics: skippedTopics,
        sections: freshSections.length > 0 ? freshSections : null,
        current_section_index: 0,
        training_scripts: trainingScripts.length > 0 ? trainingScripts : null,
        session_brief: docs.session_brief || null,
        topic_context: docs.topic_context || null,
        session_script: docs.session_script || null,
        clio_session_context: docs.system_prompt || null,
      },
      { onConflict: 'user_id' }
    )
    if (preUpsertErr) console.error('[recall/bot] pre-bot walkthrough_state upsert error:', preUpsertErr)

    // ── Step 4: Create the bot — context is already in DB ───────────────────
    const { botId } = await createBot(meetingUrl, userId, walkthroughUrl)

    // Update with the real botId now that we have it
    await supabase
      .from('walkthrough_state')
      .update({ bot_id: botId })
      .eq('user_id', userId)

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
