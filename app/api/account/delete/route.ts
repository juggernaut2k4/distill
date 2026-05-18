import { NextResponse } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * POST /api/account/delete
 * Permanently deletes all user data from Supabase and the Clerk account.
 * Intended for testing purposes — removes all traces so the same email can re-register.
 */
export async function POST() {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createSupabaseAdminClient()

  // Delete all user data in dependency order (children before parent)
  const tables = [
    'walkthrough_state',
    'sms_conversations',
    'delivery_log',
    'feedback_weights',
    'user_session_context',
    'sessions',
  ]

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId)
    if (error) {
      console.error(`[delete-account] Failed to delete from ${table}:`, error.message)
    }
  }

  // Delete the users row last (it's the parent)
  const { error: userDeleteError } = await supabase.from('users').delete().eq('id', userId)
  if (userDeleteError) {
    console.error('[delete-account] Failed to delete users row:', userDeleteError.message)
  }

  // Delete the Clerk account — this invalidates all active sessions for this user
  try {
    await clerkClient.users.deleteUser(userId)
  } catch (err) {
    console.error('[delete-account] Clerk user deletion failed:', err)
    return NextResponse.json({ error: 'Failed to delete Clerk account' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
