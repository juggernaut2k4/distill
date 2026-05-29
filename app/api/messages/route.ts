import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

/** Shape returned for each delivery log entry */
const MessageSchema = z.object({
  id: z.string(),
  sent_at: z.string(),
  channel: z.enum(['email', 'sms']),
  feedback: z.enum(['positive', 'negative']).nullable(),
  content: z
    .object({
      body_text: z.string(),
      type: z.string(),
    })
    .nullable(),
})

export type MessageItem = z.infer<typeof MessageSchema>

/**
 * GET /api/messages
 * Returns the last 30 delivery_log entries for the authenticated user,
 * joined with content_items for body_text and type.
 */
export async function GET(_request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  try {
    const supabase = createSupabaseAdminClient()

    const { data, error: dbError } = await supabase
      .from('delivery_log')
      .select(
        `
        id,
        sent_at,
        channel,
        feedback,
        content_items (
          body_text,
          type
        )
      `
      )
      .eq('user_id', userId!)
      .order('sent_at', { ascending: false })
      .limit(30)

    if (dbError) {
      console.error('[GET /api/messages] DB error:', dbError.message)
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    // Map to a clean response shape, dropping rows with no content_items.
    // Supabase infers content_items as an array type, but a FK join from the many side
    // (delivery_log) to the one side (content_items) always returns a single object at runtime.
    const messages: MessageItem[] = (data ?? []).map((row) => {
      const ci = row.content_items as unknown as { body_text: string; type: string } | null
      return {
        id: row.id as string,
        sent_at: row.sent_at as string,
        channel: row.channel as 'email' | 'sms',
        feedback: (row.feedback as 'positive' | 'negative' | null) ?? null,
        content: ci ? { body_text: ci.body_text, type: ci.type } : null,
      }
    })

    return NextResponse.json({ messages })
  } catch (err) {
    console.error('[GET /api/messages] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
