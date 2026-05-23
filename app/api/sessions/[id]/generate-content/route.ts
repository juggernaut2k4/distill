/**
 * POST /api/sessions/[id]/generate-content
 * Runs the full 6-step content pipeline for a session inline (same pattern as
 * generate-plan — sequential Claude calls within maxDuration instead of Inngest,
 * so the session detail page can poll for completion).
 *
 * GET /api/sessions/[id]/generate-content
 * Returns the current content pipeline status + per-subtopic training scripts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateSessionContentOutline } from '@/lib/content/session-content-generator'
import { generateTrainingScript } from '@/lib/content/script-generator'
import { selectTemplate } from '@/lib/templates/selector'
import { generateTemplateData } from '@/lib/templates/generator'
import { getCachedSection, setCachedSection } from '@/lib/topic-cache'
import type { TemplateSection, TemplateMeta } from '@/lib/templates/types'

export const maxDuration = 120

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
    .select('topic_id, content_status, topics, session_title')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const topicId = session.topic_id ?? 'ai-fundamentals'
  const subtopicTitles = getSubtopics(topicId, session.topics)

  // Fetch per-subtopic pipeline state from cache
  const { data: cacheRows } = await supabase
    .from('topic_content_cache')
    .select('subtopic_slug, subtopic_title, pipeline_status, training_script, content_outline, template_type')
    .eq('topic_id', topicId)
    .in('subtopic_slug', subtopicTitles.map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 60)))

  const subtopicMap = new Map((cacheRows ?? []).map((r) => [r.subtopic_slug, r]))

  const subtopics = subtopicTitles.map((title) => {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 60)
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
      .select('id, session_title, topic_id, topics, content_status')
      .eq('id', params.id)
      .eq('user_id', userId!)
      .single(),
    supabase
      .from('users')
      .select('role, industry, ai_maturity')
      .eq('id', userId!)
      .single(),
  ])

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.content_status === 'ready') return NextResponse.json({ ok: true, status: 'already_ready' })

  const topicId = session.topic_id ?? 'ai-fundamentals'
  const topicTitle = session.session_title ?? 'AI Strategy Session'
  const subtopicTitles = getSubtopics(topicId, session.topics)
  const userContext = {
    role: userRow?.role ?? 'executive',
    industry: userRow?.industry ?? 'business',
    maturity: userRow?.ai_maturity ?? 'beginner',
  }

  // Mark generating immediately so GET can show progress
  await supabase
    .from('sessions')
    .update({ content_status: 'generating' })
    .eq('id', params.id)

  try {
    // Step 1: Generate content outlines for all subtopics
    const outline = await generateSessionContentOutline(
      params.id,
      topicId,
      topicTitle,
      subtopicTitles,
      userId!,
      userContext
    )

    // Steps 2-5: For each subtopic — sequential to stay within maxDuration
    for (const subtopicOutline of outline.subtopics) {
      const subtopicTitle = subtopicOutline.subtopic_title
      const subtopicSlug = subtopicOutline.subtopic_slug

      // Step 2: Training script
      const script = await generateTrainingScript(subtopicOutline, userContext)

      // Step 3: Template selection
      const templateType = selectTemplate(subtopicTitle, subtopicOutline.position)

      // Step 4: Template data (cache hit skips Claude)
      let section: TemplateSection | null = await getCachedSection(topicId, subtopicSlug, {
        role: userContext.role,
        industry: userContext.industry,
      })

      if (!section) {
        const meta: TemplateMeta = {
          subtopicTitle,
          sessionTitle: topicTitle,
          userRole: userContext.role,
          userIndustry: userContext.industry,
        }
        const data = await generateTemplateData(templateType, subtopicTitle, topicTitle, userContext)
        section = { id: subtopicSlug, type: templateType, data, meta, status: 'pending' } as TemplateSection

        // Write new section_data to cache (non-blocking)
        setCachedSection(topicId, subtopicSlug, subtopicTitle, section).catch(() => {})
      }

      // Step 5: Save script + outline to cache row
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 60)

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
            training_script: script,
            pipeline_status: 'ready',
            generated_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
            use_count: 1,
          },
          { onConflict: 'topic_id,subtopic_slug' }
        )
    }

    // Step 6: Mark session ready
    await supabase
      .from('sessions')
      .update({ content_status: 'ready' })
      .eq('id', params.id)

    return NextResponse.json({ ok: true, status: 'ready', subtopicsGenerated: outline.subtopics.length })
  } catch (err) {
    console.error('[generate-content] Pipeline failed:', err)
    await supabase
      .from('sessions')
      .update({ content_status: 'failed' })
      .eq('id', params.id)
    return NextResponse.json({ error: 'Content pipeline failed' }, { status: 500 })
  }
}
