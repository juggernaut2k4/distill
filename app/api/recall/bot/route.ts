import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getMeetingBotProvider } from '@/lib/meeting-bot/provider'
import { getAllReadySections, type SessionPlan } from '@/lib/session-plan'
import type { TemplateSection } from '@/lib/templates/types'
import type { LiveConductorTab } from '@/lib/content/live-conductor-content'
import { buildAllClioDocs } from '@/lib/clio-context-builder'
import { generateTopicContextDoc } from '@/lib/content/topic-context-generator'
import { getUserLearningProfile, buildProfileContextForClio } from '@/lib/learning/user-profile'
import { wrapSectionsWithBookends } from '@/lib/templates/session-bookends'

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
        .select('session_title, topic_id, session_plan, session_index, curriculum_session_id, duration_mins, planned_duration_mins, sub_sessions, content_status, live_conductor_content')
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
    const sessionDurationMins = (sessionData?.planned_duration_mins as number | null) ?? (sessionData?.duration_mins as number | null) ?? 15
    const sessionIndex = (sessionData?.session_index as number | null) ?? null
    const readySections = getAllReadySections(sessionData?.session_plan as SessionPlan | null)
    const userRole = userRow?.role ?? 'executive'
    const userIndustry = userRow?.industry ?? 'business'
    const currentDomain = (userRow?.primary_domain as string | null) ?? 'ai-ml'
    const learnerProfile = learningProfile
      ? buildProfileContextForClio(learningProfile, currentDomain)
      : null

    // ONDEMAND-02: hoisted ahead of the "Build context docs" block below (the
    // original ONDEMAND-01 computation of this same value at its point of use
    // further down happens AFTER buildAllClioDocs() is called, too late to be
    // passed into it) — computed here, side-effect-free, purely from
    // sessionData already fetched above, so buildAllClioDocs() can receive
    // isOnDemandSingleSection accurately. The later ONDEMAND-01 block's own
    // onDemandTestModeActive assignment is unchanged and remains the source of
    // truth for the rest of that block's logic.
    const onDemandSingleSectionForBrief =
      sessionData?.content_status === 'ready' &&
      !!(sessionData?.live_conductor_content as { tabs?: unknown[] } | null)?.tabs?.length &&
      process.env.LIVE_CONDUCTOR_ONDEMAND_TEST === 'true'

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
        isOnDemandSingleSection: onDemandSingleSectionForBrief,
      }, contextMode)

      console.log(
        `[recall/bot] Built: brief=${docs.session_brief.length}c, ` +
        `context=${docs.topic_context.length}c, script=${docs.session_script.length}c`
      )
    }

    // ── LIVE-01 fix (same root cause as GET /api/sessions/[id]/generate-content) ──
    // The live-conductor pipeline branch (session-content-pipeline.ts, "LIVE-01
    // BRANCH POINT") never writes rows to topic_content_cache — it stores
    // everything on sessions.live_conductor_content instead. Every readiness
    // signal above (readySections from session_plan, freshSections from
    // topic_content_cache) is blind to that path, so a genuinely ready
    // live-conductor session still falls through to the "no content" guard
    // below. Short-circuit here: if live_conductor_content has tabs and
    // content_status is 'ready', this session is ready to launch regardless of
    // the old-pipeline signals.
    const liveConductorContent = (sessionData as unknown as {
      content_status?: string
      live_conductor_content?: { tabs?: LiveConductorTab[] } | null
    } | null)
    const hasLiveConductorContent =
      liveConductorContent?.content_status === 'ready' &&
      !!liveConductorContent?.live_conductor_content?.tabs?.length

    // ── CONTENT-POP-01 Part A ────────────────────────────────────────────────
    // Root-cause fix: hasLiveConductorContent correctly detects that this
    // session's content is ready, but nothing previously read that content into
    // freshSections/trainingScripts — the fields Step 2b and Step 3 below (and
    // downstream provisioning) actually consume. Map live_conductor_content.tabs
    // into both here, using ContentArticle's richest available fields since
    // ContentArticle has no template/script shape of its own (see
    // CONTENT-POP-01 requirement doc, Section 6, for the full field mapping and
    // rationale). Gated entirely inside `if (hasLiveConductorContent)` — when
    // false, this block never runs and freshSections/trainingScripts retain
    // exactly the values already computed above; zero behavior change for the
    // old-pipeline path.
    if (hasLiveConductorContent) {
      const tabs = liveConductorContent!.live_conductor_content!.tabs as LiveConductorTab[]

      freshSections = tabs.map((tab) => {
        const a = tab.article
        const misconceptions = a?.sections?.common_misconceptions ?? []
        return {
          id: tab.subtopic_slug,
          type: 'DefinitionTriptych',
          data: {
            term: a?.subtopic_title ?? tab.subtopic_title ?? '',
            category: 'AI Concept',
            what_it_is: a?.sections?.overview ?? '',
            real_example: {
              company: '',
              what: a?.sections?.illustrative_example ?? '',
              result: '',
            },
            common_myth: misconceptions[0] ?? '',
            so_what: a?.sections?.enterprise_implications ?? '',
          },
          meta: {
            subtopicTitle: a?.subtopic_title ?? tab.subtopic_title ?? '',
            sessionTitle,
            userRole,
            userIndustry,
          },
          status: 'ready',
        } as TemplateSection
      })

      trainingScripts = tabs.map((tab) => {
        const a = tab.article
        return {
          subtopic_title: a?.subtopic_title ?? tab.subtopic_title ?? '',
          subtopic_slug: a?.subtopic_slug ?? tab.subtopic_slug,
          segments: [
            {
              type: 'TEACH',
              content: [
                a?.sections?.overview ?? '',
                a?.sections?.how_it_works ?? '',
                a?.sections?.enterprise_implications ?? '',
              ].filter(Boolean).join(' '),
            },
          ],
        }
      })

      console.log(`[recall/bot] CONTENT-POP-01: mapped ${freshSections.length} live-conductor tabs into freshSections/trainingScripts for session=${sessionId}`)
    }

    // ── ONDEMAND-01: on-demand live screen generation test mode ─────────────
    // Disposable, server-side-only test toggle (see requirement doc
    // ONDEMAND-01-live-screen-generation-test-mode.md). Nested entirely inside
    // `if (hasLiveConductorContent)` so it is a strict no-op whenever that
    // guard is false, and it only overrides freshSections/trainingScripts —
    // never the full-tab-mapping block above, which always runs first and is
    // left completely untouched. When the env var is unset/anything other
    // than 'true', this block does nothing and freshSections/trainingScripts
    // retain exactly the values the CONTENT-POP-01 block above computed.
    let onDemandTestModeActive = false
    if (hasLiveConductorContent && process.env.LIVE_CONDUCTOR_ONDEMAND_TEST === 'true') {
      onDemandTestModeActive = true
      // Imported here (not hoisted to the top-level import block) so that
      // lines 1-344 of this file remain byte-for-byte unchanged from the
      // pre-ONDEMAND-01 version — see the requirement doc's Zero-Impact-
      // When-Off Verification Plan, static check #2. buildOverviewTeachContent
      // itself is reused completely unmodified.
      const { buildOverviewTeachContent } = await import('@/lib/templates/session-bookends')
      const tabs = liveConductorContent!.live_conductor_content!.tabs as LiveConductorTab[]
      const agenda = tabs.map((tab) => ({
        subtopic_title: tab.article?.subtopic_title ?? tab.subtopic_title ?? '',
        skipped: skippedTopics.includes(tab.article?.subtopic_title ?? tab.subtopic_title ?? ''),
      }))

      const overviewSection: TemplateSection = {
        id: 'session-overview',
        type: 'SessionOverview',
        meta: {
          subtopicTitle: 'Session Overview',
          sessionTitle,
          userRole,
          userIndustry,
        },
        data: {
          session_title: sessionTitle,
          agenda,
          framing_line: "Let's dive in.",
          script: {
            teach: buildOverviewTeachContent(sessionTitle, agenda),
            checkpoint: 'Does that agenda work for you, or is there something specific you want to make sure we get to?',
            continue: "Perfect — let's dive into the first one.",
          },
        },
        status: 'ready',
      }

      freshSections = [overviewSection]
      trainingScripts = []

      console.log(`[recall/bot] ONDEMAND-01: on-demand test mode active — writing Overview-only sections for session=${sessionId}`)
    }

    // ── Guard: refuse to launch a curriculum session with no content ────────
    // A missing-sections launch silently degrades to on-the-fly generation —
    // invisible during the call and much harder to debug than a clear error now.
    if (isCurriculumSession && freshSections.length === 0 && !hasLiveConductorContent) {
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

    // ── Step 2b: Wrap with SessionOverview / SessionSummary bookends ─────────
    // SCREEN-01: previously this synthesised an ad-hoc Overview here using
    // TopicHero (a title-card template, not a dedicated Overview screen) and
    // never added a Summary at all — a second, independent source of the same
    // section_index inconsistency this fix eliminates. Now uses the single
    // shared helper (lib/templates/session-bookends.ts) so this route produces
    // byte-for-byte the same Overview/Summary contract as
    // inngest/session-meeting-setup.ts. Real subtopics shift from 0..N-1 to
    // 1..N; Overview lands at 0, Summary at N+1.
    // ONDEMAND-01: when on-demand test mode already built the final 1-element
    // Overview-only sections array above, it must be used as-is — running it
    // back through wrapSectionsWithBookends would treat the Overview section
    // as if it were a real subtopic and wrap it in a second Overview/Summary.
    const sectionsWithOverview: TemplateSection[] = onDemandTestModeActive
      ? freshSections
      : freshSections.length > 0
      ? wrapSectionsWithBookends(freshSections, sessionTitle, skippedTopics)
      : []
    // training_scripts stays real-subtopics-only (N-length, 0-indexed) — Overview
    // and Summary have no TEACH script. relay-handler.ts's clampedIndex-1 offset
    // math (and WalkthroughClient's existing idx-1 split-mode math) account for
    // this intentional length difference against the N+2-length sections array.
    const scriptsWithOverview = trainingScripts

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
