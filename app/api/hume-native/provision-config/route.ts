import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getUserLearningProfile, buildProfileContextForClio } from '@/lib/learning/user-profile'
import { buildTopicContext, buildSessionScript } from '@/lib/clio-context-builder'
import {
  assembleHumeNativePrompt,
  buildIntentContextForHumeNative,
} from '@/lib/voice/hume-native/prompt-template'
import { provisionNativeConfig } from '@/lib/voice/hume-native/config-provisioner'
import type { TemplateSection } from '@/lib/templates/types'

export const dynamic = 'force-dynamic'

/**
 * HUME-NATIVE-01 — POST /api/hume-native/provision-config
 *
 * New, isolated route. Only ever called from WalkthroughClient.tsx when
 * NEXT_PUBLIC_HUME_NATIVE_ENABLED is true for the current session (see 4.4).
 * Assembles the upfront Hume-native prompt from existing, untrimmed data
 * (buildProfileContextForClio, the intent sub-block, and the exact
 * whole-topic + per-tab content already produced under LIVE-01's pipeline —
 * read from walkthrough_state, no new content-generation call) and
 * provisions a fresh Hume Config in native/supplemental-LLM mode.
 *
 * Auth: matches the existing userId-keyed pattern used by
 * /api/walkthrough-state/[userId] and /api/generate-visual — this route is
 * invoked from inside the Recall.ai bot's headless browser session, which
 * only knows userId, not a Clerk session. Per BA spec section 6, no Zod
 * schema is needed beyond this implicit session context.
 *
 * On failure, this returns a non-2xx response — the caller (WalkthroughClient)
 * must NOT fall back to Custom-LLM mode silently. HUME_API_KEY is never
 * logged or returned in the response.
 */
export async function POST(request: NextRequest) {
  let userId: string | undefined
  try {
    const body = await request.json() as { userId?: string }
    userId = body.userId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  // Resolve the session row for this user. Per BA spec 4.5, hume_chat_id /
  // hume_native_config_id / hume_native_enabled are written on `sessions`,
  // not `walkthrough_state` — so we need the current active session row.
  const { data: sessionRow, error: sessionErr } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessionErr || !sessionRow?.id) {
    console.error('[hume-native/provision-config] No active session found for user:', userId, sessionErr?.message)
    return NextResponse.json({ error: 'No active session found for this user' }, { status: 404 })
  }
  const sessionId = sessionRow.id as string

  // Existing whole-topic + per-tab content, read from walkthrough_state exactly
  // as LIVE-01 produced it — no new content-generation call (per BA spec 4.2).
  const { data: stateRow, error: stateErr } = await supabase
    .from('walkthrough_state')
    .select('topic_title, sections, training_scripts')
    .eq('user_id', userId)
    .maybeSingle()

  if (stateErr || !stateRow) {
    console.error('[hume-native/provision-config] No walkthrough_state found for user:', userId, stateErr?.message)
    return NextResponse.json({ error: 'No session content available for this user yet' }, { status: 404 })
  }

  const sections = (stateRow.sections ?? []) as TemplateSection[]
  const trainingScripts = (stateRow.training_scripts ?? []) as Parameters<typeof buildSessionScript>[1]

  // topic_context per-section docs aren't separately stored on walkthrough_state
  // today (LIVE-01 folds them into the combined system_prompt at session-brief
  // time) — pass an all-null array so buildTopicContext falls back to its
  // existing "coach from the session script" per-section default, matching
  // the same fallback LIVE-01 itself uses when a doc hasn't been generated yet.
  const topicContextDocs: (string | null)[] = sections.map(() => null)

  const sessionContent = [
    stateRow.topic_title ? `# ${stateRow.topic_title}` : '',
    buildTopicContext(sections, topicContextDocs),
    buildSessionScript(sections, trainingScripts),
  ].filter(Boolean).join('\n\n---\n\n')

  // Full user profile (untrimmed) via the existing serializer.
  const profile = await getUserLearningProfile(userId)
  const currentDomain = stateRow.topic_title ?? 'general'
  const profileContext = profile ? buildProfileContextForClio(profile, currentDomain) : ''

  // Full detected-intent sub-block (omitted cleanly if no session_insights row exists yet).
  const intentContext = await buildIntentContextForHumeNative(userId)

  const assembledPrompt = assembleHumeNativePrompt({
    profileContext,
    intentContext,
    sessionContent,
  })

  // Provision the Hume Config. Hard failure on error — no silent fallback to
  // Custom-LLM mode (per BA spec 4.3).
  let configId: string
  try {
    const result = await provisionNativeConfig({ sessionId, assembledPrompt })
    configId = result.configId
  } catch (err) {
    console.error('[hume-native/provision-config] provisionNativeConfig failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to provision Hume native Config' }, { status: 502 })
  }

  // Persist configId + hume_native_enabled on the session row. This is the
  // per-session record of whether native mode ran, independent of the global
  // toggle's live value at query time (per BA spec 4.5, acceptance test 11).
  const { error: updateErr } = await supabase
    .from('sessions')
    .update({
      hume_native_config_id: configId,
      hume_native_enabled: true,
    })
    .eq('id', sessionId)

  if (updateErr) {
    console.error('[hume-native/provision-config] Failed to persist configId on session row:', updateErr.message)
    // Non-fatal to the caller — the configId is still valid and usable this
    // call; a missed persist just means a future re-provision won't be
    // avoided. Do not fail the request over this.
  }

  return NextResponse.json({ configId })
}
