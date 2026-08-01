import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-65 (docs/specs/B2B-65-requirement-document.md §6.3). Reads the single global
 * `system_demo_performance_config` row that controls whether a newly-completed demo session's
 * result gets appended to the Performance tab's accumulating list. Fails open to `true` (the
 * column's own default) on any read error — see Requirement Doc §8 for reasoning.
 */
const SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

export async function getDemoPerformanceAppendEnabled(): Promise<boolean> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('system_demo_performance_config')
    .select('append_enabled')
    .eq('id', SINGLETON_ID)
    .maybeSingle()
  return (data?.append_enabled as boolean | undefined) ?? true
}
