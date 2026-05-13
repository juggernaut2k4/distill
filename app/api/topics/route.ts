import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

const TopicsSchema = z.object({
  topics: z.array(z.string().min(1).max(100)).min(0).max(5),
})

/**
 * POST /api/topics
 * Saves user topic interests and triggers curriculum plan generation.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  const body = await request.json()
  const parsed = TopicsSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const supabase = createSupabaseAdminClient()

  await supabase
    .from('users')
    .update({ topic_interests: parsed.data.topics })
    .eq('id', userId!)

  return NextResponse.json({ success: true })
}
