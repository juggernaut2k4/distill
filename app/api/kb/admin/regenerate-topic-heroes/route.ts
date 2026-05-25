import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateTemplateData } from '@/lib/templates/generator'
import type { TemplateSection, TopicHeroData } from '@/lib/templates/types'

export const maxDuration = 120

/**
 * POST /api/kb/admin/regenerate-topic-heroes
 * Finds every TopicHero section in topic_content_cache and regenerates it
 * with the new schema (key_takeaways, why_now). Accepts Clerk session auth.
 */
export async function POST(_request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createSupabaseAdminClient()

  // Fetch all TopicHero rows
  const { data: rows, error: fetchError } = await supabase
    .from('topic_content_cache')
    .select('id, section_data, template_type, topic_id, subtopic_slug')
    .eq('template_type', 'TopicHero')

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ updated: 0, message: 'No TopicHero sections found' })
  }

  // Fetch the requesting user's context once
  const { data: user } = await supabase
    .from('users').select('role, industry, ai_maturity').eq('id', userId).single()

  const userContext = {
    role: user?.role ?? 'executive',
    industry: user?.industry ?? 'business',
    maturity: user?.ai_maturity ?? 'intermediate',
  }

  const results: Array<{ id: string; status: 'ok' | 'error'; error?: string }> = []

  for (const row of rows) {
    const current = row.section_data as TemplateSection
    try {
      const generatedData = await generateTemplateData(
        'TopicHero',
        current.meta.subtopicTitle,
        current.meta.sessionTitle,
        userContext,
      )

      const updated: TemplateSection = {
        id: current.id,
        type: 'TopicHero',
        data: generatedData as TopicHeroData,
        meta: current.meta,
        status: 'active',
      }

      const { error: updateError } = await supabase
        .from('topic_content_cache')
        .update({
          section_data: updated,
          previous_section_data: current,
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', row.id)

      if (updateError) {
        results.push({ id: row.id, status: 'error', error: updateError.message })
      } else {
        results.push({ id: row.id, status: 'ok' })
      }
    } catch (err) {
      results.push({ id: row.id, status: 'error', error: String(err) })
    }
  }

  const ok = results.filter(r => r.status === 'ok').length
  const failed = results.filter(r => r.status === 'error').length
  console.log(`[regenerate-topic-heroes] ${ok} updated, ${failed} failed`)

  return NextResponse.json({ updated: ok, failed, total: rows.length, details: results })
}
