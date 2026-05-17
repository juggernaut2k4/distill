import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateVisualSpec, reviewVisualSpec } from '@/lib/session-ai'
import { findPreGeneratedVisual, type SessionPlan } from '@/lib/session-plan'

const Body = z.object({
  userId: z.string().min(1),
  topicId: z.string().min(1).max(80),
  topicTitle: z.string().min(1).max(120),
})

/**
 * POST /api/generate-visual
 * Called by the WalkthroughClient's ElevenLabs client tool (show_visual).
 * Generates a VisualSpec via Claude and writes it to walkthrough_state.
 * Public — called from the Recall.ai headless browser, no Clerk session.
 * Never returns 5xx — always 200 so the agent tool call doesn't error.
 */
export async function POST(request: NextRequest) {
  let body: z.infer<typeof Body>
  try {
    body = Body.parse(await request.json())
  } catch (err) {
    console.error('[generate-visual] Invalid body:', err)
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const { userId, topicId, topicTitle } = body
  const supabase = createSupabaseAdminClient()

  // Check if there's a pre-generated visual spec in the session plan — instant render
  const { data: walkthroughState } = await supabase
    .from('walkthrough_state')
    .select('session_id')
    .eq('user_id', userId)
    .single()

  if (walkthroughState?.session_id) {
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('session_plan')
      .eq('id', walkthroughState.session_id)
      .single()

    const preGenerated = findPreGeneratedVisual(
      sessionRow?.session_plan as SessionPlan | null,
      topicTitle
    )

    if (preGenerated) {
      console.log('[generate-visual] Using pre-generated visual for:', topicTitle)
      await supabase
        .from('walkthrough_state')
        .update({
          status: 'ready',
          visual_spec: preGenerated,
          topic_id: preGenerated.topicId,
          topic_title: preGenerated.title,
        })
        .eq('user_id', userId)
      return NextResponse.json({ ok: true, source: 'pre-generated' })
    }
  }

  // Mark as generating immediately so the UI shows the loading state
  await supabase
    .from('walkthrough_state')
    .update({ status: 'generating' })
    .eq('user_id', userId)

  try {
    const spec = await generateVisualSpec(
      topicId,
      topicTitle,
      { role: 'executive', industry: 'business', maturity: 'beginner' },
      { width: 1280, height: 720 }
    )

    const review = await reviewVisualSpec(spec)
    const finalSpec = review.revisedSpec ?? spec

    await supabase
      .from('walkthrough_state')
      .update({
        status: 'ready',
        visual_spec: finalSpec,
        topic_id: finalSpec.topicId,
        topic_title: finalSpec.title,
      })
      .eq('user_id', userId)

    console.log('[generate-visual] Visual ready for user', userId, '— topic:', topicTitle)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[generate-visual] Generation failed:', err)
    // Reset status so UI doesn't hang on generating
    await supabase
      .from('walkthrough_state')
      .update({ status: 'idle' })
      .eq('user_id', userId)
    return NextResponse.json({ ok: false, error: 'Generation failed' })
  }
}
