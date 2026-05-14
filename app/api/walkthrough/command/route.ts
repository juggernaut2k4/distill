import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateVisualSpec, reviewVisualSpec } from '@/lib/session-ai'

const CommandSchema = z.object({
  userId: z.string().min(1),
  command: z.enum(['wipe', 'generate', 'idle']),
  topicId: z.string().optional(),
  topicTitle: z.string().optional(),
})

/**
 * POST /api/walkthrough/command
 * Manually pushes a command to the walkthrough page — for admin use and testing.
 * Auth required.
 */
export async function POST(request: NextRequest) {
  const { userId: requestingUserId } = auth()
  if (!requestingUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CommandSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 })
  }

  const { userId, command, topicId, topicTitle } = parsed.data
  const supabase = createSupabaseAdminClient()

  switch (command) {
    case 'idle': {
      await supabase
        .from('walkthrough_state')
        .update({ status: 'idle', visual_spec: null, topic_id: null, topic_title: null })
        .eq('user_id', userId)
      return NextResponse.json({ success: true })
    }

    case 'wipe': {
      await supabase
        .from('walkthrough_state')
        .update({ status: 'wiping' })
        .eq('user_id', userId)
      return NextResponse.json({ success: true })
    }

    case 'generate': {
      if (!topicId || !topicTitle) {
        return NextResponse.json(
          { error: 'topicId and topicTitle are required for generate command' },
          { status: 400 }
        )
      }

      // Mark as generating immediately, fire generation async
      await supabase
        .from('walkthrough_state')
        .update({ status: 'generating', topic_id: topicId, topic_title: topicTitle })
        .eq('user_id', userId)

      // Generate in background
      ;(async () => {
        try {
          const spec = await generateVisualSpec(
            topicId,
            topicTitle,
            { role: 'executive', industry: 'business', maturity: 'intermediate' },
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
        } catch (err) {
          console.error('[walkthrough/command] Generation failed:', err)
          await supabase
            .from('walkthrough_state')
            .update({ status: 'idle' })
            .eq('user_id', userId)
        }
      })().catch(console.error)

      return NextResponse.json({ success: true, message: 'Generation started' })
    }

    default:
      return NextResponse.json({ error: 'Unknown command' }, { status: 400 })
  }
}
