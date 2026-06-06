/**
 * POST /api/sessions/[id]/generate-content
 * Runs the full 6-step content pipeline for a session inline.
 *
 * GET /api/sessions/[id]/generate-content
 * Returns the current content pipeline status + per-subtopic training scripts.
 *
 * DELETE /api/sessions/[id]/generate-content
 * Resets content_status to 'pending' so the pipeline can be re-run after a failure.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateSessionContentOutline } from '@/lib/content/session-content-generator'
import { generateTrainingScript, adaptScriptToDuration } from '@/lib/content/script-generator'
import { selectTemplate } from '@/lib/templates/selector'
import { generateTemplateData } from '@/lib/templates/generator'
import { getCachedSection, setCachedSection } from '@/lib/topic-cache'
import type { TemplateSection, TemplateMeta } from '@/lib/templates/types'
import type { SessionPlan } from '@/lib/session-plan'
import type { SubtopicOutline } from '@/lib/content/session-content-generator'

export const maxDuration = 300

// ─── SUBTOPICS CATALOG ────────────────────────────────────────────────────────
// Inline copy to avoid circular imports from generate-plan route

function getSubtopics(topicId: string, sessionTopics: string[] | null): string[] {
  if (sessionTopics && sessionTopics.length > 0) return sessionTopics
  const FALLBACKS: Record<string, string[]> = {
    'ai-fundamentals': [
      'What generative AI is and why this moment is strategically different',
      'The foundation model landscape: GPT, Claude, Gemini — what they share',
      'What AI can realistically do today vs. what vendors claim',
      'The three decisions every executive must make in the next 12 months',
      'How to frame AI as a capability, not a one-time project',
    ],
  }
  return FALLBACKS[topicId] ?? FALLBACKS['ai-fundamentals']
}

interface Params { params: { id: string } }

// ─── GET — poll content pipeline status ───────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  // Get session to verify ownership and fetch content_status
  const { data: session } = await supabase
    .from('sessions')
    .select('topic_id, content_status, topics, session_title, session_plan')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const topicId = session.topic_id ?? 'ai-fundamentals'
  // Prefer session_plan subtopics → LLM-designed subtopics from approval → hardcoded catalog
  const planSubtopics = (session.session_plan as SessionPlan | null)?.subtopics
    ?.filter((s: { skipped?: boolean }) => !s.skipped)
    ?.map((s: { title: string }) => s.title) ?? []
  const rawSubtopicsGet = (session as unknown as { subtopics?: unknown }).subtopics
  const designedTitlesGet = Array.isArray(rawSubtopicsGet) && rawSubtopicsGet.length > 0
    ? (rawSubtopicsGet as Array<{ title: string }>).map((s) => s.title)
    : null
  const subtopicTitles = planSubtopics.length > 0
    ? planSubtopics
    : (designedTitlesGet ?? getSubtopics(topicId, session.topics as string[] | null))

  // Fetch per-subtopic pipeline state from cache.
  // Query by topic_id only; match in memory by both stored slug AND title-derived slug
  // so that sessions generated before the slug-anchoring fix still resolve correctly.
  const { data: cacheRows } = await supabase
    .from('topic_content_cache')
    .select('subtopic_slug, subtopic_title, pipeline_status, training_script, content_outline, template_type')
    .eq('topic_id', topicId)

  const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 60)

  const subtopicMap = new Map<string, NonNullable<typeof cacheRows>[number]>()
  for (const row of cacheRows ?? []) {
    subtopicMap.set(row.subtopic_slug, row)
    // Secondary index: slug derived from the stored title catches drift between Claude's
    // returned title and the session_plan title.
    if (row.subtopic_title) subtopicMap.set(slugify(row.subtopic_title), row)
  }

  const subtopics = subtopicTitles.map((title) => {
    const slug = slugify(title)
    const row = subtopicMap.get(slug)
    return {
      title,
      slug,
      pipeline_status: row?.pipeline_status ?? 'pending',
      training_script: row?.training_script ?? null,
      content_outline: row?.content_outline ?? null,
      template_type: row?.template_type ?? null,
    }
  })

  return NextResponse.json({
    content_status: session.content_status ?? 'pending',
    subtopics,
  })
}

// ─── POST — run the full pipeline inline ──────────────────────────────────────

export async function POST(_req: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const [{ data: session }, { data: userRow }] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, session_title, topic_id, topics, content_status, session_plan, duration_mins, subtopics')
      .eq('id', params.id)
      .eq('user_id', userId!)
      .single(),
    supabase
      .from('users')
      .select('role, industry, ai_maturity, role_level')
      .eq('id', userId!)
      .single(),
  ])

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.content_status === 'ready') return NextResponse.json({ ok: true, status: 'already_ready' })

  const topicId = session.topic_id ?? 'ai-fundamentals'
  const topicTitle = session.session_title ?? 'AI Strategy Session'
  const sessionDurationMins: number = (session as { duration_mins?: number }).duration_mins ?? 30
  const planSubtopics = (session.session_plan as SessionPlan | null)?.subtopics
    ?.filter((s: { skipped?: boolean }) => !s.skipped)
    ?.map((s: { title: string }) => s.title) ?? []
  // Prefer: session_plan subtopics (already resolved) → LLM-designed subtopics from approval → hardcoded catalog
  const rawSubtopicsPost = (session as unknown as { subtopics?: unknown }).subtopics
  const designedTitlesPost = Array.isArray(rawSubtopicsPost) && rawSubtopicsPost.length > 0
    ? (rawSubtopicsPost as Array<{ title: string }>).map((s) => s.title)
    : null
  const subtopicTitles = planSubtopics.length > 0
    ? planSubtopics
    : (designedTitlesPost ?? getSubtopics(topicId, session.topics as string[] | null))
  const userContext = {
    role: userRow?.role ?? 'executive',
    industry: userRow?.industry ?? 'business',
    maturity: userRow?.ai_maturity ?? 'beginner',
    roleLevel: (userRow?.role_level as string | null) ?? 'c-suite',
  }

  // Mark generating immediately so GET can show progress
  await supabase
    .from('sessions')
    .update({ content_status: 'generating' })
    .eq('id', params.id)

  try {
    // Step 1: Generate content outlines for all subtopics in one Claude call
    console.log(`[generate-content][${params.id}] Step 1 start — topic: ${topicId}, subtopics: ${subtopicTitles.length}`)
    let outline
    try {
      outline = await generateSessionContentOutline(
        params.id,
        topicId,
        topicTitle,
        subtopicTitles,
        userId!,
        userContext
      )
    } catch (step1Err) {
      const msg = step1Err instanceof Error ? step1Err.message : String(step1Err)
      console.error(`[generate-content][${params.id}] Step 1 FAILED: ${msg}`)
      throw new Error(`Step 1 (outline generation) failed: ${msg}`)
    }
    console.log(`[generate-content][${params.id}] Step 1 done — ${outline.subtopics.length} subtopics`)

    // Steps 2–5: Process subtopics in parallel batches of 3 to stay within rate limits.
    // Each subtopic writes its own cache row incrementally so the GET poll can track progress.
    const BATCH_SIZE = 3

    const processSubtopic = async (subtopicOutline: SubtopicOutline) => {
      const subtopicTitle = subtopicOutline.subtopic_title
      const subtopicSlug = subtopicOutline.subtopic_slug
      console.log(`[generate-content][${params.id}] Processing subtopic: ${subtopicSlug}`)

      // Stamp as generating so polling sees it immediately
      await supabase
        .from('topic_content_cache')
        .upsert(
          { topic_id: topicId, subtopic_slug: subtopicSlug, subtopic_title: subtopicTitle, pipeline_status: 'generating' },
          { onConflict: 'topic_id,subtopic_slug' }
        )

      const templateType = selectTemplate(subtopicTitle, subtopicOutline.position)

      // Build contentSpec from Step 1 visual_spec — the single source of truth for both Step 2 and Step 3
      const contentSpec = subtopicOutline.visual_spec
        ? {
            headline: subtopicOutline.visual_spec.headline,
            items: subtopicOutline.visual_spec.items,
            so_what: subtopicOutline.visual_spec.so_what,
            summary: subtopicOutline.content_summary,
          }
        : undefined

      // Check cache before generating
      const cachedSection = await getCachedSection(topicId, subtopicSlug, {
        role: userContext.role,
        industry: userContext.industry,
      })

      const meta: TemplateMeta = {
        subtopicTitle,
        sessionTitle: topicTitle,
        userRole: userContext.role,
        userIndustry: userContext.industry,
      }

      // Step 2 (visual) and Step 3 (script) run in PARALLEL, both derived from Step 1 outline.
      // contentSpec ensures the visual renders exactly the items Clio will name in the script.
      const sessionCtx = {
        allSubtopics: subtopicTitles,
        nextSessionTopic: undefined as string | undefined, // TODO: pass next session topic when available
      }
      const [section, script] = await Promise.all([
        cachedSection
          ? Promise.resolve(cachedSection)
          : generateTemplateData(templateType, subtopicTitle, topicTitle, userContext, undefined, contentSpec)
              .then((data) => {
                const newSection = { id: subtopicSlug, type: templateType, data, meta, status: 'pending' } as TemplateSection
                setCachedSection(topicId, subtopicSlug, subtopicTitle, newSection).catch(() => {})
                return newSection
              }),
        generateTrainingScript(subtopicOutline, userContext, sessionCtx),
      ])

      // Adapt the canonical script to this user's session duration
      const adaptedScript = await adaptScriptToDuration(
        script,
        sessionDurationMins,
        subtopicTitles.length
      )

      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 60)

      // KB stores the CANONICAL script (for reuse by other users).
      // adapted_script (duration-condensed) is stored separately in session_plan JSONB.
      await supabase
        .from('topic_content_cache')
        .upsert(
          {
            topic_id: topicId,
            subtopic_slug: subtopicSlug,
            subtopic_title: subtopicTitle,
            template_type: templateType,
            section_data: section,
            content_outline: subtopicOutline,
            training_script: script,       // canonical 1-hr version
            pipeline_status: 'ready',
            generated_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
            use_count: 1,
          },
          { onConflict: 'topic_id,subtopic_slug' }
        )

      // Persist the duration-adapted script into the session_plan for this subtopic
      const { data: currentSession } = await supabase
        .from('sessions')
        .select('session_plan')
        .eq('id', params.id)
        .single()
      if (currentSession?.session_plan) {
        const plan = currentSession.session_plan as SessionPlan
        const updatedSubtopics = plan.subtopics?.map((sub: { title: string; adapted_script?: unknown }) =>
          sub.title === subtopicTitle ? { ...sub, adapted_script: adaptedScript } : sub
        )
        await supabase
          .from('sessions')
          .update({ session_plan: { ...plan, subtopics: updatedSubtopics } })
          .eq('id', params.id)
      }
    }

    for (let i = 0; i < outline.subtopics.length; i += BATCH_SIZE) {
      await Promise.all(outline.subtopics.slice(i, i + BATCH_SIZE).map(processSubtopic))
    }

    // Step 6: Mark session ready
    await supabase
      .from('sessions')
      .update({ content_status: 'ready' })
      .eq('id', params.id)

    return NextResponse.json({ ok: true, status: 'ready', subtopicsGenerated: outline.subtopics.length })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[generate-content][${params.id}] Pipeline failed: ${detail}`)
    await supabase
      .from('sessions')
      .update({ content_status: 'failed' })
      .eq('id', params.id)
    return NextResponse.json({ error: 'Content pipeline failed', detail }, { status: 500 })
  }
}

// ─── DELETE — reset status so the pipeline can be re-run ──────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()
  await supabase
    .from('sessions')
    .update({ content_status: 'pending' })
    .eq('id', params.id)
    .eq('user_id', userId!)

  return NextResponse.json({ ok: true })
}
