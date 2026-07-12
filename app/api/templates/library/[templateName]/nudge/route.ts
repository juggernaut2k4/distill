import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { isConfiguredApprover } from '@/lib/templates/approval'
import { isFixLoopTemplate } from '@/lib/templates/styleOverrideSlots'
import { inngest } from '@/inngest/client'

interface Params { params: { templateName: string } }

const Body = z.object({
  action: z.enum(['status_check', 'force_retrigger']),
})

/**
 * POST /api/templates/library/[templateName]/nudge
 * TMPL-01 (requirement doc Section 4.3/6) — manual escape valve from the Fix
 * Progress view: check status, or force a new fix attempt when Arun has
 * waited and seen nothing.
 *
 * Gated by the EXACT SAME isConfiguredApprover() check as every other
 * mutating action in this workflow (403 for anyone else, 403 for everyone if
 * the approver env var is unset) — never a new or weakened auth pattern.
 *
 * - `status_check`: logs a nudge event with no other side effects.
 * - `force_retrigger`: logs a nudge event, assigns a NEW fix_cycle_id
 *   (superseding any in-flight invocation per the staleness-discard guard the
 *   fix-generator Inngest function checks before writing its final result),
 *   continues incrementing fix_attempt_count rather than resetting it to 0
 *   (this is the uncapped manual escape valve, distinct from the capped
 *   5-attempt automatic loop), and fires a fresh
 *   `clio/template.fix_requested` event.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!isConfiguredApprover(user?.email)) {
    return NextResponse.json(
      { error: 'Only the configured approver may nudge a template fix cycle.' },
      { status: 403 }
    )
  }

  const templateName = params.templateName

  if (!isFixLoopTemplate(templateName)) {
    return NextResponse.json(
      { error: `"${templateName}" does not participate in the automated fix loop.` },
      { status: 400 }
    )
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const body = Body.safeParse(json)
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { data: current, error: fetchError } = await supabase
    .from('template_library')
    .select('fix_state, fix_attempt_count, fix_cycle_id, review_notes')
    .eq('template_name', templateName)
    .maybeSingle()

  if (fetchError || !current) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  const actorEmail = user!.email as string
  const nowIso = new Date().toISOString()

  if (body.data.action === 'status_check') {
    await supabase.from('template_fix_log').insert({
      template_name: templateName,
      fix_cycle_id: current.fix_cycle_id ?? 'no-cycle',
      attempt_number: null,
      event_type: 'nudge_status_check',
      message: `Status checked by ${actorEmail} — currently ${current.fix_state} (attempt ${current.fix_attempt_count}), no change since last check.`,
      actor: actorEmail,
    })

    return NextResponse.json({ fixState: current.fix_state, fixAttemptCount: current.fix_attempt_count })
  }

  // force_retrigger
  const newFixCycleId = crypto.randomUUID()
  const newAttemptCount = (current.fix_attempt_count ?? 0) + 1

  const { data: updated, error: updateError } = await supabase
    .from('template_library')
    .update({
      fix_state: 'generating',
      fix_cycle_id: newFixCycleId,
      fix_attempt_count: newAttemptCount,
      fix_failure_reason: null,
      fix_last_activity_at: nowIso,
      updated_at: nowIso,
    })
    .eq('template_name', templateName)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: 'Force retrigger failed' }, { status: 500 })
  }

  await supabase.from('template_fix_log').insert({
    template_name: templateName,
    fix_cycle_id: newFixCycleId,
    attempt_number: newAttemptCount,
    event_type: 'nudge_force_retrigger',
    message: `Fix attempt force-retriggered by ${actorEmail} (attempt ${newAttemptCount}).`,
    actor: actorEmail,
  })

  await inngest.send({
    name: 'clio/template.fix_requested',
    data: { templateName, notes: current.review_notes, fixCycleId: newFixCycleId, forceRetrigger: true },
  })

  return NextResponse.json({ template: updated })
}
