import { createClient } from '@supabase/supabase-js'

/**
 * Supabase browser client for use in Client Components only.
 * Separated from lib/supabase.ts to avoid importing next/headers in client bundles.
 */
export function createSupabaseBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
