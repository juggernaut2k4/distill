import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'

import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/curriculum/queue-inspect
 * Temporary debug endpoint — returns queue_sessions titles and session_ids
 * so we can verify topic coverage without querying Supabase directly.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: plan } = await supabase
    .from('curriculum_plans')
    .select('id, queue_sessions')
    .eq('user_id', userId!)
    .is('superseded_at', null)
    .single()

  if (!plan) return NextResponse.json({ queue: [] })

  const queue = Array.isArray(plan.queue_sessions) ? plan.queue_sessions : []

  return NextResponse.json({
    total: queue.length,
    queue: queue.map((s: Record<string, unknown>, i: number) => ({
      index:          i + 1,
      session_id:     s.session_id,
      title:          s.title,
      arc_position:   s.arc_position,
      queue_rationale: s.queue_rationale,
    })),
  })
}
