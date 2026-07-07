import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getLiveConductorState, handleAdvanceTab } from '@/lib/voice/live-conductor-bridge'
import type { UserContext } from '@/lib/content/session-content-generator'

/**
 * ONDEMAND-02 — public (no auth), userId-keyed route that lets the Hume-native
 * voice path's `advance_tab` tool call actually reach the server-side
 * on-demand generation logic in lib/voice/live-conductor-bridge.ts, mirroring
 * exactly what app/api/clio/chat/completions/route.ts already does in-process
 * for the ElevenLabs/Custom-LLM path.
 *
 * Auth: none — matches the established public/userId-keyed pattern already
 * used by app/api/walkthrough-state/[userId]/route.ts (the headless Recall.ai
 * bot browser cannot hold a Clerk session). See requirement doc Section 3.
 *
 * This route is a thin transport: it resolves userId -> userContext -> live
 * conductor content/tab-index, then calls the existing, unmodified
 * handleAdvanceTab() — zero duplication of on-demand generation or visual
 * generation logic.
 */
export async function POST(request: NextRequest) {
  let userId: string | undefined
  try {
    const body = await request.json()
    userId = typeof body?.userId === 'string' ? body.userId : undefined
  } catch {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  try {
    const supabase = createSupabaseAdminClient()

    const { data: userRow } = await supabase
      .from('users')
      .select('role, industry, ai_maturity, role_level')
      .eq('id', userId)
      .single()

    const userContext: UserContext = {
      role: (userRow as { role?: string } | null)?.role ?? 'executive',
      industry: (userRow as { industry?: string } | null)?.industry ?? 'business',
      maturity: (userRow as { ai_maturity?: string } | null)?.ai_maturity ?? 'beginner',
      roleLevel: (userRow as { role_level?: string } | null)?.role_level ?? 'c-suite',
    }

    const liveState = await getLiveConductorState(userId, supabase, userContext)
    if (!liveState) {
      return NextResponse.json(
        { resultText: 'No active live-conductor session for this user.', isLastTab: true },
        { status: 200 }
      )
    }

    const { resultText, isLastTab } = await handleAdvanceTab(
      userId,
      liveState.content,
      liveState.tabIndex,
      userContext,
      supabase
    )

    return NextResponse.json({ resultText, isLastTab }, { status: 200 })
  } catch (err) {
    console.error('[live-conductor-advance-tab] Failed:', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
