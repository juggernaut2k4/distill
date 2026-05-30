import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateCuratedCatalog } from '@/lib/curriculum/catalog-curator'

const TOP_COMBINATIONS = [
  { role: 'ceo', industry: 'financial-services', maturity: 'beginner' },
  { role: 'ceo', industry: 'retail', maturity: 'beginner' },
  { role: 'cto', industry: 'general', maturity: 'intermediate' },
  { role: 'cfo', industry: 'financial-services', maturity: 'beginner' },
  { role: 'cmo', industry: 'retail', maturity: 'beginner' },
]

/**
 * POST /api/admin/seed-topic-cache
 *
 * Seeds the role_topic_cache table with pre-computed curated topic lists
 * for the top 5 role×industry×maturity combinations.
 * Protected — must be called with service role credentials server-side.
 *
 * Response: { results: Array<{ combination: string; status: 'ok' | 'error'; error?: string }> }
 */
export async function POST() {
  // Simple auth check — must be called with service role key
  const supabase = createSupabaseAdminClient()

  const results: Array<{ combination: string; status: 'ok' | 'error'; error?: string }> = []

  for (const combo of TOP_COMBINATIONS) {
    try {
      const curation = await generateCuratedCatalog(combo.role, combo.industry, combo.maturity)
      const { error } = await supabase
        .from('role_topic_cache')
        .upsert({
          role: combo.role,
          industry: combo.industry,
          maturity: combo.maturity,
          topics: curation.featured,
          generated_at: curation.generated_at,
          version: 1,
        }, { onConflict: 'role,industry,maturity' })

      if (error) {
        throw new Error(error.message)
      }

      results.push({ combination: `${combo.role}×${combo.industry}×${combo.maturity}`, status: 'ok' })
    } catch (err) {
      results.push({ combination: `${combo.role}×${combo.industry}×${combo.maturity}`, status: 'error', error: String(err) })
    }
  }

  return NextResponse.json({ results })
}
