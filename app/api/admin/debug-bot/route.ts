import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'

/**
 * GET /api/admin/debug-bot?botId=xxx
 * Fetches the full bot object from Recall.ai + walkthrough_state from Supabase.
 * For debugging only. B2B-21 Requirement Doc §7 — gated `requireSuperAdmin()`
 * (previously any authenticated Clerk session, an internal/cross-partner defect).
 */
export async function GET(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const userId = admin.clerkUserId

  const botId = request.nextUrl.searchParams.get('botId')
  if (!botId) return NextResponse.json({ error: 'botId required' }, { status: 400 })

  const region = process.env.RECALL_AI_REGION ?? 'us-east-1'
  const base = `https://${region}.recall.ai/api/v1`

  // Fetch bot from Recall.ai
  const recallRes = await fetch(`${base}/bot/${botId}`, {
    headers: {
      Authorization: `Token ${process.env.RECALL_AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  })
  const recallData = recallRes.ok ? await recallRes.json() : { error: await recallRes.text() }

  // Fetch walkthrough_state from Supabase — by bot_id AND by user_id
  const supabase = createSupabaseAdminClient()
  const { data: byBotId } = await supabase
    .from('walkthrough_state')
    .select('*')
    .eq('bot_id', botId)
    .single()

  const { data: byUserId } = await supabase
    .from('walkthrough_state')
    .select('*')
    .eq('user_id', userId)
    .single()

  return NextResponse.json({
    recall: recallData,
    walkthroughState: { byBotId, byUserId },
    env: {
      region,
      appUrl: process.env.NEXT_PUBLIC_APP_URL,
    },
  })
}
