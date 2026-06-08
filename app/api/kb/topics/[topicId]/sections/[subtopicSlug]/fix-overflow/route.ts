import { NextRequest } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'
import { fixOverflowedSection } from '@/lib/templates/generator'
import type { TemplateSection } from '@/lib/templates/types'

interface Params { params: { topicId: string; subtopicSlug: string } }

const OverflowNodeSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  overflowPx: z.number(),
})

const Body = z.object({
  overflowReport: z.array(OverflowNodeSchema).min(1),
})

/**
 * POST /api/kb/topics/[topicId]/sections/[subtopicSlug]/fix-overflow
 *
 * Streams Server-Sent Events (SSE) so the client can display real-time progress:
 *   { step: 'analyzing' | 'fetching' | 'calling_claude' | 'strategy' | 'saving' | 'complete' | 'error', msg, ...extras }
 *
 * On 'complete', the payload also includes { section, strategy, reason }.
 * On 'error', the payload includes { msg }.
 */
export async function POST(request: NextRequest, { params }: Params) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { userId, error } = await requireSessionAuth(request)
  if (error) {
    return new Response('data: ' + JSON.stringify({ step: 'error', msg: 'Unauthorized' }) + '\n\n', {
      status: 401,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return new Response('data: ' + JSON.stringify({ step: 'error', msg: 'Invalid request body' }) + '\n\n', {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  const { overflowReport } = body.data
  const totalOverflow = overflowReport.reduce((s, n) => s + n.overflowPx, 0)

  // ── SSE stream setup ──────────────────────────────────────────────────────
  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  const send = async (data: Record<string, unknown>) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  // Run the pipeline asynchronously so we can return the stream immediately
  ;(async () => {
    try {
      const supabase = createSupabaseAdminClient()

      // Step 1: Announce what was found
      await send({
        step: 'analyzing',
        msg: `Found ${overflowReport.length} overflowing node${overflowReport.length === 1 ? '' : 's'} (${totalOverflow}px total overflow)`,
        nodes: overflowReport.map((n) => `${n.nodeId} +${n.overflowPx}px`),
      })

      // Step 2: Auth check
      const { data: user } = await supabase
        .from('users').select('email').eq('id', userId!).single()

      if (!canAccessKB(user?.email)) {
        await send({ step: 'error', msg: 'Access denied' })
        return
      }

      // Step 3: Load section from DB
      await send({ step: 'fetching', msg: 'Loading current section from database...' })

      const { data: row } = await supabase
        .from('topic_content_cache')
        .select('id, section_data')
        .eq('topic_id', params.topicId)
        .eq('subtopic_slug', params.subtopicSlug)
        .maybeSingle()

      if (!row) {
        await send({ step: 'error', msg: 'Section not found in cache' })
        return
      }

      const currentSection = row.section_data as TemplateSection

      // Step 4: Call Claude
      await send({
        step: 'calling_claude',
        msg: `Sending to Claude — analyzing ${currentSection.type} template and choosing fix strategy...`,
        templateType: currentSection.type,
      })

      const { fixedSection, strategy, reason } = await fixOverflowedSection(
        currentSection,
        overflowReport
      )

      // Step 5: Report the chosen strategy
      const templateChanged = fixedSection.type !== currentSection.type
      await send({
        step: 'strategy',
        msg: `${strategy}${templateChanged ? ` — switching ${currentSection.type} → ${fixedSection.type}` : ''}: ${reason}`,
        strategy,
        templateChanged,
        fromType: currentSection.type,
        toType: fixedSection.type,
      })

      // Step 6: Persist
      await send({ step: 'saving', msg: 'Saving optimized section to database...' })

      await supabase
        .from('topic_content_cache')
        .update({
          previous_section_data: currentSection,
          section_data: fixedSection,
          template_type: fixedSection.type,
          kb_feedback: `[AUTO-FIX] ${strategy}: ${reason}`,
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', row.id)

      // Step 7: Done
      await send({
        step: 'complete',
        msg: reason,
        section: fixedSection,
        strategy,
        reason,
        templateChanged,
        fromType: currentSection.type,
        toType: fixedSection.type,
      })
    } catch (err) {
      console.error('[kb-fix-overflow] Pipeline failed:', err)
      await send({ step: 'error', msg: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      await writer.close()
    }
  })()

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
