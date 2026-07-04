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
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'
import type { SessionPlan } from '@/lib/session-plan'

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

export async function GET(req: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(req)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  // Get session to verify ownership and fetch content_status
  const { data: session } = await supabase
    .from('sessions')
    .select('topic_id, content_status, topics, session_title, session_plan, sub_sessions, live_conductor_content')
    .eq('id', params.id)
    .eq('user_id', userId!)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // LIVE-01 fix: the live-conductor pipeline branch (session-content-pipeline.ts,
  // "LIVE-01 BRANCH POINT") intentionally skips Steps D-G — it never writes rows to
  // topic_content_cache, since it stores everything on sessions.live_conductor_content
  // instead. The polling logic below was built against the old pipeline's readiness
  // signal (topic_content_cache rows) and had no path for the new one, so it reported
  // every subtopic stuck at 'pending' forever for live-conductor sessions even though
  // content_status was genuinely 'ready'. When live_conductor_content is populated,
  // short-circuit here and report every configured tab as 'ready' directly from it —
  // this is the authoritative source of truth for this session's content in that path.
  const liveConductorContent = (session as unknown as {
    live_conductor_content?: { tabs?: Array<{ subtopic_slug: string; subtopic_title: string }> } | null
  }).live_conductor_content
  if (session.content_status === 'ready' && liveConductorContent?.tabs?.length) {
    return NextResponse.json({
      content_status: 'ready',
      sub_sessions: liveConductorContent.tabs.map((tab) => ({
        title: tab.subtopic_title,
        slug: tab.subtopic_slug,
        pipeline_status: 'ready',
        training_script: null,
        content_outline: null,
        template_type: null,
      })),
    })
  }

  // The pipeline always writes topic_content_cache rows with topic_id = DB session UUID (params.id).
  // session.topic_id is the curriculum plan session_id — different value. Always use params.id here.
  const topicId = session.topic_id ?? 'ai-fundamentals'
  // Prefer session_plan sub_sessions → LLM-designed sub_sessions from approval → hardcoded catalog
  const planSubtopics = (session.session_plan as SessionPlan | null)?.sub_sessions
    ?.filter((s: { skipped?: boolean }) => !s.skipped)
    ?.map((s: { title: string }) => s.title) ?? []
  const rawSubtopicsGet = (session as unknown as { sub_sessions?: unknown }).sub_sessions
  const designedTitlesGet = Array.isArray(rawSubtopicsGet) && rawSubtopicsGet.length > 0
    ? (rawSubtopicsGet as Array<{ title: string }>).map((s) => s.title)
    : null
  const subtopicTitles = planSubtopics.length > 0
    ? planSubtopics
    : (designedTitlesGet ?? getSubtopics(topicId, session.topics as string[] | null))

  // Fetch per-subtopic pipeline state from cache.
  // Always query by DB session UUID (params.id) — that is what the pipeline writes.
  // Query by topic_id only; match in memory by both stored slug AND title-derived slug
  // so that sessions generated before the slug-anchoring fix still resolve correctly.
  const { data: cacheRows } = await supabase
    .from('topic_content_cache')
    .select('subtopic_slug, subtopic_title, pipeline_status, training_script, content_outline, template_type')
    .eq('topic_id', params.id)

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
    sub_sessions: subtopics,
  })
}

// ─── POST — kick off the canonical content pipeline via Inngest (fire-and-forget) ───
// AUTOGEN-01 Part B: repointed from the legacy async_jobs + clio/session.content.requested
// path to the canonical distill/session.content.generate event (session-content-pipeline.ts).
// Plan approval is NOT required to call this route (AUTOGEN-01 Section 3 Part C /
// Section 11 Q5) — only session ownership is checked.

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

  // Fire Inngest event — returns immediately, no blocking.
  // priority: 'immediate' distinguishes a user-initiated queue-jump from the
  // hourly cron's priority: 'background' (Part A step 6 / Part C step 2).
  await inngest.send({
    name: 'distill/session.content.generate',
    data: { sessionId: params.id, userId, priority: 'immediate' },
  })

  return NextResponse.json({ ok: true, status: 'queued' })
}

// ─── DELETE — reset status so the pipeline can be re-run ──────────────────────

export async function DELETE(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()
  await supabase
    .from('sessions')
    .update({ content_status: 'pending' })
    .eq('id', params.id)
    .eq('user_id', userId!)

  return NextResponse.json({ ok: true })
}
