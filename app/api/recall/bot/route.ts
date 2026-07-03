import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
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
    const [{ data: sessionData }, { data: userRow }, learningProfile, { data: walkthroughRow }] = await Promise.all([
      supabase
        .from('sessions')
        .select('session_title, topic_id, session_plan, session_index, curriculum_session_id, duration_mins, sub_sessions')
        .eq('id', sessionId)
        .single(),
      supabase
        .from('users')
        .select('role, industry, ai_maturity, role_level, primary_domain')
        .eq('id', userId)
        .single(),
      getUserLearningProfile(userId).catch(() => null),
      // SECURITY (CEO review fix): the audit token minted by POST
      // /api/sessions/[id]/start (which always runs before this route — see
      // SessionDetailClient.tsx's handleLaunchBot). Carried to the bot's headless
      // browser via the walkthroughUrl query param below — NEVER via
      // walkthrough_state's public poll endpoint (/api/walkthrough-state/[userId]
      // strips this column from its response on purpose, since that endpoint is
      // fully unauthenticated and userId-guessable).
      supabase.from('walkthrough_state').select('audit_token').eq('user_id', userId).maybeSingle(),
    ])

    const auditToken = (walkthroughRow?.audit_token as string | null) ?? null
    const tokenedWalkthroughUrl = auditToken
      ? `${walkthroughUrl}?token=${encodeURIComponent(auditToken)}`
      : walkthroughUrl

    const sessionTitle = sessionData?.session_title ?? 'AI Coaching Session'
    // topicId is used for context/labelling only (walkthrough_state.topic_id, logs).
    // Cache lookups always use sessionId (the DB UUID) — that is what the pipeline writes.
    const topicId = sessionData?.topic_id ?? sessionData?.curriculum_session_id ?? null
    const isCurriculumSession = !!sessionData?.curriculum_session_id
    const sessionDurationMins = (sessionData?.duration_mins as number | null) ?? 15
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
      console.log(`[recall/bot] Plan status: ${plan.plan_status}, sub_sessions: ${plan.sub_sessions?.length ?? 0}`)
      plan.sub_sessions?.forEach((s) => console.log(`  [recall/bot] sub_session: "${s.title}" visual_status=${s.visual_status} has_section=${!!s.template_section}`))
    }

    // ── Step 2: Build context docs ──────────────────────────────────────────
    let trainingScripts: unknown[] = []
    let topicContextDocs: (string | null)[] = []
    let docs = { session_brief: '', topic_context: '', session_script: '', system_prompt: '' }
    // Starts as the session-plan snapshot; overwritten with fresh cache data below when available.
    let freshSections: TemplateSection[] = readySections

    if (readySections.length > 0 || isCurriculumSession) {
      // The content pipeline always stores cache rows with topic_id = sessionId (the DB UUID).
      // topicId (catalog slug / curriculum_session_id) is for context/labelling only.
      const cacheQuery = supabase
        .from('topic_content_cache')
        .select('subtopic_slug, training_script, content_outline, topic_context_doc, section_data')
        .eq('topic_id', sessionId)   // always use the session UUID — pipeline key
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

        // Fallback: if readySections was empty (e.g. session_plan had no ready sub-sessions)
        // but the pipeline already wrote section_data to the cache, use those rows directly.
        // This prevents a blank walkthrough when isCurriculumSession was previously misevaluated
        // and content was written but readySections came back empty.
        if (freshSections.length === 0 && freshSectionMap.size > 0) {
          console.log(`[recall/bot] readySections empty but cache has ${freshSectionMap.size} section_data rows — using cache as fallback`)
          freshSections = (cacheRows ?? [])
            .filter((r) => r.section_data)
            .map((r) => ({
              ...(r.section_data as TemplateSection),
              meta: { ...(r.section_data as TemplateSection).meta, userRole, userIndustry },
            }))
          trainingScripts = freshSections.map((s) => scriptMap.get(s.id) ?? null)
        }
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
              .eq('topic_id', sessionId)   // pipeline stored under sessionId UUID
              .eq('subtopic_slug', slug)
          )
        ).catch((err) => console.error('[recall/bot] context doc cache write failed:', err))
      }

      const rawContextMode = process.env.CLIO_CONTEXT_MODE ?? ''
      const contextMode: 'all-upfront' | 'split' =
        rawContextMode === 'split' ? 'split' : 'all-upfront'
      if (rawContextMode && rawContextMode !== 'all-upfront' && rawContextMode !== 'split') {
        console.warn(`[recall/bot] CLIO_CONTEXT_MODE unrecognised ("${rawContextMode}") — defaulting to all-upfront`)
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
        sessionDurationMins,
      }, contextMode)

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

    // ── Step 2b: Prepend synthetic Session Overview section ─────────────────
    // Mirrors KB-VIZ-01 logic in KBTopicClient — the walkthrough page renders
    // sections directly from walkthrough_state, so the overview must be here too.
    const rawSubSessions = (sessionData as unknown as { sub_sessions?: unknown }).sub_sessions
    const subSessionTitles: string[] = Array.isArray(rawSubSessions)
      ? (rawSubSessions as Array<{ title?: string }>).map((s) => s.title ?? '').filter(Boolean)
      : []

    const syntheticOverview: TemplateSection | null = freshSections.length > 0 ? {
      id: 'session-overview',
      type: 'TopicHero',
      meta: { subtopicTitle: 'Session Overview', sessionTitle, userRole, userIndustry },
      data: {
        topic_name: sessionTitle,
        key_question: 'What will we cover in this session?',
        key_takeaways: subSessionTitles.length > 0 ? subSessionTitles : freshSections.map((s) => s.meta?.subtopicTitle ?? s.id),
        so_what_preview: `${sessionDurationMins}-minute session · ${freshSections.length} subtopic${freshSections.length !== 1 ? 's' : ''}`,
      },
      status: 'active' as const,
    } : null

    const sectionsWithOverview: TemplateSection[] = syntheticOverview
      ? [syntheticOverview, ...freshSections]
      : freshSections
    const scriptsWithOverview = syntheticOverview
      ? [null, ...trainingScripts]
      : trainingScripts

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
        sections: sectionsWithOverview.length > 0 ? sectionsWithOverview : null,
        sections_loaded_at: sectionsWithOverview.length > 0 ? new Date().toISOString() : null,
        current_section_index: 0,
        training_scripts: scriptsWithOverview.length > 0 ? scriptsWithOverview : null,
        session_brief: docs.session_brief || null,
        topic_context: docs.topic_context || null,
        session_script: docs.session_script || null,
        clio_session_context: docs.system_prompt || null,
      },
      { onConflict: 'user_id' }
    )
    if (preUpsertErr) console.error('[recall/bot] pre-bot walkthrough_state upsert error:', preUpsertErr)

    // ── Step 4: Create the bot — context is already in DB ───────────────────
    const provider = getMeetingBotProvider()
    console.log(`[recall/bot] Using provider: ${provider.name}`)
    const { botId } = await provider.createBot(meetingUrl, userId, tokenedWalkthroughUrl, sessionId)

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
    await getMeetingBotProvider().deleteBot(botId)

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
      // SECURITY: rotate the audit token out on teardown (see
      // lib/session-billing.ts mintAuditToken/verifyAuditToken) so a stale
      // token from this session can never be replayed against a future one.
      audit_token: null,
    }).eq('user_id', userId)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error('[recall/bot DELETE] Error:', err)
    return NextResponse.json({ error: 'Failed to delete bot' }, { status: 500 })
  }
}
