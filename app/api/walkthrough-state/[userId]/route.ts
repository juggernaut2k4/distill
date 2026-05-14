import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/walkthrough-state/[userId]
 * Returns current walkthrough_state for a user. Public — no auth required.
 * Used by WalkthroughClient to poll for updates instead of Supabase Realtime,
 * which is unreliable in Recall.ai's headless browser environment.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('walkthrough_state')
    .select('*')
    .eq('user_id', params.userId)
    .single()

  return NextResponse.json(
    data ?? { user_id: params.userId, status: 'idle', visual_spec: null, pending_speech: null }
  )
}

/**
 * DELETE /api/walkthrough-state/[userId]
 * Clears pending_speech after it has been played — prevents replaying on next poll.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const supabase = createSupabaseAdminClient()
  await supabase
    .from('walkthrough_state')
    .update({ pending_speech: null })
    .eq('user_id', params.userId)
  return NextResponse.json({ ok: true })
}
