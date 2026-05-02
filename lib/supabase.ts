import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { type NextRequest } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Creates a Supabase server client for use in Server Components and API Routes.
 * Automatically handles cookie-based auth for SSR.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies()
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options })
        } catch {
          // Server Component — cookie setting ignored
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options })
        } catch {
          // Server Component — cookie removal ignored
        }
      },
    },
  })
}

/**
 * Creates a Supabase admin client with service role key.
 * Use for server-side operations that bypass RLS (e.g. internal jobs).
 * NEVER expose this client to the browser.
 */
export function createSupabaseAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Creates a Supabase browser client for use in Client Components.
 */
export function createSupabaseBrowserClient() {
  return createClient(supabaseUrl, supabaseAnonKey)
}

/**
 * Retrieves the authenticated user from the Supabase session in an API Route.
 * @param request - The incoming Next.js request
 * @returns The user object or null if not authenticated
 */
export async function getUserFromSession(
  request: NextRequest
): Promise<{ id: string; email?: string } | null> {
  const cookieStore = cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
      set() {},
      remove() {},
    },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? { id: user.id, email: user.email } : null
}
