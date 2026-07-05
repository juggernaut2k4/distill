import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * HUME-NATIVE-01 — POST /api/hume-native/session-chat-id
 *
 * New, isolated route. Persists sessions.hume_chat_id, captured from the
 * existing onConnect(sessionId) callback in hume-adapter.ts (the chat_id from
 * the chat_metadata event) — per BA spec 4.5. Only ever called from
 * WalkthroughClient.tsx when NEXT_PUBLIC_HUME_NATIVE_ENABLED is true for the
 * current session; no effect on any Custom-LLM-mode session, which never
 * calls this route.
 *
 * Gated to sessions where hume_native_enabled = true so a stray call (e.g.
 * toggle flipped mid-flight) cannot overwrite hume_chat_id on a Custom-LLM
 * session row.
 */
export async function POST(request: NextRequest) {
  let userId: string | undefined
  let humeChatId: string | undefined
  try {
    const body = await request.json() as { userId?: string; humeChatId?: string }
    userId = body.userId
    humeChatId = body.humeChatId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!userId || !humeChatId) {
    return NextResponse.json({ error: 'userId and humeChatId are required' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  const { data: sessionRow, error: sessionErr } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('hume_native_enabled', true)
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessionErr || !sessionRow?.id) {
    // Non-fatal — this is best-effort capture; the post-session extraction
    // job's safety-net cron (BA spec 4.8) is the fallback if this write is
    // ever missed. Log and return 200 so the client doesn't treat this as a
    // connect-blocking error.
    console.warn('[hume-native/session-chat-id] No active native-enabled session found for user:', userId, sessionErr?.message)
    return NextResponse.json({ ok: false })
  }

  const { error: updateErr } = await supabase
    .from('sessions')
    .update({ hume_chat_id: humeChatId })
    .eq('id', sessionRow.id)

  if (updateErr) {
    console.error('[hume-native/session-chat-id] Failed to persist hume_chat_id:', updateErr.message)
    return NextResponse.json({ ok: false })
  }

  return NextResponse.json({ ok: true })
}
