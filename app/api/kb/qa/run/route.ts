import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'
import { runQAOnTopic } from '@/lib/kb-qa-agent'
import type { TemplateSection } from '@/lib/templates/types'

export const maxDuration = 120

const Body = z.object({ topicId: z.string().min(1) })

/**
 * POST /api/kb/qa/run
 * Runs the QA agent on all sections of a topic.
 * Reviews content quality and layout using the renderer source code.
 * Saves QA results to topic_content_cache and rule candidates to kb_qa_rules.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = Body.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json({ error: 'topicId required' }, { status: 400 })
  }

  const { topicId } = body.data

  // Fetch sections for this topic
  const { data: rows } = await supabase
    .from('topic_content_cache')
    .select('id, subtopic_slug, subtopic_title, section_data')
    .eq('topic_id', topicId)
    .gt('expires_at', new Date().toISOString())

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No sections found for this topic' }, { status: 404 })
  }

  // Fetch approved rules to include in QA prompt
  const { data: approvedRuleRows } = await supabase
    .from('kb_qa_rules')
    .select('rule_text')
    .eq('status', 'approved')

  const approvedRules = (approvedRuleRows ?? []).map((r: { rule_text: string }) => r.rule_text)

  // Fetch all existing rule texts to avoid duplicates when synthesizing
  const { data: allRuleRows } = await supabase
    .from('kb_qa_rules')
    .select('rule_text')
    .neq('status', 'rejected')

  const existingRuleTexts = (allRuleRows ?? []).map((r: { rule_text: string }) => r.rule_text)

  // Run QA
  const sections = rows.map((r) => ({
    subtopic_slug: r.subtopic_slug,
    subtopic_title: r.subtopic_title ?? r.subtopic_slug,
    section_data: r.section_data as TemplateSection,
  }))

  const { results, candidates } = await runQAOnTopic(
    topicId,
    sections,
    approvedRules,
    existingRuleTexts
  )

  // Save QA results back to cache rows
  await Promise.all(
    results.map((result) => {
      const row = rows.find((r) => r.subtopic_slug === result.subtopic_slug)
      if (!row) return Promise.resolve()
      return supabase
        .from('topic_content_cache')
        .update({
          qa_score: result.overall_score,
          qa_result: result,
          qa_run_at: new Date().toISOString(),
        })
        .eq('id', row.id)
    })
  )

  // Save rule candidates as pending
  let savedCandidates = 0
  for (const candidate of candidates) {
    const { error: insertError } = await supabase
      .from('kb_qa_rules')
      .insert({
        rule_text: candidate.rule_text,
        justification: candidate.justification,
        evidence: candidate.evidence,
        category: candidate.category,
        status: 'pending',
        source_topic_id: topicId,
      })
    if (!insertError) savedCandidates++
  }

  const avgScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.overall_score, 0) / results.length)
    : 0

  return NextResponse.json({
    ok: true,
    sections_reviewed: results.length,
    avg_score: avgScore,
    candidates_added: savedCandidates,
    results,
  })
}
