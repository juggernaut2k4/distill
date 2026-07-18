import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireInternalAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * POST /api/admin/glitches/issues/:id/attach
 *
 * B2B-17 Requirement Doc §4.B / §6.6 — attach one or more glitch instances to this issue by setting
 * their issue_id. An instance belongs to at most one issue, so attaching re-assigns it from any prior
 * issue (allowed, no error — Section 8). Clerk-authenticated only.
 */

const AttachSchema = z.object({
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

  const parsed = AttachSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const instanceIds = Array.from(new Set(parsed.data.instance_ids))

  const supabase = createSupabaseAdminClient()

  const { data: issue, error: issueError } = await supabase
    .from('glitch_issues')
    .select('id')
    .eq('id', params.id)
    .maybeSingle()

  if (issueError) {
    console.error('[admin/glitches/issues/:id/attach] Failed to verify issue:', issueError.message)
    return NextResponse.json({ error: "Couldn't attach instances." }, { status: 500 })
  }
  if (!issue) {
    return NextResponse.json({ error: 'Issue not found.' }, { status: 404 })
  }

  // Verify every referenced instance exists (Section 8: non-existent id → 404).
  const { data: existing, error: existingError } = await supabase
    .from('glitch_instances')
    .select('id')
    .in('id', instanceIds)

  if (existingError) {
    console.error('[admin/glitches/issues/:id/attach] Failed to verify instances:', existingError.message)
    return NextResponse.json({ error: "Couldn't attach instances." }, { status: 500 })
  }
  if ((existing ?? []).length !== instanceIds.length) {
    return NextResponse.json({ error: 'One or more glitch instances were not found.' }, { status: 404 })
  }

  const { error: updateError } = await supabase
    .from('glitch_instances')
    .update({ issue_id: params.id })
    .in('id', instanceIds)

  if (updateError) {
    console.error('[admin/glitches/issues/:id/attach] Failed to attach instances:', updateError.message)
    return NextResponse.json({ error: "Couldn't attach instances." }, { status: 500 })
  }

  return NextResponse.json({ attached: instanceIds.length })
}
