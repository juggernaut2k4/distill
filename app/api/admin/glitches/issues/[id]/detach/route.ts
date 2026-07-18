import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireInternalAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * POST /api/admin/glitches/issues/:id/detach
 *
 * B2B-17 Requirement Doc §4.E.4 / §6.6 — detach one or more glitch instances from this issue by
 * clearing their issue_id (they revert to Untriaged). Only instances currently attached to THIS issue
 * are affected. Clerk-authenticated only.
 */

const DetachSchema = z.object({
  instance_ids: z.array(z.string().uuid()).min(1),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requireInternalAdmin()
  if (error) return error

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = DetachSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const instanceIds = Array.from(new Set(parsed.data.instance_ids))

  const supabase = createSupabaseAdminClient()

  // Verify every referenced instance exists (Section 8: non-existent id → 404).
  const { data: existing, error: existingError } = await supabase
    .from('glitch_instances')
    .select('id')
    .in('id', instanceIds)

  if (existingError) {
    console.error('[admin/glitches/issues/:id/detach] Failed to verify instances:', existingError.message)
    return NextResponse.json({ error: "Couldn't detach instances." }, { status: 500 })
  }
  if ((existing ?? []).length !== instanceIds.length) {
    return NextResponse.json({ error: 'One or more glitch instances were not found.' }, { status: 404 })
  }

  // Only detach instances that are actually attached to THIS issue (idempotent, scoped).
  const { error: updateError } = await supabase
    .from('glitch_instances')
    .update({ issue_id: null })
    .in('id', instanceIds)
    .eq('issue_id', params.id)

  if (updateError) {
    console.error('[admin/glitches/issues/:id/detach] Failed to detach instances:', updateError.message)
    return NextResponse.json({ error: "Couldn't detach instances." }, { status: 500 })
  }

  return NextResponse.json({ detached: instanceIds.length })
}
