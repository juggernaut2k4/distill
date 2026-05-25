import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'
import { generateTemplateData } from '@/lib/templates/generator'
import type { TemplateName, TemplateSection } from '@/lib/templates/types'

interface Params { params: { topicId: string } }

export const maxDuration = 120

/**
 * POST /api/kb/topics/[topicId]/regenerate-all
 * Regenerates every section of a topic in sequence using the current template type.
 * Applies all current generation rules (including word count constraints).
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users').select('email, role, industry, ai_maturity').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const { data: rows } = await supabase
    .from('topic_content_cache')
    .select('id, subtopic_slug, section_data, template_type')
    .eq('topic_id', params.topicId)
    .gt('expires_at', new Date().toISOString())
    .order('generated_at', { ascending: true })

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No sections found' }, { status: 404 })
  }

  const userContext = {
    role: user?.role ?? 'executive',
    industry: user?.industry ?? 'business',
    maturity: user?.ai_maturity ?? 'intermediate',
  }

  const results: Array<{ slug: string; ok: boolean; error?: string }> = []

  for (const row of rows) {
    const currentSection = row.section_data as TemplateSection
    const templateType = currentSection.type as TemplateName

    try {
      const generatedData = await generateTemplateData(
        templateType,
        currentSection.meta.subtopicTitle,
        currentSection.meta.sessionTitle,
        userContext,
      )

      const updatedSection = {
        id: currentSection.id,
        type: templateType,
        data: generatedData,
        meta: currentSection.meta,
        status: 'active',
      } as TemplateSection

      await supabase
        .from('topic_content_cache')
        .update({
          previous_section_data: currentSection,
          section_data: updatedSection,
          template_type: templateType,
          kb_feedback: null,
          qa_score: null,
          qa_result: null,
          qa_run_at: null,
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', row.id)

      results.push({ slug: row.subtopic_slug, ok: true })
    } catch (err) {
      console.error('[kb-regenerate-all] Failed for', row.subtopic_slug, err)
      results.push({ slug: row.subtopic_slug, ok: false, error: String(err) })
    }
  }

  const succeeded = results.filter((r) => r.ok).length
  return NextResponse.json({
    ok: true,
    total: rows.length,
    succeeded,
    failed: rows.length - succeeded,
    results,
  })
}
