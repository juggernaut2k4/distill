import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'
import { generateTemplateData } from '@/lib/templates/generator'
import type { TemplateName, TemplateSection } from '@/lib/templates/types'

interface Params { params: { topicId: string; subtopicSlug: string } }

const Body = z.object({
  templateType: z.string().optional(),
})

/**
 * POST /api/kb/topics/[topicId]/sections/[subtopicSlug]/regenerate
 * Regenerates a section from scratch, optionally with a different template type.
 * - No templateType or same type → fresh regeneration with current template
 * - Different templateType → switch template and regenerate
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users').select('email, role, industry, ai_maturity').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = Body.safeParse(await request.json().catch(() => ({})))
  if (!body.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const { data: row } = await supabase
    .from('topic_content_cache')
    .select('id, section_data, template_type')
    .eq('topic_id', params.topicId)
    .eq('subtopic_slug', params.subtopicSlug)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 })
  }

  const currentSection = row.section_data as TemplateSection
  const newTemplateType = (body.data.templateType ?? currentSection.type) as TemplateName

  const userContext = {
    role: user?.role ?? 'executive',
    industry: user?.industry ?? 'business',
    maturity: user?.ai_maturity ?? 'intermediate',
  }

  try {
    const generatedData = await generateTemplateData(
      newTemplateType,
      currentSection.meta.subtopicTitle,
      currentSection.meta.sessionTitle,
      userContext,
    )

    const updatedSection = {
      id: currentSection.id,
      type: newTemplateType,
      data: generatedData,
      meta: currentSection.meta,
      status: 'active',
    } as TemplateSection

    await supabase
      .from('topic_content_cache')
      .update({
        previous_section_data: currentSection,
        section_data: updatedSection,
        template_type: newTemplateType,
        kb_feedback: null,
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq('id', row.id)

    return NextResponse.json({ section: updatedSection, templateType: newTemplateType })
  } catch (err) {
    console.error('[kb-regenerate] Failed:', err)
    return NextResponse.json({ error: 'Regeneration failed. Please try again.' }, { status: 500 })
  }
}
