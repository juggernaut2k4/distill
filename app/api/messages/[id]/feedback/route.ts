import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'

const FeedbackBodySchema = z.object({
  feedback: z.enum(['positive', 'negative']),
})

/**
 * POST /api/messages/[id]/feedback
 * Saves inline thumbs up/down feedback for a specific delivery_log entry.
 * Auth required — only the owning user can update their own delivery log.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const deliveryLogId = params.id
  if (!deliveryLogId) {
    return NextResponse.json({ error: 'Missing delivery log id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = FeedbackBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  try {
    const supabase = createSupabaseAdminClient()

    // Verify the row belongs to this user before updating
    const { data: row, error: fetchError } = await supabase
      .from('delivery_log')
      .select('id, user_id')
      .eq('id', deliveryLogId)
      .single()

    if (fetchError || !row) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (row.user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: updateError } = await supabase
      .from('delivery_log')
      .update({ feedback: parsed.data.feedback })
      .eq('id', deliveryLogId)

    if (updateError) {
      console.error('[POST /api/messages/[id]/feedback] DB update error:', updateError.message)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    // Emit Inngest feedback event for score recalculation (best-effort, non-blocking)
    try {
      const { inngest } = await import('@/inngest/client')
      await inngest.send({
        name: 'clio/feedback.received',
        data: {
          userId: userId!,
          deliveryLogId,
          feedback: parsed.data.feedback,
        },
      })
    } catch {
      // Mock mode or Inngest not configured — log only
      console.log('[feedback] Inngest event not sent (mock mode)')
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[POST /api/messages/[id]/feedback] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
