import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateCuratedCatalog } from '@/lib/curriculum/catalog-curator'

interface CacheEntry {
  role: string
  industry: string
  maturity: string
  version: number
}

interface RefreshResult {
  key: string
  status: string
}

/**
 * Monthly Inngest cron job that refreshes all cached role_topic_cache entries.
 * Runs on the 1st of each month at 3am UTC.
 * Re-generates curated topic lists for every existing combination in the cache.
 */
export const catalogRefresh = inngest.createFunction(
  {
    id: 'catalog-monthly-refresh',
    name: 'Monthly Catalog Refresh',
    retries: 2,
    triggers: [{ cron: '0 3 1 * *' }], // 3am UTC on the 1st of each month
  },
  async ({ step }) => {
    const supabase = createSupabaseAdminClient()

    // Get all existing cache entries
    const combinations = await step.run('fetch-cache-entries', async () => {
      const { data: existing } = await supabase
        .from('role_topic_cache')
        .select('role, industry, maturity, version')

      return (existing ?? []) as CacheEntry[]
    })

    console.log(`[catalog-refresh] Refreshing ${combinations.length} cached combinations`)

    const results = await step.run('refresh-all-combinations', async () => {
      const out: RefreshResult[] = []

      for (const combo of combinations) {
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
              version: (combo.version ?? 1) + 1,
            }, { onConflict: 'role,industry,maturity' })

          if (error) {
            throw new Error(error.message)
          }

          out.push({ key: `${combo.role}×${combo.industry}×${combo.maturity}`, status: 'refreshed' })
        } catch (err) {
          console.error(`[catalog-refresh] Failed ${combo.role}×${combo.industry}×${combo.maturity}:`, err)
          out.push({ key: `${combo.role}×${combo.industry}×${combo.maturity}`, status: 'error' })
        }
      }

      return out
    })

    const refreshed = results.filter((r: RefreshResult) => r.status === 'refreshed').length
    console.log(`[catalog-refresh] Done: ${refreshed}/${combinations.length} refreshed`)
    return results
  }
)
