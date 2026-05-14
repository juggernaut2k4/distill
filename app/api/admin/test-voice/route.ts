import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * POST /api/admin/test-voice
 * Sets pending_speech on walkthrough_state so the WalkthroughClient (running in
 * the bot's headless browser) fetches TTS audio and plays it — which the bot
 * captures and outputs to the meeting.
 * Body: { text? }
 */
export async function POST(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { text?: string }
  const message = body.text ?? "Hello! I'm Clio, your AI coach. If you can hear this, voice is working perfectly."

  const supabase = createSupabaseAdminClient()

  const { data, error } = await supabase
    .from('walkthrough_state')
    .update({ pending_speech: message })
    .eq('user_id', userId)
    .select('user_id, bot_id, pending_speech')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'No walkthrough_state row found for your user. Start a bot session first.' },
      { status: 400 }
    )
  }

  return NextResponse.json({ ok: true, message, updated: data })
}
