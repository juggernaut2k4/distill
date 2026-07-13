/**
 * GET /api/admin/qa-session-context?sessionId=<uuid>
 *
 * QA endpoint — simulates what happens when a bot joins a session:
 *   1. Fetches session data, sections, training scripts, content outlines
 *   2. Generates topic context docs (or uses cached ones)
 *   3. Builds all 3 Clio documents
 *   4. Validates each document for completeness
 *   5. Returns a detailed QA report
 *
 * If sessionId is omitted, picks the most recent session with content_status = 'ready'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getAllReadySections, type SessionPlan } from '@/lib/session-plan'
import { buildAllClioDocs } from '@/lib/clio-context-builder'
import { generateTopicContextDoc } from '@/lib/content/topic-context-generator'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createSupabaseAdminClient()
  const sessionIdParam = request.nextUrl.searchParams.get('sessionId')

  // ── Find the session ───────────────────────────────────────────────────────
  let session: Record<string, unknown> | null = null

  if (sessionIdParam) {
    const { data } = await supabase
      .from('sessions')
      .select('id, session_title, topic_id, session_plan, session_index, content_status, user_id')
      .eq('id', sessionIdParam)
      .single()
    session = data
  } else {
    const { data } = await supabase
      .from('sessions')
      .select('id, session_title, topic_id, session_plan, session_index, content_status, user_id')
      .eq('content_status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    session = data
  }

  if (!session) {
    return NextResponse.json({
      ok: false,
      error: 'No session found. Run the content pipeline first (generate-content on a session).',
    }, { status: 404 })
  }

  const issues: string[] = []
  const sessionId = session.id as string
  const sessionTitle = (session.session_title as string) ?? 'AI Coaching Session'
  // SESS-01: content pipeline keys topic_content_cache by sessions.id (DB UUID), not sessions.topic_id (catalog slug)
  const topicId = sessionId
  const sessionIndex = (session.session_index as number | null) ?? null
  const sessionUserId = (session.user_id as string) ?? userId

  // ── User profile ──────────────────────────────────────────────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('role, industry, ai_maturity')
    .eq('id', sessionUserId)
    .single()
  const userRole = userRow?.role ?? 'executive'
  const userIndustry = userRow?.industry ?? 'business'

  // ── Load sections ─────────────────────────────────────────────────────────
  // Primary: session_plan JSONB (old pipeline). Fallback: topic_content_cache direct
  // query (new curriculum pipeline — writes cache rows but not session_plan).
  let readySections = getAllReadySections(session.session_plan as SessionPlan | null)

  if (readySections.length === 0 && topicId) {
    const { data: directRows } = await supabase
      .from('topic_content_cache')
      .select('subtopic_slug, subtopic_title, pipeline_status')
      .eq('topic_id', topicId)
      .eq('pipeline_status', 'ready')

    if (directRows && directRows.length > 0) {
      readySections = directRows.map((r) => ({
        id: r.subtopic_slug as string,
        meta: {
          subtopicTitle: (r.subtopic_title as string) ?? (r.subtopic_slug as string),
          sessionTitle,
          userRole,
          userIndustry,
        },
      })) as unknown as ReturnType<typeof getAllReadySections>
    }
  }

  if (readySections.length === 0) issues.push('No ready sections in session_plan — run visual generation first')

  // ── Fetch cache data ──────────────────────────────────────────────────────
  let trainingScripts: unknown[] = []
  let topicContextDocs: (string | null)[] = []
  let docs = { session_brief: '', topic_context: '', session_script: '', system_prompt: '' }

  const cacheCheck = {
    training_scripts_found: 0,
    content_outlines_found: 0,
    context_docs_found: 0,
    context_docs_generated: 0,
  }

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

    trainingScripts = readySections.map((s) => {
      const v = scriptMap.get(s.id) ?? null
      if (v) cacheCheck.training_scripts_found++
      return v
    })

    const contentOutlines = readySections.map((s) => {
      const v = outlineMap.get(s.id) ?? null
      if (v) cacheCheck.content_outlines_found++
      return v
    })

    // Generate or use cached context docs
    topicContextDocs = await Promise.all(
      readySections.map(async (s, i) => {
        const cached = ctxDocMap.get(s.id)
        if (cached) {
          cacheCheck.context_docs_found++
          return cached
        }
        const outline = contentOutlines[i] as Record<string, unknown> | null
        if (!outline) return null

        cacheCheck.context_docs_generated++
        return generateTopicContextDoc(
          {
            subtopic_title: s.meta.subtopicTitle,
            content_summary: outline.content_summary as string | undefined,
            key_concepts: outline.key_concepts as string[] | undefined,
            common_misconceptions: outline.common_misconceptions as string[] | undefined,
            executive_relevance: outline.executive_relevance as string | undefined,
            builds_on: outline.builds_on as string[] | undefined,
          },
          sessionTitle,
          { role: userRole, industry: userIndustry }
        )
      })
    )

    if (cacheCheck.training_scripts_found < readySections.length) {
      issues.push(`${readySections.length - cacheCheck.training_scripts_found} sections missing training scripts — run generate-content pipeline`)
    }

    docs = buildAllClioDocs({
      sessionTitle,
      sessionIndex,
      topicId,
      sections: readySections.map((s) => ({ id: s.id, meta: s.meta })),
      trainingScripts: trainingScripts as never[],
      topicContextDocs,
      userRole,
      userIndustry,
    })
  } else if (!topicId) {
    issues.push('Session has no topic_id')
  }

  // ── Validate document 1: session_brief ────────────────────────────────────
  const briefCheck = {
    built: docs.session_brief.length > 0,
    has_session_label: docs.session_brief.includes('Session'),
    has_agenda: docs.session_brief.includes('AGENDA'),
    has_rules: docs.session_brief.includes('RULES'),
    length: docs.session_brief.length,
    preview: docs.session_brief.slice(0, 300),
  }
  if (!briefCheck.has_agenda) issues.push('session_brief: missing AGENDA section')
  if (!briefCheck.has_rules) issues.push('session_brief: missing RULES section')

  // ── Validate document 2: topic_context ────────────────────────────────────
  const contextCheck = {
    built: docs.topic_context.length > 0,
    has_knowledge_header: docs.topic_context.includes('KNOWLEDGE BASE'),
    sections_covered: (docs.topic_context.match(/^##\s/gm) ?? []).length,
    has_qa: docs.topic_context.includes('ANTICIPATED QUESTIONS'),
    has_misconceptions: docs.topic_context.includes('MISCONCEPTIONS'),
    length: docs.topic_context.length,
    preview: docs.topic_context.slice(0, 400),
  }
  if (contextCheck.sections_covered < readySections.length) {
    issues.push(`topic_context: only ${contextCheck.sections_covered}/${readySections.length} sections have context docs`)
  }
  if (!contextCheck.has_qa) issues.push('topic_context: no Q&A section found')

  // ── Validate document 3: session_script ───────────────────────────────────
  const scriptCheck = {
    built: docs.session_script.length > 0,
    has_script_header: docs.session_script.includes('SESSION SCRIPT'),
    sections_with_teach: (docs.session_script.match(/^TEACH/gm) ?? []).length,
    sections_with_checkpoint: (docs.session_script.match(/^CHECKPOINT/gm) ?? []).length,
    has_screen_control: docs.session_script.includes('SCREEN CONTROL'),
    length: docs.session_script.length,
    preview: docs.session_script.slice(0, 400),
  }
  if (scriptCheck.sections_with_teach < readySections.length) {
    issues.push(`session_script: only ${scriptCheck.sections_with_teach}/${readySections.length} sections have TEACH content`)
  }

  // ── System prompt totals ───────────────────────────────────────────────────
  const systemPromptLength = docs.system_prompt.length
  // Generic sanity-check ceiling — warn if the system prompt is getting large.
  const withinLimits = systemPromptLength < 28000
  if (!withinLimits) {
    issues.push(`system_prompt is ${systemPromptLength} chars — unusually large (28k soft limit)`)
  }

  // ── Check current walkthrough_state ───────────────────────────────────────
  const { data: walkthroughState } = await supabase
    .from('walkthrough_state')
    .select('session_brief, topic_context, session_script, training_scripts, sections, current_section_index')
    .eq('user_id', sessionUserId)
    .single()

  const stateCheck = {
    has_session_brief: !!(walkthroughState?.session_brief),
    has_topic_context: !!(walkthroughState?.topic_context),
    has_session_script: !!(walkthroughState?.session_script),
    has_training_scripts: !!(walkthroughState?.training_scripts),
    has_sections: !!(walkthroughState?.sections),
    note: walkthroughState
      ? 'walkthrough_state exists — these values are from the last bot launch, not this QA run'
      : 'No walkthrough_state row yet — values will be set when bot joins',
  }

  return NextResponse.json({
    ok: issues.length === 0,
    session: {
      id: sessionId,
      title: sessionTitle,
      topic_id: topicId,
      session_index: sessionIndex,
      content_status: session.content_status,
    },
    user: { role: userRole, industry: userIndustry },
    sections: readySections.length,
    cache: cacheCheck,
    documents: {
      session_brief: briefCheck,
      topic_context: contextCheck,
      session_script: scriptCheck,
    },
    system_prompt: {
      total_length: systemPromptLength,
      within_size_limit: withinLimits,
    },
    walkthrough_state: stateCheck,
    issues: issues.length > 0 ? issues : ['None — all checks passed'],
  })
}
