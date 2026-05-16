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

  if (data?.pending_transcript) {
    console.log('[walkthrough-state] GET returning pending_transcript:', (data.pending_transcript as string).slice(0, 80))
  }

  return NextResponse.json(
    data ?? { user_id: params.userId, status: 'idle', visual_spec: null, pending_transcript: null }
  )
}

/**
 * PATCH /api/walkthrough-state/[userId]
 * Clears pending_transcript after it has been sent to the ElevenLabs agent.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const supabase = createSupabaseAdminClient()
  await supabase
    .from('walkthrough_state')
    .update({ pending_transcript: null })
    .eq('user_id', params.userId)
  console.log('[walkthrough-state] PATCH cleared pending_transcript for', params.userId)
  return NextResponse.json({ ok: true })
}
