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
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'
import type { SessionPlan } from '@/lib/session-plan'
import type { SubtopicOutline } from '@/lib/content/session-content-generator'

// These imports retained for the GET handler
import { generateSessionContentOutline } from '@/lib/content/session-content-generator'
import { generateTrainingScript, adaptScriptToDuration } from '@/lib/content/script-generator'
import { selectTemplate } from '@/lib/templates/selector'
import { generateTemplateData } from '@/lib/templates/generator'
import { getCachedSection, setCachedSection } from '@/lib/topic-cache'
import type { TemplateSection, TemplateMeta } from '@/lib/templates/types'

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

// ─── POST — kick off async pipeline via Inngest (returns jobId immediately) ───

export async function POST(req: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(req)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  // Quick ownership check before queuing
  const { data: session } = await supabase
    .from('sessions')
    .select('id, content_status')
    .eq('id', params.id)
    .eq('user_id', userId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.content_status === 'ready') {
    return NextResponse.json({ ok: true, status: 'already_ready' })
  }

  // Create async job row
  const { data: job, error: jobErr } = await supabase
    .from('async_jobs')
    .insert({ user_id: userId, type: 'session_content', payload: { sessionId: params.id } })
    .select('id')
    .single()

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }

  // Fire Inngest event — returns immediately, no blocking
  await inngest.send({
    name: 'clio/session.content.requested',
    data: { jobId: job.id, sessionId: params.id, userId },
  })

  return NextResponse.json({ jobId: job.id, status: 'queued' })
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
